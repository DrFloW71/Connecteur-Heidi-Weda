// ==UserScript==
// @name         WEDA - Titres et commentaires antecedents lisibles
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  Souligne les titres et met en gras uniquement les commentaires des antecedents WEDA.
// @match        https://secure.weda.fr/*
// @all-frames   true
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const HOST_WEDA = 'secure.weda.fr';
    const SELECTOR_ANTECEDENT_ROOT = '#ContentPlaceHolder1_UpdatePanelAntecedent';
    const SELECTOR_PATIENT_PANEL = '#ContentPlaceHolder1_PanelPatient';
    const PATIENT_ANTECEDENTS_SUMMARY_SELECTORS = [
        'div.sc[onclick*="ButtonGotoAntecedent"]',
        '[onclick*="ButtonGotoAntecedent"]',
        '[href*="ButtonGotoAntecedent"]',
        '[id*="ButtonGotoAntecedent"]',
        '[name*="ButtonGotoAntecedent"]'
    ];
    const CIM10_MARK_SELECTORS = [
        '[title="Code CIM10"]',
        '[title="code cim10"]',
        '[title*="Code"][title*="CIM10"]',
        '[title*="code"][title*="cim10"]'
    ];
    const SELECTOR_PATIENT_ANTECEDENTS_SUMMARY = PATIENT_ANTECEDENTS_SUMMARY_SELECTORS.join(', ');
    const SELECTOR_WEDA_CIM10_TREE = '#ContentPlaceHolder1_ArbreCim10UCForm1_TreeViewCim10';
    const SELECTOR_WEDA_MODIFY_PANEL = '#ContentPlaceHolder1_PanelModifyAntecedent';
    const STYLE_ID = 'weda-atcd-commentaires-gras-style';
    const COMMENT_MARK_ATTR = 'data-weda-atcd-commentaire-gras';
    const TITLE_MARK_ATTR = 'data-weda-atcd-titre-souligne';
    const LATERALITE_MARK_ATTR = 'data-weda-atcd-lateralite';
    const LOG_PREFIX = '[WEDA-ATCD-COMMENTAIRES-GRAS]';

    let observer = null;
    let applyTimer = null;
    let lastCount = 0;
    let lastTitleCount = 0;

    function isWeda() {
        return location.hostname === HOST_WEDA;
    }

    function isAntecedentUrl() {
        return /\/foldermedical\/antecedentform\.aspx/i.test(location.pathname || '');
    }

    function isPatientHomeUrl() {
        return /\/foldermedical\/patientviewform\.aspx/i.test(location.pathname || '');
    }

    function getAntecedentRoot() {
        return document.querySelector(SELECTOR_ANTECEDENT_ROOT);
    }

    function isPatientHomePage() {
        return isWeda() && isPatientHomeUrl() && !!document.querySelector(SELECTOR_PATIENT_PANEL);
    }

    function isAntecedentPage() {
        return isWeda() && (isAntecedentUrl() || !!getAntecedentRoot());
    }

    function isSupportedPage() {
        return isAntecedentPage() || isPatientHomePage() || getDisplayRoots().length > 0;
    }

    function normalizeSpaces(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\s+\n/g, '\n')
            .replace(/\n\s+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function normalizeForMatch(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u2019']/g, ' ')
            .replace(/[-_/.,;:!?()[\]{}"<>]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function ownerWin(el) {
        return el && el.ownerDocument && el.ownerDocument.defaultView || window;
    }

    function isVisible(el) {
        if (!el) return false;
        try {
            const style = ownerWin(el).getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (_) {
            return true;
        }
    }

    function getElementText(el) {
        if (!el) return '';
        return normalizeSpaces([
            el.innerText,
            el.textContent,
            el.getAttribute && el.getAttribute('title'),
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('alt')
        ].filter(Boolean).join('\n'));
    }

    function getCellIndex(cell) {
        if (!cell) return -1;
        if (typeof cell.cellIndex === 'number') return cell.cellIndex;
        try {
            return Array.prototype.indexOf.call(cell.parentElement.children, cell);
        } catch (_) {
            return -1;
        }
    }

    function getHeaderMainLabel(el) {
        if (!el) return '';
        try {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.smna').forEach(child => child.remove());
            return normalizeSpaces((clone.innerText || clone.textContent || '').replace(/\[[^\]]+\]/g, ''));
        } catch (_) {
            return normalizeSpaces((el.innerText || el.textContent || '').replace(/\[[^\]]+\]/g, ''));
        }
    }

    function isSectionHeader(el) {
        if (!el || !isVisible(el)) return false;

        const className = String(el.className || '').toLowerCase();
        const title = normalizeForMatch(el.getAttribute && el.getAttribute('title') || '');
        if (!/\bsma\b/.test(className) && !title.includes('type de l onglet')) return false;

        const text = normalizeForMatch(getHeaderMainLabel(el) || getElementText(el));
        return !!text && !/^type de l onglet/.test(text);
    }

    function hasNestedTextBlock(el) {
        try {
            const own = normalizeSpaces(el.innerText || el.textContent || '');
            if (!own) return false;
            return Array.from(el.children || []).some(child => {
                const text = normalizeSpaces(child.innerText || child.textContent || '');
                return text && text.length > 1 && text.length >= Math.min(own.length, 80);
            });
        } catch (_) {
            return false;
        }
    }

    function hasAntecedentItemShape(el) {
        if (!el) return false;

        const tag = String(el.tagName || '').toLowerCase();
        const parent = el.parentElement;
        const parentTag = String(parent && parent.tagName || '').toLowerCase();
        const cell = el.closest && el.closest('td');
        const row = el.closest && el.closest('tr');
        const cellIndex = getCellIndex(cell);

        if (tag === 'div' && parentTag === 'td' && getCellIndex(parent) === 1) return true;
        if (tag === 'div' && cellIndex === 1 && row) return true;
        if (tag === 'td' && getCellIndex(el) === 1 && !hasNestedTextBlock(el)) return true;

        try {
            if (tag === 'div' && el.querySelector(':scope > span[title]') && el.querySelector('br')) return true;
        } catch (_) {}

        return false;
    }

    function hasNestedAntecedentItemShape(el) {
        if (!el || !el.querySelectorAll) return false;
        try {
            return Array.from(el.querySelectorAll('div, td')).some(child => child !== el && hasAntecedentItemShape(child));
        } catch (_) {
            return false;
        }
    }

    function looksLikeAntecedentText(text) {
        const cleaned = normalizeSpaces(text);
        if (!cleaned || cleaned.length < 2 || cleaned.length > 2500) return false;

        const n = normalizeForMatch(cleaned);
        if (!n) return false;
        if (/^(supprimer|modifier|valider|annuler|ajouter|fermer|aucun|non|oui|\d+)$/.test(n)) return false;
        if (/^type de l onglet/.test(n)) return false;

        return true;
    }

    function isAutoUiElement(el) {
        try {
            return !!(el && el.closest && el.closest([
                '#auto-atcd-cim10-badge',
                '#auto-atcd-cim10-log-button',
                '#auto-atcd-cim10-log-panel',
                '#auto-atcd-cim10-launcher-panel-avec-colorisation',
                '#color-atcd-cim10-panel',
                '#color-atcd-cim10-badge',
                '#color-atcd-cim10-log-panel'
            ].join(', ')));
        } catch (_) {
            return false;
        }
    }

    function isPatientAntecedentsSummary(el) {
        if (!el || !isVisible(el)) return false;

        const onclick = normalizeForMatch(el.getAttribute && el.getAttribute('onclick') || '');
        const href = normalizeForMatch(el.getAttribute && el.getAttribute('href') || '');
        const id = normalizeForMatch(el.id || '');
        const name = normalizeForMatch(el.getAttribute && el.getAttribute('name') || '');
        const hasGotoAntecedent = [onclick, href, id, name].some(value => value.includes('buttongotoantecedent'));
        if (!hasGotoAntecedent) return false;

        const text = normalizeForMatch(getElementText(el));
        const title = normalizeForMatch(el.getAttribute && el.getAttribute('title') || '');
        const className = normalizeForMatch(el.className || '');

        return className.includes('sc')
            || title.includes('volet medical')
            || text.includes('antecedents medicaux')
            || text.includes('antecedents')
            || text.includes('atcd')
            || text.includes('allergies');
    }

    function getPatientAntecedentsSummaryRoots() {
        const roots = [];
        const seen = new Set();

        try {
            document.querySelectorAll(SELECTOR_PATIENT_ANTECEDENTS_SUMMARY).forEach(el => {
                if (!isPatientAntecedentsSummary(el) || seen.has(el)) return;
                seen.add(el);
                roots.push(el);
            });
        } catch (_) {}

        return roots;
    }

    function buildDescendantSelector(parentSelectors, childSelectors) {
        const parents = Array.isArray(parentSelectors) ? parentSelectors : [parentSelectors];
        const children = Array.isArray(childSelectors) ? childSelectors : [childSelectors];

        return parents
            .flatMap(parent => children.map(child => `${parent} ${child}`))
            .join(',\n');
    }

    function getDisplayRoots() {
        const roots = [];
        const antecedentRoot = getAntecedentRoot();
        if (antecedentRoot) roots.push(antecedentRoot);

        for (const root of getPatientAntecedentsSummaryRoots()) {
            if (!roots.includes(root)) roots.push(root);
        }

        return roots;
    }

    function isIgnoredArea(el) {
        try {
            return !!(el && el.closest && el.closest([
                SELECTOR_WEDA_CIM10_TREE,
                SELECTOR_WEDA_MODIFY_PANEL,
                'script',
                'style',
                'noscript',
                'input',
                'select',
                'textarea',
                'button'
            ].join(', ')));
        } catch (_) {
            return false;
        }
    }

    function isCandidateElement(el, root) {
        if (!el || isAutoUiElement(el) || isIgnoredArea(el) || !isVisible(el)) return false;
        if (isSectionHeader(el)) return false;

        const tag = String(el.tagName || '').toLowerCase();
        if (!['div', 'td'].includes(tag)) return false;
        if (!el.querySelector || !el.querySelector('br')) return false;
        if (!hasAntecedentItemShape(el)) return false;
        if (hasNestedAntecedentItemShape(el)) return false;
        if (!looksLikeAntecedentText(getElementText(el))) return false;

        const closestTable = el.closest && el.closest('table');
        if (closestTable && tableNestingDepth(el, root) > 8) return false;

        return true;
    }

    function tableNestingDepth(el, stopAt) {
        let depth = 0;
        let node = el && el.parentElement;
        while (node && node !== stopAt && node !== document.body) {
            if (String(node.tagName || '').toLowerCase() === 'table') depth += 1;
            node = node.parentElement;
        }
        return depth;
    }

    function isCim10Element(el) {
        if (!el || !el.getAttribute) return false;
        const title = normalizeForMatch(el.getAttribute('title') || '');
        if (title === 'code cim10') return true;

        const text = normalizeSpaces(el.innerText || el.textContent || '');
        return /^\[[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?(?:-[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?)?\]$/i.test(text);
    }

    function normalizeLateraliteText(text) {
        return normalizeForMatch(text)
            .replace(/\+/g, ' ')
            .replace(/\blateralite\b/g, ' ')
            .replace(/\bcote\b/g, ' ')
            .replace(/\bcotes\b/g, ' ')
            .replace(/\bdu\b/g, ' ')
            .replace(/\bde\b/g, ' ')
            .replace(/\bla\b/g, ' ')
            .replace(/\ble\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isStandaloneLateraliteText(text) {
        const raw = String(text || '').trim();
        if (!raw) return false;
        if (raw.length > 80) return false;

        const normalized = normalizeLateraliteText(raw);
        if (!normalized) return false;

        return /^(?:d|g|droit|droite|gauche|bilateral|bilaterale|bilateraux|bilat|d g|g d|droite gauche|gauche droite|droite et gauche|gauche et droite|des deux|des deux cotes)$/.test(normalized);
    }

    function isLateraliteElement(el) {
        if (!el || !el.getAttribute) return false;
        if (el.hasAttribute(LATERALITE_MARK_ATTR)) return true;

        const attrText = normalizeForMatch([
            el.id || '',
            el.getAttribute('name') || '',
            el.getAttribute('class') || '',
            el.getAttribute('title') || '',
            el.getAttribute('aria-label') || ''
        ].join(' '));

        if (/\blateralite\b/.test(attrText)) return true;
        return isStandaloneLateraliteText(el.innerText || el.textContent || '');
    }

    function hasCim10Descendant(el) {
        if (!el || !el.querySelectorAll) return false;
        try {
            return Array.from(el.querySelectorAll('[title], span')).some(isCim10Element);
        } catch (_) {
            return false;
        }
    }

    function shouldSkipCommentElement(el) {
        if (!el || isIgnoredArea(el)) return true;

        const tag = String(el.tagName || '').toLowerCase();
        if (['br', 'script', 'style', 'noscript', 'input', 'select', 'textarea', 'button'].includes(tag)) return true;
        if (['img', 'svg', 'canvas'].includes(tag)) return true;
        if (isCim10Element(el)) return true;

        const className = String(el.className || '').toLowerCase();
        if (/\b(smna|smno|sma|sta)\b/.test(className)) return true;

        return false;
    }

    function textNodeLooksMeaningful(node) {
        const text = node && node.nodeValue || '';
        if (!/\S/.test(text)) return false;
        return !/^\s*\[[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?(?:-[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?)?\]\s*$/i.test(text);
    }

    function wrapTextNode(node, markAttr, options = {}) {
        if (!markAttr || !textNodeLooksMeaningful(node) || node.parentElement && node.parentElement.hasAttribute(markAttr)) return 0;
        if (options.skipLateralite && isStandaloneLateraliteText(node.nodeValue || '')) {
            const parent = node.parentElement;
            if (parent) parent.setAttribute(LATERALITE_MARK_ATTR, '1');
            return 0;
        }

        const doc = node.ownerDocument || document;
        const raw = node.nodeValue || '';
        const cim10Regex = /(\[[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?(?:-[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?)?\])/ig;
        const parts = raw.split(cim10Regex);

        if (parts.length <= 1) {
            const span = doc.createElement('span');
            span.setAttribute(markAttr, '1');
            span.textContent = raw;
            node.parentNode.replaceChild(span, node);
            return 1;
        }

        const fragment = doc.createDocumentFragment();
        let count = 0;
        for (const part of parts) {
            if (!part) continue;
            if (/^\[[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?(?:-[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?)?\]$/i.test(part)) {
                fragment.appendChild(doc.createTextNode(part));
            } else {
                const span = doc.createElement('span');
                span.setAttribute(markAttr, '1');
                span.textContent = part;
                fragment.appendChild(span);
                count += 1;
            }
        }

        node.parentNode.replaceChild(fragment, node);
        return count;
    }

    function markTextDescendants(el, markAttr, options = {}) {
        if (!el || shouldSkipCommentElement(el)) return 0;
        if (options.skipLateralite && isLateraliteElement(el)) {
            el.setAttribute(LATERALITE_MARK_ATTR, '1');
            return 0;
        }

        const textNodes = [];
        try {
            const walker = (el.ownerDocument || document).createTreeWalker(el, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const parent = node.parentElement;
                    if (!parent || shouldSkipCommentElement(parent)) return NodeFilter.FILTER_REJECT;
                    if (parent.closest && parent.closest('[title*="Code"][title*="CIM10"], [title*="code"][title*="cim10"]')) return NodeFilter.FILTER_REJECT;
                    return textNodeLooksMeaningful(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            });

            let node = walker.nextNode();
            while (node) {
                textNodes.push(node);
                node = walker.nextNode();
            }
        } catch (_) {
            return 0;
        }

        return textNodes.reduce((count, node) => count + wrapTextNode(node, markAttr, options), 0);
    }

    function markElement(el, markAttr, options = {}) {
        if (!el || shouldSkipCommentElement(el)) return 0;
        if (options.skipLateralite && isLateraliteElement(el)) {
            el.setAttribute(LATERALITE_MARK_ATTR, '1');
            return 0;
        }
        if (hasCim10Descendant(el)) return markTextDescendants(el, markAttr, options);

        const text = normalizeSpaces(el.innerText || el.textContent || '');
        if (!text) return 0;

        if (el.hasAttribute(markAttr)) return 0;
        el.setAttribute(markAttr, '1');
        return 1;
    }

    function getFirstDirectBreak(container) {
        for (const node of Array.from(container.childNodes || [])) {
            if (node.nodeType === Node.ELEMENT_NODE && String(node.tagName || '').toLowerCase() === 'br') {
                return node;
            }
        }
        return null;
    }

    function markTitlePart(container) {
        const firstBreak = getFirstDirectBreak(container);
        if (!firstBreak) return 0;

        let count = 0;
        for (const node of Array.from(container.childNodes || [])) {
            if (node === firstBreak) break;

            if (node.nodeType === Node.TEXT_NODE) {
                count += wrapTextNode(node, TITLE_MARK_ATTR, { skipLateralite: true });
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                count += markElement(node, TITLE_MARK_ATTR, { skipLateralite: true });
            }
        }
        return count;
    }

    function boldCommentPart(container) {
        const firstBreak = getFirstDirectBreak(container);
        if (!firstBreak) return 0;

        let count = 0;
        let inComment = false;
        for (const node of Array.from(container.childNodes || [])) {
            if (node === firstBreak) {
                inComment = true;
                continue;
            }
            if (!inComment) continue;

            if (node.nodeType === Node.TEXT_NODE) {
                count += wrapTextNode(node, COMMENT_MARK_ATTR);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                count += markElement(node, COMMENT_MARK_ATTR);
            }
        }
        return count;
    }

    function collectCandidateElements(root) {
        if (!root) return [];

        const raw = [];
        if (isCandidateElement(root, root)) raw.push(root);
        try {
            root.querySelectorAll('div, td').forEach(el => {
                if (isCandidateElement(el, root)) raw.push(el);
            });
        } catch (_) {}

        const selected = [];
        for (const el of raw) {
            if (selected.some(existing => existing.contains(el) || el.contains(existing))) continue;
            selected.push(el);
        }

        return selected;
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        const patientSummaryCommentSelector = buildDescendantSelector(PATIENT_ANTECEDENTS_SUMMARY_SELECTORS, `[${COMMENT_MARK_ATTR}="1"]`);
        const patientSummaryTitleSelector = buildDescendantSelector(PATIENT_ANTECEDENTS_SUMMARY_SELECTORS, `[${TITLE_MARK_ATTR}="1"]`);
        const patientSummaryCim10Selector = buildDescendantSelector(PATIENT_ANTECEDENTS_SUMMARY_SELECTORS, CIM10_MARK_SELECTORS);
        style.textContent = `
${SELECTOR_ANTECEDENT_ROOT} [${COMMENT_MARK_ATTR}="1"] {
    font-weight: 700 !important;
}
${SELECTOR_ANTECEDENT_ROOT} [${TITLE_MARK_ATTR}="1"] {
    text-decoration: underline !important;
    text-underline-offset: 2px !important;
}
${patientSummaryCommentSelector} {
    font-weight: 700 !important;
}
${patientSummaryTitleSelector} {
    text-decoration: underline !important;
    text-underline-offset: 2px !important;
}
${SELECTOR_ANTECEDENT_ROOT} [${LATERALITE_MARK_ATTR}="1"],
${buildDescendantSelector(PATIENT_ANTECEDENTS_SUMMARY_SELECTORS, `[${LATERALITE_MARK_ATTR}="1"]`)} {
    text-decoration: none !important;
}
${SELECTOR_ANTECEDENT_ROOT} [title="Code CIM10"],
${SELECTOR_ANTECEDENT_ROOT} [title="code cim10"],
${SELECTOR_ANTECEDENT_ROOT} [title*="Code"][title*="CIM10"],
${SELECTOR_ANTECEDENT_ROOT} [title*="code"][title*="cim10"],
${patientSummaryCim10Selector} {
    font-weight: 400 !important;
    text-decoration: none !important;
}
`;
        document.head.appendChild(style);
    }

    function applyAntecedentStyles() {
        if (!isSupportedPage()) return 0;

        installStyle();

        const roots = getDisplayRoots();
        const candidates = roots.flatMap(root => collectCandidateElements(root));
        let count = 0;
        let titleCount = 0;
        for (const candidate of candidates) {
            titleCount += markTitlePart(candidate);
            count += boldCommentPart(candidate);
        }

        try {
            lastCount = roots.reduce((total, root) => total + root.querySelectorAll(`[${COMMENT_MARK_ATTR}="1"]`).length, 0);
            lastTitleCount = roots.reduce((total, root) => total + root.querySelectorAll(`[${TITLE_MARK_ATTR}="1"]`).length, 0);
        } catch (_) {
            lastCount = count;
            lastTitleCount = titleCount;
        }
        return count;
    }

    function scheduleApply() {
        if (applyTimer) window.clearTimeout(applyTimer);
        applyTimer = window.setTimeout(() => {
            applyTimer = null;
            applyAntecedentStyles();
        }, 120);
    }

    function installObserver() {
        if (observer) return;

        observer = new MutationObserver(() => scheduleApply());
        observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true
        });
    }

    function exposeDebugApi() {
        try {
            window.AUTO_ATCD_COMMENTAIRES_GRAS_APPLY = applyAntecedentStyles;
            window.AUTO_ATCD_COMMENTAIRES_GRAS_DIAG = () => {
                const roots = getDisplayRoots();
                const candidates = roots.flatMap(root => collectCandidateElements(root));
                return {
                    isAntecedentPage: isAntecedentPage(),
                    isPatientHomePage: isPatientHomePage(),
                    rootCount: roots.length,
                    hasRoot: roots.length > 0,
                    candidateCount: candidates.length,
                    lastMarkedCount: lastCount,
                    lastTitleCount,
                    samples: candidates.slice(0, 12).map(el => normalizeSpaces(el.innerText || el.textContent || '').slice(0, 220))
                };
            };
        } catch (_) {}
    }

    function init() {
        if (!isWeda()) return;

        exposeDebugApi();
        installObserver();
        applyAntecedentStyles();
        window.setTimeout(applyAntecedentStyles, 800);
        window.setTimeout(applyAntecedentStyles, 2000);

        try {
            console.log(LOG_PREFIX, 'pret');
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
