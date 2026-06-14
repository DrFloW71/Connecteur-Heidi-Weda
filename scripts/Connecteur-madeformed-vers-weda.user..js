// ==UserScript==
// @name         Connecteur Madeformed - WEDA
// @namespace    http://tampermonkey.net/
// @version      3.51
// @description  PageDown : copier/envoyer le SMS vers WEDA ; clic nom patient agenda : ouvrir dossier WEDA
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

    const VERSION = '3.51';

    const JOB_KEY = 'TM_MADEFORMED_TO_WEDA_JOB_V31';
    const LOG_KEY = 'TM_MADEFORMED_TO_WEDA_LOG_V31';
    const CLOSE_KEY = 'TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31';

    const WEDA_FIND_PATIENT_URL = 'https://secure.weda.fr/FolderMedical/FindPatientForm.aspx';

    const SEL_MADEFORMED_PATIENT =
        '#contact-modal > div > div > div.contact-section-simple.hidden > div.modal-sub-header.px-rsp.py-sm > div > div > span.contact-to-name.px-sm.py-xs.bg-primary-200.text-primary-950.rounded-xs';

    const SEL_WEDA_SEARCH_INPUT =
        '#ContentPlaceHolder1_FindPatientUcForm1_TextBoxRecherche';

    const SEL_WEDA_SEARCH_MODE_SELECT =
        '#ContentPlaceHolder1_FindPatientUcForm1_DropDownListRechechePatient';

    const WEDA_SEARCH_MODE_PATIENT_NAME = 'Nom';

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

    function isMadeformed() {
        return location.hostname === 'pro.madeformed.com';
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

        return {
            ...job,
            message: maskMessage(job.message)
        };
    }

    function getLogs() {
        return GM_getValue(LOG_KEY, []);
    }

    function setLogs(logs) {
        GM_setValue(LOG_KEY, logs.slice(-MAX_LOG_LINES));
    }

    function addLog(level, message, data) {
        const entry = {
            at: new Date().toISOString(),
            page: isMadeformed() ? 'Madeformed' : isWeda() ? 'WEDA' : location.hostname,
            url: location.href,
            level,
            message,
            data: data || null
        };

        const logs = getLogs();
        logs.push(entry);
        setLogs(logs);

        const prefix = `[TM Madeformed -> WEDA ${VERSION}]`;

        if (level === 'ERROR') {
            console.error(prefix, message, data || '');
        } else if (level === 'WARN') {
            console.warn(prefix, message, data || '');
        } else {
            console.log(prefix, message, data || '');
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
            `Page actuelle : ${location.href}`,
            `Job actuel : ${JSON.stringify(job, null, 2)}`,
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

    function getJob() {
        return GM_getValue(JOB_KEY, null);
    }

    function saveJob(job) {
        GM_setValue(JOB_KEY, job);
        addLog('INFO', 'Job sauvegardé', safeJobForLog(job));
    }

    function updateJob(patch) {
        const job = getJob();

        if (!job) {
            addLog('WARN', 'updateJob appelé sans job');
            return null;
        }

        const next = {
            ...job,
            ...patch,
            updatedAt: Date.now()
        };

        GM_setValue(JOB_KEY, next);
        addLog('INFO', 'Job mis à jour', safeJobForLog(next));

        return next;
    }

    function clearJob() {
        GM_deleteValue(JOB_KEY);
        addLog('INFO', 'Job supprimé');
        refreshMadeformedPanel();
    }

    function resetAll() {
        closeCurrentWedaTabFromMadeformed('reset');
        GM_deleteValue(JOB_KEY);
        GM_deleteValue(LOG_KEY);
        GM_deleteValue(CLOSE_KEY);
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

    function realClick(el) {
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

        el.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: win
        }));

        el.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: win
        }));

        try {
            el.click();
        } catch (_) {}

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

    function createOpenPatientJob(patientNameRaw, dateOfBirth) {
        const patientNameForWeda = formatPatientNameForWeda(patientNameRaw);

        return {
            id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            source: 'madeformed_agenda',
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

        const job = createOpenPatientJob(agendaPatient.patientNameRaw, agendaPatient.dateOfBirth);

        saveJob(job);
        GM_deleteValue(CLOSE_KEY);

        addLog('INFO', 'Ouverture dossier patient WEDA depuis clic agenda Madeformed', {
            jobId: job.id,
            madeformed: agendaPatient.patientNameRaw,
            weda: job.patientName,
            dateOfBirth: job.dateOfBirth || '',
            rdvId: agendaPatient.rdvId || '',
            debut: agendaPatient.debut || '',
            fin: agendaPatient.fin || ''
        });

        GM_openInTab(`${WEDA_FIND_PATIENT_URL}?tmJob=${encodeURIComponent(job.id)}&tmAction=open_patient`, {
            active: true,
            insert: true,
            setParent: true
        });

        return true;
    }

    function isLaunchShortcut(e) {
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

        const job = getJob();

        if (job && currentWedaJobId && job.id === currentWedaJobId && job.status === 'saved_pending_close') {
            if (!currentWedaSavedSeenAt) {
                currentWedaSavedSeenAt = Date.now();
                addLog('INFO', 'Statut saved_pending_close détecté côté Madeformed', {
                    jobId: job.id,
                    savedAt: job.savedAt || null
                });
            }

            const referenceTime = Math.max(Number(job.savedAt || 0), Number(currentWedaSavedSeenAt || 0));

            if (Date.now() - referenceTime >= 1800) {
                closeCurrentWedaTabFromMadeformed('saved_pending_close_polling');
            }

            return;
        }

        if (!job && currentWedaJobId && currentWedaSavedSeenAt) {
            addLog('INFO', 'Job supprimé après sauvegarde : fermeture WEDA côté Madeformed', {
                currentWedaJobId
            });
            closeCurrentWedaTabFromMadeformed('job_deleted_after_saved');
        }
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

    function madeformedMain() {
        setupMadeformedCloseListener();

        document.addEventListener('keydown', async function (e) {
            if (isLaunchShortcut(e)) {
                e.preventDefault();
                e.stopPropagation();

                await launchFromMadeformed(getLaunchShortcutLabel(e));
            }
        }, true);

        document.addEventListener('click', async function (e) {
            await openWedaPatientFromMadeformedAgenda(e);
        }, true);

        addLog('INFO', 'Script actif sur Madeformed', {
            raccourcis: [
                'PageDown'
            ],
            clicAgenda: 'clic sur le nom du patient dans un rendez-vous Madeformed'
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

    function findPatientResultTarget(patientName, dateOfBirth = '') {
        const wanted = normalizeText(patientName);
        const wantedDate = normalizeDateText(dateOfBirth);

        const tokens = wanted
            .split(' ')
            .filter(t => t.length >= 2);

        if (tokens.length === 0) return null;

        const oldGridLinks = [
            ...document.querySelectorAll(SEL_WEDA_PATIENT_OLD_GRID_LINK)
        ];

        let bestOldGridLink = null;
        let bestOldGridScore = 0;

        for (const link of oldGridLinks) {
            const rawText = getPatientCandidateText(link);
            const txt = normalizeText(rawText);

            if (!txt) continue;

            const hasAllTokens = tokens.every(t => txt.includes(t));

            if (!hasAllTokens) continue;

            let score = 1000;

            if (txt === wanted) score += 300;
            if (txt.includes(wanted)) score += 200;
            if (txt.startsWith(wanted)) score += 100;
            if (wantedDate && normalizeDateText(rawText).includes(wantedDate)) score += 500;
            if (isVisible(link)) score += 50;

            if (score > bestOldGridScore) {
                bestOldGridScore = score;
                bestOldGridLink = link;
            }
        }

        if (bestOldGridLink) {
            addLog('INFO', 'Résultat patient WEDA trouvé via lien PatientsGridOld', {
                patientName,
                dateOfBirth: wantedDate || '',
                bestOldGridScore,
                id: bestOldGridLink.id,
                href: bestOldGridLink.getAttribute('href') || '',
                targetText: cleanText(getPatientCandidateText(bestOldGridLink)).slice(0, 160)
            });

            return bestOldGridLink;
        }

        addLog('WARN', 'Lien PatientsGridOld non trouvé, fallback générique');

        const candidates = [
            ...document.querySelectorAll('a, button, input[type="submit"], input[type="button"], tr, td, span, div')
        ];

        let best = null;
        let bestScore = 0;

        for (const el of candidates) {
            const rawText = getPatientCandidateText(el);
            const txt = normalizeText(rawText);

            if (!txt) continue;
            if (txt.length > 800) continue;

            const hasAllTokens = tokens.every(t => txt.includes(t));

            if (!hasAllTokens) continue;

            let score = 10;

            if (txt.includes(wanted)) score += 100;
            if (txt.startsWith(wanted)) score += 50;
            if (wantedDate && normalizeDateText(rawText).includes(wantedDate)) score += 300;
            if (el.matches('a, button, input')) score += 20;
            if (isVisible(el)) score += 10;

            if (score > bestScore) {
                bestScore = score;
                best = getClickableTarget(el);
            }
        }

        if (best) {
            addLog('INFO', 'Résultat patient WEDA trouvé par fallback', {
                patientName,
                dateOfBirth: wantedDate || '',
                bestScore,
                targetText: cleanText(getPatientCandidateText(best)).slice(0, 160)
            });
        }

        return best;
    }

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
        addLog('INFO', 'Étape WEDA : recherche patient', {
            patientName: job.patientName,
            dateOfBirth: job.dateOfBirth || '',
            action: job.action || ''
        });

        const searchModeReady = await ensureWedaSearchModePatientName();

        if (!searchModeReady) {
            return;
        }

        const input = await waitFor(() => document.querySelector(SEL_WEDA_SEARCH_INPUT), 15000);

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
        addLog('INFO', 'Étape WEDA : sélection patient');

        const target = await waitFor(() => findPatientResultTarget(job.patientName, job.dateOfBirth || ''), 15000);

        if (!target) {
            const elapsed = Date.now() - (job.searchSubmittedAt || job.createdAt || Date.now());

            if (elapsed < 25000 && isWedaFindPatientPage()) {
                addLog('WARN', 'Patient non encore cliqué : résultat absent ou non prêt, nouvelle tentative', {
                    patientName: job.patientName,
                    dateOfBirth: job.dateOfBirth || '',
                    elapsed
                });

                scheduleWedaMainRetry('résultat patient non prêt', 1500);
                return;
            }

            addLog('ERROR', 'Aucun résultat patient fiable trouvé', {
                patientName: job.patientName,
                dateOfBirth: job.dateOfBirth || '',
                url: location.href,
                bodySample: cleanText(document.body.textContent || '').slice(0, 1200)
            });

            updateJob({ status: 'error_patient_not_found' });
            return;
        }

        updateJob({
            status: 'patient_clicked',
            patientClickedAt: Date.now()
        });

        realClick(target);

        addLog('INFO', 'Patient WEDA cliqué', {
            action: job.action || '',
            patientName: job.patientName,
            dateOfBirth: job.dateOfBirth || ''
        });
    }

    async function clickNewConsultation(job) {
        addLog('INFO', 'Étape WEDA : création nouvelle consultation');

        const newConsultBtn = await waitFor(() => document.querySelector(SEL_WEDA_NEW_CONSULT), 20000);

        if (!newConsultBtn) {
            addLog('ERROR', 'Bouton nouvelle consultation introuvable', {
                selector: SEL_WEDA_NEW_CONSULT,
                url: location.href,
                bodySample: cleanText(document.body.textContent || '').slice(0, 1200)
            });

            updateJob({ status: 'error_new_consult_not_found' });
            return;
        }

        updateJob({
            status: 'consultation_clicked',
            consultationClickedAt: Date.now()
        });

        realClick(newConsultBtn);

        addLog('INFO', 'Nouvelle consultation cliquée');

        scheduleWedaMainRetry('après clic nouvelle consultation', 1200);
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

    function insertMessageInEditor(ctx, message) {
        const { doc, el } = ctx;

        const html =
            '<p><br></p>' +
            '<p>' +
            textToHtmlWithBreaks(message) +
            '</p>';

        el.focus();

        try {
            const selection = doc.getSelection();
            const range = doc.createRange();

            range.selectNodeContents(el);
            range.collapse(true);

            selection.removeAllRanges();
            selection.addRange(range);

            doc.execCommand('insertHTML', false, html);
            addLog('INFO', 'Message inséré par execCommand');
        } catch (err) {
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

    async function ensureMessageStillPresentBeforeSave(ctx, message) {
        await sleep(250);

        if (editorContainsMessage(ctx, message)) {
            addLog('INFO', 'Vérification avant sauvegarde : message toujours présent dans l’éditeur');
            return true;
        }

        addLog('WARN', 'Vérification avant sauvegarde : message absent, réinsertion de sécurité');

        insertMessageInEditor(ctx, message);

        await sleep(250);

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
            const latestJob = getJob();

            if (!latestJob) {
                addLog('WARN', 'Sauvegarde seule annulée : job absent');
                return;
            }

            if (latestJob.status === 'saved_pending_close') {
                addLog('INFO', 'Sauvegarde seule ignorée : consultation déjà enregistrée');
                return;
            }

            updateJob({
                status: 'consultation_saving',
                savingAt: Date.now()
            });

            const saveBtn = await waitFor(() => document.querySelector(SEL_WEDA_SAVE), 15000);

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

            realClick(saveBtn);

            addLog('INFO', 'Consultation enregistrée');

            await sleep(3000);

            closeWedaTab();
        } finally {
            wedaSaveOnlyRunning = false;
        }
    }

    async function fillConsultationAndSave(job) {
        const latestJob = getJob();

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

        const ctx = await waitFor(() => findWedaEditorContext(), 20000);

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

        job = beforeInsertJob;

        updateJob({
            status: 'consultation_filling',
            fillingAt: Date.now()
        });

        insertMessageInEditor(ctx, job.message);

        const messageStillPresent = await ensureMessageStillPresentBeforeSave(ctx, job.message);

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

    function closeWedaTab() {
        const job = getJob();
        const jobId = job && job.id ? job.id : '';

        addLog('INFO', 'Fermeture automatique de l’onglet WEDA demandée', {
            jobId
        });

        if (jobId) {
            GM_setValue(CLOSE_KEY, {
                jobId,
                reason: 'consultation_saved',
                requestedAt: Date.now(),
                url: location.href
            });

            addLog('INFO', 'Demande de fermeture transmise à Madeformed', {
                jobId
            });
        }

        clearJob();

        setTimeout(() => {
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
            const job = getJob();

            if (!job) {
                return;
            }

            if (Date.now() - job.createdAt > 20 * 60 * 1000) {
                addLog('WARN', 'Job trop ancien supprimé', safeJobForLog(job));
                clearJob();
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
                    updateJob({ status: 'patient_clicked' });
                    setTimeout(wedaMain, 800);
                    return;
                }

                await clickWedaPatient(job);
                return;
            }

            if (job.status === 'patient_clicked') {
                if (isWedaFindPatientPage()) {
                    setTimeout(() => {
                        wedaRunning = false;
                        wedaMain();
                    }, 1000);
                    return;
                }

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
                await sleep(2500);
                closeWedaTab();
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

    function createMadeformedPanel() {
        if (!isMadeformed()) return;
        if (!document.body) return;
        if (document.getElementById('tm-mf-weda-panel')) return;

        const style = document.createElement('style');
        style.textContent = `
            #tm-mf-weda-panel {
                position: fixed;
                right: 12px;
                bottom: 12px;
                z-index: 2147483647;
                width: 280px;
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
            }

            #tm-mf-weda-body {
                padding: 8px;
                background: white;
                color: #111827;
            }

            #tm-mf-weda-status {
                margin-bottom: 6px;
                white-space: pre-wrap;
                line-height: 1.3;
            }

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

            #tm-mf-weda-toggle {
                background: #374151 !important;
                color: white;
                border: none !important;
                margin: 0 !important;
            }
        `;

        const panel = document.createElement('div');
        panel.id = 'tm-mf-weda-panel';

        panel.innerHTML = `
            <div id="tm-mf-weda-head">
                <span>MF → WEDA</span>
                <button id="tm-mf-weda-toggle" type="button">−</button>
            </div>
            <div id="tm-mf-weda-body">
                <div id="tm-mf-weda-status"></div>
                <button id="tm-mf-weda-run" type="button">Lancer</button>
                <button id="tm-mf-weda-copy-logs" type="button">Copier logs</button>
                <button id="tm-mf-weda-reset" type="button">Reset</button>
                <button id="tm-mf-weda-remove-filters" type="button">Anti-filtre</button>
            </div>
        `;

        document.documentElement.appendChild(style);
        document.body.appendChild(panel);

        document.getElementById('tm-mf-weda-toggle').addEventListener('click', () => {
            panel.classList.toggle('tm-collapsed');
            document.getElementById('tm-mf-weda-toggle').textContent =
                panel.classList.contains('tm-collapsed') ? '+' : '−';
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

        status.textContent =
            `Version : ${VERSION}\n` +
            `Job : ${job ? job.status : 'aucun'}\n` +
            `Mode : ${job ? (job.action || '-') : '-'}\n` +
            `Patient : ${job ? job.patientName : '-'}${job && job.dateOfBirth ? ' (' + job.dateOfBirth + ')' : ''}`;
    }

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

        registerMenu();

        if (isMadeformed()) {
            createMadeformedPanel();

            addLog('INFO', 'Script chargé sur Madeformed', {
                version: VERSION,
                url: location.href
            });

            madeformedMain();
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
