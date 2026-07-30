// ==UserScript==
// @name         WEDA -> Amelipro patient
// @namespace    https://secure.weda.fr/
// @version      1.0.2
// @description  Ajoute un raccourci Amelipro à côté du NIR WEDA, ouvre Amelipro, lance si besoin la connexion CPS, puis recherche automatiquement le patient.
// @author       Florian Ronez + ChatGPT
// @match        https://secure.weda.fr/FolderMedical/PatientViewForm.aspx*
// @match        https://espacepro.ameli.fr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.2';
    const LOG_PREFIX = '[WEDA-AMELIPRO]';

    const AMELIPRO_URL = 'https://espacepro.ameli.fr/page-accueil-ihm/';
    const AMELIPRO_REQUEST_PARAM = 'wedaAmeliproRequest';
    const AMELIPRO_REQUEST_SESSION_KEY = 'weda_amelipro_request_id_v1';
    const KEY_PENDING_PATIENT = 'weda_amelipro_pending_patient_v1';
    const PENDING_TTL_MS = 10 * 60 * 1000;
    const MAX_AUTOMATION_DURATION_MS = 10 * 60 * 1000;
    const AUTOMATION_POLL_INTERVAL_MS = 1000;

    const SELECTORS = {
        wedaNir: '#ContentPlaceHolder1_EtatCivilUCForm1_LabelPatientSecuriteSocial',
        wedaButton: '#weda-open-amelipro-patient',
        ameliproCpsButton: '#submit-button-cps',
        ameliproNirInput: '#patientLogin-form-nir',
        ameliproNirButton: '#patientLogin-form-nir-btn'
    };

    let automationStartedAt = Date.now();
    let automationTimer = null;
    let automationBusy = false;
    let currentAmeliproRequestId = '';

    function log(message, details) {
        if (details === undefined) {
            console.log(LOG_PREFIX, message);
        } else {
            console.log(LOG_PREFIX, message, details);
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
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeNir(value) {
        return String(value || '').replace(/\D/g, '');
    }

    function isValidWedaNir(nir) {
        return /^\d{15}$/.test(nir);
    }

    function getAmeliproNir(nir) {
        return isValidWedaNir(nir) ? nir.slice(0, 13) : '';
    }

    function isVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function makeRequestId() {
        const randomPart = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
        return 'amelipro_' + Date.now() + '_' + randomPart;
    }

    function getPendingPatient(expectedRequestId = '') {
        const pending = GM_getValue(KEY_PENDING_PATIENT, null);
        if (!pending || typeof pending !== 'object') return null;

        const nir = normalizeNir(pending.nir);
        const expiresAt = Number(pending.expiresAt || 0);
        if (!isValidWedaNir(nir) || !expiresAt || Date.now() > expiresAt) {
            GM_deleteValue(KEY_PENDING_PATIENT);
            return null;
        }
        if (expectedRequestId && pending.id !== expectedRequestId) return null;

        return {
            ...pending,
            nir,
            ameliproNir: getAmeliproNir(nir),
            expiresAt
        };
    }

    function savePendingPatient(pending) {
        GM_setValue(KEY_PENDING_PATIENT, pending);
    }

    function savePendingPatientIfCurrent(pending) {
        const current = GM_getValue(KEY_PENDING_PATIENT, null);
        if (!current || current.id !== pending.id) return false;
        GM_setValue(KEY_PENDING_PATIENT, pending);
        return true;
    }

    function deletePendingPatientIfCurrent(requestId) {
        const current = GM_getValue(KEY_PENDING_PATIENT, null);
        if (current?.id === requestId) {
            GM_deleteValue(KEY_PENDING_PATIENT);
        }
    }

    function buildAmeliproRequestUrl(requestId) {
        const url = new URL(AMELIPRO_URL);
        url.searchParams.set(AMELIPRO_REQUEST_PARAM, requestId);
        return url.href;
    }

    function captureAmeliproRequestForThisTab() {
        const url = new URL(window.location.href);
        const requestIdFromUrl = url.searchParams.get(AMELIPRO_REQUEST_PARAM) || '';
        const validRequestId = /^amelipro_\d+_[a-z0-9]{6}$/.test(requestIdFromUrl);

        if (requestIdFromUrl) {
            url.searchParams.delete(AMELIPRO_REQUEST_PARAM);
            window.history.replaceState(
                window.history.state,
                document.title,
                url.pathname + url.search + url.hash
            );
        }

        if (validRequestId) {
            sessionStorage.setItem(AMELIPRO_REQUEST_SESSION_KEY, requestIdFromUrl);
            return requestIdFromUrl;
        }

        return sessionStorage.getItem(AMELIPRO_REQUEST_SESSION_KEY) || '';
    }

    function installWedaStyles() {
        if (document.querySelector('#weda-amelipro-styles')) return;

        const style = document.createElement('style');
        style.id = 'weda-amelipro-styles';
        style.textContent = `
            ${SELECTORS.wedaButton} {
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 27px;
                height: 27px;
                margin-left: 7px;
                padding: 0;
                vertical-align: middle;
                border: 1px solid #1261a0;
                border-radius: 50%;
                color: #ffffff;
                background: #1261a0;
                font-family: Arial, sans-serif;
                font-size: 12px;
                font-weight: 700;
                line-height: 1;
                cursor: pointer;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            }

            ${SELECTORS.wedaButton}:hover,
            ${SELECTORS.wedaButton}:focus-visible {
                border-color: #0b4778;
                background: #0b4778;
                outline: 2px solid rgba(18, 97, 160, 0.25);
                outline-offset: 2px;
            }

            ${SELECTORS.wedaButton}[aria-busy="true"] {
                cursor: wait;
                opacity: 0.7;
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

        if (status === 'error') {
            button.textContent = '!';
            button.style.background = '#b42318';
            button.style.borderColor = '#b42318';
        } else if (status === 'opening') {
            button.textContent = '…';
            button.style.background = '#1261a0';
            button.style.borderColor = '#1261a0';
        } else {
            button.textContent = 'a+';
            button.style.background = '#1261a0';
            button.style.borderColor = '#1261a0';
        }
    }

    function openAmeliproFromWeda(button, nirElement) {
        const nir = normalizeNir(nirElement?.textContent);
        if (!isValidWedaNir(nir)) {
            setWedaButtonStatus(
                button,
                'error',
                'NIR WEDA absent ou invalide : ouverture automatique impossible'
            );
            warn('NIR WEDA absent ou invalide');
            window.setTimeout(() => {
                setWedaButtonStatus(button, 'ready', 'Ouvrir ce patient dans Amelipro');
            }, 4000);
            return;
        }

        const now = Date.now();
        const requestId = makeRequestId();
        savePendingPatient({
            id: requestId,
            nir,
            createdAt: now,
            expiresAt: now + PENDING_TTL_MS,
            phase: 'pending',
            cpsClickCount: 0
        });
        const ameliproRequestUrl = buildAmeliproRequestUrl(requestId);

        setWedaButtonStatus(button, 'opening', 'Ouverture d’Amelipro…');

        try {
            GM_openInTab(ameliproRequestUrl, {
                active: true,
                insert: true,
                setParent: true
            });
            log('Amelipro ouvert pour le patient WEDA courant');
        } catch (error) {
            warn('GM_openInTab indisponible, utilisation de window.open', error);
            const opened = window.open(ameliproRequestUrl, '_blank', 'noopener');
            if (!opened) {
                GM_deleteValue(KEY_PENDING_PATIENT);
                setWedaButtonStatus(
                    button,
                    'error',
                    'Le navigateur a bloqué l’ouverture d’Amelipro'
                );
                return;
            }
        }

        window.setTimeout(() => {
            if (button.isConnected) {
                setWedaButtonStatus(button, 'ready', 'Ouvrir ce patient dans Amelipro');
            }
        }, 1500);
    }

    function injectWedaButton() {
        const nirElement = document.querySelector(SELECTORS.wedaNir);
        if (!nirElement || document.querySelector(SELECTORS.wedaButton)) return;

        installWedaStyles();

        const button = document.createElement('button');
        button.id = SELECTORS.wedaButton.slice(1);
        button.type = 'button';
        setWedaButtonStatus(button, 'ready', 'Ouvrir ce patient dans Amelipro');
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openAmeliproFromWeda(button, nirElement);
        });

        nirElement.insertAdjacentElement('afterend', button);
        log('Raccourci Amelipro ajouté sur la fiche patient WEDA');
    }

    function startWedaIntegration() {
        const inject = () => injectWedaButton();
        const observe = () => {
            if (!document.documentElement) return;
            const observer = new MutationObserver(inject);
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', inject, { once: true });
            if (document.documentElement) {
                observe();
            } else {
                document.addEventListener('DOMContentLoaded', observe, { once: true });
            }
        } else {
            inject();
            observe();
        }
    }

    function setNativeInputValue(input, value) {
        const prototype = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        if (descriptor?.set) {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }

        input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertText',
            data: value
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function clickElement(element) {
        element.focus({ preventScroll: false });
        element.click();
    }

    async function fillAndValidateAmeliproNir(pending, input) {
        if (normalizeNir(input.value) !== pending.ameliproNir) {
            setNativeInputValue(input, pending.ameliproNir);
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            await sleep(350);
        }

        if (normalizeNir(input.value) !== pending.ameliproNir) {
            throw new Error('Amelipro n’a pas conservé le NIR saisi');
        }

        const validateButton = document.querySelector(SELECTORS.ameliproNirButton);
        if (!isVisible(validateButton)) return false;

        if (validateButton.disabled || validateButton.getAttribute('aria-disabled') === 'true') {
            return false;
        }

        clickElement(validateButton);
        deletePendingPatientIfCurrent(pending.id);
        sessionStorage.removeItem(AMELIPRO_REQUEST_SESSION_KEY);
        stopAmeliproAutomation();
        log('NIR transmis et validation Amelipro déclenchée');
        return true;
    }

    function canRetryCpsClick(pending) {
        return Number(pending.cpsClickCount || 0) === 0;
    }

    function clickCpsLoginIfNeeded(pending) {
        const cpsButton = document.querySelector(SELECTORS.ameliproCpsButton);
        if (!isVisible(cpsButton) || cpsButton.disabled) return false;
        if (!canRetryCpsClick(pending)) return false;

        const updated = {
            ...pending,
            phase: 'cps-clicked',
            cpsClickedAt: Date.now(),
            cpsClickCount: Number(pending.cpsClickCount || 0) + 1
        };
        if (!savePendingPatientIfCurrent(updated)) return false;
        clickElement(cpsButton);
        log('Connexion CPS déclenchée ; validation du code CPS laissée à la fenêtre sécurisée');
        return true;
    }

    async function runAmeliproAutomation() {
        if (automationBusy) return;
        if (Date.now() - automationStartedAt > MAX_AUTOMATION_DURATION_MS) {
            sessionStorage.removeItem(AMELIPRO_REQUEST_SESSION_KEY);
            stopAmeliproAutomation();
            return;
        }

        const pending = getPendingPatient(currentAmeliproRequestId);
        if (!pending) {
            sessionStorage.removeItem(AMELIPRO_REQUEST_SESSION_KEY);
            stopAmeliproAutomation();
            return;
        }

        automationBusy = true;
        try {
            const nirInput = document.querySelector(SELECTORS.ameliproNirInput);
            if (isVisible(nirInput) && !nirInput.disabled && !nirInput.readOnly) {
                await fillAndValidateAmeliproNir(pending, nirInput);
                return;
            }

            clickCpsLoginIfNeeded(pending);
        } catch (error) {
            warn('Automatisation Amelipro momentanément impossible', error);
        } finally {
            automationBusy = false;
        }
    }

    function stopAmeliproAutomation() {
        if (automationTimer !== null) {
            window.clearInterval(automationTimer);
            automationTimer = null;
        }
    }

    function startAmeliproAutomation() {
        automationStartedAt = Date.now();
        currentAmeliproRequestId = captureAmeliproRequestForThisTab();
        if (!currentAmeliproRequestId) {
            log('Aucune demande WEDA destinée à cet onglet Amelipro');
            return;
        }

        const start = () => {
            runAmeliproAutomation();
            automationTimer = window.setInterval(
                runAmeliproAutomation,
                AUTOMATION_POLL_INTERVAL_MS
            );
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
    }

    if (location.hostname === 'secure.weda.fr') {
        startWedaIntegration();
    } else if (location.hostname === 'espacepro.ameli.fr') {
        startAmeliproAutomation();
    }

    log('Script chargé', { version: VERSION, host: location.hostname });
})();
