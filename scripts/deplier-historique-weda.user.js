// ==UserScript==
// @name         WEDA - deplier historique automatiquement
// @namespace    https://secure.weda.fr/
// @version      1.0.1
// @description  Sur la fiche patient WEDA, clique automatiquement sur "Suite..." pour afficher tout l'historique de consultation.
// @author       Florian Ronez + ChatGPT
// @match        https://secure.weda.fr/FolderMedical/PatientViewForm.aspx*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const LOG_PREFIX = '[WEDA-HISTORIQUE-AUTO]';
    const BUTTON_SELECTOR = '#ContentPlaceHolder1_HistoriqueUCForm1_ButtonSuiteWeda';
    const CLICK_DELAY_MS = 800;
    const MAX_CLICKS_PER_PATIENT = 30;
    const STATE_TTL_MS = 10 * 60 * 1000;
    const RESTORE_SCROLL_DELAY_MS = 250;
    const STORAGE_PREFIX = 'auto_weda_deplier_historique_';

    let clickScheduled = false;
    let clickDoneOnThisPage = false;

    function log(...args) {
        console.info(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function getPatientKey() {
        try {
            const url = new URL(location.href);
            const patDk = url.searchParams.get('PatDk');

            if (patDk) {
                return 'PatDk_' + patDk;
            }
        } catch (_) {}

        return location.pathname + location.search;
    }

    function getStorageKey() {
        return STORAGE_PREFIX + getPatientKey();
    }

    function readState() {
        try {
            const raw = sessionStorage.getItem(getStorageKey());
            if (!raw) return { clicks: 0, lastClickAt: 0, scrollX: 0, scrollY: 0, restoreScrollUntil: 0 };

            const state = JSON.parse(raw);
            const lastClickAt = Number(state.lastClickAt || 0);

            if (lastClickAt && Date.now() - lastClickAt > STATE_TTL_MS) {
                return { clicks: 0, lastClickAt: 0, scrollX: 0, scrollY: 0, restoreScrollUntil: 0 };
            }

            return {
                clicks: Number(state.clicks || 0),
                lastClickAt,
                scrollX: Number(state.scrollX || 0),
                scrollY: Number(state.scrollY || 0),
                restoreScrollUntil: Number(state.restoreScrollUntil || 0)
            };
        } catch (_) {
            return { clicks: 0, lastClickAt: 0, scrollX: 0, scrollY: 0, restoreScrollUntil: 0 };
        }
    }

    function writeState(state) {
        try {
            sessionStorage.setItem(getStorageKey(), JSON.stringify(state));
        } catch (_) {}
    }

    function clearState() {
        try {
            sessionStorage.removeItem(getStorageKey());
        } catch (_) {}
    }

    function isVisible(element) {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findSuiteButton() {
        const button = document.querySelector(BUTTON_SELECTOR);

        if (!button || !isVisible(button) || button.disabled) {
            return null;
        }

        return button;
    }

    function clickSuiteButton(button) {
        if (!button || clickDoneOnThisPage) return false;

        const state = readState();

        if (state.clicks >= MAX_CLICKS_PER_PATIENT) {
            warn('Limite de clics atteinte, arret de securite.', {
                max: MAX_CLICKS_PER_PATIENT,
                patientKey: getPatientKey()
            });
            return false;
        }

        clickDoneOnThisPage = true;

        writeState({
            clicks: state.clicks + 1,
            lastClickAt: Date.now(),
            scrollX: window.scrollX || window.pageXOffset || 0,
            scrollY: window.scrollY || window.pageYOffset || 0,
            restoreScrollUntil: Date.now() + STATE_TTL_MS
        });

        log('Clic automatique sur le bouton Suite...', {
            click: state.clicks + 1,
            max: MAX_CLICKS_PER_PATIENT
        });

        button.click();
        return true;
    }

    function scheduleAutoClick() {
        if (clickScheduled || clickDoneOnThisPage) return;

        const button = findSuiteButton();

        if (!button) {
            clearState();
            return;
        }

        clickScheduled = true;

        window.setTimeout(() => {
            clickScheduled = false;
            clickSuiteButton(findSuiteButton());
        }, CLICK_DELAY_MS);
    }

    function startObserver() {
        const observer = new MutationObserver(scheduleAutoClick);

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'disabled']
        });
    }

    function restoreScrollPosition() {
        const state = readState();

        if (!state.restoreScrollUntil || Date.now() > state.restoreScrollUntil) {
            return;
        }

        const restore = () => {
            window.scrollTo(state.scrollX || 0, state.scrollY || 0);
        };

        restore();
        window.setTimeout(restore, RESTORE_SCROLL_DELAY_MS);
    }

    restoreScrollPosition();
    scheduleAutoClick();
    startObserver();
    log('Script actif.');
})();
