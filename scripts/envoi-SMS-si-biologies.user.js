// ==UserScript==
// @name         WEDA HPRIM -> SMS MadeforMed
// @namespace    https://secure.weda.fr/
// @version      1.2.3
// @description  PageDown sur WEDA HPRIM : affecte la biologie active, recherche le patient exact nom+prénom dans MadeforMed et envoie un SMS standardisé.
// @author       Florian Ronez + ChatGPT
// @match        https://secure.weda.fr/FolderMedical/HprimForm.aspx*
// @match        https://secure.weda.fr/FolderMedical/PatientViewForm.aspx*
// @match        https://secure.weda.fr/FolderMedical/ConsultationForm.aspx*
// @match        https://pro.madeformed.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_closeTab
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.2.3';
    const LOG_PREFIX = '[AUTO-HPRIM-SMS]';

    const MADEFORMED_URL = 'https://pro.madeformed.com/agenda';
    const HASH_PREFIX = 'AUTO_WEDA_HPRIM_SMS=';
    const WEDA_TRACE_HASH_PREFIX = 'AUTO_HPRIM_SMS_WEDA_TRACE=';
    const WEDA_TRACE_SESSION_KEY = 'auto_weda_hprim_sms_trace_job_id';

    const KEY_JOB = 'auto_weda_hprim_sms_job_v1';
    const KEY_REPORT = 'auto_weda_hprim_sms_last_report_v1';
    const KEY_WEDA_WARNING = 'auto_weda_hprim_sms_weda_warning_v1';
    const KEY_WEDA_TRACE_JOB = 'auto_weda_hprim_sms_weda_trace_job_v1';
    const WEDA_WARNING_TTL_MS = 45 * 60 * 1000;
    const WEDA_TRACE_TTL_MS = 20 * 60 * 1000;

    const SMS_TEXT = 'Bonjour, suite à votre dernière analyse il serait bien que nous nous voyions en consultation (avec moi personnellement). Rien d\'urgent rassurez vous. Bonne journée. Dr Ronez.';

    const SELECTORS = {
        wedaHprimNomPrincipal: '#ContentPlaceHolder1_HprimsGrid_LinkButtonHprimNom_0',
        wedaHprimsGrid: '#ContentPlaceHolder1_HprimsGrid',
        wedaHprimNomLinks: 'a[id*="HprimsGrid_LinkButtonHprimNom"]',

        wedaPatientsGrid: '#ContentPlaceHolder1_PatientsGrid',
        wedaPatientRows: '#ContentPlaceHolder1_PatientsGrid > tbody > tr.grid-item, #ContentPlaceHolder1_PatientsGrid tr.grid-item',
        wedaPatientIdentityCellPrincipal: '#ContentPlaceHolder1_PatientsGrid > tbody > tr.grid-item > td:nth-child(2)',
        wedaAffecterButtonPrincipal: '#ContentPlaceHolder1_PatientsGrid_ButtonAffecteResultat_0',
        wedaOpenPatientLink: 'a[id*="PatientsGrid_HyperLinkGridGotoPatient"], a[id*="HyperLinkGridGotoPatient"], a[title*="Ouvrir la fiche patient"]',
        wedaSearchInput: '#ContentPlaceHolder1_FindPatientUcForm1_TextBoxRecherche',
        wedaSearchModeSelect: '#ContentPlaceHolder1_FindPatientUcForm1_DropDownListRechechePatient',
        wedaSearchButton: '#ContentPlaceHolder1_FindPatientUcForm1_ButtonRecherchePatient',
        wedaPatientOldGridLinks: 'a[id^="ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonOldPatientGetNomPrenom_"]',
        wedaNewConsultButton: '#ContentPlaceHolder1_MenuNavigate\\:submenu\\:2 > li:nth-child(1) > a',
        wedaSaveButton: '#ButtonSave, input[name="ctl00$ContentPlaceHolder1$EvenementUcForm1$ButtonSave"], input.buttonheader.valid[value="Enregistrer"]',

        madeformedPatientsShortcut: '#shortcuts > div.shortcuts-bar.for-desktop > div:nth-child(1), #shortcuts .shortcut.menu-user-btn[data-title="Patients"], .shortcut.menu-user-btn[data-title="Patients"], [data-title="Patients"]',
        madeformedSearchInput: '#userSearch',
        madeformedResults: '#users-result',
        madeformedPatientPanels: '#users-result .user.preview.panel',
        madeformedContactButton: '.user-preview-actions a.contact.contact-action, .user-preview-actions a.contact-action, a.contact.contact-action[data-contact-url]',
        madeformedSmsTextarea: '#contact-panel > textarea, #contact-panel textarea[name="sendSMS"], textarea[name="sendSMS"], textarea[send-by="sms"]',
        madeformedSendButton: '#contact-modal button.contact-send.btn.btn-primary, button.contact-send.btn.btn-primary, button.contact-send'
    };

    let localBusy = false;
    let lastShownWedaWarningId = '';
    let wedaTraceBusy = false;
    let wedaTraceWakeListenerInstalled = false;
    let lastHandledManualSmsJobId = '';

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

    function isWedaFindPatientPage() {
        return location.hostname === 'secure.weda.fr' && /\/FolderMedical\/FindPatientForm\.aspx/i.test(location.pathname);
    }

    function isWedaPatientViewPage() {
        return location.hostname === 'secure.weda.fr' && /\/FolderMedical\/PatientViewForm\.aspx/i.test(location.pathname);
    }

    function isWedaConsultationPage() {
        return location.hostname === 'secure.weda.fr' && /\/FolderMedical\/ConsultationForm\.aspx/i.test(location.pathname);
    }

    function isWedaWarningPage() {
        return isWedaHprimPage() || isWedaConsultationPage();
    }

    function isWedaTraceWorkerPage() {
        return isWedaPatientViewPage() || isWedaConsultationPage();
    }

    function isMadeformedPage() {
        return location.hostname === 'pro.madeformed.com';
    }

    function getHashJobId() {
        const hash = String(location.hash || '').replace(/^#/, '');
        if (!hash.startsWith(HASH_PREFIX)) return '';
        return decodeURIComponent(hash.slice(HASH_PREFIX.length));
    }

    function getWedaTraceJobIdForThisTab() {
        const hash = String(location.hash || '').replace(/^#/, '');

        if (hash.startsWith(WEDA_TRACE_HASH_PREFIX)) {
            const id = decodeURIComponent(hash.slice(WEDA_TRACE_HASH_PREFIX.length));

            try {
                sessionStorage.setItem(WEDA_TRACE_SESSION_KEY, id);
            } catch (_) {}

            return id;
        }

        try {
            return sessionStorage.getItem(WEDA_TRACE_SESSION_KEY) || '';
        } catch (_) {
            return '';
        }
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

    function buildSmsNotSentText(reason, patientFullName = '') {
        const lines = [
            'SMS MadeforMed non envoyé.',
            patientFullName ? 'Patient : ' + patientFullName : '',
            reason ? 'Motif : ' + reason : '',
            'À envoyer manuellement depuis MadeforMed.'
        ];

        return lines.filter(Boolean).join('\n');
    }

    function publishWedaWarningForUnsentSms(job, reason, severity = 'error') {
        const warning = {
            id: 'weda_warning_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            at: nowIso(),
            jobId: job && job.id ? job.id : '',
            status: job && job.status ? job.status : '',
            severity,
            patientFullName: job && job.patientFullNameRaw ? job.patientFullNameRaw : '',
            reason: reason || 'Aucun SMS confirmé comme envoyé.'
        };

        GM_setValue(KEY_WEDA_WARNING, warning);
        return warning;
    }

    function isRecentWedaWarning(warning) {
        if (!warning || !warning.id || !warning.at) return false;

        const ageMs = Date.now() - Date.parse(warning.at);
        return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= WEDA_WARNING_TTL_MS;
    }

    function showWedaWarningForUnsentSms(warning) {
        if (!isRecentWedaWarning(warning)) return false;

        const currentJob = GM_getValue(KEY_JOB, null);
        if (currentJob && currentJob.id && warning.jobId && currentJob.id !== warning.jobId) {
            return false;
        }

        const message = buildSmsNotSentText(warning.reason, warning.patientFullName);

        if (lastShownWedaWarningId === warning.id && document.getElementById('auto-hprim-sms-weda-warning')) {
            return true;
        }

        lastShownWedaWarningId = warning.id;
        notify(message, warning.severity === 'warn' ? 'warn' : 'error', 0);

        try {
            const existing = document.getElementById('auto-hprim-sms-weda-warning');
            if (existing) existing.remove();

            const box = document.createElement('div');
            box.id = 'auto-hprim-sms-weda-warning';
            box.style.position = 'sticky';
            box.style.top = '0';
            box.style.zIndex = '2147483647';
            box.style.margin = '8px 8px 12px';
            box.style.padding = '12px 16px';
            box.style.border = '3px solid #b3261e';
            box.style.borderRadius = '8px';
            box.style.background = '#fff4f4';
            box.style.color = '#7a1020';
            box.style.fontFamily = 'Arial, sans-serif';
            box.style.fontSize = '16px';
            box.style.fontWeight = '700';
            box.style.lineHeight = '1.35';
            box.style.whiteSpace = 'pre-wrap';
            box.style.boxShadow = '0 4px 18px rgba(122,16,32,0.25)';

            const text = document.createElement('div');
            text.textContent = message;

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'Fermer l’alerte');
            closeBtn.textContent = 'x';
            closeBtn.style.position = 'absolute';
            closeBtn.style.top = '6px';
            closeBtn.style.right = '8px';
            closeBtn.style.width = '24px';
            closeBtn.style.height = '24px';
            closeBtn.style.border = '0';
            closeBtn.style.borderRadius = '12px';
            closeBtn.style.background = 'transparent';
            closeBtn.style.color = '#7a1020';
            closeBtn.style.fontSize = '18px';
            closeBtn.style.fontWeight = '900';
            closeBtn.style.lineHeight = '20px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.padding = '0';
            closeBtn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                box.remove();
                GM_deleteValue(KEY_WEDA_WARNING);
            });

            box.style.position = 'sticky';
            box.style.paddingRight = '44px';
            box.appendChild(text);
            box.appendChild(closeBtn);

            const form = document.querySelector('form') || document.body;
            if (form.firstChild) {
                form.insertBefore(box, form.firstChild);
            } else {
                form.appendChild(box);
            }
        } catch (e) {
            warn('Affichage avertissement WEDA impossible', e);
        }

        return true;
    }

    function installWedaWarningListener() {
        if (!isWedaWarningPage()) return;

        const pendingWarning = GM_getValue(KEY_WEDA_WARNING, null);
        if (pendingWarning && !isRecentWedaWarning(pendingWarning)) {
            GM_deleteValue(KEY_WEDA_WARNING);
        } else if (pendingWarning) {
            showWedaWarningForUnsentSms(pendingWarning);
        }

        if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(KEY_WEDA_WARNING, (_name, _oldValue, newValue) => {
                if (newValue && !isRecentWedaWarning(newValue)) {
                    GM_deleteValue(KEY_WEDA_WARNING);
                } else if (newValue) {
                    showWedaWarningForUnsentSms(newValue);
                }
            });
            return;
        }

        setInterval(() => {
            const warning = GM_getValue(KEY_WEDA_WARNING, null);
            if (warning && !isRecentWedaWarning(warning)) {
                GM_deleteValue(KEY_WEDA_WARNING);
            } else if (warning) {
                showWedaWarningForUnsentSms(warning);
            }
        }, 1500);
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
                el.style.padding = '12px 44px 12px 16px';
                el.style.borderRadius = '12px';
                el.style.background = '#06345f';
                el.style.color = '#fff';
                el.style.fontSize = '15px';
                el.style.fontWeight = '700';
                el.style.fontFamily = 'Arial, sans-serif';
                el.style.boxShadow = '0 6px 22px rgba(0,0,0,0.35)';
                el.style.lineHeight = '1.35';
                el.style.whiteSpace = 'pre-wrap';

                const text = document.createElement('div');
                text.id = 'auto-hprim-sms-notify-text';

                const closeBtn = document.createElement('button');
                closeBtn.id = 'auto-hprim-sms-notify-close';
                closeBtn.type = 'button';
                closeBtn.setAttribute('aria-label', 'Fermer l’alerte');
                closeBtn.textContent = 'x';
                closeBtn.style.position = 'absolute';
                closeBtn.style.top = '6px';
                closeBtn.style.right = '8px';
                closeBtn.style.width = '24px';
                closeBtn.style.height = '24px';
                closeBtn.style.border = '0';
                closeBtn.style.borderRadius = '12px';
                closeBtn.style.background = 'rgba(255,255,255,0.12)';
                closeBtn.style.color = '#fff';
                closeBtn.style.fontSize = '18px';
                closeBtn.style.fontWeight = '900';
                closeBtn.style.lineHeight = '20px';
                closeBtn.style.cursor = 'pointer';
                closeBtn.style.padding = '0';
                closeBtn.addEventListener('click', ev => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    clearTimeout(el.__autoHprimSmsTimer);
                    el.style.display = 'none';
                });

                el.appendChild(text);
                el.appendChild(closeBtn);
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

            const text = el.querySelector('#auto-hprim-sms-notify-text') || el;
            text.textContent = message;
            el.style.display = 'block';

            clearTimeout(el.__autoHprimSmsTimer);
            if (durationMs > 0) {
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

    function extractWedaPatientPatDk(patientRow) {
        if (!patientRow) return '';

        const sources = [];
        const attrs = ['href', 'onclick', 'value', 'name', 'id', 'data-patdk', 'data-patient-id', 'data-id'];
        const elements = [patientRow, ...patientRow.querySelectorAll('*')];

        for (const el of elements) {
            for (const attr of attrs) {
                try {
                    const value = el.getAttribute ? el.getAttribute(attr) : '';
                    if (value) sources.push(value);
                } catch (_) {}
            }
        }

        try {
            sources.push(patientRow.outerHTML || '');
        } catch (_) {}

        for (const source of sources) {
            const text = String(source || '');
            const match =
                text.match(/[?&]PatDk=(\d+)/i) ||
                text.match(/\bPatDk\b[^0-9]{0,40}(\d{2,})/i) ||
                text.match(/\bPatientDk\b[^0-9]{0,40}(\d{2,})/i);

            if (match && match[1]) return match[1];
        }

        return '';
    }

    function extractWedaPatientDateOfBirth(patientRow) {
        if (!patientRow) return '';

        const text = String(patientRow.textContent || '').replace(/\s+/g, ' ');
        const match = text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/);

        return match ? match[1].replace(/[.-]/g, '/') : '';
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

    function findWedaOpenPatientLink(patientRow) {
        if (patientRow) {
            const linkInRow = patientRow.querySelector(SELECTORS.wedaOpenPatientLink);
            if (linkInRow) return linkInRow;

            const linkInColumn = patientRow.querySelector('td:nth-child(7) a[href*="PatientViewForm.aspx"]');
            if (linkInColumn) return linkInColumn;
        }

        return document.querySelector(SELECTORS.wedaOpenPatientLink);
    }

    function urlWithTraceHash(url, traceJobId) {
        try {
            const parsed = new URL(url, location.href);
            parsed.hash = WEDA_TRACE_HASH_PREFIX + encodeURIComponent(traceJobId);
            return parsed.href;
        } catch (_) {
            const cleanUrl = String(url || '').replace(/#.*$/, '');
            return cleanUrl + '#' + WEDA_TRACE_HASH_PREFIX + encodeURIComponent(traceJobId);
        }
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
        const windowName = 'AUTO_HPRIM_SMS_' + job.id;

        try {
            const openedWindow = getPageWindow().open(url, windowName);
            if (openedWindow) {
                log('Onglet MadeforMed ouvert via window.open', url);
                return openedWindow;
            }
        } catch (e) {
            warn('window.open impossible, fallback GM_openInTab', e);
        }

        try {
            const tab = GM_openInTab(url, {
                active: true,
                insert: true,
                setParent: true
            });

            log('Onglet MadeforMed ouvert', url, tab);
            return tab;
        } catch (e) {
            warn('GM_openInTab impossible, fallback window.open', e);
            window.open(url, windowName);
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
            const patientPatDk = extractWedaPatientPatDk(patient.row);
            const patientDateOfBirthRaw = extractWedaPatientDateOfBirth(patient.row);
            const openPatientLink = findWedaOpenPatientLink(patient.row);
            let wedaOpenPatientHref = '';

            if (openPatientLink) {
                try {
                    wedaOpenPatientHref = new URL(openPatientLink.getAttribute('href') || openPatientLink.href || '', location.href).href;
                } catch (_) {
                    wedaOpenPatientHref = openPatientLink.getAttribute('href') || openPatientLink.href || '';
                }
            }

            if (!patient.nomNormalized || !patient.prenomNormalized) {
                throw new Error('Nom/prénom patient vide après normalisation.');
            }

            if (!wedaOpenPatientHref) {
                throw new Error('Lien WEDA "Ouvrir la fiche patient" introuvable dans la ligne du patient.');
            }

            GM_deleteValue(KEY_WEDA_WARNING);
            GM_deleteValue(KEY_WEDA_TRACE_JOB);

            const affecterBtn = findWedaAffecterButton(patient.row);
            if (!affecterBtn) {
                throw new Error('Bouton "Affecter ce résultat" introuvable dans la ligne du patient.');
            }

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
                patientPatDk,
                patientDateOfBirthRaw,
                wedaOpenPatientHref,

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
                patientPatDk,
                patientDateOfBirth: patientDateOfBirthRaw,
                wedaOpenPatientHref,
                hprimNomForLog: hprimNomForLog.raw
            });

            notify(
                'Patient WEDA sélectionné : ' + patient.fullNameRaw +
                '\nValidation WEDA + préparation SMS MadeforMed.',
                'info',
                6500
            );

            openMadeformedWorker(job);

            await copyNameToClipboard(patient.fullNameRaw);

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

    async function prepareMadeformedSmsForManualSend(textarea, smsText) {
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

        return sendBtn;
    }

    function focusMadeformedForManualValidation() {
        try {
            window.focus();
        } catch (_) {}

        try {
            const pageWindow = getPageWindow();
            if (pageWindow && typeof pageWindow.focus === 'function') {
                pageWindow.focus();
            }
        } catch (_) {}
    }

    function focusInitialWedaTabFromMadeformed() {
        try {
            if (window.opener && !window.opener.closed && typeof window.opener.focus === 'function') {
                window.opener.focus();
                return true;
            }
        } catch (e) {
            warn('Focus onglet WEDA initial via opener impossible', e);
        }

        return false;
    }

    function focusCurrentWedaTabForReturn() {
        let focused = false;

        try {
            window.focus();
            focused = true;
        } catch (_) {}

        try {
            const pageWindow = getPageWindow();
            if (pageWindow && typeof pageWindow.focus === 'function') {
                pageWindow.focus();
                focused = true;
            }
        } catch (_) {}

        return focused;
    }

    function normalizeSmsTextForTrace(text) {
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
    }

    function readMadeformedSmsTextareaText(textarea) {
        if (!textarea) return '';

        if (typeof textarea.value === 'string') {
            return normalizeSmsTextForTrace(textarea.value);
        }

        return normalizeSmsTextForTrace(textOf(textarea));
    }

    function getRequiredSentSmsText(job) {
        if (!job || !Object.prototype.hasOwnProperty.call(job, 'smsTextSent')) {
            throw new Error('Contenu exact du SMS envoyé non capturé : traçage automatique arrêté pour éviter de coller le SMS type.');
        }

        const smsText = normalizeSmsTextForTrace(job.smsTextSent);
        if (!smsText) {
            throw new Error('Contenu exact du SMS envoyé vide ou non capturable : traçage automatique arrêté pour éviter de coller le SMS type.');
        }

        return smsText;
    }

    function waitForManualMadeformedSmsSend(job, textarea, sendBtn) {
        return new Promise(resolve => {
            let done = false;

            const cleanup = () => {
                document.removeEventListener('click', onClick, true);
                document.removeEventListener('submit', onSubmit, true);
            };

            const finish = trigger => {
                if (done) return;
                done = true;

                const smsTextSent = readMadeformedSmsTextareaText(textarea);

                cleanup();

                notify(
                    smsTextSent
                        ? 'SMS détecté comme envoyé.\nTexte exact capturé pour le traçage WEDA.'
                        : 'SMS détecté, mais texte non capturé.\nTraçage WEDA automatique bloqué pour éviter de coller le SMS type.',
                    smsTextSent ? 'success' : 'error',
                    smsTextSent ? 2600 : 0
                );

                setTimeout(() => {
                    focusInitialWedaTabFromMadeformed();
                }, 200);

                setTimeout(() => {
                    resolve({
                        trigger,
                        smsTextSent,
                        sentDetectedAt: nowIso()
                    });
                }, 2500);
            };

            const isSendTarget = target => {
                if (!target) return false;
                if (sendBtn && (target === sendBtn || (sendBtn.contains && sendBtn.contains(target)))) return true;

                const closest = target.closest ? target.closest(SELECTORS.madeformedSendButton) : null;
                return !!closest;
            };

            const onClick = ev => {
                if (isSendTarget(ev.target)) {
                    finish('click-send-button');
                }
            };

            const onSubmit = ev => {
                const form = ev.target;
                if (form && textarea && form.contains && form.contains(textarea)) {
                    finish('submit-form');
                }
            };

            document.addEventListener('click', onClick, true);
            document.addEventListener('submit', onSubmit, true);

            notify(
                'SMS prêt dans MadeforMed.\nRelisez/modifiez si besoin, puis cliquez vous-même sur Envoyer.',
                'success',
                0
            );
            focusMadeformedForManualValidation();
        });
    }

    function buildWedaTraceMessage(smsText) {
        return 'SMS envoyé au patient via MadeforMed :\n' + normalizeSmsTextForTrace(smsText);
    }

    function makeWedaTraceJobId(smsJob) {
        return 'hprim_sms_trace_' + (smsJob && smsJob.id ? smsJob.id : Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function createWedaTraceJobFromSmsJob(smsJob, data = {}) {
        const smsText = normalizeSmsTextForTrace(data.smsText || smsJob.smsTextSent || smsJob.smsText || SMS_TEXT);

        return {
            id: makeWedaTraceJobId(smsJob),
            smsJobId: smsJob.id,
            version: VERSION,
            createdAt: nowIso(),
            createdAtMs: Date.now(),
            status: data.status || 'waiting_sms_sent',
            source: 'hprim_sms_sent',
            patientNomRaw: smsJob.patientNomRaw || '',
            patientPrenomRaw: smsJob.patientPrenomRaw || '',
            patientFullNameRaw: smsJob.patientFullNameRaw || '',
            patientPatDk: smsJob.patientPatDk || '',
            patientDateOfBirthRaw: smsJob.patientDateOfBirthRaw || '',
            smsText,
            traceMessage: buildWedaTraceMessage(smsText),
            selectedMadeformedPatient: smsJob.selectedMadeformedPatient || null,
            ...data
        };
    }

    function cancelWedaTraceForUnsentSms(smsJob, reason) {
        const traceJob = GM_getValue(KEY_WEDA_TRACE_JOB, null);
        if (!traceJob || !smsJob || traceJob.smsJobId !== smsJob.id) return null;

        const nextTraceJob = {
            ...traceJob,
            status: 'cancelled_sms_not_sent',
            cancelReason: reason || 'SMS non envoyé.',
            cancelledAt: nowIso(),
            updatedAt: nowIso()
        };

        GM_setValue(KEY_WEDA_TRACE_JOB, nextTraceJob);
        return nextTraceJob;
    }

    function openWedaTraceTabAfterManualSms(job) {
        if (!job || !job.id) {
            throw new Error('Job SMS absent pour le traçage WEDA.');
        }

        if (!job.wedaOpenPatientHref) {
            throw new Error('Lien officiel WEDA du patient absent : traçage automatique impossible.');
        }

        const smsText = getRequiredSentSmsText(job);
        const traceJob = createWedaTraceJobFromSmsJob(
            {
                ...job,
                smsText,
                selectedMadeformedPatient: job.selectedMadeformedPatient || null
            },
            {
                status: 'sms_sent_open_consult',
                smsSentAt: job.smsSentAt || nowIso(),
                smsText,
                traceMessage: buildWedaTraceMessage(smsText),
                wedaOpenPatientHref: job.wedaOpenPatientHref,
                openedAfterManualSmsAt: nowIso(),
                hprimUrl: location.href
            }
        );

        const tracedHref = urlWithTraceHash(job.wedaOpenPatientHref, traceJob.id);

        GM_setValue(KEY_WEDA_TRACE_JOB, traceJob);

        try {
            GM_openInTab(tracedHref, {
                active: false,
                insert: true,
                setParent: false
            });
        } catch (e) {
            warn('GM_openInTab WEDA trace arrière-plan impossible', e);
            throw new Error('Ouverture silencieuse de l’onglet WEDA de traçage impossible.');
        }

        log('Onglet WEDA de traçage ouvert après SMS manuel', {
            traceJobId: traceJob.id,
            smsJobId: job.id,
            tracedHref
        });

        return traceJob;
    }

    function handleManualSmsSentOnWeda(job) {
        if (!isWedaHprimPage()) return false;
        if (!job || job.status !== 'sms-sent-manual' || !job.id) return false;
        if (lastHandledManualSmsJobId === job.id) return true;

        lastHandledManualSmsJobId = job.id;

        try {
            focusCurrentWedaTabForReturn();

            notify(
                'SMS envoyé.\nOuverture du dossier WEDA en arrière-plan pour traçage.',
                'success',
                4200
            );

            const traceJob = openWedaTraceTabAfterManualSms(job);

            const nextJob = {
                ...job,
                status: 'weda-trace-opened',
                wedaTraceJobId: traceJob.id,
                wedaTraceOpenedAt: nowIso()
            };

            GM_setValue(KEY_JOB, nextJob);

            saveReport('weda-trace-opened', {
                jobId: job.id,
                traceJobId: traceJob.id,
                patientFullName: job.patientFullNameRaw,
                smsText: traceJob.smsText
            });

            return true;
        } catch (e) {
            error('Ouverture WEDA trace après SMS manuel impossible', e);

            saveReport('error-weda-trace-open-after-manual-sms', {
                jobId: job.id,
                patientFullName: job.patientFullNameRaw,
                message: e.message || String(e),
                stack: e.stack || ''
            });

            notify(
                'SMS envoyé, mais traçage WEDA automatique impossible :\n' +
                (e.message || String(e)) +
                '\nTraçage manuel nécessaire.',
                'error',
                0
            );

            return false;
        }
    }

    function installManualSmsSentListenerOnWeda() {
        if (!isWedaHprimPage()) return;

        const currentJob = GM_getValue(KEY_JOB, null);
        handleManualSmsSentOnWeda(currentJob);

        if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(KEY_JOB, (_name, _oldValue, newValue) => {
                handleManualSmsSentOnWeda(newValue);
            });
            return;
        }

        setInterval(() => {
            handleManualSmsSentOnWeda(GM_getValue(KEY_JOB, null));
        }, 1500);
    }

    function getWedaTraceJobForThisTab() {
        const traceJobId = getWedaTraceJobIdForThisTab();
        if (!traceJobId) return null;

        const job = GM_getValue(KEY_WEDA_TRACE_JOB, null);
        if (!job || job.id !== traceJobId) return null;

        const createdAtMs = Number(job.createdAtMs || Date.parse(job.createdAt || ''));
        if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > WEDA_TRACE_TTL_MS) {
            GM_deleteValue(KEY_WEDA_TRACE_JOB);
            try {
                sessionStorage.removeItem(WEDA_TRACE_SESSION_KEY);
            } catch (_) {}
            return null;
        }

        return job;
    }

    function updateWedaTraceJob(patch) {
        const job = getWedaTraceJobForThisTab();
        if (!job) return null;

        const next = {
            ...job,
            ...patch,
            updatedAt: nowIso()
        };

        GM_setValue(KEY_WEDA_TRACE_JOB, next);
        return next;
    }

    function clearWedaTraceJob() {
        GM_deleteValue(KEY_WEDA_TRACE_JOB);
        try {
            sessionStorage.removeItem(WEDA_TRACE_SESSION_KEY);
        } catch (_) {}
    }

    function failWedaTrace(status, message, data = {}) {
        const job = updateWedaTraceJob({
            status: 'error_' + status,
            errorMessage: message,
            errorAt: nowIso(),
            errorData: data
        }) || getWedaTraceJobForThisTab();

        error('Erreur traçage WEDA SMS', {
            status,
            message,
            data,
            job
        });

        saveReport('error-weda-trace-' + status, {
            traceJobId: job && job.id ? job.id : '',
            smsJobId: job && job.smsJobId ? job.smsJobId : '',
            patientFullName: job && job.patientFullNameRaw ? job.patientFullNameRaw : '',
            message,
            data
        });

        notify(
            'SMS envoyé, mais traçage WEDA impossible :\n' + message +
            '\nÀ tracer manuellement dans le dossier patient.',
            'error',
            0
        );
    }

    function scheduleWedaTraceRetry(reason, delayMs = 1200) {
        log('Relance traçage WEDA programmée', {
            reason,
            delayMs
        });

        setTimeout(() => {
            wedaTraceBusy = false;
            runWedaTraceWorker();
        }, delayMs);
    }

    function normalizeWedaTraceText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function normalizeWedaDateText(value) {
        return String(value || '').replace(/[.-]/g, '/').replace(/\s+/g, '').trim();
    }

    function getWedaTraceClickableTarget(el) {
        if (!el) return null;

        if (el.matches && el.matches('a, button, input[type="submit"], input[type="button"]')) {
            return el;
        }

        const direct = el.querySelector ? el.querySelector('a, button, input[type="submit"], input[type="button"]') : null;
        if (direct) return direct;

        return el.closest ? el.closest('a, button, input[type="submit"], input[type="button"], tr[onclick], td[onclick], div[onclick], span[onclick]') || el : el;
    }

    function getWedaTracePatientCandidateText(el) {
        if (!el) return '';

        const container =
            el.closest && (
                el.closest('tr') ||
                el.closest('li') ||
                el.closest('table')
            ) ||
            el.parentElement ||
            el;

        return String([
            el.textContent || '',
            el.value || '',
            el.getAttribute ? el.getAttribute('title') || '' : '',
            container && container !== el ? container.textContent || '' : ''
        ].join(' ')).replace(/\s+/g, ' ').trim();
    }

    function getWedaTracePatientCandidateTechnicalSource(el) {
        if (!el) return '';

        const sources = [getWedaTracePatientCandidateText(el)];
        const attrs = ['href', 'onclick', 'value', 'name', 'id', 'data-patdk', 'data-patient-id', 'data-id'];
        const elements = [
            el,
            ...(el.querySelectorAll ? Array.from(el.querySelectorAll('*')) : [])
        ];

        for (const candidate of elements) {
            for (const attr of attrs) {
                try {
                    const value = candidate.getAttribute ? candidate.getAttribute(attr) : '';
                    if (value) sources.push(value);
                } catch (_) {}
            }
        }

        try {
            sources.push(el.outerHTML || '');
        } catch (_) {}

        return sources.join(' ');
    }

    function sourceContainsPatDk(source, patDk) {
        if (!patDk) return false;

        const text = String(source || '');
        const escaped = String(patDk).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        return new RegExp('(?:PatDk|PatientDk|data-patdk)[^0-9]{0,40}' + escaped + '\\b', 'i').test(text);
    }

    function findWedaTracePatientResultTarget(patientName, dateOfBirth = '', patientPatDk = '') {
        const wanted = normalizeWedaTraceText(patientName);
        const wantedDate = normalizeWedaDateText(dateOfBirth);
        const tokens = wanted.split(' ').filter(token => token.length >= 2);

        if (!tokens.length) return null;

        const oldGridLinks = Array.from(document.querySelectorAll(SELECTORS.wedaPatientOldGridLinks));
        let best = null;
        let bestScore = 0;

        for (const link of oldGridLinks) {
            const rawText = getWedaTracePatientCandidateText(link);
            const text = normalizeWedaTraceText(rawText);
            const technicalSource = getWedaTracePatientCandidateTechnicalSource(link);
            if (!text || !tokens.every(token => text.includes(token))) continue;

            let score = 1000;
            if (sourceContainsPatDk(technicalSource, patientPatDk)) score += 10000;
            if (text === wanted) score += 300;
            if (text.includes(wanted)) score += 200;
            if (text.startsWith(wanted)) score += 100;
            if (wantedDate && normalizeWedaDateText(rawText).includes(wantedDate)) score += 500;
            if (isVisible(link)) score += 50;

            if (score > bestScore) {
                bestScore = score;
                best = link;
            }
        }

        if (best) return best;

        const candidates = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"], tr, td, span, div'));

        for (const el of candidates) {
            const rawText = getWedaTracePatientCandidateText(el);
            const text = normalizeWedaTraceText(rawText);
            const technicalSource = getWedaTracePatientCandidateTechnicalSource(el);
            if (!text || text.length > 800 || !tokens.every(token => text.includes(token))) continue;

            let score = 10;
            if (sourceContainsPatDk(technicalSource, patientPatDk)) score += 10000;
            if (text.includes(wanted)) score += 100;
            if (text.startsWith(wanted)) score += 50;
            if (wantedDate && normalizeWedaDateText(rawText).includes(wantedDate)) score += 300;
            if (el.matches && el.matches('a, button, input')) score += 20;
            if (isVisible(el)) score += 10;

            if (score > bestScore) {
                bestScore = score;
                best = getWedaTraceClickableTarget(el);
            }
        }

        return best;
    }

    async function ensureWedaTraceSearchModePatientName() {
        const select = await waitFor(() => document.querySelector(SELECTORS.wedaSearchModeSelect), 7000, 200);
        if (!select) return true;

        const selectedText = select.options && select.selectedIndex >= 0
            ? String(select.options[select.selectedIndex].textContent || '')
            : '';

        if (select.value === 'Nom' || normalizeWedaTraceText(selectedText).includes('nom')) {
            return true;
        }

        const optionByText = Array.from(select.options || []).find(option => normalizeWedaTraceText(option.textContent).includes('nom'));
        const nextValue = optionByText ? optionByText.value : 'Nom';

        select.value = nextValue;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));

        scheduleWedaTraceRetry('après correction du mode de recherche WEDA', 1800);
        return false;
    }

    async function submitWedaTraceSearch(job) {
        const searchModeReady = await ensureWedaTraceSearchModePatientName();
        if (!searchModeReady) return;

        const input = await waitFor(() => document.querySelector(SELECTORS.wedaSearchInput), 15000, 200);
        if (!input) {
            failWedaTrace('search_input_not_found', 'Barre de recherche patient WEDA introuvable.', {
                selector: SELECTORS.wedaSearchInput
            });
            return;
        }

        input.focus();
        setNativeValue(input, job.patientFullNameRaw);

        await sleep(300);

        updateWedaTraceJob({
            status: 'search_submitted',
            searchSubmittedAt: Date.now()
        });

        const btn = document.querySelector(SELECTORS.wedaSearchButton);
        if (btn) {
            dispatchMouseClick(btn);
        } else {
            pressEnter(input);
        }

        scheduleWedaTraceRetry('après lancement recherche patient WEDA', 1400);
    }

    async function clickWedaTracePatient(job) {
        const target = await waitFor(() => findWedaTracePatientResultTarget(job.patientFullNameRaw, job.patientDateOfBirthRaw || '', job.patientPatDk || ''), 15000, 250);

        if (!target) {
            const elapsed = Date.now() - (job.searchSubmittedAt || job.createdAtMs || Date.now());

            if (elapsed < 25000 && isWedaFindPatientPage()) {
                scheduleWedaTraceRetry('résultat patient WEDA non prêt', 1500);
                return;
            }

            failWedaTrace('patient_not_found', 'Patient WEDA introuvable pour le traçage du SMS.', {
                patientFullName: job.patientFullNameRaw,
                patientDateOfBirth: job.patientDateOfBirthRaw || '',
                url: location.href
            });
            return;
        }

        updateWedaTraceJob({
            status: 'patient_clicked',
            patientClickedAt: Date.now()
        });

        dispatchMouseClick(target);
        scheduleWedaTraceRetry('après clic patient WEDA', 1200);
    }

    async function clickWedaTraceNewConsultation(job) {
        if (isWedaConsultationPage()) {
            updateWedaTraceJob({
                status: 'consultation_clicked',
                consultationClickedAt: Date.now()
            });
            scheduleWedaTraceRetry('consultation déjà ouverte', 500);
            return;
        }

        const newConsultBtn = await waitFor(() => document.querySelector(SELECTORS.wedaNewConsultButton), 20000, 250);

        if (!newConsultBtn) {
            failWedaTrace('new_consult_not_found', 'Bouton Nouvelle consultation WEDA introuvable.', {
                selector: SELECTORS.wedaNewConsultButton,
                url: location.href
            });
            return;
        }

        updateWedaTraceJob({
            status: 'consultation_clicked',
            consultationClickedAt: Date.now()
        });

        dispatchMouseClick(newConsultBtn);
        scheduleWedaTraceRetry('après clic Nouvelle consultation WEDA', 1200);
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function textToHtmlWithBreaks(text) {
        return escapeHtml(text)
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\n/g, '<br>');
    }

    function findEditableContextInDocument(doc) {
        if (!doc) return null;

        const candidates = Array.from(doc.querySelectorAll('body[contenteditable="true"], [contenteditable="true"]'));

        for (const el of candidates) {
            if (el && el.isContentEditable) {
                return { doc, el };
            }
        }

        return null;
    }

    function findWedaEditorContext() {
        let ctx = findEditableContextInDocument(document);
        if (ctx) return ctx;

        const iframes = Array.from(document.querySelectorAll('iframe'));

        for (const iframe of iframes) {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                ctx = findEditableContextInDocument(doc);
                if (ctx) return ctx;
            } catch (_) {}
        }

        return null;
    }

    function insertWedaTraceMessageInEditor(ctx, message) {
        const { doc, el } = ctx;
        const html = '<p><br></p><p>' + textToHtmlWithBreaks(message) + '</p>';

        el.focus();

        try {
            const selection = doc.getSelection();
            const range = doc.createRange();

            range.selectNodeContents(el);
            range.collapse(true);

            selection.removeAllRanges();
            selection.addRange(range);

            doc.execCommand('insertHTML', false, html);
        } catch (e) {
            warn('Insertion consultation WEDA par execCommand impossible, fallback innerHTML', e);
            el.innerHTML = html + el.innerHTML;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        try {
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
        } catch (_) {}
    }

    function normalizeEditorCompareText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/<br\s*\/?\s*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function editorContainsMessage(ctx, message) {
        if (!ctx || !ctx.el) return false;

        const haystack = normalizeEditorCompareText(ctx.el.innerText || ctx.el.textContent || ctx.el.innerHTML || '');
        const target = normalizeEditorCompareText(message);

        if (!haystack || !target) return false;
        if (haystack.includes(target)) return true;

        if (target.length <= 120) return false;

        return haystack.includes(target.slice(0, 90)) && haystack.includes(target.slice(-90));
    }

    async function fillAndSaveWedaTraceConsultation(job) {
        if (!isWedaConsultationPage()) {
            const elapsed = Date.now() - (job.consultationClickedAt || Date.now());

            if (elapsed < 30000) {
                scheduleWedaTraceRetry('attente page ConsultationForm WEDA', 1000);
                return;
            }

            failWedaTrace('consultation_page_not_reached', 'Page de consultation WEDA non atteinte après ouverture du dossier patient.', {
                url: location.href
            });
            return;
        }

        const ctx = await waitFor(() => findWedaEditorContext(), 20000, 250);
        if (!ctx) {
            failWedaTrace('editor_not_found', 'Zone de texte de consultation WEDA introuvable.', {
                url: location.href,
                iframesCount: document.querySelectorAll('iframe').length
            });
            return;
        }

        const latestJob = getWedaTraceJobForThisTab();
        if (!latestJob || latestJob.status !== 'consultation_clicked') return;

        updateWedaTraceJob({
            status: 'consultation_filling',
            fillingAt: Date.now()
        });

        insertWedaTraceMessageInEditor(ctx, latestJob.traceMessage);

        await sleep(300);

        if (!editorContainsMessage(ctx, latestJob.traceMessage)) {
            insertWedaTraceMessageInEditor(ctx, latestJob.traceMessage);
            await sleep(300);
        }

        if (!editorContainsMessage(ctx, latestJob.traceMessage)) {
            failWedaTrace('message_disappeared_before_save', 'Le texte du SMS n’est pas retrouvé dans la consultation WEDA avant sauvegarde.');
            return;
        }

        const saveBtn = await waitFor(() => document.querySelector(SELECTORS.wedaSaveButton), 15000, 250);
        if (!saveBtn) {
            failWedaTrace('save_button_not_found', 'Bouton Enregistrer WEDA introuvable.', {
                selector: SELECTORS.wedaSaveButton
            });
            return;
        }

        updateWedaTraceJob({
            status: 'saved_pending_close',
            filledAt: Date.now(),
            savedAt: Date.now()
        });

        dispatchMouseClick(saveBtn);

        saveReport('weda-trace-saved', {
            traceJobId: latestJob.id,
            smsJobId: latestJob.smsJobId,
            patientFullName: latestJob.patientFullNameRaw,
            patientPatDk: latestJob.patientPatDk || '',
            smsText: latestJob.smsText
        });

        await sleep(3000);

        closeWedaTraceTab();
    }

    function closeWedaTraceTab() {
        clearWedaTraceJob();

        setTimeout(() => {
            try {
                if (typeof GM_closeTab === 'function') {
                    GM_closeTab();
                    return;
                }
            } catch (e) {
                warn('GM_closeTab indisponible pour fermer WEDA trace', e);
            }

            try {
                if (typeof GM !== 'undefined' && GM && typeof GM.closeTab === 'function') {
                    GM.closeTab();
                    return;
                }
            } catch (e) {
                warn('GM.closeTab indisponible pour fermer WEDA trace', e);
            }

            try {
                window.open('', '_self');
                window.close();
            } catch (e) {
                warn('window.close indisponible pour fermer WEDA trace', e);
            }

            setTimeout(() => {
                try {
                    if (!document.getElementById('auto-hprim-sms-weda-trace-close-fallback')) {
                        const banner = document.createElement('div');
                        banner.id = 'auto-hprim-sms-weda-trace-close-fallback';
                        banner.style.position = 'fixed';
                        banner.style.left = '12px';
                        banner.style.top = '12px';
                        banner.style.zIndex = '2147483647';
                        banner.style.background = '#0b5a33';
                        banner.style.color = '#fff';
                        banner.style.padding = '10px 12px';
                        banner.style.borderRadius = '8px';
                        banner.style.fontFamily = 'Arial, sans-serif';
                        banner.style.fontSize = '13px';
                        banner.style.fontWeight = '700';
                        banner.textContent = 'SMS tracé dans WEDA. Fermeture demandée ; si cet onglet reste ouvert, fermez-le manuellement.';
                        document.body.appendChild(banner);
                    }
                } catch (_) {}
            }, 900);
        }, 700);
    }

    function installWedaTraceWakeListener() {
        if (wedaTraceWakeListenerInstalled || !isWedaTraceWorkerPage()) return;

        wedaTraceWakeListenerInstalled = true;

        if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(KEY_WEDA_TRACE_JOB, (_name, _oldValue, newValue) => {
                const traceJobId = getWedaTraceJobIdForThisTab();
                if (!newValue || !traceJobId || newValue.id !== traceJobId) return;

                setTimeout(() => {
                    runWedaTraceWorker();
                }, 100);
            });
            return;
        }

        setInterval(() => {
            runWedaTraceWorker();
        }, 1500);
    }

    async function runWedaTraceWorker() {
        if (wedaTraceBusy) return;

        const job = getWedaTraceJobForThisTab();
        if (!job) return;

        wedaTraceBusy = true;

        try {
            log('Traçage WEDA SMS actif', {
                traceJobId: job.id,
                status: job.status,
                patientFullName: job.patientFullNameRaw,
                patientPatDk: job.patientPatDk || '',
                url: location.href
            });

            if (String(job.status || '').startsWith('error_')) {
                notify(
                    'Traçage WEDA du SMS en erreur :\n' + (job.errorMessage || job.status) +
                    '\nÀ tracer manuellement dans le dossier patient.',
                    'error',
                    0
                );
                return;
            }

            if (job.status === 'waiting_sms_sent') {
                if (!job.traceTabReadyAt) {
                    updateWedaTraceJob({
                        traceTabReadyAt: nowIso(),
                        traceTabUrl: location.href
                    });
                }

                notify(
                    'Dossier WEDA ouvert pour traçage SMS.\nEn attente de confirmation MadeforMed.',
                    'info',
                    4500
                );
                return;
            }

            if (job.status === 'cancelled_sms_not_sent') {
                notify(
                    'SMS non envoyé dans MadeforMed.\nFermeture de l’onglet WEDA patient préparé.',
                    'warn',
                    2500
                );

                await sleep(1400);
                closeWedaTraceTab();
                return;
            }

            if (job.status === 'sms_sent_open_consult') {
                if (isWedaConsultationPage()) {
                    updateWedaTraceJob({
                        status: 'consultation_clicked',
                        consultationClickedAt: Date.now()
                    });
                    scheduleWedaTraceRetry('consultation WEDA déjà ouverte après SMS', 500);
                    return;
                }

                if (!isWedaPatientViewPage()) {
                    failWedaTrace('patient_view_not_open', 'L’onglet WEDA patient préparé n’est pas sur la fiche patient après envoi du SMS.', {
                        url: location.href
                    });
                    return;
                }

                await clickWedaTraceNewConsultation(job);
                return;
            }

            if (job.status === 'open_search' || job.status === 'search_submitted') {
                failWedaTrace(
                    'legacy_search_disabled',
                    'Ancienne stratégie de recherche WEDA désactivée. Relancer depuis HPRIM pour ouvrir la fiche via le bouton officiel Ouvrir.',
                    { url: location.href }
                );
                return;
            }

            if (job.status === 'patient_clicked') {
                if (isWedaFindPatientPage()) {
                    scheduleWedaTraceRetry('attente ouverture dossier patient WEDA', 1000);
                    return;
                }

                await clickWedaTraceNewConsultation(job);
                return;
            }

            if (job.status === 'consultation_clicked') {
                await fillAndSaveWedaTraceConsultation(job);
                return;
            }

            if (job.status === 'consultation_filling') {
                const elapsed = Date.now() - (job.fillingAt || Date.now());

                if (elapsed > 30000) {
                    updateWedaTraceJob({ status: 'consultation_clicked' });
                    scheduleWedaTraceRetry('verrou remplissage WEDA expiré', 500);
                }

                return;
            }

            if (job.status === 'saved_pending_close') {
                await sleep(2500);
                closeWedaTraceTab();
                return;
            }
        } catch (e) {
            failWedaTrace('unexpected', e.message || String(e), {
                stack: e.stack || ''
            });
        } finally {
            wedaTraceBusy = false;
        }
    }

    function closeMadeformedTabSoon(message = 'SMS envoyé.\nFermeture de l’onglet MadeforMed.') {
        notify(message, 'success', 2500);

        setTimeout(() => {
            focusInitialWedaTabFromMadeformed();

            try {
                window.close();
            } catch (_) {}

            try {
                if (!window.closed && typeof GM_closeTab === 'function') {
                    GM_closeTab();
                    return;
                }
            } catch (_) {}

            setTimeout(() => {
                try {
                    if (!window.closed) {
                        focusInitialWedaTabFromMadeformed();
                        warn('Fermeture automatique refusée par le navigateur. Aucun basculement vers about:blank.');
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
            const reason = 'Job HPRIM SMS introuvable ou expiré.';
            publishWedaWarningForUnsentSms({ id: hashJobId }, reason, 'error');
            notify(buildSmsNotSentText(reason), 'error', 0);

            saveReport('error-madeformed-no-job', {
                hashJobId
            });

            return;
        }

        if (String(job.status || '').startsWith('done')) {
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

                const reason = 'Aucun patient MadeforMed avec nom + prénom exact.';
                cancelWedaTraceForUnsentSms(job, reason);
                publishWedaWarningForUnsentSms(job, reason, 'error');

                saveReport('manual-check-no-exact-patient', {
                    jobId: job.id,
                    patientFullName: job.patientFullNameRaw,
                    resultCount: panels.length,
                    results: allSummaries
                });

                notify(buildSmsNotSentText(reason, job.patientFullNameRaw), 'error', 0);

                return;
            }

            if (exactPanels.length > 1) {
                job.status = 'manual-check-homonyms';
                job.madeformedExactResults = exactSummaries;
                GM_setValue(KEY_JOB, job);

                const reason = 'Plusieurs patients MadeforMed correspondent exactement : contrôle manuel nécessaire.';
                cancelWedaTraceForUnsentSms(job, reason);
                publishWedaWarningForUnsentSms(job, reason, 'warn');

                saveReport('manual-check-homonyms', {
                    jobId: job.id,
                    patientFullName: job.patientFullNameRaw,
                    exactCount: exactPanels.length,
                    exactResults: exactSummaries
                });

                notify(buildSmsNotSentText(reason, job.patientFullNameRaw), 'warn', 0);

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

            const sendBtn = await prepareMadeformedSmsForManualSend(textarea, job.smsText || SMS_TEXT);

            job.selectedMadeformedPatient = selectedSummary;
            job.status = 'madeformed-waiting-manual-send';
            job.madeformedManualReadyAt = nowIso();
            GM_setValue(KEY_JOB, job);

            saveReport('madeformed-waiting-manual-send', {
                jobId: job.id,
                patientFullName: job.patientFullNameRaw,
                selectedMadeformedPatient: selectedSummary,
                smsTextPrepared: job.smsText || SMS_TEXT
            });

            const manualSend = await waitForManualMadeformedSmsSend(job, textarea, sendBtn);

            const sentJob = {
                ...job,
                status: 'sms-sent-manual',
                smsSentAt: manualSend.sentDetectedAt,
                smsTextSent: manualSend.smsTextSent,
                manualSendTrigger: manualSend.trigger,
                selectedMadeformedPatient: selectedSummary
            };

            GM_setValue(KEY_JOB, sentJob);

            saveReport('sms-sent-manual', {
                jobId: sentJob.id,
                patientFullName: sentJob.patientFullNameRaw,
                selectedMadeformedPatient: selectedSummary,
                smsTextSent: sentJob.smsTextSent,
                manualSendTrigger: sentJob.manualSendTrigger
            });

            closeMadeformedTabSoon('SMS envoyé.\nRetour WEDA et traçage lancés.\nFermeture de l’onglet MadeforMed.');
        } catch (e) {
            error('Erreur MadeforMed worker', e);

            job.status = 'error-madeformed';
            job.error = {
                message: e.message || String(e),
                stack: e.stack || ''
            };
            job.errorAt = nowIso();
            GM_setValue(KEY_JOB, job);

            const reason = 'Erreur MadeforMed : ' + (e.message || String(e));
            cancelWedaTraceForUnsentSms(job, reason);
            publishWedaWarningForUnsentSms(job, reason, 'error');

            saveReport('error-madeformed', {
                jobId: job.id,
                patientFullName: job.patientFullNameRaw,
                message: e.message || String(e),
                stack: e.stack || ''
            });

            notify(buildSmsNotSentText(reason, job.patientFullNameRaw), 'error', 0);
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

        root.AUTO_HPRIM_SMS_WEDA_TRACE_JOB = function () {
            const job = GM_getValue(KEY_WEDA_TRACE_JOB, null);
            console.log(LOG_PREFIX, 'WEDA_TRACE_JOB', job);
            return job;
        };

        root.AUTO_HPRIM_SMS_CLEAR = function () {
            GM_deleteValue(KEY_JOB);
            GM_deleteValue(KEY_REPORT);
            GM_deleteValue(KEY_WEDA_WARNING);
            GM_deleteValue(KEY_WEDA_TRACE_JOB);
            try {
                sessionStorage.removeItem(WEDA_TRACE_SESSION_KEY);
            } catch (_) {}
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

    if (isWedaWarningPage()) {
        installWedaWarningListener();
    }

    if (isWedaHprimPage()) {
        installManualSmsSentListenerOnWeda();
        installWedaHotkey();
    }

    if (isWedaTraceWorkerPage()) {
        installWedaTraceWakeListener();
        runWedaTraceWorker();
    }

    if (isMadeformedPage()) {
        runMadeformedWorker();
    }

})();
