// ==UserScript==
// @name         AmeliPro - Auto Perrières
// @namespace    local.amelipro
// @version      1.0.3
// @description  Ajoute un raccourci qui ouvre et préremplit une prescription de transport pour les Perrières, sans la valider.
// @author       Florian Ronez + ChatGPT
// @match        https://espacepro.ameli.fr/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.3';
    const LOG_PREFIX = '[AUTO-PERRIERES]';
    const WORKFLOW_KEY = 'amelipro_auto_perrieres_workflow_v1';
    const WORKFLOW_TTL_MS = 5 * 60 * 1000;
    const POLL_INTERVAL_MS = 400;
    const MAX_WAIT_MS = 2 * 60 * 1000;

    const VALUES = {
        nbTrajets: '12',
        commentairesMedicaux:
            'Selon accord annuel entre Foyer des Perrières et sécurité sociale'
    };

    const SELECTORS = {
        shortcut: '#auto-perrieres-shortcut',
        prescriptionSpan: 'span.amelipro-custom-btn',
        createPrescription: '#createPrescription',
        nbTrajets: '#transport_trajet_nbTrajets',
        lieuDepartDomicile: '#lieu-depart-domicile',
        lieuArriveeStructure: '#lieu-arrivee-structure',
        selectionsArriveeTitle: '#titre-selection-arrivee',
        selectionArrivee: 'label.selection.selection_arrivee',
        taxiButton: '#transport_modeTransport_taxi_V',
        taxiCheckbox: '#transport_modeTransport_taxi',
        aldInput: '#transport_situationPatient_ald',
        aldToggle: '#transport_situationPatient_ald_toggle .toogle-btn',
        aldExonerante: '#transport_situationPatient_typeAld_0',
        commentairesMedicaux: '#transport_elementsMedicaux_commentairesMedicaux'
    };

    let workflowBusy = false;
    let pollTimer = null;

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
            .trim()
            .toLocaleLowerCase('fr-FR');
    }

    function normalizeLooseText(value) {
        return normalizeText(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function getEditDistance(firstValue, secondValue) {
        const first = String(firstValue || '');
        const second = String(secondValue || '');
        const previousRow = Array.from(
            { length: second.length + 1 },
            (_, index) => index
        );

        for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
            const currentRow = [firstIndex];
            for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
                const substitutionCost =
                    first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
                currentRow[secondIndex] = Math.min(
                    currentRow[secondIndex - 1] + 1,
                    previousRow[secondIndex] + 1,
                    previousRow[secondIndex - 1] + substitutionCost
                );
            }
            previousRow.splice(0, previousRow.length, ...currentRow);
        }

        return previousRow[second.length];
    }

    function isPerrieresName(value) {
        const candidate = normalizeLooseText(value);
        const expected = 'foyer des perrieres';
        if (!candidate) return false;

        return (
            candidate === expected ||
            candidate.includes(expected) ||
            getEditDistance(candidate, expected) <= 3
        );
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

    function getWorkflow() {
        try {
            const rawValue = window.sessionStorage.getItem(WORKFLOW_KEY);
            if (!rawValue) return null;

            const workflow = JSON.parse(rawValue);
            if (
                !workflow ||
                typeof workflow !== 'object' ||
                !Number.isFinite(workflow.startedAt) ||
                Date.now() - workflow.startedAt > WORKFLOW_TTL_MS
            ) {
                window.sessionStorage.removeItem(WORKFLOW_KEY);
                return null;
            }

            return workflow;
        } catch (error) {
            warn('État de l’automatisation illisible, réinitialisation', error);
            window.sessionStorage.removeItem(WORKFLOW_KEY);
            return null;
        }
    }

    function saveWorkflow(phase) {
        const current = getWorkflow();
        const workflow = {
            startedAt: current?.startedAt || Date.now(),
            phase,
            updatedAt: Date.now()
        };
        window.sessionStorage.setItem(WORKFLOW_KEY, JSON.stringify(workflow));
        return workflow;
    }

    function clearWorkflow() {
        window.sessionStorage.removeItem(WORKFLOW_KEY);
    }

    function installStyles() {
        if (document.querySelector('#auto-perrieres-styles')) return;

        const style = document.createElement('style');
        style.id = 'auto-perrieres-styles';
        style.textContent = `
            ${SELECTORS.shortcut} {
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-height: 34px;
                margin-left: 10px;
                padding: 6px 11px;
                border: 1px solid #006386;
                border-radius: 17px;
                color: #ffffff;
                background: #006386;
                font: 600 13px/1.2 Arial, sans-serif;
                white-space: nowrap;
                cursor: pointer;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
                vertical-align: middle;
            }

            ${SELECTORS.shortcut}:hover,
            ${SELECTORS.shortcut}:focus-visible {
                border-color: #004c68;
                background: #004c68;
                outline: 3px solid rgba(0, 99, 134, 0.22);
                outline-offset: 2px;
            }

            ${SELECTORS.shortcut}[aria-busy="true"] {
                cursor: wait;
                opacity: 0.72;
            }

            #auto-perrieres-notification {
                position: fixed;
                z-index: 2147483647;
                right: 22px;
                bottom: 22px;
                max-width: 430px;
                padding: 13px 16px;
                border-radius: 8px;
                color: #ffffff;
                background: #167446;
                font: 600 14px/1.4 Arial, sans-serif;
                box-shadow: 0 5px 18px rgba(0, 0, 0, 0.28);
            }

            #auto-perrieres-notification[data-kind="error"] {
                background: #b42318;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showNotification(message, kind = 'success', durationMs = 10000) {
        installStyles();

        let notification = document.querySelector('#auto-perrieres-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'auto-perrieres-notification';
            notification.setAttribute('role', 'status');
            notification.setAttribute('aria-live', 'polite');
            document.body.appendChild(notification);
        }

        notification.dataset.kind = kind;
        notification.textContent = message;
        window.setTimeout(() => notification?.remove(), durationMs);
    }

    function findPrescriptionSpan() {
        return Array.from(document.querySelectorAll(SELECTORS.prescriptionSpan)).find(
            element => normalizeText(element.textContent) === 'prescription de transport'
        ) || null;
    }

    function getPrescriptionClickableElement(span) {
        return (
            span.closest('button, a, [role="button"], [onclick]') ||
            span
        );
    }

    function setShortcutBusy(shortcut, busy) {
        shortcut.setAttribute('aria-busy', busy ? 'true' : 'false');
        shortcut.textContent = busy ? '⏳ Ouverture…' : '🚕 Auto Perrières';
    }

    function startWorkflow(shortcut, prescriptionSpan) {
        const clickable = getPrescriptionClickableElement(prescriptionSpan);
        if (!isVisible(clickable)) {
            showNotification(
                'Le bouton « Prescription de transport » n’est pas disponible.',
                'error'
            );
            return;
        }

        saveWorkflow('opening-transport');
        setShortcutBusy(shortcut, true);
        log('Démarrage du préremplissage');
        clickable.click();
    }

    function injectShortcut() {
        if (document.querySelector(SELECTORS.shortcut)) return true;

        const prescriptionSpan = findPrescriptionSpan();
        if (!prescriptionSpan || !isVisible(prescriptionSpan)) return false;

        installStyles();

        // Un élément de rôle bouton évite d’imbriquer un <button> si AmeliPro
        // place le libellé « Prescription de transport » dans un bouton.
        const shortcut = document.createElement('span');
        shortcut.id = SELECTORS.shortcut.slice(1);
        shortcut.setAttribute('role', 'button');
        shortcut.setAttribute('tabindex', '0');
        shortcut.setAttribute('aria-label', 'Préremplir la prescription Auto Perrières');
        shortcut.setAttribute('aria-busy', 'false');
        shortcut.textContent = '🚕 Auto Perrières';

        shortcut.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (shortcut.getAttribute('aria-busy') === 'true') return;
            startWorkflow(shortcut, prescriptionSpan);
        });

        shortcut.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            shortcut.click();
        });

        prescriptionSpan.insertAdjacentElement('afterend', shortcut);
        log('Raccourci « Auto Perrières » ajouté');
        return true;
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

    function selectRadio(selector) {
        const input = document.querySelector(selector);
        if (!input || input.disabled) {
            throw new Error(`Bouton radio introuvable ou désactivé : ${selector}`);
        }
        if (input.checked) return;

        const label = input.closest('label') ||
            document.querySelector(`label[for="${input.id}"]`);
        (label || input).click();
        if (!input.checked) {
            input.click();
        }
        if (!input.checked) {
            throw new Error(`Le bouton radio n’a pas été activé : ${selector}`);
        }
    }

    async function selectTaxi() {
        const button = document.querySelector(SELECTORS.taxiButton);
        const checkbox = document.querySelector(SELECTORS.taxiCheckbox);
        if (!button || !checkbox || button.disabled) {
            throw new Error('Le bouton Taxi est introuvable ou désactivé');
        }
        if (checkbox.checked) return;

        button.click();
        await sleep(100);
        if (!checkbox.checked) {
            throw new Error('Le mode de transport Taxi n’a pas été activé');
        }
    }

    async function activateAldToggle() {
        const input = document.querySelector(SELECTORS.aldInput);
        const toggle = document.querySelector(SELECTORS.aldToggle);
        if (!input || !toggle || input.disabled) {
            throw new Error('L’interrupteur ALD est introuvable ou désactivé');
        }
        if (input.checked) return;

        toggle.click();
        await sleep(100);
        if (!input.checked) {
            throw new Error('L’interrupteur ALD n’a pas été activé');
        }
    }

    function requireField(selector, label) {
        const field = document.querySelector(selector);
        if (!field || field.disabled || field.readOnly) {
            throw new Error(`${label} est introuvable ou indisponible`);
        }
        return field;
    }

    async function waitForElement(selector, timeoutMs = 5000) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const element = document.querySelector(selector);
            if (element) return element;
            await sleep(100);
        }

        return null;
    }

    async function selectAldExonerante() {
        const input = await waitForElement(SELECTORS.aldExonerante);
        if (!input) {
            throw new Error('Le choix ALD « Exonérante » n’est pas apparu');
        }

        selectRadio(SELECTORS.aldExonerante);
    }

    function findPerrieresArrivalSelections() {
        return Array.from(document.querySelectorAll(SELECTORS.selectionArrivee)).filter(
            selection => {
                const raisonSociale = String(
                    selection.querySelector('.raisonSociale')?.textContent ||
                    selection.querySelector('span')?.textContent ||
                    ''
                );
                const codePostal = String(
                    selection.querySelector('.codePostal')?.textContent || ''
                ).trim();
                const commune = normalizeText(
                    selection.querySelector('.commune')?.textContent
                );

                return (
                    isPerrieresName(raisonSociale) &&
                    codePostal === '71260' &&
                    commune === 'aze'
                );
            }
        );
    }

    async function selectPerrieresArrival() {
        selectRadio(SELECTORS.lieuArriveeStructure);

        const selectionsTitle = await waitForElement(SELECTORS.selectionsArriveeTitle);
        if (!selectionsTitle) {
            throw new Error('La rubrique « Précédentes sélections » est introuvable');
        }

        if (
            selectionsTitle.getAttribute('aria-expanded') !== 'true' ||
            selectionsTitle.classList.contains('collapsed')
        ) {
            selectionsTitle.click();
        }

        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const matches = findPerrieresArrivalSelections();
            const firstVisibleMatch = matches.find(isVisible);
            if (firstVisibleMatch) {
                firstVisibleMatch.click();
                log('Structure d’arrivée « Foyer des Perrières — 71260 AZE » sélectionnée');
                if (matches.length > 1) {
                    log(
                        `${matches.length} correspondances proches trouvées ; la première a été sélectionnée`
                    );
                }
                return;
            }
            await sleep(100);
        }

        throw new Error(
            'La structure « Foyer des Perrières — 71260 AZE » est introuvable'
        );
    }

    function allFormFieldsReady() {
        return [
            SELECTORS.nbTrajets,
            SELECTORS.lieuDepartDomicile,
            SELECTORS.lieuArriveeStructure,
            SELECTORS.taxiButton,
            SELECTORS.taxiCheckbox,
            SELECTORS.aldInput,
            SELECTORS.aldToggle,
            SELECTORS.commentairesMedicaux
        ].every(selector => document.querySelector(selector));
    }

    async function fillPrescription() {
        if (!allFormFieldsReady()) return false;

        const nbTrajets = requireField(SELECTORS.nbTrajets, 'Nombre de trajets');
        setNativeValue(nbTrajets, VALUES.nbTrajets);
        if (nbTrajets.value !== VALUES.nbTrajets) {
            throw new Error('Le nombre de trajets n’a pas été conservé');
        }

        selectRadio(SELECTORS.lieuDepartDomicile);
        await selectPerrieresArrival();

        await selectTaxi();
        await activateAldToggle();
        await selectAldExonerante();

        const commentairesMedicaux = requireField(
            SELECTORS.commentairesMedicaux,
            'Commentaires médicaux'
        );
        setNativeValue(commentairesMedicaux, VALUES.commentairesMedicaux);

        if (commentairesMedicaux.value !== VALUES.commentairesMedicaux) {
            throw new Error('AmeliPro n’a pas conservé toutes les valeurs saisies');
        }

        saveWorkflow('completed');
        clearWorkflow();
        showNotification(
            'Auto Perrières terminé : relisez la prescription puis validez-la manuellement.'
        );
        log('Préremplissage terminé ; validation laissée à l’utilisateur');
        return true;
    }

    async function continueWorkflow() {
        if (workflowBusy) return;

        const workflow = getWorkflow();
        if (!workflow) return;

        workflowBusy = true;
        try {
            if (allFormFieldsReady()) {
                await fillPrescription();
                return;
            }

            const createLink = document.querySelector(SELECTORS.createPrescription);
            if (
                createLink &&
                isVisible(createLink) &&
                !createLink.disabled &&
                workflow.phase !== 'opening-prescription'
            ) {
                saveWorkflow('opening-prescription');
                log('Ouverture du formulaire de prescription');
                createLink.click();
            }
        } catch (error) {
            clearWorkflow();
            showNotification(
                `Auto Perrières interrompu : ${error.message}`,
                'error',
                15000
            );
            warn('Préremplissage interrompu', error);
        } finally {
            workflowBusy = false;
        }
    }

    function start() {
        const startedAt = Date.now();

        const refresh = () => {
            injectShortcut();
            continueWorkflow();

            if (Date.now() - startedAt > MAX_WAIT_MS && !getWorkflow()) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
        };

        refresh();
        pollTimer = window.setInterval(refresh, POLL_INTERVAL_MS);

        const observer = new MutationObserver(() => {
            injectShortcut();
            continueWorkflow();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        log('Script chargé', { version: VERSION });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
