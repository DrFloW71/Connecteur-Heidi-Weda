// ==UserScript==
// @name         WEDA -> Orkyn PPC patient
// @namespace    https://secure.weda.fr/
// @version      1.0.1
// @description  Ajoute un raccourci Orkyn sur le dossier WEDA, préremplit une prescription PPC puis les informations du patient, sans validation finale.
// @author       Florian Ronez + ChatGPT
// @match        https://secure.weda.fr/FolderMedical/PatientViewForm.aspx*
// @match        https://new.mespatientsorkyn.fr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.1';
    const LOG_PREFIX = '[WEDA-ORKYN-PPC]';

    const ORKYN_URL = 'https://new.mespatientsorkyn.fr/';
    const REQUEST_PARAM = 'wedaOrkynRequest';
    const KEY_PENDING_PATIENT = 'weda_orkyn_ppc_pending_patient_v1';
    const SESSION_REQUEST_KEY = 'weda_orkyn_ppc_request_id_v1';
    const SESSION_WORKFLOW_KEY = 'weda_orkyn_ppc_workflow_v1';
    const WORKFLOW_TTL_MS = 30 * 60 * 1000;
    const POLL_INTERVAL_MS = 350;
    const MAX_AUTOMATION_DURATION_MS = 30 * 60 * 1000;

    const WEDA_PREFIX = '#ContentPlaceHolder1_EtatCivilUCForm1_';
    const SELECTORS = {
        wedaButton: '#weda-open-orkyn-ppc',
        wedaAddressTitle: 'span.title-address-comunication',
        wedaAddressPanel: `${WEDA_PREFIX}PanelAdresseCom`,
        wedaLastName: `${WEDA_PREFIX}LabelPatientNom`,
        wedaFirstName: `${WEDA_PREFIX}LabelPatientPrenom`,
        wedaBirthDate: `${WEDA_PREFIX}LabelPatientDateNaissance`,
        wedaTitle: `${WEDA_PREFIX}LabelPatientCivilite`,
        wedaNir: `${WEDA_PREFIX}LabelPatientSecuriteSocial`,
        orkYnHome: 'al-entrust-patient',
        orkYnTherapy: 'al-entrust-therapy',
        orkYnPatient: 'al-entrust-patient-step',
        orkYnValidation: 'al-form-validation',
        orkYnSwitch: 'span.generic-switch'
    };

    const PATIENT_FIELDS = [
        ['Numéro de sécurité sociale', 'nir'],
        ['Nom', 'lastName'],
        ['Prénom', 'firstName'],
        ['Numéro de téléphone', 'phone'],
        ['Email', 'email'],
        ['Date de naissance', 'birthDate'],
        ['Adresse', 'address'],
        ['Code postal', 'postalCode'],
        ['Ville', 'city']
    ];
    const REQUIRED_PATIENT_KEYS = new Set([
        'nir',
        'lastName',
        'firstName',
        'phone',
        'birthDate',
        'postalCode',
        'city'
    ]);

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
            .filter(line => normalizeLooseText(line) !== 'adresse patient');

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

        const addressLines = lines.filter((_, index) => index !== localityIndex);
        return {
            address: normalizeText(addressLines.join(' ')),
            postalCode,
            city
        };
    }

    function isVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0
        );
    }

    function makeRequestId() {
        const randomPart = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
        return `orkyn_${Date.now()}_${randomPart}`;
    }

    function isValidRequestId(value) {
        return /^orkyn_\d+_[a-z0-9]{6}$/.test(String(value || ''));
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

    function findWedaAddressCell() {
        return Array.from(document.querySelectorAll(SELECTORS.wedaAddressTitle))
            .find(element => normalizeLooseText(element.textContent) === 'adresse patient')
            ?.closest('td') || null;
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
        const address = parseAddressText(findWedaAddressCell()?.innerText || '');
        const rawPhone = normalizePhone(findWedaContact([
            'tel mobile',
            'telephone mobile',
            'portable',
            'tel domicile',
            'telephone'
        ]));
        const rawNir = normalizeNir(getWedaText(SELECTORS.wedaNir));
        const email = findWedaContact(['email', 'e mail', 'courriel']);

        return {
            sourcePatientId: getPatDk(),
            lastName: getWedaText(SELECTORS.wedaLastName),
            firstName: getWedaText(SELECTORS.wedaFirstName),
            birthDate: getWedaText(SELECTORS.wedaBirthDate),
            gender: getGenderFromCivilite(getWedaText(SELECTORS.wedaTitle)),
            nir: /^\d{15}$/.test(rawNir) ? rawNir : '',
            phone: /^0\d{9}$/.test(rawPhone) ? rawPhone : '',
            email,
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

    function buildOrkynRequestUrl(requestId) {
        const url = new URL(ORKYN_URL);
        url.searchParams.set(REQUEST_PARAM, requestId);
        return url.href;
    }

    function installWedaStyles() {
        if (document.querySelector('#weda-orkyn-ppc-styles')) return;

        const style = document.createElement('style');
        style.id = 'weda-orkyn-ppc-styles';
        style.textContent = `
            ${SELECTORS.wedaButton} {
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                margin-left: 6px;
                padding: 0;
                vertical-align: middle;
                border: 1px solid #006a78;
                border-radius: 50%;
                color: #ffffff;
                background: #006a78;
                font: 700 11px/1 Arial, sans-serif;
                cursor: pointer;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            }

            ${SELECTORS.wedaButton}:hover,
            ${SELECTORS.wedaButton}:focus-visible {
                border-color: #004e59;
                background: #004e59;
                outline: 2px solid rgba(0, 106, 120, 0.25);
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
        button.textContent = status === 'opening' ? '…' : status === 'error' ? '!' : 'O';
        button.style.background = status === 'error' ? '#b42318' : '#006a78';
        button.style.borderColor = status === 'error' ? '#b42318' : '#006a78';
    }

    function openOrkynFromWeda(button) {
        const patient = extractWedaPatient();
        if (!patient.sourcePatientId || !patient.lastName || !patient.firstName) {
            setWedaButtonStatus(
                button,
                'error',
                'Identité WEDA incomplète : ouverture Orkyn interrompue'
            );
            window.setTimeout(() => {
                setWedaButtonStatus(button, 'ready', 'Préremplir un nouveau patient PPC dans Orkyn');
            }, 5000);
            return;
        }

        const now = Date.now();
        const requestId = makeRequestId();
        GM_setValue(KEY_PENDING_PATIENT, {
            id: requestId,
            createdAt: now,
            expiresAt: now + WORKFLOW_TTL_MS,
            phase: 'pending-home',
            patient
        });

        setWedaButtonStatus(button, 'opening', 'Ouverture d’Orkyn…');
        try {
            GM_openInTab(buildOrkynRequestUrl(requestId), {
                active: true,
                insert: true,
                setParent: true
            });
            log('Orkyn ouvert pour le patient WEDA courant', {
                version: VERSION,
                sourcePatientId: patient.sourcePatientId
            });
        } catch (error) {
            warn('GM_openInTab indisponible, utilisation de window.open', error);
            const opened = window.open(
                buildOrkynRequestUrl(requestId),
                '_blank',
                'noopener'
            );
            if (!opened) {
                deletePendingPatientIfCurrent(requestId);
                setWedaButtonStatus(button, 'error', 'Le navigateur a bloqué Orkyn');
                return;
            }
        }

        window.setTimeout(() => deletePendingPatientIfCurrent(requestId), WORKFLOW_TTL_MS);
        window.setTimeout(() => {
            if (button.isConnected) {
                setWedaButtonStatus(
                    button,
                    'ready',
                    'Préremplir un nouveau patient PPC dans Orkyn'
                );
            }
        }, 1500);
    }

    function injectWedaButton() {
        if (document.querySelector(SELECTORS.wedaButton)) return true;

        const addressTitle = Array.from(
            document.querySelectorAll(SELECTORS.wedaAddressTitle)
        ).find(element => normalizeLooseText(element.textContent) === 'adresse patient');
        if (!addressTitle) return false;

        installWedaStyles();
        const button = document.createElement('button');
        button.id = SELECTORS.wedaButton.slice(1);
        button.type = 'button';
        setWedaButtonStatus(
            button,
            'ready',
            'Préremplir un nouveau patient PPC dans Orkyn'
        );
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (button.getAttribute('aria-busy') === 'true') return;
            openOrkynFromWeda(button);
        });
        addressTitle.insertAdjacentElement('afterend', button);
        log('Raccourci Orkyn ajouté sur la fiche WEDA', { version: VERSION });
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

    function captureOrkynRequestForThisTab() {
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
            warn('État Orkyn illisible, réinitialisation', error);
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

    function clearWorkflow() {
        window.sessionStorage.removeItem(SESSION_WORKFLOW_KEY);
        window.sessionStorage.removeItem(SESSION_REQUEST_KEY);
    }

    function claimPendingPatientForThisTab(requestId) {
        if (!isValidRequestId(requestId)) return getWorkflow();

        const existing = getWorkflow();
        if (existing?.id === requestId) return existing;

        const pending = getPendingPatient(requestId);
        if (!pending?.patient || pending.patient.sourcePatientId === '') return null;

        const workflow = saveWorkflow({
            id: pending.id,
            createdAt: pending.createdAt,
            expiresAt: pending.expiresAt,
            phase: pending.phase || 'pending-home',
            patient: pending.patient
        });
        deletePendingPatientIfCurrent(requestId);
        log('Demande WEDA attribuée à cet onglet Orkyn');
        return workflow;
    }

    function installNotificationStyles() {
        if (document.querySelector('#weda-orkyn-notification-styles')) return;
        const style = document.createElement('style');
        style.id = 'weda-orkyn-notification-styles';
        style.textContent = `
            #weda-orkyn-notification {
                position: fixed;
                z-index: 2147483647;
                right: 22px;
                bottom: 22px;
                max-width: 470px;
                padding: 13px 16px;
                border-radius: 8px;
                color: #ffffff;
                background: #167446;
                font: 600 14px/1.4 Arial, sans-serif;
                box-shadow: 0 5px 18px rgba(0, 0, 0, 0.28);
            }
            #weda-orkyn-notification[data-kind="error"] { background: #b42318; }
            #weda-orkyn-notification[data-kind="info"] { background: #006a78; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showNotification(message, kind = 'success', durationMs = 14000) {
        if (!document.body) return;
        installNotificationStyles();
        let notification = document.querySelector('#weda-orkyn-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'weda-orkyn-notification';
            notification.setAttribute('role', 'status');
            notification.setAttribute('aria-live', 'polite');
            document.body.appendChild(notification);
        }
        notification.dataset.kind = kind;
        notification.textContent = message;
        window.setTimeout(() => notification?.remove(), durationMs);
    }

    function setNativeValue(element, value) {
        const prototype = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
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
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function setNativeSelectValue(select, value) {
        const descriptor = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            'value'
        );
        if (descriptor?.set) {
            descriptor.set.call(select, value);
        } else {
            select.value = value;
        }
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findUniqueElement(root, selector, description) {
        const matches = Array.from(root.querySelectorAll(selector)).filter(isVisible);
        if (matches.length !== 1) {
            throw new Error(`${description} : ${matches.length} élément(s) trouvé(s)`);
        }
        return matches[0];
    }

    function findChoiceByText(root, selector, expectedText) {
        const normalizedExpected = normalizeLooseText(expectedText);
        const matches = Array.from(root.querySelectorAll(selector)).filter(
            element => normalizeLooseText(element.textContent) === normalizedExpected
        );
        if (matches.length !== 1) {
            throw new Error(
                `Choix « ${expectedText} » ambigu ou introuvable (${matches.length})`
            );
        }
        return matches[0];
    }

    function findQuestionContainer(root, questionText) {
        const expected = normalizeLooseText(questionText);
        const labels = Array.from(root.querySelectorAll('label')).filter(label =>
            normalizeLooseText(label.textContent).includes(expected)
        );
        if (labels.length !== 1) {
            throw new Error(
                `Question « ${questionText} » ambiguë ou introuvable (${labels.length})`
            );
        }

        let container = labels[0].parentElement;
        for (let depth = 0; container && container !== root && depth < 7; depth += 1) {
            if (container.querySelectorAll('al-radio').length >= 2) return container;
            container = container.parentElement;
        }
        throw new Error(`Réponses introuvables pour « ${questionText} »`);
    }

    async function selectRadioAnswer(root, questionText, answerText) {
        const container = findQuestionContainer(root, questionText);
        const choice = findChoiceByText(container, 'al-radio', answerText);
        const input = choice.querySelector('input[type="radio"]');
        if (!input || input.disabled) {
            throw new Error(`Réponse « ${answerText} » indisponible`);
        }
        if (!input.checked) input.click();
        await sleep(60);
        if (!input.checked) {
            throw new Error(`Réponse « ${answerText} » non conservée`);
        }
    }

    async function selectUniqueRadio(root, answerText) {
        const choice = findChoiceByText(root, 'al-radio', answerText);
        const input = choice.querySelector('input[type="radio"]');
        if (!input || input.disabled) {
            throw new Error(`Choix « ${answerText} » indisponible`);
        }
        if (!input.checked) input.click();
        await sleep(60);
        if (!input.checked) {
            throw new Error(`Choix « ${answerText} » non conservé`);
        }
    }

    async function activateRadioButton(root, answerText) {
        const choice = findChoiceByText(root, 'al-radio-btn', answerText);
        if (!choice.classList.contains('active')) {
            (choice.querySelector('span') || choice).click();
            await sleep(80);
        }
        if (
            !choice.classList.contains('active') &&
            !choice.querySelector('span')?.classList.contains('active')
        ) {
            throw new Error(`Bouton « ${answerText} » non activé`);
        }
    }

    async function waitForElement(root, selector, timeoutMs = 5000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const element = root.querySelector(selector);
            if (element) return element;
            await sleep(100);
        }
        return null;
    }

    function setRequiredValue(root, placeholder, value) {
        const field = findUniqueElement(
            root,
            `input[placeholder="${placeholder}"]`,
            placeholder
        );
        if (field.disabled || field.readOnly) {
            throw new Error(`${placeholder} indisponible`);
        }
        setNativeValue(field, value);
        if (String(field.value) !== String(value)) {
            throw new Error(`${placeholder} non conservée`);
        }
    }

    async function ensureESignatureSwitch() {
        const validation = document.querySelector(SELECTORS.orkYnValidation);
        if (!validation) return;
        const genericSwitch = validation.querySelector(SELECTORS.orkYnSwitch);
        if (!genericSwitch) return;
        if (!genericSwitch.classList.contains('checked')) {
            genericSwitch.click();
            await sleep(80);
        }
        if (!genericSwitch.classList.contains('checked')) {
            throw new Error('Le commutateur e-signature n’est pas sur Oui');
        }
    }

    function fillHomeStep(workflow, root) {
        const patient = workflow.patient;
        const lastName = findUniqueElement(root, '#lastName', 'Nom accueil');
        const firstName = findUniqueElement(root, '#firstName', 'Prénom accueil');
        const phone = findUniqueElement(root, '#phoneNumber', 'Téléphone accueil');
        const prestation = findUniqueElement(
            root,
            'select[formcontrolname="prestation"]',
            'Prestation'
        );
        const continueButton = Array.from(root.querySelectorAll('button')).find(
            button => normalizeLooseText(button.textContent) === 'continuer' && isVisible(button)
        );
        if (!continueButton) throw new Error('Bouton Continuer introuvable');

        setNativeValue(lastName, patient.lastName);
        setNativeValue(firstName, patient.firstName);
        setNativeValue(phone, patient.phone || '');
        setNativeSelectValue(prestation, 'PPC');

        if (lastName.value !== patient.lastName || firstName.value !== patient.firstName) {
            throw new Error('Identité non conservée sur l’accueil Orkyn');
        }
        if (prestation.value !== 'PPC') {
            throw new Error('Prestation PPC non conservée');
        }

        saveWorkflow(workflow, 'opening-therapy');
        continueButton.click();
        log('Encart « Nous confier un patient » complété');
    }

    async function fillTherapyStep(workflow, root) {
        await selectRadioAnswer(
            root,
            'Souhaitez-vous e-signer cette prescription',
            'Oui'
        );
        await activateRadioButton(root, 'Autopiloté');

        const pressureMin = await waitForElement(
            root,
            'input[placeholder="Pression Mini (cmH2O)"]'
        );
        const pressureMax = await waitForElement(
            root,
            'input[placeholder="Pression Maxi (cmH2O)"]'
        );
        if (!pressureMin || !pressureMax) {
            throw new Error('Champs de pression introuvables après Autopiloté');
        }
        setRequiredValue(root, 'Pression Mini (cmH2O)', '4');
        setRequiredValue(root, 'Pression Maxi (cmH2O)', '14');

        await selectRadioAnswer(
            root,
            'Patient en Affection Longue Durée',
            'Non'
        );
        await selectRadioAnswer(
            root,
            'traitement par OAM dans les 12 derniers mois',
            'Non'
        );
        await selectUniqueRadio(root, 'Polygraphie');

        const symptomIds = [
            'somnolenceDiurne',
            'ronflementsSeveresEtQuotidiens',
            'SensationEtouffementOuSuffocation',
            'fatigueDiurne'
        ];
        for (const id of symptomIds) {
            const checkbox = root.querySelector(`#${id}`);
            if (!checkbox || checkbox.disabled) {
                throw new Error(`Symptôme introuvable : ${id}`);
            }
            if (!checkbox.checked) checkbox.click();
            if (!checkbox.checked) {
                throw new Error(`Symptôme non conservé : ${id}`);
            }
        }

        await selectRadioAnswer(root, 'Adjonction d’oxygène', 'Non');
        await ensureESignatureSwitch();

        saveWorkflow(workflow, 'waiting-next');
        showNotification(
            'PPC préremplie. Complétez l’IAH initial et joignez le fichier d’examen, puis cliquez sur « Suivant ». Le script reprendra automatiquement.',
            'info',
            24000
        );
        log('Étape thérapeutique préremplie ; attente du clic manuel sur Suivant');
    }

    function fillPatientField(root, placeholder, value) {
        if (!value) return false;
        const matches = Array.from(
            root.querySelectorAll(`input[placeholder="${placeholder}"]`)
        ).filter(isVisible);
        if (matches.length !== 1) {
            throw new Error(`${placeholder} : ${matches.length} champ(s) trouvé(s)`);
        }
        const field = matches[0];
        if (!field.value) setNativeValue(field, value);
        return Boolean(field.value);
    }

    async function fillPatientBirthDate(root, value) {
        if (!value) return false;
        const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!match) throw new Error('Format de date de naissance WEDA inattendu');

        const input = findUniqueElement(
            root,
            'input[placeholder="Date de naissance"]',
            'Date de naissance'
        );
        const dateComponent = input.closest('al-date-input');
        const calendarButton = dateComponent?.querySelector('button');
        if (!dateComponent || !calendarButton) {
            throw new Error('Calendrier de date de naissance introuvable');
        }

        setNativeValue(input, value);
        let picker = dateComponent.querySelector('ngb-datepicker');
        if (!picker) {
            calendarButton.click();
            picker = await waitForElement(dateComponent, 'ngb-datepicker', 3000);
        }
        if (!picker) throw new Error('Calendrier de date de naissance non ouvert');

        const day = String(Number(match[1]));
        const month = String(Number(match[2]));
        const year = match[3];
        let targetDay = picker.querySelector(
            `[role="gridcell"][aria-label="${day}-${month}-${year}"]`
        );

        if (!targetDay) {
            const monthSelect = picker.querySelector('select[aria-label="Select month"]');
            const yearSelect = picker.querySelector('select[aria-label="Select year"]');
            if (!monthSelect || !yearSelect) {
                throw new Error('Navigation du calendrier indisponible');
            }
            setNativeSelectValue(yearSelect, year);
            setNativeSelectValue(monthSelect, month);
            await sleep(100);
            targetDay = picker.querySelector(
                `[role="gridcell"][aria-label="${day}-${month}-${year}"]`
            );
        }

        if (!targetDay) throw new Error('Jour de naissance introuvable dans le calendrier');
        targetDay.click();
        await sleep(100);

        const validationDate = Array.from(
            document.querySelectorAll(
                `${SELECTORS.orkYnValidation} span.form-success, ` +
                `${SELECTORS.orkYnValidation} span.form-error`
            )
        ).find(element => normalizeLooseText(element.textContent) === 'date de naissance');
        if (!input.value || validationDate?.classList.contains('form-error')) {
            throw new Error('Date de naissance non conservée par Orkyn');
        }
        return true;
    }

    async function fillPatientStep(workflow, root) {
        const patient = workflow.patient;
        for (const [placeholder, key] of PATIENT_FIELDS) {
            if (key === 'birthDate') continue;
            fillPatientField(root, placeholder, patient[key]);
        }
        await fillPatientBirthDate(root, patient.birthDate);

        if (patient.gender) {
            await activateRadioButton(
                root,
                patient.gender === 'male' ? 'Masculin' : 'Féminin'
            );
        }
        await ensureESignatureSwitch();

        const missing = PATIENT_FIELDS
            .filter(([, key]) => REQUIRED_PATIENT_KEYS.has(key) && !patient[key])
            .map(([placeholder]) => placeholder);
        saveWorkflow(workflow, 'patient-filled');

        const message = missing.length > 0
            ? `Informations WEDA préremplies. À compléter manuellement : ${missing.join(', ')}. Vérifiez puis cliquez sur « Suivant ».`
            : 'Toutes les informations WEDA disponibles sont préremplies. Vérifiez puis cliquez sur « Suivant ».';
        showNotification(message, missing.length > 0 ? 'info' : 'success', 24000);
        log('Étape patient préremplie', { missingFields: missing });
    }

    function isHomeStepReady(root) {
        return Boolean(
            root.querySelector('#lastName') &&
            root.querySelector('#firstName') &&
            root.querySelector('#phoneNumber') &&
            root.querySelector('select[formcontrolname="prestation"]')
        );
    }

    function isTherapyStepReady(root) {
        const symptomIds = [
            'somnolenceDiurne',
            'ronflementsSeveresEtQuotidiens',
            'SensationEtouffementOuSuffocation',
            'fatigueDiurne'
        ];
        return (
            root.querySelectorAll('al-radio').length >= 10 &&
            root.querySelectorAll('al-radio-btn').length >= 6 &&
            symptomIds.every(id => root.querySelector(`#${id}`))
        );
    }

    function isPatientStepReady(root) {
        return (
            PATIENT_FIELDS.every(([placeholder]) =>
                root.querySelector(`input[placeholder="${placeholder}"]`)
            ) &&
            root.querySelectorAll('al-radio-btn').length >= 2
        );
    }

    async function continueOrkynWorkflow() {
        if (automationBusy) return;
        const workflow = getWorkflow();
        if (!workflow) return;
        if (workflow.phase === 'error') return;

        automationBusy = true;
        try {
            const patientStep = document.querySelector(SELECTORS.orkYnPatient);
            if (
                patientStep &&
                isPatientStepReady(patientStep) &&
                workflow.phase !== 'patient-filled'
            ) {
                await fillPatientStep(workflow, patientStep);
                return;
            }

            const therapyStep = document.querySelector(SELECTORS.orkYnTherapy);
            if (
                therapyStep &&
                isTherapyStepReady(therapyStep) &&
                workflow.phase !== 'waiting-next' &&
                workflow.phase !== 'patient-filled'
            ) {
                await fillTherapyStep(workflow, therapyStep);
                return;
            }

            const homeStep = document.querySelector(SELECTORS.orkYnHome);
            if (
                homeStep &&
                isHomeStepReady(homeStep) &&
                workflow.phase === 'pending-home'
            ) {
                fillHomeStep(workflow, homeStep);
            }
        } catch (error) {
            saveWorkflow(workflow, 'error');
            showNotification(
                `Préremplissage Orkyn interrompu : ${error.message}`,
                'error',
                20000
            );
            warn('Préremplissage interrompu', error);
        } finally {
            automationBusy = false;
        }
    }

    function startOrkynIntegration() {
        const requestId = captureOrkynRequestForThisTab();
        const workflow = claimPendingPatientForThisTab(requestId);
        if (!workflow) return;

        const startedAt = Date.now();
        const refresh = () => {
            continueOrkynWorkflow();
            if (Date.now() - startedAt > MAX_AUTOMATION_DURATION_MS) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
        };

        const begin = () => {
            refresh();
            pollTimer = window.setInterval(refresh, POLL_INTERVAL_MS);
            const observer = new MutationObserver(refresh);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            log('Automatisation Orkyn chargée', { version: VERSION });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', begin, { once: true });
        } else {
            begin();
        }
    }

    window.WedaOrkynPpc = Object.freeze({
        version: VERSION,
        normalizeNir,
        normalizePhone,
        getGenderFromCivilite,
        parseAddressText
    });

    if (window.location.hostname === 'secure.weda.fr') {
        startWedaIntegration();
    } else if (window.location.hostname === 'new.mespatientsorkyn.fr') {
        startOrkynIntegration();
    }
})();
