// ==UserScript==
// @name         WEDA HPRIM -> SMS MadeforMed
// @namespace    https://secure.weda.fr/
// @version      1.0.2
// @description  PageDown sur WEDA HPRIM : affecte la biologie active, recherche le patient exact nom+prénom dans MadeforMed et envoie un SMS standardisé.
// @author       Florian Ronez + ChatGPT
// @match        https://secure.weda.fr/FolderMedical/HprimForm.aspx*
// @match        https://pro.madeformed.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.2';
    const LOG_PREFIX = '[AUTO-HPRIM-SMS]';

    const MADEFORMED_URL = 'https://pro.madeformed.com/agenda';
    const HASH_PREFIX = 'AUTO_WEDA_HPRIM_SMS=';

    const KEY_JOB = 'auto_weda_hprim_sms_job_v1';
    const KEY_REPORT = 'auto_weda_hprim_sms_last_report_v1';

    const SMS_TEXT = 'Bonjour, suite à votre dernière analyse il serait bien que nous nous voyions en consultation (avec moi personnellement). Rien d\'urgent rassurez vous. Bonne journée. Dr Ronez.';

    const SELECTORS = {
        wedaHprimNomPrincipal: '#ContentPlaceHolder1_HprimsGrid_LinkButtonHprimNom_0',
        wedaHprimsGrid: '#ContentPlaceHolder1_HprimsGrid',
        wedaHprimNomLinks: 'a[id*="HprimsGrid_LinkButtonHprimNom"]',

        wedaPatientsGrid: '#ContentPlaceHolder1_PatientsGrid',
        wedaPatientRows: '#ContentPlaceHolder1_PatientsGrid > tbody > tr.grid-item, #ContentPlaceHolder1_PatientsGrid tr.grid-item',
        wedaPatientIdentityCellPrincipal: '#ContentPlaceHolder1_PatientsGrid > tbody > tr.grid-item > td:nth-child(2)',
        wedaAffecterButtonPrincipal: '#ContentPlaceHolder1_PatientsGrid_ButtonAffecteResultat_0',

        madeformedPatientsShortcut: '#shortcuts > div.shortcuts-bar.for-desktop > div:nth-child(1), #shortcuts .shortcut.menu-user-btn[data-title="Patients"], .shortcut.menu-user-btn[data-title="Patients"], [data-title="Patients"]',
        madeformedSearchInput: '#userSearch',
        madeformedResults: '#users-result',
        madeformedPatientPanels: '#users-result .user.preview.panel',
        madeformedContactButton: '.user-preview-actions a.contact.contact-action, .user-preview-actions a.contact-action, a.contact.contact-action[data-contact-url]',
        madeformedSmsTextarea: '#contact-panel > textarea, #contact-panel textarea[name="sendSMS"], textarea[name="sendSMS"], textarea[send-by="sms"]',
        madeformedSendButton: '#contact-modal button.contact-send.btn.btn-primary, button.contact-send.btn.btn-primary, button.contact-send'
    };

    let localBusy = false;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function error(...args) {
        console.error(LOG_PREFIX, ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function makeJobId() {
        return 'hprim_sms_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function getPageWindow() {
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
        } catch (_) {}
        return window;
    }

    function isWedaHprimPage() {
        return location.hostname === 'secure.weda.fr' && /\/FolderMedical\/HprimForm\.aspx/i.test(location.pathname);
    }

    function isMadeformedPage() {
        return location.hostname === 'pro.madeformed.com';
    }

    function getHashJobId() {
        const hash = String(location.hash || '').replace(/^#/, '');
        if (!hash.startsWith(HASH_PREFIX)) return '';
        return decodeURIComponent(hash.slice(HASH_PREFIX.length));
    }

    function saveReport(status, data = {}) {
        const report = {
            at: nowIso(),
            version: VERSION,
            page: location.href,
            status,
            ...data
        };

        GM_setValue(KEY_REPORT, report);
        log('Rapport', report);
        return report;
    }

    function notify(message, type = 'info', durationMs = 5200) {
        try {
            let el = document.getElementById('auto-hprim-sms-notify');

            if (!el) {
                el = document.createElement('div');
                el.id = 'auto-hprim-sms-notify';
                el.style.position = 'fixed';
                el.style.left = '14px';
                el.style.bottom = '14px';
                el.style.zIndex = '2147483647';
                el.style.maxWidth = '520px';
                el.style.padding = '12px 16px';
                el.style.borderRadius = '12px';
                el.style.background = '#06345f';
                el.style.color = '#fff';
                el.style.fontSize = '15px';
                el.style.fontWeight = '700';
                el.style.fontFamily = 'Arial, sans-serif';
                el.style.boxShadow = '0 6px 22px rgba(0,0,0,0.35)';
                el.style.lineHeight = '1.35';
                el.style.whiteSpace = 'pre-wrap';
                document.body.appendChild(el);
            }

            if (type === 'error') {
                el.style.background = '#7a1020';
            } else if (type === 'warn') {
                el.style.background = '#7a4b00';
            } else if (type === 'success') {
                el.style.background = '#0b5a33';
            } else {
                el.style.background = '#06345f';
            }

            el.textContent = message;
            el.style.display = 'block';

            if (durationMs > 0) {
                clearTimeout(el.__autoHprimSmsTimer);
                el.__autoHprimSmsTimer = setTimeout(() => {
                    el.style.display = 'none';
                }, durationMs);
            }
        } catch (e) {
            warn('Notification impossible', e);
        }
    }

    function normalizeText(s) {
        return String(s || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/[’]/g, "'")
            .trim();
    }

    function normalizeName(s) {
        return normalizeText(s)
            .toUpperCase()
            .replace(/\b(M|MR|MME|MLLE|MONSIEUR|MADAME|MADEMOISELLE|DR|DOCTEUR)\b/g, ' ')
            .replace(/[^A-Z0-9' -]/g, ' ')
            .replace(/[-']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function textOf(el) {
        return el ? String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim() : '';
    }

    function isVisible(el) {
        if (!el) return false;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;

        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    async function waitFor(predicate, timeoutMs = 15000, intervalMs = 150) {
        const start = Date.now();
        let lastError = null;

        while (Date.now() - start < timeoutMs) {
            try {
                const result = predicate();
                if (result) return result;
            } catch (e) {
                lastError = e;
            }

            await sleep(intervalMs);
        }

        if (lastError) throw lastError;
        return null;
    }

    function dispatchMouseClick(el) {
        if (!el) return false;

        try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        try {
            if (typeof el.focus === 'function') el.focus();
        } catch (_) {}

        try {
            el.click();
            return true;
        } catch (e) {
            warn('el.click() impossible, fallback MouseEvent sans view', e);
        }

        const opts = {
            bubbles: true,
            cancelable: true
        };

        try {
            el.dispatchEvent(new MouseEvent('mouseover', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            return true;
        } catch (e) {
            warn('MouseEvent impossible, fallback Event simple', e);
        }

        try {
            el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
            return true;
        } catch (e) {
            error('Clic impossible', e);
            return false;
        }
    }

    function setNativeValue(el, value) {
        if (!el) return;

        const proto = el.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;

        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

        if (descriptor && descriptor.set) {
            descriptor.set.call(el, value);
        } else {
            el.value = value;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        try {
            el.dispatchEvent(new KeyboardEvent('keyup', {
                bubbles: true,
                cancelable: true,
                key: ' ',
                code: 'Space'
            }));
        } catch (_) {}

        try {
            const pageWindow = getPageWindow();
            if (pageWindow.$) {
                pageWindow.$(el).trigger('input').trigger('change').trigger('keyup');
            }
        } catch (_) {}
    }

    function pressEnter(el) {
        if (!el) return;

        const opts = {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        };

        try {
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            el.dispatchEvent(new KeyboardEvent('keypress', opts));
            el.dispatchEvent(new KeyboardEvent('keyup', opts));
        } catch (e) {
            warn('KeyboardEvent Enter impossible, fallback Event', e);
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        try {
            const pageWindow = getPageWindow();
            if (pageWindow.$) {
                pageWindow.$(el).trigger({
                    type: 'keydown',
                    which: 13,
                    keyCode: 13
                });

                pageWindow.$(el).trigger({
                    type: 'keyup',
                    which: 13,
                    keyCode: 13
                });
            }
        } catch (_) {}
    }

    function elementHasOrangeBackground(el) {
        if (!el) return false;

        let current = el;

        for (let i = 0; current && i < 5; i++, current = current.parentElement) {
            const style = window.getComputedStyle(current);
            const bg = style.backgroundColor || '';
            const inline = String(current.getAttribute('style') || '').toLowerCase();

            if (/orange|#ffa|#ffb|rgb\(255,\s*(1[0-9]{2}|2[0-4][0-9]|25[0-5])/.test(inline)) {
                return true;
            }

            const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (m) {
                const r = Number(m[1]);
                const g = Number(m[2]);
                const b = Number(m[3]);

                if (r >= 210 && g >= 90 && g <= 210 && b <= 130) {
                    return true;
                }
            }

            const cls = String(current.className || '').toLowerCase();
            if (/(selected|active|orange|current|highlight|surbrillance)/.test(cls)) {
                return true;
            }
        }

        return false;
    }

    function parseWedaIdentityCellText(cellText) {
        const rawLines = String(cellText || '')
            .replace(/\u00a0/g, ' ')
            .split(/\n|\r| {2,}/)
            .map(s => s.trim())
            .filter(Boolean);

        let lines = rawLines;

        if (lines.length < 2) {
            lines = String(cellText || '')
                .replace(/\u00a0/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ')
                .filter(Boolean);
        }

        const clean = lines
            .map(s => s.trim())
            .filter(Boolean)
            .filter(s => !/^(M|MR|MME|MLLE|MONSIEUR|MADAME|MADEMOISELLE)$/i.test(s));

        if (clean.length < 2) {
            return {
                nom: clean[0] || '',
                prenom: '',
                fullName: clean.join(' ').trim()
            };
        }

        return {
            nom: clean[0],
            prenom: clean.slice(1).join(' '),
            fullName: clean.join(' ').trim()
        };
    }

    function findBestWedaPatientRow() {
        const rows = Array.from(document.querySelectorAll(SELECTORS.wedaPatientRows));

        if (rows.length === 1) return rows[0];

        const orangeRow = rows.find(row => elementHasOrangeBackground(row));
        if (orangeRow) return orangeRow;

        const withAffecterButton = rows.find(row => row.querySelector('input[id*="ButtonAffecteResultat"], input[name*="ButtonAffecteResultat"], input.targetValider, input[type="submit"][value*="Affecter"]'));
        if (withAffecterButton) return withAffecterButton;

        return rows[0] || null;
    }

    function getActiveWedaPatientIdentity() {
        let row = findBestWedaPatientRow();
        let cell = null;

        if (row) {
            cell = row.querySelector('td:nth-child(2)');
        }

        if (!cell) {
            cell = document.querySelector(SELECTORS.wedaPatientIdentityCellPrincipal);
            if (cell) row = cell.closest('tr');
        }

        if (!cell) {
            throw new Error('Cellule nom/prénom patient introuvable dans PatientsGrid.');
        }

        const parsed = parseWedaIdentityCellText(cell.textContent || '');

        if (!parsed.nom || !parsed.prenom) {
            throw new Error('Nom/prénom patient incomplet dans PatientsGrid : "' + textOf(cell) + '".');
        }

        return {
            nomRaw: parsed.nom,
            prenomRaw: parsed.prenom,
            fullNameRaw: parsed.fullName,
            nomNormalized: normalizeName(parsed.nom),
            prenomNormalized: normalizeName(parsed.prenom),
            fullNameNormalized: normalizeName(parsed.fullName),
            row,
            cell
        };
    }

    function findActiveWedaHprimNameElement() {
        const principal = document.querySelector(SELECTORS.wedaHprimNomPrincipal);
        if (principal && textOf(principal)) return principal;

        const links = Array.from(document.querySelectorAll(SELECTORS.wedaHprimNomLinks))
            .filter(el => textOf(el));

        if (!links.length) return null;

        const orange = links.find(link => elementHasOrangeBackground(link));
        if (orange) return orange;

        const grid = document.querySelector(SELECTORS.wedaHprimsGrid);
        if (grid) {
            const selectedRow = Array.from(grid.querySelectorAll('tr')).find(row => elementHasOrangeBackground(row));
            if (selectedRow) {
                const link = selectedRow.querySelector(SELECTORS.wedaHprimNomLinks);
                if (link && textOf(link)) return link;
            }
        }

        return links[0] || null;
    }

    function getActiveWedaHprimNomForLogOnly() {
        const el = findActiveWedaHprimNameElement();
        const nom = textOf(el);

        return {
            raw: nom || '',
            normalized: normalizeName(nom || ''),
            selector: el && el.id ? '#' + el.id : ''
        };
    }

    function findWedaAffecterButton(patientRow) {
        if (patientRow) {
            const btnInRow = patientRow.querySelector('input[id*="ButtonAffecteResultat"], input[name*="ButtonAffecteResultat"], input.targetValider, input[type="submit"][value*="Affecter"]');
            if (btnInRow) return btnInRow;
        }

        let btn = document.querySelector(SELECTORS.wedaAffecterButtonPrincipal);
        if (btn) return btn;

        const grid = document.querySelector(SELECTORS.wedaPatientsGrid);
        if (grid) {
            btn = grid.querySelector('input[id*="ButtonAffecteResultat"], input[name*="ButtonAffecteResultat"], input.targetValider, input[type="submit"][value*="Affecter"]');
            if (btn) return btn;
        }

        btn = document.querySelector('input[id*="ButtonAffecteResultat"], input[name*="ButtonAffecteResultat"], input.targetValider, input[type="submit"][value*="Affecter"]');
        if (btn) return btn;

        const cell = document.querySelector('#ContentPlaceHolder1_PatientsGrid > tbody > tr:nth-child(2) > td:nth-child(9)');
        if (cell) {
            btn = cell.querySelector('input[type="submit"], button, input');
            if (btn) return btn;
        }

        return null;
    }

    function clickWedaAffecterWithAutoConfirm(btn) {
        if (!btn) throw new Error('Bouton "Affecter ce résultat" introuvable.');

        const pageWindow = getPageWindow();
        const oldConfirm = pageWindow.confirm;

        try {
            pageWindow.confirm = function (message) {
                log('Confirmation WEDA acceptée automatiquement :', message);
                return true;
            };

            dispatchMouseClick(btn);
            return true;
        } finally {
            setTimeout(() => {
                try {
                    pageWindow.confirm = oldConfirm;
                } catch (_) {}
            }, 1500);
        }
    }

    function openMadeformedWorker(job) {
        const url = MADEFORMED_URL + '#' + HASH_PREFIX + encodeURIComponent(job.id);

        try {
            const tab = GM_openInTab(url, {
                active: false,
                insert: true,
                setParent: true
            });

            log('Onglet MadeforMed ouvert', url, tab);
            return tab;
        } catch (e) {
            warn('GM_openInTab impossible, fallback window.open', e);
            window.open(url, '_blank', 'noopener,noreferrer');
            return null;
        }
    }

    async function copyNameToClipboard(text) {
        let ok = false;

        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text, 'text');
                ok = true;
            }
        } catch (e) {
            warn('GM_setClipboard impossible', e);
        }

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        } catch (e) {
            warn('navigator.clipboard impossible', e);
        }

        return ok;
    }

    async function runFromWedaPageDown() {
        if (localBusy) {
            notify('Traitement déjà en cours.', 'warn');
            return;
        }

        localBusy = true;

        try {
            const patient = getActiveWedaPatientIdentity();
            const hprimNomForLog = getActiveWedaHprimNomForLogOnly();

            if (!patient.nomNormalized || !patient.prenomNormalized) {
                throw new Error('Nom/prénom patient vide après normalisation.');
            }

            const affecterBtn = findWedaAffecterButton(patient.row);
            if (!affecterBtn) {
                throw new Error('Bouton "Affecter ce résultat" introuvable dans la ligne du patient.');
            }

            await copyNameToClipboard(patient.fullNameRaw);

            const job = {
                id: makeJobId(),
                version: VERSION,
                createdAt: nowIso(),
                status: 'queued',
                source: 'weda_hprim',
                wedaUrl: location.href,

                patientNomRaw: patient.nomRaw,
                patientPrenomRaw: patient.prenomRaw,
                patientFullNameRaw: patient.fullNameRaw,

                patientNomNormalized: patient.nomNormalized,
                patientPrenomNormalized: patient.prenomNormalized,
                patientFullNameNormalized: patient.fullNameNormalized,

                hprimNomRawForLog: hprimNomForLog.raw,
                hprimNomSelectorForLog: hprimNomForLog.selector,

                smsText: SMS_TEXT
            };

            GM_setValue(KEY_JOB, job);

            saveReport('job-created', {
                jobId: job.id,
                patientNom: patient.nomRaw,
                patientPrenom: patient.prenomRaw,
                patientFullName: patient.fullNameRaw,
                hprimNomForLog: hprimNomForLog.raw
            });

            notify(
                'Patient WEDA sélectionné : ' + patient.fullNameRaw +
                '\nValidation WEDA + préparation SMS MadeforMed.',
                'info',
                6500
            );

            openMadeformedWorker(job);

            await sleep(250);

            clickWedaAffecterWithAutoConfirm(affecterBtn);

            job.status = 'weda-validation-clicked';
            job.wedaValidationClickedAt = nowIso();
            GM_setValue(KEY_JOB, job);

            saveReport('weda-validation-clicked', {
                jobId: job.id,
                patientFullName: patient.fullNameRaw
            });
        } catch (e) {
            error('Erreur PageDown WEDA', e);

            saveReport('error-weda', {
                message: e.message || String(e),
                stack: e.stack || ''
            });

            notify('Erreur WEDA HPRIM SMS :\n' + (e.message || String(e)), 'error', 9000);
        } finally {
            setTimeout(() => {
                localBusy = false;
            }, 2500);
        }
    }

    function installWedaHotkey() {
        if (!isWedaHprimPage()) return;

        document.addEventListener('keydown', function (ev) {
            if (ev.key !== 'PageDown') return;

            const target = ev.target;
            const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            const editable = target && (target.isContentEditable || ['input', 'textarea', 'select'].includes(tag));

            if (editable) return;

            ev.preventDefault();
            ev.stopPropagation();

            runFromWedaPageDown();
        }, true);

        log('Script actif sur WEDA HPRIM v' + VERSION);
        notify('AUTO HPRIM SMS actif v' + VERSION + '\nPageDown : affecter biologie + SMS MadeforMed.', 'info', 4200);
    }

    async function clickMadeformedPatientsShortcut() {
        let shortcut = document.querySelector(SELECTORS.madeformedPatientsShortcut);

        if (!shortcut) {
            shortcut = await waitFor(() => document.querySelector(SELECTORS.madeformedPatientsShortcut), 20000, 250);
        }

        if (!shortcut) {
            throw new Error('Bouton Patients MadeforMed introuvable.');
        }

        dispatchMouseClick(shortcut);
        await sleep(700);
        return shortcut;
    }

    async function searchMadeformedPatientByName(job) {
        const input = await waitFor(() => document.querySelector(SELECTORS.madeformedSearchInput), 20000, 200);

        if (!input) {
            throw new Error('Barre de recherche MadeforMed #userSearch introuvable.');
        }

        const searchText = job.patientFullNameRaw || [job.patientNomRaw, job.patientPrenomRaw].filter(Boolean).join(' ');

        input.focus();

        setNativeValue(input, '');
        await sleep(100);

        setNativeValue(input, searchText);
        await sleep(150);

        pressEnter(input);

        try {
            if (input.form) {
                input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
        } catch (_) {}

        await waitFor(() => document.querySelector(SELECTORS.madeformedResults), 12000, 200);

        const panels = await waitFor(() => {
            const found = Array.from(document.querySelectorAll(SELECTORS.madeformedPatientPanels));
            return found.length ? found : null;
        }, 15000, 250);

        return panels || [];
    }

    function getPanelNom(panel) {
        if (!panel) return '';

        const spanNom = panel.querySelector('.user-name .nom, span.nom');
        const nom = textOf(spanNom);
        if (nom) return nom;

        const dataName = panel.getAttribute('data-user-name') || '';
        const normalized = normalizeName(dataName);
        const parts = normalized.split(' ').filter(Boolean);

        const withoutTitle = parts.filter(p => !/^(M|MR|MME|MLLE|MONSIEUR|MADAME|MADEMOISELLE)$/.test(p));

        if (withoutTitle.length >= 2) return withoutTitle[0];

        return dataName;
    }

    function getPanelPrenom(panel) {
        if (!panel) return '';

        const spanPrenom = panel.querySelector('.user-name .prenom, span.prenom');
        const prenom = textOf(spanPrenom);
        if (prenom) return prenom;

        const dataName = panel.getAttribute('data-user-name') || '';
        const normalized = normalizeName(dataName);
        const parts = normalized.split(' ').filter(Boolean);
        const withoutTitle = parts.filter(p => !/^(M|MR|MME|MLLE|MONSIEUR|MADAME|MADEMOISELLE)$/.test(p));

        if (withoutTitle.length >= 2) return withoutTitle.slice(1).join(' ');

        return '';
    }

    function patientPanelSummary(panel) {
        return {
            userId: panel.getAttribute('data-user-id') || '',
            dataUserName: panel.getAttribute('data-user-name') || '',
            nom: getPanelNom(panel),
            prenom: getPanelPrenom(panel),
            text: textOf(panel.querySelector('.user-name')) || textOf(panel).slice(0, 120)
        };
    }

    function findExactMadeformedPatientPanels(panels, job) {
        const expectedNom = normalizeName(job.patientNomRaw);
        const expectedPrenom = normalizeName(job.patientPrenomRaw);

        return panels.filter(panel => {
            const panelNom = normalizeName(getPanelNom(panel));
            const panelPrenom = normalizeName(getPanelPrenom(panel));

            if (panelNom === expectedNom && panelPrenom === expectedPrenom) {
                return true;
            }

            /*
             * Secours pour certains rendus MadeforMed :
             * data-user-name peut être "M. NOM Prénom" ou parfois "Prénom NOM".
             * On accepte uniquement si les deux tokens exacts nom + prénom sont présents,
             * mais on privilégie toujours les spans .nom et .prenom ci-dessus.
             */
            const dataName = normalizeName(panel.getAttribute('data-user-name') || '');
            const dataWords = dataName.split(' ').filter(Boolean);

            return dataWords.includes(expectedNom) && dataWords.includes(expectedPrenom);
        });
    }

    async function openContactPanelForPatient(panel) {
        const btn = panel.querySelector(SELECTORS.madeformedContactButton);

        if (!btn) {
            throw new Error('Icône contact/SMS introuvable pour le patient sélectionné.');
        }

        dispatchMouseClick(btn);

        const textarea = await waitFor(() => {
            const el = document.querySelector(SELECTORS.madeformedSmsTextarea);
            return el && isVisible(el) ? el : null;
        }, 18000, 200);

        if (!textarea) {
            throw new Error('Zone SMS MadeforMed introuvable après clic sur contact.');
        }

        return textarea;
    }

    async function fillAndSendMadeformedSms(textarea, smsText) {
        textarea.focus();

        setNativeValue(textarea, '');
        await sleep(120);

        setNativeValue(textarea, smsText);
        await sleep(250);

        const sendBtn = await waitFor(() => {
            const btn = document.querySelector(SELECTORS.madeformedSendButton);
            if (!btn || !isVisible(btn)) return null;
            return btn;
        }, 10000, 200);

        if (!sendBtn) {
            throw new Error('Bouton Envoyer MadeforMed introuvable.');
        }

        dispatchMouseClick(sendBtn);

        await sleep(2500);

        return true;
    }

    function closeMadeformedTabSoon() {
        notify('SMS envoyé.\nFermeture de l’onglet MadeforMed.', 'success', 2500);

        setTimeout(() => {
            try {
                window.close();
            } catch (_) {}

            setTimeout(() => {
                try {
                    if (!window.closed) {
                        location.href = 'about:blank';
                    }
                } catch (_) {}
            }, 900);
        }, 900);
    }

    async function runMadeformedWorker() {
        const hashJobId = getHashJobId();
        if (!hashJobId) return;

        await sleep(1000);

        const job = GM_getValue(KEY_JOB, null);

        if (!job || job.id !== hashJobId) {
            notify('Job HPRIM SMS introuvable ou expiré.\nAucun SMS envoyé.', 'error', 9000);

            saveReport('error-madeformed-no-job', {
                hashJobId
            });

            return;
        }

        if (job.status === 'done') {
            notify('Job déjà terminé.\nAucun nouvel SMS envoyé.', 'warn', 5000);
            return;
        }

        try {
            job.status = 'madeformed-running';
            job.madeformedStartedAt = nowIso();
            GM_setValue(KEY_JOB, job);

            notify('Recherche MadeforMed : ' + job.patientFullNameRaw, 'info', 0);

            await clickMadeformedPatientsShortcut();

            const panels = await searchMadeformedPatientByName(job);
            const exactPanels = findExactMadeformedPatientPanels(panels, job);

            const allSummaries = panels.map(patientPanelSummary);
            const exactSummaries = exactPanels.map(patientPanelSummary);

            log('Résultats MadeforMed', {
                searched: job.patientFullNameRaw,
                expectedNom: job.patientNomRaw,
                expectedPrenom: job.patientPrenomRaw,
                all: allSummaries,
                exact: exactSummaries
            });

            if (exactPanels.length === 0) {
                job.status = 'manual-check-no-exact-patient';
                job.madeformedResults = allSummaries;
                GM_setValue(KEY_JOB, job);

                saveReport('manual-check-no-exact-patient', {
                    jobId: job.id,
                    patientFullName: job.patientFullNameRaw,
                    resultCount: panels.length,
                    results: allSummaries
                });

                notify(
                    'Aucun patient MadeforMed avec nom + prénom exact : ' + job.patientFullNameRaw +
                    '\nAucun SMS envoyé. Contrôle manuel nécessaire.',
                    'error',
                    0
                );

                return;
            }

            if (exactPanels.length > 1) {
                job.status = 'manual-check-homonyms';
                job.madeformedExactResults = exactSummaries;
                GM_setValue(KEY_JOB, job);

                saveReport('manual-check-homonyms', {
                    jobId: job.id,
                    patientFullName: job.patientFullNameRaw,
                    exactCount: exactPanels.length,
                    exactResults: exactSummaries
                });

                notify(
                    'Plusieurs patients MadeforMed correspondent exactement à : ' + job.patientFullNameRaw +
                    '\nAucun SMS envoyé pour éviter une erreur d’identité.',
                    'warn',
                    0
                );

                return;
            }

            const selectedPanel = exactPanels[0];
            const selectedSummary = patientPanelSummary(selectedPanel);

            notify(
                'Patient MadeforMed exact trouvé : ' +
                [selectedSummary.nom, selectedSummary.prenom].filter(Boolean).join(' ') +
                '\nOuverture du SMS.',
                'info',
                0
            );

            const textarea = await openContactPanelForPatient(selectedPanel);

            await fillAndSendMadeformedSms(textarea, job.smsText || SMS_TEXT);

            job.status = 'done';
            job.doneAt = nowIso();
            job.selectedMadeformedPatient = selectedSummary;
            GM_setValue(KEY_JOB, job);

            saveReport('done', {
                jobId: job.id,
                patientFullName: job.patientFullNameRaw,
                selectedMadeformedPatient: selectedSummary,
                smsText: job.smsText || SMS_TEXT
            });

            closeMadeformedTabSoon();
        } catch (e) {
            error('Erreur MadeforMed worker', e);

            job.status = 'error-madeformed';
            job.error = {
                message: e.message || String(e),
                stack: e.stack || ''
            };
            job.errorAt = nowIso();
            GM_setValue(KEY_JOB, job);

            saveReport('error-madeformed', {
                jobId: job.id,
                patientFullName: job.patientFullNameRaw,
                message: e.message || String(e),
                stack: e.stack || ''
            });

            notify(
                'Erreur MadeforMed :\n' + (e.message || String(e)) +
                '\nAucun SMS confirmé comme envoyé.',
                'error',
                0
            );
        }
    }

    function installConsoleHelpers() {
        const root = getPageWindow();

        root.AUTO_HPRIM_SMS_LAST_REPORT = function () {
            const report = GM_getValue(KEY_REPORT, null);
            console.log(LOG_PREFIX, 'LAST_REPORT', report);
            return report;
        };

        root.AUTO_HPRIM_SMS_CURRENT_JOB = function () {
            const job = GM_getValue(KEY_JOB, null);
            console.log(LOG_PREFIX, 'CURRENT_JOB', job);
            return job;
        };

        root.AUTO_HPRIM_SMS_CLEAR = function () {
            GM_deleteValue(KEY_JOB);
            GM_deleteValue(KEY_REPORT);
            console.log(LOG_PREFIX, 'Stockage nettoyé.');
            return true;
        };

        root.AUTO_HPRIM_SMS_TEST_WEDA_PATIENT = function () {
            const patient = getActiveWedaPatientIdentity();
            const result = {
                nom: patient.nomRaw,
                prenom: patient.prenomRaw,
                fullName: patient.fullNameRaw,
                nomNormalized: patient.nomNormalized,
                prenomNormalized: patient.prenomNormalized,
                fullNameNormalized: patient.fullNameNormalized
            };
            console.log(LOG_PREFIX, 'Patient WEDA sélectionné', result);
            return result;
        };

        root.AUTO_HPRIM_SMS_TEST_WEDA_HPRIM_NAME = function () {
            const patient = getActiveWedaHprimNomForLogOnly();
            console.log(LOG_PREFIX, 'Nom HPRIM actif, pour log seulement', patient);
            return patient;
        };

        root.AUTO_HPRIM_SMS_TEST_MADEFORMED_MATCH = function (nom, prenom) {
            const fakeJob = {
                patientNomRaw: nom,
                patientPrenomRaw: prenom,
                patientFullNameRaw: [nom, prenom].filter(Boolean).join(' ')
            };

            const panels = Array.from(document.querySelectorAll(SELECTORS.madeformedPatientPanels));
            const exact = findExactMadeformedPatientPanels(panels, fakeJob);

            const result = {
                searched: fakeJob.patientFullNameRaw,
                searchedNomNormalized: normalizeName(nom),
                searchedPrenomNormalized: normalizeName(prenom),
                all: panels.map(patientPanelSummary),
                exact: exact.map(patientPanelSummary)
            };

            console.log(LOG_PREFIX, 'TEST_MADEFORMED_MATCH', result);
            return result;
        };

        root.AUTO_HPRIM_SMS_RUN_MADEFORMED_WORKER = function () {
            runMadeformedWorker();
            return true;
        };

        root.AUTO_HPRIM_SMS_VERSION = VERSION;
    }

    installConsoleHelpers();

    if (isWedaHprimPage()) {
        installWedaHotkey();
    }

    if (isMadeformedPage()) {
        runMadeformedWorker();
    }

})();