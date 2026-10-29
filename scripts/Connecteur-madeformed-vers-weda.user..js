// ==UserScript==
// @name         Connecteur Madeformed - WEDA
// @namespace    http://tampermonkey.net/
// @version      4.5
// @description  PageDown : copier/envoyer le SMS vers WEDA ; clic nom patient : ouvrir dossier WEDA ; tâches et prochain RDV sous les messages ; rendez-vous et documents natifs ; regroupement visuel des appels ; Messagerie et compteur dans tous les onglets utilisateurs
// @match        https://pro.madeformed.com/*
// @match        https://secure.weda.fr/*
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_closeTab
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '4.5';

    const JOB_KEY = 'TM_MADEFORMED_TO_WEDA_JOB_V31';
    const LOG_KEY = 'TM_MADEFORMED_TO_WEDA_LOG_V31';
    const CLOSE_KEY = 'TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31';
    const PANEL_COLLAPSED_KEY = 'TM_MADEFORMED_TO_WEDA_PANEL_COLLAPSED_V1';
    const PANEL_POSITION_KEY = 'TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1';
    const TRANSFER_AUDIT_KEY = 'TM_MFM_WEDA_TRANSFER_AUDIT_V1';
    const JOB_SENSITIVE_TTL_MS = 20 * 60 * 1000;
    const TRANSFER_AUDIT_TTL_MS = 24 * 60 * 60 * 1000;
    const TRANSFER_AUDIT_LIMIT = 100;

    const WEDA_FIND_PATIENT_URL = 'https://secure.weda.fr/FolderMedical/FindPatientForm.aspx';

    const SEL_MADEFORMED_PATIENT =
        '#contact-modal > div > div > div.contact-section-simple.hidden > div.modal-sub-header.px-rsp.py-sm > div > div > span.contact-to-name.px-sm.py-xs.bg-primary-200.text-primary-950.rounded-xs';

    const SEL_WEDA_SEARCH_INPUT =
        '#ContentPlaceHolder1_FindPatientUcForm1_TextBoxRecherche';

    const SEL_WEDA_SEARCH_MODE_SELECT =
        '#ContentPlaceHolder1_FindPatientUcForm1_DropDownListRechechePatient';

    const WEDA_SEARCH_MODE_PATIENT_NAME = 'Nom';

    const SEL_MADEFORMED_MESSAGE_COUNTER =
        'span.notif-badge-counter.msg-counter, span.notif-badge-counter.tm-mf-message-counter';

    const SEL_MADEFORMED_PATIENT_HEADER =
        '#infos > div.user-detail.panel.full-size.active > div.page-header.has-nav.sticky > div.flex.space-between.gap-1 > div > div > div.flex.flex-column.gap-1.space-between';

    const SEL_MADEFORMED_PATIENT_HEADER_NAME =
        `${SEL_MADEFORMED_PATIENT_HEADER} .user-name, ` +
        '#infos .user-detail.panel.full-size.active .page-header.has-nav.sticky .user-name';

    const SEL_MADEFORMED_PATIENT_PREVIEW =
        '#users-result > div.user.preview.panel > div.panel-heading.patient-preview.flex.flex-column.gap-05';

    const SEL_MADEFORMED_PATIENT_PREVIEW_NAME =
        `${SEL_MADEFORMED_PATIENT_PREVIEW} .user-name, ` +
        '#users-result .user.preview.panel .panel-heading.patient-preview .user-name';

    const SEL_MADEFORMED_OPEN_PATIENT_NAME =
        `${SEL_MADEFORMED_PATIENT_HEADER_NAME}, ${SEL_MADEFORMED_PATIENT_PREVIEW_NAME}`;

    const SEL_MADEFORMED_MESSAGES_PATIENT_NAME =
        '.name.truncate';

    const SEL_WEDA_SEARCH_BUTTON =
        '#ContentPlaceHolder1_FindPatientUcForm1_ButtonRecherchePatient';

    const SEL_WEDA_NEW_CONSULT =
        '#ContentPlaceHolder1_MenuNavigate\\:submenu\\:2 > li:nth-child(1) > a';

    const SEL_WEDA_SAVE =
        '#ButtonSave, input[name="ctl00$ContentPlaceHolder1$EvenementUcForm1$ButtonSave"], input.buttonheader.valid[value="Enregistrer"]';

    const SEL_WEDA_PATIENT_OLD_GRID_LINK =
        'a[id^="ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonOldPatientGetNomPrenom_"]';

    const MAX_LOG_LINES = 500;

    let currentWedaTab = null;
    let currentWedaJobId = '';
    let currentWedaSavedSeenAt = 0;
    let madeformedClosePoller = null;
    let madeformedMessageFaviconBaseHref = '';
    let madeformedMessageFaviconLastCount = null;
    let madeformedMessageFaviconObserver = null;
    let madeformedMessageFaviconRefreshTimer = null;

    function isMadeformed() {
        return location.hostname === 'pro.madeformed.com';
    }

    function isMadeformedMessagesPage() {
        return isMadeformed() && location.pathname.replace(/\/+$/, '') === '/messages';
    }

    function isWeda() {
        return location.hostname === 'secure.weda.fr';
    }

    function isWedaFindPatientPage() {
        return location.href.includes('/FolderMedical/FindPatientForm.aspx');
    }

    function isWedaConsultationPage() {
        return location.href.includes('/FolderMedical/ConsultationForm.aspx');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeText(str) {
        return (str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function cleanText(str) {
        return (str || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function maskMessage(str) {
        return `[message masqué - ${(str || '').length} caractères]`;
    }

    function safeJobForLog(job) {
        if (!job) return null;
        return sanitizeLogData(job);
    }

    function sanitizeLogData(value, depth = 0) {
        if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
        if (depth > 5) return '[masqué]';
        if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeLogData(item, depth + 1));
        if (typeof value !== 'object') return '[masqué]';
        const safe = {};
        const sensitive = /patient|patdk|phone|telephone|uid|context|cabinet|birth|dob|email|address|prenom|nom|url|href|raw|payload|detail|note|content|transcription|identity|fingerprint|name|value|text|stack|message|madeformed|weda/i;
        const technical = /^(id|jobId|source|action|trigger|status|phase|feature|selector|fieldName|errorCode|code|errorName|state|method|reason|version|expiredFromStatus)$/;
        for (const [key, item] of Object.entries(value)) {
            if (sensitive.test(key) && !['errorName', 'fieldName'].includes(key)) { safe[key] = '[masqué]'; continue; }
            if (item == null || typeof item === 'boolean' || typeof item === 'number') safe[key] = item;
            else if (item && typeof item === 'object') safe[key] = sanitizeLogData(item, depth + 1);
            else if (technical.test(key) && /^[\w.:/'#\[\]=+\-]{1,160}$/.test(String(item)) && !/https?:|\b\d{10}\b/i.test(String(item))) safe[key] = item;
            else safe[key] = '[masqué]';
        }
        return safe;
    }

    function diagnosticPageUrl() {
        return `${location.origin || ''}${String(location.pathname || '').replace(/\d+/g, '[id]')}`;
    }

    function sanitizeLogMessage(message) {
        return String(message || '').replace(/https?:\/\/\S+/gi, '[URL masquée]')
            .replace(/(?:\+33|\b(?:0033|0))[\d .()-]{8,}\d\b/g, '[numéro masqué]');
    }

    function sanitizedLogEntry(entry) {
        return {at:entry?.at, page:entry?.page === 'WEDA' ? 'WEDA' : 'Madeformed', level:entry?.level,
            message:sanitizeLogMessage(entry?.message), data:sanitizeLogData(entry?.data)};
    }

    function getLogs() {
        const logs = GM_getValue(LOG_KEY, []);
        return Array.isArray(logs) ? logs.slice(-MAX_LOG_LINES).map(sanitizedLogEntry) : [];
    }

    function setLogs(logs) {
        GM_setValue(LOG_KEY, logs.slice(-MAX_LOG_LINES).map(sanitizedLogEntry));
    }

    function addLog(level, message, data) {
        const entry = {
            at: new Date().toISOString(),
            page: isMadeformed() ? 'Madeformed' : isWeda() ? 'WEDA' : location.hostname,
            level,
            message:sanitizeLogMessage(message),
            data:sanitizeLogData(data || null)
        };

        const logs = getLogs();
        logs.push(entry);
        setLogs(logs);

        const prefix = `[TM Madeformed -> WEDA ${VERSION}]`;

        if (level === 'ERROR') {
            console.error(prefix, entry.message, entry.data || '');
        } else if (level === 'WARN') {
            console.warn(prefix, entry.message, entry.data || '');
        } else {
            console.log(prefix, entry.message, entry.data || '');
        }

        refreshMadeformedPanel();
    }

    function buildLogText() {
        const job = safeJobForLog(getJob());
        const logs = getLogs();

        const header = [
            `Madeformed -> WEDA logs`,
            `Version : ${VERSION}`,
            `Date copie : ${new Date().toLocaleString()}`,
            `Page actuelle : ${diagnosticPageUrl()}`,
            `Job actuel : ${JSON.stringify(job, null, 2)}`,
            `Étapes techniques : ${JSON.stringify(getTransferAudit(), null, 2)}`,
            '',
            '--- LOGS ---'
        ].join('\n');

        const body = logs.map(l => {
            return `[${l.at}] [${l.page}] [${l.level}] ${l.message}` +
                (l.data ? ` | ${JSON.stringify(l.data)}` : '');
        }).join('\n');

        return header + '\n' + body;
    }

    async function copyTextToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (_) {
            GM_setClipboard(text);
        }
    }

    async function copyLogs() {
        const text = buildLogText();
        await copyTextToClipboard(text);
        addLog('INFO', 'Logs copiés dans le presse-papier', { length: text.length });
        alert('Logs copiés dans le presse-papier.');
    }

    function getTransferAudit() {
        const stored = GM_getValue(TRANSFER_AUDIT_KEY, []);
        return Array.isArray(stored) ? stored.filter(item => item && /^\d+_[a-z0-9]+$/i.test(item.id || '') &&
            Number.isFinite(item.createdAt) && item.createdAt > 0 && Number.isFinite(item.updatedAt) &&
            item.updatedAt >= item.createdAt && item.updatedAt <= Date.now() && Date.now() - item.updatedAt <= TRANSFER_AUDIT_TTL_MS)
            .slice(-TRANSFER_AUDIT_LIMIT).map(item => ({id:item.id, action:transferAuditCode(item.action), status:transferAuditCode(item.status),
                createdAt:item.createdAt, updatedAt:item.updatedAt, resultUnknown:Boolean(item.resultUnknown)})) : [];
    }

    function transferAuditCode(value) {
        return /^[a-z_]{1,80}$/.test(String(value || '')) ? value : 'unknown';
    }

    function recordTransferAudit(job) {
        if (!job || !/^\d+_[a-z0-9]+$/i.test(job.id || '')) return;
        const record = {id:job.id, action:transferAuditCode(job.action), status:transferAuditCode(job.status),
            createdAt:Number(job.createdAt) || Date.now(), updatedAt:Date.now(), resultUnknown:Boolean(job.resultUnknown)};
        const records = getTransferAudit().filter(item => item.id !== job.id);
        records.push(record);
        GM_setValue(TRANSFER_AUDIT_KEY, records.slice(-TRANSFER_AUDIT_LIMIT));
    }

    function getJob() {
        const job = GM_getValue(JOB_KEY, null);
        if (!job) return job;
        // Migrer aussi les ouvertures seules déjà verrouillées par la V4.3.
        // Elles ne transfèrent aucune réponse et ne créent aucune consultation.
        const expiredOpenPatient = isOpenPatientOnlyJob(job) && job.status === 'expired_unknown';
        if (job.sensitiveDataExpiredAt && !expiredOpenPatient) return job;
        const createdAt = Number(job.createdAt);
        if (!expiredOpenPatient && Number.isFinite(createdAt) && createdAt > 0 && createdAt <= Date.now() &&
            Date.now() - createdAt <= JOB_SENSITIVE_TTL_MS) return job;
        const needsReview = !isOpenPatientOnlyJob(job) && !['open_patient_done', 'archived_manually_verified'].includes(job.status);
        const expired = {id:job.id, action:transferAuditCode(job.action), source:transferAuditCode(job.source),
            createdAt:Number.isFinite(createdAt) && createdAt > 0 && createdAt <= Date.now() ? createdAt : Date.now(),
            updatedAt:Date.now(), status:needsReview ? 'expired_unknown' : 'error_transfer_expired',
            resultUnknown:needsReview, sensitiveDataExpiredAt:job.sensitiveDataExpiredAt || Date.now()};
        GM_setValue(JOB_KEY, expired);
        recordTransferAudit(expired);
        return expired;
    }

    function saveJob(job) {
        if (getJob()?.status === 'expired_unknown') throw new Error('Vérifiez le transfert ancien avant de le remplacer.');
        GM_setValue(JOB_KEY, job);
        recordTransferAudit(job);
        addLog('INFO', 'Job sauvegardé', safeJobForLog(job));
    }

    function updateJob(patch) {
        const job = getJob();

        if (!job) {
            addLog('WARN', 'updateJob appelé sans job');
            return null;
        }
        if ((job.sensitiveDataExpiredAt || job.status === 'expired_unknown') &&
            !(job.status === 'expired_unknown' && patch.status === 'archived_manually_verified')) return null;

        const next = {
            ...job,
            ...patch,
            updatedAt: Date.now()
        };

        GM_setValue(JOB_KEY, next);
        recordTransferAudit(next);
        addLog('INFO', 'Job mis à jour', safeJobForLog(next));

        return next;
    }

    function clearJob() {
        const job = getJob();
        recordTransferAudit(job);
        if (job?.status === 'expired_unknown') return false;
        GM_deleteValue(JOB_KEY);
        addLog('INFO', 'Job supprimé');
        refreshMadeformedPanel();
    }

    function refreshMadeformedPageClasses() {
        if (!isMadeformed() || !document.body) return;

        document.body.classList.toggle('tm-mf-weda-messages-page', isMadeformedMessagesPage());
    }

    function resetAll() {
        if (getJob()?.status === 'expired_unknown') {
            alert('Un ancien transfert reste à vérifier. Contrôlez son résultat puis utilisez « J’ai vérifié le résultat » dans MFM Helper + WEDA.');
            return;
        }
        closeCurrentWedaTabFromMadeformed('reset');
        GM_deleteValue(JOB_KEY);
        GM_deleteValue(LOG_KEY);
        GM_deleteValue(CLOSE_KEY);
        GM_deleteValue(TRANSFER_AUDIT_KEY);
        if (typeof mfmNativeClearGroupMemory === 'function') mfmNativeClearGroupMemory();
        alert('Job et logs supprimés.');
        refreshMadeformedPanel();
    }

    function isVisible(el) {
        if (!el) return false;

        const rect = el.getBoundingClientRect();
        const win = el.ownerDocument.defaultView || window;
        const style = win.getComputedStyle(el);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function realClick(el, guard = null) {
        if (guard) guard();
        if (guard && el) {
            if (!el.isConnected || el.disabled) return;
            guard();
            el.click();
            addLog('INFO','Clic natif WEDA effectué après contrôle du dossier');
            return;
        }
        if (!el) {
            addLog('ERROR', 'realClick appelé avec élément nul');
            return;
        }

        const win = el.ownerDocument.defaultView || window;

        try {
            el.scrollIntoView({
                block: 'center',
                inline: 'center'
            });
        } catch (_) {}

        el.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: win
        }));

        if (guard) guard();
        el.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: win
        }));

        if (guard) guard();
        el.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: win
        }));

        if (guard) guard();
        try {
            el.click();
        } catch (error) { if (error.code === 'WEDA_PATIENT_GUARD') throw error; }

        addLog('INFO', 'Clic effectué', {
            tag: el.tagName,
            id: el.id || '',
            href: el.getAttribute ? el.getAttribute('href') : '',
            text: cleanText(el.textContent || el.value || '').slice(0, 120)
        });
    }

    async function waitFor(fn, timeoutMs = 15000, intervalMs = 250) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const result = fn();

            if (result) return result;

            await sleep(intervalMs);
        }

        return null;
    }

    function setNativeValue(input, value) {
        const prototype = Object.getPrototypeOf(input);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        if (descriptor && descriptor.set) {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: value.slice(-1) || ' '
        }));
    }

    function getVisibleTextarea() {
        const selectors = [
            'textarea.form-control[name="sendSMS"]',
            '#sms-modal textarea#msg',
            '#sms-modal textarea.msg',
            '#sms-modal textarea.form-control',
            '.send-modal textarea#msg',
            '.send-modal textarea.msg',
            '.send-modal textarea.form-control',
            '.modal.show textarea',
            '.modal[style*="display: block"] textarea',
            'textarea#msg',
            'textarea.msg',
            'textarea.form-control',
            'textarea'
        ];

        for (const selector of selectors) {
            const textareas = document.querySelectorAll(selector);

            for (const textarea of textareas) {
                if (textarea.closest('.tm-mf-consignes')) continue;

                if (isVisible(textarea)) {
                    addLog('INFO', 'Zone de texte Madeformed détectée', {
                        selector,
                        id: textarea.id || '',
                        name: textarea.name || '',
                        className: String(textarea.className || ''),
                        length: String(textarea.value || '').trim().length
                    });

                    return textarea;
                }
            }
        }

        return null;
    }

    function isEnvoyerButton(btn) {
        if (!btn) return false;

        const text = normalizeText(btn.textContent);
        const title = normalizeText(btn.getAttribute('data-title'));
        const value = normalizeText(btn.getAttribute('value'));

        return (
            text === 'envoyer' ||
            title === 'envoyer' ||
            value === 'envoyer'
        );
    }

    function findEnvoyerButtonIn(root) {
        if (!root) return null;

        const selectors = [
            'button.btn.btn-primary.send[data-title="Envoyer"]',
            'button.btn.btn-primary[data-title="Envoyer"]',
            'button.send[data-title="Envoyer"]',
            'button[data-title="Envoyer"]',
            'button.btn.btn-primary.send',
            'button.btn.btn-primary',
            'button.send',
            'input[type="submit"][value="Envoyer"]'
        ];

        for (const selector of selectors) {
            const buttons = root.querySelectorAll(selector);

            for (const btn of buttons) {
                if (isVisible(btn) && isEnvoyerButton(btn) && !btn.disabled) {
                    return btn;
                }
            }
        }

        return null;
    }

    function getVisibleMadeformedModal() {
        const candidates = [
            ...document.querySelectorAll('#sms-modal, #contact-modal, .send-modal, .modal.show, .modal[style*="display: block"], .modal-dialog, .modal-content')
        ];

        return candidates.find(isVisible) || null;
    }

    function getEnvoyerButton(textarea) {
        const localRoot =
            textarea.closest('form') ||
            textarea.closest('#sms-modal') ||
            textarea.closest('#contact-modal') ||
            textarea.closest('.send-modal') ||
            textarea.closest('.modal') ||
            textarea.closest('.modal-dialog') ||
            textarea.closest('.modal-content') ||
            textarea.closest('.panel') ||
            textarea.closest('.card') ||
            getVisibleMadeformedModal();

        let btn = findEnvoyerButtonIn(localRoot);
        if (btn) return btn;

        btn = findEnvoyerButtonIn(getVisibleMadeformedModal());
        if (btn) return btn;

        btn = findEnvoyerButtonIn(document);
        if (btn) return btn;

        addLog('WARN', 'Bouton Envoyer introuvable');

        return null;
    }

    function findMadeformedCloseButton(root) {
        if (!root) return null;

        const selectors = [
            'button.close',
            '[data-dismiss="modal"]',
            '[data-bs-dismiss="modal"]',
            'button[aria-label="Close"]',
            'button[aria-label="Fermer"]',
            '.modal-header button',
            'button.btn.btn-default',
            'button.btn-secondary',
            'button'
        ];

        for (const selector of selectors) {
            const buttons = [...root.querySelectorAll(selector)];

            for (const btn of buttons) {
                if (!isVisible(btn)) continue;
                if (btn.disabled) continue;
                if (isEnvoyerButton(btn)) continue;

                const text = normalizeText(btn.textContent || btn.value || '');
                const aria = normalizeText(btn.getAttribute('aria-label') || '');
                const title = normalizeText(btn.getAttribute('title') || '');

                if (
                    text === 'fermer' ||
                    text === 'x' ||
                    text === '×' ||
                    text === 'annuler' ||
                    aria === 'close' ||
                    aria === 'fermer' ||
                    title === 'close' ||
                    title === 'fermer' ||
                    btn.matches('button.close, [data-dismiss="modal"], [data-bs-dismiss="modal"]')
                ) {
                    return btn;
                }
            }
        }

        return null;
    }

    async function closeMadeformedMessageWindow(textarea) {
        await sleep(1200);

        if (!textarea || !textarea.isConnected || !isVisible(textarea)) {
            addLog('INFO', 'Fenêtre Madeformed déjà fermée après envoi');
            return;
        }

        const modal =
            textarea.closest('#sms-modal') ||
            textarea.closest('#contact-modal') ||
            textarea.closest('.send-modal') ||
            textarea.closest('.modal') ||
            textarea.closest('.modal-dialog') ||
            textarea.closest('.modal-content') ||
            document.querySelector('#sms-modal') ||
            document.querySelector('#contact-modal') ||
            getVisibleMadeformedModal() ||
            document;

        try {
            if (window.bootstrap && modal && modal.classList && modal.classList.contains('modal')) {
                const instance = window.bootstrap.Modal.getInstance(modal) || new window.bootstrap.Modal(modal);
                instance.hide();
                addLog('INFO', 'Fenêtre Madeformed fermée via Bootstrap');
                return;
            }
        } catch (_) {}

        try {
            if (window.jQuery && modal && modal !== document) {
                window.jQuery(modal).modal('hide');
                addLog('INFO', 'Fenêtre Madeformed fermée via jQuery modal hide');
                return;
            }
        } catch (_) {}

        const closeBtn = findMadeformedCloseButton(modal);

        if (closeBtn) {
            realClick(closeBtn);
            addLog('INFO', 'Fenêtre Madeformed fermée après envoi');
            return;
        }

        document.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Escape',
            code: 'Escape'
        }));

        document.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            cancelable: true,
            key: 'Escape',
            code: 'Escape'
        }));

        addLog('WARN', 'Bouton fermeture Madeformed introuvable, tentative par Escape');
    }

    function getMadeformedPatientName() {
        let el = document.querySelector(SEL_MADEFORMED_PATIENT);

        if (!el) {
            el = document.querySelector('.contact-to-name');
        }

        if (el && cleanText(el.textContent)) {
            return cleanText(el.textContent);
        }

        const modal = getVisibleMadeformedModal() || document.querySelector('#sms-modal') || document;

        const fromLabelValue = findValueAfterLabelInRoot(modal, [
            'expéditeur',
            'expediteur',
            'patient',
            'destinataire',
            'contact'
        ]);

        if (fromLabelValue) {
            addLog('INFO', 'Nom patient détecté depuis fenêtre message Madeformed', {
                source: 'label-value',
                value: fromLabelValue
            });

            return fromLabelValue;
        }

        const hiddenNameCandidate = findMadeformedPatientNameFromInputs(modal);

        if (hiddenNameCandidate) {
            addLog('INFO', 'Nom patient détecté depuis input Madeformed', {
                source: 'input',
                value: hiddenNameCandidate
            });

            return hiddenNameCandidate;
        }

        const textCandidate = findLikelyHumanNameInText(modal ? modal.textContent || '' : '');

        if (textCandidate) {
            addLog('INFO', 'Nom patient détecté par analyse texte Madeformed', {
                source: 'text',
                value: textCandidate
            });

            return textCandidate;
        }

        return '';
    }

    function findValueAfterLabelInRoot(root, labels) {
        if (!root) return '';

        const normalizedLabels = labels.map(normalizeText);

        const allElements = [...root.querySelectorAll('label, div, span, p, td, th, strong, b')]
            .filter(el => isVisible(el))
            .filter(el => cleanText(el.textContent).length <= 80);

        for (const el of allElements) {
            const text = normalizeText(el.textContent || '').replace(/:$/, '');

            if (!normalizedLabels.includes(text)) continue;

            const directNext = getNextMeaningfulTextNodeValue(el);

            if (directNext && isLikelyPatientName(directNext)) {
                return directNext;
            }

            const parent = el.parentElement;

            if (parent) {
                const parts = [...parent.querySelectorAll('*')]
                    .filter(child => child !== el)
                    .map(child => cleanText(child.textContent || child.value || ''))
                    .filter(Boolean)
                    .filter(value => normalizeText(value) !== text)
                    .filter(value => isLikelyPatientName(value));

                if (parts[0]) return parts[0];
            }
        }

        const lines = cleanTextToLines(root.textContent || '');

        for (let i = 0; i < lines.length; i += 1) {
            const line = normalizeText(lines[i]).replace(/:$/, '');

            if (!normalizedLabels.includes(line)) continue;

            for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
                const value = cleanText(lines[j]);

                if (isLikelyPatientName(value)) {
                    return value;
                }
            }
        }

        return '';
    }

    function getNextMeaningfulTextNodeValue(el) {
        let node = el.nextSibling;

        while (node) {
            const value = cleanText(node.textContent || node.value || '');

            if (value && isLikelyPatientName(value)) return value;

            node = node.nextSibling;
        }

        let nextEl = el.nextElementSibling;

        while (nextEl) {
            const value = cleanText(nextEl.textContent || nextEl.value || '');

            if (value && isLikelyPatientName(value)) return value;

            nextEl = nextEl.nextElementSibling;
        }

        return '';
    }

    function findMadeformedPatientNameFromInputs(root) {
        if (!root) return '';

        const inputs = [...root.querySelectorAll('input, textarea, [data-name], [data-patient], [data-contact], [data-user]')];

        for (const input of inputs) {
            const values = [
                input.value || '',
                input.getAttribute('data-name') || '',
                input.getAttribute('data-patient') || '',
                input.getAttribute('data-contact') || '',
                input.getAttribute('data-user') || '',
                input.getAttribute('title') || '',
                input.getAttribute('aria-label') || ''
            ].map(cleanText).filter(Boolean);

            for (const value of values) {
                if (isLikelyPatientName(value)) {
                    return value;
                }
            }
        }

        return '';
    }

    function findLikelyHumanNameInText(text) {
        const lines = cleanTextToLines(text);

        for (const line of lines) {
            if (isLikelyPatientName(line)) {
                return line;
            }
        }

        return '';
    }

    function cleanTextToLines(text) {
        return String(text || '')
            .replace(/\r/g, '\n')
            .split(/\n+/)
            .map(cleanText)
            .filter(Boolean);
    }

    function isLikelyPatientName(value) {
        const text = cleanText(value);

        if (!text) return false;
        if (text.length < 5 || text.length > 60) return false;
        if (/\d/.test(text)) return false;
        if (/@/.test(text)) return false;
        if (/^(sms|email|telephone|téléphone|envoyer|fermer|modifier|signature|répondre|repondre|message)$/i.test(text)) return false;

        const parts = text.split(/\s+/).filter(Boolean);

        if (parts.length < 2 || parts.length > 5) return false;

        return parts.every(part => /^[A-Za-zÀ-ÖØ-öø-ÿ'’.-]{2,}$/.test(part));
    }

    function looksUpperToken(token) {
        const cleaned = (token || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        if (!/[A-Za-z]/.test(cleaned)) return false;

        return cleaned === cleaned.toUpperCase();
    }

    function formatPatientNameForWeda(rawName) {
        const name = cleanText(rawName);

        if (!name) return '';

        if (name.includes(',')) {
            const parts = name.split(',').map(cleanText).filter(Boolean);

            if (parts.length >= 2) {
                return `${parts[0]} ${parts.slice(1).join(' ')}`;
            }
        }

        const parts = name.split(/\s+/).filter(Boolean);

        if (parts.length <= 1) return name;

        if (looksUpperToken(parts[0])) {
            return name;
        }

        let surnameStart = parts.length - 1;

        while (
            surnameStart > 0 &&
            looksUpperToken(parts[surnameStart - 1]) &&
            parts[surnameStart - 1].length <= 3
        ) {
            surnameStart--;
        }

        const surnameParts = parts.slice(surnameStart);
        const firstNameParts = parts.slice(0, surnameStart);

        if (surnameParts.length === 0 || firstNameParts.length === 0) {
            return name;
        }

        return `${surnameParts.join(' ')} ${firstNameParts.join(' ')}`;
    }

    function createJob(patientNameRaw, message) {
        const patientNameForWeda = formatPatientNameForWeda(patientNameRaw);

        return {
            id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            source: 'madeformed',
            action: 'sms_to_consultation',
            patientNameRaw,
            patientName: patientNameForWeda,
            message,
            createdAt: Date.now(),
            status: 'open_search'
        };
    }

    function createOpenPatientJob(patientNameRaw, dateOfBirth, source = 'madeformed_agenda', options = {}) {
        const patientNameForWeda = cleanText(options.patientNameForWeda || '') || formatPatientNameForWeda(patientNameRaw);

        return {
            id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            source,
            action: 'open_patient',
            patientNameRaw,
            patientName: patientNameForWeda,
            dateOfBirth: cleanText(dateOfBirth || ''),
            message: '',
            createdAt: Date.now(),
            status: 'open_search'
        };
    }

    function isOpenPatientOnlyJob(job) {
        return Boolean(job && job.action === 'open_patient');
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            addLog('INFO', 'Message copié dans le presse-papier via clipboard API');
        } catch (err) {
            GM_setClipboard(text);
            addLog('INFO', 'Message copié via GM_setClipboard fallback');
        }
    }

    function removeFiltersAndBlur() {
        [...document.querySelectorAll("*")].forEach(el => {
            el.style.backdropFilter = "none";
            el.style.webkitBackdropFilter = "none";
            el.style.filter = "none";
        });

        console.log('[TM Madeformed -> WEDA] Commande exécutée : suppression backdropFilter/webkitBackdropFilter/filter sur tous les éléments');
        addLog('INFO', 'Commande anti-filtre exécutée sur Madeformed');
    }

    async function launchFromMadeformed(trigger) {
        if (getJob()?.status === 'expired_unknown') { alert('Vérifiez le résultat du transfert ancien dans MFM Helper + WEDA avant un nouvel envoi.'); return; }
        addLog('INFO', 'Déclenchement Madeformed', { trigger });

        const textarea = getVisibleTextarea();

        if (!textarea) {
            addLog('ERROR', 'Zone de texte Madeformed introuvable');
            return;
        }

        const envoyerBtn = getEnvoyerButton(textarea);

        if (!envoyerBtn) {
            addLog('ERROR', 'Bouton Envoyer introuvable');
            return;
        }

        const message = String(textarea.value || textarea.getAttribute('data-value') || '').trim();

        if (message.length === 0) {
            addLog('WARN', 'Champ texte vide');
            return;
        }

        const patientNameRaw = getMadeformedPatientName();

        if (!patientNameRaw) {
            addLog('ERROR', 'Nom patient Madeformed introuvable');
            return;
        }

        const patientNameForWeda = formatPatientNameForWeda(patientNameRaw);

        addLog('INFO', 'Nom patient détecté', {
            madeformed: patientNameRaw,
            weda: patientNameForWeda
        });

        await copyToClipboard(message);

        const job = createJob(patientNameRaw, message);
        saveJob(job);

        GM_deleteValue(CLOSE_KEY);

        addLog('INFO', 'Ouverture onglet WEDA en arrière-plan');

        currentWedaJobId = job.id;
        currentWedaSavedSeenAt = 0;

        currentWedaTab = GM_openInTab(`${WEDA_FIND_PATIENT_URL}?tmJob=${encodeURIComponent(job.id)}`, {
            active: false,
            insert: true,
            setParent: true
        });

        addLog('INFO', 'Handle onglet WEDA mémorisé côté Madeformed', {
            jobId: currentWedaJobId,
            hasCloseFunction: Boolean(currentWedaTab && typeof currentWedaTab.close === 'function')
        });

        startMadeformedClosePoller();

        realClick(envoyerBtn);

        addLog('INFO', 'Message copié et envoyé sur Madeformed');

        await closeMadeformedMessageWindow(textarea);
    }

    function stripMadeformedPatientTitle(value) {
        return cleanText(value)
            .replace(/^(?:Mme|Madame|Mlle|Monsieur|Mr\.?|M\.?|Docteur|Dr\.?)\s+/i, '')
            .trim();
    }

    function extractMadeformedDateOfBirth(value) {
        const match = cleanText(value).match(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/);

        return match ? normalizeDateText(match[0]) : '';
    }

    function getMadeformedOpenPatientFromClickEvent(event) {
        if (!event || event.button !== 0) return null;
        if (!event.target || !event.target.closest) return null;

        const nameEl = event.target.closest(SEL_MADEFORMED_OPEN_PATIENT_NAME);
        if (!nameEl || !isVisible(nameEl)) return null;

        const previewEl =
            nameEl.closest(SEL_MADEFORMED_PATIENT_PREVIEW) ||
            nameEl.closest('#users-result .user.preview.panel .panel-heading.patient-preview');

        const sourceEl =
            previewEl ||
            nameEl.closest(SEL_MADEFORMED_PATIENT_HEADER) ||
            nameEl.closest('.page-header.has-nav.sticky') ||
            nameEl.closest('#infos') ||
            document;

        const source = previewEl ? 'madeformed_patient_preview' : 'madeformed_patient_header';

        const lastNameEl = nameEl.querySelector('.nom');
        const firstNameEl = nameEl.querySelector('.prenom');
        const lastName = cleanText(lastNameEl ? lastNameEl.textContent : '');
        const firstName = cleanText(firstNameEl ? firstNameEl.textContent : '');

        let patientNameRaw = cleanText([lastName, firstName].filter(Boolean).join(' '));

        if (!patientNameRaw) {
            patientNameRaw = stripMadeformedPatientTitle(nameEl.textContent || '');
        }

        if (!patientNameRaw || !isLikelyPatientName(patientNameRaw)) {
            addLog('WARN', 'Clic nom patient Madeformed ignoré : nom patient non fiable', {
                rawText: cleanText(nameEl.textContent || '').slice(0, 120)
            });
            return null;
        }

        const birthDateEl =
            sourceEl.querySelector('.no-phone') ||
            sourceEl.querySelector('.identite-infos');

        const userIdEl = sourceEl.querySelector('[user-id], [data-user-id]');

        return {
            nameEl,
            sourceEl,
            source,
            patientNameRaw,
            dateOfBirth:
                extractMadeformedDateOfBirth(birthDateEl ? birthDateEl.textContent : '') ||
                extractMadeformedDateOfBirth(sourceEl.textContent || ''),
            userId: userIdEl
                ? cleanText(userIdEl.getAttribute('user-id') || userIdEl.getAttribute('data-user-id') || '')
                : ''
        };
    }

    function getMadeformedMessagesPatientFromClickEvent(event) {
        if (!event || event.button !== 0) return null;
        if (!isMadeformedMessagesPage()) return null;
        if (!event.target || !event.target.closest) return null;

        const nameEl = event.target.closest(SEL_MADEFORMED_MESSAGES_PATIENT_NAME);
        if (!nameEl || !isVisible(nameEl)) return null;

        const patientNameRaw = stripMadeformedPatientTitle(nameEl.textContent || '');

        if (!patientNameRaw || !isLikelyPatientName(patientNameRaw)) {
            addLog('WARN', 'Clic nom patient messages Madeformed ignoré : nom patient non fiable', {
                rawText: cleanText(nameEl.textContent || '').slice(0, 120)
            });
            return null;
        }

        const sourceEl =
            nameEl.closest('[user-id], [data-user-id], [data-patient-id], [data-id]') ||
            nameEl.closest('.message, .message-row, .conversation, .conversation-row, .thread, .item, li, tr') ||
            nameEl.parentElement ||
            nameEl;

        const userIdEl = sourceEl.querySelector
            ? sourceEl.querySelector('[user-id], [data-user-id], [data-patient-id], [data-id]')
            : null;

        return {
            nameEl,
            sourceEl,
            patientNameRaw,
            patientNameForWeda: patientNameRaw,
            dateOfBirth: extractMadeformedDateOfBirth(sourceEl.textContent || ''),
            userId: userIdEl
                ? cleanText(
                    userIdEl.getAttribute('user-id') ||
                    userIdEl.getAttribute('data-user-id') ||
                    userIdEl.getAttribute('data-patient-id') ||
                    userIdEl.getAttribute('data-id') ||
                    ''
                )
                : ''
        };
    }

    function getMadeformedAgendaPatientFromClickEvent(event) {
        if (!event || event.button !== 0) return null;

        const nameEl = event.target && event.target.closest ? event.target.closest('.rdv .nom') : null;
        if (!nameEl || !isVisible(nameEl)) return null;

        const rdvEl = nameEl.closest('.rdv');
        if (!rdvEl) return null;

        const patientNameRaw = cleanText(nameEl.textContent || '');
        if (!patientNameRaw || !isLikelyPatientName(patientNameRaw)) return null;

        const userInfos = rdvEl.querySelector('.user-infos');
        const dateOfBirth = userInfos ? cleanText(userInfos.getAttribute('data-ddn') || '') : '';
        const sexe = userInfos ? cleanText(userInfos.getAttribute('data-sexe') || '') : '';
        const age = userInfos ? cleanText(userInfos.getAttribute('data-age') || '') : '';

        return {
            rdvEl,
            nameEl,
            patientNameRaw,
            dateOfBirth,
            sexe,
            age,
            rdvId: rdvEl.getAttribute('data-id') || '',
            debut: rdvEl.getAttribute('data-debut') || '',
            fin: rdvEl.getAttribute('data-fin') || ''
        };
    }

    function openWedaPatientJobFromMadeformed(patient, source, logMessage, extraLogData = {}) {
        if (getJob()?.status === 'expired_unknown') { alert('Vérifiez le résultat du transfert ancien dans MFM Helper + WEDA avant une nouvelle ouverture.'); return false; }
        const job = createOpenPatientJob(patient.patientNameRaw, patient.dateOfBirth, source, {
            patientNameForWeda: patient.patientNameForWeda || ''
        });

        saveJob(job);
        GM_deleteValue(CLOSE_KEY);

        addLog('INFO', logMessage, {
            jobId: job.id,
            madeformed: patient.patientNameRaw,
            weda: job.patientName,
            dateOfBirth: job.dateOfBirth || '',
            ...extraLogData
        });

        GM_openInTab(`${WEDA_FIND_PATIENT_URL}?tmJob=${encodeURIComponent(job.id)}&tmAction=open_patient`, {
            active: true,
            insert: true,
            setParent: true
        });

        return true;
    }

    async function openWedaPatientFromMadeformedPatientHeader(event) {
        const madeformedPatient = getMadeformedOpenPatientFromClickEvent(event);

        if (!madeformedPatient) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }

        return openWedaPatientJobFromMadeformed(
            madeformedPatient,
            madeformedPatient.source,
            madeformedPatient.source === 'madeformed_patient_preview'
                ? 'Ouverture dossier patient WEDA depuis clic preview patient Madeformed'
                : 'Ouverture dossier patient WEDA depuis clic en-tête patient Madeformed',
            {
                userId: madeformedPatient.userId || ''
            }
        );
    }

    async function openWedaPatientFromMadeformedMessages(event) {
        const messagesPatient = getMadeformedMessagesPatientFromClickEvent(event);

        if (!messagesPatient) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }

        return openWedaPatientJobFromMadeformed(
            messagesPatient,
            'madeformed_messages',
            'Ouverture dossier patient WEDA depuis clic messages Madeformed',
            {
                userId: messagesPatient.userId || ''
            }
        );
    }

    async function openWedaPatientFromMadeformedAgenda(event) {
        const agendaPatient = getMadeformedAgendaPatientFromClickEvent(event);

        if (!agendaPatient) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }

        return openWedaPatientJobFromMadeformed(
            agendaPatient,
            'madeformed_agenda',
            'Ouverture dossier patient WEDA depuis clic agenda Madeformed',
            {
                rdvId: agendaPatient.rdvId || '',
                debut: agendaPatient.debut || '',
                fin: agendaPatient.fin || ''
            }
        );
    }

    function isLaunchShortcut(e) {
        if (mfmNativeOverlay || mfmNativeDocumentPreparing()) return false;
        if (e.target && e.target.closest && e.target.closest('.tm-mf-consignes,.tm-mf-native-next,.tm-mf-native-actions,.tm-mf-native-overlay,.tm-mf-native-document-success,.tm-mf-call-group-header,.tm-mf-call-group-toggle')) return false;

        return e.key === 'PageDown' || e.code === 'PageDown';
    }

    function getLaunchShortcutLabel(e) {
        if (e.key === 'PageDown' || e.code === 'PageDown') return 'PAGEDOWN';
        return 'UNKNOWN_SHORTCUT';
    }

    function closeCurrentWedaTabFromMadeformed(reason = '') {
        const hadTab = Boolean(currentWedaTab);
        const hasCloseFunction = Boolean(currentWedaTab && typeof currentWedaTab.close === 'function');

        if (!currentWedaTab || typeof currentWedaTab.close !== 'function') {
            addLog('WARN', 'Fermeture onglet WEDA impossible côté Madeformed : handle absent', {
                reason,
                currentWedaJobId,
                hadTab,
                hasCloseFunction
            });
            currentWedaTab = null;
            currentWedaJobId = '';
            currentWedaSavedSeenAt = 0;
            return false;
        }

        try {
            addLog('INFO', 'Fermeture onglet WEDA via handle GM_openInTab côté Madeformed', {
                reason,
                currentWedaJobId
            });

            currentWedaTab.close();

            currentWedaTab = null;
            currentWedaJobId = '';
            currentWedaSavedSeenAt = 0;

            return true;
        } catch (err) {
            addLog('WARN', 'Échec fermeture onglet WEDA via handle côté Madeformed', {
                reason,
                currentWedaJobId,
                message: err && err.message ? err.message : String(err)
            });

            currentWedaTab = null;
            currentWedaJobId = '';
            currentWedaSavedSeenAt = 0;

            return false;
        }
    }

    function startMadeformedClosePoller() {
        if (!isMadeformed()) return;

        if (madeformedClosePoller) {
            return;
        }

        madeformedClosePoller = window.setInterval(checkWedaCloseFromMadeformed, 700);

        addLog('INFO', 'Surveillance fermeture WEDA activée côté Madeformed');
    }

    function checkWedaCloseFromMadeformed() {
        if (!isMadeformed()) return;

        if (!currentWedaTab && !currentWedaJobId) {
            return;
        }

        const closeRequest = GM_getValue(CLOSE_KEY, null);

        if (closeRequest && closeRequest.jobId && (!currentWedaJobId || closeRequest.jobId === currentWedaJobId)) {
            addLog('INFO', 'Demande fermeture WEDA détectée par polling Madeformed', closeRequest);
            GM_deleteValue(CLOSE_KEY);
            closeCurrentWedaTabFromMadeformed(closeRequest.reason || 'close_key_polling');
            return;
        }

        // Seule la demande explicite de WEDA, après vérification du dossier,
        // autorise la fermeture. Le statut de sauvegarde ne suffit pas.
    }

    function setupMadeformedCloseListener() {
        startMadeformedClosePoller();

        if (typeof GM_addValueChangeListener !== 'function') {
            addLog('WARN', 'GM_addValueChangeListener indisponible : fermeture par listener impossible, polling actif');
            return;
        }

        GM_addValueChangeListener(CLOSE_KEY, function (_name, _oldValue, closeRequest) {
            if (!closeRequest || !closeRequest.jobId) return;

            addLog('INFO', 'Demande de fermeture WEDA reçue côté Madeformed par listener', closeRequest);

            closeCurrentWedaTabFromMadeformed(closeRequest.reason || 'close-request-listener');

            GM_deleteValue(CLOSE_KEY);
        });
    }

    function parseMadeformedMessageCounterValue(value) {
        const text = cleanText(value);

        if (!text) return 0;

        const compact = text.replace(/\s+/g, '');
        const match = compact.match(/\d+/);

        if (!match) return 0;

        const count = parseInt(match[0], 10);

        if (!Number.isFinite(count) || count < 0) return 0;

        return count;
    }

    function getMadeformedPendingMessageCount() {
        if (!isMadeformed()) return 0;

        const counters = [
            ...document.querySelectorAll(SEL_MADEFORMED_MESSAGE_COUNTER)
        ];

        if (counters.length === 0) {
            return 0;
        }

        const visibleCounters = counters.filter(isVisible);
        const candidates = visibleCounters.length > 0 ? visibleCounters : counters;

        let maxCount = 0;

        for (const counter of candidates) {
            const count = parseMadeformedMessageCounterValue(
                counter.textContent ||
                counter.getAttribute('data-count') ||
                counter.getAttribute('aria-label') ||
                counter.getAttribute('title') ||
                ''
            );

            if (count > maxCount) {
                maxCount = count;
            }
        }

        return maxCount;
    }

    function getMadeformedBaseFaviconHref() {
        if (madeformedMessageFaviconBaseHref) {
            return madeformedMessageFaviconBaseHref;
        }

        const favicon = [
            ...document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')
        ].find(link => link.id !== 'tm-mf-message-counter-favicon' && link.href);

        madeformedMessageFaviconBaseHref =
            favicon && favicon.href
                ? favicon.href
                : new URL('/favicon.ico', location.origin).href;

        return madeformedMessageFaviconBaseHref;
    }

    function ensureMadeformedMessageFaviconLink() {
        let link = document.getElementById('tm-mf-message-counter-favicon');

        if (link) {
            return link;
        }

        link = document.createElement('link');
        link.id = 'tm-mf-message-counter-favicon';
        link.rel = 'icon';
        link.type = 'image/svg+xml';

        (document.head || document.documentElement).appendChild(link);

        return link;
    }

    function makeMadeformedMessageCountFavicon(count) {
        const safeCount = Math.max(0, Number(count) || 0);
        const label = safeCount > 99 ? '99+' : String(safeCount);
        const fontSize = label.length >= 3 ? 22 : label.length === 2 ? 28 : 38;

        const svg = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
            '<circle cx="32" cy="32" r="30" fill="#b480ff"/>',
            '<text x="32" y="34" text-anchor="middle" dominant-baseline="middle"',
            ` font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" fill="#000000">`,
            escapeHtml(label),
            '</text>',
            '</svg>'
        ].join('');

        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    }

    function restoreMadeformedBaseFavicon() {
        const link = document.getElementById('tm-mf-message-counter-favicon');

        if (!link) {
            return;
        }

        const baseHref = getMadeformedBaseFaviconHref();

        link.type = 'image/x-icon';
        link.href = baseHref;
    }

    function updateMadeformedMessageFavicon() {
        if (!isMadeformed()) return;

        const count = getMadeformedPendingMessageCount();

        if (count === madeformedMessageFaviconLastCount) {
            return;
        }

        madeformedMessageFaviconLastCount = count;

        if (count > 0) {
            const link = ensureMadeformedMessageFaviconLink();

            link.type = 'image/svg+xml';
            link.href = makeMadeformedMessageCountFavicon(count);

            return;
        }

        restoreMadeformedBaseFavicon();
    }

    function scheduleMadeformedMessageFaviconRefresh(delayMs = 120) {
        if (!isMadeformed()) return;

        if (madeformedMessageFaviconRefreshTimer) {
            clearTimeout(madeformedMessageFaviconRefreshTimer);
        }

        madeformedMessageFaviconRefreshTimer = setTimeout(() => {
            madeformedMessageFaviconRefreshTimer = null;
            updateMadeformedMessageFavicon();
        }, delayMs);
    }

    function setupMadeformedMessageFaviconWatcher() {
        if (!isMadeformed()) return;

        getMadeformedBaseFaviconHref();
        updateMadeformedMessageFavicon();

        if (!madeformedMessageFaviconObserver && document.body) {
            madeformedMessageFaviconObserver = new MutationObserver(() => {
                scheduleMadeformedMessageFaviconRefresh();
            });

            madeformedMessageFaviconObserver.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: [
                    'class',
                    'style',
                    'hidden',
                    'aria-hidden',
                    'data-count',
                    'title',
                    'aria-label'
                ]
            });
        }

        window.setInterval(() => {
            scheduleMadeformedMessageFaviconRefresh(0);
        }, 5000);

        window.addEventListener('focus', () => {
            scheduleMadeformedMessageFaviconRefresh(0);
        });

        document.addEventListener('visibilitychange', () => {
            scheduleMadeformedMessageFaviconRefresh(0);
        });
    }

    const MADEFORMED_MESSAGING_NAV_KEY = 'TM_MADEFORMED_MESSAGING_NAV_V1';
    const MADEFORMED_PRIMARY_MESSAGING_LABEL = 'Dr Ronez';
    const MADEFORMED_MESSAGING_NAV_HASH = '#tm-mf-open-messages=';
    const MADEFORMED_MESSAGING_NAV_MAX_AGE = 2 * 60 * 1000;
    let madeformedMessagingNavHash = '';
    let madeformedMessagingNavHashAt = 0;
    let madeformedMessagingNavTimer = null;
    let madeformedMessagingNavObserver = null;
    let madeformedMessagingNavQueued = false;
    const MADEFORMED_MESSAGING_COUNT_KEY = 'TM_MADEFORMED_MESSAGING_COUNT_V1';
    const MADEFORMED_MESSAGING_COUNT_MAX_AGE = 24 * 60 * 60 * 1000;
    let madeformedMessagingCountListenersInstalled = false;
    const madeformedMessagingBoundLinks = new WeakSet();

    function getMadeformedNativeMessagingLink() {
        const link = document.querySelector('nav.topbar .navbar-left .serv-msg:not(.tm-mf-global-messaging) a[href]');
        if (!link) return null;
        try {
            const href = link.getAttribute('data-tm-mf-native-messaging-href') || link.getAttribute('href');
            const url = new URL(href, location.origin);
            return url.origin === location.origin && url.pathname === '/messages' ? link : null;
        } catch (_) {
            return null;
        }
    }

    function getMadeformedMessagingContext(choice) {
        const proId = choice?.querySelector('[pro-id]')?.getAttribute('pro-id') || '';
        return proId + '|' + normalizeText(choice?.querySelector('.cab')?.textContent || choice?.title || '');
    }

    function getMadeformedPrimaryMessagingTarget() {
        const choices = Array.from(document.querySelectorAll('#envNav .choice'));
        // Le rang cabspro et l'ordre des onglets peuvent différer entre les postes.
        const normalizeLabel = text => normalizeText(text).replace(/^docteur\s+/, 'dr ').replace(/^dr\.\s*/, 'dr ');
        let matches = choices.filter(choice => normalizeLabel(choice.querySelector('.pro')?.textContent) ===
            normalizeLabel(MADEFORMED_PRIMARY_MESSAGING_LABEL));
        if (matches.length > 1) {
            const active = choices.find(choice => choice.classList.contains('active'));
            const cabinet = normalizeText(active?.querySelector('.cab')?.textContent);
            matches = cabinet ? matches.filter(choice => normalizeText(choice.querySelector('.cab')?.textContent) === cabinet) : [];
        }
        if (matches.length !== 1) return null;
        const primary = matches[0];
        const proId = primary.querySelector('[pro-id]')?.getAttribute('pro-id') || '';
        if (!/^\d+$/.test(proId)) return null;
        const href = primary.querySelector('a[href]')?.getAttribute('href');
        const active = primary.classList.contains('active');
        let url;
        try {
            if (active && href === '#') {
                const native = getMadeformedNativeMessagingLink();
                url = new URL(native?.getAttribute('data-tm-mf-native-messaging-href') ||
                    native?.getAttribute('href') || '/messages', location.origin);
                if (url.origin !== location.origin || url.pathname !== '/messages') return null;
            } else {
                url = new URL(href, location.origin);
                if (active || url.origin !== location.origin || url.pathname !== '/pros' ||
                    !/^\d+$/.test(url.searchParams.get('cabspro') || '')) return null;
            }
        } catch (_) { return null; }
        return {
            href: url.href,
            proId,
            contextKey: getMadeformedMessagingContext(primary),
            label: cleanText(primary.querySelector('.pro')?.textContent) || MADEFORMED_PRIMARY_MESSAGING_LABEL,
            needsSwitch: !active
        };
    }

    function getMadeformedMessagingNavigationHref(target) {
        const url = new URL(target.href, location.origin);
        if (target.needsSwitch) {
            // Le fragment accompagne aussi les clics qui ouvrent un nouvel onglet.
            // Il survit à la redirection native /pros vers /agenda, sans stockage requis.
            url.hash = MADEFORMED_MESSAGING_NAV_HASH + encodeURIComponent(JSON.stringify({
                proId: target.proId, contextKey: target.contextKey
            }));
        }
        return url.href;
    }

    function clearMadeformedMessagingNavigation() {
        try { sessionStorage.removeItem(MADEFORMED_MESSAGING_NAV_KEY); } catch (_) {}
        if ((location.hash || '').startsWith(MADEFORMED_MESSAGING_NAV_HASH)) {
            try {
                const url = new URL(location.href);
                url.hash = '';
                history.replaceState(history.state, '', url.href);
            } catch (_) {}
        }
        if (madeformedMessagingNavTimer !== null) clearTimeout(madeformedMessagingNavTimer);
        madeformedMessagingNavTimer = null;
        madeformedMessagingNavHash = '';
        madeformedMessagingNavHashAt = 0;
    }

    function getMadeformedMessagingNavigationIntent() {
        const hash = location.hash || '';
        let pending;
        try {
            if (hash.startsWith(MADEFORMED_MESSAGING_NAV_HASH)) {
                pending = JSON.parse(decodeURIComponent(hash.slice(MADEFORMED_MESSAGING_NAV_HASH.length)));
                if (typeof pending.contextKey !== 'string' || pending.contextKey.length > 1024 ||
                    !pending.contextKey.startsWith(pending.proId + '|')) throw new Error('Contexte invalide');
                if (hash !== madeformedMessagingNavHash) {
                    madeformedMessagingNavHash = hash;
                    madeformedMessagingNavHashAt = Date.now();
                    if (madeformedMessagingNavTimer !== null) clearTimeout(madeformedMessagingNavTimer);
                    madeformedMessagingNavTimer = setTimeout(() => {
                        clearMadeformedMessagingNavigation();
                        addLog('WARN', 'Ouverture Messagerie interrompue : environnement ou bouton natif indisponible');
                    }, MADEFORMED_MESSAGING_NAV_MAX_AGE);
                }
                pending.at = madeformedMessagingNavHashAt;
            } else {
                const stored = sessionStorage.getItem(MADEFORMED_MESSAGING_NAV_KEY);
                if (!stored) return null;
                pending = JSON.parse(stored);
            }
            const age = Date.now() - pending.at;
            if (!/^\d+$/.test(pending.proId) || !Number.isFinite(age) || age < 0 ||
                age > MADEFORMED_MESSAGING_NAV_MAX_AGE) throw new Error('Demande invalide ou périmée');
            return pending;
        } catch (_) {
            clearMadeformedMessagingNavigation();
            return null;
        }
    }

    function resumeMadeformedMessagingNavigation() {
        const pending = getMadeformedMessagingNavigationIntent();
        if (!pending) return false;
        const active = document.querySelector('#envNav .choice.active');
        if (!active || active.querySelector('[pro-id]')?.getAttribute('pro-id') !== pending.proId) return false;
        if (pending.contextKey && getMadeformedMessagingContext(active) !== pending.contextKey) {
            clearMadeformedMessagingNavigation();
            addLog('WARN', 'Ouverture Messagerie interrompue : cabinet différent de celui demandé');
            return false;
        }
        const link = getMadeformedNativeMessagingLink();
        // Un poste lent peut afficher le professionnel avant son bouton Messagerie.
        if (!link) return false;
        const url = new URL(link.getAttribute('data-tm-mf-native-messaging-href') || link.getAttribute('href'), location.origin);
        clearMadeformedMessagingNavigation();
        if (location.pathname === url.pathname && location.search === url.search) return false;
        location.assign(url.href);
        return true;
    }

    function parseMadeformedNativeMessageCount(data) {
        const value = data?.result;
        if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
        const count = Number(value);
        return Number.isSafeInteger(count) && count >= 0 ? count : null;
    }

    function getMadeformedSharedMessageCount(target) {
        try {
            const record = GM_getValue(MADEFORMED_MESSAGING_COUNT_KEY, null);
            const age = Date.now() - record?.at;
            if (!record || record.context !== target.contextKey ||
                parseMadeformedNativeMessageCount({ result: record.count }) === null ||
                !Number.isFinite(age) || age < 0 || age > MADEFORMED_MESSAGING_COUNT_MAX_AGE) return null;
            return record;
        } catch (_) {
            return null;
        }
    }

    function refreshMadeformedMessagingCount(forcePublish = false) {
        if (!isMadeformed()) return Promise.resolve(false);
        const target = getMadeformedPrimaryMessagingTarget();
        if (!target) return Promise.resolve(false);
        const nativeBadge = getMadeformedNativeMessagingLink()?.querySelector('.msg-counter');
        if (nativeBadge && !target.needsSwitch) {
            const text = cleanText(nativeBadge.textContent);
            const count = parseMadeformedNativeMessageCount({ result: text || 0 });
            const previous = getMadeformedSharedMessageCount(target);
            if (count !== null && (forcePublish === true || !previous || previous.count !== count)) {
                try {
                    // Partager uniquement le nombre natif de l'environnement principal, avec son cabinet.
                    GM_setValue(MADEFORMED_MESSAGING_COUNT_KEY, { context: target.contextKey, count, at: Date.now() });
                } catch (_) {
                    addLog('WARN', 'Partage du compteur Messagerie indisponible');
                }
            }
        }
        const badge = document.querySelector('.tm-mf-shared-messaging-link .tm-mf-message-counter');
        if (!badge) return Promise.resolve(Boolean(nativeBadge && !target.needsSwitch));
        const record = getMadeformedSharedMessageCount(target);
        const text = record ? (record.count > 0 ? String(record.count) : '') : '…';
        if (badge.textContent !== text) badge.textContent = text;
        const title = record
            ? record.count + ' message(s) non lus — dernier nombre reçu de ' + target.label
            : 'Ouvrir la messagerie de ' + target.label + ' pour actualiser le compteur';
        if (badge.title !== title) badge.title = title;
        return Promise.resolve(Boolean(record));
    }

    function bindMadeformedSharedMessagingLink(link) {
        if (madeformedMessagingBoundLinks.has(link)) return;
        madeformedMessagingBoundLinks.add(link);
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const current = getMadeformedPrimaryMessagingTarget();
            if (!current || (!current.needsSwitch && !link.closest('.tm-mf-global-messaging'))) return;
            event.preventDefault();
            event.stopPropagation();
            if (current.needsSwitch) {
                try {
                    sessionStorage.setItem(MADEFORMED_MESSAGING_NAV_KEY, JSON.stringify({ proId: current.proId, contextKey: current.contextKey, at: Date.now() }));
                } catch (_) {
                    // Le fragment du lien suffit, même si sessionStorage est bloqué.
                    addLog('INFO', 'Ouverture Messagerie par le lien, sans stockage de session');
                }
            }
            location.assign(getMadeformedMessagingNavigationHref(current));
        });
    }

    function refreshMadeformedMessagingNavigation() {
        if (!isMadeformed()) return false;
        const menu = document.querySelector('nav.topbar .navbar-left');
        if (!menu) return false;
        const native = getMadeformedNativeMessagingLink();
        const target = getMadeformedPrimaryMessagingTarget();
        // Seul l'environnement principal conserve son compteur natif comme source.
        if (native && (!target || !target.needsSwitch)) {
            menu.querySelectorAll('.tm-mf-global-messaging').forEach(node => node.remove());
            const savedHref = native.getAttribute('data-tm-mf-native-messaging-href');
            if (savedHref) {
                native.setAttribute('href', savedHref);
                native.removeAttribute('data-tm-mf-native-messaging-href');
                native.removeAttribute('title');
            }
            native.classList.remove('tm-mf-shared-messaging-link');
            const sharedBadge = native.querySelector('.tm-mf-message-counter');
            if (sharedBadge) {
                if (native.querySelector('.msg-counter')) sharedBadge.remove();
                else {
                    sharedBadge.classList.remove('tm-mf-message-counter');
                    sharedBadge.classList.add('msg-counter');
                    sharedBadge.removeAttribute('title');
                }
            }
            void refreshMadeformedMessagingCount();
            if (resumeMadeformedMessagingNavigation()) return true;
            return false;
        }
        if (resumeMadeformedMessagingNavigation()) return true;
        if (!target) return false;
        let item = native?.closest('li.serv-msg') || menu.querySelector('.tm-mf-global-messaging');
        if (native) menu.querySelectorAll('.tm-mf-global-messaging').forEach(node => node.remove());
        if (!item) {
            item = document.createElement('li');
            item.className = 'serv serv-msg tm-mf-global-messaging';
            const link = document.createElement('a');
            link.className = 'shortcut';
            link.innerHTML = '<span class="hide-mobile">Messagerie</span><i class="hide-desktop ri-question-answer-fill"></i>';
            item.append(link);
            const agenda = menu.querySelector('.serv-cal');
            if (agenda) agenda.after(item);
            else menu.append(item);
        }
        const link = native || item.querySelector('a');
        if (native && !link.hasAttribute('data-tm-mf-native-messaging-href')) {
            link.setAttribute('data-tm-mf-native-messaging-href', link.getAttribute('href'));
        }
        link.classList.add('tm-mf-shared-messaging-link');
        const ownBadge = link.querySelector('.msg-counter');
        if (ownBadge) {
            link.querySelector('.tm-mf-message-counter')?.remove();
            ownBadge.classList.remove('msg-counter');
            ownBadge.classList.add('tm-mf-message-counter');
        }
        if (!link.querySelector('.tm-mf-message-counter')) {
            const badge = document.createElement('span');
            badge.className = 'notif-badge-counter tm-mf-message-counter';
            link.append(badge);
        }
        const navigationHref = getMadeformedMessagingNavigationHref(target);
        if (link.getAttribute('href') !== navigationHref) link.setAttribute('href', navigationHref);
        const title = 'Ouvrir la messagerie de ' + target.label;
        if (link.title !== title) link.title = title;
        bindMadeformedSharedMessagingLink(link);
        void refreshMadeformedMessagingCount();
        return false;
    }

    function setupMadeformedMessagingNavigation() {
        if (!isMadeformed()) return false;
        if (refreshMadeformedMessagingNavigation()) return true;
        if (!madeformedMessagingCountListenersInstalled) {
            void refreshMadeformedMessagingCount(true);
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(MADEFORMED_MESSAGING_COUNT_KEY, () => {
                    void refreshMadeformedMessagingCount();
                });
            }
            window.addEventListener('focus', () => { void refreshMadeformedMessagingCount(); });
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) void refreshMadeformedMessagingCount();
            });
            madeformedMessagingCountListenersInstalled = true;
        }
        if (!madeformedMessagingNavObserver && document.body) {
            madeformedMessagingNavObserver = new MutationObserver(records => {
                const changed = records.some(record => {
                    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                    return target?.closest('nav.topbar') || Array.from(record.addedNodes || []).some(node =>
                        node.nodeType === 1 && (node.matches('nav.topbar') || node.querySelector('nav.topbar')));
                });
                if (!changed || madeformedMessagingNavQueued) return;
                madeformedMessagingNavQueued = true;
                requestAnimationFrame(() => {
                    madeformedMessagingNavQueued = false;
                    refreshMadeformedMessagingNavigation();
                });
            });
            madeformedMessagingNavObserver.observe(document.body, {
                childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ['class', 'href', 'pro-id']
            });
        }
        return false;
    }

    function madeformedMain() {
        if (setupMadeformedMessagingNavigation()) return;
        setupMadeformedCloseListener();
        refreshMadeformedPageClasses();
        setupSecretariatConsignes();
        setupMadeformedNativeTools();
        mfmGroupCallsSetup();

        window.setInterval(refreshMadeformedPageClasses, 1000);

        document.addEventListener('keydown', async function (e) {
            if (isLaunchShortcut(e)) {
                e.preventDefault();
                e.stopPropagation();

                await launchFromMadeformed(getLaunchShortcutLabel(e));
            }
        }, true);

        document.addEventListener('click', async function (e) {
            if (e.target && e.target.closest && e.target.closest('.tm-mf-consignes,.tm-mf-native-next,.tm-mf-native-actions,.tm-mf-native-overlay,.tm-mf-native-document-success,.tm-mf-call-group-header,.tm-mf-call-group-toggle')) return;

            if (await openWedaPatientFromMadeformedPatientHeader(e)) {
                return;
            }

            if (await openWedaPatientFromMadeformedMessages(e)) {
                return;
            }

            await openWedaPatientFromMadeformedAgenda(e);
        }, true);

        addLog('INFO', 'Script actif sur Madeformed', {
            raccourcis: [
                'PageDown'
            ],
            clicAgenda: 'clic sur le nom du patient dans un rendez-vous Madeformed',
            clicFichePatient: 'clic sur le nom du patient dans l’en-tête de fiche Madeformed',
            clicMessages: 'clic sur le nom du patient dans la liste messages Madeformed'
        });
    }

    function getClickableTarget(el) {
        if (!el) return null;

        if (
            el.matches('a, button, input[type="submit"], input[type="button"]')
        ) {
            return el;
        }

        const direct = el.querySelector('a, button, input[type="submit"], input[type="button"]');
        if (direct) return direct;

        const closest = el.closest('a, button, input[type="submit"], input[type="button"], tr[onclick], td[onclick], div[onclick], span[onclick]');
        if (closest) return closest;

        return el;
    }

    function normalizeDateText(value) {
        return cleanText(value).replace(/[.\-]/g, '/');
    }

    function getPatientCandidateText(el) {
        if (!el) return '';

        const container =
            el.closest('tr') ||
            el.closest('li') ||
            el.closest('table') ||
            el.parentElement ||
            el;

        return cleanText([
            el.textContent || '',
            el.value || '',
            el.getAttribute ? el.getAttribute('title') || '' : '',
            container && container !== el ? container.textContent || '' : ''
        ].join(' '));
    }

    /* BEGIN MFM_WEDA_PATIENT_GUARDS */
    const WEDA_PATIENT_TAB_JOB_KEY = 'TM_MFM_WEDA_PATIENT_TAB_JOB_V1';
    const WEDA_PATIENT_DOCUMENT_TOKEN = Date.now() + '_' + Math.random().toString(36).slice(2);
    let wedaPatientTabJob = '';
    let wedaPatientSelectionInstalled = false;

    function wedaPatientNameKey(value) {
        return normalizeText(String(value || '')).replace(/^(?:mme|mr|m|mlle|monsieur|madame)\.?\s+/, '')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function wedaPatientBirthDateKey(value) {
        const text = cleanText(String(value || ''));
        let parts = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
        if (parts) parts = [parts[3], parts[2], parts[1]];
        else { const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/); parts = iso ? iso.slice(1) : null; }
        if (!parts) return '';
        const [year, month, day] = parts.map(Number), date = new Date(0);
        date.setUTCFullYear(year,month-1,day);
        if (year < 1 || month < 1 || month > 12 || day < 1 || date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
        return String(year).padStart(4,'0') + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    }

    function wedaPatientNativeId(href = location.href) {
        try {
            const url = new URL(href, location.href), ids = url.searchParams.getAll('PatDk');
            return url.origin === location.origin && !url.username && !url.password &&
                /^\/foldermedical\//i.test(url.pathname) && ids.length === 1 ? ids[0] : '';
        } catch (_) { return ''; }
    }

    function wedaPatientNativeLinks() {
        const native = [...document.querySelectorAll(SEL_WEDA_PATIENT_OLD_GRID_LINK +
            ',a[id^="ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonPatientGetNomPrenom_"]')];
        const links = native.length ? native : [...document.querySelectorAll('[id*="PatientsGrid"] a[href]')]
            .filter(link => Boolean(wedaPatientNativeId(link.getAttribute('href'))));
        return [...new Set(links)].filter(link => {
            const href = (link.getAttribute('href') || '').trim();
            const nativePostback = native.includes(link) && /^javascript:\s*(?:__doPostBack|WebForm_DoPostBackWithOptions)\s*\(/i.test(href);
            return link.isConnected && isVisible(link) && (Boolean(wedaPatientNativeId(href)) || nativePostback);
        });
    }

    function wedaPatientCandidate(link) {
        const row = link.closest('tr') || link.closest('li') || link.parentElement || link;
        const values = [];
        for (const node of [link,row,...row.querySelectorAll('[data-ddn],[data-dob],[data-date-naissance],[id*="DateNaissance"],[id*="DateNaiss"],[id*="BirthDate"]')]) {
            for (const key of ['data-ddn','data-dob','data-date-naissance']) {
                const value = node.getAttribute?.(key); if (value) values.push(value);
            }
            if (node !== link && node !== row) values.push(node.value || node.textContent || '');
        }
        if (!values.length) {
            // Adjacent native table cells concatenate in textContent without a space.
            // Read their own text so a birth date following the name stays identifiable.
            const cells = [...row.querySelectorAll('td,th')];
            const text = cells.length ? cells.map(cell => cell.textContent || '').join(' ') : row.textContent || '';
            values.push(...(text.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g) || []));
        }
        const dates = [...new Set(values.map(wedaPatientBirthDateKey).filter(Boolean))];
        return {link, name:wedaPatientNameKey(link.textContent || link.value || ''), dates,
            invalidDate:values.some(value => !wedaPatientBirthDateKey(value)),
            patDk:wedaPatientNativeId(link.getAttribute('href') || '')};
    }

    function wedaPatientMatch(patientName, dateOfBirth = '') {
        const wanted = wedaPatientNameKey(patientName), wantedDate = wedaPatientBirthDateKey(dateOfBirth);
        const candidates = wanted ? wedaPatientNativeLinks().map(wedaPatientCandidate).filter(item => item.name === wanted) : [];
        if (!wanted || (cleanText(dateOfBirth) && !wantedDate)) return {target:null,candidates,reason:'invalid_identity'};
        if (!candidates.length) return {target:null,candidates,reason:'not_found'};
        if (candidates.length > 1) return {target:null,candidates,reason:'ambiguous'};
        const item = candidates[0];
        if (wantedDate && (item.invalidDate || item.dates.length > 1 || (item.dates.length && item.dates[0] !== wantedDate))) {
            return {target:null,candidates,reason:'birth_conflict'};
        }
        if (wantedDate && !item.dates.length) return {target:null,candidates,reason:'birth_missing'};
        return {target:item.link,candidates,reason:'unique'};
    }

    function findPatientResultTarget(patientName, dateOfBirth = '') {
        return wedaPatientMatch(patientName,dateOfBirth).target;
    }

    function wedaPatientNotice(text, buttonLabel = '', onClick = null) {
        let box = document.getElementById('tm-mf-weda-patient-review');
        if (!box) {
            box = document.createElement('div'); box.id = 'tm-mf-weda-patient-review'; box.setAttribute('role','status');
            box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;padding:12px;background:#fff7ed;color:#7c2d12;border:1px solid #fdba74;border-radius:8px;font:14px/1.45 sans-serif';
            document.body.append(box);
        }
        box.textContent = text;
        if (buttonLabel && onClick) {
            const button = document.createElement('button'); button.type='button'; button.textContent=buttonLabel;
            button.style.cssText='display:block;margin-top:10px;padding:6px;cursor:pointer';
            button.addEventListener('click',() => { button.disabled=true; try { onClick(); } catch (_) { button.disabled=false; } });
            box.append(button);
        }
    }

    function wedaPatientHideNotice() { document.getElementById('tm-mf-weda-patient-review')?.remove(); }

    function wedaPatientTabBinding() {
        const incoming = new URL(location.href).searchParams.get('tmJob') || '';
        if (incoming) {
            if (wedaPatientTabJob && incoming !== wedaPatientTabJob) return '';
            wedaPatientTabJob = incoming;
            try { sessionStorage.setItem(WEDA_PATIENT_TAB_JOB_KEY,incoming); } catch (_) {}
        }
        if (!wedaPatientTabJob) {
            try { wedaPatientTabJob = sessionStorage.getItem(WEDA_PATIENT_TAB_JOB_KEY) || ''; } catch (_) {}
        }
        return wedaPatientTabJob;
    }

    function wedaPatientStop(job, status, message) {
        const latest = getJob();
        if (latest?.id === job?.id && wedaPatientTabBinding() === job.id) updateJob({status});
        wedaPatientNotice(message);
        const error = new Error(message); error.code = 'WEDA_PATIENT_GUARD'; throw error;
    }

    function wedaPatientRequire(job, patient = false, consultation = false) {
        const latest = getJob();
        if (!job?.id || latest?.id !== job.id || wedaPatientTabBinding() !== job.id || latest.sensitiveDataExpiredAt || latest.status === 'expired_unknown') {
            wedaPatientNotice('Le transfert de cet onglet a changé ou est périmé. Aucune écriture automatique ne sera effectuée.');
            const error = new Error('Tâche WEDA ou onglet changé.'); error.code = 'WEDA_PATIENT_GUARD'; throw error;
        }
        if (patient && (!latest.wedaPatDk || isWedaFindPatientPage() || wedaPatientNativeId() !== latest.wedaPatDk)) {
            return wedaPatientStop(latest,'error_patient_changed','Le dossier patient WEDA a changé. Le transfert est arrêté ; vérifiez le dossier avant de reprendre.');
        }
        if (patient && wedaPatientOpenedMatch(latest) === 'conflict') {
            return wedaPatientStop(latest,'error_patient_selection_conflict','L’identité affichée dans WEDA ne correspond pas au patient sélectionné. Le transfert est arrêté.');
        }
        if (latest.wedaExpectedPatientKey && latest.wedaExpectedPatientKey !==
            wedaPatientNameKey(latest.patientName) + '|' + wedaPatientBirthDateKey(latest.dateOfBirth || '')) {
            return wedaPatientStop(latest,'error_patient_selection_conflict','L’identité du patient à transférer a changé. Le transfert est arrêté.');
        }
        if (consultation && (!latest.wedaConsultationIdentity || wedaPatientConsultationIdentity() !== latest.wedaConsultationIdentity)) {
            return wedaPatientStop(latest,'error_consultation_changed','La consultation WEDA a changé. Le transfert est arrêté ; aucune autre consultation ne sera modifiée.');
        }
        return latest;
    }

    function wedaPatientWait(job, predicate, timeout = 15000, patient = false, consultation = false) {
        return waitFor(() => { wedaPatientRequire(job,patient,consultation); return predicate(); },timeout);
    }

    function wedaPatientRecordSelection(job, link, manual = false) {
        job = wedaPatientRequire(job);
        if (!isWedaFindPatientPage() || !link?.isConnected || !isVisible(link) || !wedaPatientNativeLinks().includes(link)) {
            return wedaPatientStop(job,'error_patient_selection_unverified','Le résultat patient n’est plus disponible. Relancez la recherche dans cet onglet.');
        }
        const item = wedaPatientCandidate(link), wantedDate = wedaPatientBirthDateKey(job.dateOfBirth || '');
        if (!item.name || item.name !== wedaPatientNameKey(job.patientName) ||
            (cleanText(job.dateOfBirth || '') && !wantedDate) ||
            (wantedDate && (item.invalidDate || item.dates.length > 1 || (item.dates.length && item.dates[0] !== wantedDate)))) {
            return wedaPatientStop(job,'error_patient_selection_conflict','Le nom ou la date de naissance du résultat choisi ne correspond pas. Aucun transfert ne sera effectué.');
        }
        if (!manual && (!wedaPatientMatch(job.patientName,job.dateOfBirth || '').target || (wantedDate && !item.dates.length))) {
            return wedaPatientStop(job,'awaiting_patient_selection','Plusieurs dossiers ou une identité incomplète : choisissez le patient après vérification dans WEDA.');
        }
        if (manual && wantedDate && !item.dates.length && !window.confirm('La date de naissance n’est pas affichée dans ce résultat WEDA. Avez-vous vérifié qu’il s’agit du bon patient avant de poursuivre le transfert ?')) return false;
        return updateJob({status:'patient_clicked',patientClickedAt:Date.now(),wedaSelectedName:item.name,
            wedaSelectedBirthDate:item.dates[0] || '',wedaSelectedPatDk:item.patDk,
            wedaExpectedPatientKey:wedaPatientNameKey(job.patientName) + '|' + wantedDate,
            wedaPatientSelectionAt:Date.now(),wedaPatientSelectionDocument:WEDA_PATIENT_DOCUMENT_TOKEN,
            wedaPatientSelectionManual:manual,wedaPatDk:'',wedaConsultationIdentity:''});
    }

    function wedaPatientInstallSelection() {
        if (wedaPatientSelectionInstalled) return;
        wedaPatientSelectionInstalled = true;
        document.addEventListener('click', event => {
            const job = getJob();
            if (!job || job.status !== 'awaiting_patient_selection' || !isWedaFindPatientPage() ||
                wedaPatientTabBinding() !== job.id || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const link = event.target?.closest?.('a');
            if (!link || !wedaPatientNativeLinks().includes(link)) return;
            try {
                if (!wedaPatientRecordSelection(job,link,true)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
                wedaPatientHideNotice();
                scheduleWedaMainRetry('après choix patient manuel',1200);
            } catch (_) { event.preventDefault(); event.stopImmediatePropagation(); }
        },true);
    }

    function wedaPatientOpenedIdentity() {
        const read = id => {
            const nodes = [...document.querySelectorAll('#ContentPlaceHolder1_EtatCivilUCForm1_' + id)]
                .filter(node => node.isConnected && isVisible(node));
            return nodes.length === 1 ? cleanText(nodes[0].textContent || nodes[0].value || '') : '';
        };
        const last = read('LabelPatientNom'), first = read('LabelPatientPrenom'), birthRaw = read('LabelPatientDateNaissance');
        return {name:last && first ? wedaPatientNameKey(last + ' ' + first) : '',
            birthDate:wedaPatientBirthDateKey(birthRaw),invalidBirth:Boolean(birthRaw && !wedaPatientBirthDateKey(birthRaw))};
    }

    function wedaPatientOpenedMatch(job) {
        const opened = wedaPatientOpenedIdentity(), expectedBirth = wedaPatientBirthDateKey(job.dateOfBirth || '') || job.wedaSelectedBirthDate || '';
        if ((opened.name && opened.name !== wedaPatientNameKey(job.patientName)) ||
            (expectedBirth && (opened.invalidBirth || (opened.birthDate && opened.birthDate !== expectedBirth)))) return 'conflict';
        return opened.name && expectedBirth && opened.birthDate === expectedBirth ? 'match' : 'unknown';
    }

    function wedaPatientConfirmOpened(job) {
        job = wedaPatientRequire(job);
        if (job.status !== 'awaiting_patient_confirmation' || !job.wedaPendingPatDk ||
            wedaPatientNativeId() !== job.wedaPendingPatDk || isWedaFindPatientPage()) {
            return wedaPatientStop(job,'error_patient_changed','La fiche ouverte a changé depuis la demande de vérification. Aucun transfert effectué.');
        }
        if (wedaPatientOpenedMatch(job) === 'conflict') return wedaPatientStop(job,'error_patient_selection_conflict','Le nom ou la date de naissance affichée dans WEDA ne correspond pas. Aucun transfert effectué.');
        const confirmed = updateJob({status:'patient_clicked',wedaPatDk:job.wedaPendingPatDk,
            wedaOpenedPatientConfirmedAt:Date.now(),wedaPendingPatDk:''});
        wedaPatientHideNotice();scheduleWedaMainRetry('après confirmation du dossier ouvert',0);return confirmed;
    }

    function wedaPatientAwaitOpened(job, patDk) {
        job = wedaPatientRequire(job);
        const pending = job.status === 'awaiting_patient_confirmation' ? job :
            updateJob({status:'awaiting_patient_confirmation',wedaPendingPatDk:patDk});
        const birth = cleanText(job.dateOfBirth || job.wedaSelectedBirthDate || '');
        wedaPatientNotice('Le résultat sélectionné n’a pas fourni d’identifiant de dossier. Vérifiez dans la fiche WEDA ouverte le nom « ' +
            (job.patientNameRaw || job.patientName) + ' »' + (birth ? ' et la date de naissance « ' + birth + ' »' : '') +
            ', puis confirmez ce dossier avant de poursuivre le transfert.', 'Dossier vérifié : poursuivre', () => wedaPatientConfirmOpened(pending));
        return null;
    }

    function wedaPatientBind(job) {
        job = wedaPatientRequire(job);
        if (job.wedaPatDk) return wedaPatientRequire(job,true);
        const patDk = wedaPatientNativeId();
        if (!job.wedaPatientSelectionAt || !job.wedaSelectedName || !patDk || isWedaFindPatientPage() ||
            job.wedaSelectedName !== wedaPatientNameKey(job.patientName) ||
            (job.wedaSelectedPatDk && job.wedaSelectedPatDk !== patDk) ||
            (!job.wedaSelectedPatDk && job.wedaPatientSelectionDocument === WEDA_PATIENT_DOCUMENT_TOKEN)) {
            return wedaPatientStop(job,'error_patient_selection_unverified','Le dossier ouvert ne peut pas être relié au résultat choisi. Revenez à la recherche patient ; aucun transfert effectué.');
        }
        const opened = wedaPatientOpenedMatch(job);
        if (opened === 'conflict') return wedaPatientStop(job,'error_patient_selection_conflict','La fiche WEDA ouverte ne correspond pas au nom ou à la date de naissance sélectionnés. Aucun transfert effectué.');
        if (!job.wedaSelectedPatDk && opened !== 'match') return wedaPatientAwaitOpened(job,patDk);
        return updateJob({wedaPatDk:patDk});
    }

    function wedaPatientConsultationIdentity(href = location.href) {
        try {
            const url = new URL(href,location.href);
            if (url.origin !== location.origin || url.pathname.toLowerCase() !== '/foldermedical/consultationform.aspx') return '';
            url.searchParams.delete('tmJob'); url.searchParams.sort(); url.hash = '';
            return url.href;
        } catch (_) { return ''; }
    }

    function wedaPatientBindConsultation(job) {
        job = wedaPatientRequire(job,true);
        if (job.wedaConsultationIdentity) return wedaPatientRequire(job,true,true);
        const identity = wedaPatientConsultationIdentity();
        if (!identity || !job.wedaNewConsultationRequestedAt || Date.now()-job.wedaNewConsultationRequestedAt > 30000 ||
            !job.wedaNewConsultationOrigin || !job.wedaNewConsultationDocument ||
            (job.wedaNewConsultationOrigin === identity && job.wedaNewConsultationDocument === WEDA_PATIENT_DOCUMENT_TOKEN)) {
            return wedaPatientStop(job,'error_consultation_unverified','La nouvelle consultation ne peut pas être reliée à ce transfert. Aucune consultation existante ne sera modifiée.');
        }
        return updateJob({wedaConsultationIdentity:identity});
    }
    /* END MFM_WEDA_PATIENT_GUARDS */

    function scheduleWedaMainRetry(reason, delayMs = 1200) {
        addLog('INFO', 'Relance WEDA programmée', {
            reason,
            delayMs
        });

        setTimeout(() => {
            wedaRunning = false;
            wedaMain();
        }, delayMs);
    }

    async function ensureWedaSearchModePatientName() {
        const select = await waitFor(() => document.querySelector(SEL_WEDA_SEARCH_MODE_SELECT), 7000);

        if (!select) {
            addLog('WARN', 'Menu déroulant de type de recherche WEDA introuvable, poursuite de la recherche par nom', {
                selector: SEL_WEDA_SEARCH_MODE_SELECT
            });
            return true;
        }

        const currentValue = String(select.value || '');

        if (currentValue === WEDA_SEARCH_MODE_PATIENT_NAME) {
            addLog('INFO', 'Menu de recherche WEDA déjà sur Recherche d’une fiche patient', {
                value: currentValue
            });
            return true;
        }

        addLog('INFO', 'Correction du menu de recherche WEDA avant saisie du nom', {
            previousValue: currentValue,
            nextValue: WEDA_SEARCH_MODE_PATIENT_NAME
        });

        try {
            select.focus();
        } catch (_) {}

        select.value = WEDA_SEARCH_MODE_PATIENT_NAME;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));

        /*
         * WEDA déclenche normalement un __doPostBack sur ce changement.
         * On ne colle pas le nom tout de suite pour éviter de saisir pendant le rechargement ASP.NET.
         * Le job reste en open_search et wedaMain relancera la recherche après stabilisation.
         */
        scheduleWedaMainRetry('après correction du menu de recherche WEDA sur Nom', 1800);

        return false;
    }

    async function submitWedaSearch(job) {
        job = wedaPatientRequire(job);
        wedaPatientInstallSelection();
        addLog('INFO', 'Étape WEDA : recherche patient', {
            patientName: job.patientName,
            dateOfBirth: job.dateOfBirth || '',
            action: job.action || ''
        });

        const searchModeReady = await ensureWedaSearchModePatientName();

        if (!searchModeReady) {
            return;
        }

        const input = await wedaPatientWait(job,() => document.querySelector(SEL_WEDA_SEARCH_INPUT),15000);
        job = wedaPatientRequire(job);

        if (!input) {
            addLog('ERROR', 'Barre de recherche patient WEDA introuvable', {
                selector: SEL_WEDA_SEARCH_INPUT
            });

            updateJob({ status: 'error_search_input_not_found' });
            return;
        }

        input.focus();
        setNativeValue(input, job.patientName);

        await sleep(300);

        job = wedaPatientRequire(job);
        const btn = document.querySelector(SEL_WEDA_SEARCH_BUTTON);

        updateJob({
            status: 'search_submitted',
            searchSubmittedAt: Date.now()
        });

        if (btn) {
            realClick(btn);
            addLog('INFO', 'Recherche WEDA lancée par bouton');
        } else {
            input.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter'
            }));

            input.dispatchEvent(new KeyboardEvent('keyup', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter'
            }));

            addLog('INFO', 'Recherche WEDA lancée par Entrée');
        }

        scheduleWedaMainRetry('après lancement recherche patient', 1200);
    }

    async function clickWedaPatient(job) {
        job = wedaPatientRequire(job);
        wedaPatientInstallSelection();
        let target;
        try {
            target = await wedaPatientWait(job,() => {
                const match = wedaPatientMatch(job.patientName,job.dateOfBirth || '');
                if (['ambiguous','birth_missing'].includes(match.reason)) {
                    updateJob({status:'awaiting_patient_selection'});
                    wedaPatientNotice('Choisissez dans les résultats WEDA le patient dont vous avez vérifié le nom et la date de naissance. Le transfert attend votre choix.');
                    const error = new Error('Choix patient nécessaire.'); error.code='WEDA_PATIENT_SELECTION_REQUIRED'; throw error;
                }
                if (['birth_conflict','invalid_identity'].includes(match.reason)) return wedaPatientStop(job,'error_patient_selection_conflict','Le nom ou la date de naissance du résultat WEDA ne correspond pas. Aucun transfert ne sera effectué.');
                return match.target;
            },15000);
        } catch (error) { if (error.code==='WEDA_PATIENT_SELECTION_REQUIRED') return; throw error; }
        job = wedaPatientRequire(job);
        if (!target) {
            const elapsed = Date.now() - (job.searchSubmittedAt || job.createdAt || Date.now());
            if (elapsed < 25000 && isWedaFindPatientPage()) { scheduleWedaMainRetry('résultat patient non prêt',1500); return; }
            updateJob({status:'error_patient_not_found'});
            wedaPatientNotice('Aucun résultat patient natif exact trouvé. Vérifiez le nom et relancez la recherche.'); return;
        }
        if (!wedaPatientRecordSelection(job,target,false)) return;
        wedaPatientHideNotice();
        target.click();
        addLog('INFO','Résultat patient WEDA exact sélectionné',{manual:false,hasBirthDate:Boolean(job.dateOfBirth)});
    }

    async function clickNewConsultation(job) {
        job = wedaPatientBind(job);
        if (!job) return;
        const newConsultBtn = await wedaPatientWait(job,() => document.querySelector(SEL_WEDA_NEW_CONSULT),20000,true);
        job = wedaPatientRequire(job,true);
        if (!newConsultBtn) { updateJob({status:'error_new_consult_not_found'}); return; }
        if (!newConsultBtn.isConnected || newConsultBtn.disabled || !isVisible(newConsultBtn)) return wedaPatientStop(job,'error_new_consult_not_found','L’action Nouvelle consultation a changé. Aucun document créé.');
        const linkPatient = wedaPatientNativeId(newConsultBtn.getAttribute?.('href') || '');
        if (linkPatient && linkPatient !== job.wedaPatDk) return wedaPatientStop(job,'error_patient_changed','L’action Nouvelle consultation concerne un autre dossier. Le transfert est arrêté.');
        updateJob({status:'consultation_clicked',consultationClickedAt:Date.now(),
            wedaNewConsultationRequestedAt:Date.now(),wedaNewConsultationOrigin:location.href,
            wedaNewConsultationDocument:WEDA_PATIENT_DOCUMENT_TOKEN});
        wedaPatientRequire(job,true);
        newConsultBtn.click();
        addLog('INFO','Nouvelle consultation cliquée après contrôle du dossier');
        scheduleWedaMainRetry('après clic nouvelle consultation',1200);
    }

    function escapeHtml(str) {
        return (str || '')
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

        const candidates = [
            ...doc.querySelectorAll('body[contenteditable="true"], [contenteditable="true"]')
        ];

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

        const iframes = [...document.querySelectorAll('iframe')];

        for (const iframe of iframes) {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;

                ctx = findEditableContextInDocument(doc);

                if (ctx) return ctx;
            } catch (_) {}
        }

        return null;
    }

    function insertMessageInEditor(ctx, message, expectedJob = getJob()) {
        wedaPatientRequire(expectedJob,true,true);
        if (!ctx?.el?.isConnected) return wedaPatientStop(expectedJob,'error_editor_changed','L’éditeur de consultation a changé. Aucune insertion effectuée.');
        const { doc, el } = ctx;

        const html =
            '<p><br></p>' +
            '<p>' +
            textToHtmlWithBreaks(message) +
            '</p>';

        el.focus();
        wedaPatientRequire(expectedJob,true,true);

        try {
            const selection = doc.getSelection();
            const range = doc.createRange();

            range.selectNodeContents(el);
            range.collapse(true);

            selection.removeAllRanges();
            selection.addRange(range);

            wedaPatientRequire(expectedJob,true,true);
            doc.execCommand('insertHTML', false, html);
            addLog('INFO', 'Message inséré par execCommand');
        } catch (err) {
            if (err.code === 'WEDA_PATIENT_GUARD') throw err;
            wedaPatientRequire(expectedJob,true,true);
            addLog('WARN', 'Insertion execCommand échouée, fallback innerHTML');
            el.innerHTML = html + el.innerHTML;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));

        addLog('INFO', 'Message inséré dans la zone consultation');
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

    function getEditorPlainText(ctx) {
        if (!ctx || !ctx.el) return '';

        return normalizeEditorCompareText(
            ctx.el.innerText ||
            ctx.el.textContent ||
            ctx.el.innerHTML ||
            ''
        );
    }

    function editorContainsMessage(ctx, message) {
        const haystack = getEditorPlainText(ctx);
        const target = normalizeEditorCompareText(message);

        if (!haystack || !target) return false;

        if (haystack.includes(target)) return true;

        if (target.length <= 120) {
            return false;
        }

        const head = target.slice(0, 90);
        const tail = target.slice(-90);

        return haystack.includes(head) && haystack.includes(tail);
    }

    async function ensureMessageStillPresentBeforeSave(ctx, message, job = getJob()) {
        await sleep(250);
        wedaPatientRequire(job,true,true);

        if (editorContainsMessage(ctx, message)) {
            addLog('INFO', 'Vérification avant sauvegarde : message toujours présent dans l’éditeur');
            return true;
        }

        addLog('WARN', 'Vérification avant sauvegarde : message absent, réinsertion de sécurité');

        wedaPatientRequire(job,true,true);
        insertMessageInEditor(ctx, message);

        await sleep(250);
        wedaPatientRequire(job,true,true);

        if (editorContainsMessage(ctx, message)) {
            addLog('INFO', 'Réinsertion de sécurité réussie');
            return true;
        }

        addLog('ERROR', 'Message introuvable dans l’éditeur après réinsertion de sécurité');

        return false;
    }

    async function saveConsultationOnly() {
        if (wedaSaveOnlyRunning) {
            addLog('INFO', 'Sauvegarde déjà en cours : appel saveConsultationOnly ignoré');
            return;
        }

        wedaSaveOnlyRunning = true;

        try {
            let latestJob = getJob();

            if (!latestJob) {
                addLog('WARN', 'Sauvegarde seule annulée : job absent');
                return;
            }

            if (latestJob.status === 'saved_pending_close') {
                addLog('INFO', 'Sauvegarde seule ignorée : consultation déjà enregistrée');
                return;
            }

            latestJob = wedaPatientRequire(latestJob,true,true);
            updateJob({
                status: 'consultation_saving',
                savingAt: Date.now()
            });

            const saveBtn = await wedaPatientWait(latestJob,() => document.querySelector(SEL_WEDA_SAVE),15000,true,true);
            latestJob = wedaPatientRequire(latestJob,true,true);

            if (!saveBtn) {
                addLog('ERROR', 'Bouton Enregistrer introuvable', {
                    selector: SEL_WEDA_SAVE
                });

                updateJob({ status: 'error_save_button_not_found' });
                return;
            }

            updateJob({
                status: 'saved_pending_close',
                savedAt: Date.now()
            });

            wedaPatientRequire(latestJob,true,true);
            realClick(saveBtn,() => wedaPatientRequire(latestJob,true,true));

            addLog('INFO', 'Consultation enregistrée');

            await sleep(3000);

            wedaPatientRequire(latestJob,true);
            closeWedaTab(latestJob);
        } finally {
            wedaSaveOnlyRunning = false;
        }
    }

    async function fillConsultationAndSave(job) {
        const latestJob = wedaPatientRequire(job,true);

        if (!latestJob) {
            addLog('WARN', 'Remplissage consultation annulé : job absent');
            return;
        }

        if (latestJob.status !== 'consultation_clicked') {
            addLog('WARN', 'Remplissage consultation ignoré : statut déjà traité ou en cours', {
                status: latestJob.status
            });
            return;
        }

        job = latestJob;

        if (!isWedaConsultationPage()) {
            const elapsed = Date.now() - (job.consultationClickedAt || Date.now());

            if (elapsed < 30000) {
                addLog('INFO', 'Page consultation pas encore chargée, attente navigation', {
                    elapsed,
                    url: location.href
                });

                scheduleWedaMainRetry('attente page ConsultationForm', 1000);
                return;
            }

            addLog('ERROR', 'Page consultation non atteinte après clic', {
                elapsed,
                url: location.href
            });

            updateJob({ status: 'error_consultation_page_not_reached' });
            return;
        }

        addLog('INFO', 'Étape WEDA : recherche éditeur consultation');

        job = wedaPatientBindConsultation(job);
        const ctx = await wedaPatientWait(job,() => findWedaEditorContext(),20000,true,true);
        job = wedaPatientRequire(job,true,true);

        if (!ctx) {
            addLog('ERROR', 'Zone de texte consultation introuvable', {
                url: location.href,
                iframesCount: document.querySelectorAll('iframe').length
            });

            updateJob({ status: 'error_editor_not_found' });
            return;
        }

        const beforeInsertJob = getJob();

        if (!beforeInsertJob || beforeInsertJob.status !== 'consultation_clicked') {
            addLog('WARN', 'Insertion annulée : statut modifié avant collage', {
                status: beforeInsertJob ? beforeInsertJob.status : null
            });
            return;
        }

        job = wedaPatientRequire(job,true,true);

        updateJob({
            status: 'consultation_filling',
            fillingAt: Date.now()
        });

        wedaPatientRequire(job,true,true);
        insertMessageInEditor(ctx, job.message);

        const messageStillPresent = await ensureMessageStillPresentBeforeSave(ctx, job.message, job);
        job = wedaPatientRequire(job,true,true);

        if (!messageStillPresent) {
            updateJob({ status: 'error_message_disappeared_before_save' });
            return;
        }

        updateJob({
            status: 'consultation_saving',
            filledAt: Date.now(),
            savingAt: Date.now()
        });

        await sleep(250);

        await saveConsultationOnly();
    }

    function closeWedaTab(expectedJob = getJob()) {
        const job = wedaPatientRequire(expectedJob,true);
        const jobId = job && job.id ? job.id : '';

        addLog('INFO', 'Fermeture automatique de l’onglet WEDA demandée', {
            jobId
        });

        if (jobId) {
            GM_setValue(CLOSE_KEY, {
                jobId,
                reason: 'consultation_saved',
                requestedAt: Date.now()
            });

            addLog('INFO', 'Demande de fermeture transmise à Madeformed', {
                jobId
            });
        }

        clearJob();

        setTimeout(() => {
            const latest = getJob();
            if ((latest && latest.id !== jobId) || wedaPatientNativeId() !== job.wedaPatDk ||
                (job.wedaConsultationIdentity && wedaPatientConsultationIdentity() !== job.wedaConsultationIdentity)) return;
            try {
                if (typeof GM_closeTab === 'function') {
                    addLog('INFO', 'Fermeture locale via GM_closeTab');
                    GM_closeTab();
                    return;
                }
            } catch (err) {
                addLog('WARN', 'GM_closeTab local indisponible ou échoué', {
                    message: err && err.message ? err.message : String(err)
                });
            }

            try {
                if (typeof GM !== 'undefined' && GM && typeof GM.closeTab === 'function') {
                    addLog('INFO', 'Fermeture locale via GM.closeTab');
                    GM.closeTab();
                    return;
                }
            } catch (err) {
                addLog('WARN', 'GM.closeTab local indisponible ou échoué', {
                    message: err && err.message ? err.message : String(err)
                });
            }

            try {
                addLog('INFO', 'Fallback fermeture locale via window.close');
                window.open('', '_self');
                window.close();
            } catch (err) {
                addLog('WARN', 'window.close impossible', {
                    message: err && err.message ? err.message : String(err)
                });
            }

            setTimeout(() => {
                try {
                    document.title = '✅ WEDA enregistré - fermeture demandée';
                    if (!document.getElementById('tm-mf-weda-close-fallback-banner')) {
                        document.body.insertAdjacentHTML(
                            'afterbegin',
                            '<div id="tm-mf-weda-close-fallback-banner" style="position:fixed;z-index:2147483647;top:12px;left:12px;background:#111827;color:white;padding:10px 12px;border-radius:8px;font-family:Arial,sans-serif;font-size:13px;">✅ Consultation enregistrée. Fermeture demandée depuis Madeformed. Si cet onglet reste ouvert, fermez-le manuellement.</div>'
                        );
                    }
                } catch (_) {}
            }, 800);
        }, 800);
    }

    let wedaRunning = false;
    let wedaSaveOnlyRunning = false;

    async function wedaMain() {
        if (wedaRunning) return;
        wedaRunning = true;

        try {
            let job = getJob();

            if (!job) return;
            if (job.sensitiveDataExpiredAt || job.status === 'expired_unknown') {
                // Ne jamais reprendre une tâche périmée, même une ouverture seule libérée.
                return;
            }
            job = wedaPatientRequire(job);
            if (Date.now() - job.createdAt > 20 * 60 * 1000) {
                return;
            }

            addLog('INFO', 'Tâche WEDA active', safeJobForLog(job));

            if (job.status === 'open_search') {
                if (!isWedaFindPatientPage()) {
                    addLog('INFO', 'Redirection vers recherche patient WEDA');
                    location.href = WEDA_FIND_PATIENT_URL;
                    return;
                }

                await submitWedaSearch(job);
                return;
            }

            if (job.status === 'search_submitted') {
                if (!isWedaFindPatientPage()) {
                    wedaPatientStop(job,'error_patient_selection_unverified','Un dossier a été ouvert sans choix patient confirmé. Aucun transfert effectué.');
                    return;
                }

                await clickWedaPatient(job);
                return;
            }

            if (job.status === 'awaiting_patient_confirmation') {
                if (!job.wedaPendingPatDk || wedaPatientNativeId() !== job.wedaPendingPatDk || isWedaFindPatientPage()) return wedaPatientStop(job,'error_patient_changed','Le dossier WEDA a changé pendant sa vérification. Aucun transfert effectué.');
                if (wedaPatientOpenedMatch(job) === 'conflict') return wedaPatientStop(job,'error_patient_selection_conflict','Le dossier affiché ne correspond pas au patient sélectionné.');
                wedaPatientAwaitOpened(job,job.wedaPendingPatDk); return;
            }

            if (job.status === 'awaiting_patient_selection') {
                if (!isWedaFindPatientPage()) return wedaPatientStop(job,'error_patient_selection_unverified','Le dossier ouvert ne correspond pas à un choix vérifié. Aucun transfert effectué.');
                wedaPatientInstallSelection();
                wedaPatientNotice('Choisissez le patient dans les résultats WEDA après vérification du nom et de la date de naissance.'); return;
            }

            if (job.status === 'patient_clicked') {
                if (isWedaFindPatientPage()) {
                    setTimeout(() => {
                        wedaRunning = false;
                        wedaMain();
                    }, 1000);
                    return;
                }

                job = wedaPatientBind(job);
                if (!job) return;
                if (isOpenPatientOnlyJob(job)) {
                    addLog('INFO', 'Dossier patient WEDA ouvert depuis Madeformed, aucune consultation créée', {
                        patientName: job.patientName,
                        dateOfBirth: job.dateOfBirth || '',
                        url: location.href
                    });

                    updateJob({
                        status: 'open_patient_done',
                        openedAt: Date.now()
                    });

                    setTimeout(() => {
                        const latestJob = getJob();
                        if (latestJob && latestJob.id === job.id && latestJob.status === 'open_patient_done') {
                            clearJob();
                        }
                    }, 1500);

                    return;
                }

                await clickNewConsultation(job);
                return;
            }

            if (job.status === 'open_patient_done') {
                const elapsed = Date.now() - (job.openedAt || Date.now());

                if (elapsed > 1500) {
                    clearJob();
                }

                return;
            }

            if (job.status === 'consultation_clicked') {
                await fillConsultationAndSave(job);
                return;
            }

            if (job.status === 'consultation_filling') {
                wedaPatientRequire(job,true,true);
                const elapsed = Date.now() - (job.fillingAt || Date.now());

                if (elapsed > 30000) {
                    addLog('WARN', 'Verrou de remplissage ancien : retour au statut consultation_clicked', {
                        elapsed
                    });

                    updateJob({
                        status: 'consultation_clicked'
                    });

                    scheduleWedaMainRetry('verrou remplissage expiré', 500);
                } else {
                    addLog('INFO', 'Remplissage consultation déjà en cours, aucune action');
                }

                return;
            }

            if (job.status === 'consultation_filled') {
                wedaPatientRequire(job,true,true);
                const elapsed = Date.now() - (job.filledAt || Date.now());

                if (elapsed < 5000) {
                    addLog('INFO', 'Consultation déjà remplie : sauvegarde principale probablement en cours, aucune action', {
                        elapsed
                    });
                    return;
                }

                addLog('WARN', 'Consultation remplie mais non sauvegardée après délai : sauvegarde de secours');
                await saveConsultationOnly();
                return;
            }

            if (job.status === 'consultation_saving') {
                wedaPatientRequire(job,true,true);
                const elapsed = Date.now() - (job.savingAt || job.filledAt || Date.now());

                if (elapsed < 10000) {
                    addLog('INFO', 'Sauvegarde consultation déjà en cours, aucune action', {
                        elapsed
                    });
                    return;
                }

                addLog('WARN', 'Sauvegarde en cours trop longue : tentative de sauvegarde de secours');
                await saveConsultationOnly();
                return;
            }

            if (job.status === 'saved_pending_close') {
                wedaPatientRequire(job,true);
                await sleep(2500);
                wedaPatientRequire(job,true);
                closeWedaTab(job);
                return;
            }

            if (String(job.status || '').startsWith('error_')) {
                addLog('ERROR', 'Tâche en erreur', safeJobForLog(job));
                return;
            }

        } catch (err) {
            addLog('ERROR', 'Erreur inattendue WEDA', {
                message: err.message,
                stack: String(err.stack || '').slice(0, 1000)
            });
        } finally {
            wedaRunning = false;
            refreshMadeformedPanel();
        }
    }

    function setupMadeformedPanelPosition(panel, head) {
        let preferred = null, drag = null, suppressClick = false;
        const readPosition = () => {
            const saved = GM_getValue(PANEL_POSITION_KEY, null);
            return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? {x:saved.x,y:saved.y} : null;
        };
        const constrain = (x, y) => {
            const rect = panel.getBoundingClientRect();
            const width = document.documentElement.clientWidth || window.innerWidth;
            const height = document.documentElement.clientHeight || window.innerHeight;
            const maxX = Math.max(0, width - rect.width - 12);
            const maxY = Math.max(0, height - rect.height - 12);
            return {x:Math.min(maxX,Math.max(Math.min(12,maxX),x)),
                y:Math.min(maxY,Math.max(Math.min(12,maxY),y))};
        };
        const refresh = () => {
            if (!panel.isConnected) return;
            if (!preferred) {
                panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
                return;
            }
            const point = constrain(preferred.x,preferred.y);
            panel.style.right = panel.style.bottom = 'auto';
            panel.style.left = point.x + 'px';
            panel.style.top = point.y + 'px';
        };
        const restore = () => { if (!drag) { preferred = readPosition(); refresh(); } };
        const finish = (event, cancel = false) => {
            if (!drag || event.pointerId !== drag.id) return;
            const finished = drag;
            drag = null;
            panel.classList.remove('tm-mf-weda-dragging');
            try { head.releasePointerCapture(finished.id); } catch (_) {}
            if (!finished.moved) return;
            if (cancel) preferred = finished.previous;
            else {
                preferred = {x:Math.round(preferred.x),y:Math.round(preferred.y)};
                GM_setValue(PANEL_POSITION_KEY,preferred);
            }
            refresh();
        };
        const cancelDrag = () => { if (drag) finish({pointerId:drag.id},true); };
        head.addEventListener('pointerdown', event => {
            if (drag || event.button !== 0 || event.isPrimary === false) return;
            suppressClick = false;
            if (event.target.closest('button,a,input,select,textarea')) return;
            const rect = panel.getBoundingClientRect();
            drag = {id:event.pointerId,startX:event.clientX,startY:event.clientY,x:rect.left,y:rect.top,
                previous:preferred ? {...preferred} : null,moved:false};
            try { head.setPointerCapture(event.pointerId); } catch (_) {}
        });
        head.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
            if (!drag.moved && Math.hypot(dx,dy) < 5) return;
            drag.moved = true;
            suppressClick = true;
            panel.classList.add('tm-mf-weda-dragging');
            if (event.cancelable) event.preventDefault();
            preferred = constrain(drag.x + dx,drag.y + dy);
            refresh();
        },{passive:false});
        head.addEventListener('pointerup',event => finish(event));
        head.addEventListener('pointercancel',event => finish(event,true));
        head.addEventListener('lostpointercapture',event => finish(event,true));
        head.addEventListener('click',event => {
            if (!suppressClick || event.detail === 0) return;
            suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        },true);
        window.addEventListener('resize',() => { cancelDrag(); refresh(); });
        window.addEventListener('blur',cancelDrag);
        window.addEventListener('keydown',event => { if (event.key === 'Escape') cancelDrag(); });
        window.addEventListener('focus',restore);
        document.addEventListener('visibilitychange',() => { if (document.hidden) cancelDrag(); else restore(); });
        if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(PANEL_POSITION_KEY,restore);
        if (typeof ResizeObserver === 'function') {
            const panelSizeObserver = new ResizeObserver(refresh);
            panelSizeObserver.observe(panel);
        }
        restore();
        return refresh;
    }

    function createMadeformedPanel() {
        if (!isMadeformed()) return;
        if (!document.body) return;
        if (document.getElementById('tm-mf-weda-panel')) return;

        refreshMadeformedPageClasses();

        const style = document.createElement('style');
        style.textContent = `
            ${SEL_MADEFORMED_OPEN_PATIENT_NAME},
            body.tm-mf-weda-messages-page ${SEL_MADEFORMED_MESSAGES_PATIENT_NAME} {
                cursor: pointer !important;
            }

            :is(${SEL_MADEFORMED_OPEN_PATIENT_NAME}):hover,
            body.tm-mf-weda-messages-page ${SEL_MADEFORMED_MESSAGES_PATIENT_NAME}:hover {
                text-decoration: underline;
                text-underline-offset: 2px;
            }

            #tm-mf-weda-panel {
                position: fixed;
                right: 12px;
                bottom: 12px;
                z-index: 2147483647;
                width: 280px;
                max-width: calc(100vw - 24px);
                background: #111827;
                color: white;
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.25);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
                font-size: 12px;
                overflow: hidden;
            }

            #tm-mf-weda-head {
                padding: 7px 9px;
                font-weight: 700;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                cursor: grab;
                touch-action: none;
                user-select: none;
            }

            #tm-mf-weda-panel.tm-mf-weda-dragging #tm-mf-weda-head { cursor: grabbing; }

            #tm-mf-weda-body {
                padding: 8px;
                max-height: calc(100vh - 100px);
                overflow-y: auto;
                background: white;
                color: #111827;
            }

            #tm-mf-weda-status {
                margin-bottom: 6px;
                white-space: pre-wrap;
                line-height: 1.3;
            }

            #tm-mf-weda-shortcuts { margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; line-height: 1.5; }
            #tm-mf-weda-shortcuts p { margin: 4px 0; }

            #tm-mf-weda-panel button {
                font-size: 11px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #f9fafb;
                padding: 4px 6px;
                cursor: pointer;
                margin-right: 4px;
                margin-top: 4px;
            }

            #tm-mf-weda-panel.tm-collapsed #tm-mf-weda-body {
                display: none;
            }

            #tm-mf-weda-brand {
                display: flex;
                align-items: center;
                gap: 7px;
                min-width: 0;
            }

            #tm-mf-weda-ruby-icon {
                width: 22px;
                height: 22px;
                border-radius: 50%;
                background: #b480ff;
                color: #000;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                font-size: 13px;
                font-weight: 800;
                line-height: 1;
                box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
            }

            #tm-mf-weda-title {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #tm-mf-weda-toggle {
                background: #374151 !important;
                color: white;
                border: none !important;
                margin: 0 !important;
            }

            #tm-mf-weda-panel.tm-collapsed {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: transparent;
            }

            #tm-mf-weda-panel.tm-collapsed #tm-mf-weda-head {
                width: 44px;
                height: 44px;
                padding: 0;
                justify-content: center;
                border-radius: 50%;
                background: #b480ff;
            }

            #tm-mf-weda-panel.tm-collapsed #tm-mf-weda-brand {
                gap: 0;
            }

            #tm-mf-weda-panel.tm-collapsed #tm-mf-weda-ruby-icon {
                width: 44px;
                height: 44px;
                font-size: 20px;
                box-shadow: inset 0 0 0 1px rgba(0,0,0,0.14);
            }

            #tm-mf-weda-panel.tm-collapsed #tm-mf-weda-title,
            #tm-mf-weda-panel.tm-collapsed #tm-mf-weda-toggle {
                display: none;
            }
        `;

        const panel = document.createElement('div');
        panel.id = 'tm-mf-weda-panel';
        panel.className = 'tm-collapsed';

        panel.innerHTML = `
            <div id="tm-mf-weda-head">
                <span id="tm-mf-weda-brand" title="MFM Helper + WEDA">
                    <span id="tm-mf-weda-ruby-icon" aria-hidden="true">W</span>
                    <span id="tm-mf-weda-title">MFM Helper + WEDA</span>
                </span>
                <button id="tm-mf-weda-toggle" type="button" aria-label="Replier MFM Helper + WEDA">+</button>
            </div>
            <div id="tm-mf-weda-body">
                <div id="tm-mf-weda-status"></div>
                <button id="tm-mf-weda-run" type="button">Lancer</button>
                <button id="tm-mf-weda-copy-logs" type="button">Copier logs</button>
                <button id="tm-mf-weda-reset" type="button">Reset</button>
                <button id="tm-mf-weda-remove-filters" type="button">Anti-filtre</button>
                <button id="tm-mf-weda-review-expired" type="button" hidden>J’ai vérifié le résultat</button>
                <div id="tm-mf-weda-shortcuts" aria-label="Raccourcis et actions">
                    <strong>Raccourcis et actions</strong>
                    <p><b>PageDown</b> : envoyer la réponse et la transférer vers WEDA.</p>
                    <p><b>Clic sur le nom du patient</b> : ouvrir son dossier WEDA.</p>
                    <p>Les icônes calendrier et document ouvrent les actions MadeForMed du patient.</p>
                    <p>« Regrouper les appels ON/OFF » affiche ou replie les appels successifs.</p>
                </div>
            </div>
        `;

        document.documentElement.appendChild(style);
        document.body.appendChild(panel);

        const toggleButton = document.getElementById('tm-mf-weda-toggle');
        const refreshPosition = setupMadeformedPanelPosition(panel,document.getElementById('tm-mf-weda-head'));
        const setCollapsed = collapsed => {
            panel.classList.toggle('tm-collapsed', collapsed);
            const label = collapsed ? '+' : '−';
            if (toggleButton.textContent !== label) toggleButton.textContent = label;
            const ariaLabel = collapsed ? 'Ouvrir MFM Helper + WEDA' : 'Replier MFM Helper + WEDA';
            if (toggleButton.getAttribute('aria-label') !== ariaLabel) toggleButton.setAttribute('aria-label', ariaLabel);
            if (toggleButton.getAttribute('aria-expanded') !== String(!collapsed)) toggleButton.setAttribute('aria-expanded', String(!collapsed));
            const title = collapsed ? 'Ouvrir MFM Helper + WEDA — glisser pour déplacer' : 'Glisser l’en-tête pour déplacer';
            if (panel.title !== title) panel.title = title;
            refreshPosition();
        };
        const savedCollapsed = () => setCollapsed(GM_getValue(PANEL_COLLAPSED_KEY, true) !== false);
        const toggleCollapsed = () => {
            const collapsed = !panel.classList.contains('tm-collapsed');
            GM_setValue(PANEL_COLLAPSED_KEY, collapsed);
            setCollapsed(collapsed);
        };

        document.getElementById('tm-mf-weda-head').addEventListener('click', () => {
            toggleCollapsed();
        });

        toggleButton.addEventListener('click', event => {
            event.stopPropagation();
            toggleCollapsed();
        });

        savedCollapsed();
        window.addEventListener('focus', savedCollapsed);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) savedCollapsed(); });
        if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(PANEL_COLLAPSED_KEY, savedCollapsed);
        document.getElementById('tm-mf-weda-review-expired').addEventListener('click', () => {
            const current = getJob();
            if (current?.status !== 'expired_unknown') return;
            updateJob({status:'archived_manually_verified', resultUnknown:false});
            clearJob();
        });

        document.getElementById('tm-mf-weda-run').addEventListener('click', () => launchFromMadeformed('bouton_panel'));
        document.getElementById('tm-mf-weda-copy-logs').addEventListener('click', copyLogs);
        document.getElementById('tm-mf-weda-reset').addEventListener('click', resetAll);
        document.getElementById('tm-mf-weda-remove-filters').addEventListener('click', removeFiltersAndBlur);

        refreshMadeformedPanel();
    }

    function refreshMadeformedPanel() {
        if (!isMadeformed()) return;

        const status = document.getElementById('tm-mf-weda-status');

        if (!status) return;

        const job = getJob();

        const text =
            `Version : ${VERSION}\n` +
            `Transfert : ${madeformedJobStatusLabel(job)}\n` +
            `Mode : ${job?.action === 'open_patient' ? 'Ouverture du dossier' : job ? 'Réponse vers WEDA' : '-'}\n` +
            `Patient : ${job?.patientName || '-'}${job && job.dateOfBirth ? ' (' + job.dateOfBirth + ')' : ''}\n` +
            'Ajouter une tâche : actif dans les messages';
        if (status.textContent !== text) status.textContent = text;
        const review = document.getElementById('tm-mf-weda-review-expired');
        if (review) review.hidden = job?.status !== 'expired_unknown';
    }

    function madeformedJobStatusLabel(job) {
        if (!job) return 'Aucun';
        if (job.status === 'error_transfer_expired' && isOpenPatientOnlyJob(job)) return 'Ouverture précédente expirée ; vous pouvez ouvrir un dossier';
        const labels = {open_search:'Recherche du patient dans WEDA', search_submitted:'Résultats de recherche WEDA',
            awaiting_patient_selection:'Choisissez le dossier dans WEDA', awaiting_patient_confirmation:'Vérifiez le dossier dans WEDA',
            patient_clicked:'Dossier patient sélectionné', consultation_clicked:'Ouverture de la consultation',
            consultation_filling:'Insertion de la réponse', consultation_filled:'Réponse insérée',
            consultation_saving:'Enregistrement demandé', saved_pending_close:'Enregistrement demandé, fermeture de WEDA',
            open_patient_done:'Dossier patient ouvert', expired_unknown:'Ancien transfert à vérifier ; contenu effacé',
            error_transfer_expired:'Transfert périmé ; contenu effacé', archived_manually_verified:'Résultat vérifié manuellement'};
        return labels[job.status] || (String(job.status || '').startsWith('error_') ? 'Interrompu : vérifiez le dossier WEDA' : 'En cours');
    }

    /* ========================================================================== */
    /* CONSIGNES AU SECRÉTARIAT — tâches natives MadeForMed                     */
    /* ========================================================================== */

    const SECRETARIAT_PREFIX = 'tm-mf-consignes';
    let secretariatObserver = null;
    let secretariatScanQueued = false;
    let secretariatHashListenerInstalled = false;

    // Lecture avec la session MadeForMed courante, validation via son bouton natif.
    // Les tâches restent sur MadeForMed : aucun cache dans GM_* ou localStorage.
    const SECRETARIAT_REFRESH_MS = 60000;
    const SECRETARIAT_TASK_SECTIONS = [
        { filter: 'late', label: 'À faire', id: 'late-tasks' },
        { filter: 'waiting', label: 'À venir', id: 'waiting-tasks' },
        { filter: 'validated', label: 'Effectuée', id: 'done-tasks' }
    ];
    let secretariatShared = {
        context: null, tasks: [], checkedAt: 0, loading: false, error: ''
    };
    let secretariatSharedPending = null;
    let secretariatSharedTimer = null;
    let secretariatSharedListenersInstalled = false;
    let secretariatSharedLastAttempt = 0;
    let secretariatCompleting = null;
    let secretariatCreating = null;
    let secretariatManaging = null;
    const secretariatEdits = new Map();
    const secretariatDeletionState = new Map();
    const secretariatCompletionErrors = new Map();

    function secretariatCompletionKey(context, taskId) {
        return `${context}|${taskId}`;
    }

    async function secretariatWaitNative(frame, context, predicate) {
        const end = Date.now() + 25000;
        while (Date.now() < end) {
            if (!frame.isConnected) throw new Error('Cadre de validation fermé.');
            if (secretariatContextOf(document) !== context) throw new Error('Contexte changé.');
            let doc = null;
            try { doc = frame.contentDocument; } catch (_) {}
            if (doc && doc.readyState === 'complete') {
                if (doc.querySelector('#loginForm, input[type="password"]')) throw new Error('Connexion expirée.');
                const frameContext = secretariatContextOf(doc);
                if (frameContext && frameContext !== context) throw new Error('Cabinet différent.');
                if (frameContext === context) {
                    const result = predicate(doc);
                    if (result) return { doc, result };
                }
            }
            await sleep(150);
        }
        throw new Error('Délai de chargement dépassé.');
    }

    async function secretariatNativeTask(frame, context, task) {
        let { doc, result: menu } = await secretariatWaitNative(
            frame, context, d => d.querySelector('#shortcuts .menu-task-btn')
        );
        menu.click();
        ({ doc } = await secretariatWaitNative(frame, context, d =>
            d.querySelector('#tasks .sc-btn[href="#late-tasks"]')
        ));
        for (const section of SECRETARIAT_TASK_SECTIONS) {
            const tab = doc.querySelector(`#tasks .sc-btn[href="#${section.id}"]`);
            if (!tab) throw new Error('Onglet de tâches introuvable.');
            tab.click();
            const loaded = await secretariatWaitNative(frame, context, d =>
                d.querySelector(`#${section.id} .lazy.lazy-loaded .task-list`)
            );
            doc = loaded.doc;
            const root = doc.querySelector(`#${section.id}`);
            const current = secretariatParseTaskList(root, section).find(t => t.taskId === task.taskId);
            if (!current) continue;
            if (current.messageId !== task.messageId || current.note !== task.note) {
                throw new Error('La consigne a changé.');
            }
            return { current, card: root.querySelector(`.task[data-task-id="${task.taskId}"]`) };
        }
        throw new Error('La tâche est absente ou inaccessible.');
    }

    async function secretariatVerifyCompleted(task, context) {
        const section = SECRETARIAT_TASK_SECTIONS.find(s => s.filter === 'validated');
        const end = Date.now() + 20000;
        while (Date.now() < end) {
            if (secretariatContextOf(document) !== context) throw new Error('Contexte changé.');
            const doc = await secretariatReadDocument('/tasks?filter=validated', true);
            const found = secretariatParseTaskList(doc, section).find(t =>
                t.taskId === task.taskId && t.messageId === task.messageId && t.note === task.note
            );
            if (found) {
                await secretariatCheckServerContext(context);
                if (secretariatContextOf(document) !== context) throw new Error('Contexte changé.');
                return found;
            }
            await sleep(600);
        }
        throw new Error('Validation non confirmée.');
    }

    async function secretariatCompleteTask(task) {
        if (secretariatCompleting || secretariatCreating || secretariatManaging || task.state === 'validated') return;
        const context = secretariatContextOf(document);
        if (!context || secretariatShared.context !== context ||
            !secretariatShared.tasks.some(t => t.taskId === task.taskId && t.messageId === task.messageId)) return;
        const key = secretariatCompletionKey(context, task.taskId);
        secretariatCompletionErrors.delete(key);
        secretariatCompleting = { taskId: task.taskId, context };
        secretariatRenderShared();
        let frame = null;
        let clicked = false;
        try {
            // Terminer une lecture déjà commencée avant de lancer l'action native.
            if (secretariatSharedPending) await secretariatSharedPending;
            await secretariatCheckServerContext(context);
            if (secretariatContextOf(document) !== context) throw new Error('Contexte changé.');
            frame = document.createElement('iframe');
            frame.title = 'Validation MadeForMed';
            frame.setAttribute('aria-hidden', 'true');
            frame.tabIndex = -1;
            frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;';
            frame.src = new URL('/agenda', location.origin).href;
            document.body.append(frame);

            // Utiliser le handler MadeForMed dans son propre document : ses droits,
            // ses jetons et sa requête native, sans reconstruire un POST à l'aveugle.
            const native = await secretariatNativeTask(frame, context, task);
            let completed = native.current;
            if (native.current.state !== 'validated') {
                const button = native.card?.querySelector('.task-actions button.valid[data-url]');
                if (!button || button.disabled || button.classList.contains('disabled')) throw new Error('Validation indisponible.');
                const url = new URL(button.getAttribute('data-url'), location.origin);
                if (url.origin !== location.origin || url.pathname !== `/tasks/edit/${task.taskId}` || url.search) {
                    throw new Error('Action native non reconnue.');
                }
                if (secretariatContextOf(document) !== context ||
                    secretariatContextOf(frame.contentDocument) !== context) throw new Error('Contexte changé.');
                button.click();
                clicked = true;
                completed = await secretariatVerifyCompleted(task, context);
            }
            if (secretariatShared.context === context && secretariatContextOf(document) === context) {
                secretariatShared.tasks = secretariatShared.tasks.map(t => t.taskId === task.taskId ? completed : t);
            }
            secretariatLog('INFO', 'Tâche accomplie confirmée dans MadeForMed', { taskId: task.taskId, messageId: task.messageId });
        } catch (_) {
            secretariatCompletionErrors.set(key, clicked
                ? 'Validation non confirmée. Actualisez avant de réessayer.'
                : 'Validation impossible. Vérifiez la connexion et le médecin actif, puis actualisez.');
            secretariatLog('WARN', 'Validation de tâche indisponible ou non confirmée', { taskId: task.taskId });
        } finally {
            frame?.remove();
            secretariatCompleting = null;
            secretariatRenderShared();
            await secretariatRefreshShared(true);
        }
    }

    function secretariatFrame(title) {
        const frame = document.createElement('iframe');
        frame.title = title;
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;';
        frame.src = new URL('/agenda', location.origin).href;
        document.body.append(frame);
        return frame;
    }

    async function secretariatReadAllTasks(context) {
        await secretariatCheckServerContext(context);
        const all = new Map();
        for (const section of SECRETARIAT_TASK_SECTIONS) {
            const doc = await secretariatReadDocument(`/tasks?filter=${section.filter}`, true);
            for (const task of secretariatParseTaskList(doc, section)) all.set(task.taskId, task);
            // A moved/reassigned task must not be mistaken for a deleted task.
            for (const card of doc.querySelectorAll('.task[data-task-id]')) {
                const id = card.getAttribute('data-task-id');
                if (!all.has(id)) all.set(id, { taskId: id, unrecognized: true });
            }
        }
        await secretariatCheckServerContext(context);
        if (secretariatContextOf(document) !== context) throw new Error('Contexte changé.');
        return all;
    }

    async function secretariatNativeEdit(frame, context, task) {
        const native = await secretariatNativeTask(frame, context, task);
        const edit = native.card?.querySelector('button[title="Éditer cette tâche"], button.edit');
        if (!edit || edit.disabled) throw new Error('Édition indisponible.');
        edit.click();
        const { doc, result: form } = await secretariatWaitNative(frame, context, d => {
            const form = d.querySelector('.new-task #TaskView');
            return form?.querySelector('[name="data[Task][id]"]')?.value === task.taskId && form;
        });
        const action = new URL(form.getAttribute('action'), location.origin);
        if (action.origin !== location.origin || action.pathname !== `/tasks/${task.taskId}` ||
            action.search || form.getAttribute('method')?.toLowerCase() !== 'post' ||
            form.querySelector('[name="data[Task][type]"]')?.value !== '0' ||
            !secretariatDestinationStatus(form).valid ||
            cleanText(form.querySelector('[name="data[Task][titre]"]')?.value) !== task.title ||
            secretariatTaskTextValue(form.querySelector('[name="data[Task][detail]"]')?.value) !== task.detail) {
            throw new Error('La tâche a changé ou son formulaire est indisponible.');
        }
        return { doc, form };
    }

    function secretariatTaskTextValue(value) {
        return String(value || '').replace(/\r\n?/g, '\n').trim();
    }

    function secretariatBeginEdit(task) {
        if (secretariatManaging || secretariatCreating || secretariatCompleting) return;
        const context = secretariatContextOf(document);
        const key = secretariatCompletionKey(context, task.taskId);
        if (!secretariatEdits.has(key)) secretariatEdits.set(key, { original: task, draft: task.note, error: '', submitted: false });
        secretariatRenderShared();
        document.getElementById(`${SECRETARIAT_PREFIX}-edit-${task.taskId}`)?.focus();
    }

    function secretariatRenderEditor(card, task, entry) {
        const context = secretariatContextOf(document);
        const key = secretariatCompletionKey(context, task.taskId);
        const editor = document.createElement('div');
        editor.className = `${SECRETARIAT_PREFIX}-edit`;
        const input = document.createElement('textarea');
        input.id = `${SECRETARIAT_PREFIX}-edit-${task.taskId}`;
        input.setAttribute('aria-label', 'Modifier la consigne');
        input.maxLength = 8000;
        input.value = entry.draft;
        input.readOnly = Boolean(secretariatManaging) || entry.submitted;
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = entry.submitted ? 'Vérifier la modification' : 'Enregistrer';
        save.disabled = Boolean(secretariatManaging) || Boolean(secretariatCreating) || Boolean(secretariatCompleting) || !entry.draft.trim();
        input.addEventListener('input', () => { entry.draft = input.value; save.disabled = !input.value.trim(); });
        save.addEventListener('click', () => secretariatSaveEdit(task.taskId, entry));
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = `${SECRETARIAT_PREFIX}-secondary`;
        cancel.textContent = 'Annuler';
        cancel.disabled = Boolean(secretariatManaging) || entry.submitted;
        cancel.addEventListener('click', () => { secretariatEdits.delete(key); secretariatRenderShared(); });
        editor.append(input, save, cancel);
        if (entry.error) {
            const error = document.createElement('small');
            error.dataset.error = 'true';
            error.setAttribute('role', 'status');
            error.textContent = entry.error;
            editor.append(error);
        }
        card.append(editor);
    }

    async function secretariatSaveEdit(taskId, entry) {
        if (secretariatManaging || secretariatCreating || secretariatCompleting || !entry.draft.trim()) return;
        const context = secretariatContextOf(document);
        const key = secretariatCompletionKey(context, taskId);
        if (secretariatEdits.get(key) !== entry) return;
        secretariatManaging = { taskId, action: 'edit' };
        entry.error = '';
        secretariatRenderShared();
        let frame;
        try {
            if (secretariatSharedPending) await secretariatSharedPending;
            const all = await secretariatReadAllTasks(context);
            const fresh = all.get(taskId);
            if (!fresh || fresh.unrecognized) throw new Error('Tâche inaccessible.');
            if (!entry.submitted) {
                if (fresh.detail !== entry.original.detail || fresh.title !== entry.original.title || fresh.state !== entry.original.state) {
                    throw new Error('La tâche a changé. Annulez puis actualisez avant de la modifier.');
                }
                frame = secretariatFrame('Modification MadeForMed');
                const { form } = await secretariatNativeEdit(frame, context, fresh);
                const detail = form.querySelector('[name="data[Task][detail]"]');
                const marker = `\n\nMessage MadeForMed #${fresh.messageId}\n`;
                const at = fresh.detail.lastIndexOf(marker);
                if (!detail || at < 0) throw new Error('Référence du message absente.');
                entry.expectedDetail = entry.draft.trim() + fresh.detail.slice(at);
                secretariatSetField(detail, entry.expectedDetail, frame.contentWindow, 'detail', fresh.messageId);
                const save = form.querySelector('input.save[type="submit"], button.save[type="submit"]');
                if (!save || save.disabled) throw new Error('Enregistrement indisponible.');
                await secretariatCheckServerContext(context);
                if (secretariatContextOf(frame.contentDocument) !== context || secretariatContextOf(document) !== context) throw new Error('Contexte changé.');
                entry.submitted = true;
                save.click();
            }
            const end = Date.now() + 20000;
            let updated;
            do {
                updated = (await secretariatReadAllTasks(context)).get(taskId);
                if (updated?.detail === entry.expectedDetail && updated.title === entry.original.title &&
                    updated.messageId === entry.original.messageId) break;
                updated = null;
                await sleep(600);
            } while (Date.now() < end);
            if (!updated) throw new Error('Modification non confirmée.');
            secretariatShared.tasks = secretariatShared.tasks.map(t => t.taskId === taskId ? updated : t);
            secretariatEdits.delete(key);
        } catch (error) {
            entry.error = entry.submitted ? 'Modification non confirmée. Vérifiez son enregistrement avant de réessayer.'
                : (error.message === 'La tâche a changé. Annulez puis actualisez avant de la modifier.' ? error.message : 'Modification impossible. Vérifiez la connexion et actualisez.');
            secretariatLog('WARN', 'Modification indisponible ou non confirmée', { taskId });
        } finally {
            frame?.remove();
            secretariatManaging = null;
            secretariatRenderShared();
            await secretariatRefreshShared(true);
        }
    }

    function secretariatConfirmDeletionDialog(frame, context, baseline) {
        const doc = frame.contentDocument;
        if (!doc || secretariatContextOf(document) !== context || secretariatContextOf(doc) !== context) {
            throw new Error('Contexte changé.');
        }
        for (const dialog of doc.querySelectorAll('.modal, .bootbox, .jconfirm, .swal2-popup, [role="dialog"]')) {
            if (!secretariatVisible(dialog) || baseline.has(dialog)) continue;
            // Confirmation limitée au dialogue de suppression apparu après le clic
            // sur la tâche contrôlée. Aucun autre dialogue n'est accepté.
            if (!/supprim|effacer/.test(normalizeText(dialog.textContent))) continue;
            const buttons = [...dialog.querySelectorAll('button, input[type="button"], input[type="submit"]')];
            const accept = buttons.find(button => {
                const text = normalizeText(button.textContent || button.value);
                return secretariatVisible(button) && !button.disabled &&
                    /^(supprimer|oui|confirmer|oui supprimer|oui je confirme|ok)$/.test(text);
            });
            if (!accept) continue;
            accept.click();
            return true;
        }
        return false;
    }

    async function secretariatVerifyDeleted(frame, context, taskId, baseline = new Set()) {
        const end = Date.now() + 20000;
        let absent = 0;
        let confirmedDialog = false;
        do {
            if (frame && !confirmedDialog) confirmedDialog = secretariatConfirmDeletionDialog(frame, context, baseline);
            const all = await secretariatReadAllTasks(context);
            absent = all.has(taskId) ? 0 : absent + 1;
            // Deux lectures complètes pour ne pas confondre un déplacement entre
            // les onglets À faire / À venir / Effectuées et une suppression.
            if (absent >= 2) return;
            await sleep(500);
        } while (Date.now() < end);
        throw new Error('Suppression non confirmée.');
    }

    async function secretariatDeleteTask(task) {
        if (secretariatManaging || secretariatCreating || secretariatCompleting) return;
        const context = secretariatContextOf(document);
        if (!context || secretariatShared.context !== context) return;
        const key = secretariatCompletionKey(context, task.taskId);
        const state = secretariatDeletionState.get(key) || { submitted: false, error: '' };
        state.error = '';
        secretariatDeletionState.set(key, state);
        secretariatManaging = { taskId: task.taskId, action: 'delete' };
        secretariatRenderShared();
        let frame;
        try {
            if (secretariatSharedPending) await secretariatSharedPending;
            const all = await secretariatReadAllTasks(context);
            const fresh = all.get(task.taskId);
            if (fresh && !state.submitted) {
                if (fresh.unrecognized || fresh.messageId !== task.messageId || fresh.title !== task.title ||
                    fresh.detail !== task.detail || fresh.state !== task.state) {
                    throw new Error('La tâche a changé. Actualisez avant de la supprimer.');
                }
                frame = secretariatFrame('Suppression MadeForMed');
                const { doc, form } = await secretariatNativeEdit(frame, context, fresh);
                const remove = form.querySelector('button.delete');
                if (!remove || remove.disabled || remove.classList.contains('disabled')) throw new Error('Suppression indisponible.');
                const latest = (await secretariatReadAllTasks(context)).get(task.taskId);
                if (!latest || latest.unrecognized || latest.detail !== fresh.detail || latest.title !== fresh.title ||
                    latest.state !== fresh.state || secretariatContextOf(doc) !== context ||
                    form.querySelector('[name="data[Task][id]"]')?.value !== task.taskId) {
                    throw new Error('La tâche a changé. Actualisez avant de la supprimer.');
                }
                const baseline = new Set([...doc.querySelectorAll('.modal, .bootbox, .jconfirm, .swal2-popup, [role="dialog"]')].filter(secretariatVisible));
                // Le clic explicite « Supprimer » dans la messagerie est la demande
                // de suppression. La confirmation synchrone du handler natif est
                // acceptée uniquement pendant ce clic dans son cadre isolé.
                const win = frame.contentWindow;
                const nativeConfirm = win.confirm;
                let confirmed = false;
                const confirm = () => {
                    if (confirmed || secretariatContextOf(document) !== context || secretariatContextOf(doc) !== context ||
                        form.querySelector('[name="data[Task][id]"]')?.value !== task.taskId) return false;
                    confirmed = true;
                    return true;
                };
                try {
                    win.confirm = confirm;
                    if (win.confirm !== confirm) throw new Error('Confirmation native indisponible.');
                    state.submitted = true;
                    remove.click(); // Une seule écriture native, jamais rejouée automatiquement.
                } finally {
                    win.confirm = nativeConfirm;
                }
                await secretariatVerifyDeleted(frame, context, task.taskId, baseline);
            } else {
                // Une tentative incertaine ne déclenche qu'une vérification.
                await secretariatVerifyDeleted(null, context, task.taskId);
            }
            secretariatShared.tasks = secretariatShared.tasks.filter(t => t.taskId !== task.taskId);
            secretariatEdits.delete(key);
            secretariatDeletionState.delete(key);
            secretariatLog('INFO', 'Suppression confirmée dans MadeForMed', { taskId: task.taskId, messageId: task.messageId });
        } catch (error) {
            state.error = state.submitted
                ? 'Suppression non confirmée. Cliquez sur Vérifier la suppression sans refaire l’envoi.'
                : (error.message === 'La tâche a changé. Actualisez avant de la supprimer.' ? error.message
                    : 'Suppression impossible. Vérifiez la connexion et actualisez.');
            secretariatLog('WARN', 'Suppression indisponible ou non confirmée', { taskId: task.taskId });
        } finally {
            frame?.remove();
            secretariatManaging = null;
            secretariatRenderShared();
            await secretariatRefreshShared(true);
        }
    }

    function secretariatHasMessageRows() {
        return Boolean(document.querySelector('#messages tr.user-message[data-id]'));
    }

    function secretariatTaskText(node) {
        if (!node) return '';
        const copy = node.cloneNode(true);
        copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        return (copy.textContent || '').replace(/\r\n?/g, '\n').trim();
    }

    function secretariatParseTaskList(doc, section) {
        // Une réponse vide, une page de connexion ou un nouveau format ne prouvent
        // pas l'absence de tâches. La liste native, même vide, doit être présente.
        if (!doc.querySelector('.task-list')) {
            throw new Error('La liste des tâches est indisponible. Vérifiez votre connexion et votre accès aux tâches MadeForMed.');
        }

        const tasks = [];
        for (const card of doc.querySelectorAll('.task-list .task[data-task-id]')) {
            const taskId = card.getAttribute('data-task-id') || '';
            const title = cleanText(card.querySelector('.task-header .title')?.textContent);
            const titleMatch = title.match(/^Consigne\s*[—–-].*\s[—–-]\s*message #(\d+)$/i);
            // N'afficher que les consignes du module, y compris les tâches de l'agenda sans destinataire explicite.
            if (!/^\d+$/.test(taskId) || !titleMatch ||
                card.getAttribute('task-type') !== '0') continue;

            const messageId = titleMatch[1];
            const detail = secretariatTaskText(card.querySelector('.task-detail'));
            const marker = new RegExp(`\\n\\nMessage MadeForMed #${messageId}\\n`);
            const markerMatches = [...detail.matchAll(new RegExp(marker.source, 'g'))];
            const metadataAt = markerMatches.length ? markerMatches[markerMatches.length - 1].index : -1;
            const linkMatch = detail.slice(metadataAt < 0 ? 0 : metadataAt)
                .match(/(?:^|\n)Retrouver le message : (https?:\/\/[^\s]+)\s*$/);
            if (metadataAt < 0 || !linkMatch) continue;

            let link;
            try { link = new URL(linkMatch[1]); } catch (_) { continue; }
            if (link.origin !== location.origin ||
                !/^\/messages(?:\/corbeille)?\/?$/.test(link.pathname) ||
                link.hash !== `#tm-mf-message=${messageId}`) continue;

            tasks.push({
                taskId, messageId, title, detail, note: detail.slice(0, metadataAt).trim(),
                state: section.filter, label: section.label,
                reference: detail.slice(metadataAt).match(/\nRéférence de consigne : (tm-mf-[a-f0-9-]+)\n/)?.[1] || ''
            });
        }
        return tasks;
    }

    async function secretariatReadDocument(path, ajax = false) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(new URL(path, location.origin).href, {
                method: 'GET', credentials: 'same-origin', cache: 'no-store',
                redirect: 'error', signal: controller.signal,
                headers: ajax ? { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html' } : { 'Accept': 'text/html' }
            });
            if (!response.ok) throw new Error('Lecture des tâches refusée ou indisponible. Vérifiez votre connexion MadeForMed.');
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            if (doc.querySelector('#loginForm, form[action*="login"], input[type="password"]')) {
                throw new Error('Reconnectez-vous à MadeForMed pour afficher les consignes partagées.');
            }
            return doc;
        } finally {
            window.clearTimeout(timer);
        }
    }

    async function secretariatCheckServerContext(context) {
        // Le cabinet actif peut avoir été changé dans un autre onglet. Vérification
        // avant et après la lecture : on ne publie jamais une réponse décontextualisée.
        const doc = await secretariatReadDocument('/agenda');
        if (!context || secretariatContextOf(doc) !== context) {
            throw new Error('Le médecin ou le cabinet actif diffère de cette messagerie. Rechargez la messagerie du médecin concerné.');
        }
    }

    function secretariatRenderSharedBox(row) {
        const area = row.querySelector(`.${SECRETARIAT_PREFIX}-saved`);
        if (!area) return;
        const messageId = row.getAttribute('data-id');
        const context = secretariatContextOf(document);
        const shared = secretariatShared;
        const sameContext = Boolean(context && shared.context === context);
        const tasks = sameContext ? shared.tasks.filter(task => task.messageId === messageId) : [];
        const signature = JSON.stringify({
            tasks,
            loading: shared.loading, error: sameContext ? shared.error : '', context,
            completing: secretariatCompleting, creating: Boolean(secretariatCreating), managing: secretariatManaging,
            deletions: tasks.map(t => secretariatDeletionState.get(secretariatCompletionKey(context, t.taskId)) || null),
            edits: tasks.map(t => secretariatEdits.get(secretariatCompletionKey(context, t.taskId)) || null),
            completionErrors: tasks.map(t => secretariatCompletionErrors.get(secretariatCompletionKey(context, t.taskId)) || '')
        });
        // Le scan est déclenché par MutationObserver : ne pas réécrire le DOM à
        // l'identique, sinon notre propre affichage provoquerait une boucle.
        if (area.dataset.signature === signature) return;
        area.dataset.signature = signature;

        const fragment = document.createDocumentFragment();
        const header = document.createElement('div');
        header.className = `${SECRETARIAT_PREFIX}-saved-head`;
        const heading = document.createElement('strong');
        heading.textContent = tasks.length === 1 ? 'Consigne enregistrée' : `Consignes enregistrées (${tasks.length})`;
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = 'Actualiser';
        refresh.disabled = shared.loading || (Boolean(secretariatCompleting) || Boolean(secretariatCreating) || Boolean(secretariatManaging));
        refresh.addEventListener('click', () => secretariatRefreshShared(true));
        header.append(heading, refresh);
        fragment.append(header);

        const info = document.createElement('small');
        info.setAttribute('role', 'status');
        info.setAttribute('aria-live', 'polite');
        if (sameContext && shared.error) {
            info.dataset.error = 'true';
            info.textContent = tasks.length
                ? 'Actualisation impossible. Les tâches affichées peuvent avoir changé.'
                : 'Vérification des consignes impossible.';
            fragment.append(info);
            if (!tasks.length) fragment.append(refresh);
        }
        // Aucun titre, horaire, chargement ou bouton de tâche sans tâche enregistrée.
        if (!tasks.length) {
            fragment.replaceChildren(...(sameContext && shared.error ? [info, refresh] : []));
            area.hidden = !shared.error || !sameContext;
            area.replaceChildren(fragment);
            return;
        }
        area.hidden = false;

        for (const task of tasks) {
            const card = document.createElement('div');
            card.className = `${SECRETARIAT_PREFIX}-saved-card`;
            const badge = document.createElement('span');
            badge.className = `${SECRETARIAT_PREFIX}-task-state`;
            badge.dataset.state = task.state;
            badge.textContent = task.label;
            const note = document.createElement('div');
            note.className = `${SECRETARIAT_PREFIX}-saved-note`;
            note.textContent = task.note;
            card.append(badge, note);
            const actions = document.createElement('div');
            actions.className = `${SECRETARIAT_PREFIX}-actions`;
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = `${SECRETARIAT_PREFIX}-secondary`;
            edit.textContent = 'Modifier';
            edit.disabled = shared.loading || Boolean(secretariatManaging) || Boolean(secretariatCreating) || Boolean(secretariatCompleting) || Boolean(shared.error);
            edit.addEventListener('click', () => secretariatBeginEdit(task));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = `${SECRETARIAT_PREFIX}-delete`;
            const deletion = secretariatDeletionState.get(secretariatCompletionKey(context, task.taskId));
            remove.textContent = secretariatManaging?.action === 'delete' && secretariatManaging.taskId === task.taskId
                ? 'Suppression…' : deletion?.submitted ? 'Vérifier la suppression' : 'Supprimer';
            remove.disabled = deletion?.submitted
                ? shared.loading || Boolean(secretariatManaging) || Boolean(secretariatCreating) || Boolean(secretariatCompleting)
                : edit.disabled;
            remove.addEventListener('click', () => secretariatDeleteTask(task));
            const entry = secretariatEdits.get(secretariatCompletionKey(context, task.taskId));
            if (!entry) actions.append(edit, remove);
            card.append(actions);
            if (deletion?.error) {
                const error = document.createElement('small');
                error.dataset.error = 'true';
                error.setAttribute('role', 'status');
                error.textContent = deletion.error;
                card.append(error);
            }
            if (entry) note.hidden = true;
            if (entry) secretariatRenderEditor(card, task, entry);
            if (task.state !== 'validated') {
                const complete = document.createElement('button');
                complete.type = 'button';
                complete.className = `${SECRETARIAT_PREFIX}-complete`;
                const isCompleting = secretariatCompleting?.taskId === task.taskId;
                complete.textContent = isCompleting ? 'Validation…' : '✓ Tâche accomplie';
                complete.disabled = shared.loading || (Boolean(secretariatCompleting) || Boolean(secretariatCreating) || Boolean(secretariatManaging)) || Boolean(shared.error);
                complete.addEventListener('click', () => secretariatCompleteTask(task));
                if (!entry) actions.prepend(complete);
                const error = secretariatCompletionErrors.get(secretariatCompletionKey(context, task.taskId));
                if (error) {
                    const status = document.createElement('small');
                    status.dataset.error = 'true';
                    status.setAttribute('role', 'status');
                    status.textContent = error;
                    card.append(status);
                }
            }
            fragment.append(card);
        }
        // Un rafraîchissement ne doit pas déplacer le curseur d'une édition en cours.
        const active = document.activeElement;
        const focusedId = area.contains(active) && active.tagName === 'TEXTAREA' ? active.id : '';
        const selection = focusedId ? [active.selectionStart, active.selectionEnd] : null;
        area.replaceChildren(fragment);
        if (focusedId) {
            const next = document.getElementById(focusedId);
            next?.focus({ preventScroll: true });
            if (next && selection) next.setSelectionRange(...selection);
        }
    }

    function secretariatRenderShared() {
        document.querySelectorAll('#messages tr.user-message[data-id]').forEach(secretariatRenderSharedBox);
        document.querySelectorAll(`.${SECRETARIAT_PREFIX}`).forEach(box =>
            box.dispatchEvent(new Event('tm-mf-task-state'))
        );
    }

    function secretariatRefreshShared(force = false) {
        if (!isMadeformed() || !secretariatHasMessageRows()) return Promise.resolve();
        if (secretariatCompleting || secretariatCreating || secretariatManaging) return secretariatSharedPending || Promise.resolve();
        const context = secretariatContextOf(document);
        if (secretariatShared.context !== context) {
            secretariatShared = { context, tasks: [], checkedAt: 0, loading: false, error: '' };
            secretariatSharedLastAttempt = 0;
            secretariatRenderShared();
        }
        if (secretariatSharedPending) return secretariatSharedPending;
        if (!force && Date.now() - secretariatSharedLastAttempt < 10000) return Promise.resolve();

        secretariatSharedLastAttempt = Date.now();
        secretariatShared.loading = true;
        secretariatShared.error = '';
        secretariatRenderShared();
        secretariatSharedPending = (async () => {
            try {
                await secretariatCheckServerContext(context);
                const tasksById = new Map();
                // Chargement séquentiel pour limiter la charge et éviter d'afficher
                // deux états d'une même tâche déplacée entre deux listes.
                for (const section of SECRETARIAT_TASK_SECTIONS) {
                    const doc = await secretariatReadDocument(`/tasks?filter=${section.filter}`, true);
                    for (const task of secretariatParseTaskList(doc, section)) tasksById.set(task.taskId, task);
                }
                await secretariatCheckServerContext(context);
                if (secretariatContextOf(document) !== context || secretariatShared.context !== context) return;
                secretariatShared.tasks = [...tasksById.values()];
                secretariatShared.checkedAt = Date.now();
            } catch (_) {
                // Aucun corps de réponse, texte de consigne ou détail réseau ne
                // doit entrer dans les logs. Une erreur ne remplace pas la dernière
                // lecture valide par « aucune tâche ».
                if (secretariatShared.context === context) {
                    secretariatShared.error = 'Actualisation impossible.';
                }
                secretariatLog('WARN', 'Lecture des consignes partagées indisponible');
            } finally {
                secretariatShared.loading = false;
                secretariatSharedPending = null;
                secretariatRenderShared();
                if (secretariatContextOf(document) !== context && secretariatHasMessageRows()) {
                    window.setTimeout(() => secretariatRefreshShared(true), 0);
                }
            }
        })();
        return secretariatSharedPending;
    }

    function secretariatSetupSharedReading() {
        if (!secretariatSharedTimer) {
            secretariatSharedTimer = window.setInterval(() => {
                if (!document.hidden) secretariatRefreshShared(true);
            }, SECRETARIAT_REFRESH_MS);
        }
        if (!secretariatSharedListenersInstalled) {
            window.addEventListener('focus', () => secretariatRefreshShared());
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) secretariatRefreshShared();
            });
            secretariatSharedListenersInstalled = true;
        }
        secretariatRefreshShared();
    }

    function secretariatLog(level, message, data = null) {
        // IMPORTANT : ne jamais journaliser le texte de la consigne, le nom ou le téléphone.
        const safe = data ? { feature: 'consignes_secretariat', ...data } : { feature: 'consignes_secretariat' };
        addLog(level, `[Consignes secrétariat] ${message}`, safe);
    }

    function secretariatErrorData(error, extra = {}) {
        return {
            ...extra,
            errorName: error && error.name ? error.name : 'Error',
            errorMessage: error && error.message ? error.message : String(error),
            stack: String(error && error.stack ? error.stack : '').slice(0, 1200)
        };
    }

    function secretariatContextOf(doc) {
        const active = doc.querySelector('#envNav .choice.active');
        const proId = active?.querySelector('[pro-id]')?.getAttribute('pro-id');
        const title = active?.title;
        return proId && title ? `${proId}|${title}` : null;
    }

    function secretariatVisible(node) {
        return Boolean(node && node.getClientRects().length);
    }

    function secretariatSetField(field, value, win, fieldName, messageId) {
        if (!field) {
            secretariatLog('ERROR', 'Champ MadeForMed introuvable', { fieldName, messageId });
            throw new Error('Un champ du formulaire MadeForMed a changé. Le texte reste dans la messagerie.');
        }

        field.value = value;
        field.dispatchEvent(new win.Event('input', { bubbles: true }));
        field.dispatchEvent(new win.Event('change', { bubbles: true }));

        secretariatLog('INFO', 'Champ renseigné', {
            fieldName,
            messageId,
            valueLength: String(value || '').length
        });
    }

    function secretariatPayloadOf(row, note) {
        const id = row.getAttribute('data-id');
        if (!/^\d+$/.test(id || '')) {
            throw new Error('Le message ne possède pas d’identifiant exploitable.');
        }

        const name = (row.getAttribute('data-name') || '').trim();
        const phone = (row.getAttribute('data-phone') || '').trim();
        const sender = name || phone || 'Expéditeur';
        const received = row.cells[2]?.innerText.replace(/\s+/g, ' ').trim() || '';
        const title = `Consigne — ${sender.slice(0, 150)} — message #${id}`;
        const reference = `tm-mf-${crypto.randomUUID()}`;
        const detail = [
            note.trim(),
            '',
            `Message MadeForMed #${id}`,
            name ? `Expéditeur : ${name}` : '',
            phone ? `Téléphone : ${phone}` : '',
            received ? `Reçu le : ${received}` : '',
            `Référence de consigne : ${reference}`,
            `Retrouver le message : ${location.origin}${location.pathname}#tm-mf-message=${id}`
        ].filter((line, index) => line || index === 1).join('\n');

        secretariatLog('INFO', 'Consigne prête en mémoire', {
            messageId: id,
            noteLength: note.trim().length,
            hasSenderName: Boolean(name),
            hasPhone: Boolean(phone),
            hasReceivedDate: Boolean(received),
            hasContext: Boolean(secretariatContextOf(document))
        });

        return {
            messageId: id,
            title,
            detail,
            context: secretariatContextOf(document),
            note: note.trim(), reference
        };
    }

    function secretariatDestinationStatus(form) {
        const field = form.querySelector('[name="data[Task][dest]"]');
        const selected = form.querySelector('.dest-selected');
        const items = form.querySelectorAll('.dest-item');
        if (!field && !selected && !items.length) {
            return { mode: 'agenda', valid: true };
        }
        const id = selected?.getAttribute('task-dest-id') || '';
        const valid = /^\d+$/.test(id) && Boolean(field) && field.value === id &&
            normalizeText(selected?.querySelector('.dest-name')?.textContent) === 'secretaire';
        return { mode: 'secretariat', valid, id };
    }

    function secretariatCreationFailureDetail(error, stage) {
        // Seuls des messages techniques fixes sont affichés : aucun texte de
        // réponse réseau, de consigne ou d'identité ne doit entrer dans les logs.
        const safeMessages = new Set([
            'Connexion expirée.', 'Cabinet différent.', 'Contexte changé.',
            'Délai de chargement dépassé.',
            'Le destinataire Secrétaire est absent de cet agenda.',
            'Le sélecteur de destinataire MadeForMed est incomplet.',
            'L’attribution au secrétariat n’a pas été confirmée.',
            'Formulaire de création non reconnu.',
            'Attribution ou type de tâche non confirmé.',
            'Contexte ou formulaire changé.',
            'Enregistrement indisponible.'
        ]);
        return safeMessages.has(error?.message) ? error.message
            : 'Échec pendant ' + stage + '. Vérifiez la connexion et le médecin actif, puis réessayez.';
    }

    async function secretariatPrepareTask(frame, payload) {
        const messageId = payload.messageId;
        secretariatLog('INFO', 'Création de la tâche démarrée', { messageId });

        let { doc } = await secretariatWaitNative(
            frame, payload.context,
            d => d.querySelector('#shortcuts .menu-task-btn')
        );

        const popupContext = secretariatContextOf(doc);
        if (!payload.context || popupContext !== payload.context) {
            secretariatLog('ERROR', 'Contexte médecin/cabinet différent', {
                messageId,
                parentContextPresent: Boolean(payload.context),
                popupContextPresent: Boolean(popupContext),
                contextMatches: false
            });
            throw new Error('Le médecin ou le cabinet actif a changé. Revenez à la messagerie du bon médecin avant de préparer la tâche.');
        }

        const taskMenus = [...doc.querySelectorAll('#shortcuts .menu-task-btn')];
        const taskMenu = taskMenus.find(secretariatVisible);
        secretariatLog('INFO', 'Raccourcis Tâches inspectés', {
            messageId,
            candidates: taskMenus.length,
            visibleFound: Boolean(taskMenu)
        });

        if (!taskMenu) throw new Error('Le raccourci Tâches est introuvable.');
        taskMenu.click();

        ({ doc } = await secretariatWaitNative(
            frame, payload.context,
            d => secretariatVisible(d.querySelector('#tasks .new-task-btn'))
        ));

        const newTaskButton = doc.querySelector('#tasks .new-task-btn');
        if (!newTaskButton) throw new Error('Le bouton Nouvelle tâche est introuvable.');
        newTaskButton.click();

        ({ doc } = await secretariatWaitNative(
            frame, payload.context,
            d => secretariatVisible(d.querySelector('.new-task #TaskView'))
        ));

        if (secretariatContextOf(doc) !== payload.context) {
            secretariatLog('ERROR', 'Contexte changé après ouverture du formulaire', { messageId });
            throw new Error('Le contexte du cabinet a changé. Aucune tâche n’a été envoyée.');
        }

        const form = doc.querySelector('.new-task #TaskView');
        if (!form) throw new Error('Le formulaire de tâche est introuvable.');

        if (form.querySelector('[name="data[Task][id]"]')?.value) {
            secretariatLog('ERROR', 'Le formulaire correspond à une tâche existante', { messageId });
            throw new Error('Ce formulaire concerne une tâche existante. Aucune modification n’a été appliquée.');
        }

        const destinations = [...form.querySelectorAll('.dest-item')];
        const initialDestination = secretariatDestinationStatus(form);
        if (initialDestination.mode === 'agenda') {
            // Ce formulaire natif n'offre pas d'attribution de destinataire.
            // Créer une tâche de l'agenda sans inventer de champ d'attribution.
            secretariatLog('INFO', 'Formulaire de tâche de l’agenda reconnu', { messageId });
        } else {
            const secretary = destinations.find(item =>
                normalizeText(item.querySelector('.dest-name')?.textContent) === 'secretaire'
            );
            secretariatLog('INFO', 'Destinataires inspectés', {
                messageId,
                destinationCount: destinations.length,
                secretaryFound: Boolean(secretary)
            });
            if (!secretary) throw new Error('Le destinataire Secrétaire est absent de cet agenda.');
            const selected = form.querySelector('.dest-selected');
            if (!selected) throw new Error('Le sélecteur de destinataire MadeForMed est incomplet.');
            selected.click();
            secretary.click();
            const expectedId = secretary.getAttribute('task-dest-id');
            const destination = secretariatDestinationStatus(form);
            if (!destination.valid || destination.id !== expectedId) {
                throw new Error('L’attribution au secrétariat n’a pas été confirmée.');
            }
            secretariatLog('INFO', 'Destinataire Secrétaire confirmé', { messageId });
        }

        secretariatSetField(
            form.querySelector('[name="data[Task][titre]"]'),
            payload.title,
            frame.contentWindow,
            'titre',
            messageId
        );

        secretariatSetField(
            form.querySelector('[name="data[Task][detail]"]'),
            payload.detail,
            frame.contentWindow,
            'detail',
            messageId
        );

        // Garder le formulaire et son handler natif, avec ses propres jetons.
        const action = new URL(form.getAttribute('action'), location.origin);
        if (action.origin !== location.origin || action.pathname !== '/tasks' || action.search ||
            form.getAttribute('method')?.toLowerCase() !== 'post') {
            throw new Error('Formulaire de création non reconnu.');
        }
        if (!secretariatDestinationStatus(form).valid ||
            form.querySelector('[name="data[Task][type]"]')?.value !== '0') {
            throw new Error('Attribution ou type de tâche non confirmé.');
        }
        const save = form.querySelector('input.save[type="submit"], button.save[type="submit"]');
        if (!save || save.disabled || save.classList.contains('disabled')) {
            throw new Error('Enregistrement indisponible.');
        }
        return { form, save };
    }

    async function secretariatFindCreated(payload) {
        await secretariatCheckServerContext(payload.context);
        let found = null;
        for (const section of SECRETARIAT_TASK_SECTIONS) {
            const doc = await secretariatReadDocument(`/tasks?filter=${section.filter}`, true);
            found = secretariatParseTaskList(doc, section).find(task =>
                task.messageId === payload.messageId && task.note === payload.note &&
                task.reference === payload.reference
            );
            if (found) break;
        }
        await secretariatCheckServerContext(payload.context);
        if (secretariatContextOf(document) !== payload.context) throw new Error('Contexte changé.');
        return found;
    }

    async function secretariatVerifyCreated(payload) {
        const end = Date.now() + 20000;
        do {
            const found = await secretariatFindCreated(payload);
            if (found) return found;
            await sleep(600);
        } while (Date.now() < end);
        throw new Error('Enregistrement non confirmé.');
    }

    async function secretariatCreateTask(payload, progress, verifyOnly = false) {
        if (secretariatCreating || secretariatCompleting || secretariatManaging) throw new Error('Une tâche est déjà en cours.');
        secretariatCreating = payload;
        secretariatRenderShared();
        let frame = null;
        let submitted = verifyOnly;
        let stage = 'le contrôle du cabinet';
        try {
            if (secretariatSharedPending) await secretariatSharedPending;
            await secretariatCheckServerContext(payload.context);
            if (secretariatContextOf(document) !== payload.context) throw new Error('Contexte changé.');
            if (!verifyOnly) {
                stage = 'la préparation du formulaire de tâche';
                frame = document.createElement('iframe');
                frame.title = 'Création MadeForMed';
                frame.setAttribute('aria-hidden', 'true');
                frame.tabIndex = -1;
                frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;';
                frame.src = new URL('/agenda', location.origin).href;
                document.body.append(frame);
                const { form, save } = await secretariatPrepareTask(frame, payload);
                stage = 'le contrôle du formulaire avant enregistrement';
                await secretariatCheckServerContext(payload.context);
                if (secretariatContextOf(document) !== payload.context ||
                    secretariatContextOf(frame.contentDocument) !== payload.context ||
                    !form.isConnected || form.querySelector('[name="data[Task][id]"]')?.value ||
                    !secretariatDestinationStatus(form).valid ||
                    form.querySelector('[name="data[Task][type]"]')?.value !== '0') {
                    throw new Error('Contexte ou formulaire changé.');
                }
                progress('Enregistrement dans MadeForMed…');
                submitted = true;
                save.click(); // Un seul envoi : aucune répétition automatique de l’écriture.
            }
            stage = 'la vérification de l’enregistrement';
            progress('Vérification de l’enregistrement…');
            const created = await secretariatVerifyCreated(payload);
            if (secretariatShared.context === payload.context) {
                secretariatShared.tasks = secretariatShared.tasks.filter(t => t.taskId !== created.taskId);
                secretariatShared.tasks.push(created);
            }
            secretariatLog('INFO', 'Création confirmée dans MadeForMed', { messageId: payload.messageId, taskId: created.taskId });
            return created;
        } catch (cause) {
            secretariatLog('WARN', 'Création de tâche interrompue', {
                messageId: payload.messageId, stage, submitted
            });
            const error = new Error(submitted
                ? 'Enregistrement non confirmé. Cliquez sur Vérifier l’enregistrement avant toute nouvelle tentative.'
                : 'Ajout impossible. ' + secretariatCreationFailureDetail(cause, stage));
            error.submitted = submitted;
            throw error;
        } finally {
            frame?.remove();
            secretariatCreating = null;
            secretariatRenderShared();
            await secretariatRefreshShared(true);
        }
    }

    function secretariatInstallStyle() {
        if (document.getElementById(`${SECRETARIAT_PREFIX}-style`)) return;

        const style = document.createElement('style');
        style.id = `${SECRETARIAT_PREFIX}-style`;
        style.textContent = `
            .${SECRETARIAT_PREFIX} {
                margin-top: 12px;
                padding-top: 10px;
                border-top: 1px solid #dae2df;
                min-width: 190px;
                max-width: 280px;
                white-space: normal;
                text-align: left;
            }
            .${SECRETARIAT_PREFIX} label {
                display: block;
                font-size: 12px;
                font-weight: 700;
                color: #315c50;
                margin-bottom: 6px;
            }
            .${SECRETARIAT_PREFIX}-saved[hidden] { display: none !important; }
            .${SECRETARIAT_PREFIX}-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
            .${SECRETARIAT_PREFIX}-actions .${SECRETARIAT_PREFIX}-complete { flex-basis: 100%; }
            .${SECRETARIAT_PREFIX}-actions .${SECRETARIAT_PREFIX}-secondary,
            .${SECRETARIAT_PREFIX}-actions .${SECRETARIAT_PREFIX}-delete { flex: 1; }
            .${SECRETARIAT_PREFIX}-edit button + button { margin-left: 6px; }
            .${SECRETARIAT_PREFIX}-actions button { margin: 0; padding: 5px 8px; font-size: 11px; }
            .${SECRETARIAT_PREFIX} button.${SECRETARIAT_PREFIX}-secondary { background: #e4ece8; color: #315c50; }
            .${SECRETARIAT_PREFIX} button.${SECRETARIAT_PREFIX}-delete { background: #f8e9e6; color: #993f35; }
            .${SECRETARIAT_PREFIX}-edit { margin-top: 8px; }
            .${SECRETARIAT_PREFIX}-editor[hidden] { display: none !important; }
            .${SECRETARIAT_PREFIX}-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .${SECRETARIAT_PREFIX}-head label { margin-bottom: 0; }
            .${SECRETARIAT_PREFIX} button.${SECRETARIAT_PREFIX}-toggle {
                margin: 0;
                padding: 0;
                width: 24px;
                height: 24px;
                font-size: 18px;
                line-height: 24px;
            }
            .${SECRETARIAT_PREFIX}-editor { margin-top: 6px; }
            .${SECRETARIAT_PREFIX} textarea {
                display: block;
                box-sizing: border-box;
                width: 100%;
                min-height: 78px;
                resize: vertical;
                padding: 8px;
                border: 1px solid #cbd8d2;
                border-radius: 6px;
                background: #fff;
                color: #202e28;
                font: 13px/1.4 system-ui, sans-serif;
            }
            .${SECRETARIAT_PREFIX} textarea:focus {
                outline: 2px solid #67a790;
                outline-offset: 1px;
            }
            .${SECRETARIAT_PREFIX} button {
                margin-top: 7px;
                padding: 7px 10px;
                border: 0;
                border-radius: 6px;
                background: #315c50;
                color: #fff;
                font: 600 12px/1.4 system-ui, sans-serif;
                cursor: pointer;
            }
            .${SECRETARIAT_PREFIX} button:disabled {
                opacity: .5;
                cursor: default;
            }
            .${SECRETARIAT_PREFIX} small {
                display: block;
                margin-top: 6px;
                color: #58685f;
                font: 11px/1.4 system-ui, sans-serif;
            }
            .${SECRETARIAT_PREFIX} small[data-error="true"] {
                color: #a33426;
            }
            .${SECRETARIAT_PREFIX} small:empty {
                display: none;
            }
            .${SECRETARIAT_PREFIX}-saved {
                margin-top: 10px;
                padding-top: 0;
            }
            .${SECRETARIAT_PREFIX}-saved-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                font: 600 12px/1.4 system-ui, sans-serif;
                color: #315c50;
            }
            .${SECRETARIAT_PREFIX}-saved-head button {
                margin-top: 0;
                padding: 4px 6px;
                font-size: 11px;
            }
            .${SECRETARIAT_PREFIX}-saved-card {
                margin-top: 8px;
                padding: 9px;
                border: 1px solid #cbd8d2;
                border-radius: 6px;
                background: #f4f8f6;
            }
            .${SECRETARIAT_PREFIX}-task-state {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 4px;
                background: #fff0cf;
                color: #75500f;
                font: 700 11px/1.4 system-ui, sans-serif;
            }
            .${SECRETARIAT_PREFIX}-task-state[data-state="waiting"] {
                background: #e4eefb;
                color: #2d578b;
            }
            .${SECRETARIAT_PREFIX}-task-state[data-state="validated"] {
                background: #dcefe3;
                color: #285d3b;
            }
            .${SECRETARIAT_PREFIX}-saved-note {
                margin-top: 6px;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                color: #202e28;
                font: 13px/1.4 system-ui, sans-serif;
            }
            tr.${SECRETARIAT_PREFIX}-highlight > td {
                background: #fff4cb !important;
            }
        `;

        document.head.append(style);
    }

    function secretariatAddBox(row) {
        const cell = row.querySelector('td.expediteur');
        const id = row.getAttribute('data-id');

        if (!cell || !/^\d+$/.test(id || '') || cell.querySelector(`.${SECRETARIAT_PREFIX}`)) {
            return;
        }

        const box = document.createElement('div');
        box.className = SECRETARIAT_PREFIX;

        const label = document.createElement('label');
        label.textContent = 'Ajouter une tâche';

        const input = document.createElement('textarea');
        input.id = `${SECRETARIAT_PREFIX}-${id}`;
        input.placeholder = 'Votre consigne pour ce message…';
        input.maxLength = 8000;
        input.rows = 3;
        label.htmlFor = input.id;

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Ajouter la tâche';
        button.disabled = true;

        const status = document.createElement('small');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.textContent = '';

        const saved = document.createElement('div');
        saved.className = `${SECRETARIAT_PREFIX}-saved`;
        const head = document.createElement('div');
        head.className = `${SECRETARIAT_PREFIX}-head`;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = `${SECRETARIAT_PREFIX}-toggle`;
        const editor = document.createElement('div');
        editor.className = `${SECRETARIAT_PREFIX}-editor`;
        editor.id = `${SECRETARIAT_PREFIX}-editor-${id}`;
        toggle.setAttribute('aria-controls', editor.id);
        head.append(label, toggle);
        editor.append(input, button);
        box.append(head, editor, status, saved);
        cell.append(box);
        secretariatRenderSharedBox(row);

        let busy = false;
        let uncertainPayload = null;
        const setOpen = open => {
            editor.hidden = !open;
            toggle.textContent = open ? '−' : '+';
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Masquer la saisie de tâche' : 'Ajouter une tâche');
            if (open && !busy) input.focus();
        };
        setOpen(false);
        toggle.addEventListener('click', () => setOpen(editor.hidden));
        const update = () => {
            button.disabled = busy || Boolean(secretariatCreating) || Boolean(secretariatCompleting) || Boolean(secretariatManaging) ||
                (!uncertainPayload && !input.value.trim());
            input.readOnly = busy || Boolean(uncertainPayload);
            const text = busy ? 'Enregistrement…' : uncertainPayload ? 'Vérifier l’enregistrement' : 'Ajouter la tâche';
            if (button.textContent !== text) button.textContent = text;
        };
        update();
        input.addEventListener('input', update);
        box.addEventListener('tm-mf-task-state', update);
        box.addEventListener('click', event => event.stopPropagation());
        box.addEventListener('keydown', event => event.stopPropagation());

        button.addEventListener('click', async () => {
            if (busy || secretariatCreating || secretariatCompleting || secretariatManaging || (!uncertainPayload && !input.value.trim())) return;
            let payload;
            try {
                payload = uncertainPayload || secretariatPayloadOf(row, input.value);
                if (!payload.context) throw new Error('Sélectionnez le médecin concerné.');
            } catch (error) {
                status.textContent = error.message;
                status.dataset.error = 'true';
                return;
            }
            busy = true;
            update();
            status.dataset.error = 'false';
            status.textContent = uncertainPayload ? 'Vérification de l’enregistrement…' : 'Ajout de la tâche…';
            try {
                await secretariatCreateTask(payload, text => { status.textContent = text; }, Boolean(uncertainPayload));
                uncertainPayload = null;
                input.value = '';
                status.textContent = '';
                setOpen(false);
            } catch (error) {
                if (error.submitted) uncertainPayload = payload;
                status.textContent = error.message;
                status.dataset.error = 'true';
                secretariatLog('WARN', 'Création indisponible ou non confirmée', { messageId: id });
            } finally {
                busy = false;
                update();
            }
        });
    }

    function secretariatHighlightMessage() {
        const match = location.hash.match(/^#tm-mf-message=(\d+)$/);
        if (!match) return;

        const row = document.querySelector(`#messages tr.user-message[data-id="${match[1]}"]`);

        if (row && !row.classList.contains(`${SECRETARIAT_PREFIX}-highlight`)) {
            row.classList.add(`${SECRETARIAT_PREFIX}-highlight`);
            mfmGroupCallsScan(); // Révéler un appel replié avant le défilement.
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            secretariatLog('INFO', 'Message référencé retrouvé et surligné', { messageId: match[1] });
        }
    }

    function secretariatScan() {
        if (!isMadeformed()) return;

        const rows = document.querySelectorAll('#messages tr.user-message[data-id]');
        rows.forEach(secretariatAddBox);
        secretariatRenderShared();
        if (rows.length && secretariatShared.context !== secretariatContextOf(document)) {
            secretariatRefreshShared(true);
        }
        secretariatHighlightMessage();
    }

    function setupSecretariatConsignes() {
        if (!isMadeformed()) return;

        secretariatInstallStyle();

        if (!secretariatObserver && document.body) {
            secretariatObserver = new MutationObserver(() => {
                if (secretariatScanQueued) return;
                secretariatScanQueued = true;

                requestAnimationFrame(() => {
                    secretariatScanQueued = false;
                    secretariatScan();
                });
            });

            secretariatObserver.observe(document.body, { childList: true, subtree: true });
        }

        if (!secretariatHashListenerInstalled) {
            window.addEventListener('hashchange', secretariatHighlightMessage);
            secretariatHashListenerInstalled = true;
        }

        secretariatScan();
        secretariatSetupSharedReading();

        secretariatLog('INFO', 'Module chargé', {
            path: location.pathname,
            messageRowsDetected: document.querySelectorAll('#messages tr.user-message[data-id]').length
        });
    }

/* BEGIN MFM_NATIVE_TOOLS_V214 */
// Lecture et actions via les formulaires MadeForMed ; le choix du fichier déclenche son ajout natif.
const MFM_NATIVE_TTL = 60000;
const MFM_NATIVE_TIME_ZONE = 'Europe/Paris';
const mfmNativeParisFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone:MFM_NATIVE_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
});
const mfmNativeStates = new WeakMap();
const mfmNativeElements = new Set();
const mfmNativeCache = new Map();
const mfmNativeQueue = [];
let mfmNativeInstalled = false;
let mfmNativeObserver = null;
let mfmNativeTimer = null;
let mfmNativeScanTimer = null;
let mfmNativeQueueScheduled = false;
let mfmNativePaletteObserver = null;
let mfmNativePaletteFrame = null;
const mfmNativePaletteRows = new Set();
let mfmNativeBusy = false;
let mfmNativeWorker = null;
let mfmNativeOverlay = null;
let mfmNativeContext = null;
let mfmNativeGeneration = 0;
let mfmNativeDocumentOperation = null;
let mfmNativeDocumentNotice = null;
const mfmNativeDocumentOperations = new Set();
const MFM_DOCUMENT_MAX_SIZE = 52428800;
const MFM_DOCUMENT_ACCEPT = 'text/*,image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp';

function mfmNativeLog(message, data = {}, level = 'INFO') {
    try { addLog(level, `MadeForMed natif — ${message}`, data); } catch (_) {}
}

const MFM_DOCUMENT_PENDING_KEY = 'TM_MADEFORMED_DOCUMENT_PENDING_V1';
const mfmNativeDocumentPending = new Map();

function mfmNativeDocumentKey(state) {
    return JSON.stringify([state.info.context, state.info.sourceId]);
}

function mfmNativeDocumentJournal() {
    const value = GM_getValue(MFM_DOCUMENT_PENDING_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? {...value} : {};
}

function mfmNativeDocumentLock(op) {
    if (!mfmNativeUid(op.uid)) throw new Error('Patient du document non confirmé.');
    op.sourceSignature = op.state.info.signature;
    const key = mfmNativeDocumentKey(op.state);
    const journal = mfmNativeDocumentJournal();
    // Aucun nom, téléphone, nom de fichier ou contenu dans le journal durable.
    journal[key] = {context:op.state.info.context, sourceId:op.state.info.sourceId, uid:op.uid,
        before:[...(op.before?.keys() || [])], expectedCount:op.names.length, at:Date.now()};
    GM_setValue(MFM_DOCUMENT_PENDING_KEY, journal);
    mfmNativeDocumentPending.set(key, op);
    op.state.docPending = op;
}

function mfmNativeDocumentForget(op) {
    const key = mfmNativeDocumentKey(op.state);
    mfmNativeDocumentPending.delete(key);
    try {
        const journal = mfmNativeDocumentJournal();
        delete journal[key];
        GM_setValue(MFM_DOCUMENT_PENDING_KEY, journal);
    } catch (_) { mfmNativeLog('Verrou du document à vérifier après rechargement', {}, 'WARN'); }
    op.state.docPending = null;
}

function mfmNativeDocumentPendingFor(state) {
    const key = mfmNativeDocumentKey(state);
    let op = mfmNativeDocumentPending.get(key);
    if (!op) {
        let record;
        try { record = mfmNativeDocumentJournal()[key]; } catch (_) { return null; }
        if (!record || record.context !== state.info.context || record.sourceId !== state.info.sourceId ||
            !mfmNativeUid(record.uid) || !Array.isArray(record.before) || !Number.isSafeInteger(record.expectedCount) || record.expectedCount < 1) return null;
        op = {state, uid:record.uid, sourceSignature:state.info.signature,
            requiresIdentityChoice:!state.info.uid, before:new Map(record.before.map(id => [String(id), []])),
            expectedCount:record.expectedCount, restored:true, names:[], files:[], fileList:null,
            frame:null, carrier:null, picker:null, chooser:null, timer:null, watch:null,
            closed:false, dispatched:true, phase:'uncertain'};
        mfmNativeDocumentPending.set(key, op);
    }
    if (op.closed) return null;
    const sourceChanged = !state.info.uid && op.sourceSignature !== state.info.signature;
    op.requiresIdentityChoice ||= sourceChanged;
    // Le remplacement de state ne doit jamais effacer une divergence déjà observée.
    op.identityMismatch ||= Boolean(state.info.conflict || (state.info.uid && state.info.uid !== op.uid) || sourceChanged);
    op.state = state;
    state.docPending = op;
    return op;
}

function mfmNativeDocumentValidateFiles(files, input = null) {
    const nativeMaximum = Number(input?.getAttribute('max-size'));
    const maximum = Number.isFinite(nativeMaximum) && nativeMaximum > 0 ? Math.min(nativeMaximum, MFM_DOCUMENT_MAX_SIZE) : MFM_DOCUMENT_MAX_SIZE;
    if (files.some(file => typeof file.name !== 'string' || !file.name.trim())) throw new Error('Nom du document indisponible.');
    if (files.some(file => !Number.isFinite(file.size) || file.size < 0 || file.size > maximum)) {
        throw new Error('Fichier trop volumineux : maximum 50 Mo par fichier, dans la limite du formulaire MadeForMed.');
    }
    if (input && !input.multiple && files.length > 1) throw new Error('Le formulaire MadeForMed accepte un seul fichier.');
    const extensions = /\.(txt|csv|tsv|html?|rtf|json|xml|md|pdf|docx?|xlsx?|pptx?|odt|ods|odp|png|jpe?g|gif|webp|svg|bmp|tiff?|ico|hei[cf]|mp3|wav|m4a|aac|ogg|flac|wma|opus|mp4|mov|avi|mkv|webm|mpe?g|m4v)$/i;
    if (files.some(file => !/^(text|image|video|audio)\//i.test(file.type || '') && !extensions.test(file.name || ''))) {
        throw new Error('Format de fichier non pris en charge. Choisissez un document, une image, un fichier texte, audio ou vidéo.');
    }
    const accept = (input?.getAttribute('accept') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (accept.length && files.some(file => !accept.some(rule => rule === '*/*' ||
        (rule.startsWith('.') ? String(file.name).toLowerCase().endsWith(rule) :
            rule.endsWith('/*') ? String(file.type || '').toLowerCase().startsWith(rule.slice(0,-1)) : String(file.type || '').toLowerCase() === rule)))) {
        throw new Error('Ce format est refusé par le formulaire MadeForMed.');
    }
}

function mfmNativeDocumentReadOnly(doc) {
    const profile = doc.querySelector('.user-detail.active[data-user-id]');
    const area = profile?.querySelector('#user-docs');
    if (!area) return;
    area.querySelectorAll('input[type="file"],button[type="submit"],input[type="submit"]').forEach(input => {
        input.disabled = true;
        if (input.type === 'file') input.value = '';
    });
    if (area.dataset.tmMfReadOnly === '1') return;
    area.dataset.tmMfReadOnly = '1';
    const block = event => {
        if (event.type === 'change' && event.target?.type !== 'file') return;
        event.preventDefault(); event.stopImmediatePropagation();
    };
    for (const type of ['change','drop','dragover','submit']) area.addEventListener(type, block, true);
}

async function mfmNativeDocumentManualFinish(op) {
    if (!mfmNativeDocumentAlive(op) || op.identityMismatch) return;
    mfmNativeDocumentForget(op);
    op.closed = true;
    if (mfmNativeOverlay?.documentOperation === op) mfmNativeCloseOverlay();
    mfmNativeDocumentDispose(op);
    mfmNativeActionStatus(op.state, 'Vérification manuelle terminée. Aucun nouvel envoi effectué.');
}

function mfmNativeDocumentPreparing() {
    return Boolean(mfmNativeDocumentOperation && ['picking', 'preparing'].includes(mfmNativeDocumentOperation.phase));
}

function mfmNativeActionStatus(state, message, verify = null, tone = '') {
    if (mfmNativeSource(state.element)?.signature !== state.info.signature) return;
    if (!state.actionStatus) {
        state.actionStatus = document.createElement('span');
        state.actionStatus.className = 'tm-mf-native-action-status';
        state.actionStatus.setAttribute('role', 'status');
        state.actions?.append(state.actionStatus);
    }
    state.actionStatus.dataset.state = tone;
    state.actionStatus.replaceChildren(document.createTextNode(message));
    if (verify) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Vérifier';
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); verify(); });
        state.actionStatus.append(' ', button);
    }
}

function mfmNativeDismissDocumentNotice() {
    if (!mfmNativeDocumentNotice) return;
    clearTimeout(mfmNativeDocumentNotice.timer);
    mfmNativeDocumentNotice.root.remove();
    mfmNativeDocumentNotice = null;
}

function mfmNativeConfirmDocumentNotice(state, message) {
    if (!state.element.isConnected || mfmNativeSource(state.element)?.signature !== state.info.signature) return;
    mfmNativeDismissDocumentNotice();
    const root = document.createElement('div');
    root.className = 'tm-mf-native-document-success';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fermer la confirmation du document');
    close.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); mfmNativeDismissDocumentNotice();
    });
    root.append(text, close);
    document.body.append(root);
    mfmNativeDocumentNotice = {root, timer:setTimeout(mfmNativeDismissDocumentNotice, 8000)};
}

function mfmNativeDocumentAlive(op, allowIdentityChoice = false) {
    const identityReady = (!op.identityMismatch && !op.requiresIdentityChoice) ||
        (allowIdentityChoice && op.requiresIdentityChoice && !op.state.info.uid && !op.state.info.conflict);
    return !op.closed && identityReady && op.state.element.isConnected && secretariatContextOf(document) === op.state.info.context &&
        mfmNativeSource(op.state.element)?.signature === op.state.info.signature;
}

function mfmNativeDocumentFinish(op, confirmed = false) {
    if (op.closed) return;
    if (confirmed && !mfmNativeDocumentConfirmed(op)) return;
    if (confirmed) {
        mfmNativeDocumentForget(op);
        mfmNativeLog('Document confirmé', {messageId:op.state.info.sourceId, fileCount:op.names.length, requestObserved:op.watch?.attempted() || false});
        op.closed = true;
        mfmNativeDocumentOperations.delete(op);
        if (mfmNativeOverlay?.documentOperation === op) mfmNativeCloseOverlay();
        clearInterval(op.timer);
        op.watch?.dispose();
        op.frame?.remove();
        op.carrier?.remove();
        op.chooser?.remove();
        op.picker?.remove();
        op.state.docPending = null;
        const message = op.names.length > 1 ? `✓ ${op.names.length} documents envoyés sur MadeForMed.` : '✓ Document envoyé sur MadeForMed.';
        mfmNativeActionStatus(op.state, message, null, 'success');
        mfmNativeConfirmDocumentNotice(op.state, message);
        op.files = [];
        op.fileList = null;
    } else {
        if (op.phase !== 'uncertain') mfmNativeLog('Document à vérifier', {messageId:op.state.info.sourceId, requestObserved:op.watch?.attempted() || false}, 'WARN');
        op.phase = 'uncertain';
        op.state.docPending = op;
        mfmNativeActionStatus(op.state, 'Ajout à vérifier.', () => mfmNativeDocumentVerify(op));
        op.files = [];
        op.fileList = null;
    }
    if (mfmNativeDocumentOperation === op) mfmNativeDocumentOperation = null;
    mfmNativeCache.clear();
    mfmNativeScheduleScan();
}

function mfmNativeDocumentCancel(op, message = '') {
    if (op.closed) return;
    // Après le change, un résultat incertain est vérifié sans nouvel envoi.
    if (op.dispatched) { mfmNativeDocumentFinish(op, false); return; }
    op.closed = true;
    mfmNativeDocumentForget(op);
    mfmNativeDocumentOperations.delete(op);
    clearInterval(op.timer);
    op.watch?.dispose();
    op.frame?.remove();
    op.carrier?.remove();
    op.chooser?.remove();
    op.picker?.remove();
    op.files = [];
    op.fileList = null;
    if (mfmNativeDocumentOperation === op) mfmNativeDocumentOperation = null;
    mfmNativeActionStatus(op.state, message);
    mfmNativeScheduleScan();
}

function mfmNativeDocumentReadResult(status, text) {
    if (status < 200 || status >= 300) return false;
    try {
        const result = JSON.parse(text);
        if (!result || typeof result !== 'object') return null;
        const errors = result.errors && (Array.isArray(result.errors) ? result.errors.length : typeof result.errors === 'object' ? Object.keys(result.errors).length : String(result.errors).trim());
        if (result.error || errors || result.success === false || /^(error|failed|failure)$/i.test(result.status || '')) return false;
        if (result.success === true || result.success === 1 || /^(ok|success)$/i.test(result.status || '') || result.result === 'success') return true;
    } catch (_) {}
    return null;
}

function mfmNativeDocumentSnapshot(doc, uid = doc?.querySelector('.user-detail.active[data-user-id]')?.getAttribute('data-user-id') || '') {
    const found = new Map();
    const profile = doc?.querySelector('.user-detail.active[data-user-id]');
    if (!profile || (uid && profile.getAttribute('data-user-id') !== String(uid))) return found;
    const area = profile.querySelector('#user-docs');
    if (!area) return found;
    for (const node of area.querySelectorAll('#user-docs .file[data-id][data-url],#user-docs [data-doc-id],#user-docs [data-document-id],#user-docs [doc-id],#user-docs .doc[data-id],#user-docs .document[data-id],#user-docs a[href]')) {
        // Une carte native est validée une seule fois via data-url. Son lien
        // enfant ne doit pas réintroduire une carte rejetée pour un autre UID.
        if (node.hasAttribute('href') && node.closest('.file[data-id][data-url]')) continue;
        let id = node.getAttribute('data-doc-id') || node.getAttribute('data-document-id') || node.getAttribute('doc-id') || node.getAttribute('data-id');
        if (node.matches('.file[data-id][data-url]')) {
            try {
                const url = new URL(node.getAttribute('data-url'), location.origin);
                const match = url.pathname.match(/^\/users\/([1-9]\d*)\/docs\/([1-9]\d*)\/?$/);
                if (url.origin !== location.origin || !match || (uid && match[1] !== String(uid)) || match[2] !== String(id)) continue;
            } catch (_) { continue; }
        }
        if (!id && node.hasAttribute('href')) {
            try {
                const url = new URL(node.getAttribute('href'), location.origin);
                const patient = url.pathname.match(/^\/users\/([1-9]\d*)\/(?:docs|documents)\//);
                if (uid && patient && patient[1] !== String(uid)) continue;
                if (url.origin === location.origin && /\/(docs|documents)\//.test(url.pathname)) id = url.pathname.match(/\/([0-9][a-zA-Z0-9_-]*)\/?$/)?.[1];
            } catch (_) {}
        }
        if (!id) continue;
        const card = node.closest('.file[data-id],[data-doc-id],[data-document-id],.document,.doc') || node.parentElement;
        // Un nom complet est nécessaire : « ancienne note.pdf » ne prouve pas
        // l'apparition de « note.pdf ». Préférer le champ natif du nom du fichier.
        const name = node.querySelector('.file-name')?.textContent || card?.querySelector?.('.file-name')?.textContent ||
            node.getAttribute('data-name') || node.getAttribute('title') || node.getAttribute('data-original-title') ||
            (node.hasAttribute('href') ? node.textContent : '');
        const names = found.get(String(id)) || [];
        if (name && !names.includes(name.normalize('NFC').trim())) names.push(name.normalize('NFC').trim());
        found.set(String(id), names);
    }
    return found;
}

function mfmNativeDocumentReady(doc, uid) {
    const profile = doc?.querySelector('.user-detail.active[data-user-id]');
    if (profile?.getAttribute('data-user-id') !== String(uid)) return null;
    const input = profile.querySelector('#user-docs input[type="file"][name="files[]"]');
    const form = input?.closest('form');
    if (!input || input.disabled || form?.getAttribute('action') !== `/users/${uid}/docs` || form.method.toLowerCase() !== 'post') return null;
    const container = input.closest('.files-container');
    if (container && !container.classList.contains('is-loaded')) return null;
    const area = input.closest('.file-drop-area');
    if (area && area.getAttribute('data-step') !== 'waiting') return null;
    return input;
}

function mfmNativeDocumentConfirmed(op) {
    const doc = op.frame?.contentDocument;
    if (!mfmNativeDocumentAlive(op) || !op.dispatched || !op.uid || !op.names?.length || op.restored ||
        doc?.querySelector('.user-detail.active[data-user-id]')?.getAttribute('data-user-id') !== op.uid ||
        secretariatContextOf(doc) !== op.state.info.context) return false;
    const area = doc.querySelector('.user-detail.active[data-user-id]')?.querySelector('#user-docs');
    if (!area) return false;
    const container = area.matches?.('.files-container') ? area : area.querySelector('.files-container');
    if (container && !container.classList.contains('is-loaded')) return false;
    const remaining = [...op.names];
    for (const [id, names] of mfmNativeDocumentSnapshot(doc, op.uid)) {
        if (op.before.has(id)) continue;
        const index = remaining.findIndex(name => {
            return names.includes(name.normalize('NFC').trim());
        });
        if (index !== -1) remaining.splice(index, 1);
    }
    return remaining.length === 0;
}

function mfmNativeDocumentWatch(op, form) {
    const win = op.frame.contentWindow;
    const endpoint = new URL(form.getAttribute('action'), location.origin).pathname;
    const expected = op.files.map(file => `${file.name}|${file.size}|${file.lastModified}`);
    const acknowledgements = new Map();
    let active = 0, attempted = false;
    const records = new WeakMap();
    const originalOpen = win.XMLHttpRequest.prototype.open;
    const originalSend = win.XMLHttpRequest.prototype.send;
    const originalFetch = win.fetch;
    const matches = (method, url) => {
        try { const parsed = new URL(url, location.origin); return String(method).toUpperCase() === 'POST' && parsed.origin === location.origin && parsed.pathname === endpoint; } catch (_) { return false; }
    };
    const keysOf = body => {
        try { return [...body.values()].filter(x => x && typeof x.name === 'string' && typeof x.size === 'number').map(x => `${x.name}|${x.size}|${x.lastModified}`); } catch (_) { return []; }
    };
    const complete = (keys, status, text) => {
        active--;
        const result = mfmNativeDocumentReadResult(status, text);
        if (result === true) for (const key of keys) acknowledgements.set(key, (acknowledgements.get(key) || 0) + 1);
        const needed = new Map();
        for (const key of expected) needed.set(key, (needed.get(key) || 0) + 1);
        // Un acquittement réseau n'est jamais une preuve d'apparition dans le dossier.
        // Le timer et la vérification native attendent les nouvelles cartes identifiées.
        if (result === false && active === 0) mfmNativeDocumentFinish(op, false);
    };
    const wrappedOpen = function(method, url, ...rest) { records.set(this, {method, url}); return originalOpen.call(this, method, url, ...rest); };
    const wrappedSend = function(body) {
        const request = records.get(this);
        let settle = null;
        if (request && matches(request.method, request.url)) {
            attempted = true; active++;
            const keys = keysOf(body);
            let settled = false;
            settle = (status, text, acknowledgedKeys = keys) => {
                if (settled) return;
                settled = true;
                complete(acknowledgedKeys, status, text);
            };
            this.addEventListener('loadend', () => {
                let text = '';
                try { text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText; } catch (_) {}
                settle(this.status, text);
            }, {once:true});
        }
        try { return originalSend.call(this, body); }
        catch (error) { settle?.(0, '', []); throw error; }
    };
    win.XMLHttpRequest.prototype.open = wrappedOpen;
    win.XMLHttpRequest.prototype.send = wrappedSend;
    let wrappedFetch = null;
    if (typeof originalFetch === 'function') {
        wrappedFetch = function(url, options = {}) {
            const tracked = matches(options.method || 'GET', typeof url === 'string' ? url : url.url);
            const result = originalFetch.call(this, url, options);
            if (tracked) {
                attempted = true; active++;
                const keys = keysOf(options.body);
                result.then(response => response.clone().text().then(text => complete(keys, response.status, text), () => complete(keys, response.status, '')), () => complete(keys, 0, ''));
            }
            return result;
        };
        win.fetch = wrappedFetch;
    }
    return { active:() => active, attempted:() => attempted, dispose() {
        if (win.XMLHttpRequest.prototype.open === wrappedOpen) win.XMLHttpRequest.prototype.open = originalOpen;
        if (win.XMLHttpRequest.prototype.send === wrappedSend) win.XMLHttpRequest.prototype.send = originalSend;
        if (win.fetch === wrappedFetch) win.fetch = originalFetch;
    }};
}

async function mfmNativeDocumentChoose(op, alive = () => mfmNativeDocumentAlive(op)) {
    const result = await mfmNativeWait(op.frame, doc => {
        const candidates = [...doc.querySelectorAll('.user-search.active #users-result .user.preview[data-user-id]')];
        return candidates.length ? {candidates} : null;
    }, op.state.info.context, alive);
    return new Promise((resolve, reject) => {
        const root = document.createElement('div');
        root.className = 'tm-mf-native-overlay tm-mf-native-document-chooser';
        root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
        const box = document.createElement('div'); box.className = 'tm-mf-native-dialog';
        const header = document.createElement('div'); header.className = 'tm-mf-native-header';
        const title = document.createElement('strong'); title.textContent = 'Choisir le patient pour le document';
        const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Annuler';
        close.className = 'tm-mf-native-close'; close.addEventListener('click', () => { mfmNativeDocumentCancel(op); reject(new Error('Sélection annulée.')); });
        header.append(title, close);
        const choices = document.createElement('div'); choices.className = 'tm-mf-native-choices';
        for (const patient of result.candidates) {
            const uid = mfmNativeUid(patient.getAttribute('data-user-id')); if (!uid) continue;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'tm-mf-native-choice';
            button.textContent = [patient.getAttribute('data-user-name') || mfmNativePlainText(patient.querySelector('.user-name')), mfmNativePlainText(patient.querySelector('.identite-infos'))].filter(Boolean).join(' · ');
            button.addEventListener('click', () => { if (!alive()) return; root.remove(); op.chooser = null; resolve(uid); }, {once:true});
            choices.append(button);
        }
        box.append(header, choices); root.append(box); op.chooser = root; document.body.append(root); close.focus();
    });
}

async function mfmNativeDocumentSend(op, files) {
    if (op.closed || op.dispatched) return;
    if (!mfmNativeDocumentAlive(op)) { mfmNativeDocumentCancel(op, 'Patient ou médecin modifié : document non envoyé.'); return; }
    op.files = [...files]; op.names = op.files.map(file => file.name);
    if (!op.files.length) { mfmNativeDocumentCancel(op); return; }
    try { mfmNativeDocumentValidateFiles(op.files); }
    catch (error) { mfmNativeDocumentCancel(op, error.message); return; }
    op.phase = 'preparing';
    mfmNativeLog('Préparation du document', {messageId:op.state.info.sourceId, fileCount:op.files.length});
    mfmNativeActionStatus(op.state, 'Préparation du document…');
    const frame = mfmNativeFrame('Ajout de document MadeForMed', true); op.frame = frame;
    const carrier = document.createElement('div'); carrier.className = 'tm-mf-native-overlay tm-mf-native-preparing'; carrier.hidden = true;
    const box = document.createElement('div'); box.className = 'tm-mf-native-dialog'; box.append(frame); carrier.append(box);
    op.carrier = carrier; document.body.append(carrier);
    const alive = () => mfmNativeDocumentAlive(op);
    try {
        let uid = await mfmNativeLoadProfile(frame, op.state, alive);
        if (!uid) { uid = await mfmNativeDocumentChoose(op); uid = await mfmNativeLoadProfile(frame, op.state, alive, uid); }
        if (!alive() || !uid) throw new Error('Patient ou médecin modifié.');
        op.uid = uid;
        const tab = await mfmNativeWait(frame, doc => {
            const profile = doc.querySelector('.user-detail.active[data-user-id]');
            return profile?.getAttribute('data-user-id') === uid ? profile.querySelector('a.sc-btn[href="#user-docs"]') : null;
        }, op.state.info.context, alive);
        tab.click();
        const input = await mfmNativeWait(frame, doc => mfmNativeDocumentReady(doc, uid), op.state.info.context, alive);
        mfmNativeDocumentValidateFiles(op.files, input);
        await secretariatCheckServerContext(op.state.info.context);
        if (!alive() || secretariatContextOf(frame.contentDocument) !== op.state.info.context ||
            !input.isConnected || mfmNativeDocumentReady(frame.contentDocument, uid) !== input) {
            throw new Error('Patient, médecin ou formulaire modifié avant l’envoi.');
        }
        if (!alive() || secretariatContextOf(frame.contentDocument) !== op.state.info.context) throw new Error('Patient ou médecin modifié.');
        op.state.resolvedUid = uid;
        op.before = mfmNativeDocumentSnapshot(frame.contentDocument, uid);
        mfmNativeLog('Formulaire document prêt', {messageId:op.state.info.sourceId, existingDocumentCount:op.before.size});
        mfmNativeDocumentLock(op);
        op.watch = mfmNativeDocumentWatch(op, input.closest('form'));
        if (typeof frame.contentWindow.DataTransfer === 'function') {
            const transfer = new frame.contentWindow.DataTransfer();
            op.files.forEach(file => transfer.items.add(file)); input.files = transfer.files;
        } else if (op.fileList) input.files = op.fileList;
        else throw new Error('Le navigateur ne permet pas de transmettre les fichiers au formulaire natif.');
        if (!alive() || secretariatContextOf(frame.contentDocument) !== op.state.info.context ||
            !input.isConnected || mfmNativeDocumentReady(frame.contentDocument, uid) !== input ||
            input.closest('.user-detail.active')?.getAttribute('data-user-id') !== uid) throw new Error('Patient ou médecin modifié.');
        op.dispatched = true; op.phase = 'uploading';
        op.state.docPending = op;
        mfmNativeActionStatus(op.state, 'Ajout du document en cours…');
        input.dispatchEvent(new frame.contentWindow.Event('change', {bubbles:true}));
        mfmNativeLog('Ajout natif demandé', {messageId:op.state.info.sourceId, fileCount:op.names.length, requestObserved:op.watch.attempted()});
        if (op.closed) return;
        mfmNativeScheduleScan();
        const started = Date.now();
        op.timer = setInterval(() => {
            if (op.closed) { clearInterval(op.timer); return; }
            try {
                if (!mfmNativeDocumentAlive(op) && op.watch.active() === 0) { mfmNativeDocumentDispose(op); return; }
                if (op.watch.active() === 0 && mfmNativeDocumentConfirmed(op)) { mfmNativeDocumentFinish(op, true); return; }
                if (op.phase !== 'uncertain' && Date.now() - started > 90000) mfmNativeDocumentFinish(op, false);
                if (Date.now() - started > 120000 && op.watch.active() === 0) {
                    clearInterval(op.timer); op.watch.dispose();
                    frame.contentDocument.querySelector('#user-docs input[type="file"]')?.setAttribute('disabled','');
                    const nativeInput = frame.contentDocument.querySelector('#user-docs input[type="file"]');
                    if (nativeInput) nativeInput.value = '';
                }
            } catch (_) { if (op.phase !== 'uncertain') mfmNativeDocumentFinish(op, false); }
        }, 500);
    } catch (error) { if (!op.closed) mfmNativeDocumentCancel(op, error.message); }
}

function mfmNativeDocumentPick(state) {
    const pending = mfmNativeDocumentPendingFor(state);
    if (pending) { mfmNativeDocumentVerify(pending); return; }
    const info = mfmNativeSource(state.element);
    if (!info || info.signature !== state.info.signature || !info.href || info.conflict) return;
    if (mfmNativeDocumentOperation || mfmNativeOverlay) { mfmNativeActionStatus(state, 'Une action MadeForMed est déjà en cours.'); return; }
    const picker = document.createElement('input');
    picker.type = 'file'; picker.name = 'files[]'; picker.multiple = true; picker.accept = MFM_DOCUMENT_ACCEPT;
    picker.setAttribute('max-size', String(MFM_DOCUMENT_MAX_SIZE)); picker.className = 'tm-mf-native-document-picker';
    picker.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;';
    const op = {state, picker, frame:null, files:[], names:[], fileList:null, closed:false, dispatched:false, phase:'picking', timer:null, watch:null, chooser:null};
    mfmNativeDocumentOperation = op; mfmNativeGeneration++; mfmNativeWorker?.remove();
    mfmNativeDocumentOperations.add(op);
    document.body.append(picker);
    picker.addEventListener('cancel', () => mfmNativeDocumentCancel(op), {once:true});
    picker.addEventListener('change', () => {
        if (op.closed) return;
        op.fileList = picker.files;
        const files = [...picker.files]; picker.remove();
        mfmNativeDocumentSend(op, files);
    }, {once:true});
    // Cette ouverture doit rester synchrone, à l'intérieur du geste utilisateur.
    try { if (typeof picker.showPicker === 'function') picker.showPicker(); else picker.click(); }
    catch (_) { mfmNativeDocumentCancel(op, 'Le navigateur a bloqué le sélecteur. Cliquez à nouveau sur Envoyer un document.'); }
}

function mfmNativeIsolatePanel(doc, kind) {
    const style = doc.createElement('style'); style.id = 'tm-mf-native-form-only';
    const panel = kind === 'rdv' ? '.new-rdv.panel.active' : '.user-detail.panel.active';
    style.textContent = `
        body { overflow:auto !important; }
        body * { visibility:hidden !important; }
        #infos { position:fixed !important; inset:0 !important; width:100% !important; height:100% !important; max-width:none !important; transform:none !important; }
        ${panel}, ${panel} * { visibility:visible !important; }
        ${panel} { position:fixed !important; inset:0 !important; width:100% !important; height:100% !important; max-width:none !important; transform:none !important; margin:0 !important; }
        .flatpickr-calendar,.flatpickr-calendar *,.selectize-dropdown,.selectize-dropdown *,.popover,.popover *,.swal2-container,.swal2-container * { visibility:visible !important; }
    `;
    doc.getElementById(style.id)?.remove(); doc.head.append(style);
}

async function mfmNativeDocumentVerify(op) {
    if (op.closed || op.verifying || mfmNativeOverlay) return;
    const verificationSignature = op.state.info.signature;
    const needsChoice = Boolean(op.requiresIdentityChoice && !op.state.info.uid && !op.state.info.conflict && op.state.info.href);
    const choiceAlive = () => op.state.info.signature === verificationSignature && mfmNativeDocumentAlive(op, needsChoice);
    const alive = () => op.state.info.signature === verificationSignature && mfmNativeDocumentAlive(op);
    if (!choiceAlive()) {
        mfmNativeActionStatus(op.state, 'Patient ou cabinet modifié : vérifiez le document dans la fiche native avant un nouvel envoi.');
        return;
    }
    if (op.watch?.active() > 0) { mfmNativeActionStatus(op.state, 'Ajout toujours en cours…'); return; }
    op.verifying = true;
    op.verificationAlive = () => op.requiresIdentityChoice ? choiceAlive() : alive();
    clearInterval(op.timer);
    op.watch?.dispose(); op.watch = null;
    try {
        await secretariatCheckServerContext(op.state.info.context);
        if (!choiceAlive()) throw new Error('Patient ou médecin modifié.');
        op.frame?.remove(); op.carrier?.remove();
        const frame = mfmNativeFrame('Vérification du document MadeForMed', true);
        const root = document.createElement('div'); root.className = 'tm-mf-native-overlay tm-mf-native-preparing'; root.hidden = true;
        const box = document.createElement('div'); box.className = 'tm-mf-native-dialog'; box.append(frame); root.append(box); document.body.append(root);
        op.frame = frame; op.carrier = root; mfmNativeDocumentOperations.add(op);
        if (needsChoice) {
            frame.src = op.state.info.href;
            const selectedUid = await mfmNativeDocumentChoose(op, choiceAlive);
            if (!choiceAlive() || selectedUid !== op.uid) throw new Error('Le patient choisi diffère du dossier de l’envoi précédent.');
            op.sourceSignature = op.state.info.signature;
            op.requiresIdentityChoice = false;
            op.identityMismatch = false;
            mfmNativeRememberIdentity(op.state, selectedUid);
        }
        const uid = await mfmNativeLoadProfile(frame, op.state, alive, op.uid);
        if (uid !== op.uid) throw new Error('La fiche du document a changé.');
        const tab = await mfmNativeWait(frame, doc => doc.querySelector('.user-detail.active[data-user-id]')?.querySelector('a.sc-btn[href="#user-docs"]'), op.state.info.context, alive);
        tab.click();
        await mfmNativeWait(frame, doc => mfmNativeDocumentReady(doc, op.uid), op.state.info.context, alive);
        mfmNativeDocumentReadOnly(frame.contentDocument);
        if (!op.restored && mfmNativeDocumentConfirmed(op)) { mfmNativeDocumentFinish(op, true); return; }
        root.classList.remove('tm-mf-native-preparing'); root.hidden = false; root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true');
        const header = document.createElement('div'); header.className = 'tm-mf-native-header';
        const title = document.createElement('strong'); title.textContent = 'Vérifier le document dans MadeForMed';
        const reviewed = document.createElement('button'); reviewed.type = 'button'; reviewed.textContent = 'J’ai vérifié le dossier'; reviewed.className = 'tm-mf-native-close';
        reviewed.addEventListener('click', () => mfmNativeDocumentManualFinish(op));
        const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Fermer ×'; close.className = 'tm-mf-native-close';
        close.addEventListener('click', mfmNativeCloseOverlay);
        header.append(title, reviewed, close); box.prepend(header);
        const status = document.createElement('div'); status.className = 'tm-mf-native-status';
        status.textContent = op.restored ? 'Un envoi précédent reste à vérifier. Cette fenêtre consulte le dossier et ne renvoie aucun fichier.' : 'Contrôlez la présence des documents dans la fiche. Fermer garde la vérification en attente ; aucun fichier ne sera renvoyé automatiquement.';
        header.after(status);
        frame.style.cssText = ''; frame.className = 'tm-mf-native-frame'; frame.removeAttribute('aria-hidden'); frame.removeAttribute('tabindex');
        mfmNativeIsolatePanel(frame.contentDocument, 'document');
        const overlay = {root, frame, state:op.state, closed:false, contextTimer:null, documentOperation:op};
        mfmNativeOverlay = overlay; close.focus();
        overlay.contextTimer = setInterval(() => {
            if (!alive()) { mfmNativeCloseOverlay(); return; }
            if (!op.restored && mfmNativeDocumentConfirmed(op)) mfmNativeDocumentFinish(op, true);
        }, 500);
    } catch (_) {
        mfmNativeDocumentDispose(op);
        mfmNativeActionStatus(op.state, 'Vérification indisponible. Ouvrez la fiche patient native ; aucun second envoi effectué.', () => mfmNativeDocumentVerify(op));
    } finally { op.verifying = false; op.verificationAlive = null; }
}

function mfmNativeDocumentDispose(op) {
    clearInterval(op.timer);
    op.watch?.dispose();
    op.frame?.remove(); op.carrier?.remove(); op.picker?.remove(); op.chooser?.remove();
    op.frame = null; op.carrier = null; op.picker = null; op.chooser = null; op.watch = null;
    op.files = []; op.fileList = null;
    mfmNativeDocumentOperations.delete(op);
    if (mfmNativeDocumentOperation === op) mfmNativeDocumentOperation = null;
    if (op.dispatched && !op.closed) {
        op.phase = 'uncertain';
        mfmNativeDocumentPending.set(mfmNativeDocumentKey(op.state), op);
        op.state.docPending = op;
    } else {
        op.closed = true;
        op.state.docPending = null;
    }
}

function mfmNativeUid(value) {
    const text = String(value || '').trim();
    return /^[1-9]\d*$/.test(text) ? text : '';
}

function mfmNativeProfileUrl(uid) {
    return `${location.origin}/agenda?target=user-detail&uid=${encodeURIComponent(uid)}`;
}

function mfmNativeSafeLink(href) {
    try {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin || url.pathname !== '/agenda') return null;
        const target = url.searchParams.get('target');
        if (target === 'user-detail' && mfmNativeUid(url.searchParams.get('uid'))) return url;
        if (target === 'user-search' && url.searchParams.get('field') === 'tel' && mfmNativePhone(url.searchParams.get('value'))) return url;
    } catch (_) {}
    return null;
}

function mfmNativePhone(value) {
    let phone = String(value || '').replace(/\D/g, '');
    if (phone.startsWith('0033')) phone = '0' + phone.slice(4);
    else if (phone.startsWith('33') && phone.length === 11) phone = '0' + phone.slice(2);
    return /^0\d{9}$/.test(phone) ? phone : '';
}

function mfmNativeName(value) {
    const tokens = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\b(mme|monsieur|madame|mademoiselle|mlle|mr|m)\b\.?/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    return tokens.length >= 2 ? tokens.sort().join(' ') : '';
}

function mfmNativeSource(element) {
    if (!element) return null;
    const context = secretariatContextOf(document);
    if (!context) return null;
    const message = element.matches('tr.user-message[data-id]');
    const slot = element.matches('#agenda .rdv[data-user-id]');
    if (!message && !slot) return null;
    const sourceId = element.getAttribute('data-id') || '';
    if (!/^\d+$/.test(sourceId)) return null;
    let uid = mfmNativeUid(element.getAttribute(message ? 'data-user_id' : 'data-user-id'));
    const link = message ? mfmNativeSafeLink(element.querySelector('.action a.search[href]')?.getAttribute('href')) : null;
    const linkedUid = link?.searchParams.get('target') === 'user-detail' ? mfmNativeUid(link.searchParams.get('uid')) : '';
    // Deux identifiants natifs contradictoires doivent être résolus par l'utilisateur.
    const conflict = Boolean(uid && linkedUid && uid !== linkedUid);
    if (conflict) uid = '';
    else uid ||= linkedUid;
    const name = message ? (element.getAttribute('data-name') || element.querySelector('.expediteur .name')?.textContent || '').trim()
        : (element.querySelector('.user-infos .nom, .nom')?.textContent || '').trim();
    const phone = message ? mfmNativePhone(element.getAttribute('data-phone') || link?.searchParams.get('value')) : '';
    const kind = message ? 'message' : 'agenda';
    const href = conflict ? '' : uid ? mfmNativeProfileUrl(uid) : link?.href || '';
    const signature = JSON.stringify([context, kind, sourceId, uid, name, phone, conflict, href]);
    return { uid, name, phone, sourceId, context, signature, kind, conflict,
        excludeRdv: slot ? sourceId : '', href };
}

function mfmNativePatientId(row) {
    const info = mfmNativeSource(row);
    if (!info || info.conflict) return '';
    const state = mfmNativeStates.get(row);
    return info.uid || (state?.info.signature === info.signature ? state.resolvedUid || '' : '');
}

function mfmNativeRememberIdentity(state, uid, shareCaller = false, rememberGroup = false, groupVerifiedAt = Date.now()) {
    if (!uid || !state.element.isConnected || mfmNativeSource(state.element)?.signature !== state.info.signature) return;
    state.resolvedUid = uid;
    if (rememberGroup) void mfmNativeGroupMemoryRemember(state, uid, groupVerifiedAt);
    let related = 0;
    if (shareCaller && state.info.phone && mfmNativeName(state.info.name)) {
        for (const element of mfmNativeElements) {
            const other = mfmNativeStates.get(element);
            if (!other || other.info.kind !== 'message' || other.info.uid || other.info.conflict ||
                other.info.context !== state.info.context || other.info.href !== state.info.href ||
                other.info.phone !== state.info.phone || mfmNativeName(other.info.name) !== mfmNativeName(state.info.name) ||
                (other.resolvedUid && other.resolvedUid !== uid) || mfmNativeSource(element)?.signature !== other.info.signature) continue;
            other.resolvedUid = uid;
            if (rememberGroup) void mfmNativeGroupMemoryRemember(other, uid, groupVerifiedAt);
            mfmNativePaint(other);
            related++;
        }
    }
    mfmNativeLog('Patient identifié pour les actions et le regroupement', {messageId:state.info.sourceId, relatedMessages:related});
    if (typeof mfmGroupCallsQueue === 'function') mfmGroupCallsQueue();
}

function mfmNativeMatchCandidate(doc, info) {
    const expectedName = mfmNativeName(info?.name);
    const expectedPhone = mfmNativePhone(info?.phone);
    if (!expectedName || !expectedPhone) return '';
    const matches = new Set();
    const active = [...doc.querySelectorAll('.user-search.active #users-result')];
    if (active.length > 1) return '';
    const patients = active.length ? active[0].querySelectorAll('.user.preview[data-user-id]')
        : doc.querySelectorAll('#users-result .user.preview[data-user-id]');
    for (const patient of patients) {
        const uid = mfmNativeUid(patient.getAttribute('data-user-id'));
        const nom = patient.querySelector('.user-name .nom')?.textContent || '';
        const prenom = patient.querySelector('.user-name .prenom')?.textContent || '';
        const name = nom && prenom ? `${nom} ${prenom}` : patient.getAttribute('data-user-name') || '';
        const phones = [...patient.querySelectorAll('.identite-contacts [title], .identite-contacts [data-original-title], a[data-tel], a[href^="tel:"]')]
            .map(x => mfmNativePhone(x.getAttribute('data-tel') || x.getAttribute('title') || x.getAttribute('data-original-title') || x.getAttribute('href')?.slice(4)));
        if (uid && mfmNativeName(name) === expectedName && phones.includes(expectedPhone)) matches.add(uid);
    }
    return matches.size === 1 ? [...matches][0] : '';
}

function mfmNativeParisParts(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = {};
    for (const part of mfmNativeParisFormatter.formatToParts(date)) {
        if (['year','month','day','hour','minute','second'].includes(part.type)) parts[part.type] = Number(part.value);
    }
    return parts;
}

function mfmNativeDate(text) {
    // MadeForMed fournit une date civile du cabinet, sans décalage UTC.
    // Ne pas employer le fuseau de l'ordinateur pour une date Europe/Paris.
    const match = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return NaN;
    const [year, month, day, hour, minute] = match.slice(1,6).map(Number);
    const second = Number(match[6] || 0);
    if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31 ||
        hour > 23 || minute > 59 || second > 59) return NaN;
    const civilUtc = Date.UTC(year,month - 1,day,hour,minute,second);
    const civil = new Date(civilUtc);
    if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day) return NaN;
    const offsets = new Set();
    // Les deux jours voisins couvrent les changements d'heure du cabinet.
    for (const delta of [-86400000,0,86400000]) {
        const probe = civilUtc + delta;
        const parts = mfmNativeParisParts(probe);
        if (parts) offsets.add(Date.UTC(parts.year,parts.month - 1,parts.day,parts.hour,parts.minute,parts.second) - probe);
    }
    const matches = [];
    for (const offset of offsets) {
        const timestamp = civilUtc - offset;
        const parts = mfmNativeParisParts(timestamp);
        if (parts && parts.year === year && parts.month === month && parts.day === day &&
            parts.hour === hour && parts.minute === minute && parts.second === second) matches.push(timestamp);
    }
    // Une heure inexistante ou répétée ne peut pas être choisie avec certitude.
    return matches.length === 1 ? matches[0] : NaN;
}

function mfmNativePlainText(node) {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('.avatar').forEach(x => x.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
}

function mfmNativeReadAppointments(doc, uid) {
    const profile = doc.querySelector('.user-detail.active[data-user-id]');
    if (!profile || profile.getAttribute('data-user-id') !== uid) return null;
    const future = profile.querySelector('#user-history .history-group.futur');
    if (!future || profile.querySelector('#user-history.loading, #user-history .loading, #user-history .error, #user-history[aria-busy="true"], #user-history [aria-busy="true"]')) return null;
    const items = [];
    for (const row of future.querySelectorAll('.rdv.preview[data-rdv-id][data-debut]')) {
        const id = mfmNativeUid(row.getAttribute('data-rdv-id'));
        const date = row.getAttribute('data-debut');
        const startAt = mfmNativeDate(date);
        if (!id || !Number.isFinite(startAt)) return null;
        const cancelled = row.matches('.cancelled,.canceled,.deleted,.annule,.annulee') ||
            ['data-cancelled', 'data-canceled', 'data-deleted', 'data-annule'].some(attr => /^(1|true|yes)$/i.test((row.getAttribute(attr) || '').trim())) ||
            /^(cancelled|canceled|deleted|annule|annulee)$/.test((row.getAttribute('data-status') || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase());
        items.push({ id, date, startAt, cancelled,
            practitioner: mfmNativePlainText(row.querySelector('.planning .effecteur')),
            type: mfmNativePlainText(row.querySelector('.planning .acte')) });
    }
    return items;
}

function mfmNativeNextAppointment(items, excludeRdv = '', now = Date.now()) {
    return Array.isArray(items) ? items.filter(x => !x.cancelled && x.id !== String(excludeRdv || '') &&
        Number.isFinite(x.startAt) && x.startAt > now).sort((a, b) => a.startAt - b.startAt)[0] || null : null;
}

function mfmNativeKey(info, uid = info.uid) {
    // Un choix manuel est attaché au message : deux proches/homonymes peuvent
    // partager leur téléphone et le même nom affiché sans être le même patient.
    return `${info.context}|${uid ? `uid:${uid}` : `caller:${info.signature}`}`;
}

function mfmNativeVisible(element) {
    if (document.hidden || !element.isConnected || element.closest('.tm-mf-call-group-hidden')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= -100 && rect.top <= window.innerHeight + 100 && rect.right >= 0 && rect.left <= window.innerWidth;
}

function mfmNativeSetText(node, text) {
    if (node.textContent !== text) node.textContent = text;
}

function mfmNativePaint(state) {
    const { info, badge } = state;
    const uid = mfmNativePatientId(state.element);
    const cached = mfmNativeCache.get(mfmNativeKey(info, uid));
    const fresh = cached && Date.now() - cached.at < MFM_NATIVE_TTL;
    const status = fresh ? cached.status : state.pending ? 'loading' : cached ? 'stale' : 'loading';
    let label = 'Prochain RDV : …';
    let title = 'Lire le prochain RDV dans MadeForMed';
    if (cached?.status === 'ok' || (cached?.status === 'error' && Array.isArray(cached.items))) {
        const next = mfmNativeNextAppointment(cached.items, info.excludeRdv);
        if (next) {
            const date = new Date(next.startAt);
            const displayedYear = mfmNativeParisParts(next.startAt)?.year;
            const currentYear = mfmNativeParisParts(Date.now())?.year;
            const formatted = new Intl.DateTimeFormat('fr-FR', {timeZone:MFM_NATIVE_TIME_ZONE, day:'2-digit', month:'2-digit', year:displayedYear !== currentYear ? 'numeric' : undefined}).format(date);
            const hour = new Intl.DateTimeFormat('fr-FR', {timeZone:MFM_NATIVE_TIME_ZONE, hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
            label = info.kind === 'agenda' ? `→ ${formatted} ${hour}` : `Prochain RDV : ${formatted} à ${hour}`;
            title = [label, next.practitioner, next.type, 'Cliquer pour ouvrir la fiche et actualiser'].filter(Boolean).join(' · ');
            if (cached.status === 'error') { label += ' · à vérifier'; title += ' · Lecture indisponible : date conservée'; }
        } else {
            label = cached.status === 'error' ? 'Prochain RDV : réessayer' : info.kind === 'agenda' ? '→ aucun RDV' : 'Prochain RDV : aucun prévu';
            title = cached.status === 'error' ? 'Lecture indisponible : cliquer pour actualiser.' : 'Aucun autre RDV futur dans l’historique MadeForMed accessible. Cliquer pour actualiser.';
        }
    } else if (status === 'choose' || info.conflict || !info.href) {
        label = 'Prochain RDV : choisir le patient';
        title = 'Choisir le patient dans MadeForMed pour afficher son prochain RDV';
    } else if (status === 'error') {
        label = info.kind === 'agenda' ? '→ RDV à relire' : 'Prochain RDV : réessayer';
        title = 'Lecture momentanément indisponible. Cliquer pour ouvrir la fiche.';
    }
    mfmNativeSetText(badge, label);
    if (badge.title !== title) badge.title = title;
    const cssStatus = cached?.status === 'error' ? 'error' : status === 'stale' ? 'ok' : status;
    if (badge.dataset.state !== cssStatus) badge.dataset.state = cssStatus;
}

function mfmNativeRemember(state, uid, items, status = 'ok') {
    if (!state.element.isConnected || mfmNativeSource(state.element)?.signature !== state.info.signature) return;
    if (uid) state.resolvedUid = uid;
    const previous = mfmNativeCache.get(mfmNativeKey(state.info, uid));
    const record = { uid, items:status === 'error' && previous?.items ? previous.items : items, status, at: Date.now() };
    mfmNativeCache.set(mfmNativeKey(state.info, uid), record);
    if (!state.info.uid) mfmNativeCache.set(mfmNativeKey(state.info), record);
    while (mfmNativeCache.size > 150) mfmNativeCache.delete(mfmNativeCache.keys().next().value);
    for (const element of mfmNativeElements) {
        const other = mfmNativeStates.get(element);
        if (other && other.info.context === state.info.context && mfmNativeKey(other.info) === mfmNativeKey(state.info)) {
            if (uid) other.resolvedUid = uid;
            mfmNativePaint(other);
        }
    }
    mfmNativePaint(state);
    if (typeof mfmGroupCallsQueue === 'function') mfmGroupCallsQueue();
}

function mfmNativeFrame(title, hidden = false) {
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.className = hidden ? 'tm-mf-native-reader' : 'tm-mf-native-frame';
    frame.setAttribute('referrerpolicy', 'same-origin');
    if (hidden) {
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;';
    }
    return frame;
}

function mfmNativeWait(frame, predicate, context, alive, timeout = 18000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
            try {
                if (!alive() || secretariatContextOf(document) !== context) throw new Error('Opération interrompue : page ou médecin changé.');
                const doc = frame.contentDocument;
                const url = frame.contentWindow?.location;
                if (url && url.origin !== location.origin && url.href !== 'about:blank') throw new Error('Reconnectez-vous à MadeForMed.');
                const frameContext = doc && secretariatContextOf(doc);
                if (frameContext && frameContext !== context) throw new Error('Le médecin sélectionné a changé.');
                if (frameContext === context) {
                    const result = predicate(doc);
                    if (result) { clearInterval(timer); resolve(result); return; }
                }
                if (Date.now() - started > timeout) throw new Error('Le formulaire MadeForMed n’a pas pu être chargé.');
            } catch (error) { clearInterval(timer); reject(error); }
        }, 200);
    });
}

// Mémoire locale des messages déjà identifiés. Elle sert uniquement à leur
// présentation regroupée ; Document/RDV gardent leur identification native.
const MFM_GROUP_MEMORY_KEY = 'TM_MFM_GROUP_IDENTITIES_V1';
const MFM_GROUP_MEMORY_TTL = 7 * 24 * 60 * 60 * 1000;
const MFM_GROUP_MEMORY_LIMIT = 300;
let mfmNativeGroupMemoryEpoch = 0;

function mfmNativeGroupBinding(state) {
    const {element, info} = state;
    if (info.kind !== 'message' || info.conflict || !element.isConnected ||
        mfmNativeStates.get(element) !== state || mfmNativeSource(element)?.signature !== info.signature ||
        !element.querySelector('.content .msg-canal[data-canal="svi"]')) return '';
    return JSON.stringify([location.origin, info.signature,
        element.cells[2]?.querySelector('.date')?.textContent.trim() || '',
        element.cells[2]?.querySelector('.hour')?.textContent.trim() || '', 'svi']);
}

async function mfmNativeGroupDigest(binding) {
    if (!binding || !globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') return '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(binding));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function mfmNativeGroupMemoryRead() {
    try {
        const stored = GM_getValue(MFM_GROUP_MEMORY_KEY, null);
        if (stored?.version !== 1 || stored.origin !== location.origin || !Array.isArray(stored.entries)) return [];
        const now = Date.now(), seen = new Set();
        const entries = stored.entries.filter(record => {
            if (!record || !/^[a-f0-9]{64}$/.test(record.digest || '') || !mfmNativeUid(record.uid) ||
                !Number.isFinite(record.verifiedAt) || record.verifiedAt <= 0 || record.verifiedAt > now + 5000 ||
                now - record.verifiedAt >= MFM_GROUP_MEMORY_TTL) return false;
            return true;
        }).sort((a,b) => b.verifiedAt - a.verifiedAt).filter(record => {
            if (seen.has(record.digest)) return false;
            seen.add(record.digest); return true;
        }).slice(0, MFM_GROUP_MEMORY_LIMIT)
            .map(record => ({digest:record.digest, uid:mfmNativeUid(record.uid), verifiedAt:record.verifiedAt}));
        if (JSON.stringify(stored.entries) !== JSON.stringify(entries)) {
            try { GM_setValue(MFM_GROUP_MEMORY_KEY, {version:1, origin:location.origin, entries}); } catch (_) {}
        }
        return entries;
    } catch (_) { return []; }
}

function mfmNativeClearGroupMemory() {
    mfmNativeGroupMemoryEpoch++;
    // Reset doit également invalider les résultats des lecteurs déjà lancés.
    mfmNativeIdentityReset('group-memory-cleared');
    try { GM_deleteValue(MFM_GROUP_MEMORY_KEY); } catch (_) {}
    for (const element of mfmNativeElements) {
        const state = mfmNativeStates.get(element);
        if (!state) continue;
        delete state.groupIdentity;
        delete state.groupRestoreTask;
        state.groupRestoreBinding = '';
        state.groupRestorePending = false;
        state.groupRestoreAt = 0;
    }
    if (typeof mfmGroupCallsQueue === 'function') mfmGroupCallsQueue();
}

async function mfmNativeGroupMemoryRemember(state, uid, verifiedAt = Date.now()) {
    const binding = mfmNativeGroupBinding(state);
    const epoch = mfmNativeGroupMemoryEpoch;
    if (!binding || !mfmNativeUid(uid) || !Number.isFinite(verifiedAt) || verifiedAt <= 0 ||
        verifiedAt > Date.now() + 5000 || Date.now() - verifiedAt >= MFM_GROUP_MEMORY_TTL) return;
    try {
        const digest = await mfmNativeGroupDigest(binding);
        if (!digest || epoch !== mfmNativeGroupMemoryEpoch || mfmNativeGroupBinding(state) !== binding || secretariatContextOf(document) !== state.info.context) return;
        const liveUid = mfmNativePatientId(state.element);
        if (liveUid && liveUid !== uid) return;
        const records = mfmNativeGroupMemoryRead();
        if (records.some(record => record.digest === digest && record.verifiedAt > verifiedAt)) return;
        const entries = records.filter(record => record.digest !== digest);
        entries.unshift({digest, uid, verifiedAt});
        GM_setValue(MFM_GROUP_MEMORY_KEY, {version:1, origin:location.origin, entries:entries.slice(0,MFM_GROUP_MEMORY_LIMIT)});
        state.groupIdentity = {binding, uid, verifiedAt};
    } catch (_) { /* Une mémoire indisponible ne bloque pas le regroupement natif. */ }
}

function mfmNativeGroupPatientId(row) {
    const state = mfmNativeStates.get(row);
    const record = state?.groupIdentity;
    if (!record || mfmNativeGroupBinding(state) !== record.binding ||
        Date.now() - record.verifiedAt >= MFM_GROUP_MEMORY_TTL || record.verifiedAt > Date.now() + 5000) return '';
    const liveUid = mfmNativePatientId(row);
    return liveUid && liveUid !== record.uid ? '' : record.uid;
}

function mfmNativeGroupMemoryRestore(state) {
    const binding = mfmNativeGroupBinding(state);
    const epoch = mfmNativeGroupMemoryEpoch;
    if (!binding || mfmNativePatientId(state.element) ||
        (state.groupRestoreBinding === binding && (state.groupRestorePending || Date.now() - state.groupRestoreAt < 15000))) return;
    state.groupRestoreBinding = binding;
    state.groupRestorePending = true;
    state.groupRestoreAt = Date.now();
    state.groupRestoreTask = (async () => { try {
        const digest = await mfmNativeGroupDigest(binding);
        if (!digest || epoch !== mfmNativeGroupMemoryEpoch || mfmNativeGroupBinding(state) !== binding || secretariatContextOf(document) !== state.info.context) return;
        const record = mfmNativeGroupMemoryRead().find(record => record.digest === digest);
        if (!record) return;
        const liveUid = mfmNativePatientId(state.element);
        if (liveUid && liveUid !== record.uid) return;
        state.groupIdentity = {binding, uid:record.uid, verifiedAt:record.verifiedAt};
        mfmNativeLog('Regroupement restauré depuis la mémoire locale', {phase:'group-memory-restored', cachedMessages:1});
        if (typeof mfmGroupCallsQueue === 'function') mfmGroupCallsQueue();
    } catch (_) {} finally {
        if (state.groupRestoreBinding === binding) state.groupRestorePending = false;
        if (mfmNativeInstalled && secretariatContextOf(document) === state.info.context) {
            if (typeof mfmGroupCallsQueue === 'function') mfmGroupCallsQueue();
            mfmNativeIdentityScan();
        }
    } })();
    return state.groupRestoreTask;
}

// Deux recherches d'identité indépendantes de la lecture des RDV.
// Le nom/téléphone sert à choisir la recherche, jamais à fusionner les appels.
const MFM_IDENTITY_CONCURRENCY = 2;
const mfmNativeIdentityJobs = new Map();
const mfmNativeIdentityActive = new Set();
let mfmNativeIdentityEpoch = 0;
let mfmNativeIdentitySequence = 0;
let mfmNativeIdentityPumping = false;

function mfmNativeIdentityKey(info) {
    const link = mfmNativeSafeLink(info?.href);
    if (info?.kind !== 'message' || info.conflict || !info.phone || !mfmNativeName(info.name) ||
        link?.searchParams.get('target') !== 'user-search' ||
        mfmNativePhone(link.searchParams.get('value')) !== info.phone) return '';
    return JSON.stringify([info.context, link.href, mfmNativeName(info.name), info.phone]);
}

function mfmNativeIdentityValid(state, job) {
    return Boolean(state?.element.isConnected && mfmNativeStates.get(state.element) === state && state.info.context === job.context &&
        secretariatContextOf(document) === job.context &&
        mfmNativeIdentityKey(state.info) === job.key &&
        mfmNativeSource(state.element)?.signature === state.info.signature);
}

function mfmNativeIdentityLog(job, phase, data = {}) {
    mfmNativeLog('Chronométrage identification des appels', {
        job:job.sequence, epoch:job.epoch, phase,
        elapsedMs:Date.now() - job.queuedAt,
        queueWaitMs:job.startedAt ? job.startedAt - job.queuedAt : Date.now() - job.queuedAt,
        searchMs:job.startedAt ? (job.finishedAt || Date.now()) - job.startedAt : 0,
        activeReaders:mfmNativeIdentityActive.size, ...data
    });
}

function mfmNativeIdentityFinish(job, phase, uid = '') {
    if (job.done) return;
    job.done = true;
    job.phase = phase;
    job.uid = uid;
    job.finishedAt = Date.now();
    job.frame?.remove();
    job.frame = null;
    job.quickController?.abort();
    mfmNativeIdentityActive.delete(job);
    mfmNativeIdentityLog(job, phase);
    job.resolve(uid);
    job.members.clear();
    // Identités confirmées et échecs de lecture sont mémorisés brièvement. Une interruption doit pouvoir
    // repartir immédiatement quand l'onglet redevient visible ou que la ligne revient.
    if (!['complete', 'ambiguous-or-no-match', 'search-timeout-or-error'].includes(phase) &&
        mfmNativeIdentityJobs.get(job.key) === job) mfmNativeIdentityJobs.delete(job.key);
    mfmNativeIdentityPump();
}

function mfmNativeIdentityReset(reason = 'cancelled') {
    mfmNativeIdentityEpoch++;
    const jobs = [...mfmNativeIdentityJobs.values()];
    mfmNativeIdentityJobs.clear();
    for (const job of jobs) mfmNativeIdentityFinish(job, reason);
}

async function mfmNativeIdentityRun(job) {
    job.phase = 'running';
    job.startedAt = Date.now();
    mfmNativeIdentityActive.add(job);
    mfmNativeIdentityLog(job, 'start');
    const alive = () => !job.done && job.epoch === mfmNativeIdentityEpoch &&
        !document.hidden && [...job.members].some(state => mfmNativeIdentityValid(state, job) && !mfmNativePatientId(state.element));
    try {
        const frame = mfmNativeFrame('Identification des appels successifs', true);
        job.frame = frame;
        document.body.append(frame);
        frame.src = job.info.href;
        const nativeRead = mfmNativeSearchResult(frame, job.info, alive, () => mfmNativeIdentityLog(job, 'results-ready'))
            .then(result => ({...result, via:'iframe'}));
        // Lire le HTML du lien natif permet d'éviter le démarrage de l'agenda
        // quand le serveur renvoie déjà la recherche complète. L'iframe démarre
        // en parallèle et reste le recours si ce HTML est incomplet.
        const quickRead = mfmNativeIdentityQuickRead(job, alive)
            .then(result => result || new Promise(() => {}));
        const result = await Promise.race([nativeRead, quickRead]);
        if (!alive()) { mfmNativeIdentityFinish(job, 'cancelled'); return; }
        if (!result.uid) { mfmNativeIdentityFinish(job, 'ambiguous-or-no-match'); return; }
        let published = 0;
        for (const state of job.members) {
            if (!mfmNativeIdentityValid(state, job)) continue;
            const currentUid = mfmNativePatientId(state.element);
            if (currentUid && currentUid !== result.uid) continue;
            mfmNativeRememberIdentity(state, result.uid, true, true);
            if (mfmNativePatientId(state.element) === result.uid) published++;
        }
        mfmNativeIdentityLog(job, 'identity-published', {publishedRows:published, via:result.via});
        mfmNativeIdentityFinish(job, published ? 'complete' : 'source-changed', published ? result.uid : '');
    } catch (_) {
        mfmNativeIdentityFinish(job, alive() ? 'search-timeout-or-error' : 'cancelled');
    }
}

function mfmNativeIdentityPump() {
    if (!mfmNativeInstalled || document.hidden || mfmNativeIdentityPumping) return;
    mfmNativeIdentityPumping = true;
    try { for (const job of [...mfmNativeIdentityJobs.values()]) {
        if (mfmNativeIdentityActive.size >= MFM_IDENTITY_CONCURRENCY) break;
        if (job.done || job.phase !== 'queued') continue;
        if (![...job.members].some(state => mfmNativeIdentityValid(state, job) && !mfmNativePatientId(state.element))) {
            mfmNativeIdentityFinish(job, 'source-changed');
            continue;
        }
        // Run catches its failures; no background promise can reject without a consumer.
        void mfmNativeIdentityRun(job);
    } } finally { mfmNativeIdentityPumping = false; }
}

function mfmNativeIdentityQueue(states) {
    const key = mfmNativeIdentityKey(states[0]?.info);
    if (!key) return;
    let job = mfmNativeIdentityJobs.get(key);
    if (job?.done && Date.now() - job.finishedAt >= MFM_NATIVE_TTL) {
        mfmNativeIdentityJobs.delete(key); job = null;
    }
    if (!job) {
        let resolve;
        job = {key, info:states[0].info, context:states[0].info.context,
            epoch:mfmNativeIdentityEpoch, sequence:++mfmNativeIdentitySequence,
            members:new Set(), phase:'queued', queuedAt:Date.now(), startedAt:0, done:false,
            promise:new Promise(done => { resolve = done; }), resolve:null, frame:null};
        job.resolve = resolve;
        mfmNativeIdentityJobs.set(key, job);
        mfmNativeIdentityLog(job, 'queued');
        if (mfmNativeIdentityJobs.size > 150) {
            for (const [oldKey, oldJob] of mfmNativeIdentityJobs) {
                if (mfmNativeIdentityJobs.size <= 150) break;
                if (oldJob.done) mfmNativeIdentityJobs.delete(oldKey);
            }
        }
    }
    if (job.done) {
        // Réutiliser une identité déjà confirmée pendant le même cache de 60 s,
        // notamment quand MadeForMed remplace les lignes avant la fin de la lecture RDV.
        if (job.uid) {
            let published = 0;
            for (const state of states) {
                if (!mfmNativeIdentityValid(state, job)) continue;
                const currentUid = mfmNativePatientId(state.element);
                if (currentUid && currentUid !== job.uid) continue;
                mfmNativeRememberIdentity(state, job.uid, true, true, job.finishedAt);
                published++;
            }
            if (published) mfmNativeIdentityLog(job, 'identity-cache-published', {publishedRows:published});
        }
        return;
    }
    for (const state of states) job.members.add(state);
}

function mfmNativeCallReceivedAt(element) {
    const date = element.cells[2]?.querySelector('.date')?.textContent.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const hour = element.cells[2]?.querySelector('.hour')?.textContent.trim();
    return date ? mfmNativeDate(`${date[3]}-${date[2]}-${date[1]} ${hour}`) : NaN;
}

function mfmNativeIdentityScan() {
    if (!mfmNativeInstalled || document.hidden || !mfmGroupCallsEnabled()) return;
    for (const [key, job] of mfmNativeIdentityJobs) {
        if (job.done && Date.now() - job.finishedAt >= MFM_NATIVE_TTL) mfmNativeIdentityJobs.delete(key);
    }
    const eligible = state => {
        const row = state?.element;
        const rect = row?.getBoundingClientRect();
        return Boolean(row && state.info.kind === 'message' && !state.info.conflict &&
            !state.groupRestorePending &&
            rect.width > 0 && rect.height > 0 && mfmNativeIdentityKey(state.info) &&
            mfmNativeSource(row)?.signature === state.info.signature &&
            row.querySelector('.content .msg-canal[data-canal="svi"]'));
    };
    for (const element of mfmNativeElements) {
        const state = mfmNativeStates.get(element);
        if (!eligible(state)) continue;
        let next = element.nextElementSibling;
        while (next?.classList.contains('tm-mf-call-group-head')) next = next.nextElementSibling;
        const other = mfmNativeStates.get(next);
        if (!eligible(other) || mfmNativeIdentityKey(other.info) !== mfmNativeIdentityKey(state.info) ||
            (!mfmNativeVisible(element) && !mfmNativeVisible(next)) ||
            Math.abs(mfmNativeCallReceivedAt(next) - mfmNativeCallReceivedAt(element)) > 30 * 60 * 1000 ||
            !Number.isFinite(mfmNativeCallReceivedAt(next)) || !Number.isFinite(mfmNativeCallReceivedAt(element)) ||
            ((mfmNativePatientId(element) || mfmNativeGroupPatientId(element)) &&
                (mfmNativePatientId(next) || mfmNativeGroupPatientId(next)))) continue;
        mfmNativeIdentityQueue([state, other]);
    }
    // Abonnés renouvelés lors des remplacements AJAX de lignes.
    for (const job of mfmNativeIdentityJobs.values()) {
        if (job.done) continue;
        for (const element of mfmNativeElements) {
            const state = mfmNativeStates.get(element);
            if (state && mfmNativeIdentityValid(state, job)) job.members.add(state);
        }
    }
    mfmNativeIdentityPump();
}

function mfmNativeIdentityRunning(state) {
    const job = mfmNativeIdentityJobs.get(mfmNativeIdentityKey(state.info));
    if (!job || job.done || job.phase !== 'running' || !mfmNativeIdentityValid(state, job)) return null;
    job.members.add(state);
    return job;
}

function mfmNativeSearchSnapshot(doc) {
    const active = [...doc.querySelectorAll('.user-search.active #users-result')];
    if (active.length !== 1) return null;
    const results = active[0];
    if (results.matches('.loading,[aria-busy="true"]') || results.querySelector('.loading,[aria-busy="true"]')) return null;
    const candidates = [...results.querySelectorAll('.user.preview[data-user-id]')];
    if (!candidates.length && !results.querySelector('.no-result,.alert')) return null;
    return results.textContent + JSON.stringify(candidates.map(patient => [
        patient.getAttribute('data-user-id'), patient.getAttribute('data-user-name'),
        patient.querySelector('.user-name .nom')?.textContent,
        patient.querySelector('.user-name .prenom')?.textContent,
        [...patient.querySelectorAll('.identite-contacts [title], .identite-contacts [data-original-title], a[data-tel], a[href^="tel:"]')]
            .map(x => mfmNativePhone(x.getAttribute('data-tel') || x.getAttribute('title') || x.getAttribute('data-original-title') || x.getAttribute('href')?.slice(4)))
    ]));
}

async function mfmNativeIdentityQuickRead(job, alive) {
    if (typeof fetch !== 'function') return null;
    const link = mfmNativeSafeLink(job.info.href);
    if (!link || link.searchParams.get('target') !== 'user-search') return null;
    const controller = new AbortController();
    job.quickController = controller;
    const timer = setTimeout(() => controller.abort(), 3000);
    const read = async () => {
        if (!alive()) return null;
        const response = await fetch(link.href, {method:'GET', credentials:'same-origin', cache:'no-store', redirect:'error',
            headers:{Accept:'text/html'}, signal:controller.signal});
        const url = mfmNativeSafeLink(response.url);
        if (!response.ok || response.redirected || !url || url.href !== link.href ||
            !/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) return null;
        const text = await response.text();
        if (!alive() || text.length > 5000000) return null;
        const doc = new DOMParser().parseFromString(text, 'text/html');
        if (doc.querySelector('#loginForm,input[type="password"]') || secretariatContextOf(doc) !== job.context) return null;
        const snapshot = mfmNativeSearchSnapshot(doc);
        const uid = snapshot !== null ? mfmNativeMatchCandidate(doc, job.info) : '';
        return uid ? {snapshot,uid} : null;
    };
    try {
        const first = await read();
        if (!first) { mfmNativeIdentityLog(job, 'native-html-unavailable'); return null; }
        mfmNativeIdentityLog(job, 'native-html-ready');
        await new Promise(resolve => setTimeout(resolve, 800));
        if (controller.signal.aborted || !alive()) return null;
        const second = await read();
        if (!second || first.uid !== second.uid || first.snapshot !== second.snapshot) return null;
        return {uid:second.uid, via:'native-html'};
    } catch (_) { return null; }
    finally { clearTimeout(timer); if (job.quickController === controller) job.quickController = null; }
}

function mfmNativeSearchResult(frame, info, alive, onReady = null) {
        let signature = '', stableSince = 0;
        let readyReported = false;
        return mfmNativeWait(frame, doc => {
            const snapshot = mfmNativeSearchSnapshot(doc);
            if (snapshot === null) return null;
            if (!readyReported) { readyReported = true; onReady?.(); }
            if (snapshot !== signature || !stableSince) { signature = snapshot; stableSince = Date.now(); return null; }
            if (Date.now() - stableSince < 800) return null;
            return { uid: mfmNativeMatchCandidate(doc, info) };
        }, info.context, alive);
}

async function mfmNativeLoadProfile(frame, state, alive, uid = mfmNativePatientId(state.element)) {
    const { info } = state;
    const groupMemoryEpoch = mfmNativeGroupMemoryEpoch;
    let matchedFromSearch = false;
    if (info.conflict || (!uid && !info.href)) return '';
    if (!uid && state.groupRestorePending) {
        await state.groupRestoreTask;
        if (!alive() || mfmNativeSource(state.element)?.signature !== info.signature) throw new Error('Opération interrompue : page ou médecin changé.');
        uid = mfmNativePatientId(state.element);
    }
    // Réutiliser une recherche déjà en cours, sans faire attendre un clic derrière la file.
    // Un UID explicite (notamment la relecture Documents) conserve la vérification forcée.
    if (!uid) {
        const identityJob = mfmNativeIdentityRunning(state);
        if (identityJob) {
            await identityJob.promise;
            if (!alive() || secretariatContextOf(document) !== info.context ||
                mfmNativeSource(state.element)?.signature !== info.signature) throw new Error('Opération interrompue : page ou médecin changé.');
            uid = mfmNativePatientId(state.element);
        }
    }
    frame.src = uid ? mfmNativeProfileUrl(uid) : info.href;
    if (!uid) {
        const match = await mfmNativeSearchResult(frame, info, alive);
        uid = match.uid;
        if (!uid) return '';
        matchedFromSearch = true;
        // L'identité unique est déjà établie par le résultat MadeForMed stable.
        // Le regroupement n'a pas à attendre le chargement de l'historique.
        if (alive()) mfmNativeRememberIdentity(state, uid, true, groupMemoryEpoch === mfmNativeGroupMemoryEpoch);
        frame.src = mfmNativeProfileUrl(uid);
    }
    await mfmNativeWait(frame, doc => {
        const profile = doc.querySelector('.user-detail.active[data-user-id]');
        return profile?.getAttribute('data-user-id') === uid ? profile : null;
    }, info.context, alive);
    if (alive()) mfmNativeRememberIdentity(state, uid, matchedFromSearch);
    return uid;
}

async function mfmNativeLoadHistory(frame, uid, context, alive) {
    let signature = '', stableSince = 0;
    let requested = false;
    return mfmNativeWait(frame, doc => {
        const profile = doc.querySelector('.user-detail.active[data-user-id]');
        if (profile?.getAttribute('data-user-id') !== uid) return null;
        const tab = profile.querySelector('a.sc-btn[href="#user-history"]');
        if (!requested && tab && !profile.querySelector('#user-history.active')) { requested = true; tab.click(); return null; }
        const items = mfmNativeReadAppointments(doc, uid);
        if (items === null) return null;
        const next = JSON.stringify(items);
        if (next !== signature || !stableSince) { signature = next; stableSince = Date.now(); return null; }
        return Date.now() - stableSince >= 1000 ? { items } : null;
    }, context, alive);
}

function mfmNativeEnqueue(state, force = false) {
    if (state.pending || !mfmNativeVisible(state.element)) return;
    const cached = mfmNativeCache.get(mfmNativeKey(state.info, mfmNativePatientId(state.element))) || mfmNativeCache.get(mfmNativeKey(state.info));
    if (cached && !force && Date.now() - cached.at < MFM_NATIVE_TTL) {
        if (cached.uid) state.resolvedUid = cached.uid;
        mfmNativePaint(state);
        return;
    }
    if (state.info.conflict || !state.info.href) { mfmNativePaint(state); return; }
    state.pending = true;
    mfmNativeQueue.push(state);
    mfmNativePaint(state);
    // Recenser toutes les lignes avant de choisir la première lecture.
    if (!mfmNativeQueueScheduled) {
        mfmNativeQueueScheduled = true;
        Promise.resolve().then(() => { mfmNativeQueueScheduled = false; if (mfmNativeQueue.length) mfmNativeRunQueue(); });
    }
}

function mfmNativePriorityCallIndex() {
    const receivedAt = element => {
        const date = element.cells[2]?.querySelector('.date')?.textContent.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        const hour = element.cells[2]?.querySelector('.hour')?.textContent.trim();
        return date ? mfmNativeDate(`${date[3]}-${date[2]}-${date[1]} ${hour}`) : NaN;
    };
    return mfmNativeQueue.findIndex(state => {
        const {element, info} = state;
        if (info.kind !== 'message' || info.conflict || mfmNativePatientId(element) ||
            !info.phone || !mfmNativeName(info.name) || !mfmNativeVisible(element) ||
            mfmNativeSource(element)?.signature !== info.signature ||
            !element.querySelector('.content .msg-canal[data-canal="svi"]')) return false;
        let next = element.nextElementSibling;
        while (next?.classList.contains('tm-mf-call-group-head')) next = next.nextElementSibling;
        const other = mfmNativeStates.get(next);
        if (!other || !mfmNativeQueue.includes(other) || other.info.conflict ||
            other.info.context !== info.context || other.info.href !== info.href ||
            other.info.phone !== info.phone || mfmNativeName(other.info.name) !== mfmNativeName(info.name) ||
            mfmNativePatientId(next) || !mfmNativeVisible(next) ||
            mfmNativeSource(next)?.signature !== other.info.signature ||
            !next.querySelector('.content .msg-canal[data-canal="svi"]')) return false;
        return Math.abs(receivedAt(next) - receivedAt(element)) <= 30 * 60 * 1000;
    });
}


async function mfmNativeRunQueue() {
    if (mfmNativeBusy || document.hidden || mfmNativeOverlay || mfmNativeDocumentPreparing()) return;
    mfmNativeBusy = true;
    try {
        // Une seule paire prioritaire par passage ; le reste conserve l'ordre FIFO.
        const priority = mfmNativePriorityCallIndex();
        if (priority > 0) mfmNativeQueue.unshift(mfmNativeQueue.splice(priority, 1)[0]);
        while (mfmNativeQueue.length && !document.hidden && !mfmNativeOverlay && !mfmNativeDocumentPreparing()) {
            const state = mfmNativeQueue.shift();
            const generation = mfmNativeGeneration;
            const alive = () => generation === mfmNativeGeneration && !mfmNativeOverlay && !mfmNativeDocumentPreparing() && mfmNativeVisible(state.element) && mfmNativeSource(state.element)?.signature === state.info.signature;
            try {
                if (!alive() || !mfmNativeVisible(state.element)) continue;
                const cached = mfmNativeCache.get(mfmNativeKey(state.info, mfmNativePatientId(state.element))) || mfmNativeCache.get(mfmNativeKey(state.info));
                if (cached && Date.now() - cached.at < MFM_NATIVE_TTL) {
                    if (cached.uid) state.resolvedUid = cached.uid;
                    continue;
                }
                const frame = mfmNativeFrame('Lecture du prochain RDV', true);
                mfmNativeWorker = frame;
                document.body.append(frame);
                const uid = await mfmNativeLoadProfile(frame, state, alive);
                if (!uid) { mfmNativeRemember(state, '', null, 'choose'); continue; }
                const result = await mfmNativeLoadHistory(frame, uid, state.info.context, alive);
                if (alive()) mfmNativeRemember(state, uid, result.items);
            } catch (_) {
                if (alive()) mfmNativeRemember(state, mfmNativePatientId(state.element), null, 'error');
            } finally {
                mfmNativeWorker?.remove();
                mfmNativeWorker = null;
                state.pending = false;
                mfmNativePaint(state);
            }
        }
    } finally { mfmNativeBusy = false; }
}

function mfmNativeCloseOverlay() {
    const overlay = mfmNativeOverlay;
    if (!overlay) return;
    overlay.closed = true;
    clearInterval(overlay.contextTimer);
    clearInterval(overlay.formTimer);
    mfmNativeOverlay = null;
    const op = overlay.documentOperation;
    if (op && !op.closed) {
        // Fermer la vérification cache la fenêtre, mais ne libère jamais l'envoi incertain.
        overlay.root.hidden = true;
        overlay.root.classList.add('tm-mf-native-preparing');
        overlay.root.querySelector('.tm-mf-native-header')?.remove();
        mfmNativeActionStatus(op.state, 'Ajout à vérifier.', () => mfmNativeDocumentVerify(op));
    } else {
        overlay.frame?.remove();
        overlay.root.remove();
        if (!op) {
            mfmNativeCache.clear();
            if (!overlay.root.hidden && overlay.state?.badge.isConnected) overlay.state.badge.focus({preventScroll:true});
            mfmNativeScheduleScan();
        }
    }
}

function mfmNativeChoosePatient(overlay) {
    const { state, frame, status, choices } = overlay;
    const { info } = state;
    mfmNativeSetText(status, 'Choisissez le patient concerné pour continuer.');
    return mfmNativeWait(frame, doc => {
        const results = doc.querySelector('.user-search.active #users-result');
        if (!results) return null;
        const candidates = [...results.querySelectorAll('.user.preview[data-user-id]')];
        if (!candidates.length) return null;
        return { candidates };
    }, info.context, () => !overlay.closed).then(({ candidates }) => new Promise(resolve => {
        overlay.root.classList.add('tm-mf-native-document-chooser');
        overlay.root.classList.remove('tm-mf-native-preparing');
        overlay.root.hidden = false;
        choices.hidden = false;
        for (const patient of candidates) {
            const uid = mfmNativeUid(patient.getAttribute('data-user-id'));
            if (!uid) continue;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tm-mf-native-choice';
            const name = patient.getAttribute('data-user-name') || patient.querySelector('.user-name')?.textContent.replace(/\s+/g, ' ').trim() || 'Patient';
            const details = mfmNativePlainText(patient.querySelector('.identite-infos'));
            button.textContent = [name, details].filter(Boolean).join(' · ');
            button.addEventListener('click', () => {
                if (overlay.closed || secretariatContextOf(document) !== info.context) return;
                state.resolvedUid = uid;
                choices.replaceChildren();
                choices.hidden = true;
                overlay.root.hidden = true;
                overlay.root.classList.add('tm-mf-native-preparing');
                overlay.root.classList.remove('tm-mf-native-document-chooser');
                resolve(uid);
            }, {once:true});
            choices.append(button);
        }
    }));
}

async function mfmNativeOpen(state, action) {
    if (action === 'document') { mfmNativeDocumentPick(state); return; }
    const fresh = mfmNativeSource(state.element);
    if (!fresh || fresh.signature !== state.info.signature) { mfmNativeScheduleScan(); return; }
    if (mfmNativeOverlay || mfmNativeDocumentOperation) return;
    if (!fresh.href || fresh.conflict) {
        state.badge.title = 'Ouvrez la fiche patient native pour identifier ce message.';
        mfmNativeSetText(state.badge, 'Prochain RDV : choisir le patient');
        return;
    }
    const root = document.createElement('div');
    root.className = 'tm-mf-native-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const box = document.createElement('div');
    box.className = 'tm-mf-native-dialog';
    const header = document.createElement('div');
    header.className = 'tm-mf-native-header';
    const title = document.createElement('strong');
    title.id = 'tm-mf-native-dialog-title';
    root.setAttribute('aria-labelledby', title.id);
    title.textContent = `${action === 'document' ? 'Envoyer un document' : action === 'rdv' ? 'Ajouter un RDV' : 'Prochain RDV'}${fresh.name ? ` · ${fresh.name}` : ''}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tm-mf-native-close';
    close.textContent = 'Fermer ×';
    close.addEventListener('click', mfmNativeCloseOverlay);
    header.append(title, close);
    const status = document.createElement('div');
    status.className = 'tm-mf-native-status';
    status.textContent = 'Chargement du formulaire MadeForMed…';
    const choices = document.createElement('div');
    choices.className = 'tm-mf-native-choices';
    choices.hidden = true;
    const hiddenLoad = action === 'rdv';
    const frame = mfmNativeFrame(title.textContent, hiddenLoad);
    box.append(header, status, choices);
    box.append(frame);
    if (hiddenLoad) root.classList.add('tm-mf-native-preparing');
    root.hidden = hiddenLoad;
    root.append(box);
    const overlay = { root, frame, state, status, choices, closed:false, contextTimer:null };
    mfmNativeOverlay = overlay;
    mfmNativeGeneration++;
    mfmNativeWorker?.remove();
    document.body.append(root);
    if (hiddenLoad) { mfmNativeActionStatus(state, 'Préparation du rendez-vous…'); }
    else close.focus();
    overlay.contextTimer = setInterval(() => {
        if (secretariatContextOf(document) !== fresh.context) mfmNativeCloseOverlay();
    }, 300);
    const alive = () => !overlay.closed && state.element.isConnected && mfmNativeSource(state.element)?.signature === fresh.signature;
    try {
        let uid = await mfmNativeLoadProfile(frame, state, alive);
        if (!uid) {
            uid = await mfmNativeChoosePatient(overlay);
            if (!alive()) return;
            uid = await mfmNativeLoadProfile(frame, state, alive, uid);
        }
        if (!uid || !alive()) return;
        state.resolvedUid = uid;
        if (typeof mfmGroupCallsQueue === 'function') mfmGroupCallsQueue();
        const doc = frame.contentDocument;
        const profile = doc.querySelector('.user-detail.active[data-user-id]');
        if (profile?.getAttribute('data-user-id') !== uid || secretariatContextOf(doc) !== fresh.context) throw new Error('Patient ou médecin modifié.');
        const selectedName = mfmNativePlainText(profile.querySelector('.user-name')) || fresh.name;
        title.textContent = `${action === 'document' ? 'Envoyer un document' : action === 'rdv' ? 'Ajouter un RDV' : 'Prochain RDV'}${selectedName ? ` · ${selectedName}` : ''}`;
        if (action === 'rdv') {
            const button = await mfmNativeWait(frame, current => {
                const active = current.querySelector('.user-detail.active[data-user-id]');
                return active?.getAttribute('data-user-id') === uid ? active.querySelector(`a.new-rdv[data-user-id="${uid}"]`) : null;
            }, fresh.context, alive);
            button.click();
            const dateInput = await mfmNativeWait(frame, current => {
                const panel = current.querySelector('.new-rdv.panel.active');
                const input = panel?.querySelector('#newRdvUsers input.patient-input');
                return input?.value === uid && panel.querySelector('form[action="/rdvs"] input[name="data[Rdv][date]"]');
            }, fresh.context, alive);
            mfmNativeIsolatePanel(frame.contentDocument, 'rdv');
            frame.style.cssText = ''; frame.className = 'tm-mf-native-frame'; frame.removeAttribute('aria-hidden'); frame.removeAttribute('tabindex');
            root.classList.remove('tm-mf-native-preparing'); root.classList.add('tm-mf-native-rdv-only'); root.hidden = false;
            mfmNativeActionStatus(state, ''); close.focus();
            mfmNativeSetText(status, 'Le patient est sélectionné. Choisissez le créneau puis enregistrez le RDV dans MadeForMed.');
            if (!dateInput.disabled) { dateInput.focus(); dateInput.click(); }
            overlay.formTimer = setInterval(() => {
                if (!frame.contentDocument?.querySelector('.new-rdv.panel.active')) mfmNativeCloseOverlay();
            }, 500);
        } else {
            const result = await mfmNativeLoadHistory(frame, uid, fresh.context, alive);
            mfmNativeRemember(state, uid, result.items);
            mfmNativeSetText(status, 'Historique MadeForMed actualisé.');
        }
    } catch (error) {
        if (!overlay.closed && hiddenLoad) { mfmNativeCloseOverlay(); mfmNativeActionStatus(state, `${error.message} Réessayer le bouton Ajouter un RDV.`); }
        else if (!overlay.closed) mfmNativeSetText(status, `${error.message} Vous pouvez utiliser la fiche affichée ou fermer puis réessayer.`);
    }
}

function mfmNativePaletteReference(row) {
    const candidates = [...row.querySelectorAll('.action .ds-btn')].filter(node =>
        !node.closest('.tm-mf-native-actions') && !node.classList.contains('delete') &&
        !node.classList.contains('tm-mf-native-action'));
    return candidates.find(node => node.matches('a.search') && !node.matches(':hover')) ||
        candidates.find(node => !node.matches(':hover')) || null;
}

function mfmNativeSyncPalette(state) {
    if (!state?.actions || !state.element.isConnected) return;
    const reference = mfmNativePaletteReference(state.element);
    const palette = reference ? getComputedStyle(reference) : null;
    for (const [name, value] of [
        ['--tm-mf-native-bg', palette?.backgroundColor || ''],
        ['--tm-mf-native-color', palette?.color || '']
    ]) {
        if (state.actions.style.getPropertyValue(name) === value) continue;
        if (value) state.actions.style.setProperty(name, value);
        else state.actions.style.removeProperty(name);
    }
}

function mfmNativeQueuePalette(event) {
    if (!mfmNativeInstalled) return;
    const row = event.target?.closest?.('#messages tr.user-message');
    if (!row) return;
    mfmNativePaletteRows.add(row);
    if (mfmNativePaletteFrame !== null) return;
    mfmNativePaletteFrame = requestAnimationFrame(() => {
        mfmNativePaletteFrame = null;
        for (const element of mfmNativePaletteRows) mfmNativeSyncPalette(mfmNativeStates.get(element));
        mfmNativePaletteRows.clear();
    });
}

function mfmNativePaletteStyleLoaded(event) {
    if (event.target?.matches?.('link[rel~="stylesheet"]')) mfmNativeScheduleScan();
}

function mfmNativeAdd(element) {
    const info = mfmNativeSource(element);
    if (!info) return;
    let state = mfmNativeStates.get(element);
    if (state && state.info.signature === info.signature && state.badge.isConnected) return;
    if (state) { state.badge.remove(); state.actions?.remove(); }
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = `tm-mf-native-next${info.kind === 'agenda' ? ' tm-mf-native-next-agenda' : ''}`;
    const host = info.kind === 'message' ? element.querySelector('.expediteur') : element.querySelector('.rdv-icons');
    if (!host) return;
    state = { element, info, badge, actions:null, resolvedUid:'', pending:false };
    const cached = mfmNativeCache.get(mfmNativeKey(info));
    if (cached && Date.now() - cached.at < MFM_NATIVE_TTL) state.resolvedUid = cached.uid || '';
    mfmNativeStates.set(element, state);
    mfmNativeElements.add(element);
    badge.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); mfmNativeOpen(state, 'history'); });
    for (const eventName of ['mousedown', 'dblclick', 'touchstart']) badge.addEventListener(eventName, event => event.stopPropagation());
    if (info.kind === 'message') {
        host.insertBefore(badge, host.querySelector('.tm-mf-consignes'));
        const actionHost = element.querySelector('.action > .flex') || element.querySelector('.action');
        if (actionHost) {
            actionHost.classList.add('tm-mf-native-action-bar');
            const actions = document.createElement('span');
            actions.className = 'tm-mf-native-actions';
            for (const [action, label] of [['document', 'Envoyer un document'], ['rdv', 'Ajouter un RDV']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ds-btn ds-icon md tm-mf-native-action';
                button.dataset.action = action;
                button.style.setProperty('background-color', 'var(--tm-mf-action-bg)', 'important');
                button.style.setProperty('color', 'var(--tm-mf-action-color)', 'important');
                button.setAttribute('aria-label', label);
                const accessibleLabel = document.createElement('span');
                accessibleLabel.className = 'tm-mf-native-sr-label';
                accessibleLabel.style.setProperty('display', 'none', 'important');
                accessibleLabel.textContent = label;
                if (action === 'rdv') {
                    const icon = document.createElement('i');
                    icon.className = 'icoformed-calendar-new-line';
                    icon.style.setProperty('color', 'inherit', 'important');
                    icon.setAttribute('aria-hidden', 'true');
                    button.append(icon);
                } else {
                    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    icon.setAttribute('viewBox', '0 0 24 24');
                    icon.setAttribute('width', '16'); icon.setAttribute('height', '16');
                    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor');
                    icon.setAttribute('stroke-width', '1.7'); icon.setAttribute('stroke-linecap', 'round');
                    icon.setAttribute('stroke-linejoin', 'round'); icon.setAttribute('aria-hidden', 'true');
                    icon.setAttribute('focusable', 'false');
                    icon.style.setProperty('color', 'inherit', 'important');
                    for (const shape of ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 14h8m-3-3 3 3-3 3']) {
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        path.setAttribute('d', shape); icon.append(path);
                    }
                    button.append(icon);
                }
                button.append(accessibleLabel);
                button.disabled = !info.href || info.conflict;
                button.dataset.tooltip = button.disabled ? 'Ce message n’a pas de fiche patient identifiable.' : label;
                button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); mfmNativeOpen(state, action); });
                actions.append(button);
            }
            actionHost.append(actions);
            state.actions = actions;
            mfmNativeSyncPalette(state);
        }
    } else {
        host.append(badge);
    }
    const pending = mfmNativeDocumentPendingFor(state);
    if (pending) mfmNativeActionStatus(state, 'Ajout précédent à vérifier.', () => mfmNativeDocumentVerify(pending));
    mfmNativePaint(state);
    if (info.uid) void mfmNativeGroupMemoryRemember(state, info.uid);
    else mfmNativeGroupMemoryRestore(state);
    mfmNativeEnqueue(state);
}

function mfmNativeScan() {
    if (!isMadeformed() || !document.body) return;
    const context = secretariatContextOf(document);
    if (context !== mfmNativeContext) {
        mfmNativeContext = context;
        mfmNativeIdentityReset('context-changed');
        mfmNativeDismissDocumentNotice();
        mfmNativeGeneration++;
        mfmNativeCache.clear();
        for (const state of mfmNativeQueue.splice(0)) state.pending = false;
        mfmNativeWorker?.remove();
        if (mfmNativeOverlay) mfmNativeCloseOverlay();
        if (mfmNativeDocumentOperation && !mfmNativeDocumentOperation.dispatched) mfmNativeDocumentCancel(mfmNativeDocumentOperation);
    }
    for (const element of mfmNativeElements) {
        if (!element.isConnected || !mfmNativeSource(element)) {
            const state = mfmNativeStates.get(element);
            state?.badge.remove(); state?.actions?.remove();
            mfmNativeElements.delete(element);
        }
    }
    for (const op of mfmNativeDocumentOperations) {
        const alive = op.verifying && op.verificationAlive ? op.verificationAlive() : mfmNativeDocumentAlive(op);
        if (!alive && (!op.dispatched || (op.watch?.active() || 0) === 0)) mfmNativeDocumentDispose(op);
    }
    document.querySelectorAll('#messages tr.user-message[data-id], #agenda .rdv[data-user-id]').forEach(mfmNativeAdd);
    for (const element of mfmNativeElements) {
        const state = mfmNativeStates.get(element);
        if (state) { mfmNativeSyncPalette(state); mfmNativePaint(state); mfmNativeGroupMemoryRestore(state); mfmNativeEnqueue(state); }
    }
    mfmNativeIdentityScan();
    mfmNativeRunQueue();
}

function mfmNativeScheduleScan() {
    if (!mfmNativeInstalled || mfmNativeScanTimer) return;
    mfmNativeScanTimer = setTimeout(() => { mfmNativeScanTimer = null; mfmNativeScan(); }, 200);
}

function mfmNativeOverlayKeys(event) {
    if ((!mfmNativeOverlay || mfmNativeOverlay.root.hidden) && !mfmNativeDocumentOperation?.chooser) return;
    // Le clavier d'un formulaire dans l'iframe reste géré par MadeForMed.
    // Les touches reçues par la page parente ne doivent pas envoyer un ancien
    // message situé derrière le nouveau panneau.
    if (event.key === 'PageDown' || event.code === 'PageDown' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        event.stopImmediatePropagation();
    } else if (event.key === 'Escape' && event.target?.closest?.('.tm-mf-native-overlay')) {
        event.preventDefault();
        if (mfmNativeDocumentOperation?.chooser) mfmNativeDocumentOperation.chooser.querySelector('button.tm-mf-native-close')?.click();
        else mfmNativeCloseOverlay();
    }
}

function setupMadeformedNativeTools() {
    if (!isMadeformed() || mfmNativeInstalled || !document.body) return;
    mfmNativeInstalled = true;
    const style = document.createElement('style');
    style.id = 'tm-mf-native-style';
    style.textContent = `
        .tm-mf-native-next { display:block; margin:5px 0; padding:3px 7px; border:1px solid #dbe7f3; border-radius:6px; background:#f5f9fd; color:#385775; font:11px/1.4 system-ui,sans-serif; cursor:pointer; text-align:left; }
        .tm-mf-native-next[data-state="choose"], .tm-mf-native-next[data-state="error"] { color:#8a6424; background:#fff9ec; border-color:#f2dfb8; }
        #agenda .tm-mf-native-next-agenda { display:inline-block; margin:0 3px; padding:0 2px; border:0; background:rgba(255,255,255,.8); color:#24496a; font:9px/1.25 system-ui,sans-serif; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:middle; }
        #messages .tm-mf-native-action-bar { display:flex; flex-direction:row !important; flex-wrap:wrap; align-items:center !important; justify-content:flex-start; gap:4px; min-width:212px; }
        #messages .tm-mf-native-action-bar > .ds-btn { flex:0 0 32px; margin:0; }
        .tm-mf-native-actions { display:contents; }
        #messages .tm-mf-native-action { --tm-mf-action-bg:var(--tm-mf-native-bg,var(--bg-btn,transparent)); --tm-mf-action-color:var(--tm-mf-native-color,var(--color-btn,currentColor)); position:relative; display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; min-width:32px; min-height:32px; padding:0; flex:0 0 32px; border-radius:32px; cursor:pointer; white-space:nowrap; }
        #messages .tm-mf-native-action[data-action="document"]:hover { --tm-mf-action-bg:#3b82f6; --tm-mf-action-color:#fff; }
        #messages .tm-mf-native-action[data-action="rdv"]:hover { --tm-mf-action-bg:#2e9e58; --tm-mf-action-color:#fff; }
        .tm-mf-native-action svg { width:16px; height:16px; flex-shrink:0; pointer-events:none; }
        .tm-mf-native-action:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
        .tm-mf-native-action[data-tooltip]::after { content:attr(data-tooltip); position:absolute; z-index:1100; bottom:calc(100% + 8px); right:0; left:auto; width:max-content; max-width:min(220px,calc(100vw - 24px)); box-sizing:border-box; transform:none; padding:5px 8px; border-radius:4px; color:#fff; background:#111; font:12px/1.35 system-ui,sans-serif; text-align:center; white-space:normal; overflow-wrap:anywhere; pointer-events:none; opacity:0; visibility:hidden; transition:opacity .12s ease; }
        .tm-mf-native-action[data-tooltip]::before { content:""; position:absolute; z-index:1100; bottom:calc(100% - 2px); right:11px; left:auto; transform:none; border:5px solid transparent; border-top-color:#111; pointer-events:none; opacity:0; visibility:hidden; transition:opacity .12s ease; }
        .tm-mf-native-action[data-tooltip]:is(:hover,:focus-visible)::after,.tm-mf-native-action[data-tooltip]:is(:hover,:focus-visible)::before { opacity:1; visibility:visible; }
        .tm-mf-native-sr-label { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
        .tm-mf-native-choice { border:1px solid #cbddeb; border-radius:6px; background:white; color:#285379; padding:5px 8px; font:11px/1.3 system-ui,sans-serif; cursor:pointer; white-space:nowrap; }
        .tm-mf-native-choice:hover { background:#edf5fc; border-color:#8eb6d7; }
        .tm-mf-native-action:disabled { opacity:.4; cursor:default; }
        .tm-mf-native-action-status { flex-basis:100%; min-width:0; box-sizing:border-box; white-space:normal; max-width:212px; color:#587086; font:11px/1.4 system-ui,sans-serif; }
        .tm-mf-native-action-status:empty { display:none; }
        .tm-mf-native-action-status[data-state="success"] { display:block; padding:6px 8px; border:1px solid #b4dfc6; border-radius:6px; color:#17643a; background:#edf9f1; font-weight:600; }
        .tm-mf-native-document-success { position:fixed; top:20px; right:20px; z-index:2147483646; display:flex; align-items:center; gap:16px; max-width:min(420px,calc(100vw - 40px)); box-sizing:border-box; padding:14px 16px; border:1px solid #9ed6b7; border-radius:10px; color:#17643a; background:#edf9f1; box-shadow:0 6px 24px #173b2526; font:600 14px/1.5 system-ui,sans-serif; }
        .tm-mf-native-document-success button { border:0; background:transparent; color:#17643a; cursor:pointer; padding:3px 6px; font:22px/1 system-ui,sans-serif; }
        .tm-mf-native-overlay { position:fixed; inset:0; z-index:2147483647; background:rgba(19,35,49,.35); display:flex; align-items:center; justify-content:center; padding:18px; }
        .tm-mf-native-dialog { width:min(1400px,96vw); height:94vh; display:flex; flex-direction:column; background:white; border-radius:12px; box-shadow:0 20px 80px #182b4560; overflow:hidden; }
        .tm-mf-native-header { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:12px 16px; color:#1e3b55; font:14px system-ui,sans-serif; border-bottom:1px solid #e2ebf3; }
        .tm-mf-native-close { border:1px solid #d4e1eb; border-radius:6px; background:#fff; padding:6px 10px; color:#31516c; cursor:pointer; font:12px system-ui,sans-serif; }
        .tm-mf-native-status { padding:7px 16px; color:#587086; background:#f3f7fb; font:12px/1.4 system-ui,sans-serif; }
        .tm-mf-native-choices { display:flex; gap:8px; flex-wrap:wrap; padding:12px 16px; border-bottom:1px solid #e2ebf3; }
        .tm-mf-native-choices[hidden] { display:none; }
        .tm-mf-native-frame { width:100%; flex:1; min-height:0; border:0; background:white; }
        .tm-mf-native-overlay[hidden] { display:none; }
        .tm-mf-native-overlay.tm-mf-native-preparing[hidden] { display:flex; left:-10000px; right:auto; width:1280px; opacity:0; pointer-events:none; }
        .tm-mf-native-rdv-only .tm-mf-native-dialog { width:min(850px,96vw); }
        .tm-mf-native-document-chooser .tm-mf-native-dialog { width:min(650px,94vw); height:auto; max-height:85vh; }
        .tm-mf-native-document-chooser .tm-mf-native-choices { overflow:auto; }
        @media (max-width:640px) { #messages .tm-mf-native-action-bar { min-width:0; max-width:212px; } }
    `;
    document.head.append(style);
    mfmNativeObserver = new MutationObserver(records => {
        if (records.some(record => {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            return !target?.closest('.tm-mf-native-next,.tm-mf-native-actions,.tm-mf-native-overlay,.tm-mf-native-document-success,#tm-mf-native-style');
        })) mfmNativeScheduleScan();
    });
    mfmNativeObserver.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['data-user_id','data-user-id','data-id','data-name','data-phone','href','title','class','style']});
    mfmNativePaletteObserver = new MutationObserver(mfmNativeScheduleScan);
    mfmNativePaletteObserver.observe(document.head, {childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['href','media','disabled']});
    mfmNativePaletteObserver.observe(document.documentElement, {attributes:true,attributeFilter:['class','style']});
    document.addEventListener('pointerover', mfmNativeQueuePalette, true);
    document.addEventListener('pointerout', mfmNativeQueuePalette, true);
    document.addEventListener('transitionend', mfmNativeQueuePalette, true);
    document.addEventListener('load', mfmNativePaletteStyleLoaded, true);
    window.addEventListener('scroll', mfmNativeScheduleScan, true);
    window.addEventListener('keydown', mfmNativeOverlayKeys, true);
    window.addEventListener('focus', mfmNativeScheduleScan);
    document.addEventListener('visibilitychange', mfmNativeScheduleScan);
    mfmNativeTimer = setInterval(mfmNativeScheduleScan, MFM_NATIVE_TTL);
    mfmNativeScan();
}

function mfmNativeStop() {
    mfmNativeInstalled = false;
    mfmNativeIdentityReset('stopped');
    mfmNativeGeneration++;
    mfmNativeObserver?.disconnect();
    mfmNativePaletteObserver?.disconnect();
    if (mfmNativePaletteFrame !== null) cancelAnimationFrame(mfmNativePaletteFrame);
    mfmNativePaletteFrame = null;
    mfmNativePaletteRows.clear();
    clearInterval(mfmNativeTimer);
    clearTimeout(mfmNativeScanTimer);
    mfmNativeScanTimer = null;
    mfmNativeWorker?.remove();
    mfmNativeDismissDocumentNotice();
    mfmNativeCloseOverlay();
    for (const op of mfmNativeDocumentOperations) mfmNativeDocumentDispose(op);
    mfmNativeQueue.length = 0;
    window.removeEventListener('scroll', mfmNativeScheduleScan, true);
    window.removeEventListener('keydown', mfmNativeOverlayKeys, true);
    window.removeEventListener('focus', mfmNativeScheduleScan);
    document.removeEventListener('visibilitychange', mfmNativeScheduleScan);
    document.removeEventListener('pointerover', mfmNativeQueuePalette, true);
    document.removeEventListener('pointerout', mfmNativeQueuePalette, true);
    document.removeEventListener('transitionend', mfmNativeQueuePalette, true);
    document.removeEventListener('load', mfmNativePaletteStyleLoaded, true);
}
/* END MFM_NATIVE_TOOLS_V214 */

/* BEGIN MFM_CALL_GROUPING */
/* ========================================================================== */
/* REGROUPEMENT VISUEL DES APPELS — les messages natifs restent distincts       */
/* Dépendances : isMadeformed, secretariatContextOf, mfmNativePatientId.        */
/* ========================================================================== */

const MFM_GROUP_CALL_WINDOW_MS = 30 * 60 * 1000;
const MFM_GROUP_CALL_ENABLED_KEY = 'tm_mf_group_successive_calls_enabled_v1';
const MFM_GROUP_CALL_HEAD_CLASS = 'tm-mf-call-group-head';
const MFM_GROUP_CALL_HIDDEN_CLASS = 'tm-mf-call-group-hidden';
const MFM_GROUP_CALL_MEMBER_CLASS = 'tm-mf-call-group-member';
const mfmCallGroups = new Map();
let mfmCallGroupObserver = null;
let mfmCallGroupQueued = false;
let mfmCallGroupQueueToken = 0;
let mfmCallGroupInstalled = false;
let mfmCallGroupMenuRegistered = false;
const mfmCallGroupDiagnostics = {
    created: 0, changed: 0, removed: 0, nodesReplaced: 0,
    forcedOpen: 0, protectionReasons: {}, scans: 0, queued: 0, coalesced: 0
};

function mfmGroupCallsDiagnostics() {
    // Compteurs et codes de raison uniquement : aucune identité, date,
    // transcription, URL, référence de message ou de patient dans les logs.
    return JSON.parse(JSON.stringify(mfmCallGroupDiagnostics));
}

function mfmGroupCallsLog(message, data) {
    if (typeof addLog !== 'function') return;
    try { addLog('INFO', `Regroupement visuel des appels — ${message}`, data); } catch (_) {}
}

function mfmGroupCallsEnabled() {
    return GM_getValue(MFM_GROUP_CALL_ENABLED_KEY, true) !== false;
}

function mfmGroupCallInfo(row) {
    if (!row?.matches('tr.user-message[data-id]')) return null;
    const id = row.getAttribute('data-id') || '';
    if (!/^\d+$/.test(id)) return null;
    // « Message » (data-mod) désigne le module : seul le canal SVI prouve
    // qu'il s'agit d'un appel. Un message Web/SMS interrompt le regroupement.
    if (!row.querySelector('.content .msg-canal[data-canal="svi"]')) return null;
    let patientId = '';
    try { patientId = String(mfmNativePatientId(row) ||
        (typeof mfmNativeGroupPatientId === 'function' ? mfmNativeGroupPatientId(row) : '') || ''); } catch (_) { return null; }
    // Aucun rapprochement par nom ou téléphone. Les appels sans UID résolu
    // restent indépendants jusqu'à la résolution par MadeForMed lui-même.
    // La mémoire ne restaure que ces mêmes messages précédemment vérifiés.
    if (!/^[1-9]\d*$/.test(patientId)) return null;
    const dateText = (row.cells[2]?.querySelector('.date')?.textContent || '').trim();
    const hourText = (row.cells[2]?.querySelector('.hour')?.textContent || '').trim();
    const date = dateText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const hour = hourText.match(/^(\d{2}):(\d{2})$/);
    if (!date || !hour) return null;
    const [day, month, year, hours, minutes] = [Number(date[1]), Number(date[2]), Number(date[3]), Number(hour[1]), Number(hour[2])];
    if (hours > 23 || minutes > 59 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Date.UTC sert uniquement à comparer les dates/horaires affichés, sans
    // conversion de fuseau ni reconstruction d'une date locale ambiguë.
    const receivedAt = Date.UTC(year, month - 1, day, hours, minutes);
    const checked = new Date(receivedAt);
    if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return null;
    return { row, id, patientId, receivedAt, dateText, hourText };
}

function mfmGroupBuildCalls(table, context) {
    const groups = [];
    if (!table || !context) return groups;
    // Respecter chaque section et chaque ligne native intermédiaire : le
    // filtre, la pagination ou un autre patient séparent les séquences.
    for (const section of [...table.children].filter(node => /^(TBODY|THEAD|TFOOT)$/.test(node.tagName))) {
        let sequence = [];
        const flush = () => {
            if (sequence.length > 1) {
                groups.push({
                    key: `${context}|${sequence[0].patientId}|${sequence.map(call => call.id).join(',')}`,
                    binding: JSON.stringify([context, sequence[0].patientId]),
                    calls: sequence
                });
            }
            sequence = [];
        };
        for (const row of section.children) {
            if (row.classList.contains(MFM_GROUP_CALL_HEAD_CLASS)) continue;
            const call = mfmGroupCallInfo(row);
            if (!call || row.hidden || row.style.display === 'none' || row.classList.contains('hidden') ||
                row.getAttribute('aria-hidden') === 'true') { flush(); continue; }
            const previous = sequence[sequence.length - 1];
            const direction = sequence.length > 1
                ? Math.sign(previous.receivedAt - sequence[sequence.length - 2].receivedAt) : 0;
            const nextDirection = previous ? Math.sign(call.receivedAt - previous.receivedAt) : 0;
            const continues = previous && call.patientId === previous.patientId &&
                Math.abs(call.receivedAt - sequence[0].receivedAt) <= MFM_GROUP_CALL_WINDOW_MS &&
                (!direction || !nextDirection || direction === nextDirection);
            if (previous && !continues) flush();
            sequence.push(call);
        }
        flush();
    }
    return groups;
}

function mfmGroupRowProtectionReason(row) {
    const active = document.activeElement;
    if (active && row.contains(active)) return 'focus';
    const targetId = location.hash.match(/^#tm-mf-message=(\d+)$/)?.[1];
    if (targetId && row.getAttribute('data-id') === targetId) return 'linked-message';
    if (row.getAttribute('aria-selected') === 'true' ||
        ['selected', 'checked', 'tm-mf-consignes-highlight'].some(name => row.classList.contains(name))) return 'selected-row';
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) {
        if (row.contains(selection.anchorNode) || row.contains(selection.focusNode)) return 'text-selection';
        // Une sélection peut traverser une ligne intermédiaire sans que ses
        // extrémités soient dans cette ligne. Elle doit également rester visible.
        for (let index = 0; index < (selection.rangeCount || 0); index++) {
            try { if (selection.getRangeAt(index).intersectsNode(row)) return 'text-selection'; } catch (_) {}
        }
    }
    // Garder les consignes, brouillons et erreurs en vue. Ne jamais recréer
    // leur DOM : les écouteurs natifs, le curseur et les actions restent intacts.
    if (row.querySelector('.tm-mf-consignes-saved-card')) return 'saved-task';
    if ([...row.querySelectorAll('.tm-mf-consignes-editor')].some(editor => !editor.hidden)) return 'open-editor';
    for (const input of row.querySelectorAll('textarea,input')) {
        if (input.tagName === 'TEXTAREA') {
            if (String(input.value || '').trim()) return 'draft';
            continue;
        }
        const type = input.type.toLowerCase();
        // Les cases natives ont une valeur « on » même lorsqu'elles ne sont
        // pas cochées : seule une sélection réelle doit maintenir le groupe.
        if (type === 'checkbox' || type === 'radio') {
            if (input.checked) return 'selected-input';
            continue;
        }
        if (type === 'file') {
            if (input.files?.length) return 'selected-file';
            continue;
        }
        if (['hidden', 'button', 'submit', 'reset', 'image', 'range', 'color'].includes(type)) continue;
        if (String(input.value || '').trim()) return 'draft';
    }
    if ([...row.querySelectorAll('[contenteditable]')].some(editor =>
        editor.getAttribute('contenteditable') !== 'false' && editor.textContent.trim())) return 'draft';
    if (row.querySelector('[aria-invalid="true"]') ||
        [...row.querySelectorAll('[data-error="true"], .error, .alert-danger')].some(error => error.textContent.trim())) return 'error';
    return '';
}

function mfmGroupRowProtected(row) {
    return Boolean(mfmGroupRowProtectionReason(row));
}

function mfmGroupProtectHiddenRows(rows) {
    const reasons = {};
    let protectedRows = 0;
    // La première ligne reste toujours visible. Son focus ou sa consigne
    // n'impose donc jamais de révéler les autres appels du groupe.
    for (const row of rows.slice(1)) {
        const reason = mfmGroupRowProtectionReason(row);
        if (reason) { protectedRows++; reasons[reason] = (reasons[reason] || 0) + 1; }
    }
    return { protectedRows, reasons };
}

function mfmGroupRecordDiagnostic(record, state, nodesReplaced = false) {
    const signature = JSON.stringify(state);
    const previous = record.diagnosticState;
    if (record.diagnosticSignature === signature && !nodesReplaced) return;
    const created = !previous;
    mfmCallGroupDiagnostics[created ? 'created' : 'changed']++;
    if (nodesReplaced) mfmCallGroupDiagnostics.nodesReplaced++;
    if (state.forcedOpen && !previous?.forcedOpen) {
        mfmCallGroupDiagnostics.forcedOpen++;
        for (const [reason, count] of Object.entries(state.protectionReasons)) {
            mfmCallGroupDiagnostics.protectionReasons[reason] = (mfmCallGroupDiagnostics.protectionReasons[reason] || 0) + count;
        }
    }
    record.diagnosticSignature = signature;
    record.diagnosticState = state;
    mfmGroupCallsLog(created ? 'groupe créé' : 'état du groupe modifié', {
        ...state, nodesReplaced, counters: mfmGroupCallsDiagnostics()
    });
}

function mfmGroupCallRange(calls) {
    const ordered = [...calls].sort((a, b) => a.receivedAt - b.receivedAt);
    const first = ordered[0], last = ordered[ordered.length - 1];
    return first.dateText === last.dateText
        ? `${first.hourText}–${last.hourText}`
        : `${first.dateText} ${first.hourText} – ${last.dateText} ${last.hourText}`;
}

function mfmGroupRelease(record) {
    record.header.remove();
    for (const row of record.rows) {
        row.classList.remove(MFM_GROUP_CALL_HIDDEN_CLASS, MFM_GROUP_CALL_MEMBER_CLASS);
    }
}

function mfmGroupCallsScan() {
    if (!isMadeformed()) return;
    // Un scan direct (clic, lien ciblé) rend inutile la microtâche en attente.
    if (mfmCallGroupQueued) {
        mfmCallGroupQueued = false;
        mfmCallGroupQueueToken++;
    }
    mfmCallGroupDiagnostics.scans++;
    mfmGroupCallsRefreshButton();
    const table = document.getElementById('messages');
    const context = secretariatContextOf(document);
    const groups = mfmGroupCallsEnabled() ? mfmGroupBuildCalls(table, context) : [];
    const previousOpened = [...mfmCallGroups.values()].filter(record => record.opened)
        .map(record => ({binding:record.binding, ids:new Set(record.ids || [])}));
    const keys = new Set(groups.map(group => group.key));
    let removed = 0;
    for (const [key, record] of mfmCallGroups) {
        if (!keys.has(key)) { mfmGroupRelease(record); mfmCallGroups.delete(key); removed++; }
    }
    if (removed) {
        mfmCallGroupDiagnostics.removed += removed;
        mfmGroupCallsLog('groupes retirés', { count: removed, counters: mfmGroupCallsDiagnostics() });
    }
    for (const group of groups) {
        const rows = group.calls.map(call => call.row);
        const ids = group.calls.map(call => call.id);
        let record = mfmCallGroups.get(group.key);
        let nodesReplaced = false;
        // Une réponse AJAX peut remplacer les lignes en gardant les mêmes
        // IDs. L'en-tête doit alors être recréé pour les nouveaux nœuds.
        if (record && (record.rows.length !== rows.length || record.rows.some((row, index) => row !== rows[index]))) {
            const { opened, diagnosticState, diagnosticSignature } = record;
            mfmGroupRelease(record);
            mfmCallGroups.delete(group.key);
            record = { opened, diagnosticState, diagnosticSignature };
            nodesReplaced = true;
        }
        if (!record?.header) {
            const header = document.createElement('tr');
            header.className = MFM_GROUP_CALL_HEAD_CLASS;
            const cell = document.createElement('td');
            const caption = document.createElement('strong');
            caption.title = 'Regroupement visuel : chaque appel conserve son message et ses actions.';
            const toggle = document.createElement('button');
            toggle.type = 'button';
            cell.append(caption, toggle);
            header.append(cell);
            record = {
                header, cell, caption, toggle, rows,
                opened: Boolean(record?.opened || previousOpened.some(previous => previous.binding === group.binding && ids.some(id => previous.ids.has(id)))),
                diagnosticState: record?.diagnosticState, diagnosticSignature: record?.diagnosticSignature
            };
            toggle.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                record.opened = !record.opened;
                mfmGroupCallsScan();
            });
            mfmCallGroups.set(group.key, record);
        }
        record.binding = group.binding;
        record.ids = ids;
        const first = rows[0];
        if (record.header.parentNode !== first.parentNode || record.header.nextElementSibling !== first) {
            first.before(record.header);
        }
        const colspan = [...first.cells].reduce((sum, cell) => sum + (cell.colSpan || 1), 0) || 1;
        if (record.cell.colSpan !== colspan) record.cell.colSpan = colspan;
        const label = `${rows.length} appels successifs · ${mfmGroupCallRange(group.calls)}`;
        if (record.caption.textContent !== label) record.caption.textContent = label;
        const protection = mfmGroupProtectHiddenRows(rows);
        const protectedRow = protection.protectedRows > 0;
        const expanded = record.opened || protectedRow;
        const buttonText = expanded ? 'Replier' : `Afficher les ${rows.length} appels`;
        if (record.toggle.textContent !== buttonText) record.toggle.textContent = buttonText;
        if (record.toggle.getAttribute('aria-expanded') !== String(expanded)) record.toggle.setAttribute('aria-expanded', String(expanded));
        // Une ligne protégée garde le groupe ouvert et explique pourquoi le
        // repli n'est pas disponible ; aucun clic n'est silencieusement ignoré.
        if (record.toggle.disabled !== protectedRow) record.toggle.disabled = protectedRow;
        const title = protectedRow ? 'Un autre appel contient une consigne, une saisie, une sélection ou le message ciblé ; il reste visible.' : '';
        if (record.toggle.title !== title) record.toggle.title = title;
        rows.forEach((row, index) => {
            if (!row.classList.contains(MFM_GROUP_CALL_MEMBER_CLASS)) row.classList.add(MFM_GROUP_CALL_MEMBER_CLASS);
            const hidden = !expanded && index > 0;
            if (row.classList.contains(MFM_GROUP_CALL_HIDDEN_CLASS) !== hidden) row.classList.toggle(MFM_GROUP_CALL_HIDDEN_CLASS, hidden);
        });
        mfmGroupRecordDiagnostic(record, {
            callCount: rows.length, hiddenCalls: expanded ? 0 : rows.length - 1,
            manuallyOpened: record.opened, forcedOpen: !record.opened && protectedRow,
            protectedRows: protection.protectedRows, protectionReasons: protection.reasons
        }, nodesReplaced);
    }
}

function mfmGroupCallsQueue() {
    if (mfmCallGroupQueued) { mfmCallGroupDiagnostics.coalesced++; return; }
    mfmCallGroupQueued = true;
    mfmCallGroupDiagnostics.queued++;
    const token = ++mfmCallGroupQueueToken;
    const run = () => {
        if (!mfmCallGroupQueued || token !== mfmCallGroupQueueToken) return;
        mfmCallGroupQueued = false;
        mfmGroupCallsScan();
    };
    // Les UID validés par le module natif peuvent arriver sans mutation DOM.
    // Les publier dans ce tour d'événements, sans attendre une image suivante
    // ni la lecture des RDV. Les demandes simultanées restent regroupées.
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
}

function mfmGroupCallsRefreshButton() {
    const panel = document.getElementById('tm-mf-weda-body');
    if (!panel) return;
    let button = document.getElementById('tm-mf-weda-group-calls');
    if (!button) {
        button = document.createElement('button');
        button.id = 'tm-mf-weda-group-calls';
        button.type = 'button';
        button.addEventListener('click', mfmGroupCallsToggle);
        const shortcuts = panel.querySelector('#tm-mf-weda-shortcuts');
        panel.insertBefore(button, shortcuts || null);
    }
    const enabled = mfmGroupCallsEnabled();
    const text = `Regrouper les appels ${enabled ? 'ON' : 'OFF'}`;
    if (button.textContent !== text) button.textContent = text;
    if (button.getAttribute('aria-pressed') !== String(enabled)) button.setAttribute('aria-pressed', String(enabled));
}

function mfmGroupCallsToggle() {
    GM_setValue(MFM_GROUP_CALL_ENABLED_KEY, !mfmGroupCallsEnabled());
    mfmGroupCallsScan();
}

function mfmGroupMutationRelevant(record) {
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    if (!target) return false;
    if (target.closest(`.${MFM_GROUP_CALL_HEAD_CLASS}, #tm-mf-weda-group-calls, .tm-mf-native-next, .tm-mf-native-actions`)) return false;
    const inMessages = Boolean(target.closest('#messages'));
    const inContext = Boolean(target.closest('#envNav'));
    if (record.type === 'characterData') {
        // La transcription ou le texte du badge ne change pas une séquence.
        return inMessages && Boolean(target.closest('.date,.hour,.expediteur .name,[data-error="true"],.error,.alert-danger,[contenteditable]'));
    }
    if (record.type === 'attributes') {
        if (inContext) return ['class', 'title', 'pro-id'].includes(record.attributeName);
        if (!inMessages) return false;
        if (record.attributeName === 'href') return target.matches('a.search');
        if (record.attributeName === 'class') {
            // Nos classes de repli sont ignorées : les changements de classe
            // natifs restent observés sans déclencher une boucle d'observateur.
            const nativeClasses = value => String(value || '').split(/\s+/)
                .filter(name => name && ![MFM_GROUP_CALL_HEAD_CLASS, MFM_GROUP_CALL_HIDDEN_CLASS, MFM_GROUP_CALL_MEMBER_CLASS].includes(name))
                .sort().join(' ');
            return nativeClasses(record.oldValue) !== nativeClasses(target.getAttribute('class'));
        }
        return true;
    }
    if (record.type !== 'childList') return false;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (nodes.length && nodes.every(node => node.nodeType === 1 &&
        (node.classList.contains(MFM_GROUP_CALL_HEAD_CLASS) || node.id === 'tm-mf-weda-group-calls'))) return false;
    if (inMessages || inContext) return true;
    // Un rechargement AJAX peut remplacer la table entière. Les iframes de
    // lecture et les mises à jour du reste de l'interface sont sans rapport.
    return nodes.some(node => node.nodeType === 1 &&
        (node.matches('#messages,#envNav') || node.querySelector('#messages,#envNav')));
}

function mfmGroupCallsSetup() {
    if (!isMadeformed() || !document.body || mfmCallGroupInstalled) return;
    mfmCallGroupInstalled = true;
    if (!document.getElementById('tm-mf-call-group-style')) {
        const style = document.createElement('style');
        style.id = 'tm-mf-call-group-style';
        style.textContent = `
            #messages tr.${MFM_GROUP_CALL_HIDDEN_CLASS} { display: none !important; }
            #messages tr.${MFM_GROUP_CALL_HEAD_CLASS} > td {
                background: #eff6ff; border-top: 1px solid #bfdbfe;
                padding: 7px 10px; color: #1e40af; font-size: 12px;
            }
            #messages tr.${MFM_GROUP_CALL_HEAD_CLASS} button {
                margin-left: 12px; border: 1px solid #bfdbfe; border-radius: 5px;
                background: white; color: #1e40af; padding: 3px 7px; cursor: pointer;
            }
            #messages tr.${MFM_GROUP_CALL_HEAD_CLASS} button:disabled { opacity: .65; cursor: default; }
        `;
        document.head.append(style);
    }
    mfmCallGroupObserver = new MutationObserver(records => {
        if (records.some(mfmGroupMutationRelevant)) mfmGroupCallsQueue();
    });
    mfmCallGroupObserver.observe(document.body, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeOldValue: true,
        attributeFilter: ['class', 'hidden', 'style', 'data-error', 'aria-invalid', 'aria-selected',
            'aria-hidden', 'data-id', 'data-user_id', 'data-user-id', 'data-canal', 'title',
            'data-name', 'data-phone', 'href', 'checked', 'pro-id']
    });
    document.addEventListener('focusin', mfmGroupCallsQueue);
    document.addEventListener('focusout', mfmGroupCallsQueue);
    document.addEventListener('input', mfmGroupCallsQueue);
    document.addEventListener('change', mfmGroupCallsQueue);
    document.addEventListener('selectionchange', mfmGroupCallsQueue);
    // Révéler le message avant le défilement du module de consignes.
    window.addEventListener('hashchange', mfmGroupCallsScan, true);
    window.addEventListener('focus', mfmGroupCallsQueue);
    document.addEventListener('visibilitychange', mfmGroupCallsQueue);
    if (!mfmCallGroupMenuRegistered && typeof GM_registerMenuCommand === 'function') {
        mfmCallGroupMenuRegistered = true;
        GM_registerMenuCommand('MadeForMed : activer/désactiver le regroupement des appels', mfmGroupCallsToggle);
    }
    mfmGroupCallsScan();
}

function mfmGroupCallsStop() {
    mfmCallGroupObserver?.disconnect();
    mfmCallGroupQueueToken++;
    mfmCallGroupQueued = false;
    mfmCallGroupInstalled = false;
    document.removeEventListener('focusin', mfmGroupCallsQueue);
    document.removeEventListener('focusout', mfmGroupCallsQueue);
    document.removeEventListener('input', mfmGroupCallsQueue);
    document.removeEventListener('change', mfmGroupCallsQueue);
    document.removeEventListener('selectionchange', mfmGroupCallsQueue);
    window.removeEventListener('hashchange', mfmGroupCallsScan, true);
    window.removeEventListener('focus', mfmGroupCallsQueue);
    document.removeEventListener('visibilitychange', mfmGroupCallsQueue);
    for (const record of mfmCallGroups.values()) mfmGroupRelease(record);
    mfmCallGroups.clear();
    document.getElementById('tm-mf-weda-group-calls')?.remove();
}
/* END MFM_CALL_GROUPING */


    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('MF → WEDA : copier logs', copyLogs);
        GM_registerMenuCommand('MF → WEDA : reset job/logs', resetAll);

        if (isMadeformed()) {
            GM_registerMenuCommand('MF → WEDA : lancer maintenant', () => {
                launchFromMadeformed('menu_tampermonkey');
            });

            GM_registerMenuCommand('MF → WEDA : anti-filtre Madeformed', removeFiltersAndBlur);
        }

        if (isWeda()) {
            GM_registerMenuCommand('MF → WEDA : reprendre tâche WEDA', () => {
                wedaMain();
            });
        }
    }

    window.addEventListener('error', function (event) {
        addLog('ERROR', 'Erreur JS globale', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    });

    function boot() {
        if (window.top !== window) {
            return;
        }

        setLogs(getLogs());
        GM_setValue(TRANSFER_AUDIT_KEY, getTransferAudit());
        getJob();
        registerMenu();

        if (isMadeformed()) {
            setupMadeformedMessageFaviconWatcher();
            createMadeformedPanel();

            addLog('INFO', 'Script chargé sur Madeformed', {
                version: VERSION,
                url: location.href
            });

            madeformedMain();
            if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(JOB_KEY, refreshMadeformedPanel);
            window.setInterval(() => {
                getJob();
                GM_setValue(TRANSFER_AUDIT_KEY, getTransferAudit());
                refreshMadeformedPanel();
            }, 60000);
        }

        if (isWeda()) {
            addLog('INFO', 'Script chargé sur WEDA', {
                version: VERSION,
                url: location.href
            });

            setTimeout(wedaMain, 500);
            window.addEventListener('load', () => setTimeout(wedaMain, 800));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
