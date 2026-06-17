// ==UserScript==
// @name         WEDA - Batch suppression medicaments barres
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  Passe de patient en patient depuis une liste WEDA, ouvre les antecedents, clique sur Supprimer tous les medicaments barres, puis passe au patient suivant.
// @match        https://secure.weda.fr/*
// @noframes
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // Securite anti-boucle : le script ne doit s'executer que dans la fenetre principale WEDA.
    // Certains ecrans WEDA/ASP.NET peuvent charger des frames de meme origine ; sans ce garde-fou,
    // plusieurs instances worker peuvent redemarrer en boucle sur le meme patient.
    try {
        if (window.top && window.top !== window.self) return;
    } catch (_) {
        return;
    }

    /************************************************************
     * CONFIGURATION
     ************************************************************/

    const VERSION = '1.0.3';
    const HOST_WEDA = 'secure.weda.fr';
    const LOG_PREFIX = '[AUTO-SUPP-MED-BARRES]';
    const WORKER_HASH_PREFIX = 'AUTO_SUPP_MED_BARRES_WORKER=';

    const KEY_QUEUE = 'auto_supp_med_barres_queue_v1';
    const KEY_STATE = 'auto_supp_med_barres_state_v1';
    const KEY_LOG = 'auto_supp_med_barres_log_v1';
    const KEY_CURRENT = 'auto_supp_med_barres_current_v1';
    const KEY_RESULT = 'auto_supp_med_barres_result_v1';
    const KEY_HEARTBEAT = 'auto_supp_med_barres_worker_heartbeat_v1';
    const KEY_LOCK = 'auto_supp_med_barres_lock_v1';
    const KEY_COMMAND = 'auto_supp_med_barres_command_v1';
    const KEY_LAST_REPORT = 'auto_supp_med_barres_last_report_v1';
    const KEY_WORKER_ACTION = 'auto_supp_med_barres_worker_action_v1';

    const SESSION_WORKER_INFO = 'auto_supp_med_barres_worker_info_v1';
    const SESSION_WORKER_ACTION = 'auto_supp_med_barres_worker_action_v1';

    const SELECTOR_ANTECEDENT_ROOT = '#ContentPlaceHolder1_UpdatePanelAntecedent';
    const SELECTOR_GOTO_ANTECEDENTS = '[onclick*="ButtonGotoAntecedent"], [href*="ButtonGotoAntecedent"], [id*="ButtonGotoAntecedent"], [name*="ButtonGotoAntecedent"]';

    // Selecteur fourni par l'utilisateur. Il reste prioritaire.
    const SELECTOR_DELETE_EXACT = '#ContentPlaceHolder1_UpdatePanelAntecedent > div > table:nth-child(62) > tbody > tr > td:nth-child(7) > img';

    // Fallbacks si WEDA change legerement la structure du tableau.
    const SELECTOR_DELETE_FALLBACKS = [
        'img[onclick*="PostBackDeleteTraitementChroniqueBarre"]',
        'img[title*="Supprimer tous les médicaments barrés"]',
        'img[title*="Supprimer tous les medicaments barres"]',
        'img[alt="S"][src*="trash"]',
        'img[src*="trash-icon16"]'
    ];

    const PAGE_LOAD_TIMEOUT_MS = 30000;
    const ANTECEDENTS_NAV_TIMEOUT_MS = 45000;
    const DELETE_ACTION_TIMEOUT_MS = 30000;
    const PATIENT_TIMEOUT_MS = 2 * 60 * 1000;
    const HEARTBEAT_INTERVAL_MS = 3000;
    const HEARTBEAT_STALE_MS = 20000;
    const CONTROLLER_LOCK_TTL_MS = 30000;
    const NEXT_PATIENT_DELAY_MS = 800;
    const WORKER_CLOSE_DELAY_MS = 900;
    const MAX_LOG_ENTRIES = 300;

    // WEDA/Tampermonkey est souvent plus fiable si l'onglet worker devient actif.
    // Passer a false si tu veux absolument rester sur la liste pendant le batch.
    const OPEN_WORKER_ACTIVE = true;
    const OPEN_WORKER_INSERT = false;

    const PANEL_ID = 'auto-supp-med-barres-panel';
    const LOG_PANEL_ID = 'auto-supp-med-barres-log-panel';
    const BADGE_ID = 'auto-supp-med-barres-badge';

    const TERMINAL_STATUSES = new Set(['success', 'skipped', 'error', 'timeout']);
    const ACTIVE_STATUSES = new Set([
        'running',
        'opening_patient',
        'waiting_patient_page',
        'going_to_antecedents',
        'clicking_delete_button',
        'waiting_delete_done',
        'closing_worker',
        'next_patient'
    ]);

    const runtime = {
        processing: false,
        lockTimer: null,
        heartbeatTimer: null,
        workerStatus: 'idle',
        clickedAt: null,
        resultPublished: false,
        resultWaiter: null
    };

    const CONTROLLER_ID = getOrCreateSessionValue('auto_supp_med_barres_controller_id_v1', () => {
        return `ctrl_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    });

    /************************************************************
     * OUTILS GENERIQUES
     ************************************************************/

    function isTopWindow() {
        try {
            return window.self === window.top;
        } catch (_) {
            return true;
        }
    }

    if (!isTopWindow()) {
        return;
    }

    function nowMs() {
        return Date.now();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitFor(fn, timeoutMs = 10000, intervalMs = 400) {
        const start = nowMs();
        while (nowMs() - start < timeoutMs) {
            try {
                const result = fn();
                if (result) return result;
            } catch (_) {}
            await sleep(intervalMs);
        }
        return null;
    }

    function isWeda() {
        return window.location.hostname === HOST_WEDA;
    }

    function getOrCreateSessionValue(key, buildValue) {
        try {
            const existing = sessionStorage.getItem(key);
            if (existing) return existing;
            const value = buildValue();
            sessionStorage.setItem(key, value);
            return value;
        } catch (_) {
            return buildValue();
        }
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function lowerText(value) {
        return normalizeText(value).toLowerCase();
    }

    function limitText(value, maxLen = 180) {
        const text = normalizeText(value);
        if (text.length <= maxLen) return text;
        return text.slice(0, maxLen - 1) + '...';
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function decodeHtmlAttribute(value) {
        return String(value || '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#34;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"');
    }

    function parseMaybeJson(raw, fallback) {
        if (raw === null || raw === undefined || raw === '') return fallback;
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return fallback;
        }
    }

    function gmGetJson(key, fallback) {
        try {
            return parseMaybeJson(GM_getValue(key, null), fallback);
        } catch (e) {
            console.warn(LOG_PREFIX, 'Lecture GM impossible', key, e);
            return fallback;
        }
    }

    function gmSetJson(key, value) {
        try {
            GM_setValue(key, JSON.stringify(value));
        } catch (e) {
            console.warn(LOG_PREFIX, 'Ecriture GM impossible', key, e);
        }
    }

    function gmDelete(key) {
        try {
            GM_deleteValue(key);
        } catch (_) {}
    }

    function getAccessibleDocuments() {
        const docs = [];
        const seen = new Set();

        function addDoc(doc) {
            if (!doc || seen.has(doc)) return;
            seen.add(doc);
            docs.push(doc);

            const frames = doc.querySelectorAll ? doc.querySelectorAll('iframe, frame') : [];
            for (const frame of frames) {
                try {
                    addDoc(frame.contentDocument || (frame.contentWindow && frame.contentWindow.document));
                } catch (_) {}
            }
        }

        addDoc(document);
        return docs;
    }

    function queryAllDeep(selector) {
        const results = [];
        for (const doc of getAccessibleDocuments()) {
            try {
                results.push(...doc.querySelectorAll(selector));
            } catch (_) {}
        }
        return results;
    }

    function queryOneDeep(selector) {
        for (const doc of getAccessibleDocuments()) {
            try {
                const found = doc.querySelector(selector);
                if (found) return found;
            } catch (_) {}
        }
        return null;
    }

    function ownerWin(el) {
        return (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
    }

    function isVisible(el) {
        if (!el) return false;
        const view = ownerWin(el);
        try {
            const style = view.getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (_) {
            return true;
        }
    }

    function getElementText(el) {
        if (!el) return '';
        return normalizeText([
            el.innerText,
            el.textContent,
            el.value,
            el.getAttribute && el.getAttribute('title'),
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('alt')
        ].filter(Boolean).join(' '));
    }

    function clickElement(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        const doc = el.ownerDocument || document;
        const view = doc.defaultView || window;
        const eventOptions = { bubbles: true, cancelable: true, view };

        try { el.dispatchEvent(new view.MouseEvent('mouseover', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousemove', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousedown', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mouseup', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('click', eventOptions)); } catch (_) {}
        try { el.click(); } catch (_) {}
        return true;
    }

    function parsePostBackTarget(raw) {
        const text = decodeHtmlAttribute(raw);
        let match = text.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
        if (match) return { target: match[1], argument: match[2] || '' };

        match = text.match(/WebForm_PostBackOptions\s*\(\s*['"]([^'"]+)['"]/i);
        if (match) return { target: match[1], argument: '' };

        match = text.match(/WebForm_DoPostBackWithOptions\s*\(\s*new\s+WebForm_PostBackOptions\s*\(\s*['"]([^'"]+)['"]/i);
        if (match) return { target: match[1], argument: '' };

        return null;
    }

    function getDoPostBack() {
        const wins = [];
        try { wins.push(window); } catch (_) {}
        try { if (typeof unsafeWindow !== 'undefined') wins.push(unsafeWindow); } catch (_) {}
        for (const doc of getAccessibleDocuments()) {
            try { wins.push(doc.defaultView); } catch (_) {}
        }

        for (const win of wins) {
            try {
                if (win && typeof win.__doPostBack === 'function') return win.__doPostBack.bind(win);
            } catch (_) {}
        }
        return null;
    }

    function callSpecificPostBack(target, argument = '') {
        const postback = getDoPostBack();
        if (!postback || !target) return false;
        try {
            postback(target, argument || '');
            return true;
        } catch (e) {
            addLog('warn', 'PostBack WEDA impossible.', null, { target, argument, error: String(e && e.message ? e.message : e) });
            return false;
        }
    }

    function getWedaAsyncPostBackActive() {
        const wins = [];
        try { wins.push(window); } catch (_) {}
        try { if (typeof unsafeWindow !== 'undefined') wins.push(unsafeWindow); } catch (_) {}
        for (const doc of getAccessibleDocuments()) {
            try { wins.push(doc.defaultView); } catch (_) {}
        }

        for (const win of wins) {
            try {
                const prm = win.Sys && win.Sys.WebForms && win.Sys.WebForms.PageRequestManager
                    ? win.Sys.WebForms.PageRequestManager.getInstance()
                    : null;
                if (prm && typeof prm.get_isInAsyncPostBack === 'function' && prm.get_isInAsyncPostBack()) return true;
            } catch (_) {}
        }
        return false;
    }

    async function waitForWedaIdle(timeoutMs = 15000) {
        await waitFor(() => !getWedaAsyncPostBackActive(), timeoutMs, 250);
        await sleep(600);
        return true;
    }

    function extractPatDk(value) {
        const text = String(value || '');
        const match = text.match(/[?&]PatDk=([^&#]+)/i);
        if (!match) return '';
        try {
            return decodeURIComponent(match[1]).trim();
        } catch (_) {
            return match[1].trim();
        }
    }

    function samePatDk(a, b) {
        const aa = String(a || '').trim();
        const bb = String(b || '').trim();
        return !!aa && !!bb && aa === bb;
    }

    function buildPatientUrl(patientId) {
        return `https://${HOST_WEDA}/FolderMedical/PatientViewForm.aspx?PatDk=${encodeURIComponent(patientId)}`;
    }

    function getCurrentPageUrlWithoutHash() {
        return String(window.location.href || '').split('#')[0];
    }

    function makeBatchId() {
        return `batch_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    }

    function compactUrlForLog(url) {
        const raw = String(url || '');
        if (!raw) return '';
        try {
            const parsed = new URL(raw, window.location.href);
            const page = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
            const patDk = parsed.searchParams.get('PatDk');
            return [page, patDk ? `PatDk=${patDk}` : ''].filter(Boolean).join(' ');
        } catch (_) {
            return limitText(raw, 120);
        }
    }

    function safePrettyJson(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch (_) {
            return String(value);
        }
    }

    /************************************************************
     * LOGS, ETAT, FILE
     ************************************************************/

    function getQueue() {
        const queue = gmGetJson(KEY_QUEUE, []);
        return Array.isArray(queue) ? queue : [];
    }

    function saveQueue(queue) {
        gmSetJson(KEY_QUEUE, Array.isArray(queue) ? queue : []);
        refreshStateCounts();
        renderPanel();
    }

    function getState() {
        const state = gmGetJson(KEY_STATE, null) || {};
        return Object.assign({
            batchId: '',
            status: 'idle',
            total: 0,
            pending: 0,
            running: 0,
            success: 0,
            skipped: 0,
            errors: 0,
            activeTotal: 0,
            activeRemaining: 0,
            runningPatientId: '',
            startedAt: null,
            finishedAt: null,
            updatedAt: nowMs(),
            pauseRequested: false,
            stopRequested: false,
            resumeFromIndex: null,
            resumeFromPatientId: ''
        }, state);
    }

    function countQueue(queue) {
        const counts = {
            total: queue.length,
            pending: 0,
            running: 0,
            success: 0,
            skipped: 0,
            errors: 0,
            activeTotal: 0,
            activeRemaining: 0
        };

        for (const patient of queue) {
            const status = patient && patient.status ? patient.status : 'pending';
            if (status === 'pending') counts.pending += 1;
            if (status === 'running') counts.running += 1;
            if (status === 'success') counts.success += 1;
            if (status === 'skipped') counts.skipped += 1;
            if (status === 'error' || status === 'timeout') counts.errors += 1;
            if (patient && !patient.excludedByResume) {
                counts.activeTotal += 1;
                if (!TERMINAL_STATUSES.has(status)) counts.activeRemaining += 1;
            }
        }
        return counts;
    }

    function setState(patch) {
        const queue = getQueue();
        const counts = countQueue(queue);
        const next = Object.assign({}, getState(), counts, patch || {}, { updatedAt: nowMs() });
        gmSetJson(KEY_STATE, next);
        renderPanel();
        return next;
    }

    function refreshStateCounts() {
        const queue = getQueue();
        const counts = countQueue(queue);
        gmSetJson(KEY_STATE, Object.assign({}, getState(), counts, { updatedAt: nowMs() }));
    }

    function getLogs() {
        const logs = gmGetJson(KEY_LOG, []);
        return Array.isArray(logs) ? logs : [];
    }

    function addLog(level, message, patient, details) {
        const entry = {
            ts: nowMs(),
            at: new Date().toISOString(),
            level: String(level || 'info'),
            message: String(message || ''),
            patientId: patient && (patient.id || patient.patientId) ? String(patient.id || patient.patientId) : '',
            patientName: patient && (patient.name || patient.patientName) ? String(patient.name || patient.patientName) : '',
            url: compactUrlForLog(window.location.href),
            details: details || null
        };

        const logs = getLogs();
        logs.push(entry);
        gmSetJson(KEY_LOG, logs.slice(-MAX_LOG_ENTRIES));

        const method = entry.level === 'error' ? 'error' : (entry.level === 'warn' ? 'warn' : 'log');
        try {
            console[method](LOG_PREFIX, entry.message, entry.patientId || '', entry.details || '');
        } catch (_) {}

        renderPanel();
        refreshLogPanel();
        return entry;
    }

    function clearLogs() {
        gmSetJson(KEY_LOG, []);
        refreshLogPanel();
        renderPanel();
    }

    function setCommand(action, details) {
        gmSetJson(KEY_COMMAND, {
            action,
            details: details || {},
            ts: nowMs(),
            controllerId: CONTROLLER_ID
        });
    }

    function summarizePatient(patient, index) {
        if (!patient) return null;
        return {
            index,
            id: patient.id || '',
            patDk: patient.patDk || '',
            name: patient.name || '',
            status: patient.status || '',
            error: patient.error || '',
            report: patient.report || null
        };
    }

    /************************************************************
     * SCAN DES PATIENTS DE LA LISTE
     ************************************************************/

    function cleanPatientName(text, patientId) {
        let name = normalizeText(text)
            .replace(/\bPatDk\s*=\s*\S+/ig, ' ')
            .replace(/\bPatientViewForm\.aspx\b/ig, ' ')
            .replace(/\bFolderMedical\b/ig, ' ')
            .replace(/\bjavascript:.*$/ig, ' ')
            .replace(/\bouvrir le dossier\b/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!name || name.length < 2 || /^(ouvrir|patient)$/i.test(name)) {
            name = `Patient ${patientId}`;
        }
        return limitText(name, 90);
    }

    function findPatientRow(link) {
        if (!link || !link.closest) return null;
        return link.closest('tr, li, [role="row"], .row');
    }

    function extractWindowOpenUrl(raw) {
        const text = decodeHtmlAttribute(raw);
        const match = text.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
        return match ? match[1] : '';
    }

    function normalizePatientOpenUrl(rawUrl, link) {
        const candidate = decodeHtmlAttribute(rawUrl);
        if (!candidate || /^javascript:/i.test(candidate)) return '';
        try {
            const base = link && link.ownerDocument && link.ownerDocument.location ? link.ownerDocument.location.href : window.location.href;
            const url = new URL(candidate, base);
            if (!/\/foldermedical\/patientviewform\.aspx/i.test(url.pathname)) return '';
            if (!extractPatDk(url.href)) return '';
            return url.href;
        } catch (_) {
            return '';
        }
    }

    function extractPatientOpenUrlFromLink(link) {
        if (!link) return '';
        const openedUrl = extractWindowOpenUrl(link.getAttribute('onclick') || '');
        const normalizedOpenedUrl = normalizePatientOpenUrl(openedUrl, link);
        if (normalizedOpenedUrl) return normalizedOpenedUrl;
        return normalizePatientOpenUrl(link.getAttribute('href') || '', link);
    }

    function parsePatientGotoPostBack(link) {
        if (!link) return null;
        return parsePostBackTarget(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`);
    }

    function looksLikePatientGotoLink(link) {
        if (!link) return false;
        const patientUrl = extractPatientOpenUrlFromLink(link);
        if (!patientUrl) return false;

        const parsed = parsePatientGotoPostBack(link);
        const idName = lowerText(`${link.id || ''} ${link.name || ''}`);
        const target = lowerText(parsed && parsed.target);
        const raw = lowerText(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''} ${link.getAttribute('title') || ''} ${getElementText(link)}`);

        if (idName.includes('patientsgrid') && idName.includes('linkbuttongridgotopatient')) return true;
        if (target.includes('patientsgrid') && target.includes('linkbuttongridgotopatient')) return true;
        if (raw.includes('linkbuttongridgotopatient')) return true;
        if (raw.includes('ouvrir le dossier') && lowerText(getElementText(link)) === 'patient') return true;
        if (/\/foldermedical\/patientviewform\.aspx/i.test(patientUrl)) return true;

        return false;
    }

    function looksLikePatientPostBackLink(link, parsedPostBack) {
        if (!link || !parsedPostBack || !parsedPostBack.target) return false;
        const idName = lowerText(`${link.id || ''} ${link.name || ''}`);
        const target = lowerText(parsedPostBack.target);
        const raw = lowerText(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`);

        if (idName.includes('patientsgrid') && idName.includes('linkbuttonpatientgetnomprenom')) return true;
        if (target.includes('patientsgrid') && target.includes('linkbuttonpatientgetnomprenom')) return true;
        if (raw.includes('patientsgrid') && raw.includes('linkbuttonpatientgetnomprenom')) return true;
        return false;
    }

    function rowHasPatientOpenLink(link) {
        const row = findPatientRow(link);
        if (!row) return false;
        const candidates = row.querySelectorAll('a[href], a[onclick]');
        for (const candidate of candidates) {
            if (extractPatientOpenUrlFromLink(candidate)) return true;
        }
        return false;
    }

    function extractPatientNameFromLink(link, patientId) {
        const row = findPatientRow(link);
        if (row) {
            const nameLink = row.querySelector('[id*="LinkButtonPatientGetNomPrenom"], a[href*="LinkButtonPatientGetNomPrenom"], a[onclick*="LinkButtonPatientGetNomPrenom"]');
            if (nameLink) {
                const name = cleanPatientName(getElementText(nameLink), patientId);
                if (!/^Patient\s+/i.test(name)) return name;
            }
            const rowName = cleanPatientName(getElementText(row), patientId);
            if (rowName && !/^Patient\s+/i.test(rowName)) return rowName;
        }
        return cleanPatientName(getElementText(link), patientId);
    }

    function buildPostBackPatientId(parsedPostBack) {
        return `postback:${parsedPostBack.target}`;
    }

    function upsertScannedPatient(found, patient) {
        if (!patient || !patient.id) return;
        const existing = found.get(patient.id);
        if (!existing) {
            found.set(patient.id, patient);
            return;
        }

        const priority = { patient_link: 3, url: 2, postback: 1 };
        if ((priority[patient.entryMode] || 0) >= (priority[existing.entryMode] || 0)) {
            found.set(patient.id, Object.assign({}, existing, patient, {
                status: existing.status || patient.status || 'pending',
                startedAt: existing.startedAt || null,
                finishedAt: existing.finishedAt || null,
                error: existing.error || null,
                report: existing.report || null
            }));
        }
    }

    function scanPatientsFromPage() {
        const found = new Map();
        const links = queryAllDeep('a[href], a[onclick]');
        const sourceUrl = getCurrentPageUrlWithoutHash();

        for (const link of links) {
            if (!looksLikePatientGotoLink(link)) continue;
            const patientUrl = extractPatientOpenUrlFromLink(link);
            const patientId = extractPatDk(patientUrl);
            if (!patientId) continue;
            const parsed = parsePatientGotoPostBack(link) || {};
            upsertScannedPatient(found, {
                id: patientId,
                patDk: patientId,
                entryMode: 'patient_link',
                name: extractPatientNameFromLink(link, patientId),
                url: patientUrl,
                sourceUrl,
                patientUrl,
                gotoLinkId: link.id || '',
                gotoPostbackTarget: parsed.target || '',
                gotoPostbackArgument: parsed.argument || '',
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                error: null,
                report: null
            });
        }

        for (const link of links) {
            const rawHref = link.getAttribute('href') || '';
            const patientOpenUrl = extractPatientOpenUrlFromLink(link);
            let absoluteHref = rawHref;
            try { absoluteHref = new URL(rawHref, link.ownerDocument.location.href).href; } catch (_) {}

            const patientId = extractPatDk(patientOpenUrl) || extractPatDk(rawHref) || extractPatDk(absoluteHref);
            if (!patientId) continue;

            const hrefText = lowerText(`${patientOpenUrl} ${rawHref} ${absoluteHref} ${link.getAttribute('onclick') || ''}`);
            if (!hrefText.includes('patientviewform.aspx') && !hrefText.includes('foldermedical') && !hrefText.includes('patdk=')) continue;

            upsertScannedPatient(found, {
                id: patientId,
                patDk: patientId,
                entryMode: patientOpenUrl ? 'patient_link' : 'url',
                name: extractPatientNameFromLink(link, patientId),
                url: patientOpenUrl || buildPatientUrl(patientId),
                sourceUrl: patientOpenUrl ? sourceUrl : '',
                patientUrl: patientOpenUrl || '',
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                error: null,
                report: null
            });
        }

        for (const link of links) {
            const parsed = parsePostBackTarget(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`);
            if (!looksLikePatientPostBackLink(link, parsed)) continue;
            if (rowHasPatientOpenLink(link)) continue;

            const patientId = buildPostBackPatientId(parsed);
            if (!patientId || found.has(patientId)) continue;
            found.set(patientId, {
                id: patientId,
                patDk: '',
                entryMode: 'postback',
                postbackTarget: parsed.target,
                postbackArgument: parsed.argument || '',
                name: extractPatientNameFromLink(link, patientId),
                url: sourceUrl,
                sourceUrl,
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                error: null,
                report: null
            });
        }

        return Array.from(found.values());
    }

    function mergeScannedPatients(scanned) {
        const previousById = new Map(getQueue().map(patient => [String(patient.id), patient]));
        return scanned.map(patient => {
            const previous = previousById.get(String(patient.id));
            if (!previous) return patient;
            return Object.assign({}, patient, {
                status: previous.status === 'running' ? 'pending' : (previous.status || 'pending'),
                startedAt: previous.startedAt || null,
                finishedAt: previous.finishedAt || null,
                error: previous.error || null,
                report: previous.report || null,
                excludedByResume: previous.excludedByResume || false
            });
        });
    }

    function scanAndStorePatients() {
        const state = getState();
        if (ACTIVE_STATUSES.has(state.status) && state.runningPatientId) {
            addLog('warn', 'Scan ignore : un batch est deja en cours.', null, { status: state.status });
            return getQueue();
        }

        setState({ status: 'scanning' });
        const scanned = scanPatientsFromPage();
        const queue = mergeScannedPatients(scanned);
        saveQueue(queue);
        setState({
            status: queue.length ? 'ready' : 'idle',
            runningPatientId: '',
            finishedAt: null,
            pauseRequested: false,
            stopRequested: false,
            resumeFromIndex: null,
            resumeFromPatientId: ''
        });

        addLog(queue.length ? 'success' : 'warn', `${queue.length} patient(s) detecte(s).`, null, {
            count: queue.length,
            patients: queue.slice(0, 20).map((patient, index) => summarizePatient(patient, index))
        });

        if (!queue.length) alert('Aucun patient detecte sur cette page.');
        return queue;
    }

    /************************************************************
     * PANNEAU VISUEL
     ************************************************************/

    function shouldShowPanel() {
        if (!isWeda()) return false;
        if (getWorkerInfoFromHash()) return false;
        if (/\/FolderMedical\/PatientViewForm\.aspx/i.test(window.location.pathname || '')) return false;
        if (/Antecedent/i.test(window.location.href || '')) return false;
        return true;
    }

    function installPanel() {
        if (!shouldShowPanel()) {
            removePanel();
            return;
        }

        if (document.getElementById(PANEL_ID)) {
            renderPanel();
            return;
        }

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.position = 'fixed';
        panel.style.left = '14px';
        panel.style.bottom = '14px';
        panel.style.zIndex = '2147483647';
        panel.style.width = '252px';
        panel.style.boxSizing = 'border-box';
        panel.style.background = '#102f4e';
        panel.style.color = '#ffffff';
        panel.style.border = '1px solid rgba(255,255,255,0.22)';
        panel.style.borderRadius = '8px';
        panel.style.padding = '10px';
        panel.style.boxShadow = '0 8px 26px rgba(0,0,0,0.28)';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.fontSize = '12px';
        panel.style.lineHeight = '1.35';

        panel.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;">',
            '<strong style="font-size:13px;">Supp. med. barrés</strong>',
            `<span style="opacity:.78;font-size:10px;">v${VERSION}</span>`,
            '</div>',
            '<div data-field="detected"></div>',
            '<div data-field="remaining"></div>',
            '<div data-field="current"></div>',
            '<div data-field="success"></div>',
            '<div data-field="skipped"></div>',
            '<div data-field="errors"></div>',
            '<div data-field="status" style="margin-bottom:8px;"></div>',
            '<select data-control="resume-select" title="Patient de reprise" style="width:100%;box-sizing:border-box;margin:0 0 6px 0;padding:6px;border:0;border-radius:6px;font-size:12px;"></select>',
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">',
            '<button type="button" data-action="scan">Scanner</button>',
            '<button type="button" data-action="start">Lancer</button>',
            '<button type="button" data-action="resume-from" style="grid-column:1 / -1;">Reprendre au patient choisi</button>',
            '<button type="button" data-action="pause">Pause</button>',
            '<button type="button" data-action="stop">Stop</button>',
            '<button type="button" data-action="logs">Logs</button>',
            '<button type="button" data-action="clear">Reset</button>',
            '</div>'
        ].join('');

        for (const btn of panel.querySelectorAll('button')) {
            btn.style.border = '0';
            btn.style.borderRadius = '6px';
            btn.style.padding = '6px 7px';
            btn.style.background = '#ffffff';
            btn.style.color = '#102f4e';
            btn.style.fontWeight = '700';
            btn.style.fontSize = '12px';
            btn.style.cursor = 'pointer';
        }

        panel.addEventListener('click', event => {
            const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            const action = button.getAttribute('data-action');
            if (action === 'scan') scanAndStorePatients();
            if (action === 'start') startBatch();
            if (action === 'resume-from') resumeFromSelectedPatient();
            if (action === 'pause') togglePauseResume();
            if (action === 'stop') stopBatch();
            if (action === 'logs') showLogs();
            if (action === 'clear') clearBatchData();
        }, true);

        document.documentElement.appendChild(panel);
        renderPanel();
    }

    function removePanel() {
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.remove();
    }

    function setPanelText(panel, field, text) {
        const el = panel.querySelector(`[data-field="${field}"]`);
        if (el) el.textContent = text;
    }

    function renderPanel() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        const queue = getQueue();
        const counts = countQueue(queue);
        const state = getState();
        const runningPatient = queue.find(patient => patient && patient.id === state.runningPatientId) || queue.find(patient => patient && patient.status === 'running');
        const suffix = state.pauseRequested ? ' (pause demandee)' : (state.stopRequested ? ' (stop demande)' : '');

        setPanelText(panel, 'detected', `Detectes : ${counts.total}`);
        setPanelText(panel, 'remaining', `Restants : ${counts.activeRemaining} / ${counts.activeTotal}`);
        setPanelText(panel, 'current', `En cours : ${runningPatient ? `${runningPatient.name || 'Patient'} / ${runningPatient.patDk || runningPatient.id}` : '-'}`);
        setPanelText(panel, 'success', `Clics effectues : ${counts.success}`);
        setPanelText(panel, 'skipped', `Bouton absent : ${counts.skipped}`);
        setPanelText(panel, 'errors', `Erreurs : ${counts.errors}`);
        setPanelText(panel, 'status', `Statut : ${state.status || 'idle'}${suffix}`);

        const pauseBtn = panel.querySelector('[data-action="pause"]');
        if (pauseBtn) pauseBtn.textContent = state.status === 'paused' ? 'Reprendre' : 'Pause';

        renderResumeSelect(panel, queue);
    }

    function renderResumeSelect(panel, queue) {
        const select = panel.querySelector('[data-control="resume-select"]');
        if (!select) return;
        const signature = queue.map((patient, index) => `${index}:${patient.id}:${patient.name}:${patient.status}`).join('|');
        if (select.getAttribute('data-signature') === signature) return;

        const previous = select.value;
        select.setAttribute('data-signature', signature);
        select.innerHTML = '';

        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = queue.length ? 'Choisir un patient...' : 'Scanner d\'abord';
        select.appendChild(empty);

        queue.forEach((patient, index) => {
            const option = document.createElement('option');
            option.value = patient.id;
            option.textContent = `${index + 1}. ${patient.name || patient.id} (${patient.status || 'pending'})`;
            select.appendChild(option);
        });

        if (previous && Array.from(select.options).some(option => option.value === previous)) select.value = previous;
    }

    function getSelectedResumePatientId() {
        const panel = document.getElementById(PANEL_ID);
        const select = panel && panel.querySelector('[data-control="resume-select"]');
        return select ? select.value : '';
    }

    function showBadge(message, options = {}) {
        try {
            const old = document.getElementById(BADGE_ID);
            if (old) old.remove();
            const badge = document.createElement('div');
            badge.id = BADGE_ID;
            badge.textContent = message;
            badge.style.position = 'fixed';
            badge.style.left = '14px';
            badge.style.bottom = options.abovePanel ? '142px' : '14px';
            badge.style.zIndex = '2147483647';
            badge.style.maxWidth = '560px';
            badge.style.whiteSpace = 'pre-wrap';
            badge.style.background = options.error ? '#7a1020' : '#193f5c';
            badge.style.color = '#fff';
            badge.style.fontFamily = 'Arial, sans-serif';
            badge.style.fontSize = '13px';
            badge.style.fontWeight = '700';
            badge.style.lineHeight = '1.35';
            badge.style.padding = '10px 12px';
            badge.style.borderRadius = '8px';
            badge.style.boxShadow = '0 6px 20px rgba(0,0,0,.28)';
            badge.style.pointerEvents = 'none';
            document.documentElement.appendChild(badge);
            const duration = options.duration === undefined ? 6000 : Number(options.duration || 0);
            if (duration > 0) setTimeout(() => { try { badge.remove(); } catch (_) {} }, duration);
        } catch (_) {}
    }

    function refreshLogPanel() {
        const panel = document.getElementById(LOG_PANEL_ID);
        if (!panel) return;
        renderLogPanelContent(panel);
    }

    function showLogs() {
        let panel = document.getElementById(LOG_PANEL_ID);
        if (!panel) {
            panel = document.createElement('div');
            panel.id = LOG_PANEL_ID;
            panel.style.position = 'fixed';
            panel.style.inset = '22px 22px auto auto';
            panel.style.width = 'min(980px, calc(100vw - 44px))';
            panel.style.maxHeight = 'calc(100vh - 44px)';
            panel.style.overflow = 'auto';
            panel.style.zIndex = '2147483647';
            panel.style.background = '#ffffff';
            panel.style.color = '#1f2328';
            panel.style.border = '1px solid #d0d7de';
            panel.style.borderRadius = '10px';
            panel.style.boxShadow = '0 14px 42px rgba(0,0,0,0.28)';
            panel.style.font = '13px Arial, sans-serif';
            panel.addEventListener('click', async event => {
                const button = event.target && event.target.closest ? event.target.closest('button[data-log-action]') : null;
                if (!button) return;
                const action = button.getAttribute('data-log-action');
                if (action === 'close') panel.remove();
                if (action === 'clear') clearLogs();
                if (action === 'copy') {
                    const text = JSON.stringify(getLogs(), null, 2);
                    const ok = await copyTextToClipboard(text);
                    showBadge(ok ? 'Logs copies.' : 'Copie impossible.', { error: !ok, abovePanel: true });
                }
            }, true);
            document.documentElement.appendChild(panel);
        }
        renderLogPanelContent(panel);
        return getLogs();
    }

    function renderLogPanelContent(panel) {
        const logs = getLogs().slice().reverse();
        const rows = logs.length ? logs.map(entry => {
            const level = String(entry.level || 'info').toLowerCase();
            const color = level === 'error' ? '#b3261e' : (level === 'warn' ? '#9a6700' : (level === 'success' ? '#116329' : '#185abc'));
            const patient = entry.patientName || entry.patientId || '';
            return '<div style="border:1px solid #d0d7de;border-radius:8px;margin:8px 0;padding:10px;background:#fff">' +
                '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                '<strong style="color:' + color + '">' + escapeHtml(level.toUpperCase()) + '</strong>' +
                '<span style="font-family:Consolas,monospace;font-size:12px;color:#57606a">' + escapeHtml(entry.at || '') + '</span>' +
                (patient ? '<span style="color:#57606a">' + escapeHtml(patient) + '</span>' : '') +
                '</div>' +
                '<div style="margin-top:6px">' + escapeHtml(entry.message || '') + '</div>' +
                (entry.details ? '<details style="margin-top:6px"><summary style="cursor:pointer;color:#185abc">Details</summary><pre style="white-space:pre-wrap;background:#f6f8fa;padding:8px;border-radius:6px;max-height:280px;overflow:auto">' + escapeHtml(safePrettyJson(entry.details)) + '</pre></details>' : '') +
                '</div>';
        }).join('') : '<div style="padding:12px;background:#f6f8fa;border-radius:8px">Aucun log.</div>';

        panel.innerHTML =
            '<div style="position:sticky;top:0;background:#102f4e;color:#fff;padding:12px 14px;display:flex;gap:8px;align-items:center;z-index:1">' +
            '<strong style="flex:1">Journal suppression medicaments barres</strong>' +
            '<button type="button" data-log-action="copy" style="border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Copier</button>' +
            '<button type="button" data-log-action="clear" style="border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Effacer</button>' +
            '<button type="button" data-log-action="close" style="border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Fermer</button>' +
            '</div><div style="padding:14px">' + rows + '</div>';
    }

    async function copyTextToClipboard(text) {
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text, 'text');
                return true;
            }
        } catch (_) {}
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.documentElement.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            textarea.remove();
            return !!ok;
        } catch (_) {
            return false;
        }
    }

    /************************************************************
     * CONTROLEUR BATCH
     ************************************************************/

    function normalizeQueueBeforeStart(queue) {
        const seen = new Set();
        const clean = [];
        for (const patient of queue) {
            if (!patient || !patient.id) continue;
            if (seen.has(String(patient.id))) continue;
            seen.add(String(patient.id));
            const next = Object.assign({}, patient);
            if (next.status === 'running') next.status = 'pending';
            if (!next.status) next.status = 'pending';
            if (!next.url) next.url = next.patientUrl || (next.patDk ? buildPatientUrl(next.patDk) : getCurrentPageUrlWithoutHash());
            clean.push(next);
        }
        return clean;
    }

    function hasPendingPatient(queue) {
        return queue.some(patient => patient && patient.id && patient.status === 'pending' && !patient.excludedByResume);
    }

    function getNextPendingPatientIndex(queue) {
        return queue.findIndex(patient => patient && patient.id && patient.status === 'pending' && !patient.excludedByResume);
    }

    function getRunningPatient(queue) {
        return queue.find(patient => patient && patient.status === 'running') || null;
    }

    async function startBatch() {
        let queue = normalizeQueueBeforeStart(getQueue());
        if (!queue.length) queue = normalizeQueueBeforeStart(scanAndStorePatients());
        if (!queue.length) {
            alert('Aucun patient detecte sur cette page.');
            return [];
        }
        if (!hasPendingPatient(queue)) {
            alert('Aucun patient en attente. Utilise Reset ou Reprendre si besoin.');
            return queue;
        }

        const pendingCount = queue.filter(patient => patient && patient.status === 'pending' && !patient.excludedByResume).length;
        if (pendingCount > 10 && !confirm(`Lancer la suppression des medicaments barres pour ${pendingCount} patients ?`)) {
            addLog('warn', 'Demarrage annule par utilisateur.', null, { pendingCount });
            return queue;
        }

        saveQueue(queue);
        const previous = getState();
        const batchId = previous.status === 'paused' && previous.batchId ? previous.batchId : makeBatchId();

        if (!acquireControllerLock(batchId)) {
            alert('Un batch semble deja pilote par un autre onglet.');
            addLog('warn', 'Demarrage bloque par le verrou controleur.', null, { batchId });
            return queue;
        }

        gmDelete(KEY_RESULT);
        gmDelete(KEY_CURRENT);
        setCommand('start', { batchId });
        setState({
            batchId,
            status: 'running',
            startedAt: previous.startedAt || nowMs(),
            finishedAt: null,
            runningPatientId: '',
            pauseRequested: false,
            stopRequested: false
        });
        addLog('success', 'Batch lance.', null, { batchId, pendingCount });
        showBadge('Batch suppression des medicaments barres lance.', { abovePanel: true });
        processNextPatient();
        return queue;
    }

    function acquireControllerLock(batchId) {
        const lock = gmGetJson(KEY_LOCK, null);
        const now = nowMs();
        if (lock && lock.controllerId && lock.controllerId !== CONTROLLER_ID && Number(lock.expiresAt || 0) > now) return false;
        renewControllerLock(batchId);
        if (runtime.lockTimer) clearInterval(runtime.lockTimer);
        runtime.lockTimer = setInterval(() => renewControllerLock(batchId), Math.max(5000, CONTROLLER_LOCK_TTL_MS / 3));
        return true;
    }

    function renewControllerLock(batchId) {
        gmSetJson(KEY_LOCK, {
            controllerId: CONTROLLER_ID,
            batchId,
            ts: nowMs(),
            expiresAt: nowMs() + CONTROLLER_LOCK_TTL_MS
        });
    }

    function releaseControllerLock() {
        if (runtime.lockTimer) {
            clearInterval(runtime.lockTimer);
            runtime.lockTimer = null;
        }
        const lock = gmGetJson(KEY_LOCK, null);
        if (lock && lock.controllerId === CONTROLLER_ID) gmDelete(KEY_LOCK);
    }

    async function processNextPatient() {
        if (runtime.processing) return;
        runtime.processing = true;

        try {
            while (true) {
                const state = getState();

                if (state.stopRequested || state.status === 'stopped') {
                    setState({ status: 'stopped', runningPatientId: '', finishedAt: nowMs() });
                    addLog('warn', 'Batch stoppe.');
                    break;
                }

                if (state.pauseRequested || state.status === 'paused') {
                    setState({ status: 'paused', runningPatientId: '' });
                    addLog('info', 'Batch en pause.');
                    break;
                }

                let queue = getQueue();
                const running = getRunningPatient(queue);
                if (running) {
                    const pendingResult = gmGetJson(KEY_RESULT, null);
                    if (pendingResult && pendingResult.batchId === state.batchId && pendingResult.patientId === running.id) {
                        applyPatientOutcomeToQueue(running.id, pendingResult, running);
                        gmDelete(KEY_RESULT);
                        setState({ status: 'next_patient', runningPatientId: '' });
                        continue;
                    }
                    addLog('warn', 'Patient deja en cours : attente.', running);
                    break;
                }

                const nextIndex = getNextPendingPatientIndex(queue);
                if (nextIndex < 0) {
                    const counts = countQueue(queue);
                    setState({ status: 'finished', runningPatientId: '', finishedAt: nowMs() });
                    addLog('success', 'Batch termine.', null, counts);
                    showBadge(`Batch termine. Clics : ${counts.success}. Bouton absent : ${counts.skipped}. Erreurs : ${counts.errors}.`, {
                        duration: 12000,
                        abovePanel: true,
                        error: counts.errors > 0
                    });
                    alert(`Batch termine.\nClics effectues : ${counts.success}\nBouton absent : ${counts.skipped}\nErreurs : ${counts.errors}`);
                    break;
                }

                const patient = queue[nextIndex];
                const batchId = state.batchId || makeBatchId();
                const patientStart = nowMs();

                queue[nextIndex] = Object.assign({}, patient, {
                    status: 'running',
                    startedAt: patientStart,
                    finishedAt: null,
                    error: null,
                    report: null
                });
                saveQueue(queue);
                setState({ batchId, status: 'opening_patient', runningPatientId: patient.id });
                addLog('info', 'Debut patient.', patient, { index: nextIndex, batchId });

                let worker = null;
                let outcome = null;
                try {
                    worker = openPatientWorker(patient, batchId);
                    outcome = await waitForWorkerOutcome(patient, batchId, worker, patientStart);
                } catch (e) {
                    outcome = {
                        batchId,
                        patientId: patient.id,
                        status: 'error',
                        message: e && e.message ? e.message : String(e),
                        ts: nowMs(),
                        report: { stage: 'controller_exception' }
                    };
                }

                setState({ status: 'closing_worker', runningPatientId: patient.id });
                closeWorkerTab(worker);
                applyPatientOutcomeToQueue(patient.id, outcome, patient);
                gmDelete(KEY_RESULT);
                setState({ status: 'next_patient', runningPatientId: '' });
                await sleep(NEXT_PATIENT_DELAY_MS);
            }
        } finally {
            runtime.processing = false;
            releaseControllerLock();
            renderPanel();
        }
    }

    function buildWorkerUrl(patient, batchId) {
        const baseUrl = patient.patientUrl || patient.url || (patient.patDk ? buildPatientUrl(patient.patDk) : getCurrentPageUrlWithoutHash());
        const base = String(baseUrl).split('#')[0];
        return `${base}#${WORKER_HASH_PREFIX}${encodeURIComponent(batchId)}&patient=${encodeURIComponent(patient.id)}`;
    }

    function openPatientWorker(patient, batchId) {
        const url = buildWorkerUrl(patient, batchId);
        gmSetJson(KEY_CURRENT, {
            batchId,
            patientId: patient.id,
            patientName: patient.name || '',
            patient,
            url,
            openedAt: nowMs(),
            openedBy: CONTROLLER_ID
        });
        gmDelete(KEY_RESULT);

        let tab = null;
        try {
            tab = GM_openInTab(url, { active: OPEN_WORKER_ACTIVE, insert: OPEN_WORKER_INSERT, setParent: true });
        } catch (_) {
            tab = GM_openInTab(url, OPEN_WORKER_ACTIVE);
        }
        addLog('info', 'Ouverture worker.', patient, { url, active: OPEN_WORKER_ACTIVE });
        return { tab, url, closed: false };
    }

    function closeWorkerTab(worker) {
        if (!worker || !worker.tab) return;
        try { if (typeof worker.tab.close === 'function') worker.tab.close(); } catch (_) {}
        try {
            if (worker.tab && !worker.tab.closed && worker.tab.location) worker.tab.location.replace('about:blank');
        } catch (_) {}
        try { if (typeof worker.tab.close === 'function') worker.tab.close(); } catch (_) {}
        worker.closed = true;
    }

    async function waitForWorkerOutcome(patient, batchId, worker, launchedAt) {
        let tabClosed = false;
        let lastHeartbeat = null;
        try {
            if (worker && worker.tab && 'onclose' in worker.tab) {
                worker.tab.onclose = () => {
                    tabClosed = true;
                    worker.closed = true;
                };
            }
        } catch (_) {}

        setState({ status: 'waiting_patient_page', runningPatientId: patient.id });

        while (nowMs() - launchedAt < PATIENT_TIMEOUT_MS) {
            const result = gmGetJson(KEY_RESULT, null);
            if (result && result.batchId === batchId && result.patientId === patient.id && Number(result.ts || 0) >= launchedAt - 1000) {
                addLog(result.status === 'success' || result.status === 'skipped' ? 'success' : 'error', 'Resultat worker recu.', patient, { result });
                return result;
            }

            const heartbeat = gmGetJson(KEY_HEARTBEAT, null);
            if (heartbeat && heartbeat.batchId === batchId && heartbeat.patientId === patient.id && Number(heartbeat.ts || 0) >= launchedAt - 1000) {
                lastHeartbeat = heartbeat;
                mirrorWorkerStatusToState(heartbeat.status, patient.id);
            }

            if (tabClosed && !lastHeartbeat) {
                return {
                    batchId,
                    patientId: patient.id,
                    status: 'error',
                    message: 'Onglet worker ferme avant demarrage.',
                    ts: nowMs(),
                    report: { stage: 'worker_closed_before_start' }
                };
            }

            if (lastHeartbeat && nowMs() - Number(lastHeartbeat.ts || 0) > HEARTBEAT_STALE_MS) {
                addLog('warn', 'Heartbeat worker en retard.', patient, { heartbeatAgeMs: nowMs() - Number(lastHeartbeat.ts || 0), lastHeartbeat });
            }

            const signaled = await waitForWorkerResultSignal(batchId, patient.id, launchedAt, 800);
            if (signaled) return signaled;
        }

        return {
            batchId,
            patientId: patient.id,
            status: 'timeout',
            message: 'Timeout patient.',
            ts: nowMs(),
            report: { stage: 'patient_timeout', lastHeartbeat }
        };
    }

    function waitForWorkerResultSignal(batchId, patientId, launchedAt, timeoutMs) {
        return new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                if (runtime.resultWaiter && runtime.resultWaiter.resolve === finish) runtime.resultWaiter = null;
                resolve(null);
            }, timeoutMs);

            function finish(result) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (runtime.resultWaiter && runtime.resultWaiter.resolve === finish) runtime.resultWaiter = null;
                resolve(result || null);
            }

            runtime.resultWaiter = { batchId, patientId, launchedAt, resolve: finish };
        });
    }

    function signalWorkerResultIfWaiting(result) {
        const waiter = runtime.resultWaiter;
        if (!waiter || !result) return false;
        if (result.batchId === waiter.batchId && result.patientId === waiter.patientId && Number(result.ts || 0) >= waiter.launchedAt - 1000) {
            waiter.resolve(result);
            return true;
        }
        return false;
    }

    function mirrorWorkerStatusToState(status, patientId) {
        if (!status) return;
        const allowed = new Set(['waiting_patient_page', 'going_to_antecedents', 'clicking_delete_button', 'waiting_delete_done']);
        if (allowed.has(status)) setState({ status, runningPatientId: patientId });
    }

    function normalizeOutcomeStatus(status) {
        if (status === 'success') return 'success';
        if (status === 'skipped') return 'skipped';
        if (status === 'timeout') return 'timeout';
        return 'error';
    }

    function applyPatientOutcomeToQueue(patientId, outcome, patientForLog) {
        if (!patientId || !outcome) return false;
        const queue = getQueue();
        const index = queue.findIndex(patient => patient && patient.id === patientId);
        if (index < 0) return false;

        const normalizedStatus = normalizeOutcomeStatus(outcome.status);
        queue[index] = Object.assign({}, queue[index], {
            status: normalizedStatus,
            finishedAt: nowMs(),
            error: normalizedStatus === 'success' || normalizedStatus === 'skipped' ? null : (outcome.message || 'Erreur inconnue'),
            report: outcome.report || null,
            batchResultId: outcome.resultId || ''
        });
        saveQueue(queue);

        addLog(normalizedStatus === 'success' || normalizedStatus === 'skipped' ? 'success' : 'error', outcome.message || `Patient termine : ${normalizedStatus}`, patientForLog || queue[index], { outcome });
        return true;
    }

    function pauseBatch() {
        const state = getState();
        setCommand('pause');
        const hasCurrent = !!state.runningPatientId || ACTIVE_STATUSES.has(state.status);
        setState(hasCurrent ? { pauseRequested: true } : { status: 'paused', pauseRequested: true, runningPatientId: '' });
        addLog('info', 'Pause demandee.');
        return getState();
    }

    function resumeBatch() {
        const state = getState();
        if (!state.batchId) return startBatch();
        setCommand('resume');
        if (!acquireControllerLock(state.batchId)) {
            alert('Un batch semble deja pilote par un autre onglet.');
            return getState();
        }
        setState({ status: 'running', pauseRequested: false, stopRequested: false, finishedAt: null });
        addLog('info', 'Batch repris.');
        processNextPatient();
        return getState();
    }

    function togglePauseResume() {
        const state = getState();
        if (state.status === 'paused') return resumeBatch();
        return pauseBatch();
    }

    function stopBatch() {
        const state = getState();
        setCommand('stop');
        const hasCurrent = !!state.runningPatientId || ACTIVE_STATUSES.has(state.status);
        setState(hasCurrent ? { stopRequested: true } : { status: 'stopped', stopRequested: true, runningPatientId: '', finishedAt: nowMs() });
        addLog('warn', hasCurrent ? 'Stop demande apres le patient courant.' : 'Batch stoppe.');
        return getState();
    }

    function resumeFromSelectedPatient() {
        const patientId = getSelectedResumePatientId();
        if (!patientId) {
            alert('Choisis un patient dans la liste de reprise.');
            return getState();
        }
        return resumeFromPatient(patientId, true);
    }

    function resumeFromPatient(selector, autoStart = true) {
        let queue = normalizeQueueBeforeStart(getQueue());
        if (!queue.length) queue = normalizeQueueBeforeStart(scanAndStorePatients());
        if (!queue.length) return [];

        const needle = lowerText(selector);
        const selectedIndex = queue.findIndex(patient => lowerText(patient.id) === needle || lowerText(patient.patDk) === needle || lowerText(patient.name).includes(needle));
        if (selectedIndex < 0) {
            alert('Patient de reprise introuvable.');
            return queue;
        }

        queue = queue.map((patient, index) => {
            const next = Object.assign({}, patient);
            if (index < selectedIndex) {
                next.excludedByResume = true;
                if (!TERMINAL_STATUSES.has(next.status || 'pending')) next.status = 'skipped';
                next.finishedAt = next.finishedAt || nowMs();
                next.error = next.error || 'Ignore par reprise a un patient ulterieur.';
            } else {
                next.excludedByResume = false;
                next.status = 'pending';
                next.startedAt = null;
                next.finishedAt = null;
                next.error = null;
                next.report = null;
            }
            return next;
        });

        saveQueue(queue);
        setState({
            batchId: makeBatchId(),
            status: 'ready',
            runningPatientId: '',
            resumeFromIndex: selectedIndex,
            resumeFromPatientId: queue[selectedIndex].id,
            pauseRequested: false,
            stopRequested: false,
            startedAt: null,
            finishedAt: null
        });
        addLog('info', 'Reprise preparee.', queue[selectedIndex], { selectedIndex });
        return autoStart ? startBatch() : queue;
    }

    function clearBatchData() {
        [KEY_QUEUE, KEY_STATE, KEY_CURRENT, KEY_RESULT, KEY_HEARTBEAT, KEY_LOCK, KEY_COMMAND, KEY_LAST_REPORT, KEY_WORKER_ACTION].forEach(gmDelete);
        setState({ status: 'idle', runningPatientId: '', pauseRequested: false, stopRequested: false });
        addLog('warn', 'Donnees batch reinitialisees.');
        renderPanel();
        return true;
    }

    /************************************************************
     * WORKER : NAVIGATION PATIENT -> ANTECEDENTS -> CLIC SUPPRESSION
     ************************************************************/

    function parseWorkerInfoFromHash() {
        const hash = String(window.location.hash || '').replace(/^#/, '');
        if (!hash || !hash.includes(WORKER_HASH_PREFIX)) return null;
        const batchMatch = hash.match(/(?:^|&)AUTO_SUPP_MED_BARRES_WORKER=([^&]+)/);
        const patientMatch = hash.match(/(?:^|&)patient=([^&]+)/);
        if (!batchMatch) return null;
        return {
            batchId: decodeURIComponent(batchMatch[1] || ''),
            patientId: patientMatch ? decodeURIComponent(patientMatch[1] || '') : '',
            hash
        };
    }

    function rememberWorkerInfo(info) {
        if (!info || !info.batchId || !info.patientId) return info || null;
        try {
            sessionStorage.setItem(SESSION_WORKER_INFO, JSON.stringify({
                batchId: info.batchId,
                patientId: info.patientId,
                rememberedAt: nowMs()
            }));
        } catch (_) {}
        return info;
    }

    function readRememberedWorkerInfo() {
        try {
            const info = parseMaybeJson(sessionStorage.getItem(SESSION_WORKER_INFO), null);
            if (!info || !info.batchId || !info.patientId) return null;
            const state = getState();
            const current = gmGetJson(KEY_CURRENT, null);
            const matchesCurrent = current && current.batchId === info.batchId && current.patientId === info.patientId;
            const matchesState = state && state.batchId === info.batchId && state.runningPatientId === info.patientId;
            if (!matchesCurrent && !matchesState) return null;
            return Object.assign({}, info, { remembered: true });
        } catch (_) {
            return null;
        }
    }

    function getWorkerInfoFromHash() {
        const fromHash = parseWorkerInfoFromHash();
        if (fromHash) return rememberWorkerInfo(fromHash);
        return readRememberedWorkerInfo();
    }

    function clearRememberedWorkerInfo() {
        try { sessionStorage.removeItem(SESSION_WORKER_INFO); } catch (_) {}
    }

    function makeWorkerActionKey(info) {
        if (!info || !info.batchId || !info.patientId) return '';
        return String(info.batchId) + '|' + String(info.patientId);
    }

    function readWorkerActionState(info) {
        if (!info || !info.batchId || !info.patientId) return null;
        const key = makeWorkerActionKey(info);

        // Stockage principal en GM_* : persiste mieux que sessionStorage lors des postbacks ASP.NET WEDA.
        const byGm = gmGetJson(KEY_WORKER_ACTION, null);
        if (byGm && byGm.key === key) return byGm;

        // Compatibilite avec les versions precedentes qui utilisaient sessionStorage.
        try {
            const bySession = parseMaybeJson(sessionStorage.getItem(SESSION_WORKER_ACTION), null);
            if (bySession && bySession.key === key) return bySession;
        } catch (_) {}

        return null;
    }

    function writeWorkerActionState(info, patch) {
        if (!info || !info.batchId || !info.patientId) return null;
        const current = readWorkerActionState(info) || {};
        const next = Object.assign({}, current, patch || {}, {
            key: makeWorkerActionKey(info),
            batchId: info.batchId,
            patientId: info.patientId,
            updatedAt: nowMs(),
            url: window.location.href
        });

        gmSetJson(KEY_WORKER_ACTION, next);
        try { sessionStorage.setItem(SESSION_WORKER_ACTION, JSON.stringify(next)); } catch (_) {}
        return next;
    }

    function clearWorkerActionState() {
        gmDelete(KEY_WORKER_ACTION);
        try { sessionStorage.removeItem(SESSION_WORKER_ACTION); } catch (_) {}
    }

    function hasTerminalResultForWorker(info) {
        if (!info || !info.batchId || !info.patientId) return false;
        const result = gmGetJson(KEY_RESULT, null);
        return !!(
            result &&
            result.batchId === info.batchId &&
            result.patientId === info.patientId &&
            TERMINAL_STATUSES.has(result.status)
        );
    }

    function getWorkerPatientDescriptor(info) {
        const current = gmGetJson(KEY_CURRENT, null);
        if (current && current.batchId === info.batchId && current.patientId === info.patientId) {
            if (current.patient && current.patient.id) return current.patient;
            return current;
        }
        const queue = getQueue();
        const found = queue.find(patient => patient && patient.id === info.patientId);
        if (found) return found;
        return { id: info.patientId, patDk: info.patientId, name: `Patient ${info.patientId}` };
    }

    function setWorkerStatus(status) {
        runtime.workerStatus = status || runtime.workerStatus;
        publishWorkerHeartbeat();
    }

    function publishWorkerHeartbeat() {
        const info = getWorkerInfoFromHash();
        if (!info) return;
        gmSetJson(KEY_HEARTBEAT, {
            batchId: info.batchId,
            patientId: info.patientId,
            url: window.location.href,
            status: runtime.workerStatus,
            clickedAt: runtime.clickedAt || null,
            ts: nowMs()
        });
    }

    function publishWorkerResult(status, message, report) {
        const info = getWorkerInfoFromHash();
        if (!info || runtime.resultPublished) return null;
        runtime.resultPublished = true;
        const result = {
            resultId: `result_${nowMs()}_${Math.floor(Math.random() * 1000000)}`,
            batchId: info.batchId,
            patientId: info.patientId,
            status,
            message,
            report: report || null,
            url: window.location.href,
            ts: nowMs()
        };
        gmSetJson(KEY_RESULT, result);
        gmSetJson(KEY_LAST_REPORT, result);
        clearWorkerActionState();
        addLog(status === 'success' || status === 'skipped' ? 'success' : 'error', message, { id: info.patientId }, { result });
        return result;
    }

    function closeCurrentWorkerSoon() {
        clearRememberedWorkerInfo();
        if (runtime.heartbeatTimer) {
            clearInterval(runtime.heartbeatTimer);
            runtime.heartbeatTimer = null;
        }
        setTimeout(() => {
            try { window.close(); } catch (_) {}
            try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.close(); } catch (_) {}
        }, WORKER_CLOSE_DELAY_MS);
    }

    async function runWorker() {
        const info = getWorkerInfoFromHash();
        if (!info || !info.batchId || !info.patientId) return;

        if (hasTerminalResultForWorker(info)) {
            clearRememberedWorkerInfo();
            setTimeout(() => { try { window.close(); } catch (_) {} }, 300);
            return;
        }

        if (window.__AUTO_SUPP_MED_BARRES_WORKER_RUNNING__) return;
        window.__AUTO_SUPP_MED_BARRES_WORKER_RUNNING__ = true;

        runtime.workerStatus = 'waiting_patient_page';
        runtime.clickedAt = null;
        runtime.resultPublished = false;
        publishWorkerHeartbeat();
        runtime.heartbeatTimer = setInterval(publishWorkerHeartbeat, HEARTBEAT_INTERVAL_MS);

        const patient = getWorkerPatientDescriptor(info);
        const patientForLog = { id: info.patientId, name: patient.name || '' };
        const startedAt = nowMs();

        try {
            addLog('info', 'Worker demarre.', patientForLog, { batchId: info.batchId, url: window.location.href, patient });

            const previousAction = readWorkerActionState(info);
            if (previousAction && /delete_(clicked|postback_sent)/.test(String(previousAction.stage || ''))) {
                setWorkerStatus('waiting_delete_done');
                addLog('info', 'Postback de suppression deja lance : finalisation du patient.', patientForLog, previousAction);
                await waitForWedaIdle(DELETE_ACTION_TIMEOUT_MS);
                await sleep(1200);
                publishWorkerResult('success', 'Bouton Supprimer tous les medicaments barres clique.', {
                    stage: 'delete_done_after_reload',
                    clicked: true,
                    method: previousAction.method || '',
                    postbackTarget: previousAction.postbackTarget || '',
                    postbackArgument: previousAction.postbackArgument || '',
                    clickedAt: previousAction.clickedAt || null,
                    elapsedMs: nowMs() - startedAt
                });
                return closeCurrentWorkerSoon();
            }

            setWorkerStatus('waiting_patient_page');
            const selected = await ensureWorkerPatientSelected(patient, patientForLog);
            if (!selected) {
                publishWorkerResult('timeout', 'Timeout : selection du patient impossible.', { stage: 'selecting_patient', patient });
                return closeCurrentWorkerSoon();
            }

            const expectedPatDk = getExpectedWorkerPatientId(patient, info.patientId);
            const patientReady = await waitFor(() => isPatientPageReady(expectedPatDk) || isAntecedentPageReady(), PAGE_LOAD_TIMEOUT_MS, 500);
            if (!patientReady) {
                publishWorkerResult('timeout', 'Timeout : page patient non chargee.', { stage: 'waiting_patient_page', expectedPatDk, url: window.location.href });
                return closeCurrentWorkerSoon();
            }

            setWorkerStatus('going_to_antecedents');
            const antecedentsReady = await ensureAntecedentsPage();
            if (!antecedentsReady) {
                publishWorkerResult('timeout', 'Timeout : page antecedents non atteinte.', { stage: 'going_to_antecedents', url: window.location.href });
                return closeCurrentWorkerSoon();
            }

            const currentPatDk = extractPatDk(window.location.href);
            const patientHasRealPatDk = patient && patient.patDk && !String(patient.patDk).startsWith('postback:');
            if (patientHasRealPatDk && currentPatDk && !samePatDk(patient.patDk, currentPatDk)) {
                publishWorkerResult('error', 'Securite patient : page antecedents sur un autre patient.', {
                    stage: 'patient_identity_guard',
                    expectedPatDk: patient.patDk,
                    currentPatDk,
                    url: window.location.href
                });
                return closeCurrentWorkerSoon();
            }

            setWorkerStatus('clicking_delete_button');
            const action = await clickDeleteCrossedMedsButton(info);
            runtime.clickedAt = nowMs();
            publishWorkerHeartbeat();

            if (action.clicked) {
                setWorkerStatus('waiting_delete_done');
                await waitForWedaIdle(DELETE_ACTION_TIMEOUT_MS);
                await sleep(900);
                publishWorkerResult('success', 'Bouton Supprimer tous les medicaments barres clique.', {
                    stage: 'delete_clicked',
                    clicked: true,
                    method: action.method,
                    elapsedMs: nowMs() - startedAt
                });
            } else {
                publishWorkerResult('skipped', 'Bouton Supprimer tous les medicaments barres introuvable : passage au patient suivant.', {
                    stage: 'delete_button_not_found',
                    clicked: false,
                    diagnostics: buildDeleteButtonDiagnostic(),
                    elapsedMs: nowMs() - startedAt
                });
            }

            return closeCurrentWorkerSoon();
        } catch (e) {
            publishWorkerResult('error', `Erreur worker : ${e && e.message ? e.message : String(e)}`, {
                stage: runtime.workerStatus,
                stack: e && e.stack ? String(e.stack).slice(0, 2000) : ''
            });
            return closeCurrentWorkerSoon();
        }
    }

    function getExpectedWorkerPatientId(patient, fallback = '') {
        return patient && (patient.patDk || (!String(patient.id || '').startsWith('postback:') ? patient.id : '')) || fallback || '';
    }

    function currentPageMatchesExpectedPatDk(expectedPatientId) {
        const expected = String(expectedPatientId || '').trim();
        if (!expected || expected.startsWith('postback:')) return true;
        const current = extractPatDk(window.location.href);
        return !!current && samePatDk(expected, current);
    }

    function isPatientPageReady(expectedPatientId) {
        if (!isWeda()) return false;
        const bodyReady = !!(document.body && normalizeText(document.body.innerText || document.body.textContent).length > 0);
        const urlReady = /\/foldermedical\/patientviewform\.aspx/i.test(window.location.pathname || '');
        return bodyReady && urlReady && currentPageMatchesExpectedPatDk(expectedPatientId);
    }

    function isAntecedentPageReady() {
        return !!queryAllDeep(SELECTOR_ANTECEDENT_ROOT).find(isVisible) || isStrongAntecedentsPage();
    }

    function isStrongAntecedentsPage() {
        const selectors = [
            '#ContentPlaceHolder1_UpdatePanelAntecedent',
            '#ContentPlaceHolder1_TextBoxAntecedentCommentaire',
            '[id$="_UpdatePanelAntecedent"]',
            '[id$="_TextBoxAntecedentCommentaire"]'
        ];
        for (const selector of selectors) {
            const found = queryAllDeep(selector).find(isVisible);
            if (found) return true;
        }
        return /antecedent/i.test(String(window.location.href || '').split('#')[0]);
    }

    function looksLikeAntecedentsPage() {
        if (isStrongAntecedentsPage()) return true;
        const candidates = queryAllDeep('[id*="Antecedent"], [name*="Antecedent"], [id*="ATCD"], [name*="ATCD"]');
        if (candidates.find(isVisible)) return true;
        const text = lowerText(document.body && (document.body.innerText || document.body.textContent));
        return text.includes('antecedents') || text.includes('atcd');
    }

    async function ensureWorkerPatientSelected(patient, patientForLog) {
        const expectedPatDk = getExpectedWorkerPatientId(patient);
        if (isAntecedentPageReady()) return currentPageMatchesExpectedPatDk(expectedPatDk);
        if (isPatientPageReady(expectedPatDk)) return true;

        if (patient && patient.entryMode === 'postback' && patient.postbackTarget) {
            const clickable = await waitFor(() => findPatientPostBackElement(patient), PAGE_LOAD_TIMEOUT_MS, 500);
            if (clickable) {
                clickElement(clickable);
            } else if (!callSpecificPostBack(patient.postbackTarget, patient.postbackArgument || '')) {
                return false;
            }
            return !!(await waitFor(() => isPatientPageReady(expectedPatDk) || isAntecedentPageReady(), PAGE_LOAD_TIMEOUT_MS, 500));
        }

        if (patient && patient.entryMode === 'patient_link') {
            const link = await waitFor(() => findPatientGotoElement(patient), 4000, 400);
            const liveUrl = link ? extractPatientOpenUrlFromLink(link) : '';
            const targetUrl = liveUrl || patient.patientUrl || patient.url || '';
            if (targetUrl && /patientviewform\.aspx/i.test(targetUrl) && !isPatientPageReady(expectedPatDk)) {
                window.location.href = appendWorkerHash(targetUrl, getWorkerInfoFromHash());
                return !!(await waitFor(() => isPatientPageReady(expectedPatDk) || isAntecedentPageReady(), PAGE_LOAD_TIMEOUT_MS, 500));
            }
        }

        return true;
    }

    function appendWorkerHash(url, info) {
        if (!info) return url;
        return `${String(url).split('#')[0]}#${WORKER_HASH_PREFIX}${encodeURIComponent(info.batchId)}&patient=${encodeURIComponent(info.patientId)}`;
    }

    function findPatientPostBackElement(patient) {
        if (!patient || !patient.postbackTarget) return null;
        const target = String(patient.postbackTarget);
        return queryAllDeep('a[href], a[onclick], input, button').find(el => {
            const raw = `${el.getAttribute && el.getAttribute('href') || ''} ${el.getAttribute && el.getAttribute('onclick') || ''} ${el.id || ''} ${el.name || ''}`;
            return raw.includes(target) && isVisible(el);
        }) || null;
    }

    function findPatientGotoElement(patient) {
        if (!patient) return null;
        if (patient.gotoLinkId) {
            const byId = queryOneDeep('#' + cssEscape(patient.gotoLinkId));
            if (byId && isVisible(byId)) return byId;
        }
        if (patient.patDk) {
            const links = queryAllDeep('a[href], a[onclick]');
            for (const link of links) {
                const url = extractPatientOpenUrlFromLink(link);
                if (url && samePatDk(extractPatDk(url), patient.patDk) && isVisible(link)) return link;
            }
        }
        return null;
    }

    function cssEscape(value) {
        try {
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        } catch (_) {}
        return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    async function ensureAntecedentsPage() {
        if (isAntecedentPageReady()) return true;

        await waitFor(() => queryAllDeep(SELECTOR_GOTO_ANTECEDENTS).find(isVisible) || getDoPostBack(), 10000, 500);

        const direct = queryAllDeep(SELECTOR_GOTO_ANTECEDENTS).find(isVisible);
        if (direct) {
            clickElement(direct);
            const ready = await waitFor(() => isAntecedentPageReady(), ANTECEDENTS_NAV_TIMEOUT_MS, 500);
            if (ready) return true;
        }

        if (callSpecificPostBack('ctl00$ContentPlaceHolder1$ButtonGotoAntecedent', '')) {
            const ready = await waitFor(() => isAntecedentPageReady(), ANTECEDENTS_NAV_TIMEOUT_MS, 500);
            if (ready) return true;
        }

        const candidate = findBestAntecedentsCandidate();
        if (candidate) {
            const parsed = parsePostBackTarget(`${candidate.getAttribute('href') || ''} ${candidate.getAttribute('onclick') || ''}`);
            clickElement(candidate);
            if (parsed && parsed.target) setTimeout(() => callSpecificPostBack(parsed.target, parsed.argument || ''), 250);
            const ready = await waitFor(() => isAntecedentPageReady(), 15000, 500);
            if (ready) return true;
        }

        return !!(await waitFor(() => isAntecedentPageReady() || looksLikeAntecedentsPage(), 5000, 500));
    }

    function findBestAntecedentsCandidate() {
        const candidates = queryAllDeep('a[href], button, input[type="button"], input[type="submit"], div[onclick], span[onclick], [onclick]');
        return candidates.find(el => {
            if (!el || !isVisible(el)) return false;
            const text = lowerText(getElementText(el));
            const raw = lowerText(`${text} ${el.getAttribute && el.getAttribute('onclick') || ''} ${el.getAttribute && el.getAttribute('href') || ''} ${el.id || ''} ${el.name || ''}`);
            return raw.includes('antecedent') || raw.includes('atcd') || raw.includes('buttongotoantecedent');
        }) || null;
    }

    function findDeleteCrossedMedsButton() {
        const exact = queryAllDeep(SELECTOR_DELETE_EXACT).find(isVisible);
        if (exact) return { el: exact, method: 'exact-selector' };

        for (const selector of SELECTOR_DELETE_FALLBACKS) {
            const candidates = queryAllDeep(selector).filter(isVisible);
            for (const el of candidates) {
                if (!isDeleteCrossedMedsButton(el)) continue;
                return { el, method: `fallback:${selector}` };
            }
        }
        return null;
    }

    function isDeleteCrossedMedsButton(el) {
        if (!el) return false;
        const root = el.closest && el.closest(SELECTOR_ANTECEDENT_ROOT);
        const inAntecedents = !!root || isAntecedentPageReady();
        if (!inAntecedents) return false;
        const meta = lowerText([
            el.getAttribute && el.getAttribute('title'),
            el.getAttribute && el.getAttribute('alt'),
            el.getAttribute && el.getAttribute('onclick'),
            el.getAttribute && el.getAttribute('src'),
            getElementText(el)
        ].filter(Boolean).join(' '));

        if (meta.includes('postbackdeletetraitementchroniquebarre')) return true;
        if (meta.includes('supprimer tous les medicaments barres')) return true;
        return false;
    }

    async function clickDeleteCrossedMedsButton(infoInput) {
        const info = infoInput || getWorkerInfoFromHash();
        const found = findDeleteCrossedMedsButton();
        if (!found || !found.el) return { clicked: false, method: 'not-found' };

        const postback = extractDeletePostBack(found.el);
        writeWorkerActionState(info, {
            stage: postback && postback.target ? 'delete_postback_sent' : 'delete_clicked',
            clickedAt: nowMs(),
            method: found.method,
            postbackTarget: postback && postback.target || '',
            postbackArgument: postback && postback.argument || '',
            element: describeDeleteElement(found.el)
        });
        runtime.clickedAt = nowMs();
        publishWorkerHeartbeat();

        if (postback && postback.target && callSpecificPostBack(postback.target, postback.argument || '')) {
            addLog('info', 'PostBack suppression medicaments barres envoye.', { id: info && info.patientId || '' }, {
                method: found.method,
                postbackTarget: postback.target,
                postbackArgument: postback.argument || ''
            });
            await sleep(1200);
            await waitForWedaIdle(DELETE_ACTION_TIMEOUT_MS);
            return { clicked: true, method: `postback:${found.method}`, postback };
        }

        const restoreConfirm = forceConfirmForDelete(found.el);
        try {
            clickDeleteElementOnce(found.el);
            await sleep(1200);
            await waitForWedaIdle(DELETE_ACTION_TIMEOUT_MS);
            return { clicked: true, method: found.method, postback };
        } finally {
            try { restoreConfirm(); } catch (_) {}
        }
    }

    function extractDeletePostBack(el) {
        if (!el) return null;
        const raw = decodeHtmlAttribute(el.getAttribute && el.getAttribute('onclick') || '');
        const match = raw.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^\)]*)\)/i);
        if (!match) return null;

        let argument = String(match[2] || '').trim();
        argument = argument.replace(/^['"]|['"]$/g, '').trim();
        return {
            target: match[1],
            argument
        };
    }

    function describeDeleteElement(el) {
        if (!el) return null;
        return {
            title: el.getAttribute && el.getAttribute('title') || '',
            alt: el.getAttribute && el.getAttribute('alt') || '',
            onclick: limitText(el.getAttribute && el.getAttribute('onclick') || '', 260),
            src: limitText(el.getAttribute && el.getAttribute('src') || '', 160)
        };
    }

    function clickDeleteElementOnce(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        const doc = el.ownerDocument || document;
        const view = doc.defaultView || window;
        const eventOptions = { bubbles: true, cancelable: true, view };

        try { el.dispatchEvent(new view.MouseEvent('mouseover', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousemove', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousedown', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mouseup', eventOptions)); } catch (_) {}

        try {
            el.click();
            return true;
        } catch (_) {
            try {
                el.dispatchEvent(new view.MouseEvent('click', eventOptions));
                return true;
            } catch (__) {
                return false;
            }
        }
    }

    function forceConfirmForDelete(el) {
        const replacements = [];
        const wins = [];
        try { wins.push(window); } catch (_) {}
        try { wins.push(ownerWin(el)); } catch (_) {}
        try { if (typeof unsafeWindow !== 'undefined') wins.push(unsafeWindow); } catch (_) {}

        const uniqueWins = wins.filter((win, index) => win && wins.indexOf(win) === index);
        for (const win of uniqueWins) {
            try {
                const original = win.confirm;
                const forced = function (message) {
                    const normalized = lowerText(message);
                    if (normalized.includes('supprimer tous les medicaments barres') || normalized.includes('voulez vous supprimer tous les medicaments barres')) {
                        return true;
                    }
                    if (typeof original === 'function') return original.call(this, message);
                    return false;
                };
                win.confirm = forced;
                replacements.push({ win, original });
            } catch (_) {}
        }

        return function restore() {
            for (const item of replacements) {
                try { item.win.confirm = item.original; } catch (_) {}
            }
        };
    }

    function buildDeleteButtonDiagnostic() {
        const images = queryAllDeep('img').map(img => ({
            title: img.getAttribute('title') || '',
            alt: img.getAttribute('alt') || '',
            onclick: limitText(img.getAttribute('onclick') || '', 240),
            src: limitText(img.getAttribute('src') || '', 160),
            visible: isVisible(img)
        })).filter(item => {
            const meta = lowerText(`${item.title} ${item.alt} ${item.onclick} ${item.src}`);
            return meta.includes('supprimer') || meta.includes('traitement') || meta.includes('trash') || meta.includes('barre');
        }).slice(0, 25);

        return {
            url: window.location.href,
            isAntecedentPageReady: isAntecedentPageReady(),
            hasRoot: !!queryOneDeep(SELECTOR_ANTECEDENT_ROOT),
            candidates: images
        };
    }

    /************************************************************
     * LISTENERS ET API CONSOLE
     ************************************************************/

    try {
        GM_addValueChangeListener(KEY_RESULT, (_key, _oldValue, newValue) => {
            const result = parseMaybeJson(newValue, null);
            if (result) signalWorkerResultIfWaiting(result);
        });
    } catch (_) {}

    function installConsoleApi() {
        const api = {
            AUTO_SUPP_MED_BARRES_SCAN: scanAndStorePatients,
            AUTO_SUPP_MED_BARRES_START: startBatch,
            AUTO_SUPP_MED_BARRES_PAUSE: pauseBatch,
            AUTO_SUPP_MED_BARRES_RESUME: resumeBatch,
            AUTO_SUPP_MED_BARRES_STOP: stopBatch,
            AUTO_SUPP_MED_BARRES_CLEAR: clearBatchData,
            AUTO_SUPP_MED_BARRES_LOGS: () => getLogs(),
            AUTO_SUPP_MED_BARRES_SHOW_LOGS: showLogs,
            AUTO_SUPP_MED_BARRES_QUEUE: () => getQueue(),
            AUTO_SUPP_MED_BARRES_STATE: () => getState(),
            AUTO_SUPP_MED_BARRES_VERSION: () => VERSION,
            AUTO_SUPP_MED_BARRES_LAST_REPORT: () => gmGetJson(KEY_LAST_REPORT, null),
            AUTO_SUPP_MED_BARRES_TEST_FIND_BUTTON: () => {
                const found = findDeleteCrossedMedsButton();
                console.log(LOG_PREFIX, 'TEST_FIND_BUTTON', found ? { method: found.method, element: found.el } : null, buildDeleteButtonDiagnostic());
                return found;
            },
            AUTO_SUPP_MED_BARRES_TEST_CLICK_BUTTON: clickDeleteCrossedMedsButton,
            AUTO_SUPP_MED_BARRES_NAV_ANTECEDENTS: ensureAntecedentsPage
        };

        for (const [name, fn] of Object.entries(api)) {
            try { window[name] = fn; } catch (_) {}
            try { if (typeof unsafeWindow !== 'undefined') unsafeWindow[name] = fn; } catch (_) {}
        }
    }

    function boot() {
        installConsoleApi();
        runWorker();
        installPanel();
        setInterval(installPanel, 2500);
        setInterval(renderPanel, 1500);
    }

    boot();
})();
