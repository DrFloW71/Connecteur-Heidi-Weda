// ==UserScript==
// @name         WEDA -> SOS Oxygène PPC patient
// @namespace    https://secure.weda.fr/
// @version      1.0.9
// @description  Ajoute un raccourci SOS Oxygène sur le dossier WEDA et préremplit une DAP PPC, sans signature ni validation finale.
// @author       Florian Ronez + ChatGPT
// @match        https://secure.weda.fr/FolderMedical/PatientViewForm.aspx*
// @match        https://oxyweb.pro/oxyweb-medecin/auth-callback*
// @match        https://oxyweb.pro/oxyweb-medecin/patients/nouveau/dap-numerique*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.9';
    const LOG_PREFIX = '[WEDA-SOS-OXYGENE-PPC]';

    const SOS_OXYGENE_URL =
        'https://oxyweb.pro/oxyweb-medecin/patients/nouveau/dap-numerique';
    const REQUEST_PARAM = 'wedaSosOxygeneRequest';
    const KEY_PENDING_PATIENT = 'weda_sos_oxygene_ppc_pending_patient_v1';
    const SESSION_REQUEST_KEY = 'weda_sos_oxygene_ppc_request_id_v1';
    const SESSION_WORKFLOW_KEY = 'weda_sos_oxygene_ppc_workflow_v1';
    const WORKFLOW_TTL_MS = 30 * 60 * 1000;
    const OPENER_FALLBACK_MAX_AGE_MS = 90 * 1000;
    const POLL_INTERVAL_MS = 350;
    const MAX_AUTOMATION_DURATION_MS = 30 * 60 * 1000;

    const WEDA_PREFIX = '#ContentPlaceHolder1_EtatCivilUCForm1_';
    const SELECTORS = {
        wedaButton: '#weda-open-sos-oxygene-ppc',
        wedaOrkynButton: '#weda-open-orkyn-ppc',
        wedaAddressTitle: 'span.title-address-comunication',
        wedaAddressPanel: `${WEDA_PREFIX}PanelAdresseCom`,
        wedaLastName: `${WEDA_PREFIX}LabelPatientNom`,
        wedaFirstName: `${WEDA_PREFIX}LabelPatientPrenom`,
        wedaBirthDate: `${WEDA_PREFIX}LabelPatientDateNaissance`,
        wedaTitle: `${WEDA_PREFIX}LabelPatientCivilite`,
        wedaNir: `${WEDA_PREFIX}LabelPatientSecuriteSocial`,
        sosForm: 'extranet-dap-form-patient-information',
        sosLastName: 'ozone-input[formcontrolname="lastName"] input',
        sosFirstName: 'ozone-input[formcontrolname="firstName"] input',
        sosNir: 'ozone-input[formcontrolname="insee"] input',
        sosPhone: 'ozone-input[formcontrolname="phone"] input',
        sosBirthDate: 'ozone-date-picker[formcontrolname="birthDate"] input',
        sosStreet: 'ozone-input[formcontrolname="street"] input',
        sosPostalCode: 'ozone-input[label="Code postal"] input',
        sosCity: 'ozone-select[label="Ville"]',
        sosPressureMin: 'ozone-input[formcontrolname="ppcPressionMin"] input',
        sosPressureMax: 'ozone-input[formcontrolname="ppcPressionMax"] input',
        sosInterface:
            '[data-testid="new-dap-treatment-select-type-interface"]' +
            '[formcontrolname="ppcInterfaceType"]'
    };

    const SYMPTOM_TEST_IDS = [
        'dap-pathology-checkbox-hasDrowsiness',
        'dap-pathology-checkbox-hasSnoring',
        'dap-pathology-checkbox-hasHeadache',
        'dap-pathology-checkbox-hasFatigue'
    ];

    let pollTimer = null;
    let automationBusy = false;

    function log(message, details) {
        if (details === undefined) {
            console.info(LOG_PREFIX, message);
        } else {
            console.info(LOG_PREFIX, message, details);
        }
    }

    function warn(message, details) {
        if (details === undefined) {
            console.warn(LOG_PREFIX, message);
        } else {
            console.warn(LOG_PREFIX, message, details);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeLooseText(value) {
        return normalizeText(value)
            .toLocaleLowerCase('fr-FR')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function normalizeNir(value) {
        return String(value || '').replace(/\D/g, '');
    }

    function normalizePhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (digits.startsWith('0033') && digits.length === 13) {
            return `0${digits.slice(4)}`;
        }
        if (digits.startsWith('33') && digits.length === 11) {
            return `0${digits.slice(2)}`;
        }
        return digits;
    }

    function normalizeBirthDate(value) {
        const match = String(value || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
        if (!match) return '';
        return [match[1], match[2], match[3]]
            .map((part, index) => index < 2 ? part.padStart(2, '0') : part)
            .join('/');
    }

    function getGenderFromCivilite(value) {
        const civilite = normalizeLooseText(value);
        if (/^(m|mr|monsieur)$/.test(civilite)) return 'male';
        if (/^(mme|mlle|madame|mademoiselle)$/.test(civilite)) return 'female';
        return '';
    }

    function parseAddressText(value) {
        const lines = String(value || '')
            .split(/\r?\n/)
            .map(normalizeText)
            .filter(Boolean)
            .filter(line => {
                const normalized = normalizeLooseText(line);
                const compact = normalized.replace(/\s+/g, '');
                return (
                    !/^adressepatient[os]*$/.test(compact) &&
                    !/^[os]+$/.test(compact)
                );
            });

        let postalCode = '';
        let city = '';
        let localityIndex = -1;

        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const match = lines[index].match(/\b(\d{5})\b\s*(.*)$/);
            if (!match) continue;
            postalCode = match[1];
            city = normalizeText(match[2]);
            localityIndex = index;
            break;
        }

        return {
            address: normalizeText(
                lines.filter((_, index) => index !== localityIndex).join(' ')
            ),
            postalCode,
            city
        };
    }

    function isRendered(element) {
        if (!element || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
        );
    }

    function isVisible(element) {
        return (
            isRendered(element) &&
            window.getComputedStyle(element).opacity !== '0'
        );
    }

    function makeRequestId() {
        const randomPart = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
        return `sosoxy_${Date.now()}_${randomPart}`;
    }

    function isValidRequestId(value) {
        return /^sosoxy_\d+_[a-z0-9]{6}$/.test(String(value || ''));
    }

    function canUseOpenerFallback(pending, hasOpener, now = Date.now()) {
        if (!hasOpener || !pending || typeof pending !== 'object') return false;

        const createdAt = Number(pending.createdAt || 0);
        const ageMs = now - createdAt;
        return (
            isValidRequestId(pending.id) &&
            Boolean(pending.patient?.sourcePatientId) &&
            Number.isFinite(createdAt) &&
            ageMs >= 0 &&
            ageMs <= OPENER_FALLBACK_MAX_AGE_MS
        );
    }

    function getPatDk() {
        try {
            const rawPatDk = new URL(window.location.href).searchParams.get('PatDk') || '';
            return rawPatDk.split('|')[0].replace(/\D/g, '');
        } catch (error) {
            warn('URL WEDA illisible', error);
            return '';
        }
    }

    function getWedaText(selector) {
        return normalizeText(document.querySelector(selector)?.textContent);
    }

    function selectBestAddressCandidate(values) {
        const candidates = Array.from(values || []).map(parseAddressText);
        return candidates.find(candidate => candidate.postalCode) ||
            candidates.find(candidate => candidate.address || candidate.city) || {
            address: '',
            postalCode: '',
            city: ''
        };
    }

    function getWedaAddressCellText(cell) {
        const clone = cell.cloneNode(true);
        clone.querySelectorAll(`${SELECTORS.wedaAddressTitle}, button`)
            .forEach(element => element.remove());
        clone.querySelectorAll('br')
            .forEach(element => element.replaceWith('\n'));
        return clone.textContent || '';
    }

    function extractWedaAddress() {
        const seenCells = new Set();
        const values = Array.from(
            document.querySelectorAll(SELECTORS.wedaAddressTitle)
        )
            .filter(element => (
                normalizeLooseText(element.textContent) === 'adresse patient'
            ))
            .map(element => element.closest('td'))
            .filter(cell => {
                if (!cell || seenCells.has(cell)) return false;
                seenCells.add(cell);
                return true;
            })
            .map(getWedaAddressCellText);

        return selectBestAddressCandidate(values);
    }

    function findWedaContact(labelPatterns) {
        const panel = document.querySelector(SELECTORS.wedaAddressPanel);
        if (!panel) return '';

        const tables = Array.from(panel.querySelectorAll('table.table-address-comunication'));
        for (const pattern of labelPatterns) {
            const table = tables.find(candidate => {
                const label = normalizeLooseText(
                    candidate.querySelector('td.title-address-comunication')?.textContent
                );
                return label.includes(pattern);
            });
            if (!table) continue;

            const valueCell = table.querySelector('td.imagebutton') ||
                table.querySelector('td:nth-child(2)');
            const value = normalizeText(
                valueCell?.querySelector('span')?.textContent || valueCell?.textContent
            );
            if (value) return value;
        }
        return '';
    }

    function extractWedaPatient() {
        const address = extractWedaAddress();
        const rawPhone = normalizePhone(findWedaContact([
            'tel mobile',
            'telephone mobile',
            'portable',
            'tel domicile',
            'telephone'
        ]));
        const rawNir = normalizeNir(getWedaText(SELECTORS.wedaNir));

        return {
            sourcePatientId: getPatDk(),
            lastName: getWedaText(SELECTORS.wedaLastName),
            firstName: getWedaText(SELECTORS.wedaFirstName),
            birthDate: normalizeBirthDate(getWedaText(SELECTORS.wedaBirthDate)),
            gender: getGenderFromCivilite(getWedaText(SELECTORS.wedaTitle)),
            nir: /^\d{15}$/.test(rawNir) ? rawNir : '',
            phone: /^0\d{9}$/.test(rawPhone) ? rawPhone : '',
            ...address
        };
    }

    function getPendingPatient(expectedRequestId = '') {
        const pending = GM_getValue(KEY_PENDING_PATIENT, null);
        if (!pending || typeof pending !== 'object') return null;

        const expiresAt = Number(pending.expiresAt || 0);
        if (!expiresAt || Date.now() > expiresAt) {
            GM_deleteValue(KEY_PENDING_PATIENT);
            return null;
        }
        if (expectedRequestId && pending.id !== expectedRequestId) return null;
        return pending;
    }

    function deletePendingPatientIfCurrent(requestId) {
        const pending = GM_getValue(KEY_PENDING_PATIENT, null);
        if (pending?.id === requestId) GM_deleteValue(KEY_PENDING_PATIENT);
    }

    function buildSosOxygeneRequestUrl(requestId) {
        const url = new URL(SOS_OXYGENE_URL);
        url.searchParams.set(REQUEST_PARAM, requestId);
        return url.href;
    }

    function installWedaStyles() {
        if (document.querySelector('#weda-sos-oxygene-ppc-styles')) return;

        const style = document.createElement('style');
        style.id = 'weda-sos-oxygene-ppc-styles';
        style.textContent = `
            ${SELECTORS.wedaButton} {
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                margin-left: 4px;
                padding: 0;
                vertical-align: middle;
                border: 1px solid #245ca6;
                border-radius: 50%;
                color: #ffffff;
                background: #245ca6;
                font: 700 11px/1 Arial, sans-serif;
                cursor: pointer;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            }

            ${SELECTORS.wedaButton}:hover,
            ${SELECTORS.wedaButton}:focus-visible {
                border-color: #173f78;
                background: #173f78;
                outline: 2px solid rgba(36, 92, 166, 0.25);
                outline-offset: 1px;
            }

            ${SELECTORS.wedaButton}[aria-busy="true"] {
                cursor: wait;
                opacity: 0.72;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function setWedaButtonStatus(button, status, title) {
        if (!button) return;
        button.dataset.status = status;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.setAttribute('aria-busy', status === 'opening' ? 'true' : 'false');
        button.textContent = status === 'opening' ? '…' : status === 'error' ? '!' : 'S';
        button.style.background = status === 'error' ? '#b42318' : '#245ca6';
        button.style.borderColor = status === 'error' ? '#b42318' : '#245ca6';
    }

    function openSosOxygeneFromWeda(button) {
        const patient = extractWedaPatient();
        if (!patient.sourcePatientId || !patient.lastName || !patient.firstName) {
            setWedaButtonStatus(
                button,
                'error',
                'Identité WEDA incomplète : ouverture SOS Oxygène interrompue'
            );
            window.setTimeout(() => {
                setWedaButtonStatus(
                    button,
                    'ready',
                    'Préremplir une DAP PPC dans SOS Oxygène'
                );
            }, 5000);
            return;
        }

        const now = Date.now();
        const requestId = makeRequestId();
        GM_setValue(KEY_PENDING_PATIENT, {
            id: requestId,
            createdAt: now,
            expiresAt: now + WORKFLOW_TTL_MS,
            phase: 'pending-form',
            patient
        });

        setWedaButtonStatus(button, 'opening', 'Ouverture de SOS Oxygène…');
        try {
            GM_openInTab(buildSosOxygeneRequestUrl(requestId), {
                active: true,
                insert: true,
                setParent: true
            });
            log('SOS Oxygène ouvert pour le patient WEDA courant', {
                version: VERSION
            });
        } catch (error) {
            warn('GM_openInTab indisponible, utilisation de window.open', error);
            const opened = window.open(
                buildSosOxygeneRequestUrl(requestId),
                '_blank',
                'noopener'
            );
            if (!opened) {
                deletePendingPatientIfCurrent(requestId);
                setWedaButtonStatus(
                    button,
                    'error',
                    'Le navigateur a bloqué SOS Oxygène'
                );
                return;
            }
        }

        window.setTimeout(() => deletePendingPatientIfCurrent(requestId), WORKFLOW_TTL_MS);
        window.setTimeout(() => {
            if (button.isConnected) {
                setWedaButtonStatus(
                    button,
                    'ready',
                    'Préremplir une DAP PPC dans SOS Oxygène'
                );
            }
        }, 1500);
    }

    function injectWedaButton() {
        const addressTitle = Array.from(
            document.querySelectorAll(SELECTORS.wedaAddressTitle)
        ).find(element => normalizeLooseText(element.textContent) === 'adresse patient');
        if (!addressTitle) return false;

        installWedaStyles();
        let button = document.querySelector(SELECTORS.wedaButton);
        if (!button) {
            button = document.createElement('button');
            button.id = SELECTORS.wedaButton.slice(1);
            button.type = 'button';
            setWedaButtonStatus(
                button,
                'ready',
                'Préremplir une DAP PPC dans SOS Oxygène'
            );
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (button.getAttribute('aria-busy') === 'true') return;
                openSosOxygeneFromWeda(button);
            });
            log('Raccourci SOS Oxygène ajouté sur la fiche WEDA', { version: VERSION });
        }
        button.dataset.scriptVersion = VERSION;

        const anchor = document.querySelector(SELECTORS.wedaOrkynButton) || addressTitle;
        if (anchor.nextElementSibling !== button) {
            anchor.insertAdjacentElement('afterend', button);
        }
        return true;
    }

    function startWedaIntegration() {
        const refresh = () => injectWedaButton();
        const observe = () => {
            if (!document.documentElement) return;
            const observer = new MutationObserver(refresh);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', refresh, { once: true });
            if (document.documentElement) {
                observe();
            } else {
                document.addEventListener('DOMContentLoaded', observe, { once: true });
            }
        } else {
            refresh();
            observe();
        }
    }

    function captureSosOxygeneRequestForThisTab() {
        const url = new URL(window.location.href);
        const requestIdFromUrl = url.searchParams.get(REQUEST_PARAM) || '';

        if (requestIdFromUrl) {
            url.searchParams.delete(REQUEST_PARAM);
            window.history.replaceState(
                window.history.state,
                document.title,
                url.pathname + url.search + url.hash
            );
        }

        if (isValidRequestId(requestIdFromUrl)) {
            window.sessionStorage.setItem(SESSION_REQUEST_KEY, requestIdFromUrl);
            return requestIdFromUrl;
        }
        return window.sessionStorage.getItem(SESSION_REQUEST_KEY) || '';
    }

    function clearWorkflow() {
        window.sessionStorage.removeItem(SESSION_WORKFLOW_KEY);
        window.sessionStorage.removeItem(SESSION_REQUEST_KEY);
    }

    function getWorkflow() {
        try {
            const rawValue = window.sessionStorage.getItem(SESSION_WORKFLOW_KEY);
            if (!rawValue) return null;
            const workflow = JSON.parse(rawValue);
            if (
                !workflow ||
                typeof workflow !== 'object' ||
                !isValidRequestId(workflow.id) ||
                !Number.isFinite(workflow.expiresAt) ||
                Date.now() > workflow.expiresAt
            ) {
                clearWorkflow();
                return null;
            }
            return workflow;
        } catch (error) {
            warn('État SOS Oxygène illisible, réinitialisation', error);
            clearWorkflow();
            return null;
        }
    }

    function saveWorkflow(workflow, phase = workflow.phase) {
        const updated = {
            ...workflow,
            phase,
            updatedAt: Date.now()
        };
        window.sessionStorage.setItem(SESSION_WORKFLOW_KEY, JSON.stringify(updated));
        return updated;
    }

    function claimPendingPatientForThisTab(requestId) {
        const existing = getWorkflow();
        if (existing && (!isValidRequestId(requestId) || existing.id === requestId)) {
            return existing;
        }

        let effectiveRequestId = requestId;
        if (!isValidRequestId(effectiveRequestId)) {
            const fallbackPending = getPendingPatient();
            if (!canUseOpenerFallback(
                fallbackPending,
                window.opener !== null,
                Date.now()
            )) {
                return null;
            }

            effectiveRequestId = fallbackPending.id;
            window.sessionStorage.setItem(SESSION_REQUEST_KEY, effectiveRequestId);
            log(
                'Identifiant de demande récupéré après la redirection d’authentification SOS'
            );
        }

        const pending = getPendingPatient(effectiveRequestId);
        if (!pending?.patient || pending.patient.sourcePatientId === '') return null;

        const workflow = saveWorkflow({
            id: pending.id,
            createdAt: pending.createdAt,
            expiresAt: pending.expiresAt,
            phase: pending.phase || 'pending-form',
            patient: pending.patient
        });
        deletePendingPatientIfCurrent(effectiveRequestId);
        log('Demande WEDA attribuée à cet onglet SOS Oxygène');
        return workflow;
    }

    function installNotificationStyles() {
        if (document.querySelector('#weda-sos-oxygene-notification-styles')) return;
        const style = document.createElement('style');
        style.id = 'weda-sos-oxygene-notification-styles';
        style.textContent = `
            #weda-sos-oxygene-notification {
                position: fixed;
                z-index: 2147483647;
                right: 22px;
                bottom: 22px;
                max-width: 520px;
                padding: 13px 16px;
                border-radius: 8px;
                color: #ffffff;
                background: #167446;
                font: 600 14px/1.4 Arial, sans-serif;
                box-shadow: 0 5px 18px rgba(0, 0, 0, 0.28);
            }
            #weda-sos-oxygene-notification[data-kind="error"] { background: #b42318; }
            #weda-sos-oxygene-notification[data-kind="info"] { background: #245ca6; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showNotification(message, kind = 'success', durationMs = 22000) {
        if (!document.body) return;
        installNotificationStyles();
        let notification = document.querySelector('#weda-sos-oxygene-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'weda-sos-oxygene-notification';
            notification.setAttribute('role', 'status');
            notification.setAttribute('aria-live', 'polite');
            document.body.appendChild(notification);
        }
        notification.dataset.kind = kind;
        notification.textContent = message;
        window.setTimeout(() => notification?.remove(), durationMs);
    }

    function setNativeValue(element, value, { emitKeyboardEvents = false } = {}) {
        const prototype = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        element.focus();
        if (descriptor?.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertText',
            data: value
        }));
        if (emitKeyboardEvents) {
            const key = String(value).slice(-1);
            for (const type of ['keydown', 'keyup']) {
                element.dispatchEvent(new KeyboardEvent(type, {
                    key,
                    bubbles: true,
                    composed: true
                }));
            }
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
    }

    function findUniqueVisibleElement(root, selector, description) {
        const matches = Array.from(root.querySelectorAll(selector)).filter(isVisible);
        if (matches.length !== 1) {
            throw new Error(`${description} : ${matches.length} élément(s) trouvé(s)`);
        }
        return matches[0];
    }

    function findUniqueRenderedElement(root, selector, description) {
        const matches = Array.from(root.querySelectorAll(selector)).filter(isRendered);
        if (matches.length !== 1) {
            throw new Error(`${description} : ${matches.length} élément(s) trouvé(s)`);
        }
        return matches[0];
    }

    async function fillInput(root, selector, value, description, options = {}) {
        if (!value) return false;
        const input = findUniqueRenderedElement(root, selector, description);
        if (input.disabled || input.readOnly) {
            throw new Error(`${description} indisponible`);
        }
        if (String(input.value) !== String(value)) {
            setNativeValue(input, value, options);
            await sleep(80);
        }
        if (String(input.value) !== String(value)) {
            throw new Error(`${description} non conservé(e)`);
        }
        const formControl = input.closest('ozone-input, ozone-date-picker');
        if (formControl?.classList.contains('ng-invalid')) {
            throw new Error(`${description} refusé(e) par SOS Oxygène`);
        }
        return true;
    }

    async function selectOzoneRadio(root, formControlName, labelFor, description) {
        const host = findUniqueVisibleElement(
            root,
            `ozone-radio[formcontrolname="${formControlName}"]`,
            description
        );
        const labels = Array.from(host.querySelectorAll(`label[for="${labelFor}"]`))
            .filter(isVisible);
        if (labels.length !== 1) {
            throw new Error(`${description} : ${labels.length} réponse(s) trouvée(s)`);
        }

        const label = labels[0];
        if (!label.classList.contains('checked') && !label.control?.checked) {
            label.click();
            await sleep(80);
        }
        if (!label.classList.contains('checked') && !label.control?.checked) {
            throw new Error(`${description} non conservé(e)`);
        }
    }

    async function selectOzoneOption(
        root,
        hostSelector,
        expectedText,
        description,
        allowSingleOptionFallback = false
    ) {
        const host = findUniqueVisibleElement(root, hostSelector, description);
        const trigger = findUniqueVisibleElement(host, '.select-trigger', description);
        const expected = normalizeLooseText(expectedText);
        const currentSelection = normalizeLooseText(trigger.textContent);
        if (
            currentSelection === expected ||
            (allowSingleOptionFallback && currentSelection)
        ) {
            return true;
        }

        trigger.click();
        const deadline = Date.now() + 5000;
        let options = [];
        while (Date.now() < deadline) {
            options = Array.from(document.querySelectorAll('ozone-option .ozn-option-content'))
                .filter(isVisible);
            if (options.length > 0) break;
            await sleep(100);
        }

        let option = options.find(
            candidate => normalizeLooseText(candidate.textContent) === expected
        );
        if (
            !option &&
            allowSingleOptionFallback &&
            options.length === 1 &&
            !normalizeLooseText(options[0].textContent).includes('aucun')
        ) {
            option = options[0];
        }
        if (!option) {
            throw new Error(`Option « ${expectedText} » introuvable pour ${description}`);
        }

        (option.closest('ozone-option') || option).click();
        await sleep(100);
        const selectedText = normalizeLooseText(trigger.textContent);
        if (!selectedText || (!allowSingleOptionFallback && selectedText !== expected)) {
            throw new Error(`${description} non conservé(e)`);
        }
        return true;
    }

    async function ensureOzoneCheckbox(root, testId, description) {
        const host = findUniqueVisibleElement(
            root,
            `ozone-checkbox[data-testid="${testId}"]`,
            description
        );
        const input = host.querySelector('input[type="checkbox"]');
        const label = host.querySelector('label');
        if (!input || !label || input.disabled) {
            throw new Error(`${description} indisponible`);
        }
        if (!input.checked) {
            label.click();
            await sleep(60);
        }
        if (!input.checked) throw new Error(`${description} non conservé`);
    }

    async function fillOptionalAddress(root, patient, missingFields) {
        if (patient.address) {
            await fillInput(root, SELECTORS.sosStreet, patient.address, 'Adresse');
        }
        if (patient.postalCode) {
            await fillInput(
                root,
                SELECTORS.sosPostalCode,
                patient.postalCode,
                'Code postal',
                { emitKeyboardEvents: true }
            );
            await sleep(350);
        }
        if (!patient.city) return;

        try {
            await selectOzoneOption(
                root,
                SELECTORS.sosCity,
                patient.city,
                'Ville',
                true
            );
        } catch (error) {
            missingFields.push('ville');
            warn('Ville WEDA non sélectionnée automatiquement', error);
        }
    }

    function isSosFormReady(root) {
        return Boolean(
            root.querySelector(SELECTORS.sosLastName) &&
            root.querySelector(SELECTORS.sosBirthDate) &&
            root.querySelector('ozone-radio[formcontrolname="isAld"]') &&
            root.querySelector('ozone-radio[formcontrolname="ppcIndex"]') &&
            root.querySelector(SELECTORS.sosInterface) &&
            root.querySelector(
                'ozone-radio[formcontrolname="isPolygraphieOrIsPolysomnographie"]'
            ) &&
            SYMPTOM_TEST_IDS.every(testId =>
                root.querySelector(`ozone-checkbox[data-testid="${testId}"]`)
            )
        );
    }

    async function fillSosOxygeneForm(workflow, root) {
        const patient = workflow.patient;
        const missingFields = [];
        const patientFields = [
            [SELECTORS.sosLastName, patient.lastName, 'nom'],
            [SELECTORS.sosFirstName, patient.firstName, 'prénom'],
            [SELECTORS.sosNir, patient.nir, 'NIR'],
            [SELECTORS.sosPhone, patient.phone, 'téléphone'],
            [SELECTORS.sosBirthDate, patient.birthDate, 'date de naissance']
        ];

        if (patient.gender) {
            await selectOzoneRadio(
                root,
                'gender',
                patient.gender === 'male' ? 'Homme' : 'Femme',
                'Sexe'
            );
        } else {
            missingFields.push('sexe');
        }

        for (const [selector, value, description] of patientFields) {
            if (value) {
                await fillInput(root, selector, value, description);
            } else {
                missingFields.push(description);
            }
        }
        await fillOptionalAddress(root, patient, missingFields);

        await selectOzoneRadio(root, 'ppcIndex', '1', 'PPC autopilotée');
        await fillInput(root, SELECTORS.sosPressureMin, '4', 'Pression minimale');
        await fillInput(root, SELECTORS.sosPressureMax, '14', 'Pression maximale');
        await selectOzoneOption(
            root,
            SELECTORS.sosInterface,
            'Nasal',
            'Interface nasale'
        );
        await selectOzoneRadio(root, 'isAld', 'false', 'ALD : Non');
        await selectOzoneRadio(
            root,
            'isPolygraphieOrIsPolysomnographie',
            '1',
            'Polygraphie'
        );

        const symptomLabels = [
            'Somnolence diurne',
            'Ronflements sévères et quotidiens',
            'Céphalées matinales',
            'Fatigue diurne'
        ];
        for (let index = 0; index < SYMPTOM_TEST_IDS.length; index += 1) {
            await ensureOzoneCheckbox(
                root,
                SYMPTOM_TEST_IDS[index],
                symptomLabels[index]
            );
        }

        saveWorkflow({ ...workflow, patient: null }, 'filled');
        const patientWarning = missingFields.length > 0
            ? ` Informations patient à compléter : ${missingFields.join(', ')}.`
            : '';
        showNotification(
            'DAP SOS Oxygène préremplie.' + patientWarning +
            ' Complétez l’IAH, au moins une comorbidité et la pièce jointe, ' +
            'puis relisez avant de signer.',
            missingFields.length > 0 ? 'info' : 'success'
        );
        log('DAP SOS Oxygène préremplie sans signature', { missingFields });
    }

    async function continueSosOxygeneWorkflow() {
        if (automationBusy) return;
        const workflow = getWorkflow();
        if (!workflow || workflow.phase === 'filled' || workflow.phase === 'error') return;

        const root = document.querySelector('main') || document.body;
        if (!root || !isSosFormReady(root)) return;

        automationBusy = true;
        try {
            await fillSosOxygeneForm(workflow, root);
        } catch (error) {
            saveWorkflow({ ...workflow, patient: null }, 'error');
            showNotification(
                `Préremplissage SOS Oxygène interrompu : ${error.message}`,
                'error',
                24000
            );
            warn('Préremplissage interrompu', error);
        } finally {
            automationBusy = false;
        }
    }

    function startSosOxygeneIntegration() {
        const markRuntimeVersion = () => {
            document.documentElement?.setAttribute(
                'data-weda-sos-oxygene-version',
                VERSION
            );
        };
        markRuntimeVersion();
        if (!document.documentElement) {
            document.addEventListener('DOMContentLoaded', markRuntimeVersion, {
                once: true
            });
        }
        log(`Script SOS Oxygène chargé v${VERSION}`);

        const requestId = captureSosOxygeneRequestForThisTab();
        const workflow = claimPendingPatientForThisTab(requestId);
        if (!workflow) return;

        const startedAt = Date.now();
        const refresh = () => {
            continueSosOxygeneWorkflow();
            const currentWorkflow = getWorkflow();
            if (
                !currentWorkflow ||
                currentWorkflow.phase === 'filled' ||
                currentWorkflow.phase === 'error' ||
                Date.now() - startedAt > MAX_AUTOMATION_DURATION_MS
            ) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
        };

        const begin = () => {
            refresh();
            pollTimer = window.setInterval(refresh, POLL_INTERVAL_MS);
            const observer = new MutationObserver(refresh);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            log('Automatisation SOS Oxygène chargée', { version: VERSION });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', begin, { once: true });
        } else {
            begin();
        }
    }

    window.WedaSosOxygenePpc = Object.freeze({
        version: VERSION,
        normalizeNir,
        normalizePhone,
        normalizeBirthDate,
        getGenderFromCivilite,
        parseAddressText,
        selectBestAddressCandidate,
        isValidRequestId,
        canUseOpenerFallback,
        isRendered
    });

    if (window.location.hostname === 'secure.weda.fr') {
        startWedaIntegration();
    } else if (window.location.hostname === 'oxyweb.pro') {
        startSosOxygeneIntegration();
    }
})();
