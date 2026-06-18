// ==UserScript==
// @name         Connecteur Heidi Health vers WEDA
// @namespace    http://tampermonkey.net/
// @version      7.86
// @description  PageUp : lance Heidi + récupération du contexte. PageDown : transfert WEDA. Remplit constantes, suivis structurés, ajoute les étiquettes WEDA, contrôle qualité, notifications renforcées, retour accueil direct et fermeture accélérée. + DEBUG
// @match        https://*/*
// @exclude      https://secure.weda.fr/FolderMedical/HprimForm.aspx*
// @exclude      https://secure.weda.fr/foldermedical/hprimform.aspx*
// @all-frames   true
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        unsafeWindow
// @grant        GM_listValues
// ==/UserScript==

(function () {
    'use strict';

    /************************************************************
     * CONFIGURATION
     ************************************************************/

    const VERSION_AUTO_HH = '7.86';

    const CLE_SIGNAL = 'auto_hh_signal_stable_v768';
    const CLE_SIGNAL_LEGACY = 'auto_hh_signal_stable';
    const CLE_SIGNAL_LEGACY_V767 = 'auto_hh_signal_stable_v767';
    const CLE_LOGS_DEBUG = 'auto_hh_debug_logs_stable';
    const CLE_WEDA_CONNECTEUR_ACTIF = 'auto_hh_weda_connector_enabled_stable';
    const CLE_WEDA_PANEL_POSITION = 'auto_hh_weda_panel_position_stable';
    const CLE_LAST_WEDA_URL = 'auto_hh_last_weda_url_stable';
    const CLE_RETOUR_ACCUEIL_ORIGINE_WEDA = 'auto_hh_weda_return_home_request_stable';
    const CLE_RETOUR_ACCUEIL_ORIGINE_WEDA_TRAITE = 'auto_hh_weda_return_home_request_done_stable';
    const CLE_TRANSFER_PREFIX = 'auto_hh_transfer_job_stable_';
    const CLE_CONTEXT_PREFIX = 'auto_hh_context_job_stable_';
    const CLE_SESSION_JOB = 'auto_hh_weda_worker_job_stable';
    const CLE_WEDA_WORKER_OPEN_REQUEST = 'auto_hh_weda_worker_open_request_stable';
    const CLE_TAG_LOCK_PREFIX = 'auto_hh_tag_lock_stable_';
    const CLE_NOTIFICATION = 'auto_hh_notification_stable';
    const CLE_STATUT_INTERFACE = 'auto_hh_interface_status_stable_v776';
    const CLE_STATUT_INTERFACE_LEGACY = 'auto_hh_interface_status_stable';
    const CLE_LAST_REPORT = 'auto_hh_last_report_stable';
    const CLE_RACCOURCI_GLOBAL_LOCK = 'auto_hh_shortcut_global_lock_stable';
    const CLE_HEIDI_SIGNAL_CLAIM_PREFIX = 'auto_hh_heidi_signal_claim_stable_';
    const CLE_HEIDI_LAUNCH_LOCK_PREFIX = 'auto_hh_heidi_launch_lock_stable_';
    const CLE_HEIDI_NEW_SESSION_CLICK_LOCK_PREFIX = 'auto_hh_heidi_new_session_click_lock_stable_';
    const CLE_HEIDI_WORKER_ACTIF = 'auto_hh_heidi_worker_actif_stable';
    const CLE_HEIDI_WORKER_PRESENCE_PREFIX = 'auto_hh_heidi_worker_presence_stable_';
    const CLE_HEIDI_WORKER_CLOSE_REQUEST = 'auto_hh_heidi_worker_close_request_stable';
    const CLE_SESSION_HEIDI_WORKER = 'auto_hh_heidi_worker_id_stable';
    const CLE_SESSION_WEDA_HEIDI_WORKER = 'auto_hh_weda_dedicated_heidi_worker_id_stable';
    const CLE_SESSION_HEIDI_ID = 'auto_hh_heidi_session_id_stable';
    const CLE_SESSION_HEIDI_URL = 'auto_hh_heidi_session_url_stable';
    const CLE_SESSION_HEIDI_SOURCE = 'auto_hh_heidi_session_source_stable';
    const CLE_SESSION_HEIDI_LOCK_ID = 'auto_hh_heidi_session_lock_id_stable';
    const CLE_SESSION_HEIDI_LOCK_URL = 'auto_hh_heidi_session_lock_url_stable';
    const CLE_SESSION_HEIDI_LOCK_CREATED_AT = 'auto_hh_heidi_session_lock_created_at_stable';
    const CLE_SESSION_HEIDI_LOCK_PHASE = 'auto_hh_heidi_session_lock_phase_stable';
    const CLE_HEIDI_BIO_TAB_ROLE = 'wedaBioHeidiContext.heidiTabRole';
    const PARAM_WORKER_HEIDI = 'AUTO_HH_HEIDI_WORKER';
    const PARAM_HEIDI_BIO_JOB = 'wedaBioJob';
    const URL_HEIDI_DEDIEE = 'https://scribe.heidihealth.com/';

    const SELECTEUR_NOUVELLE_SESSION = 'button[data-testid="sessions-panel-action-new-session"]';
    const SELECTEUR_TEXTE_HEIDI = '#template-block-editor-content > div';
    const SELECTEUR_BOUTON_ARRET_HEIDI = 'button[data-testid="stop-recording-button"], [data-testid="stop-recording-button"]';

    const TEXTE_BOUTON_TRANSCRIPTION = 'Transcription';
    const TEXTE_BOUTON_ARRET_TRANSCRIPTION = 'Arrêter la transcription';
    const TEXTE_BOUTON_COPIER = 'Copier';

    const PAGE_WEDA_CONSULTATION = '/foldermedical/consultationform.aspx';
    const PAGE_WEDA_PATIENT = '/foldermedical/patientviewform.aspx';
    const PAGE_WEDA_FSE = '/vitalzen/fse.aspx';
    const PAGE_WEDA_HPRIM = '/foldermedical/hprimform.aspx';
    const SELECTEUR_NOUVELLE_CONSULTATION_WEDA = '#ContentPlaceHolder1_MenuNavigate\\:submenu\\:2 > li:nth-child(1) > a';

    const SELECTEUR_IMAGE_SAUVEGARDE_WEDA = '#ContentPlaceHolder1_EvenementUcForm1_MenuNavigate > ul > li > a > img';
    const SELECTEUR_IMAGE_ACCUEIL_WEDA = 'img[src*="W_BLEU.png"], img[src*="W_BLEU"], img[src*="Weda"], img[src*="weda"]';
    const SELECTEUR_BOUTON_AUTOSAVE_WEDA = '#ButtonAutoSave';

    const POSTBACK_MENU_EVENTTARGET_WEDA = 'ctl00$ContentPlaceHolder1$EvenementUcForm1$MenuNavigate';
    const POSTBACK_RETOUR_ACCUEIL_WEDA = '0';
    const POSTBACK_MENU_GENERAL_EVENTTARGET_WEDA = 'ctl00$ContentPlaceHolder1$MenuNavigate';
    const POSTBACK_RETOUR_ACCUEIL_GENERAL_WEDA = '0\\0';
    const POSTBACK_RETOUR_ACCUEIL_GENERAL_ALT_WEDA = '0';

    const PHRASE_SECURITE_MEDICO_LEGALE = 'Aucun signe de gravité, Explications claires données au patient. Prise en charge expliquée et acceptée par le patient.';

    const SELECTEUR_POIDS_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_0';
    const SELECTEUR_TAILLE_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_1';
    const SELECTEUR_TENSION_SYS_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_3';
    const SELECTEUR_TENSION_DIA_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_4';
    const SELECTEUR_TENSION_AUTOMESURE_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_5';
    const SELECTEUR_TEMPERATURE_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_6';
    const SELECTEUR_TABAC_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_7';
    const SELECTEUR_ALCOOL_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_8';
    const SELECTEUR_EXAMEN_PIEDS_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_9';
    const SELECTEUR_HEMOCULT_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_10';
    const SELECTEUR_FROTTIS_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_11';
    const SELECTEUR_MAMMOGRAPHIE_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_12';
    const SELECTEUR_DENTISTE_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_13';
    const SELECTEUR_DTP_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_14';
    const SELECTEUR_PAPILLOMAVIRUS_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_15';
    const SELECTEUR_FOND_OEIL_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_20';
    const SELECTEUR_CARDIOLOGUE_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_21';
    const SELECTEUR_MMS_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_23';
    const SELECTEUR_MADRS_WEDA = '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_24';

    const SELECTEUR_BOUTON_PANEL_ETIQUETTE_WEDA = '#ContentPlaceHolder1_EvenementUcForm1_ButtonStatEtiquette';
    const SELECTEUR_GRID_GLOSSAIRES_WEDA = '#ContentPlaceHolder1_EvenementUcForm1_GlossairesGrid';

    const DELAI_APRES_NOUVELLE_SESSION_MS = 900;
    const TIMEOUT_BOUTON_MS = 20000;
    const TIMEOUT_GENERATION_HEIDI_MS = 60000;
    const TIMEOUT_WEDA_CHAMP_MS = 45000;
    const TIMEOUT_CHAMP_MESURE_MS = 4500;
    const TIMEOUT_MENU_ETIQUETTES_MS = 4000;
    const DELAI_ANTI_DOUBLE_DECLENCHEMENT_MS = 1800;

    const DELAI_APRES_AJOUT_ETIQUETTE_MS = 450;
    const DELAI_LOCK_ETIQUETTES_MS = 12000;
    const DELAI_APRES_SAVE_AVANT_FERMETURE_MS = 1200;
    const DELAI_DIRECT_APRES_DERNIER_TAG_MS = 0;

    const TIMEOUT_ATTENTE_FIN_POSTBACK_TAG_MS = 2500;
    const TIMEOUT_CHAMP_SECURITE_MEDICO_LEGALE_MS = 3500;

    const ETIQUETTES_WEDA_DISPONIBLES = [
        'Alcool',
        'Angine',
        'ASALEE',
        'Chute',
        'CoViD',
        'DT2',
        'ETP',
        'HTA',
        'IC',
        'Ongle incarné',
        'Soins palliatifs',
        'Syndrome dépressif',
        'Tabac'
    ];

    const NOMBRE_MAX_ETIQUETTES_WEDA = Infinity;
    const CLE_WEDA_ACTIVE_SNAPSHOT = 'auto_hh_weda_active_snapshot_stable';
    const NOMBRE_MAX_LOGS_DEBUG = 700;

    const DELAI_STABILITE_CONTENU_HEIDI_MS = 6000;
const INTERVALLE_STABILITE_CONTENU_HEIDI_MS = 500;
const DELAI_MIN_APRES_BOUTON_COPIER_HEIDI_MS = 1500;

    const CLE_ACK_HEIDI = 'auto_hh_heidi_ack_stable';
const DELAI_SIGNAL_INITIAL_RECENT_HEIDI_MS = 90000;
const DELAI_TRAITEMENT_SIGNAL_INITIAL_HEIDI_MS = 500;
const DELAIS_RELANCE_SIGNAL_HEIDI_MS = [250, 750, 1500, 3000, 6000, 10000];
const INTERVALLE_POLL_SIGNAL_HEIDI_MS = 150;
const DELAI_BLOCAGE_DOUBLE_STOP_TRANSFER_MS = 45000;
const DELAI_CONFIRMATION_TRANSCRIPTION_HEIDI_MS = 12000;
const INTERVALLE_CONFIRMATION_TRANSCRIPTION_HEIDI_MS = 250;
const DELAI_DOUBLE_CONFIRMATION_TRANSCRIPTION_HEIDI_MS = 650;
const DELAI_CORRECTION_STATUT_REC_HEIDI_MS = 3500;
const DELAI_MAX_STATUT_DEMARRAGE_HEIDI_MS = 18000;
const INTERVALLE_SURVEILLANCE_STATUT_HEIDI_MS = 1500;
const DELAI_VERROU_RACCOURCI_GLOBAL_MS = 2500;
const DELAI_EXPIRATION_HEIDI_WORKER_MS = 8 * 60 * 60 * 1000;
const DELAI_CLAIM_SIGNAL_HEIDI_MS = 120000;
const DELAI_VERROU_LANCEMENT_HEIDI_MS = 120000;
const DELAI_VERROU_CLIC_NOUVELLE_SESSION_HEIDI_MS = 10000;
const DELAI_REPRISE_WORKER_WEDA_MS = 120000;
const DELAI_VERIFICATION_OUVERTURE_CONSULTATION_WEDA_MS = 5000;
const NOMBRE_MAX_TENTATIVES_OUVERTURE_CONSULTATION_WEDA = 2;
const ENTETE_CONTEXTE_WEDA_SECURITE = 'Contexte WEDA patient';



    /************************************************************
     * CONTEXTE
     ************************************************************/

    const HOST = location.hostname;
    const EST_WEDA = HOST === 'secure.weda.fr' || HOST.endsWith('.weda.fr');
    const EST_HEIDI = HOST === 'scribe.heidihealth.com';

    if (!EST_WEDA && !EST_HEIDI) return;

    if (EST_WEDA && getHrefLower().includes(PAGE_WEDA_HPRIM)) {
        try { console.info('[AUTO-HH] Connecteur désactivé sur HprimForm.aspx.'); } catch (e) {}
        return;
    }

    if (EST_HEIDI && estOngletHeidiAnalyseBiologieAutoHH()) {
        try { console.info('[AUTO-HH] Onglet Heidi réservé au script Analyse Biologies : connecteur désactivé sur cet onglet.'); } catch (e) {}
        return;
    }

    function estOngletHeidiAnalyseBiologieAutoHH() {
        if (!EST_HEIDI) return false;
        try {
            const params = new URLSearchParams(location.search || '');
            if (params.has(PARAM_HEIDI_BIO_JOB)) return true;
        } catch (e) {}
        try {
            if (sessionStorage.getItem(CLE_HEIDI_BIO_TAB_ROLE) === 'biology') return true;
        } catch (e) {}
        return false;
    }

    function isTopFrame() {
        try { return window.top === window.self; } catch (e) { return false; }
    }

    function getTopHref() {
        try { return window.top.location.href; } catch (e) { return location.href; }
    }

    function getHrefLower() {
        return String(getTopHref() || '').toLowerCase();
    }

    function getParamPatDkDepuisUrl(urlBrute) {
        try {
            const url = new URL(urlBrute);
            for (const [key, value] of url.searchParams.entries()) {
                if (String(key).toLowerCase() === 'patdk' && value) return value;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function estPageAccueilPatientWeda() {
        return EST_WEDA && getHrefLower().includes(PAGE_WEDA_PATIENT);
    }

    function estPageConsultationWeda() {
        return EST_WEDA && getHrefLower().includes(PAGE_WEDA_CONSULTATION);
    }

    function estPageFseWedaAvecPatient() {
        if (!EST_WEDA) return false;
        const href = getTopHref();
        const hrefLower = String(href || '').toLowerCase();
        return hrefLower.includes(PAGE_WEDA_FSE) && !!getParamPatDkDepuisUrl(href);
    }

    function estPageErreurWeda() {
        return EST_WEDA && getHrefLower().includes('/error.aspx');
    }

    function getUrlFseCouranteSiValide() {
        return estPageFseWedaAvecPatient() ? getTopHref().split('#')[0] : null;
    }

    function construireUrlPatientDepuisUrl(urlBrute) {
        try {
            const url = new URL(urlBrute);
            const patDk = getParamPatDkDepuisUrl(urlBrute);
            if (!patDk) return null;
            return url.origin + '/FolderMedical/PatientViewForm.aspx?PatDk=' + encodeURIComponent(patDk);
        } catch (e) {
            return null;
        }
    }

    function getWedaUrlPourTransfertDepuisContexte() {
        if (!EST_WEDA) return GM_getValue(CLE_LAST_WEDA_URL, null);

        const href = getTopHref();
        const hrefLower = String(href || '').toLowerCase();

        if (hrefLower.includes(PAGE_WEDA_FSE)) return href;

        if (hrefLower.includes(PAGE_WEDA_PATIENT) || hrefLower.includes(PAGE_WEDA_CONSULTATION)) return href;

        return GM_getValue(CLE_LAST_WEDA_URL, null) || href;
    }

    /************************************************************
     * ÉTAT
     ************************************************************/

    let dernierDeclenchement = 0;
    let dernierSignalTraiteHeidi = 0;
let derniereCleSignalTraiteHeidi = '';
let derniereCleSignalIgnoreHeidi = '';
let instanceHeidiAutoHH = 'heidi_instance_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    let derniereNotificationGlobaleTraitee = 0;
    let automatisationEnCours = false;
    let stopTransferHeidiEnCours = false;
    let dernierSignalStopTransferEnvoye = 0;
    let dernierStopTransferHeidiTraite = 0;
    let derniereDemandeFermetureHeidiTraitee = 0;
    let derniereDemandeRetourAccueilOrigineTraitee = '';
    let fermetureHeidiLocaleDemandee = false;
    let dernierEvenementClavierTraite = 0;
    let derniereCorrectionStatutHeidi = 0;
    let badgesPhaseCritiqueSuspendus = false;
    let badgeAutoHHTimer = null;

    const ongletsWedaWorkers = {};
    const ongletsHeidiDedies = {};

    /************************************************************
     * OUTILS GÉNÉRAUX
     ************************************************************/

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function resumerValeurLogAutoHH(valeur, profondeur = 0) {
        if (valeur == null) return valeur;
        if (typeof valeur === 'string') return valeur.length > 500 ? valeur.slice(0, 500) + '...' : valeur;
        if (typeof valeur === 'number' || typeof valeur === 'boolean') return valeur;
        if (typeof valeur === 'function') return '[function]';
        if (typeof Element !== 'undefined' && valeur instanceof Element) {
            return {
                tag: String(valeur.tagName || '').toLowerCase(),
                id: valeur.id || null,
                testId: valeur.getAttribute?.('data-testid') || null,
                text: String(valeur.innerText || valeur.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
            };
        }
        if (profondeur >= 3) return '[object]';
        if (Array.isArray(valeur)) return valeur.slice(0, 20).map(item => resumerValeurLogAutoHH(item, profondeur + 1));
        if (typeof valeur === 'object') {
            const resultat = {};
            Object.keys(valeur).slice(0, 40).forEach(key => {
                if (key === 'html' || key === 'texte' || key === 'contexte') {
                    resultat[key + 'Length'] = String(valeur[key] || '').length;
                    resultat[key + 'Preview'] = String(valeur[key] || '').slice(0, 180);
                } else {
                    resultat[key] = resumerValeurLogAutoHH(valeur[key], profondeur + 1);
                }
            });
            return resultat;
        }
        return String(valeur);
    }

    function ajouterLogAutoHH(type, details = {}) {
        const entree = {
            ts: new Date().toISOString(),
            t: Date.now(),
            type: String(type || 'log'),
            version: VERSION_AUTO_HH,
            host: HOST,
            topFrame: isTopFrame(),
            visibility: (() => { try { return document.visibilityState; } catch (e) { return null; } })(),
            href: String(location.href || '').slice(0, 500),
            details: resumerValeurLogAutoHH(details)
        };

        try {
            const logs = GM_getValue(CLE_LOGS_DEBUG, []);
            const liste = Array.isArray(logs) ? logs : [];
            liste.push(entree);
            while (liste.length > NOMBRE_MAX_LOGS_DEBUG) liste.shift();
            GM_setValue(CLE_LOGS_DEBUG, liste);
        } catch (e) {}

        try { console.info('[AUTO-HH LOG]', entree.type, entree); } catch (e) {}
        return entree;
    }

    function getLogsAutoHH() {
        try {
            const logs = GM_getValue(CLE_LOGS_DEBUG, []);
            return Array.isArray(logs) ? logs : [];
        } catch (e) {
            return [];
        }
    }

    function connecteurWedaActif() {
        if (!EST_WEDA) return true;
        try { return GM_getValue(CLE_WEDA_CONNECTEUR_ACTIF, true) !== false; } catch (e) { return true; }
    }

    function definirConnecteurWedaActif(actif) {
        try { GM_setValue(CLE_WEDA_CONNECTEUR_ACTIF, !!actif); } catch (e) {}
        ajouterLogAutoHH('weda-ui-toggle', { actif: !!actif });
        return !!actif;
    }

    async function copierLogsAutoHH() {
        const logs = getLogsAutoHH();
        const texte = JSON.stringify({
            generatedAt: new Date().toISOString(),
            version: VERSION_AUTO_HH,
            current: {
                host: HOST,
                href: location.href,
                topFrame: isTopFrame()
            },
            logs
        }, null, 2);

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(texte);
                return true;
            }
        } catch (e) {}

        try {
            const textarea = document.createElement('textarea');
            textarea.value = texte;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            textarea.remove();
            return ok;
        } catch (e) {
            return false;
        }
    }

    function attendreParVerification(getterFunction, conditionFunction, nom, timeoutMs, intervalMs) {
        const start = Date.now();
        const intervalle = intervalMs || 80;

        return new Promise(resolve => {
            const verifier = () => {
                let element = null;
                try { element = getterFunction(); } catch (e) { element = null; }

                if (conditionFunction(element)) {
                    console.info('[AUTO-HH] Élément trouvé rapidement :', nom, element);
                    resolve(element);
                    return;
                }

                if (Date.now() - start > timeoutMs) {
                    console.warn('[AUTO-HH] Élément introuvable après délai :', nom);
                    resolve(null);
                    return;
                }

                setTimeout(verifier, intervalle);
            };

            verifier();
        });
    }

    function normaliserTexte(texte) {
        return String(texte || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/œ/g, 'oe')
            .replace(/Œ/g, 'oe')
            .toLowerCase()
            .replace(/[’']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function nettoyerTexte(texte) {
        return String(texte || '')
            .replace(/\r\n/g, '\n')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{4,}/g, '\n\n\n')
            .trim();
    }

    function normaliserNombreDecimalPourWeda(valeurBrute) {
        let valeur = String(valeurBrute || '').trim().replace('.', ',');
        valeur = valeur.replace(/,(\d*?)0+$/, function (_m, decimales) {
            return decimales ? ',' + decimales : '';
        });
        valeur = valeur.replace(/,$/, '');
        return valeur;
    }

    function pad2(nombre) {
        return String(nombre).padStart(2, '0');
    }

    function isVisible(element) {
        if (!element) return false;

        if (element.tagName && element.tagName.toLowerCase() === 'option') {
            return !!element.parentElement && isVisible(element.parentElement);
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            !element.disabled &&
            element.getAttribute('aria-disabled') !== 'true'
        );
    }

    function afficherBadge(message, duree = 4000, options = {}) {
        try {
            if (!isTopFrame() || !document.body) return;

            const force = !!options.force;
            const messageTexte = String(message || '');

            if (
                badgesPhaseCritiqueSuspendus &&
                !force &&
                !messageTexte.includes('Toutes les tâches sont terminées')
            ) {
                console.info('[AUTO-HH] Badge masqué pendant phase critique :', messageTexte);
                return;
            }

            let badge = document.getElementById('auto-hh-badge-unique');

            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'auto-hh-badge-unique';
                badge.style.position = 'fixed';
                badge.style.left = '24px';
                badge.style.bottom = '24px';
                badge.style.zIndex = '999999';
                badge.style.background = '#0b2a4a';
                badge.style.color = '#ffffff';
                badge.style.padding = '16px 22px';
                badge.style.borderRadius = '14px';
                badge.style.fontSize = '18px';
                badge.style.fontWeight = '700';
                badge.style.lineHeight = '1.35';
                badge.style.fontFamily = 'Arial, sans-serif';
                badge.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
                badge.style.border = '1px solid rgba(255,255,255,0.22)';
                badge.style.maxWidth = '560px';
                badge.style.minWidth = '300px';
                badge.style.pointerEvents = 'none';
                document.body.appendChild(badge);
            }

            badge.textContent = messageTexte;
            badge.style.display = 'block';
            badge.style.opacity = '1';

            if (badgeAutoHHTimer) clearTimeout(badgeAutoHHTimer);

            badgeAutoHHTimer = setTimeout(() => {
                try { badge.remove(); } catch (e) {}
                badgeAutoHHTimer = null;
            }, duree);
        } catch (e) {}
    }

    function initialiserPanneauDebugWedaAutoHH() {
        try {
            if (!EST_WEDA || !isTopFrame() || !document.body) return;
            if (document.getElementById('auto-hh-weda-panel')) return;

            const panneau = document.createElement('div');
            panneau.id = 'auto-hh-weda-panel';
            panneau.style.position = 'fixed';
            panneau.style.right = '14px';
            panneau.style.bottom = '14px';
            panneau.style.zIndex = '2147483647';
            panneau.style.display = 'flex';
            panneau.style.alignItems = 'center';
            panneau.style.gap = '6px';
            panneau.style.padding = '7px';
            panneau.style.borderRadius = '9px';
            panneau.style.border = '1px solid rgba(255,255,255,0.22)';
            panneau.style.background = 'rgba(11, 42, 74, 0.88)';
            panneau.style.color = '#ffffff';
            panneau.style.boxShadow = '0 8px 22px rgba(0,0,0,0.28)';
            panneau.style.fontFamily = 'Arial, sans-serif';
            panneau.style.fontSize = '12px';
            panneau.style.lineHeight = '1';
            panneau.style.opacity = '0.82';

            try { GM_setValue(CLE_WEDA_CONNECTEUR_ACTIF, true); } catch (e) {}

            function limiterPositionPanneau(left, top) {
                const marge = 8;
                const rect = panneau.getBoundingClientRect();
                const largeur = rect.width || 280;
                const hauteur = rect.height || 44;
                const maxLeft = Math.max(marge, window.innerWidth - largeur - marge);
                const maxTop = Math.max(marge, window.innerHeight - hauteur - marge);

                return {
                    left: Math.min(Math.max(marge, Number(left) || marge), maxLeft),
                    top: Math.min(Math.max(marge, Number(top) || marge), maxTop)
                };
            }

            function appliquerPositionPanneau(position) {
                const left = Number(position && position.left);
                const top = Number(position && position.top);
                if (!Number.isFinite(left) || !Number.isFinite(top)) return false;

                const positionLimitee = limiterPositionPanneau(left, top);
                panneau.style.left = positionLimitee.left + 'px';
                panneau.style.top = positionLimitee.top + 'px';
                panneau.style.right = 'auto';
                panneau.style.bottom = 'auto';
                return true;
            }

            function memoriserPositionPanneau() {
                const rect = panneau.getBoundingClientRect();
                const position = limiterPositionPanneau(rect.left, rect.top);
                try {
                    GM_setValue(CLE_WEDA_PANEL_POSITION, {
                        left: position.left,
                        top: position.top,
                        updatedAt: Date.now()
                    });
                } catch (e) {}
                return position;
            }

            const poignee = document.createElement('span');
            poignee.textContent = '::';
            poignee.title = 'Déplacer le panneau';
            poignee.style.display = 'inline-flex';
            poignee.style.alignItems = 'center';
            poignee.style.justifyContent = 'center';
            poignee.style.minWidth = '14px';
            poignee.style.minHeight = '28px';
            poignee.style.color = '#cfe8ff';
            poignee.style.fontWeight = '700';
            poignee.style.cursor = 'grab';
            poignee.style.userSelect = 'none';
            poignee.style.touchAction = 'none';

            let dragPanneau = null;

            poignee.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();

                const rect = panneau.getBoundingClientRect();
                dragPanneau = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    left: rect.left,
                    top: rect.top
                };

                try { poignee.setPointerCapture(event.pointerId); } catch (e) {}
                poignee.style.cursor = 'grabbing';
                ajouterLogAutoHH('weda-ui-panel-drag-start', { left: rect.left, top: rect.top });
            }, true);

            poignee.addEventListener('pointermove', event => {
                if (!dragPanneau || event.pointerId !== dragPanneau.pointerId) return;
                event.preventDefault();
                event.stopPropagation();

                const position = limiterPositionPanneau(
                    dragPanneau.left + event.clientX - dragPanneau.startX,
                    dragPanneau.top + event.clientY - dragPanneau.startY
                );

                panneau.style.left = position.left + 'px';
                panneau.style.top = position.top + 'px';
                panneau.style.right = 'auto';
                panneau.style.bottom = 'auto';
            }, true);

            function terminerDeplacementPanneau(event) {
                if (!dragPanneau || event.pointerId !== dragPanneau.pointerId) return;
                event.preventDefault();
                event.stopPropagation();

                const position = memoriserPositionPanneau();
                try { poignee.releasePointerCapture(event.pointerId); } catch (e) {}
                poignee.style.cursor = 'grab';
                dragPanneau = null;
                ajouterLogAutoHH('weda-ui-panel-drag-end', position);
            }

            poignee.addEventListener('pointerup', terminerDeplacementPanneau, true);
            poignee.addEventListener('pointercancel', terminerDeplacementPanneau, true);

            window.addEventListener('resize', () => {
                try {
                    const positionConnue = GM_getValue(CLE_WEDA_PANEL_POSITION, null);
                    if (!positionConnue) return;
                    const position = memoriserPositionPanneau();
                    appliquerPositionPanneau(position);
                } catch (e) {}
            }, true);

            const blocVersion = document.createElement('span');
            blocVersion.style.display = 'inline-flex';
            blocVersion.style.flexDirection = 'column';
            blocVersion.style.alignItems = 'center';
            blocVersion.style.justifyContent = 'center';
            blocVersion.style.minWidth = '58px';
            blocVersion.style.gap = '3px';
            blocVersion.style.userSelect = 'none';

            const version = document.createElement('span');
            version.textContent = 'v' + VERSION_AUTO_HH;
            version.style.minWidth = '34px';
            version.style.fontWeight = '700';
            version.style.textAlign = 'center';
            version.style.color = '#cfe8ff';

            const statutInterface = document.createElement('span');
            statutInterface.id = 'auto-hh-weda-panel-status';
            statutInterface.textContent = 'PRÊT';
            statutInterface.title = 'Statut Auto-HH';
            statutInterface.style.display = 'inline-block';
            statutInterface.style.minWidth = '54px';
            statutInterface.style.textAlign = 'center';
            statutInterface.style.font = '700 9px Arial, sans-serif';
            statutInterface.style.letterSpacing = '0.4px';
            statutInterface.style.color = '#cfe8ff';
            statutInterface.style.opacity = '0.92';
            statutInterface.style.whiteSpace = 'nowrap';
            statutInterface.style.textTransform = 'uppercase';

            blocVersion.appendChild(version);
            blocVersion.appendChild(statutInterface);

            function creerBouton(libelle) {
                const bouton = document.createElement('button');
                bouton.type = 'button';
                bouton.textContent = libelle;
                bouton.style.border = '1px solid rgba(255,255,255,0.35)';
                bouton.style.background = 'rgba(255,255,255,0.12)';
                bouton.style.color = '#ffffff';
                bouton.style.borderRadius = '7px';
                bouton.style.padding = '6px 8px';
                bouton.style.font = '700 12px Arial, sans-serif';
                bouton.style.cursor = 'pointer';
                bouton.style.whiteSpace = 'nowrap';
                bouton.style.minHeight = '28px';
                return bouton;
            }

            const boutonLancer = creerBouton('Lancer');
            const boutonArreter = creerBouton('Arrêter');
            const boutonLogs = creerBouton('Copier logs');

            boutonLancer.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();
                ajouterLogAutoHH('weda-ui-start-click', { href: getTopHref() });
                afficherBadge('AUTO-HH : lancement demandé', 2500, { force: true });
                await executerActionConnecteurAutoHH('start', 'bouton_lancer_weda', { origine: 'panneau_weda' });
            }, true);

            boutonArreter.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();
                ajouterLogAutoHH('weda-ui-stop-click', { href: getTopHref() });
                afficherBadge('AUTO-HH : arrêt/transfert demandé', 2500, { force: true });
                await executerActionConnecteurAutoHH('stop_transfer', 'bouton_arreter_weda', { origine: 'panneau_weda' });
            }, true);

            boutonLogs.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();
                ajouterLogAutoHH('weda-ui-copy-logs-click', { logsCount: getLogsAutoHH().length });
                const ok = await copierLogsAutoHH();
                afficherBadge(ok ? 'AUTO-HH : logs copiés' : 'AUTO-HH : copie des logs impossible', ok ? 3000 : 7000, { force: true });
            }, true);

            panneau.appendChild(poignee);
            panneau.appendChild(blocVersion);
            panneau.appendChild(boutonLancer);
            panneau.appendChild(boutonArreter);
            panneau.appendChild(boutonLogs);
            document.body.appendChild(panneau);
            mettreAJourStatutPanneauAutoHH(getStatutInterfaceAutoHH());

            try {
                appliquerPositionPanneau(GM_getValue(CLE_WEDA_PANEL_POSITION, null));
            } catch (e) {}

            ajouterLogAutoHH('weda-ui-panel-ready', {
                version: VERSION_AUTO_HH,
                href: getTopHref()
            });
        } catch (e) {
            console.warn('[AUTO-HH] Panneau debug WEDA impossible à initialiser :', e);
        }
    }

    function initialiserCompatibiliteDragInfoFlottanteWedaAutoHH() {
        try {
            if (!EST_WEDA || !isTopFrame() || !document.body) return;

            const SELECTEUR_WEDA_INFO_FLOTTANTE = '#ContentPlaceHolder1_HistoriqueUCForm1_PanelInfoFlottante';
            const SELECTEUR_WEDA_DRAG_INFO_FLOTTANTE = '#ContentPlaceHolder1_HistoriqueUCForm1_PanelDragInfoFlottante';
            let timerCompatInfoFlottante = null;

            function getPointEventAutoHH(event) {
                const touch = event && event.touches && event.touches[0] ? event.touches[0] :
                    (event && event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : null);
                return {
                    clientX: touch ? touch.clientX : Number(event && event.clientX),
                    clientY: touch ? touch.clientY : Number(event && event.clientY)
                };
            }

            function limiterPositionInfoFlottanteAutoHH(panel, left, top, modePosition) {
                const marge = 4;
                const rect = panel.getBoundingClientRect();
                const largeur = rect.width || Number(panel.offsetWidth) || 200;
                const hauteur = rect.height || Number(panel.offsetHeight) || 80;
                const scrollX = window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
                const scrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
                const baseX = modePosition === 'fixed' ? 0 : scrollX;
                const baseY = modePosition === 'fixed' ? 0 : scrollY;
                const maxLeft = Math.max(baseX + marge, baseX + window.innerWidth - largeur - marge);
                const maxTop = Math.max(baseY + marge, baseY + window.innerHeight - Math.min(hauteur, window.innerHeight - 2 * marge) - marge);

                return {
                    left: Math.min(Math.max(baseX + marge, Number(left) || baseX + marge), maxLeft),
                    top: Math.min(Math.max(baseY + marge, Number(top) || baseY + marge), maxTop)
                };
            }

            function attacherDragInfoFlottanteAutoHH() {
                try {
                    const panel = document.querySelector(SELECTEUR_WEDA_INFO_FLOTTANTE);
                    const poignee = document.querySelector(SELECTEUR_WEDA_DRAG_INFO_FLOTTANTE);
                    if (!panel || !poignee) return;
                    if (poignee.dataset && poignee.dataset.autoHhCompatDragInfoFlottante === '1') return;
                    if (poignee.dataset) poignee.dataset.autoHhCompatDragInfoFlottante = '1';

                    try {
                        poignee.style.cursor = 'move';
                        poignee.style.userSelect = 'none';
                        poignee.title = poignee.title || 'Déplacer la fenêtre WEDA';
                    } catch (e) {}

                    let dragInfoFlottante = null;

                    function debutDragInfoFlottante(event) {
                        try {
                            if (event && typeof event.button === 'number' && event.button !== 0) return;
                            const point = getPointEventAutoHH(event);
                            if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;

                            const rect = panel.getBoundingClientRect();
                            const style = window.getComputedStyle ? window.getComputedStyle(panel) : null;
                            let modePosition = style && style.position ? style.position : String(panel.style.position || 'absolute');
                            if (!modePosition || modePosition === 'static') {
                                modePosition = 'absolute';
                                panel.style.position = 'absolute';
                            }

                            const scrollX = window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
                            const scrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
                            const baseLeft = modePosition === 'fixed' ? rect.left : rect.left + scrollX;
                            const baseTop = modePosition === 'fixed' ? rect.top : rect.top + scrollY;
                            const styleLeft = parseFloat(panel.style.left);
                            const styleTop = parseFloat(panel.style.top);

                            dragInfoFlottante = {
                                startX: point.clientX,
                                startY: point.clientY,
                                left: Number.isFinite(styleLeft) ? styleLeft : baseLeft,
                                top: Number.isFinite(styleTop) ? styleTop : baseTop,
                                position: modePosition
                            };

                            document.addEventListener('mousemove', deplacerInfoFlottante, true);
                            document.addEventListener('mouseup', finDragInfoFlottante, true);
                            document.addEventListener('touchmove', deplacerInfoFlottante, { capture: true, passive: false });
                            document.addEventListener('touchend', finDragInfoFlottante, true);
                            document.addEventListener('touchcancel', finDragInfoFlottante, true);

                            event.preventDefault();
                            event.stopPropagation();
                            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

                            ajouterLogAutoHH('weda-infoflottante-drag-start', {
                                left: dragInfoFlottante.left,
                                top: dragInfoFlottante.top,
                                position: dragInfoFlottante.position
                            });
                        } catch (e) {
                            ajouterLogAutoHH('weda-infoflottante-drag-start-error', { message: e && e.message ? e.message : String(e) });
                        }
                    }

                    function deplacerInfoFlottante(event) {
                        if (!dragInfoFlottante) return;
                        const point = getPointEventAutoHH(event);
                        if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;

                        const position = limiterPositionInfoFlottanteAutoHH(
                            panel,
                            dragInfoFlottante.left + point.clientX - dragInfoFlottante.startX,
                            dragInfoFlottante.top + point.clientY - dragInfoFlottante.startY,
                            dragInfoFlottante.position
                        );

                        panel.style.left = position.left + 'px';
                        panel.style.top = position.top + 'px';
                        panel.style.right = 'auto';
                        panel.style.bottom = 'auto';
                        panel.style.display = panel.style.display || 'block';

                        event.preventDefault();
                        event.stopPropagation();
                        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                    }

                    function finDragInfoFlottante(event) {
                        if (!dragInfoFlottante) return;
                        const rect = panel.getBoundingClientRect();
                        const resume = {
                            left: panel.style.left,
                            top: panel.style.top,
                            rectLeft: rect.left,
                            rectTop: rect.top
                        };

                        dragInfoFlottante = null;
                        document.removeEventListener('mousemove', deplacerInfoFlottante, true);
                        document.removeEventListener('mouseup', finDragInfoFlottante, true);
                        document.removeEventListener('touchmove', deplacerInfoFlottante, true);
                        document.removeEventListener('touchend', finDragInfoFlottante, true);
                        document.removeEventListener('touchcancel', finDragInfoFlottante, true);

                        if (event) {
                            event.preventDefault();
                            event.stopPropagation();
                            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                        }

                        ajouterLogAutoHH('weda-infoflottante-drag-end', resume);
                    }

                    poignee.addEventListener('mousedown', debutDragInfoFlottante, true);
                    poignee.addEventListener('touchstart', debutDragInfoFlottante, { capture: true, passive: false });

                    ajouterLogAutoHH('weda-infoflottante-drag-compat-ready', {
                        panel: SELECTEUR_WEDA_INFO_FLOTTANTE,
                        poignee: SELECTEUR_WEDA_DRAG_INFO_FLOTTANTE
                    });
                } catch (e) {
                    ajouterLogAutoHH('weda-infoflottante-drag-compat-error', { message: e && e.message ? e.message : String(e) });
                }
            }

            attacherDragInfoFlottanteAutoHH();
            if (!timerCompatInfoFlottante) {
                timerCompatInfoFlottante = window.setInterval(attacherDragInfoFlottanteAutoHH, 2500);
            }
        } catch (e) {
            console.warn('[AUTO-HH] Compatibilité drag Info bulle WEDA impossible à initialiser :', e);
        }
    }

    let faviconHeidiOriginale = null;
    let titreHeidiOriginal = null;
    let timerFaviconHeidi = null;

    const ETATS_FAVICON_HEIDI = {
        starting: { couleur: '#f9ab00', titre: 'DEMARRAGE - ', dessin: 'work' },
        recording: { couleur: '#d93025', titre: 'REC - ', dessin: 'record' },
        stopping: { couleur: '#f29900', titre: 'ARRET - ', dessin: 'stop' },
        transferring: { couleur: '#1a73e8', titre: 'TRANSFERT - ', dessin: 'transfer' },
        done: { couleur: '#188038', titre: 'OK - ', dessin: 'done' },
        error: { couleur: '#b3261e', titre: 'ERREUR - ', dessin: 'error' }
    };

    const ETATS_INTERFACE_AUTO_HH = {
        idle: { libelle: 'PRÊT', couleur: '#cfe8ff' },
        starting: { libelle: 'DEMARRAGE', couleur: '#ffd166' },
        recording: { libelle: 'REC', couleur: '#ffb4ab' },
        stopping: { libelle: 'ARRET', couleur: '#ffd166' },
        transferring: { libelle: 'TRANSFERT', couleur: '#a8c7fa' },
        done: { libelle: 'OK', couleur: '#b7f7c1' },
        error: { libelle: 'ERREUR', couleur: '#ffb4ab' }
    };

    function normaliserStatutInterfaceAutoHH(statut) {
        const cle = String(statut || 'idle').trim().toLowerCase();
        return ETATS_INTERFACE_AUTO_HH[cle] ? cle : 'idle';
    }

    function getConfigStatutInterfaceAutoHH(statut) {
        const cle = normaliserStatutInterfaceAutoHH(statut);
        return ETATS_INTERFACE_AUTO_HH[cle] || ETATS_INTERFACE_AUTO_HH.idle;
    }

    function getStatutInterfaceDepuisWorkerActifAutoHH(statutRecord = null) {
        try {
            const worker = getHeidiWorkerActif();
            if (!worker || !worker.workerId) return null;

            const texteStatutWorker = normaliserTexte([
                worker.status || '',
                worker.heidiSessionPhase || '',
                worker.message || ''
            ].join(' '));

            const workerIndiqueRecording =
                texteStatutWorker.includes('recording_started') ||
                texteStatutWorker.includes('transcription_lancee') ||
                texteStatutWorker.includes('transcription lancee') ||
                texteStatutWorker.includes('recording confirmed') ||
                texteStatutWorker.includes('rec confirmed');

            if (!workerIndiqueRecording) return null;

            const presence = getPresenceHeidiWorker(worker.workerId);
            if (!presenceHeidiWorkerEstVivable(worker.workerId, presence)) return null;

            const statutCourant = normaliserStatutInterfaceAutoHH(statutRecord && statutRecord.statut);
            if (statutCourant === 'stopping' || statutCourant === 'transferring' || statutCourant === 'done') return null;

            const config = getConfigStatutInterfaceAutoHH('recording');
            return {
                statut: 'recording',
                libelle: config.libelle,
                couleur: config.couleur,
                message: 'Transcription confirmée par worker Heidi actif',
                timestamp: Number(worker.heidiSessionUpdatedAt || worker.updatedAt || Date.now()),
                version: VERSION_AUTO_HH,
                host: HOST,
                topFrame: isTopFrame(),
                source: location.href,
                details: {
                    sourceCorrection: 'worker_actif',
                    workerId: worker.workerId,
                    workerStatus: worker.status || null,
                    workerPhase: worker.heidiSessionPhase || null,
                    heidiSessionId: worker.heidiSessionId || null,
                    presence: resumerValeurLogAutoHH(presence)
                }
            };
        } catch (e) {
            return null;
        }
    }

    function getStatutInterfaceAutoHH() {
        let statut = null;
        try {
            statut = GM_getValue(CLE_STATUT_INTERFACE, null);
        } catch (e) {
            statut = null;
        }

        if (statut && statut.statut) {
            const statutNormalise = normaliserStatutInterfaceAutoHH(statut.statut);
            const statutWorkerRecording = getStatutInterfaceDepuisWorkerActifAutoHH(statut);

            if (statutWorkerRecording && ['idle', 'starting', 'error'].includes(statutNormalise)) {
                return statutWorkerRecording;
            }

            return statut;
        }

        const statutWorkerRecording = getStatutInterfaceDepuisWorkerActifAutoHH(null);
        if (statutWorkerRecording) return statutWorkerRecording;

        return {
            statut: 'idle',
            libelle: ETATS_INTERFACE_AUTO_HH.idle.libelle,
            couleur: ETATS_INTERFACE_AUTO_HH.idle.couleur,
            timestamp: Date.now(),
            source: location.href
        };
    }

    function mettreAJourStatutPanneauAutoHH(statutRecord) {
        try {
            if (!isTopFrame() || !document.body) return;

            const element = document.getElementById('auto-hh-weda-panel-status');
            if (!element) return;

            const statut = normaliserStatutInterfaceAutoHH(statutRecord && statutRecord.statut);
            const config = getConfigStatutInterfaceAutoHH(statut);
            const libelle = String((statutRecord && statutRecord.libelle) || config.libelle || 'PRÊT');

            element.textContent = libelle;
            element.style.color = (statutRecord && statutRecord.couleur) || config.couleur || '#cfe8ff';
            element.title = 'Statut Auto-HH : ' + libelle + (statutRecord && statutRecord.message ? ' — ' + statutRecord.message : '');
        } catch (e) {}
    }

    function publierStatutInterfaceAutoHH(statut, options = {}) {
        const statutNormalise = normaliserStatutInterfaceAutoHH(statut);
        const config = getConfigStatutInterfaceAutoHH(statutNormalise);
        const record = {
            statut: statutNormalise,
            libelle: options.libelle || config.libelle,
            couleur: options.couleur || config.couleur,
            message: options.message || null,
            timestamp: Date.now(),
            version: VERSION_AUTO_HH,
            host: HOST,
            topFrame: isTopFrame(),
            source: location.href,
            details: resumerValeurLogAutoHH(options.details || {})
        };

        try { GM_setValue(CLE_STATUT_INTERFACE, record); } catch (e) {}
        mettreAJourStatutPanneauAutoHH(record);
        return record;
    }

    function initialiserEcouteStatutInterfaceAutoHH() {
        if (!isTopFrame()) return;

        try {
            GM_addValueChangeListener(CLE_STATUT_INTERFACE, function (_name, _oldValue, newValue) {
                mettreAJourStatutPanneauAutoHH(newValue || getStatutInterfaceAutoHH());
            });
        } catch (e) {}

        setInterval(function () {
            try { mettreAJourStatutPanneauAutoHH(getStatutInterfaceAutoHH()); } catch (e) {}
        }, 1000);
    }

    function getLienFaviconHeidi() {
        let lien = document.querySelector('link[rel~="icon"]') || document.querySelector('link[rel="shortcut icon"]');
        if (!lien) {
            lien = document.createElement('link');
            lien.rel = 'icon';
            lien.dataset.autoHhCreated = 'true';
            document.head.appendChild(lien);
        }
        return lien;
    }

    function memoriserFaviconHeidiOriginale() {
        if (faviconHeidiOriginale) return;

        const lien = document.querySelector('link[rel~="icon"]') || document.querySelector('link[rel="shortcut icon"]');
        faviconHeidiOriginale = {
            existe: !!lien,
            href: lien ? (lien.getAttribute('href') || lien.href || '') : '',
            rel: lien ? (lien.getAttribute('rel') || 'icon') : 'icon',
            type: lien ? (lien.getAttribute('type') || '') : ''
        };
        titreHeidiOriginal = document.title || 'Heidi';
    }

    function dessinerFaviconHeidiStatut(statut) {
        const config = ETATS_FAVICON_HEIDI[statut] || ETATS_FAVICON_HEIDI.starting;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;

        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        ctx.clearRect(0, 0, 64, 64);
        ctx.fillStyle = '#0b2a4a';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(4, 4, 56, 56, 12);
        } else {
            ctx.rect(4, 4, 56, 56);
        }
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 34px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', 28, 31);

        ctx.beginPath();
        ctx.arc(47, 47, 15, 0, Math.PI * 2);
        ctx.fillStyle = config.couleur;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';

        if (config.dessin === 'record') {
            ctx.beginPath();
            ctx.arc(47, 47, 5, 0, Math.PI * 2);
            ctx.fill();
        } else if (config.dessin === 'stop') {
            ctx.fillRect(42, 42, 10, 10);
        } else if (config.dessin === 'done') {
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(39, 47);
            ctx.lineTo(45, 53);
            ctx.lineTo(55, 40);
            ctx.stroke();
        } else if (config.dessin === 'error') {
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(47, 38);
            ctx.lineTo(47, 48);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(47, 55, 1.8, 0, Math.PI * 2);
            ctx.fill();
        } else if (config.dessin === 'transfer') {
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(39, 51);
            ctx.lineTo(53, 37);
            ctx.moveTo(45, 37);
            ctx.lineTo(53, 37);
            ctx.lineTo(53, 45);
            ctx.stroke();
        } else {
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(39, 47);
            ctx.lineTo(55, 47);
            ctx.moveTo(47, 39);
            ctx.lineTo(47, 55);
            ctx.stroke();
        }

        return canvas.toDataURL('image/png');
    }

    function definirFaviconHeidiStatut(statut, options = {}) {
        if (!options.ignorerInterface) publierStatutInterfaceAutoHH(statut, options);

        try {
            if (!EST_HEIDI || !isTopFrame() || !document.head) return;

            memoriserFaviconHeidiOriginale();
            if (timerFaviconHeidi) {
                clearTimeout(timerFaviconHeidi);
                timerFaviconHeidi = null;
            }

            if (statut === 'idle') {
                const lien = document.querySelector('link[rel~="icon"]') || document.querySelector('link[rel="shortcut icon"]');
                if (lien && faviconHeidiOriginale) {
                    if (faviconHeidiOriginale.existe && faviconHeidiOriginale.href) {
                        lien.setAttribute('rel', faviconHeidiOriginale.rel || 'icon');
                        lien.setAttribute('href', faviconHeidiOriginale.href);
                        if (faviconHeidiOriginale.type) lien.setAttribute('type', faviconHeidiOriginale.type);
                        else lien.removeAttribute('type');
                    } else if (lien.dataset.autoHhCreated === 'true') {
                        lien.remove();
                    }
                }
                if (titreHeidiOriginal) document.title = titreHeidiOriginal;
                return;
            }

            const config = ETATS_FAVICON_HEIDI[statut] || ETATS_FAVICON_HEIDI.starting;
            const lien = getLienFaviconHeidi();
            const dataUrl = dessinerFaviconHeidiStatut(statut);
            if (dataUrl) {
                lien.setAttribute('rel', 'icon');
                lien.setAttribute('type', 'image/png');
                lien.setAttribute('href', dataUrl);
            }

            document.title = config.titre + (titreHeidiOriginal || 'Heidi');

            if (Number.isFinite(options.duree) && options.duree > 0) {
                timerFaviconHeidi = setTimeout(() => {
                    definirFaviconHeidiStatut('idle', { ignorerInterface: true });
                }, options.duree);
            }
        } catch (e) {
            console.warn('[AUTO-HH] Changement favicon Heidi impossible :', e);
        }
    }

    async function waitForElement(getterFunction, nom, timeoutMs = TIMEOUT_BOUTON_MS) {
        return attendreParVerification(getterFunction, element => isVisible(element), nom, timeoutMs, 80);
    }

    function clickElement(element, nom, options = {}) {
        if (!element) {
            console.warn('[AUTO-HH] Élément absent pour clic :', nom);
            return false;
        }

        const autoriserInvisible = !!options.autoriserInvisible;

        if (!autoriserInvisible && !isVisible(element)) {
            console.warn('[AUTO-HH] Élément non visible pour clic :', nom, element);
            return false;
        }

        console.info('[AUTO-HH] Tentative de clic sur :', nom, element);

        try { element.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
        try { element.focus(); } catch (e) {}

        const doc = element.ownerDocument || document;
        const win = doc.defaultView || window;
        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);

        const elementAuPoint = (() => {
            try { return doc.elementFromPoint(x, y); } catch (e) { return null; }
        })();
        const cibleEvenement = options.cibleAuPoint && elementAuPoint && (element === elementAuPoint || element.contains(elementAuPoint))
            ? elementAuPoint
            : element;
        const ciblesEvenement = cibleEvenement === element ? [element] : [cibleEvenement, element];

        function dispatchMouse(type, buttonsValue) {
            ciblesEvenement.forEach(cible => {
                try {
                    const event = new win.MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        clientX: x,
                        clientY: y,
                        screenX: x,
                        screenY: y,
                        button: 0,
                        buttons: buttonsValue
                    });
                    cible.dispatchEvent(event);
                } catch (e) {}
            });
        }

        function dispatchPointer(type, buttonsValue) {
            ciblesEvenement.forEach(cible => {
                try {
                    if (typeof win.PointerEvent === 'function') {
                        const event = new win.PointerEvent(type, {
                            bubbles: true,
                            cancelable: true,
                            clientX: x,
                            clientY: y,
                            screenX: x,
                            screenY: y,
                            button: 0,
                            buttons: buttonsValue,
                            pointerId: 1,
                            pointerType: 'mouse',
                            isPrimary: true
                        });
                        cible.dispatchEvent(event);
                    }
                } catch (e) {}
            });
        }

        function dispatchKeyboard(type, key, code) {
            try {
                const event = new win.KeyboardEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    key,
                    code,
                    keyCode: key === 'Enter' ? 13 : 32,
                    which: key === 'Enter' ? 13 : 32
                });
                element.dispatchEvent(event);
            } catch (e) {}
        }

        function nativeClick() {
            try {
                if (element instanceof win.HTMLButtonElement && win.HTMLButtonElement.prototype.click) {
                    win.HTMLButtonElement.prototype.click.call(element);
                    return;
                }
                if (element instanceof win.HTMLElement && win.HTMLElement.prototype.click) {
                    win.HTMLElement.prototype.click.call(element);
                    return;
                }
            } catch (e) {}
            try { element.click(); } catch (e) {}
        }

        if (options.clicUnique) {
            nativeClick();
            return true;
        }

        dispatchPointer('pointerover', 0);
        dispatchMouse('mouseover', 0);
        dispatchPointer('pointerenter', 0);
        dispatchMouse('mouseenter', 0);
        dispatchPointer('pointerdown', 1);
        dispatchMouse('mousedown', 1);
        dispatchPointer('pointerup', 0);
        dispatchMouse('mouseup', 0);
        dispatchMouse('click', 0);

        nativeClick();

        if (options.clavierSecours) {
            dispatchKeyboard('keydown', 'Enter', 'Enter');
            dispatchKeyboard('keyup', 'Enter', 'Enter');
            dispatchKeyboard('keydown', ' ', 'Space');
            dispatchKeyboard('keyup', ' ', 'Space');
        }

        return true;
    }

    function touchePageUpDetectee(event) {
        return event.key === 'PageUp' || event.code === 'PageUp' || event.keyCode === 33 || event.which === 33;
    }

    function touchePageDownDetectee(event) {
        return event.key === 'PageDown' || event.code === 'PageDown' || event.keyCode === 34 || event.which === 34;
    }

    async function verrouillerRaccourciGlobal(action, trigger, maintenant) {
        try {
            const owner = 'shortcut_' + maintenant + '_' + Math.random().toString(36).slice(2);
            const lock = GM_getValue(CLE_RACCOURCI_GLOBAL_LOCK, null);
            if (
                lock &&
                lock.action === action &&
                lock.owner &&
                lock.owner !== owner &&
                Number(lock.timestamp || 0) > 0 &&
                maintenant - Number(lock.timestamp || 0) < DELAI_VERROU_RACCOURCI_GLOBAL_MS
            ) {
                console.info('[AUTO-HH] Raccourci ignoré par verrou global :', { action, trigger, lock });
                ajouterLogAutoHH('shortcut-global-lock-existing', {
                    action,
                    trigger,
                    owner,
                    lock
                });
                afficherBadge('AUTO-HH : raccourci déjà pris en compte', 2500);
                return false;
            }

            GM_setValue(CLE_RACCOURCI_GLOBAL_LOCK, {
                owner,
                action,
                trigger: trigger || null,
                timestamp: maintenant,
                source: location.href,
                sourceHost: HOST
            });

            await sleep(120);

            const verification = GM_getValue(CLE_RACCOURCI_GLOBAL_LOCK, null);
            const ok = !!(verification && verification.owner === owner);

            if (!ok) {
                console.info('[AUTO-HH] Raccourci ignoré : une autre frame a gagné le verrou global.', {
                    action,
                    trigger,
                    owner,
                    verification
                });
                ajouterLogAutoHH('shortcut-global-lock-lost', {
                    action,
                    trigger,
                    owner,
                    verification
                });
                afficherBadge('AUTO-HH : raccourci déjà pris en compte', 2500);
            } else {
                ajouterLogAutoHH('shortcut-global-lock-won', {
                    action,
                    trigger,
                    owner
                });
            }

            return ok;
        } catch (e) {
            console.warn('[AUTO-HH] Verrou global raccourci indisponible, poursuite normale :', e);
            ajouterLogAutoHH('shortcut-global-lock-error', {
                action,
                trigger,
                erreur: String(e && e.message ? e.message : e)
            });
            return true;
        }
    }

    function creerHeidiWorkerId() {
        return 'heidi_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    }

    function getClePresenceHeidiWorker(workerId) {
        return CLE_HEIDI_WORKER_PRESENCE_PREFIX + workerId;
    }

    function enregistrerPresenceHeidiWorker(workerId, statut = 'alive') {
        if (!workerId) return null;

        const presence = {
            workerId,
            statut,
            version: VERSION_AUTO_HH,
            instance: instanceHeidiAutoHH,
            timestamp: Date.now(),
            source: location.href
        };

        try { GM_setValue(getClePresenceHeidiWorker(workerId), presence); } catch (e) {}
        return presence;
    }

    function getPresenceHeidiWorker(workerId) {
        if (!workerId) return false;

        try {
            return GM_getValue(getClePresenceHeidiWorker(workerId), null);
        } catch (e) {
            return null;
        }
    }

    function presenceHeidiWorkerEstVivable(workerId, presence) {
        return !!(
            presence &&
            presence.workerId === workerId &&
            presence.version === VERSION_AUTO_HH &&
            presence.instance &&
            Number(presence.timestamp || 0) > 0 &&
            Date.now() - Number(presence.timestamp || 0) < 20000
        );
    }

    function heidiWorkerDedieEstVivant(workerId) {
        return presenceHeidiWorkerEstVivable(workerId, getPresenceHeidiWorker(workerId));
    }

    function remplacerHeidiWorkerDedieWedaId(raison, ancienWorkerId = null, presence = null) {
        const nouveauWorkerId = creerHeidiWorkerId();

        try { sessionStorage.setItem(CLE_SESSION_WEDA_HEIDI_WORKER, nouveauWorkerId); } catch (e) {}
        try {
            if (ancienWorkerId) GM_deleteValue(getClePresenceHeidiWorker(ancienWorkerId));
        } catch (e) {}

        ajouterLogAutoHH('weda-heidi-worker-id-replaced', {
            raison,
            ancienWorkerId,
            nouveauWorkerId,
            presence
        });

        return nouveauWorkerId;
    }

    function getHeidiWorkerDedieWedaId(creerSiAbsent = true) {
        if (!EST_WEDA) return null;

        let workerId = null;
        try { workerId = sessionStorage.getItem(CLE_SESSION_WEDA_HEIDI_WORKER); } catch (e) {}

        if (!workerId && creerSiAbsent) {
            workerId = creerHeidiWorkerId();
            try { sessionStorage.setItem(CLE_SESSION_WEDA_HEIDI_WORKER, workerId); } catch (e) {}
        }

        return workerId;
    }

    function getHeidiWorkerIdDepuisHash() {
        try {
            const hash = String(location.hash || '').replace(/^#/, '');
            const params = new URLSearchParams(hash);
            return params.get(PARAM_WORKER_HEIDI);
        } catch (e) {
            return null;
        }
    }

    function getHeidiWorkerIdLocal() {
        try {
            return sessionStorage.getItem(CLE_SESSION_HEIDI_WORKER) || getHeidiWorkerIdDepuisHash();
        } catch (e) {
            return getHeidiWorkerIdDepuisHash();
        }
    }

    function getHeidiSessionIdDepuisUrl(urlBrute) {
        try {
            const url = new URL(urlBrute || location.href, location.origin);
            const match = String(url.pathname || '').match(/\/scribe\/session\/([^\/?#]+)/i);
            return match && match[1] ? decodeURIComponent(match[1]) : null;
        } catch (e) {
            const match = String(urlBrute || location.href || '').match(/\/scribe\/session\/([^\/?#]+)/i);
            return match && match[1] ? decodeURIComponent(match[1]) : null;
        }
    }

    function construireUrlSessionHeidi(sessionId) {
        if (!sessionId) return null;
        let locale = 'fr-FR';
        try {
            const matchLocale = String(location.pathname || '').match(/^\/([a-z]{2}-[A-Z]{2})\/scribe\//);
            if (matchLocale && matchLocale[1]) locale = matchLocale[1];
        } catch (e) {}
        const origineHeidi = EST_HEIDI ? location.origin : URL_HEIDI_DEDIEE.replace(/\/$/, '');
        return origineHeidi + '/' + locale + '/scribe/session/' + encodeURIComponent(sessionId);
    }

    function trouverLienSessionHeidi(sessionId) {
        if (!sessionId) return null;
        const liens = Array.from(document.querySelectorAll('a[href*="/scribe/session/"]'));
        return liens.find(lien => getHeidiSessionIdDepuisUrl(lien.getAttribute('href') || lien.href || '') === sessionId) || null;
    }

    function getSessionHeidiActiveDepuisMenu() {
        const liens = Array.from(document.querySelectorAll('[data-testid="session-list-session-item"] a[href*="/scribe/session/"], a[href*="/scribe/session/"]'));
        for (const lien of liens) {
            const actif = lien.querySelector('[data-active="true"]') || lien.closest?.('[data-active="true"]');
            if (!actif) continue;
            const id = getHeidiSessionIdDepuisUrl(lien.getAttribute('href') || lien.href || '');
            if (!id) continue;
            return {
                id,
                url: construireUrlSessionHeidi(id),
                title: lien.getAttribute('title') || lien.textContent || '',
                source: 'menu_actif'
            };
        }
        return null;
    }

    function getSessionHeidiDepuisStockageLocal(verrouilleeSeulement = false) {
        try {
            const sessionId = sessionStorage.getItem(verrouilleeSeulement ? CLE_SESSION_HEIDI_LOCK_ID : CLE_SESSION_HEIDI_ID);
            const sessionUrl = sessionStorage.getItem(verrouilleeSeulement ? CLE_SESSION_HEIDI_LOCK_URL : CLE_SESSION_HEIDI_URL);
            if (sessionId) {
                return {
                    id: sessionId,
                    url: sessionUrl || construireUrlSessionHeidi(sessionId),
                    title: '',
                    source: verrouilleeSeulement ? 'session_lock_storage' : 'session_storage'
                };
            }
        } catch (e) {}
        return null;
    }

    function getSessionHeidiCourante(options = {}) {
        const preferMenu = !!options.preferMenu;
        const includeStorage = options.includeStorage !== false;

        if (preferMenu) {
            const activeMenu = getSessionHeidiActiveDepuisMenu();
            if (activeMenu && activeMenu.id) return activeMenu;
        }

        const idUrl = getHeidiSessionIdDepuisUrl(location.href);
        if (idUrl) {
            return {
                id: idUrl,
                url: construireUrlSessionHeidi(idUrl),
                title: document.title || '',
                source: 'url'
            };
        }

        const activeMenu = getSessionHeidiActiveDepuisMenu();
        if (activeMenu && activeMenu.id) return activeMenu;

        if (includeStorage) {
            const stockageVerrouille = getSessionHeidiDepuisStockageLocal(true);
            if (stockageVerrouille && stockageVerrouille.id) return stockageVerrouille;

            const stockageSimple = getSessionHeidiDepuisStockageLocal(false);
            if (stockageSimple && stockageSimple.id) return stockageSimple;
        }

        return null;
    }

    function getSessionHeidiVerrouilleeLocale() {
        const verrou = getSessionHeidiDepuisStockageLocal(true);
        if (verrou && verrou.id) return verrou;
        return null;
    }

    function verrouillerSessionHeidiConnecteur(signal, sessionInfo, phase) {
        if (!sessionInfo || !sessionInfo.id) return null;

        const sessionVerrouillee = {
            id: String(sessionInfo.id),
            url: sessionInfo.url || construireUrlSessionHeidi(sessionInfo.id),
            title: String(sessionInfo.title || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            source: sessionInfo.source || null,
            phase: phase || 'session_locked',
            lockedAt: Date.now()
        };

        try { sessionStorage.setItem(CLE_SESSION_HEIDI_LOCK_ID, sessionVerrouillee.id); } catch (e) {}
        try { sessionStorage.setItem(CLE_SESSION_HEIDI_LOCK_URL, sessionVerrouillee.url); } catch (e) {}
        try { sessionStorage.setItem(CLE_SESSION_HEIDI_LOCK_CREATED_AT, String(sessionVerrouillee.lockedAt)); } catch (e) {}
        try { sessionStorage.setItem(CLE_SESSION_HEIDI_LOCK_PHASE, sessionVerrouillee.phase); } catch (e) {}

        const workerId = signal?.heidiWorkerId || getHeidiWorkerIdLocal() || null;
        if (workerId) {
            try {
                const workerExistant = GM_getValue(CLE_HEIDI_WORKER_ACTIF, null) || {};
                const workerMisAJour = {
                    ...workerExistant,
                    workerId,
                    heidiSessionId: sessionVerrouillee.id,
                    heidiSessionUrl: sessionVerrouillee.url,
                    heidiSessionTitle: sessionVerrouillee.title,
                    heidiSessionSource: sessionVerrouillee.source,
                    heidiSessionPhase: phase || null,
                    heidiSessionLockedAt: sessionVerrouillee.lockedAt,
                    heidiSessionUpdatedAt: Date.now(),
                    updatedAt: Date.now(),
                    status: phase || workerExistant.status || 'heidi_session_locked'
                };
                GM_setValue(CLE_HEIDI_WORKER_ACTIF, workerMisAJour);
                ajouterLogAutoHH('heidi-session-locked-for-worker', {
                    phase,
                    workerId,
                    sessionVerrouillee,
                    workerMisAJour
                });
            } catch (e) {
                ajouterLogAutoHH('heidi-session-lock-worker-error', {
                    phase,
                    workerId,
                    sessionVerrouillee,
                    erreur: String(e && e.message ? e.message : e)
                });
            }
        }

        memoriserSessionHeidiPourWorker(signal, sessionVerrouillee, phase || 'session_locked');
        return sessionVerrouillee;
    }

    async function attendreSessionHeidiApresNouvelleSession(sessionAvant, timeoutMs = 18000) {
        const idAvant = sessionAvant && sessionAvant.id ? String(sessionAvant.id) : '';
        const start = Date.now();
        let derniereSession = null;

        while (Date.now() - start < timeoutMs) {
            const session = getSessionHeidiCourante({ preferMenu: true, includeStorage: false });
            if (session && session.id) {
                derniereSession = session;
                if (!idAvant || String(session.id) !== idAvant) return session;
            }
            await sleep(180);
        }

        return derniereSession || getSessionHeidiCourante({ preferMenu: true, includeStorage: false });
    }

    function memoriserSessionHeidiPourWorker(signal, sessionInfo, phase) {
        if (!sessionInfo || !sessionInfo.id) return null;

        const workerId = signal?.heidiWorkerId || getHeidiWorkerIdLocal() || null;
        const phaseTexte = String(phase || '');
        const phaseAutoriseePourChangerVerrou = /new_session_created|recording_started|session_locked/i.test(phaseTexte) && (!signal || !signal.action || signal.action === 'start');
        const verrouLocal = getSessionHeidiVerrouilleeLocale();

        if (verrouLocal && verrouLocal.id && String(verrouLocal.id) !== String(sessionInfo.id) && !phaseAutoriseePourChangerVerrou) {
            ajouterLogAutoHH('heidi-session-memory-preserved-locked-session', {
                phase,
                sessionInfo,
                verrouLocal,
                workerId,
                raison: 'préserve la session créée au PageUp, évite retour sur ancienne session'
            });
            return verrouLocal;
        }

        try { sessionStorage.setItem(CLE_SESSION_HEIDI_ID, sessionInfo.id); } catch (e) {}
        try { sessionStorage.setItem(CLE_SESSION_HEIDI_URL, sessionInfo.url || construireUrlSessionHeidi(sessionInfo.id)); } catch (e) {}
        try { sessionStorage.setItem(CLE_SESSION_HEIDI_SOURCE, phase || 'session_detected'); } catch (e) {}

        if (!workerId) return sessionInfo;

        try {
            const workerExistant = GM_getValue(CLE_HEIDI_WORKER_ACTIF, null) || {};
            if (workerExistant.workerId && workerExistant.workerId !== workerId) {
                ajouterLogAutoHH('heidi-session-worker-active-mismatch', {
                    workerLocal: workerId,
                    workerExistant,
                    sessionInfo,
                    phase
                });
            }

            const workerMisAJour = {
                ...workerExistant,
                workerId,
                heidiSessionId: sessionInfo.id,
                heidiSessionUrl: sessionInfo.url || construireUrlSessionHeidi(sessionInfo.id),
                heidiSessionTitle: String(sessionInfo.title || '').replace(/\s+/g, ' ').trim().slice(0, 160),
                heidiSessionSource: sessionInfo.source || null,
                heidiSessionPhase: phase || null,
                heidiSessionUpdatedAt: Date.now(),
                updatedAt: Date.now(),
                status: phase || workerExistant.status || 'heidi_session_known'
            };

            GM_setValue(CLE_HEIDI_WORKER_ACTIF, workerMisAJour);
            ajouterLogAutoHH('heidi-session-memorized', {
                phase,
                workerId,
                sessionInfo,
                workerMisAJour
            });
            return workerMisAJour;
        } catch (e) {
            ajouterLogAutoHH('heidi-session-memorize-error', {
                phase,
                workerId,
                sessionInfo,
                erreur: String(e && e.message ? e.message : e)
            });
            return sessionInfo;
        }
    }

    function getSessionHeidiCibleDepuisSignal(signal) {
        const workerLocal = getHeidiWorkerIdLocal();
        const workerCible = signal?.heidiWorkerId || workerLocal || null;

        const verrouLocal = EST_HEIDI ? getSessionHeidiVerrouilleeLocale() : null;
        if (verrouLocal && verrouLocal.id && (!signal?.heidiWorkerId || signal.heidiWorkerId === workerLocal)) {
            if (signal?.heidiSessionId && String(signal.heidiSessionId) !== String(verrouLocal.id)) {
                ajouterLogAutoHH('heidi-session-target-signal-overridden-by-local-lock', {
                    signalSessionId: signal.heidiSessionId,
                    verrouLocal,
                    workerLocal,
                    signal
                });
            }
            return {
                id: String(verrouLocal.id),
                url: verrouLocal.url || construireUrlSessionHeidi(verrouLocal.id),
                source: 'local_lock'
            };
        }

        if (signal?.heidiSessionId) {
            return {
                id: String(signal.heidiSessionId),
                url: signal.heidiSessionUrl || construireUrlSessionHeidi(signal.heidiSessionId),
                source: 'signal'
            };
        }

        try {
            const workerActif = GM_getValue(CLE_HEIDI_WORKER_ACTIF, null);
            if (
                workerActif &&
                workerActif.heidiSessionId &&
                (!workerCible || !workerActif.workerId || workerActif.workerId === workerCible)
            ) {
                return {
                    id: String(workerActif.heidiSessionId),
                    url: workerActif.heidiSessionUrl || construireUrlSessionHeidi(workerActif.heidiSessionId),
                    source: 'worker_actif'
                };
            }
        } catch (e) {}

        try {
            const sessionId = sessionStorage.getItem(CLE_SESSION_HEIDI_ID);
            const sessionUrl = sessionStorage.getItem(CLE_SESSION_HEIDI_URL);
            if (sessionId) return { id: sessionId, url: sessionUrl || construireUrlSessionHeidi(sessionId), source: 'session_storage' };
        } catch (e) {}

        return null;
    }

    async function attendreSessionHeidiCouranteId(sessionId, timeoutMs = 12000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const courante = getSessionHeidiCourante({ preferMenu: true, includeStorage: false });
            if (courante && String(courante.id) === String(sessionId)) return true;
            await sleep(180);
        }
        return false;
    }

    async function restaurerSessionHeidiCible(signal, phase) {
        if (!EST_HEIDI) return true;

        const cible = getSessionHeidiCibleDepuisSignal(signal);
        if (!cible || !cible.id) {
            ajouterLogAutoHH('heidi-session-restore-skipped-no-target', { signal, phase });
            return true;
        }

        const courante = getSessionHeidiCourante();
        if (courante && courante.id === cible.id) {
            memoriserSessionHeidiPourWorker(signal, courante, phase || 'session_already_current');
            ajouterLogAutoHH('heidi-session-restore-already-current', { cible, courante, phase });
            return true;
        }

        afficherBadge('AUTO-HH : retour sur la bonne session Heidi', 4000);
        ajouterLogAutoHH('heidi-session-restore-start', {
            signal,
            phase,
            cible,
            courante,
            lienDansMenu: !!trouverLienSessionHeidi(cible.id)
        });

        let clicMenu = false;
        const lien = await attendreParVerification(
            () => trouverLienSessionHeidi(cible.id),
            element => !!element,
            'session Heidi cible dans le menu',
            4500,
            150
        );

        if (lien) {
            clicMenu = clickElement(lien, 'Session Heidi cible ' + cible.id, { clicUnique: true, autoriserInvisible: true });
            await sleep(900);
        }

        let ok = await attendreSessionHeidiCouranteId(cible.id, clicMenu ? 9000 : 1500);

        if (!ok) {
            const url = cible.url || construireUrlSessionHeidi(cible.id);
            ajouterLogAutoHH('heidi-session-restore-fallback-url', { cible, url, phase });
            try {
                window.location.assign(url);
            } catch (e) {
                try { location.href = url; } catch (e2) {}
            }
            await sleep(2500);
            ok = await attendreSessionHeidiCouranteId(cible.id, 9000);
        }

        const apres = getSessionHeidiCourante();
        ajouterLogAutoHH(ok ? 'heidi-session-restore-ok' : 'heidi-session-restore-failed', {
            signal,
            phase,
            cible,
            avant: courante,
            apres,
            clicMenu
        });

        if (ok && apres) memoriserSessionHeidiPourWorker(signal, apres, phase || 'session_restored');
        return ok;
    }

    async function verifierOuRestaurerSessionHeidiPendantPhase(signal, cible, phase) {
        if (!EST_HEIDI || !cible || !cible.id) return true;

        const courante = getSessionHeidiCourante({ preferMenu: true, includeStorage: false });
        if (courante && String(courante.id) === String(cible.id)) return true;

        ajouterLogAutoHH('heidi-session-guard-restore-needed', {
            phase,
            cible,
            courante,
            signal
        });

        const signalCible = {
            ...(signal || {}),
            heidiSessionId: cible.id,
            heidiSessionUrl: cible.url || construireUrlSessionHeidi(cible.id)
        };

        return await restaurerSessionHeidiCible(signalCible, phase || 'session_guard');
    }

    async function attendreBoutonCopierHeidiSurSession(signal, cible, timeoutMs = TIMEOUT_GENERATION_HEIDI_MS) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const okSession = await verifierOuRestaurerSessionHeidiPendantPhase(signal, cible, 'attente_bouton_copier');
            if (!okSession) {
                await sleep(700);
                continue;
            }

            const bouton = getBoutonCopierHeidi();
            if (bouton && isVisible(bouton)) return bouton;

            await sleep(500);
        }

        return null;
    }

    function initialiserOngletHeidiDedie() {
        if (!EST_HEIDI) return null;

        const workerIdDepuisHash = getHeidiWorkerIdDepuisHash();
        if (workerIdDepuisHash) {
            try { sessionStorage.setItem(CLE_SESSION_HEIDI_WORKER, workerIdDepuisHash); } catch (e) {}
            try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) {}
        }

        const workerId = getHeidiWorkerIdLocal();
        if (workerId) {
            enregistrerPresenceHeidiWorker(workerId, 'initialise');
            setInterval(() => {
                enregistrerPresenceHeidiWorker(workerId, 'alive');
            }, 5000);

            const sessionInfoInitiale = getSessionHeidiCourante();
            if (sessionInfoInitiale && sessionInfoInitiale.id) {
                memoriserSessionHeidiPourWorker({ heidiWorkerId: workerId }, sessionInfoInitiale, 'heidi_worker_initialise_session_existante');
            }

            console.info('[AUTO-HH] Onglet Heidi dédié initialisé :', workerId);
            afficherBadge('AUTO-HH : onglet Heidi dédié', 5000);
        }

        return workerId;
    }

    function signalDestineAOngletHeidiCourant(signal) {
        const workerCible = signal && signal.heidiWorkerId ? String(signal.heidiWorkerId) : '';
        if (!workerCible) return true;

        const workerLocal = getHeidiWorkerIdLocal();
        const ok = workerLocal === workerCible;

        const cleIgnore = [signal.timestamp, signal.nonce || '', signal.action || '', workerCible].join('|');
        if (!ok && cleIgnore !== derniereCleSignalIgnoreHeidi) {
            derniereCleSignalIgnoreHeidi = cleIgnore;
            console.info('[AUTO-HH] Signal Heidi ignoré par cet onglet : autre onglet dédié ciblé.', {
                workerCible,
                workerLocal: workerLocal || null,
                action: signal.action,
                timestamp: signal.timestamp
            });
            ajouterLogAutoHH('heidi-signal-ignored-target', {
                workerCible,
                workerLocal: workerLocal || null,
                action: signal.action,
                timestamp: signal.timestamp,
                nonce: signal.nonce || null
            });
        }

        return ok;
    }

    function preparerHeidiWorkerDepuisWeda() {
        if (!EST_WEDA) return null;

        const wedaUrl = getWedaUrlPourTransfertDepuisContexte();
        let workerId = getHeidiWorkerDedieWedaId(true);
        let presence = getPresenceHeidiWorker(workerId);

        if (presence && !presenceHeidiWorkerEstVivable(workerId, presence)) {
            workerId = remplacerHeidiWorkerDedieWedaId('presence_ancienne_ou_ambigue', workerId, presence);
            presence = getPresenceHeidiWorker(workerId);
        }

        const patDk = getParamPatDkDepuisUrl(wedaUrl || getTopHref());

        return {
            workerId,
            wedaUrl: null,
            patDk: null,
            initialWedaUrl: wedaUrl,
            initialPatDk: patDk,
            status: 'prepared',
            workerDejaActif: presenceHeidiWorkerEstVivable(workerId, presence),
            workerPresence: presence || null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: getTopHref()
        };
    }

    function memoriserHeidiWorkerActif(worker) {
        if (!worker || !worker.workerId) return null;

        const record = {
            ...worker,
            updatedAt: Date.now()
        };

        try { GM_setValue(CLE_HEIDI_WORKER_ACTIF, record); } catch (e) {}
        return record;
    }

    function getHeidiWorkerActif() {
        let worker = null;
        try { worker = GM_getValue(CLE_HEIDI_WORKER_ACTIF, null); } catch (e) { worker = null; }
        if (!worker || !worker.workerId) return null;

        const referenceTemps = Number(worker.updatedAt || worker.createdAt || 0);
        if (referenceTemps && Date.now() - referenceTemps > DELAI_EXPIRATION_HEIDI_WORKER_MS) {
            try { GM_deleteValue(CLE_HEIDI_WORKER_ACTIF); } catch (e) {}
            return null;
        }

        return worker;
    }

    function heidiWorkerCompatibleAvecWedaCourant(worker) {
        if (!EST_WEDA || !worker) return true;

        const patDkCourant = getParamPatDkDepuisUrl(getTopHref());
        const patDkReference = worker.contextPatDk || worker.patDk;
        if (!patDkReference || !patDkCourant) return true;
        return String(patDkReference) === String(patDkCourant);
    }

    function obtenirRegistreOngletsHeidiDedies() {
        try {
            const topWin = window.top || window;
            if (!topWin.__AUTO_HH_ONGLETS_HEIDI_DEDIES) topWin.__AUTO_HH_ONGLETS_HEIDI_DEDIES = {};
            return topWin.__AUTO_HH_ONGLETS_HEIDI_DEDIES;
        } catch (e) {
            return null;
        }
    }

    function construireUrlOngletHeidiDedie(workerId, urlCible = URL_HEIDI_DEDIEE) {
        const urlBase = urlCible || URL_HEIDI_DEDIEE;

        try {
            const url = new URL(urlBase, URL_HEIDI_DEDIEE);
            const hashBrut = String(url.hash || '').replace(/^#/, '');
            const params = new URLSearchParams(hashBrut);
            params.set(PARAM_WORKER_HEIDI, workerId);
            url.hash = params.toString();
            return url.toString();
        } catch (e) {
            const separateurHash = String(urlBase).includes('#') ? '&' : '#';
            return String(urlBase) + separateurHash + PARAM_WORKER_HEIDI + '=' + encodeURIComponent(workerId);
        }
    }

    function ouvrirOngletHeidiDedie(worker, options = {}) {
        if (!worker || !worker.workerId) return false;

        const url = construireUrlOngletHeidiDedie(worker.workerId, options.sessionUrl || options.url || URL_HEIDI_DEDIEE);
        console.info('[AUTO-HH] Ouverture onglet Heidi dédié :', { url, worker });
        ajouterLogAutoHH('weda-open-heidi-worker-request', {
            url,
            worker,
            raison: options.raison || null,
            sessionUrl: options.sessionUrl || null
        });

        try {
            const onglet = GM_openInTab(url, { active: false, insert: true, setParent: true });
            if (onglet) {
                ongletsHeidiDedies[worker.workerId] = onglet;
                const registre = obtenirRegistreOngletsHeidiDedies();
                if (registre) registre[worker.workerId] = onglet;
            }
            ajouterLogAutoHH('weda-open-heidi-worker-gm-open', {
                workerId: worker.workerId,
                tabObjectReceived: !!onglet
            });
            return true;
        } catch (e) {
            console.warn('[AUTO-HH] GM_openInTab indisponible pour Heidi, fallback window.open :', e);
            ajouterLogAutoHH('weda-open-heidi-worker-gm-open-error', {
                worker,
                erreur: String(e && e.message ? e.message : e)
            });
            try {
                window.open(url, '_blank');
                ajouterLogAutoHH('weda-open-heidi-worker-window-open', {
                    workerId: worker.workerId,
                    raison: options.raison || null
                });
                return true;
            } catch (e2) {
                console.warn('[AUTO-HH] Ouverture onglet Heidi dédiée impossible :', e2);
                ajouterLogAutoHH('weda-open-heidi-worker-window-open-error', {
                    worker,
                    erreur: String(e2 && e2.message ? e2.message : e2)
                });
                return false;
            }
        }
    }

    function nettoyerHeidiWorkerActifSiLocal() {
        const workerLocal = getHeidiWorkerIdLocal();
        if (!workerLocal) return;

        try {
            const workerActif = GM_getValue(CLE_HEIDI_WORKER_ACTIF, null);
            if (workerActif && workerActif.workerId === workerLocal) GM_deleteValue(CLE_HEIDI_WORKER_ACTIF);
        } catch (e) {}

        try { sessionStorage.removeItem(CLE_SESSION_HEIDI_WORKER); } catch (e) {}
    }

    function demanderFermetureHeidiWorkerGlobale(workerId, raison, extras = {}) {
        if (!workerId) return false;
        try {
            GM_setValue(CLE_HEIDI_WORKER_CLOSE_REQUEST, {
                workerId: workerId,
                timestamp: Date.now(),
                raison: raison || 'fin_tache',
                source: location.href,
                ...extras
            });
            return true;
        } catch (e) {
            console.warn('[AUTO-HH] Demande globale de fermeture Heidi impossible :', e);
            return false;
        }
    }

    function fermerOngletHeidiDedieLocalement(raison) {
        const workerLocal = getHeidiWorkerIdLocal();
        if (!workerLocal) return false;
        if (fermetureHeidiLocaleDemandee) return true;

        fermetureHeidiLocaleDemandee = true;

        console.info('[AUTO-HH] Fermeture locale onglet Heidi dédié demandée :', { workerLocal, raison });
        afficherBadge('AUTO-HH : fermeture onglet Heidi dédié', 5000);

        nettoyerHeidiWorkerActifSiLocal();

        function tenterFermeture() {
            try { window.close(); } catch (e) { console.warn('[AUTO-HH] window.close Heidi impossible :', e); }
            try {
                if (typeof unsafeWindow !== 'undefined' && unsafeWindow !== window) unsafeWindow.close();
            } catch (e) {}
            try {
                if (window.top && window.top !== window) window.top.close();
            } catch (e) {}
            try {
                if (typeof unsafeWindow !== 'undefined' && unsafeWindow.top && unsafeWindow.top !== unsafeWindow) unsafeWindow.top.close();
            } catch (e) {}
            try {
                const w = window.open('', '_self');
                if (w) w.close();
            } catch (e) {}
        }

        setTimeout(tenterFermeture, 100);
        setTimeout(tenterFermeture, 700);
        setTimeout(tenterFermeture, 1500);

        setTimeout(() => {
            try {
                if (!window.closed) afficherBadge('AUTO-HH : onglet Heidi dédié à fermer manuellement si toujours ouvert', 10000);
            } catch (e) {}
        }, 2600);

        return true;
    }

    function fermerOngletHeidiDedieSiBesoin(raison) {
        const workerLocal = getHeidiWorkerIdLocal();
        if (!workerLocal) return false;

        demanderFermetureHeidiWorkerGlobale(workerLocal, raison || 'fin_tache', { demandeDepuisHeidi: true });
        fermerOngletHeidiDedieLocalement(raison);
        return true;
    }

    function traiterDemandeFermetureHeidiWorker(demande, origine) {
        if (!demande || !demande.workerId || !demande.timestamp) return;
        if (Number(demande.timestamp) <= derniereDemandeFermetureHeidiTraitee) return;

        derniereDemandeFermetureHeidiTraitee = Number(demande.timestamp);

        const workerId = String(demande.workerId);
        const workerLocal = getHeidiWorkerIdLocal();

        if (EST_HEIDI && workerLocal === workerId) {
            console.info('[AUTO-HH] Demande fermeture reçue par le worker Heidi ciblé :', { demande, origine });
            fermerOngletHeidiDedieLocalement(demande.raison || 'demande_globale');
            return;
        }

        const registre = obtenirRegistreOngletsHeidiDedies();
        const onglet = ongletsHeidiDedies[workerId] || (registre && registre[workerId]);

        if (!onglet || typeof onglet.close !== 'function') {
            console.info('[AUTO-HH] Demande fermeture worker Heidi reçue sans handle local :', { demande, origine });
            return;
        }

        try {
            onglet.close();
            delete ongletsHeidiDedies[workerId];
            if (registre) delete registre[workerId];
            console.info('[AUTO-HH] Onglet Heidi dédié fermé via handle GM_openInTab :', { demande, origine });
            if (EST_WEDA) afficherBadge('AUTO-HH : onglet Heidi dédié fermé', 3500);
        } catch (e) {
            console.warn('[AUTO-HH] Fermeture du worker Heidi via handle impossible :', { demande, origine, e });
        }
    }

    function initialiserEcouteFermetureHeidiWorker() {
        try {
            GM_addValueChangeListener(CLE_HEIDI_WORKER_CLOSE_REQUEST, function (_name, _oldValue, newValue) {
                traiterDemandeFermetureHeidiWorker(newValue, 'GM_addValueChangeListener');
            });
        } catch (e) {}

        setInterval(function () {
            try {
                traiterDemandeFermetureHeidiWorker(GM_getValue(CLE_HEIDI_WORKER_CLOSE_REQUEST, null), 'GM_getValue');
            } catch (e) {}
        }, 1000);
    }

    function obtenirWedaOpenerId() {
        let openerId = null;
        try { openerId = sessionStorage.getItem('auto_hh_weda_opener_id_stable'); } catch (e) {}
        if (!openerId) {
            openerId = 'weda_opener_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            try { sessionStorage.setItem('auto_hh_weda_opener_id_stable', openerId); } catch (e) {}
        }
        return openerId;
    }

    function chercherJobTransfertPourHeidiWorker(workerId, signalTimestamp) {
        if (!workerId || typeof GM_listValues !== 'function') return null;

        let cles = [];
        try { cles = GM_listValues(); } catch (e) { cles = []; }
        if (!Array.isArray(cles)) return null;

        const timestampReference = Number(signalTimestamp || 0);
        const candidats = [];

        for (const cle of cles) {
            if (!String(cle).startsWith(CLE_TRANSFER_PREFIX)) continue;

            let job = null;
            try { job = GM_getValue(cle, null); } catch (e) { job = null; }
            if (!job || job.heidiWorkerId !== workerId) continue;
            if (job.wedaOpenedAt || job.status === 'saved_and_closed' || job.status === 'saved' || job.status === 'error') continue;
            if (timestampReference && Number(job.createdAt || 0) < timestampReference - 10000) continue;

            candidats.push({ cle, job });
        }

        candidats.sort((a, b) => Number(b.job.createdAt || 0) - Number(a.job.createdAt || 0));
        return candidats[0] || null;
    }

    function ouvrirJobTransfertWedaDepuisOngletOrigine(cle, job) {
        if (!EST_WEDA || !cle || !job || !job.jobId || !job.wedaUrl) return false;

        const openerId = obtenirWedaOpenerId();
        let jobCourant = null;
        try { jobCourant = GM_getValue(cle, null); } catch (e) { jobCourant = null; }
        if (!jobCourant || jobCourant.wedaOpenedAt) return false;

        const jobOuvert = {
            ...jobCourant,
            status: 'pending',
            wedaOpenedAt: Date.now(),
            wedaOpenedBy: openerId,
            wedaOpenedSource: getTopHref()
        };

        try { GM_setValue(cle, jobOuvert); } catch (e) {}

        ouvrirWedaEnArrierePlan(jobOuvert.wedaUrl, jobOuvert.jobId, jobOuvert);
        surveillerStatutTransfert(jobOuvert.jobId);

        afficherBadge('AUTO-HH : worker WEDA ouvert', 4000);
        console.info('[AUTO-HH] Worker WEDA ouvert par l’onglet WEDA d’origine :', {
            jobId: jobOuvert.jobId,
            openerId,
            wedaUrl: jobOuvert.wedaUrl
        });

        return true;
    }

    function surveillerCreationJobTransfertDepuisWeda(workerId, signalTimestamp) {
        if (!EST_WEDA || !workerId) return;

        const start = Date.now();
        let termine = false;

        afficherBadge('AUTO-HH : attente du résumé Heidi', 4000);

        const timer = setInterval(() => {
            if (termine) return;

            const resultat = chercherJobTransfertPourHeidiWorker(workerId, signalTimestamp);
            if (resultat && ouvrirJobTransfertWedaDepuisOngletOrigine(resultat.cle, resultat.job)) {
                termine = true;
                clearInterval(timer);
                return;
            }

            if (Date.now() - start > TIMEOUT_GENERATION_HEIDI_MS + 30000) {
                termine = true;
                clearInterval(timer);
                afficherBadge('AUTO-HH : délai résumé Heidi dépassé', 8000);
                console.warn('[AUTO-HH] Aucun job de transfert reçu depuis le worker Heidi dans le délai.', {
                    workerId,
                    signalTimestamp
                });
            }
        }, 500);
    }

    function envoyerSignal(action, trigger, extras = {}) {
        const maintenant = Date.now();

        if (
            action === 'stop_transfer' &&
            dernierSignalStopTransferEnvoye &&
            maintenant - dernierSignalStopTransferEnvoye < DELAI_BLOCAGE_DOUBLE_STOP_TRANSFER_MS
        ) {
            console.info('[AUTO-HH] PageDown ignoré : transfert déjà déclenché récemment.', {
                ageMs: maintenant - dernierSignalStopTransferEnvoye
            });
            ajouterLogAutoHH('signal-stop-transfer-ignored-recent', {
                action,
                trigger,
                ageMs: maintenant - dernierSignalStopTransferEnvoye
            });
            afficherBadge('AUTO-HH : transfert déjà en cours', 4000);
            return null;
        }

        const signal = {
            timestamp: maintenant,
            nonce: Math.random().toString(36).slice(2),
            source: location.href,
            sourceHost: HOST,
            wedaOpenerId: EST_WEDA ? obtenirWedaOpenerId() : null,
            wedaUrl: EST_WEDA ? getWedaUrlPourTransfertDepuisContexte() : GM_getValue(CLE_LAST_WEDA_URL, null),
            action: action,
            trigger: trigger || null,
            ...extras
        };

        GM_setValue(CLE_SIGNAL, signal);
        try {
            if (CLE_SIGNAL_LEGACY !== CLE_SIGNAL) GM_deleteValue(CLE_SIGNAL_LEGACY);
            if (CLE_SIGNAL_LEGACY_V767 !== CLE_SIGNAL) GM_deleteValue(CLE_SIGNAL_LEGACY_V767);
        } catch (e) {}
        ajouterLogAutoHH('signal-sent', signal);
        if (action === 'stop_transfer') dernierSignalStopTransferEnvoye = maintenant;
        console.info('[AUTO-HH] Signal envoyé :', signal);

        if (action === 'start') {
            publierStatutInterfaceAutoHH('starting', {
                message: 'Signal de démarrage envoyé',
                details: { trigger: trigger || null, heidiWorkerId: signal.heidiWorkerId || null }
            });
            envoyerNotificationGlobale('start', 'Lancement de la transcription Heidi', { trigger: trigger || null });
        }

        if (action === 'stop_transfer') {
            publierStatutInterfaceAutoHH('stopping', {
                message: 'Signal d’arrêt/transfert envoyé',
                details: { trigger: trigger || null, heidiWorkerId: signal.heidiWorkerId || null }
            });
            annulerJobsContexteActifsAutoHH('PageDown déclenché');
            envoyerNotificationGlobale('stop_transfer', 'Arrêt de la transcription Heidi et transfert vers WEDA', { trigger: trigger || null });
        }
programmerRelancesSignalHeidi(signal);

        return signal;
    }

function getCleTraitementSignalHeidi(signal) {
    if (!signal || !signal.timestamp) return '';
    return [
        signal.timestamp,
        signal.nonce || '',
        signal.action || ''
    ].join('|');
}

function getCleClaimSignalHeidi(signal) {
    if (!signal || !signal.timestamp || !signal.action) return '';

    return CLE_HEIDI_SIGNAL_CLAIM_PREFIX + [
        signal.heidiWorkerId || 'legacy',
        signal.action || '',
        signal.timestamp,
        signal.nonce || ''
    ].map(part => encodeURIComponent(String(part))).join('_');
}

function revendiquerSignalHeidi(signal, origine) {
    if (!EST_HEIDI) return false;

    const key = getCleClaimSignalHeidi(signal);
    if (!key) return false;

    const maintenant = Date.now();

    try {
        const claimExistant = GM_getValue(key, null);
        if (
            claimExistant &&
            claimExistant.owner &&
            claimExistant.owner !== instanceHeidiAutoHH &&
            maintenant - Number(claimExistant.timestamp || 0) < DELAI_CLAIM_SIGNAL_HEIDI_MS
        ) {
            console.info('[AUTO-HH] Signal Heidi déjà réservé par une autre instance, ignoré.', {
                signal,
                origine,
                claimExistant
            });
            ajouterLogAutoHH('heidi-signal-claim-existing', {
                origine,
                signal,
                claimExistant
            });
            return false;
        }

        const claim = {
            owner: instanceHeidiAutoHH,
            timestamp: maintenant,
            signalTimestamp: signal.timestamp,
            nonce: signal.nonce || null,
            action: signal.action,
            heidiWorkerId: signal.heidiWorkerId || null,
            origine,
            href: location.href
        };

        GM_setValue(key, claim);

        const verification = GM_getValue(key, null);
        const ok = !!(verification && verification.owner === instanceHeidiAutoHH);

        if (!ok) {
            console.info('[AUTO-HH] Réservation signal Heidi perdue, autre instance prioritaire.', {
                signal,
                origine,
                verification
            });
            ajouterLogAutoHH('heidi-signal-claim-lost', {
                origine,
                signal,
                verification
            });
        } else {
            ajouterLogAutoHH('heidi-signal-claim-won', {
                origine,
                signal,
                owner: instanceHeidiAutoHH
            });
        }

        return ok;
    } catch (e) {
        console.warn('[AUTO-HH] Réservation signal Heidi impossible, fallback local :', e);
        ajouterLogAutoHH('heidi-signal-claim-error', {
            origine,
            signal,
            erreur: String(e && e.message ? e.message : e)
        });
        return true;
    }
}

function libererClaimSignalHeidi(signal) {
    const key = getCleClaimSignalHeidi(signal);
    if (!key) return;

    try {
        const claim = GM_getValue(key, null);
        if (claim && claim.owner === instanceHeidiAutoHH) GM_deleteValue(key);
    } catch (e) {}
}

function getCleVerrouLancementHeidi(signal) {
    if (!signal || !signal.timestamp || signal.action !== 'start') return '';

    return CLE_HEIDI_LAUNCH_LOCK_PREFIX + [
        signal.heidiWorkerId || 'legacy',
        signal.timestamp,
        signal.nonce || ''
    ].map(part => encodeURIComponent(String(part))).join('_');
}

async function verrouillerLancementSessionHeidi(signal, origine) {
    if (!signal || signal.action !== 'start') return true;

    const key = getCleVerrouLancementHeidi(signal);
    if (!key) return true;

    const maintenant = Date.now();

    try {
        const lockExistant = GM_getValue(key, null);
        if (
            lockExistant &&
            lockExistant.owner &&
            lockExistant.owner !== instanceHeidiAutoHH &&
            maintenant - Number(lockExistant.timestamp || 0) < DELAI_VERROU_LANCEMENT_HEIDI_MS
        ) {
            console.info('[AUTO-HH] Lancement Heidi déjà verrouillé par une autre instance, clic Nouvelle session ignoré.', {
                signal,
                origine,
                lockExistant
            });
            ajouterLogAutoHH('heidi-launch-lock-existing', {
                origine,
                signal,
                lockExistant
            });
            return false;
        }

        const lock = {
            owner: instanceHeidiAutoHH,
            timestamp: maintenant,
            signalTimestamp: signal.timestamp,
            nonce: signal.nonce || null,
            heidiWorkerId: signal.heidiWorkerId || null,
            origine,
            href: location.href
        };

        GM_setValue(key, lock);

        await sleep(140);

        const verification = GM_getValue(key, null);
        const ok = !!(verification && verification.owner === instanceHeidiAutoHH);

        if (!ok) {
            console.info('[AUTO-HH] Verrou lancement Heidi perdu, autre instance prioritaire.', {
                signal,
                origine,
                verification
            });
            ajouterLogAutoHH('heidi-launch-lock-lost', {
                origine,
                signal,
                verification
            });
        } else {
            ajouterLogAutoHH('heidi-launch-lock-won', {
                origine,
                signal,
                owner: instanceHeidiAutoHH
            });
        }

        return ok;
    } catch (e) {
        console.warn('[AUTO-HH] Verrou lancement Heidi indisponible, poursuite prudente :', e);
        ajouterLogAutoHH('heidi-launch-lock-error', {
            origine,
            signal,
            erreur: String(e && e.message ? e.message : e)
        });
        return true;
    }
}

function libererVerrouLancementHeidi(signal) {
    const key = getCleVerrouLancementHeidi(signal);
    if (!key) return;

    try {
        const lock = GM_getValue(key, null);
        if (lock && lock.owner === instanceHeidiAutoHH) GM_deleteValue(key);
    } catch (e) {}
}

function getCleVerrouClicNouvelleSessionHeidi(signal) {
    const workerId = (signal && signal.heidiWorkerId) || getHeidiWorkerIdLocal() || 'legacy';
    return CLE_HEIDI_NEW_SESSION_CLICK_LOCK_PREFIX + encodeURIComponent(String(workerId));
}

function verrouillerClicNouvelleSessionHeidi(signal, origine) {
    const key = getCleVerrouClicNouvelleSessionHeidi(signal);
    const maintenant = Date.now();

    try {
        const lockExistant = GM_getValue(key, null);
        if (
            lockExistant &&
            lockExistant.owner &&
            maintenant - Number(lockExistant.timestamp || 0) < DELAI_VERROU_CLIC_NOUVELLE_SESSION_HEIDI_MS
        ) {
            console.info('[AUTO-HH] Clic Nouvelle session bloqué par verrou anti-double.', {
                signal,
                origine,
                lockExistant
            });
            ajouterLogAutoHH('heidi-new-session-click-lock-existing', {
                origine,
                signal,
                lockExistant
            });
            return false;
        }

        const lock = {
            owner: instanceHeidiAutoHH,
            timestamp: maintenant,
            signalTimestamp: signal && signal.timestamp ? signal.timestamp : null,
            nonce: signal && signal.nonce ? signal.nonce : null,
            heidiWorkerId: signal && signal.heidiWorkerId ? signal.heidiWorkerId : getHeidiWorkerIdLocal(),
            origine,
            href: location.href
        };

        GM_setValue(key, lock);
        ajouterLogAutoHH('heidi-new-session-click-lock-won', lock);
        return true;
    } catch (e) {
        console.warn('[AUTO-HH] Verrou clic Nouvelle session indisponible, poursuite prudente :', e);
        ajouterLogAutoHH('heidi-new-session-click-lock-error', {
            origine,
            signal,
            erreur: String(e && e.message ? e.message : e)
        });
        return true;
    }
}

function libererVerrouClicNouvelleSessionHeidi(signal) {
    const key = getCleVerrouClicNouvelleSessionHeidi(signal);

    try {
        const lock = GM_getValue(key, null);
        if (lock && lock.owner === instanceHeidiAutoHH) GM_deleteValue(key);
    } catch (e) {}
}

function ackHeidiCorrespondAuSignal(ack, signal) {
    return !!(
        ack &&
        signal &&
        ack.signalTimestamp === signal.timestamp &&
        ack.nonce === (signal.nonce || null) &&
        ack.action === signal.action &&
        (!signal.heidiWorkerId || ack.heidiWorkerId === signal.heidiWorkerId)
    );
}

function signalStockeCorrespondAuSignal(signalStocke, signalReference) {
    return !!(
        signalStocke &&
        signalReference &&
        signalStocke.timestamp === signalReference.timestamp &&
        signalStocke.nonce === (signalReference.nonce || null) &&
        signalStocke.action === signalReference.action
    );
}

function enregistrerAckHeidi(signal, statut) {
    try {
        GM_setValue(CLE_ACK_HEIDI, {
            timestamp: Date.now(),
            signalTimestamp: signal.timestamp,
            nonce: signal.nonce || null,
            action: signal.action,
            heidiWorkerId: signal.heidiWorkerId || null,
            statut: statut || 'ok',
            source: location.href
        });
    } catch (e) {}
}

function supprimerAckHeidiSiSignal(signal) {
    try {
        const ack = GM_getValue(CLE_ACK_HEIDI, null);
        if (ackHeidiCorrespondAuSignal(ack, signal)) GM_deleteValue(CLE_ACK_HEIDI);
    } catch (e) {}
}

function annulerJobsContexteActifsAutoHH(raison) {
    try {
        if (typeof GM_listValues !== 'function') return;

        const cles = GM_listValues();
        if (!Array.isArray(cles)) return;

        cles
            .filter(cle => String(cle || '').startsWith(CLE_CONTEXT_PREFIX))
            .forEach(cle => {
                try {
                    const job = GM_getValue(cle, null);
                    if (!job || job.status === 'context_pasted' || job.status === 'cancelled') return;

                    GM_setValue(cle, {
                        ...job,
                        status: 'cancelled',
                        message: 'Contexte annulé : ' + (raison || 'PageDown'),
                        cancelReason: raison || 'page_down',
                        cancelledAt: Date.now(),
                        updatedAt: Date.now()
                    });
                } catch (e) {}
            });

        try { sessionStorage.removeItem('auto_hh_weda_context_worker_job_stable'); } catch (e) {}
    } catch (e) {
        console.warn('[AUTO-HH] Annulation des jobs contexte impossible :', e);
    }
}


    function envoyerNotificationGlobale(type, message, extras = {}) {
        const notification = {
            timestamp: Date.now(),
            nonce: Math.random().toString(36).slice(2),
            type: type,
            message: message,
            duree: extras.duree || 7000,
            sourceHost: HOST,
            source: location.href,
            ...extras
        };

        try { GM_setValue(CLE_NOTIFICATION, notification); } catch (e) {}
        traiterNotificationGlobale(notification, 'local');

        return notification;
    }

    function programmerRelancesSignalHeidi(signal) {
    if (!signal || !signal.timestamp || !signal.nonce) return;
    if (EST_HEIDI) return;
    if (signal.action !== 'start' && signal.action !== 'stop_transfer') return;

    if (signal.action === 'start' && signal.heidiWorkerId) {
        ajouterLogAutoHH('heidi-signal-retry-skipped-targeted-start', {
            signal,
            raison: 'évite un double démarrage si un ancien onglet Heidi traite les relances'
        });
        return;
    }

    DELAIS_RELANCE_SIGNAL_HEIDI_MS.forEach((delai, index) => {
        setTimeout(() => {
            try {
                const signalCourant = GM_getValue(CLE_SIGNAL, null);
                if (!signalStockeCorrespondAuSignal(signalCourant, signal)) {
                    console.info('[AUTO-HH] Relance Heidi annulée, un signal plus récent existe déjà :', {
                        actionRelance: signal.action,
                        actionCourante: signalCourant && signalCourant.action,
                        timestampRelance: signal.timestamp,
                        timestampCourant: signalCourant && signalCourant.timestamp
                    });
                    return;
                }

                const ack = GM_getValue(CLE_ACK_HEIDI, null);
                const dejaRecu = ackHeidiCorrespondAuSignal(ack, signal);


                if (dejaRecu) return;

                const signalRelance = {
                    ...signal,
                    retryCount: index + 1,
                    retryAt: Date.now()
                };

                GM_setValue(CLE_SIGNAL, signalRelance);
                ajouterLogAutoHH('heidi-signal-retry-sent', signalRelance);

                console.info('[AUTO-HH] Signal Heidi relancé :', signal.action, index + 1);
            } catch (e) {}
        }, delai);
    });
}


    function traiterNotificationGlobale(notification, origine) {
    if (!notification || !notification.timestamp || !notification.message) return;
    if (notification.timestamp <= derniereNotificationGlobaleTraitee) return;

    const ageNotification = Date.now() - Number(notification.timestamp || 0);
    if (origine !== 'local' && ageNotification > 30000) {
        derniereNotificationGlobaleTraitee = notification.timestamp;
        console.info('[AUTO-HH] Notification ancienne ignorée :', notification);
        return;
    }


        derniereNotificationGlobaleTraitee = notification.timestamp;
        console.info('[AUTO-HH] Notification globale reçue via ' + origine + ' :', notification);
        afficherBadge(notification.message, notification.duree || 7000, {
            force: notification.type === 'done' || notification.type === 'start' || notification.type === 'stop_transfer'
        });
    }

    function initialiserNotificationsGlobales() {
    try {
        const notificationInitiale = GM_getValue(CLE_NOTIFICATION, null);
        if (notificationInitiale && notificationInitiale.timestamp) {
            derniereNotificationGlobaleTraitee = notificationInitiale.timestamp;
            console.info('[AUTO-HH] Notification déjà présente ignorée au chargement :', notificationInitiale);
        }
    } catch (e) {}

    try {
        GM_addValueChangeListener(CLE_NOTIFICATION, function (_name, _oldValue, newValue) {
            traiterNotificationGlobale(newValue, 'GM_addValueChangeListener');
        });
    } catch (e) {}

    setInterval(function () {
        try {
            const notification = GM_getValue(CLE_NOTIFICATION, null);
            traiterNotificationGlobale(notification, 'GM_getValue');
        } catch (e) {}
    }, 800);
}

    /************************************************************
     * OUTILS EXTRACTION
     ************************************************************/

    function decouperEnSegments(texte) {
        return String(texte || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\n\r;]/g, '.')
            .split('.')
            .map(segment => segment.trim())
            .filter(segment => segment.length > 0);
    }

    function segmentAutourIndex(source, index) {
        const texte = String(source || '');
        let debut = 0;
        let fin = texte.length;

        ['.', ';', '\n', '\r'].forEach(sep => {
            const pos = texte.lastIndexOf(sep, index);
            if (pos >= 0 && pos + 1 > debut) debut = pos + 1;
        });

        ['.', ';', '\n', '\r'].forEach(sep => {
            const pos = texte.indexOf(sep, index);
            if (pos >= 0 && pos < fin) fin = pos;
        });

        let segment = texte.slice(debut, fin).trim();

        if (segment.length > 260) {
            segment = texte.slice(Math.max(0, index - 110), Math.min(texte.length, index + 150)).trim();
        }

        return segment;
    }

    function anneePlausible(annee) {
        const a = parseInt(String(annee || ''), 10);
        const courante = new Date().getFullYear();
        return Number.isFinite(a) && a >= 1990 && a <= courante + 5;
    }

    function dateCompletePlausible(jour, mois, annee) {
        const j = parseInt(jour, 10);
        const m = parseInt(mois, 10);
        const a = parseInt(annee, 10);

        if (!anneePlausible(a)) return false;
        if (!Number.isFinite(j) || !Number.isFinite(m)) return false;
        if (j < 1 || j > 31 || m < 1 || m > 12) return false;

        const date = new Date(a, m - 1, j);
        return date.getFullYear() === a && date.getMonth() === m - 1 && date.getDate() === j;
    }

    function extraireDateDepuisContexte(contexte) {
        const brut = String(contexte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        const normalise = normaliserTexte(brut);

        let match = brut.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](19\d{2}|20\d{2})\b/);
        if (match && dateCompletePlausible(match[1], match[2], match[3])) {
            return pad2(match[1]) + '/' + pad2(match[2]) + '/' + match[3];
        }

        match = brut.match(/\b(\d{1,2})[\/\-.](19\d{2}|20\d{2})\b/);
        if (match) {
            const mois = parseInt(match[1], 10);
            const annee = parseInt(match[2], 10);
            if (mois >= 1 && mois <= 12 && anneePlausible(annee)) return pad2(mois) + '/' + String(annee);
        }

        const moisMap = {
            janvier: '01', fevrier: '02', mars: '03', avril: '04', mai: '05', juin: '06',
            juillet: '07', aout: '08', septembre: '09', octobre: '10', novembre: '11', decembre: '12'
        };

        match = normalise.match(/\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(19\d{2}|20\d{2})\b/);
        if (match && anneePlausible(match[2])) return moisMap[match[1]] + '/' + match[2];

        match = normalise.match(/\b(19\d{2}|20\d{2})\b/);
        if (match && anneePlausible(match[1])) return match[1];

        return null;
    }

    function extraireAnneeDepuisContexte(contexte) {
        const valeur = extraireDateDepuisContexte(contexte);
        const match = String(valeur || '').match(/\b(19\d{2}|20\d{2})\b/);
        return match ? match[1] : null;
    }

    function contientUnDesTextes(sourceNormalisee, expressions) {
        return expressions.some(expr => sourceNormalisee.includes(expr));
    }

    function ajouterUnique(tableau, valeur) {
        if (valeur && !tableau.includes(valeur)) tableau.push(valeur);
    }

    function tableauUnique(tableau) {
        const resultat = [];
        (Array.isArray(tableau) ? tableau : []).forEach(item => ajouterUnique(resultat, item));
        return resultat;
    }

    let correctionsQualiteConstantes = [];

    function resetCorrectionsQualiteConstantes() {
        correctionsQualiteConstantes = [];
    }

    function enregistrerCorrectionQualite(type, brute, corrigee, raison) {
        const entree = { type, brute, corrigee, raison, timestamp: Date.now() };
        correctionsQualiteConstantes.push(entree);
        console.info('[AUTO-HH] Correction qualité constante :', entree);
    }

    function getCorrectionsQualiteConstantes() {
        return [...correctionsQualiteConstantes];
    }

    function extraireNombresAutoHH67(texte) {
        const nombres = [];
        let courant = '';
        const source = String(texte || '');

        function pousser() {
            if (!courant) return;
            const valeur = parseFloat(courant.replace(',', '.'));
            if (Number.isFinite(valeur)) nombres.push({ brute: courant, valeur: valeur });
            courant = '';
        }

        for (const caractere of source) {
            const estChiffre = caractere >= '0' && caractere <= '9';
            if (estChiffre || caractere === ',' || caractere === '.') courant += caractere;
            else pousser();
        }

        pousser();
        return nombres;
    }

    /************************************************************
     * EXTRACTION : CONSTANTES / SCORES
     ************************************************************/

    function extrairePoidsDepuisTexte(texte) {
        const source = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        const regex = /(\d{1,3}(?:[,.]\d{1,2})?)\s*kg\b/gi;
        let match;

        while ((match = regex.exec(source)) !== null) {
            const valeurBrute = String(match[1] || '').trim();
            const nombre = parseFloat(valeurBrute.replace(',', '.'));
            if (!Number.isFinite(nombre) || nombre < 1) continue;

            let nombreCorrige = nombre;
            let valeurCorrigee = valeurBrute;

            if (nombreCorrige > 350) {
                const div10 = nombreCorrige / 10;
                const div100 = nombreCorrige / 100;

                if (div10 >= 1 && div10 <= 350) {
                    nombreCorrige = div10;
                    valeurCorrigee = String(div10).replace('.', ',');
                    enregistrerCorrectionQualite('poids', valeurBrute + ' kg', valeurCorrigee + ' kg', 'poids supérieur à 350 kg divisé par 10');
                } else if (div100 >= 1 && div100 <= 350) {
                    nombreCorrige = div100;
                    valeurCorrigee = String(div100).replace('.', ',');
                    enregistrerCorrectionQualite('poids', valeurBrute + ' kg', valeurCorrigee + ' kg', 'poids supérieur à 350 kg divisé par 100');
                }
            }

            if (nombreCorrige > 350) continue;
            return normaliserNombreDecimalPourWeda(valeurCorrigee);
        }

        return null;
    }

    function extraireTailleDepuisTexte(texte) {
        const source = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        let match;

        const regexCm = /(\d{2,3}(?:[,.]\d{1,2})?)\s*cm\b/gi;
        while ((match = regexCm.exec(source)) !== null) {
            const nombre = parseFloat(String(match[1]).replace(',', '.'));
            if (Number.isFinite(nombre)) {
                let tailleCorrigee = nombre;

                if (tailleCorrigee >= 10 && tailleCorrigee <= 25) {
                    tailleCorrigee = tailleCorrigee * 10;
                    enregistrerCorrectionQualite('taille', String(nombre) + ' cm', String(Math.round(tailleCorrigee)) + ' cm', 'taille en cm trop basse multipliée par 10');
                } else if (tailleCorrigee > 250 && tailleCorrigee <= 2500) {
                    tailleCorrigee = tailleCorrigee / 10;
                    enregistrerCorrectionQualite('taille', String(nombre) + ' cm', String(Math.round(tailleCorrigee)) + ' cm', 'taille en cm trop haute divisée par 10');
                }

                if (tailleCorrigee >= 30 && tailleCorrigee <= 250) return String(Math.round(tailleCorrigee));
            }
        }

        const regexMetresDecimal = /\b([1-2])\s*[,.]\s*(\d{1,2})\s*m\b/gi;
        while ((match = regexMetresDecimal.exec(source)) !== null) {
            const metres = parseInt(match[1], 10);
            let cmPart = String(match[2] || '').trim();
            if (cmPart.length === 1) cmPart += '0';
            const taille = metres * 100 + parseInt(cmPart, 10);
            if (taille >= 30 && taille <= 250) return String(taille);
        }

        const regexMetresCm = /\b([1-2])\s*(?:m|metre|mètre|metres|mètres)\s*(\d{1,2})\b/gi;
        while ((match = regexMetresCm.exec(source)) !== null) {
            const metres = parseInt(match[1], 10);
            let cmPart = String(match[2] || '').trim();
            if (cmPart.length === 1) cmPart += '0';
            const taille = metres * 100 + parseInt(cmPart, 10);
            if (taille >= 30 && taille <= 250) return String(taille);
        }

        return null;
    }

    function extraireTemperatureDepuisTexte(texte) {
        const source = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');

        function normaliserTemperatureDetectee(valeurBrute, origine) {
            let temperature = parseFloat(String(valeurBrute || '').replace(',', '.'));
            let valeurCorrigee = String(valeurBrute || '').trim();

            if (!Number.isFinite(temperature)) return null;

            if (temperature >= 3 && temperature < 5) {
                temperature = temperature * 10;
                valeurCorrigee = String(temperature).replace('.', ',');
                enregistrerCorrectionQualite('température', String(valeurBrute) + ' °C', valeurCorrigee + ' °C', 'température trop basse multipliée par 10');
            } else if (temperature > 45 && temperature <= 450) {
                temperature = temperature / 10;
                valeurCorrigee = String(temperature).replace('.', ',');
                enregistrerCorrectionQualite('température', String(valeurBrute) + ' °C', valeurCorrigee + ' °C', 'température trop haute divisée par 10');
            }

            if (temperature >= 36 && temperature <= 45) return normaliserNombreDecimalPourWeda(valeurCorrigee);

            if (temperature >= 30 && temperature < 36) {
                enregistrerCorrectionQualite('température', String(valeurBrute) + ' °C', '37 °C', 'température inférieure à 36 °C remplacée par 37');
                console.info('[AUTO-HH] Température explicite inférieure à 36 corrigée à 37 :', { valeurBrute, origine });
                return '37';
            }

            return null;
        }

        const recherches = [
            {
                nom: 'marqueur température',
                regex: /(?:^|[^a-z0-9])(?:t\s*[°º]?|temp(?:erature|érature)?|temperature|température)\s*[:=]?\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:°\s*c|º\s*c|\bc\b|degr[eé]s?\s*(?:c(?:elsius)?)?|celsius)?/gi
            },
            {
                nom: 'unité °C',
                regex: /(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:°\s*c|º\s*c|\bcelsius\b)/gi
            },
            {
                nom: 'unité degrés',
                regex: /(\d{1,3}(?:[,.]\d{1,2})?)\s*degr[eé]s?\b/gi
            }
        ];

        for (const recherche of recherches) {
            let match;

            while ((match = recherche.regex.exec(source)) !== null) {
                const valeur = normaliserTemperatureDetectee(match[1], recherche.nom);
                if (valeur) return valeur;
            }
        }

        return null;
    }

    function extraireScoreMadrsDepuisTexte(texte) {
        const source = normaliserTexte(String(texte || '').replace(/\u00a0/g, ' '));
        const patterns = [
            /\b(?:madrs|mdrs|score madrs|score mdrs|echelle madrs|echelle mdrs|montgomery(?:\s+asberg)?)\b[^\d]{0,50}(\d{1,2})(?:\s*(?:\/|sur)\s*(\d{1,2}))?/gi,
            /(?:score|echelle|resultat|depistage moral)?[^\d]{0,25}(\d{1,2})(?:\s*(?:\/|sur)\s*(\d{1,2}))?[^\d]{0,55}\b(?:madrs|mdrs|montgomery(?:\s+asberg)?)\b/gi
        ];

        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(source)) !== null) {
                const score = parseInt(match[1], 10);
                const denominateur = match[2] ? parseInt(match[2], 10) : null;
                if (!Number.isFinite(score) || score < 0 || score > 60) continue;
                if (denominateur !== null && denominateur !== 60) continue;
                return String(score);
            }
        }

        return null;
    }

    function extraireScoreMmsDepuisTexte(texte) {
        const source = normaliserTexte(String(texte || '').replace(/\u00a0/g, ' '));
        const patterns = [
            /\b(?:mms|mmse|score mms|score mmse|mini[\s-]*mental(?:\s+state)?(?:\s+examination)?|mini[\s-]*mental[\s-]*state)\b[^\d]{0,50}(\d{1,2})(?:\s*(?:\/|sur)\s*(\d{1,2}))?/gi,
            /(?:score|echelle|resultat|depistage cognitif)?[^\d]{0,20}(\d{1,2})(?:\s*(?:\/|sur)\s*(\d{1,2}))?[^\d]{0,50}\b(?:mms|mmse|mini[\s-]*mental(?:\s+state)?(?:\s+examination)?|mini[\s-]*mental[\s-]*state)\b/gi
        ];

        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(source)) !== null) {
                const score = parseInt(match[1], 10);
                const denominateur = match[2] ? parseInt(match[2], 10) : null;
                if (!Number.isFinite(score) || score < 0 || score > 30) continue;
                if (denominateur !== null && denominateur !== 30) continue;
                return String(score);
            }
        }

        return null;
    }

    /************************************************************
     * EXTRACTION : TABAC / ALCOOL
     ************************************************************/

    function extraireTabacDepuisTexte(texte) {
        const sourceOriginal = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        const source = normaliserTexte(sourceOriginal);

        if (
            /\bancien(?:ne)?\s+fumeur\b/.test(source) ||
            source.includes('ancien tabagisme') ||
            source.includes('tabac sevre') ||
            source.includes('sevre du tabac') ||
            source.includes('sevrage tabagique') ||
            source.includes('ne fume plus') ||
            source.includes('a arrete de fumer')
        ) return 'Ancien fumeur';

        if (
            /\bnon[-\s]?fumeur\b/.test(source) ||
            source.includes('ne fume pas') ||
            source.includes('pas de tabac') ||
            source.includes('aucun tabac') ||
            source.includes('absence de tabac') ||
            source.includes('jamais fume') ||
            source.includes('tabac non') ||
            source.includes('tabagisme non')
        ) return 'Non fumeur';

        let match;
        const regexPaquet = /(\d+(?:[,.]\d{1,2})?|demi)\s*(?:paquets?|paq\.?)\s*(?:\/|\bpar\b)?\s*(?:jour|j)\b/gi;
        while ((match = regexPaquet.exec(sourceOriginal)) !== null) {
            let valeurBrute = String(match[1] || '').trim();
            if (/demi/i.test(valeurBrute)) valeurBrute = '0,5';
            const nombre = parseFloat(valeurBrute.replace(',', '.'));
            if (!Number.isFinite(nombre) || nombre <= 0 || nombre > 5) continue;
            return normaliserNombreDecimalPourWeda(valeurBrute) + ' paquet/j';
        }

        const regexCigarettes = /(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:cigarettes?|cig\.?|cigs?|clopes?)\s*(?:\/|\bpar\b)?\s*(?:jour|j)\b/gi;
        while ((match = regexCigarettes.exec(sourceOriginal)) !== null) {
            const valeurBrute = String(match[1] || '').trim();
            const nombre = parseFloat(valeurBrute.replace(',', '.'));
            if (!Number.isFinite(nombre) || nombre <= 0 || nombre > 120) continue;
            return normaliserNombreDecimalPourWeda(valeurBrute) + ' cig/j';
        }

        const regexContexte = /\b(?:tabac|fume|tabagisme|fumeur)\b[^\d]{0,40}(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:\/|\bpar\b)?\s*(?:jour|j)\b/gi;
        while ((match = regexContexte.exec(sourceOriginal)) !== null) {
            const valeurBrute = String(match[1] || '').trim();
            const nombre = parseFloat(valeurBrute.replace(',', '.'));
            if (!Number.isFinite(nombre) || nombre <= 0 || nombre > 120) continue;
            return normaliserNombreDecimalPourWeda(valeurBrute) + ' cig/j';
        }

        if (source.includes('fumeur actif') || source.includes('tabagisme actif') || source.includes('tabac actif')) return 'Fumeur actif';

        return null;
    }

    function contexteIndiqueAlcool(contexteNormalise) {
        return (
            contexteNormalise.includes('alcool') ||
            contexteNormalise.includes('vin') ||
            contexteNormalise.includes('biere') ||
            contexteNormalise.includes('bieres') ||
            contexteNormalise.includes('aperitif') ||
            contexteNormalise.includes('apero') ||
            contexteNormalise.includes('spiritueux') ||
            contexteNormalise.includes('whisky') ||
            contexteNormalise.includes('boit') ||
            contexteNormalise.includes('consommation')
        );
    }

    function extraireAlcoolDepuisTexte(texte) {
        const sourceOriginal = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        const source = normaliserTexte(sourceOriginal);

        if (
            source.includes('sevre alcool') ||
            source.includes('sevre de l alcool') ||
            source.includes('sevrage alcool') ||
            source.includes('ancien alcool') ||
            source.includes('ancien ethylisme') ||
            source.includes('ethylisme sevre')
        ) return 'Sevré';

        if (
            source.includes('pas d alcool') ||
            source.includes('pas de consommation d alcool') ||
            source.includes('aucun alcool') ||
            source.includes('aucune consommation d alcool') ||
            source.includes('ne boit pas') ||
            source.includes('zero alcool') ||
            source.includes('0 alcool') ||
            source.includes('abstinent')
        ) return 'Pas d’alcool';

        let match;
        const regexVerres = /(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:verres?|unites?|unités?)\s*(?:d['’ ]?alcool)?\s*(?:\/|\bpar\b)?\s*(jour|j|semaine|sem|mois|week[-\s]?end|we)\b/gi;

        while ((match = regexVerres.exec(sourceOriginal)) !== null) {
            const valeurBrute = String(match[1] || '').trim();
            const uniteBrute = normaliserTexte(match[2] || '');
            const nombre = parseFloat(valeurBrute.replace(',', '.'));
            if (!Number.isFinite(nombre) || nombre <= 0 || nombre > 300) continue;

            const contexte = sourceOriginal.slice(Math.max(0, match.index - 100), Math.min(sourceOriginal.length, match.index + 140));
            const contexteNormalise = normaliserTexte(contexte);
            if (contexteNormalise.includes('eau')) continue;
            if (!contexteIndiqueAlcool(contexteNormalise)) continue;

            let suffixe = '/j';
            if (uniteBrute.includes('sem')) suffixe = '/sem';
            else if (uniteBrute.includes('mois')) suffixe = '/mois';
            else if (uniteBrute.includes('week') || uniteBrute === 'we') suffixe = '/week-end';

            return normaliserNombreDecimalPourWeda(valeurBrute) + ' verres' + suffixe;
        }

        const regexBoisson = /(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:verres?)\s*(?:de\s+)?(?:vin|bi[eè]re|bieres|alcool|whisky|spiritueux)\s*(?:\/|\bpar\b)?\s*(jour|j|semaine|sem|mois|week[-\s]?end|we)?\b/gi;
        while ((match = regexBoisson.exec(sourceOriginal)) !== null) {
            const valeurBrute = String(match[1] || '').trim();
            const uniteBrute = normaliserTexte(match[2] || '');
            const nombre = parseFloat(valeurBrute.replace(',', '.'));
            if (!Number.isFinite(nombre) || nombre <= 0 || nombre > 300) continue;

            let suffixe = '';
            if (uniteBrute.includes('jour') || uniteBrute === 'j') suffixe = '/j';
            else if (uniteBrute.includes('sem')) suffixe = '/sem';
            else if (uniteBrute.includes('mois')) suffixe = '/mois';
            else if (uniteBrute.includes('week') || uniteBrute === 'we') suffixe = '/week-end';

            return normaliserNombreDecimalPourWeda(valeurBrute) + ' verres' + suffixe;
        }

        if (
            source.includes('alcool occasionnel') ||
            source.includes('consommation occasionnelle') ||
            source.includes('boit occasionnellement') ||
            source.includes('alcool social') ||
            source.includes('consommation sociale')
        ) return 'Occasionnel';

        return null;
    }

    /************************************************************
     * EXTRACTION : PRESSION ARTÉRIELLE
     ************************************************************/

    function contexteIndiqueAutomesure(contexteNormalise) {
        const n = normaliserTexte(contexteNormalise);
        const tokens = n.split(' ');

        return (
            n.includes('automesure') ||
            n.includes('auto mesure') ||
            n.includes('auto-mesure') ||
            tokens.includes('amt') ||
            n.includes('domicile') ||
            n.includes('maison') ||
            n.includes('a la maison') ||
            n.includes('a domicile') ||
            n.includes('au domicile') ||
            n.includes('chez lui') ||
            n.includes('chez elle') ||
            n.includes('chez le patient') ||
            n.includes('moyenne tensionnelle') ||
            n.includes('moyenne des tensions') ||
            n.includes('moyenne des mesures') ||
            n.includes('releve tensionnel') ||
            n.includes('releve a domicile')
        );
    }

    function contexteIndiquePression(contexteNormalise) {
        const n = normaliserTexte(contexteNormalise);
        const tokens = n.split(' ');
        return (
            tokens.includes('ta') ||
            tokens.includes('pa') ||
            tokens.includes('amt') ||
            n.includes('tension') ||
            n.includes('pression') ||
            n.includes('arterielle') ||
            contexteIndiqueAutomesure(n)
        );
    }

    function normaliserPressionArterielle(sysBrut, diaBrut, avecContexte) {
        let sys = parseInt(String(sysBrut || '').trim(), 10);
        let dia = parseInt(String(diaBrut || '').trim(), 10);

        if (!Number.isFinite(sys) || !Number.isFinite(dia)) return null;

        if (avecContexte && sys >= 8 && sys <= 25 && dia >= 4 && dia <= 15 && sys > dia) {
            const sysAvantCorrection = sys;
            const diaAvantCorrection = dia;
            sys = sys * 10;
            dia = dia * 10;
            enregistrerCorrectionQualite('tension artérielle', String(sysAvantCorrection) + '/' + String(diaAvantCorrection), String(sys) + '/' + String(dia), 'format oral converti en mmHg');
        }

        if (sys >= 70 && sys <= 260 && dia >= 30 && dia <= 160 && sys > dia) {
            return {
                systolique: String(sys),
                diastolique: String(dia),
                texte: String(sys) + '/' + String(dia),
                sysNum: sys,
                diaNum: dia
            };
        }

        return null;
    }

    function pressionEstAutomesurePourCeMatch(source, matchStart, matchEnd) {
        const avantCourt = source.slice(Math.max(0, matchStart - 60), matchStart);
        const apresCourt = source.slice(matchEnd, Math.min(source.length, matchEnd + 45));

        const avantNormalise = normaliserTexte(avantCourt);
        const apresNormalise = normaliserTexte(apresCourt);

        if (contexteIndiqueAutomesure(avantNormalise)) return true;

        const motApres = apresNormalise.match(/\b(?:automesure|auto mesure|auto-mesure|amt|domicile|maison)\b/);

        if (motApres) {
            const texteAvantMot = apresNormalise.slice(0, motApres.index);
            if (!texteAvantMot.includes('(') && !texteAvantMot.includes(')') && !texteAvantMot.includes(';') && !texteAvantMot.includes('.')) return true;
        }

        return false;
    }

    function extrairePressionsArteriellesDepuisTexte(texte) {
        let source = String(texte || '').replaceAll(String.fromCharCode(160), ' ');
        source = source.split(String.fromCharCode(10)).join(' ');
        source = source.split(String.fromCharCode(13)).join(' ');
        source = source.replace(/ {2,}/g, ' ');

        const sourceRecherche = normaliserTexte(source);
        const resultats = { cabinet: null, automesure: null };

        function enregistrerAutomesureExpliciteDepuisRegex(regex, nomRegex) {
            let match;
            while ((match = regex.exec(sourceRecherche)) !== null) {
                const pression = normaliserPressionArterielle(match[1], match[2], true);
                if (!pression) continue;

                resultats.automesure = pression;
                console.info('[AUTO-HH] Automesure tensionnelle détectée explicitement par ' + nomRegex + ' :', {
                    pression,
                    extrait: match[0]
                });
                return true;
            }
            return false;
        }

        enregistrerAutomesureExpliciteDepuisRegex(
            /(?:^|[^a-z0-9])(?:amt|automesure|auto[ -]?mesure|a domicile|domicile|maison)[^0-9]{0,35}([0-9]{1,3}) *[/] *([0-9]{1,3})(?![0-9])/gi,
            'mot-cle-avant-valeur'
        );

        if (!resultats.automesure) {
            enregistrerAutomesureExpliciteDepuisRegex(
                /([0-9]{1,3}) *[/] *([0-9]{1,3})(?![0-9])[^.;)]{0,45}(?:^|[^a-z0-9])(?:amt|automesure|auto[ -]?mesure|a domicile|domicile|maison)/gi,
                'valeur-avant-mot-cle'
            );
        }

        const regex = /(?:^|[^0-9])([0-9]{1,3}) *[/] *([0-9]{1,3})(?![0-9])/g;
        let match;

        while ((match = regex.exec(source)) !== null) {
            const premierCaractere = String(match[0] || '').charAt(0);
            const prefixLength = (premierCaractere < '0' || premierCaractere > '9') ? 1 : 0;
            const matchStart = match.index + prefixLength;
            const matchEnd = regex.lastIndex;

            const contexteAvant = source.slice(Math.max(0, matchStart - 90), matchStart);
            const contexteApresProche = source.slice(matchEnd, Math.min(source.length, matchEnd + 45));
            const contextePourValidation = normaliserTexte(contexteAvant + ' ' + contexteApresProche);

            const avecContexte = contexteIndiquePression(contextePourValidation);
            const pression = normaliserPressionArterielle(match[1], match[2], avecContexte);

            if (!pression) continue;
            if (!avecContexte) continue;

            const estAutomesure = pressionEstAutomesurePourCeMatch(source, matchStart, matchEnd);

            if (estAutomesure) {
                if (!resultats.automesure) resultats.automesure = pression;
            } else {
                if (!resultats.cabinet) resultats.cabinet = pression;
            }

            if (resultats.cabinet && resultats.automesure) break;
        }

        return resultats;
    }

    /************************************************************
     * EXTRACTION : DÉPISTAGES / SUIVIS
     ************************************************************/

    function contexteIndiqueAFaireDepistage(contexteNormalise) {
        return contientUnDesTextes(contexteNormalise, [
            'a faire', 'a prevoir', 'a programmer', 'a planifier', 'a realiser', 'a refaire', 'a renouveler',
            'doit faire', 'devra faire', 'prescrit', 'prescrite', 'prescription', 'programme', 'programmee',
            'non fait', 'non faite', 'non realise', 'non realisee', 'jamais fait', 'jamais faite',
            'pas fait', 'pas faite', 'en attente', 'absence de realisation', 'absence de depistage',
            'absence de test', 'absence de frottis', 'absence de fcu', 'absence de fcv', 'absence d hemocult',
            'absence d hemoccult', 'absence de test immunologique', 'absence de depistage colorectal',
            'pas de depistage', 'pas de test', 'pas de frottis', 'pas de fcu', 'pas de fcv',
            'pas d hemocult', 'pas d hemoccult', 'pas de test immunologique', 'pas de depistage colorectal',
            'pas a jour', 'non a jour', 'plus a jour', 'en retard'
        ]);
    }

    function extraireDepistageDepuisTexte(texte, options) {
        const source = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        const regex = options.regex;
        let match;
        let dateTrouvee = null;
        let aFaireTrouve = false;

        while ((match = regex.exec(source)) !== null) {
            const segment = segmentAutourIndex(source, match.index);
            const segmentNormalise = normaliserTexte(segment);

            if (contexteIndiqueAFaireDepistage(segmentNormalise)) {
                aFaireTrouve = true;
                continue;
            }

            const date = extraireDateDepuisContexte(segment);
            if (date && !dateTrouvee) dateTrouvee = date;
        }

        if (aFaireTrouve) return 'A faire';
        if (dateTrouvee) return dateTrouvee;
        return null;
    }

    function extraireHemocultDepuisTexte(texte) {
        return extraireDepistageDepuisTexte(texte, {
            nom: 'hémocult / dépistage colorectal',
            regex: /\b(?:h[eé]mocult|hemocult|h[eé]moccult|hemoccult|test\s+immunologique|fit|test\s+fit|depistage\s+colorectal|d[eé]pistage\s+colorectal|depistage\s+cancer\s+colorectal|d[eé]pistage\s+cancer\s+colorectal|depistage\s+ccr|d[eé]pistage\s+ccr|test\s+colorectal|recherche\s+de\s+sang\s+dans\s+les\s+selles|sang\s+dans\s+les\s+selles)\b/gi
        });
    }

    function extraireFrottisDepuisTexte(texte) {
        return extraireDepistageDepuisTexte(texte, {
            nom: 'frottis',
            regex: /\b(?:frottis|fcu|fcv|cervico[-\s]*uterin|cervico[-\s]*ut[eé]rin|cervico[-\s]*uterine|cervico[-\s]*ut[eé]rine|cervico[-\s]*vaginal|cervico[-\s]*vaginale|hpv|test\s+hpv)\b/gi
        });
    }

    function extraireMammographieDepuisTexte(texte) {
        return extraireDepistageDepuisTexte(texte, {
            nom: 'mammographie',
            regex: /\b(?:mammographie|mammo|depistage\s+mammaire|d[eé]pistage\s+mammaire|depistage\s+du\s+sein|d[eé]pistage\s+du\s+sein)\b/gi
        });
    }

    function extraireAgeDepuisContexte(contexte) {
        const normalise = normaliserTexte(contexte);
        const match = normalise.match(/\b(?:a|age de|l age de|a l age de)\s*(\d{1,3})\s*ans\b/);
        if (!match) return null;
        const age = parseInt(match[1], 10);
        if (!Number.isFinite(age) || age < 0 || age > 120) return null;
        return String(age) + ' ans';
    }

    function extraireDentisteDepuisTexte(texte) {
        const source = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        const regex = /\b(?:dentiste|dentaire|dentaires|chirurgien[-\s]*dentiste|chirurgienne[-\s]*dentiste|consultation\s+dentaire|consultations\s+dentaires|controle\s+dentaire|contrôle\s+dentaire|bilan\s+dentaire|soins\s+dentaires|suivi\s+dentaire|rdv\s+dentiste|rendez[-\s]*vous\s+dentiste)\b/gi;
        let match;
        let aFaire = false;
        let ageTrouve = null;

        while ((match = regex.exec(source)) !== null) {
            const segment = segmentAutourIndex(source, match.index);
            const n = normaliserTexte(segment);

            const annee = extraireAnneeDepuisContexte(segment);
            if (annee) return annee;

            const age = extraireAgeDepuisContexte(segment);
            if (age && !ageTrouve) ageTrouve = age;

            if (contientUnDesTextes(n, [
                'a faire', 'a prevoir', 'a programmer', 'a planifier', 'a realiser', 'a reprendre',
                'doit voir', 'devra voir', 'controle a faire', 'bilan a faire', 'consultation a prevoir',
                'rdv a prendre', 'rendez vous a prendre', 'non fait', 'non realise', 'pas fait',
                'non a jour', 'pas a jour', 'plus a jour', 'en retard', 'pas vu de dentiste',
                'n a pas vu de dentiste', 'jamais vu de dentiste', 'pas de suivi dentaire',
                'absence de suivi dentaire', 'depuis longtemps'
            ])) aFaire = true;
        }

        if (ageTrouve) return ageTrouve;
        if (aFaire) return 'A faire';
        return null;
    }

    function extraireDtpDepuisTexte(texte) {
        const source = String(texte || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
        const regex = /\b(?:d\s*\.?\s*t\s*\.?\s*p|dtp|diphterie[-\s]*tetanos[-\s]*polio|dipht[eé]rie[-\s]*t[eé]tanos[-\s]*polio|t[eé]tanos[-\s]*polio|vaccin\s+(?:du\s+)?t[eé]tanos|vaccination\s+(?:du\s+)?t[eé]tanos|rappel\s+(?:du\s+)?t[eé]tanos|revaxis|boostrix|repevax)\b/gi;
        let match;
        let aFaire = false;
        let ageTrouve = null;

        while ((match = regex.exec(source)) !== null) {
            const segment = segmentAutourIndex(source, match.index);
            const n = normaliserTexte(segment);

            const annee = extraireAnneeDepuisContexte(segment);
            if (annee) return annee;

            const age = extraireAgeDepuisContexte(segment);
            if (age && !ageTrouve) ageTrouve = age;

            if (contientUnDesTextes(n, [
                'a faire', 'a prevoir', 'a programmer', 'a planifier', 'a realiser', 'a refaire',
                'a renouveler', 'rappel a faire', 'rappel a prevoir', 'vaccin a faire',
                'vaccination a renouveler', 'doit faire', 'devra faire', 'prescrit',
                'prescription', 'non fait', 'pas fait', 'non a jour', 'pas a jour',
                'plus a jour', 'en retard', 'retard vaccinal'
            ])) aFaire = true;
        }

        if (ageTrouve) return ageTrouve;
        if (aFaire) return 'A faire';
        return null;
    }

    function extrairePapillomavirusDepuisTexte(texte) {
        const segments = decouperEnSegments(texte);
        let fait = false;
        let nonFait = false;

        for (const segment of segments) {
            const n = normaliserTexte(segment);

            const concerne =
                n.includes('gardasil') ||
                n.includes('papillomavirus') ||
                n.includes('papilloma virus') ||
                (n.includes('hpv') && (n.includes('vaccin') || n.includes('vaccination') || n.includes('vaccine')));

            if (!concerne) continue;

            if (contientUnDesTextes(n, [
                'non fait', 'non faite', 'pas fait', 'pas faite', 'non realise', 'non realisee',
                'pas realise', 'pas realisee', 'pas eu', 'n a pas eu', 'jamais eu',
                'n a jamais eu', 'absence de vaccin', 'absence de vaccination', 'pas de vaccin',
                'pas de vaccination', 'non vaccine', 'non vaccinee', 'pas vaccine', 'pas vaccinee',
                'a faire', 'a prevoir', 'a programmer', 'a planifier', 'a realiser', 'a proposer',
                'refus', 'refuse', 'refusee'
            ])) {
                nonFait = true;
                continue;
            }

            if (contientUnDesTextes(n, [
                'fait', 'faite', 'realise', 'realisee', 'effectue', 'effectuee',
                'a eu', 'a recu', 'recu', 'recue', 'injecte', 'injectee',
                'vaccine', 'vaccinee', 'vaccination complete', 'schema complet',
                'schema vaccinal complet', 'a jour', '1ere dose', 'premiere dose',
                '2e dose', 'deuxieme dose', '3e dose', 'troisieme dose'
            ])) fait = true;
        }

        if (nonFait) return 'Non fait';
        if (fait) return 'Fait';
        return null;
    }

    function segmentConcerneExamenPieds(n) {
        return (
            n.includes('examen des pieds') ||
            n.includes('examen du pied') ||
            n.includes('pieds examines') ||
            n.includes('pied examine') ||
            n.includes('pied diabetique') ||
            n.includes('pieds diabetiques') ||
            n.includes('monofilament') ||
            n.includes('sensibilite plantaire') ||
            n.includes('sensibilite des pieds') ||
            n.includes('pouls pedieux') ||
            n.includes('pouls tibiaux') ||
            n.includes('plaie du pied') ||
            n.includes('plaies des pieds') ||
            n.includes('podologue') ||
            n.includes('pedicure podologue') ||
            n.includes('pedicure-podologue') ||
            n.includes('bilan podologique') ||
            n.includes('consultation podologue') ||
            n.includes('suivi podologique') ||
            n.includes('soins podologiques')
        );
    }

    function extraireExamenPiedsDepuisTexte(texte) {
        const segments = decouperEnSegments(texte);
        let ceJour = false;
        let fait = false;
        let aFaire = false;

        for (const segment of segments) {
            const n = normaliserTexte(segment);
            if (!segmentConcerneExamenPieds(n)) continue;

            const annee = extraireAnneeDepuisContexte(segment);
            if (annee) return annee;

            if (contientUnDesTextes(n, [
                'a faire', 'a prevoir', 'a programmer', 'a planifier', 'a realiser',
                'a refaire', 'a renouveler', 'doit faire', 'devra faire',
                'rdv a prendre', 'rendez vous a prendre', 'consultation a prevoir',
                'controle a faire', 'bilan a faire', 'non fait', 'non faite',
                'non realise', 'non realisee', 'pas fait', 'pas faite', 'pas realise',
                'pas examine', 'pas vu', 'n a pas vu', 'jamais vu', 'n a jamais vu',
                'absence de suivi', 'absence de consultation', 'absence d examen',
                'pas de suivi', 'pas de consultation', 'pas d examen',
                'non a jour', 'pas a jour', 'plus a jour', 'en retard', 'depuis longtemps'
            ])) {
                aFaire = true;
                continue;
            }

            if (contientUnDesTextes(n, [
                'ce jour', 'aujourd hui', 'aujourdhui', 'pendant la consultation',
                'lors de la consultation', 'fait en consultation',
                'realise en consultation', 'realise ce jour', 'fait ce jour'
            ])) {
                ceJour = true;
                continue;
            }

            if (contientUnDesTextes(n, [
                'fait', 'faite', 'realise', 'realisee', 'effectue', 'effectuee',
                'examine', 'examines', 'examinee', 'examinees', 'normal', 'normaux',
                'sensibilite conservee', 'monofilament normal', 'vu podologue',
                'vue podologue', 'a vu le podologue', 'a vu la podologue',
                'consulte le podologue', 'consulte la podologue',
                'bilan podologique', 'soins podologiques', 'suivi podologique'
            ])) fait = true;
        }

        if (ceJour) return 'Ce jour';
        if (aFaire) return 'A faire';
        if (fait) return 'Fait';
        return null;
    }

    function segmentConcerneFondOeil(n) {
        const avecEspaces = ' ' + n + ' ';
        return (
            n.includes('fond d oeil') ||
            n.includes('fond d œil') ||
            n.includes('fonds d oeil') ||
            n.includes('fonds d œil') ||
            avecEspaces.includes(' fo ') ||
            n.includes('ophtalmo') ||
            n.includes('ophtalmologue') ||
            n.includes('ophtalmologie') ||
            n.includes('consultation ophtalmo') ||
            n.includes('consultation ophtalmologique') ||
            n.includes('suivi ophtalmo') ||
            n.includes('suivi ophtalmologique') ||
            n.includes('retinographie') ||
            n.includes('retinopathie diabetique') ||
            n.includes('depistage retinopathie')
        );
    }

    function extraireFondOeilDepuisTexte(texte) {
        const segments = decouperEnSegments(texte);
        let aFaire = false;

        for (const segment of segments) {
            const n = normaliserTexte(segment);
            if (!segmentConcerneFondOeil(n)) continue;

            const annee = extraireAnneeDepuisContexte(segment);
            if (annee) return annee;

            if (contientUnDesTextes(n, [
                'a faire', 'a voir', 'a revoir', 'a orienter', 'orienter vers',
                'a adresser', 'adresser a', 'a prevoir', 'a programmer',
                'a planifier', 'a realiser', 'a refaire', 'a renouveler',
                'doit faire', 'devra faire', 'doit voir', 'devra voir',
                'rdv a prendre', 'rendez vous a prendre', 'consultation a prevoir',
                'controle a faire', 'bilan a faire', 'non fait', 'non faite',
                'non realise', 'non realisee', 'pas fait', 'pas faite',
                'pas realise', 'pas realisee', 'pas vu', 'n a pas vu',
                'jamais vu', 'n a jamais vu', 'absence de suivi',
                'absence de consultation', 'pas de suivi', 'pas de consultation',
                'pas de controle', 'non a jour', 'pas a jour', 'plus a jour',
                'en retard', 'depuis longtemps'
            ])) aFaire = true;
        }

        if (aFaire) return 'A faire';
        return null;
    }

    function segmentConcerneCardiologue(n) {
        const avecEspaces = ' ' + n + ' ';
        return (
            avecEspaces.includes(' cardio ') ||
            n.includes('cardiologue') ||
            n.includes('cardiologie') ||
            n.includes('consultation cardio') ||
            n.includes('consultation cardiologique') ||
            n.includes('bilan cardio') ||
            n.includes('bilan cardiologique') ||
            n.includes('suivi cardio') ||
            n.includes('suivi cardiologique') ||
            n.includes('avis cardio') ||
            n.includes('avis cardiologique') ||
            n.includes('echographie cardiaque') ||
            n.includes('echo cardiaque') ||
            n.includes('echocardiographie') ||
            n.includes('holter') ||
            n.includes('ecg')
        );
    }

    function extraireCardiologueDepuisTexte(texte) {
        const segments = decouperEnSegments(texte);
        let aVoir = false;

        for (const segment of segments) {
            const n = normaliserTexte(segment);
            if (!segmentConcerneCardiologue(n)) continue;

            const annee = extraireAnneeDepuisContexte(segment);
            if (annee) return annee;

            if (contientUnDesTextes(n, [
                'a voir', 'a revoir', 'a prevoir', 'a programmer', 'a planifier',
                'a adresser', 'a orienter', 'orienter vers', 'doit voir',
                'devra voir', 'rdv a prendre', 'rendez vous a prendre',
                'consultation a prevoir', 'avis a demander', 'bilan a faire',
                'non vu', 'pas vu', 'n a pas vu', 'jamais vu',
                'n a jamais vu', 'absence de suivi', 'absence de consultation',
                'pas de suivi', 'pas de consultation', 'pas d avis',
                'non a jour', 'pas a jour', 'plus a jour', 'en retard',
                'depuis longtemps'
            ])) aVoir = true;
        }

        if (aVoir) return 'A voir';
        return null;
    }

    /************************************************************
     * EXTRACTION : ÉTIQUETTES
     ************************************************************/

    function extraireVerresAlcoolParSemaineDepuisValeur(valeurAlcool) {
        const valeur = normaliserTexte(valeurAlcool).replace(',', '.');
        const nombre = parseFloat(valeur);
        if (!Number.isFinite(nombre)) return null;

        if (valeur.includes('/j') || valeur.includes('par jour')) return nombre * 7;
        if (valeur.includes('/sem') || valeur.includes('par semaine')) return nombre;
        if (valeur.includes('/mois') || valeur.includes('par mois')) return nombre / 4.345;
        if (valeur.includes('/week-end') || valeur.includes('/week end') || valeur.includes('/we')) return nombre;
        return null;
    }

    function segmentNieThemeAutoHH67(segmentNormalise, themes) {
        const n = ' ' + normaliserTexte(segmentNormalise) + ' ';
        const listeThemes = Array.isArray(themes) ? themes : [themes];

        return listeThemes.some(themeBrut => {
            const theme = normaliserTexte(themeBrut);
            if (!theme) return false;

            const expressions = [
                'pas de ' + theme,
                'pas d ' + theme,
                'absence de ' + theme,
                'absence d ' + theme,
                'aucun ' + theme,
                'aucune ' + theme,
                'sans ' + theme,
                'ni ' + theme,
                'jamais de ' + theme,
                'jamais d ' + theme,
                theme + ' absent',
                theme + ' absente',
                theme + ' negatif',
                theme + ' negative',
                theme + ' exclu',
                theme + ' exclue',
                theme + ' ecarte',
                theme + ' ecartee'
            ];

            return expressions.some(expression => n.includes(' ' + expression + ' '));
        });
    }

    function unSegmentAffirmeThemeAutoHH67(texte, themes, predicate) {
        return decouperEnSegments(texte).some(segment => {
            const n = normaliserTexte(segment);
            if (segmentNieThemeAutoHH67(n, themes)) return false;
            return predicate(n, segment);
        });
    }

    function texteIndiqueProblemeAlcool(sourceNormalisee) {
        return unSegmentAffirmeThemeAutoHH67(sourceNormalisee, ['alcool', 'alcoolisme', 'ethylisme'], n => contientUnDesTextes(n, [
            'alcoolisme', 'ethylisme', 'dependance alcool', 'dependance a l alcool',
            'trouble de l usage d alcool', 'mesusage alcool', 'mesusage d alcool',
            'abus d alcool', 'consommation excessive d alcool', 'consommation excessive alcool',
            'alcoolisation excessive', 'intoxication alcoolique', 'ivresse', 'sevrage alcool',
            'sevre alcool', 'sevre de l alcool', 'ancien ethylisme', 'bouteille de whisky',
            'bouteille de vodka', 'bouteille de rhum', 'bouteille de pastis', 'bouteille de ricard'
        ]));
    }

    function tagAlcoolIndiqueDepuisTexte(texte) {
        const brut = String(texte || '').replaceAll(String.fromCharCode(160), ' ');
        const n = normaliserTexte(brut);
        const alcool = extraireAlcoolDepuisTexte(brut);

        if (texteIndiqueProblemeAlcool(n)) return true;
        if (!alcool) return false;
        if (alcool === 'Pas d’alcool' || alcool === 'Occasionnel') return false;
        if (alcool === 'Sevré') return true;

        const verresParSemaine = extraireVerresAlcoolParSemaineDepuisValeur(alcool);
        return Number.isFinite(verresParSemaine) && verresParSemaine > 4;
    }

    function segmentNieChute(segmentNormalise) {
        return contientUnDesTextes(segmentNormalise, [
            'pas de chute', 'aucune chute', 'absence de chute', 'sans chute',
            'n a pas chute', 'pas chute', 'pas tombe', 'pas tombee',
            'ne tombe pas', 'risque de chute', 'prevention des chutes', 'peur de chuter'
        ]);
    }

    function tagChuteIndiqueDepuisTexte(texte) {
        const segments = decouperEnSegments(texte);
        return segments.some(segment => {
            const n = normaliserTexte(segment);
            if (segmentNieChute(n)) return false;
            return (
                n.includes('chute') ||
                n.includes('a chute') ||
                n.includes('est tombe') ||
                n.includes('est tombee') ||
                n.includes('tombe ce jour') ||
                n.includes('tombee ce jour') ||
                n.includes('traumatisme apres chute') ||
                n.includes('traumatisme suite a chute')
            );
        });
    }

    function texteIndiqueTraitementTension(sourceNormalisee) {
        return contientUnDesTextes(sourceNormalisee, [
            'traitement antihypertenseur', 'antihypertenseur', 'traitement contre la tension',
            'traitement pour la tension', 'traitement hta', 'sous traitement pour hta',
            'sous traitement antihypertenseur', 'ramipril', 'perindopril', 'lisinopril',
            'enalapril', 'candesartan', 'losartan', 'valsartan', 'irbesartan',
            'telmisartan', 'olmesartan', 'amlodipine', 'lercanidipine', 'nicardipine',
            'hydrochlorothiazide', 'indapamide', 'furosemide', 'spironolactone'
        ]);
    }

    function tagHtaIndiqueDepuisTexte(texte) {
        const brut = String(texte || '').replaceAll(String.fromCharCode(160), ' ');
        const tensions = extrairePressionsArteriellesDepuisTexte(brut);

        if (tensions.cabinet && (tensions.cabinet.sysNum >= 140 || tensions.cabinet.diaNum >= 90)) return true;
        if (tensions.automesure && (tensions.automesure.sysNum >= 135 || tensions.automesure.diaNum >= 85)) return true;

        return unSegmentAffirmeThemeAutoHH67(brut, ['hta', 'hypertension', 'hypertension arterielle', 'antihypertenseur', 'traitement tension'], n => {
            const espace = ' ' + n + ' ';
            return texteIndiqueTraitementTension(n) || espace.includes(' hta ') || n.includes('hypertension arterielle') || n.includes('traitement contre la tension') || n.includes('traitement pour la tension');
        });
    }

    function texteIndiqueTraitementDepression(sourceNormalisee) {
        return contientUnDesTextes(sourceNormalisee, [
            'traitement antidepresseur', 'sous antidepresseur', 'traitement contre la depression',
            'traitement pour depression', 'traitement syndrome depressif', 'sertraline', 'zoloft',
            'escitalopram', 'seroplex', 'paroxetine', 'deroxat', 'fluoxetine', 'prozac',
            'venlafaxine', 'effexor', 'duloxetine', 'cymbalta', 'mirtazapine', 'norset',
            'vortioxetine', 'brintellix', 'citalopram', 'seropram', 'mianserine'
        ]);
    }

    function tagSyndromeDepressifIndiqueDepuisTexte(texte) {
        const brut = String(texte || '').replaceAll(String.fromCharCode(160), ' ');
        const scoreMadrs = parseInt(extraireScoreMadrsDepuisTexte(brut), 10);
        if (Number.isFinite(scoreMadrs) && scoreMadrs > 12) return true;

        return unSegmentAffirmeThemeAutoHH67(brut, ['depression', 'syndrome depressif', 'antidepresseur', 'traitement antidepresseur'], n => texteIndiqueTraitementDepression(n));
    }

    function tagEtpIndiqueDepuisTexte(texte) {
        return unSegmentAffirmeThemeAutoHH67(texte, ['etp', 'education therapeutique'], n => (
            n.includes('etp en cours') ||
            n.includes('programme etp') ||
            n.includes('programme d education therapeutique') ||
            n.includes('education therapeutique en cours') ||
            n.includes('atelier etp') ||
            n.includes('ateliers etp') ||
            n.includes('participe a l etp') ||
            n.includes('participe a un programme etp') ||
            n.includes('inclusion etp')
        ));
    }

    function nombreDepuisToken(token) {
        let chiffres = '';
        String(token || '').split('').forEach(caractere => {
            if (caractere >= '0' && caractere <= '9') chiffres += caractere;
        });
        if (!chiffres) return null;
        const valeur = parseInt(chiffres, 10);
        return Number.isFinite(valeur) ? valeur : null;
    }

    function extraireValeursBnpDepuisTexte(texte) {
        const source = normaliserTexte(texte)
            .replaceAll(':', ' ')
            .replaceAll('=', ' ')
            .replaceAll('>', ' ')
            .replaceAll('<', ' ')
            .replaceAll('/', ' ')
            .replaceAll('-', ' ');

        const tokens = source.split(' ').filter(Boolean);
        const valeurs = [];

        tokens.forEach((token, index) => {
            const estBnp = token === 'bnp' || token === 'ntprobnp' || (token === 'nt' && tokens[index + 1] === 'pro' && tokens[index + 2] === 'bnp');
            if (!estBnp) return;

            for (let i = Math.max(0, index - 4); i <= Math.min(tokens.length - 1, index + 5); i += 1) {
                const valeur = nombreDepuisToken(tokens[i]);
                if (Number.isFinite(valeur)) valeurs.push(valeur);
            }
        });

        return valeurs;
    }

    function tagIcIndiqueDepuisTexte(texte) {
        const valeursBnp = extraireValeursBnpDepuisTexte(texte);
        if (valeursBnp.some(valeur => valeur > 1000)) return true;

        return unSegmentAffirmeThemeAutoHH67(texte, ['ic', 'insuffisance cardiaque', 'bnp', 'nt pro bnp'], n => {
            const espace = ' ' + n + ' ';
            return espace.includes(' ic ') || n.includes('insuffisance cardiaque') || n.includes('decompensation cardiaque') || n.includes('decompensation d insuffisance cardiaque') || n.includes('oedeme pulmonaire cardiogenique') || n.includes('oap cardiogenique');
        });
    }

    function tagAsaleeIndiqueDepuisTexte(texte) {
        return unSegmentAffirmeThemeAutoHH67(texte, ['asalee', 'azalee', 'genevieve'], n => (
            n.includes('asalee') ||
            n.includes('azalee') ||
            n.includes('genevieve') ||
            n.includes('orientation infirmiere asalee') ||
            n.includes('orientation infirmiere azalee') ||
            n.includes('infirmiere asalee') ||
            n.includes('infirmiere azalee')
        ));
    }

    function tagDt2IndiqueDepuisTexteAutoHH67(texte) {
        return unSegmentAffirmeThemeAutoHH67(texte, ['dt2', 'diabete', 'diabete type 2', 'diabete de type 2'], n => {
            const espace = ' ' + n + ' ';
            return espace.includes(' dt2 ') || n.includes('diabete de type 2') || n.includes('diabete type 2') || n.includes('diabetique type 2') || n.includes('diabete non insulinodependant') || espace.includes(' dnid ') || n.includes('metformine') || n.includes('hba1c') || n.includes('hemoglobine glyquee');
        });
    }

    function tagCovidIndiqueDepuisTexteAutoHH67(texte) {
        return unSegmentAffirmeThemeAutoHH67(texte, ['covid', 'sars cov 2'], n => n.includes('covid') || n.includes('sars cov 2') || n.includes('sars-cov-2') || n.includes('test antigenique') || n.includes('pcr covid'));
    }

    function tagAngineIndiqueDepuisTexteAutoHH67(texte) {
        return unSegmentAffirmeThemeAutoHH67(texte, ['angine', 'amygdalite', 'streptocoque'], n => n.includes('angine') || n.includes('odynophagie') || n.includes('tdr angine') || n.includes('streptocoque') || n.includes('amygdalite'));
    }

    function tagOngleIncarneIndiqueDepuisTexteAutoHH67(texte) {
        return unSegmentAffirmeThemeAutoHH67(texte, ['ongle incarne', 'onychocryptose'], n => n.includes('ongle incarne') || n.includes('onychocryptose'));
    }

    function tagSoinsPalliatifsIndiqueDepuisTexteAutoHH67(texte) {
        return unSegmentAffirmeThemeAutoHH67(texte, ['soins palliatifs', 'palliatif', 'fin de vie'], n => n.includes('soins palliatifs') || n.includes('palliatif') || n.includes('palliative') || n.includes('fin de vie') || n.includes('had palliative') || n.includes('sedation') || n.includes('morphine palliative'));
    }

    function extraireEtiquettesDepuisTexte(texte) {
        const etiquettes = [];
        const brut = String(texte || '').replaceAll(String.fromCharCode(160), ' ');
        const tabac = extraireTabacDepuisTexte(brut);

        if (tagAlcoolIndiqueDepuisTexte(brut)) ajouterUnique(etiquettes, 'Alcool');
        if (tabac && tabac !== 'Non fumeur') ajouterUnique(etiquettes, 'Tabac');
        if (tagHtaIndiqueDepuisTexte(brut)) ajouterUnique(etiquettes, 'HTA');
        if (tagDt2IndiqueDepuisTexteAutoHH67(brut)) ajouterUnique(etiquettes, 'DT2');
        if (tagSyndromeDepressifIndiqueDepuisTexte(brut)) ajouterUnique(etiquettes, 'Syndrome dépressif');
        if (tagIcIndiqueDepuisTexte(brut)) ajouterUnique(etiquettes, 'IC');
        if (tagCovidIndiqueDepuisTexteAutoHH67(brut)) ajouterUnique(etiquettes, 'CoViD');
        if (tagAngineIndiqueDepuisTexteAutoHH67(brut)) ajouterUnique(etiquettes, 'Angine');
        if (tagChuteIndiqueDepuisTexte(brut)) ajouterUnique(etiquettes, 'Chute');
        if (tagAsaleeIndiqueDepuisTexte(brut)) ajouterUnique(etiquettes, 'ASALEE');
        if (tagEtpIndiqueDepuisTexte(brut)) ajouterUnique(etiquettes, 'ETP');
        if (tagOngleIncarneIndiqueDepuisTexteAutoHH67(brut)) ajouterUnique(etiquettes, 'Ongle incarné');
        if (tagSoinsPalliatifsIndiqueDepuisTexteAutoHH67(brut)) ajouterUnique(etiquettes, 'Soins palliatifs');

        return etiquettes.filter(etiquette => ETIQUETTES_WEDA_DISPONIBLES.includes(etiquette));
    }

    function creerRapportExtractionDepuisTexte(texte, contexte = {}) {
        resetCorrectionsQualiteConstantes();

        const poids = extrairePoidsDepuisTexte(texte);
        const taille = extraireTailleDepuisTexte(texte);
        const temperature = extraireTemperatureDepuisTexte(texte);
        const tensions = extrairePressionsArteriellesDepuisTexte(texte);
        const tabac = extraireTabacDepuisTexte(texte);
        const alcool = extraireAlcoolDepuisTexte(texte);
        const examenPieds = extraireExamenPiedsDepuisTexte(texte);
        const hemocult = extraireHemocultDepuisTexte(texte);
        const frottis = extraireFrottisDepuisTexte(texte);
        const mammographie = extraireMammographieDepuisTexte(texte);
        const dentiste = extraireDentisteDepuisTexte(texte);
        const dtp = extraireDtpDepuisTexte(texte);
        const papillomavirus = extrairePapillomavirusDepuisTexte(texte);
        const fondOeil = extraireFondOeilDepuisTexte(texte);
        const cardiologue = extraireCardiologueDepuisTexte(texte);
        const mms = extraireScoreMmsDepuisTexte(texte);
        const madrs = extraireScoreMadrsDepuisTexte(texte);
        const tags = extraireEtiquettesDepuisTexte(texte);
        const corrections = getCorrectionsQualiteConstantes();

        return {
            version: VERSION_AUTO_HH,
            timestamp: Date.now(),
            contexte: contexte,
            champs: {
                poids,
                taille,
                temperature,
                tensionCabinet: tensions.cabinet ? tensions.cabinet.texte : null,
                tensionSystolique: tensions.cabinet ? tensions.cabinet.systolique : null,
                tensionDiastolique: tensions.cabinet ? tensions.cabinet.diastolique : null,
                automesure: tensions.automesure ? tensions.automesure.texte : null,
                tabac,
                alcool,
                examenPieds,
                hemocult,
                frottis,
                mammographie,
                dentiste,
                dtp,
                papillomavirus,
                fondOeil,
                cardiologue,
                mms,
                madrs
            },
            tags,
            correctionsQualite: corrections
        };
    }

    function enregistrerRapportExtraction(rapport) {
        try { GM_setValue(CLE_LAST_REPORT, rapport); } catch (e) {}
        try { window.AUTO_HH_DERNIER_RAPPORT = rapport; } catch (e) {}
        console.info('[AUTO-HH] Rapport extraction :', rapport);
        return rapport;
    }

    function afficherDernierRapportExtraction() {
        const rapport = GM_getValue(CLE_LAST_REPORT, null) || window.AUTO_HH_DERNIER_RAPPORT || null;
        if (!rapport) {
            console.info('[AUTO-HH] Aucun rapport d’extraction enregistré.');
            return null;
        }
        console.info('[AUTO-HH] Dernier rapport extraction complet :', rapport);
        try { console.table(rapport.champs || {}); } catch (e) {}
        try { console.table(rapport.correctionsQualite || []); } catch (e) {}
        console.info('[AUTO-HH] Tags détectés :', rapport.tags || []);
        return rapport;
    }

    /************************************************************
     * OUTILS CHAMPS WEDA
     ************************************************************/

    function collecterDocumentsAccessibles(docInitial) {
        const docs = [];
        const dejaVus = new Set();

        function visiter(doc) {
            if (!doc || dejaVus.has(doc)) return;
            dejaVus.add(doc);
            docs.push(doc);

            const frames = [...doc.querySelectorAll('iframe, frame')];
            for (const frame of frames) {
                try {
                    if (frame.contentDocument) visiter(frame.contentDocument);
                } catch (e) {}
            }
        }

        visiter(docInitial);
        return docs;
    }

    function getElementDansDocumentsWeda(selecteur) {
        const docs = collecterDocumentsAccessibles(document);
        for (const doc of docs) {
            try {
                const champ = doc.querySelector(selecteur);
                if (champ) return champ;
            } catch (e) {}
        }
        return null;
    }

    function getChampDansDocumentsWeda(selecteur) {
        return getElementDansDocumentsWeda(selecteur);
    }

    async function waitForChampDansDocumentsWeda(selecteur, nom, timeoutMs) {
        return attendreParVerification(
            () => getChampDansDocumentsWeda(selecteur),
            champ => !!champ,
            nom,
            timeoutMs || TIMEOUT_CHAMP_MESURE_MS,
            90
        );
    }

    function champFormulaireEstVide(champ) {
        if (!champ) return false;
        if ('value' in champ) return String(champ.value || '').trim() === '';
        return String(champ.innerText || champ.textContent || '').trim() === '';
    }

    function definirValeurChampFormulaire(champ, valeur) {
        if (!champ) return false;

        const doc = champ.ownerDocument || document;
        const win = doc.defaultView || window;

        try { champ.focus(); } catch (e) {}

        try {
            const prototype = Object.getPrototypeOf(champ);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(champ, valeur);
            else champ.value = valeur;
        } catch (e) {
            try { champ.value = valeur; } catch (e2) { return false; }
        }

        try { champ.setAttribute('value', valeur); } catch (e) {}

        ['input', 'change', 'keyup', 'blur'].forEach(type => {
            try {
                let event;
                if (type === 'input' && typeof win.InputEvent === 'function') {
                    event = new win.InputEvent(type, { bubbles: true, cancelable: true, inputType: 'insertText', data: valeur });
                } else {
                    event = new win.Event(type, { bubbles: true, cancelable: true });
                }
                champ.dispatchEvent(event);
            } catch (e) {}
        });

        return true;
    }

    async function remplirChampSimpleDepuisValeur(selecteur, nom, valeur, messageBadge) {
        if (!valeur) return false;

        const champ = await waitForChampDansDocumentsWeda(selecteur, nom, TIMEOUT_CHAMP_MESURE_MS);

        if (!champ) {
            console.warn('[AUTO-HH] ' + nom + ' détecté(e) mais champ WEDA introuvable :', valeur);
            afficherBadge('AUTO-HH : ' + nom + ' détecté(e), champ introuvable', 6000);
            return false;
        }

        if (!champFormulaireEstVide(champ)) {
            console.info('[AUTO-HH] Champ ' + nom + ' déjà rempli, aucune modification.', { valeurExistante: champ.value, valeurDetectee: valeur });
            afficherBadge('AUTO-HH : ' + nom + ' détecté(e) mais champ déjà rempli', 5000);
            return false;
        }

        const ok = definirValeurChampFormulaire(champ, valeur);
        if (ok) {
            console.info('[AUTO-HH] ' + nom + ' renseigné(e) dans WEDA :', valeur);
            afficherBadge(messageBadge + valeur, 5000);
            return true;
        }

        console.warn('[AUTO-HH] Échec remplissage ' + nom + ' WEDA :', valeur);
        afficherBadge('AUTO-HH : échec remplissage ' + nom, 6000);
        return false;
    }

    async function remplirTensionsWedaDepuisRapport(champs) {
        const donnees = champs || {};
        let auMoinsUnChampRempli = false;

        if (donnees.tensionSystolique || donnees.tensionDiastolique) {
            const [champSys, champDia] = await Promise.all([
                waitForChampDansDocumentsWeda(SELECTEUR_TENSION_SYS_WEDA, 'tension systolique WEDA', TIMEOUT_CHAMP_MESURE_MS),
                waitForChampDansDocumentsWeda(SELECTEUR_TENSION_DIA_WEDA, 'tension diastolique WEDA', TIMEOUT_CHAMP_MESURE_MS)
            ]);

            if (!champSys || !champDia) {
                afficherBadge('AUTO-HH : tension cabinet détectée, champ introuvable', 6000);
            } else {
                let tensionCabinetRemplie = false;

                if (donnees.tensionSystolique && champFormulaireEstVide(champSys)) {
                    if (definirValeurChampFormulaire(champSys, donnees.tensionSystolique)) {
                        auMoinsUnChampRempli = true;
                        tensionCabinetRemplie = true;
                    }
                }

                if (donnees.tensionDiastolique && champFormulaireEstVide(champDia)) {
                    if (definirValeurChampFormulaire(champDia, donnees.tensionDiastolique)) {
                        auMoinsUnChampRempli = true;
                        tensionCabinetRemplie = true;
                    }
                }

                if (tensionCabinetRemplie) afficherBadge('AUTO-HH : tension cabinet renseignée ' + (donnees.tensionCabinet || ''), 5000);
                else afficherBadge('AUTO-HH : tension cabinet détectée mais champs déjà remplis', 5000);
            }
        }

        if (donnees.automesure) {
            const champAuto = await waitForChampDansDocumentsWeda(SELECTEUR_TENSION_AUTOMESURE_WEDA, 'automesure tensionnelle WEDA', TIMEOUT_CHAMP_MESURE_MS);

            if (!champAuto) afficherBadge('AUTO-HH : automesure détectée, champ introuvable', 6000);
            else if (!champFormulaireEstVide(champAuto)) afficherBadge('AUTO-HH : automesure détectée mais champ déjà rempli', 5000);
            else if (definirValeurChampFormulaire(champAuto, donnees.automesure)) {
                auMoinsUnChampRempli = true;
                afficherBadge('AUTO-HH : automesure renseignée ' + donnees.automesure, 5000);
            }
        }

        return auMoinsUnChampRempli;
    }

    async function remplirChampsStructuresDepuisTranscription(texte, rapportPrecalcule = null) {
        const rapport = rapportPrecalcule || creerRapportExtractionDepuisTexte(texte, { source: 'remplissage_champs_structures' });
        const champs = rapport && rapport.champs ? rapport.champs : {};

        const taches = [
            remplirChampSimpleDepuisValeur(SELECTEUR_POIDS_WEDA, 'poids WEDA', champs.poids, 'AUTO-HH : poids renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_TAILLE_WEDA, 'taille WEDA', champs.taille, 'AUTO-HH : taille renseignée '),
            remplirChampSimpleDepuisValeur(SELECTEUR_TEMPERATURE_WEDA, 'température WEDA', champs.temperature, 'AUTO-HH : température renseignée '),
            remplirTensionsWedaDepuisRapport(champs),
            remplirChampSimpleDepuisValeur(SELECTEUR_TABAC_WEDA, 'tabac WEDA', champs.tabac, 'AUTO-HH : tabac renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_ALCOOL_WEDA, 'alcool WEDA', champs.alcool, 'AUTO-HH : alcool renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_EXAMEN_PIEDS_WEDA, 'examen des pieds / podologue WEDA', champs.examenPieds, 'AUTO-HH : examen des pieds renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_HEMOCULT_WEDA, 'hémocult WEDA', champs.hemocult, 'AUTO-HH : hémocult renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_FROTTIS_WEDA, 'frottis WEDA', champs.frottis, 'AUTO-HH : frottis renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_MAMMOGRAPHIE_WEDA, 'mammographie WEDA', champs.mammographie, 'AUTO-HH : mammographie renseignée '),
            remplirChampSimpleDepuisValeur(SELECTEUR_DENTISTE_WEDA, 'dentiste WEDA', champs.dentiste, 'AUTO-HH : dentiste renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_DTP_WEDA, 'DTP WEDA', champs.dtp, 'AUTO-HH : DTP renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_PAPILLOMAVIRUS_WEDA, 'papillomavirus / Gardasil WEDA', champs.papillomavirus, 'AUTO-HH : papillomavirus renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_FOND_OEIL_WEDA, 'fond d’œil / ophtalmo WEDA', champs.fondOeil, 'AUTO-HH : fond d’œil renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_CARDIOLOGUE_WEDA, 'cardiologue WEDA', champs.cardiologue, 'AUTO-HH : cardiologue renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_MMS_WEDA, 'MMS WEDA', champs.mms, 'AUTO-HH : MMS renseigné '),
            remplirChampSimpleDepuisValeur(SELECTEUR_MADRS_WEDA, 'MADRS WEDA', champs.madrs, 'AUTO-HH : MADRS renseigné ')
        ];

        await Promise.allSettled(taches);
        console.info('[AUTO-HH] Remplissage optimisé des champs structurés terminé.', rapport);
        return rapport;
    }

    /************************************************************
     * ÉTIQUETTES WEDA
     ************************************************************/

    function normaliserNomEtiquette(nom) {
        return normaliserTexte(nom).replace(/covid/g, 'covid').trim();
    }

    function trouverBoutonOuvertureGlossairesWeda() {
        return getElementDansDocumentsWeda(SELECTEUR_BOUTON_PANEL_ETIQUETTE_WEDA);
    }

    function trouverGridGlossairesWeda() {
        return getElementDansDocumentsWeda(SELECTEUR_GRID_GLOSSAIRES_WEDA);
    }

    function gridGlossairesEstVisible(grid) {
        if (!grid) return false;
        try {
            const doc = grid.ownerDocument || document;
            const win = doc.defaultView || window;
            const style = win.getComputedStyle(grid);
            const rect = grid.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        } catch (e) {
            return true;
        }
    }

    async function waitForGridGlossairesWeda(timeoutMs = TIMEOUT_MENU_ETIQUETTES_MS) {
        return attendreParVerification(trouverGridGlossairesWeda, grid => !!grid && gridGlossairesEstVisible(grid), 'grille étiquettes WEDA', timeoutMs, 90);
    }

    async function ouvrirGridGlossairesWeda(options = {}) {
        const silencieux = !!options.silencieux;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : TIMEOUT_MENU_ETIQUETTES_MS;

        let grid = trouverGridGlossairesWeda();
        if (grid && gridGlossairesEstVisible(grid)) return grid;

        const bouton = await waitForElement(trouverBoutonOuvertureGlossairesWeda, 'bouton panneau étiquettes WEDA', timeoutMs);

        if (!bouton) {
            console.warn('[AUTO-HH] Bouton d’ouverture des étiquettes introuvable.');
            if (!silencieux) afficherBadge('AUTO-HH : bouton étiquettes introuvable', 3500);
            return null;
        }

        if (!silencieux) afficherBadge('AUTO-HH : ouverture panneau étiquettes', 2500);
        clickElement(bouton, 'bouton panneau étiquettes WEDA');

        await sleep(120);
        grid = await waitForGridGlossairesWeda(timeoutMs);
        return grid;
    }

    function trouverLigneEtiquetteDansGrid(grid, etiquette) {
        if (!grid) return null;

        const cible = normaliserNomEtiquette(etiquette);
        const lignes = [...grid.querySelectorAll('tr')];

        return lignes.find(ligne => {
            const lienTitre = ligne.querySelector('a[id*="LinkButtonGlossaireTitre"]');
            const texteTitre = normaliserNomEtiquette(lienTitre ? (lienTitre.textContent || lienTitre.innerText || '') : '');
            return texteTitre === cible;
        }) || null;
    }

    function trouverLienAffecterDansLigneEtiquette(ligne) {
        if (!ligne) return null;

        const lienAffecter = ligne.querySelector('a[id*="LinkButtonAffecterEtiquette"]');
        if (lienAffecter) return lienAffecter;

        const lienTitre = ligne.querySelector('a[id*="LinkButtonGlossaireTitre"]');
        if (lienTitre) return lienTitre;

        return [...ligne.querySelectorAll('a')].find(a => {
            const texte = normaliserTexte(a.textContent || a.innerText || '');
            const title = normaliserTexte(a.getAttribute('title') || '');
            return texte.includes('affecter') || title.includes('affectez') || title.includes('affecter');
        }) || null;
    }

    async function ajouterEtiquetteWedaParNom(etiquette, options = {}) {
        const silencieux = !!options.silencieux;
        const dernierTag = !!options.dernierTag;
        const grid = await ouvrirGridGlossairesWeda({ silencieux, timeoutMs: dernierTag ? 350 : TIMEOUT_MENU_ETIQUETTES_MS });

        if (!grid) {
            console.warn('[AUTO-HH] Grille étiquettes introuvable. Probable postback WEDA en cours ou panneau déjà fermé.');
            return false;
        }

        const ligne = trouverLigneEtiquetteDansGrid(grid, etiquette);
        if (!ligne) {
            console.warn('[AUTO-HH] Ligne étiquette introuvable dans GlossairesGrid :', etiquette);
            if (!silencieux) afficherBadge('AUTO-HH : étiquette introuvable ' + etiquette, 3500);
            return false;
        }

        const lienAffecter = trouverLienAffecterDansLigneEtiquette(ligne);
        if (!lienAffecter) {
            console.warn('[AUTO-HH] Lien Affecter introuvable pour étiquette :', etiquette, ligne);
            if (!silencieux) afficherBadge('AUTO-HH : lien Affecter introuvable ' + etiquette, 3500);
            return false;
        }

        console.info('[AUTO-HH] Clic Affecter étiquette WEDA :', { etiquette, lien: lienAffecter, ligne, dernierTag });
        if (!silencieux) afficherBadge('AUTO-HH : affectation étiquette ' + etiquette, 2500);
        clickElement(lienAffecter, 'Affecter étiquette WEDA : ' + etiquette);

        await sleep(dernierTag ? DELAI_DIRECT_APRES_DERNIER_TAG_MS : DELAI_APRES_AJOUT_ETIQUETTE_MS);
        return true;
    }

    function getTagLockKey(jobId) {
        return CLE_TAG_LOCK_PREFIX + jobId;
    }

    function obtenirOwnerTagLock() {
        let owner = null;
        try { owner = sessionStorage.getItem('auto_hh_tag_lock_owner'); } catch (e) {}
        if (!owner) {
            owner = 'owner_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            try { sessionStorage.setItem('auto_hh_tag_lock_owner', owner); } catch (e) {}
        }
        return owner;
    }

    async function acquerirTagLock(jobId) {
        const key = getTagLockKey(jobId);
        const owner = obtenirOwnerTagLock();
        const start = Date.now();

        while (Date.now() - start < DELAI_LOCK_ETIQUETTES_MS) {
            const lock = GM_getValue(key, null);
            const maintenant = Date.now();
            if (!lock || lock.owner === owner || maintenant - Number(lock.timestamp || 0) > DELAI_LOCK_ETIQUETTES_MS) {
                GM_setValue(key, { owner, timestamp: maintenant });
                return owner;
            }
            console.info('[AUTO-HH] Lock étiquettes occupé, attente...', lock);
            await sleep(300);
        }

        return null;
    }

    function libererTagLock(jobId, owner) {
        try {
            const key = getTagLockKey(jobId);
            const lock = GM_getValue(key, null);
            if (lock && lock.owner === owner) GM_deleteValue(key);
        } catch (e) {}
    }

    function getEtatEtiquettesJob(job) {
        const etiquettesBrutes = tableauUnique(Array.isArray(job?.tagsToApply) ? job.tagsToApply : []);
        const etiquettes = etiquettesBrutes.filter(etiquette => ETIQUETTES_WEDA_DISPONIBLES.includes(etiquette)).slice(0, NOMBRE_MAX_ETIQUETTES_WEDA);

        const tagsClicked = tableauUnique(job?.tagsClicked || []);
        const tagsApplied = tableauUnique(job?.tagsApplied || []);
        const tagsFailed = tableauUnique(job?.tagsFailed || []);
        const dejaTraitees = tableauUnique([...tagsClicked, ...tagsApplied]);
        const restantes = etiquettes.filter(etiquette => !dejaTraitees.includes(etiquette));

        return { etiquettes, tagsClicked, tagsApplied, tagsFailed, dejaTraitees, restantes };
    }

    async function appliquerEtiquettesWedaDepuisJob(jobId) {
        const ownerLock = await acquerirTagLock(jobId);

        if (!ownerLock) {
            console.warn('[AUTO-HH] Impossible d’acquérir le lock étiquettes, abandon temporaire.');
            afficherBadge('AUTO-HH : étiquettes en attente, lock occupé', 3500);
            return false;
        }

        try {
            let job = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null);
            if (!job) return false;

            let etat = getEtatEtiquettesJob(job);

            if (etat.etiquettes.length === 0) {
                mettreAJourJob(jobId, {
                    status: 'tags_done',
                    message: 'Aucune étiquette WEDA à ajouter',
                    tagIndex: 0,
                    tagsToApply: [],
                    tagsClicked: [],
                    tagsApplied: [],
                    tagsFailed: [],
                    skipTagGridReopen: true,
                    directSaveAfterTags: true
                });
                console.info('[AUTO-HH] Aucune étiquette WEDA détectée.');
                return true;
            }

            if (etat.restantes.length === 0) {
                mettreAJourJob(jobId, {
                    status: 'tags_done',
                    message: 'Étiquettes WEDA déjà toutes traitées, passage direct à la sauvegarde',
                    tagIndex: etat.etiquettes.length,
                    tagsToApply: etat.etiquettes,
                    tagsClicked: etat.tagsClicked,
                    tagsApplied: tableauUnique([...etat.tagsApplied, ...etat.tagsClicked]),
                    tagsFailed: etat.tagsFailed,
                    skipTagGridReopen: true,
                    directSaveAfterTags: true
                });
                console.info('[AUTO-HH] Toutes les étiquettes étaient déjà traitées : sauvegarde directe sans réouverture de grille.', etat);
                return true;
            }

            console.info('[AUTO-HH] Étiquettes WEDA à appliquer :', { toutes: etat.etiquettes, restantes: etat.restantes, dejaTraitees: etat.dejaTraitees });
            afficherBadge('AUTO-HH : ajout étiquettes ' + etat.restantes.join(', '), 3500);

            for (const etiquette of etat.restantes) {
                job = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null);
                if (!job) return false;

                etat = getEtatEtiquettesJob(job);
                if (!etat.restantes.includes(etiquette)) {
                    console.info('[AUTO-HH] Étiquette déjà traitée depuis la dernière itération, ignorée :', etiquette);
                    continue;
                }

                const tagsClickedAvantClic = tableauUnique([...etat.tagsClicked, etiquette]);
                const tagsAppliedAvantClic = tableauUnique([...etat.tagsApplied, etiquette]);
                const estDerniereEtiquette = etat.restantes.length === 1 && etat.restantes[0] === etiquette;

                mettreAJourJob(jobId, {
                    status: estDerniereEtiquette ? 'tags_done' : 'tagging',
                    message: estDerniereEtiquette ? 'Dernière étiquette WEDA préparée, sauvegarde directe ensuite' : 'Ajout étiquette WEDA : ' + etiquette,
                    currentTag: etiquette,
                    tagIndex: etat.etiquettes.indexOf(etiquette) + 1,
                    tagsToApply: etat.etiquettes,
                    tagsClicked: tagsClickedAvantClic,
                    tagsApplied: tagsAppliedAvantClic,
                    tagsFailed: etat.tagsFailed,
                    skipTagGridReopen: estDerniereEtiquette,
                    directSaveAfterTags: estDerniereEtiquette
                });

                let ok = false;
                try {
                    ok = await ajouterEtiquetteWedaParNom(etiquette, { silencieux: estDerniereEtiquette, dernierTag: estDerniereEtiquette });
                } catch (e) {
                    console.warn('[AUTO-HH] Erreur ajout étiquette WEDA :', etiquette, e);
                    ok = false;
                }

                job = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null);
                if (!job) return false;
                etat = getEtatEtiquettesJob(job);

                if (!ok) {
                    if (estDerniereEtiquette) {
                        console.info('[AUTO-HH] Dernière étiquette marquée traitée malgré postback/panneau indisponible : sauvegarde directe.');
                        mettreAJourJob(jobId, {
                            status: 'tags_done',
                            message: 'Dernière étiquette terminée sans attente de grille',
                            tagIndex: etat.etiquettes.length,
                            tagsToApply: etat.etiquettes,
                            tagsClicked: tagsClickedAvantClic,
                            tagsApplied: tagsAppliedAvantClic,
                            tagsFailed: etat.tagsFailed,
                            skipTagGridReopen: true,
                            directSaveAfterTags: true
                        });
                        break;
                    }

                    const appliedCorriges = etat.tagsApplied.filter(tag => tag !== etiquette);
                    const failed = tableauUnique([...etat.tagsFailed, etiquette]);
                    mettreAJourJob(jobId, {
                        status: 'tagging',
                        message: 'Échec étiquette WEDA : ' + etiquette,
                        tagIndex: etat.etiquettes.indexOf(etiquette) + 1,
                        tagsToApply: etat.etiquettes,
                        tagsClicked: etat.tagsClicked,
                        tagsApplied: appliedCorriges,
                        tagsFailed: failed
                    });
                } else {
                    if (estDerniereEtiquette) {
                        console.info('[AUTO-HH] Dernière étiquette cliquée : sauvegarde directe sans nouvelle recherche de grille.');
                        mettreAJourJob(jobId, {
                            status: 'tags_done',
                            message: 'Dernière étiquette WEDA cliquée, sauvegarde directe',
                            tagIndex: etat.etiquettes.length,
                            tagsToApply: etat.etiquettes,
                            tagsClicked: tableauUnique([...etat.tagsClicked, etiquette]),
                            tagsApplied: tableauUnique([...etat.tagsApplied, etiquette]),
                            tagsFailed: etat.tagsFailed,
                            skipTagGridReopen: true,
                            directSaveAfterTags: true
                        });
                        break;
                    }

                    mettreAJourJob(jobId, {
                        status: 'tagging',
                        message: 'Étiquette WEDA cliquée : ' + etiquette,
                        tagIndex: etat.etiquettes.indexOf(etiquette) + 1,
                        tagsToApply: etat.etiquettes,
                        tagsClicked: etat.tagsClicked,
                        tagsApplied: etat.tagsApplied,
                        tagsFailed: etat.tagsFailed
                    });
                }

                if (estDerniereEtiquette) break;
                await sleep(60);
            }

            job = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null);
            etat = getEtatEtiquettesJob(job);
            mettreAJourJob(jobId, {
                status: 'tags_done',
                message: 'Étiquettes WEDA terminées',
                tagIndex: etat.etiquettes.length,
                tagsToApply: etat.etiquettes,
                tagsClicked: etat.tagsClicked,
                tagsApplied: tableauUnique([...etat.tagsApplied, ...etat.tagsClicked]),
                tagsFailed: etat.tagsFailed,
                skipTagGridReopen: true,
                directSaveAfterTags: true
            });

            afficherBadge('AUTO-HH : étiquettes terminées', 1800);
            return true;
        } finally {
            libererTagLock(jobId, ownerLock);
        }
    }

    /************************************************************
     * HTML HEIDI → WEDA
     ************************************************************/

    function filtrerStyle(styleValue) {
        const stylesAutorises = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line'];

        return String(styleValue || '')
            .split(';')
            .map(s => s.trim())
            .filter(s => {
                const [prop, value] = s.split(':').map(x => String(x || '').trim().toLowerCase());
                if (!prop || !value) return false;
                if (!stylesAutorises.includes(prop)) return false;
                if (value.includes('url(') || value.includes('expression') || value.includes('javascript:')) return false;
                return true;
            })
            .join('; ');
    }

    function nettoyerHtmlHeidi(htmlBrut) {
        const allowedTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'span', 'div']);
        const forbiddenTags = new Set(['script', 'style', 'button', 'input', 'textarea', 'select', 'option', 'svg', 'path', 'iframe', 'frame', 'object', 'embed', 'canvas', 'video', 'audio']);

        const template = document.createElement('template');
        template.innerHTML = String(htmlBrut || '');

        function nettoyerNode(node) {
            if (node.nodeType === 3) return document.createTextNode(node.textContent || '');
            if (node.nodeType !== 1) return document.createDocumentFragment();

            const tag = node.tagName.toLowerCase();
            if (forbiddenTags.has(tag)) return document.createDocumentFragment();

            if (!allowedTags.has(tag)) {
                const frag = document.createDocumentFragment();
                [...node.childNodes].forEach(child => frag.appendChild(nettoyerNode(child)));
                return frag;
            }

            const clone = document.createElement(tag);
            const style = filtrerStyle(node.getAttribute('style'));
            if (style) clone.setAttribute('style', style);
            [...node.childNodes].forEach(child => clone.appendChild(nettoyerNode(child)));
            return clone;
        }

        const frag = document.createDocumentFragment();
        [...template.content.childNodes].forEach(child => frag.appendChild(nettoyerNode(child)));

        const container = document.createElement('div');
        container.appendChild(frag);

        return container.innerHTML.replace(/\s+data-[^=]+="[^"]*"/gi, '').trim();
    }

    function creerFragmentWedaDepuisHtml(doc, htmlNettoye) {
        const template = doc.createElement('template');
        template.innerHTML = String(htmlNettoye || '');

        const fragment = doc.createDocumentFragment();
        const inlineTags = new Set(['strong', 'b', 'em', 'i', 'u', 'span']);
        const blockTags = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);

        function nouveauFragment() { return doc.createDocumentFragment(); }
        function appendFragment(destination, source) { while (source && source.firstChild) destination.appendChild(source.firstChild); }
        function estElement(node) { return node && node.nodeType === 1; }
        function tagName(node) { return estElement(node) ? node.tagName.toLowerCase() : ''; }
        function estBloc(node) { const tag = tagName(node); return blockTags.has(tag) || tag === 'ul' || tag === 'ol' || tag === 'li'; }
        function texteVisible(node) { return String(node?.textContent || '').replace(/\u00a0/g, ' ').replace(/\u200B/g, '').trim(); }

        function fragmentEstVide(frag) {
            if (!frag) return true;
            const texte = texteVisible(frag);
            if (texte.length > 0) return false;
            return ![...frag.childNodes].some(node => {
                if (node.nodeType === 3) return texteVisible(node).length > 0;
                if (node.nodeType === 1) return tagName(node) !== 'br' && texteVisible(node).length > 0;
                return false;
            });
        }

        function nodeEstVideStructurellement(node) {
            if (!node) return true;
            if (node.nodeType === 3) return texteVisible(node).length === 0;
            if (node.nodeType !== 1) return true;
            if (tagName(node) === 'br') return true;
            return texteVisible(node).length === 0;
        }

        function copierStyleAutorise(source, cible) {
            const style = filtrerStyle(source.getAttribute?.('style'));
            if (style) cible.setAttribute('style', style);
        }

        function convertirInlineNodeEnLignes(node) {
            if (!node) return [];
            if (node.nodeType === 3) {
                const frag = nouveauFragment();
                frag.appendChild(doc.createTextNode(node.textContent || ''));
                return [frag];
            }
            if (node.nodeType !== 1) return [];

            const tag = tagName(node);
            if (tag === 'br') return [nouveauFragment(), nouveauFragment()];

            if (inlineTags.has(tag)) {
                const lignesEnfants = convertirSuiteEnLignes([...node.childNodes], { modeInline: true, conserverTextesVides: true });
                return lignesEnfants.map(ligne => {
                    const frag = nouveauFragment();
                    if (fragmentEstVide(ligne)) return frag;
                    const clone = doc.createElement(tag);
                    copierStyleAutorise(node, clone);
                    appendFragment(clone, ligne);
                    frag.appendChild(clone);
                    return frag;
                });
            }

            if (estBloc(node)) return convertirNodeEnLignes(node);
            return convertirSuiteEnLignes([...node.childNodes], { modeInline: true, conserverTextesVides: true });
        }

        function convertirSuiteInlineEnLignes(nodes) {
            const lignes = [nouveauFragment()];
            nodes.forEach(node => {
                const morceaux = convertirInlineNodeEnLignes(node);
                if (!morceaux || morceaux.length === 0) return;
                morceaux.forEach((morceau, index) => {
                    if (index > 0) lignes.push(nouveauFragment());
                    appendFragment(lignes[lignes.length - 1], morceau);
                });
            });
            return lignes;
        }

        function convertirListeEnLignes(node, numerotee) {
            const lignes = [];
            const items = [...node.children].filter(li => tagName(li) === 'li');
            items.forEach((li, indexLi) => {
                const lignesLi = convertirSuiteInlineEnLignes([...li.childNodes]);
                if (lignesLi.length === 0) {
                    const vide = nouveauFragment();
                    vide.appendChild(doc.createTextNode(numerotee ? ((indexLi + 1) + '. ') : '• '));
                    lignes.push(vide);
                    return;
                }
                lignesLi.forEach((ligne, indexLigne) => {
                    const frag = nouveauFragment();
                    frag.appendChild(doc.createTextNode(indexLigne === 0 ? (numerotee ? ((indexLi + 1) + '. ') : '• ') : '  '));
                    appendFragment(frag, ligne);
                    lignes.push(frag);
                });
            });
            return lignes;
        }

        function convertirBlocEnLignes(node) {
            if (nodeEstVideStructurellement(node)) return [nouveauFragment()];
            const enfants = [...node.childNodes];
            const contientBlocEnfant = enfants.some(child => estBloc(child) && tagName(child) !== 'br' && !(tagName(child) === 'span'));
            if (tagName(node) === 'div' && contientBlocEnfant) return convertirSuiteEnLignes(enfants, { modeInline: false, conserverTextesVides: false });
            return convertirSuiteInlineEnLignes(enfants);
        }

        function convertirNodeEnLignes(node) {
            if (!node) return [];
            if (node.nodeType === 3) {
                if (texteVisible(node).length === 0) return [];
                const frag = nouveauFragment();
                frag.appendChild(doc.createTextNode(node.textContent || ''));
                return [frag];
            }
            if (node.nodeType !== 1) return [];

            const tag = tagName(node);
            if (tag === 'br') return [nouveauFragment()];
            if (tag === 'ul') return convertirListeEnLignes(node, false);
            if (tag === 'ol') return convertirListeEnLignes(node, true);
            if (tag === 'li') {
                const lignesLi = convertirSuiteInlineEnLignes([...node.childNodes]);
                return lignesLi.length === 0 ? [nouveauFragment()] : lignesLi;
            }
            if (blockTags.has(tag)) return convertirBlocEnLignes(node);
            if (inlineTags.has(tag)) return convertirInlineNodeEnLignes(node);
            return convertirSuiteEnLignes([...node.childNodes], { modeInline: false, conserverTextesVides: false });
        }

        function convertirSuiteEnLignes(nodes, options = {}) {
            const modeInline = !!options.modeInline;
            const conserverTextesVides = !!options.conserverTextesVides;
            if (modeInline) return convertirSuiteInlineEnLignes(nodes);

            const lignes = [];
            nodes.forEach(node => {
                if (node.nodeType === 3 && !conserverTextesVides && texteVisible(node).length === 0) return;
                const lignesNode = convertirNodeEnLignes(node);
                lignesNode.forEach(ligne => lignes.push(ligne));
            });
            return lignes;
        }

        function supprimerLignesVidesExtremites(lignes) {
            const copie = [...lignes];
            while (copie.length > 0 && fragmentEstVide(copie[0])) copie.shift();
            while (copie.length > 0 && fragmentEstVide(copie[copie.length - 1])) copie.pop();
            return copie;
        }

        let lignes = convertirSuiteEnLignes([...template.content.childNodes], { modeInline: false, conserverTextesVides: false });
        lignes = supprimerLignesVidesExtremites(lignes);

        lignes.forEach((ligne, index) => {
            appendFragment(fragment, ligne);
            if (index < lignes.length - 1) fragment.appendChild(doc.createElement('br'));
        });

        return fragment;
    }

    /************************************************************
     * HEIDI
     ************************************************************/

    function getBoutonNouvelleSession() {
        return document.querySelector(SELECTEUR_NOUVELLE_SESSION);
    }

    function getBoutonParTexte(texteRecherche, options = {}) {
        const recherche = normaliserTexte(texteRecherche);
        const boutons = [...document.querySelectorAll('button')].filter(button => {
            const texte = getTexteAccessibleElementHeidi(button);
            return isVisible(button) && texte.includes(recherche);
        });

        if (boutons.length === 0) return null;

        if (options.classeContient) {
            const boutonClasse = boutons.find(button => String(button.className || '').includes(options.classeContient));
            if (boutonClasse) return boutonClasse;
        }

        return boutons[0];
    }

    function getBoutonTranscription() {
        return getBoutonParTexte(TEXTE_BOUTON_TRANSCRIPTION, { classeContient: 'bg-validation-success' });
    }

    function getTexteAccessibleElementHeidi(element) {
        if (!element) return '';

        const morceaux = [
            element.innerText || '',
            element.textContent || '',
            element.getAttribute?.('aria-label') || '',
            element.getAttribute?.('title') || '',
            element.getAttribute?.('data-testid') || '',
            element.getAttribute?.('data-test-id') || '',
            element.getAttribute?.('data-state') || '',
            element.getAttribute?.('value') || ''
        ];

        return normaliserTexte(morceaux.join(' '));
    }

    function getCibleCliquableHeidi(element) {
        if (!element) return null;
        return element.closest?.('button, [role="button"]') || element;
    }

    function texteIndiqueBoutonArretHeidi(texte) {
        const t = normaliserTexte(texte);
        if (!t) return false;

        if (t.includes('arreter la transcription')) return true;
        if (t.includes('arreter transcription')) return true;
        if (t.includes('termine la transcription')) return true;
        if (t.includes('terminer la transcription')) return true;
        if (t.includes('stop transcription')) return true;
        if (t.includes('stop recording')) return true;
        if (t.includes('end recording')) return true;
        if (t.includes('arreter l enregistrement')) return true;
        if (t.includes('termine l enregistrement')) return true;
        if (t.includes('terminer l enregistrement')) return true;
        if (t.includes('arreter la dictee')) return true;
        if (t.includes('termine la dictee')) return true;
        if (t.includes('terminer la dictee')) return true;

        const indiqueArret =
            t.includes('arreter') ||
            t.includes('stop') ||
            t.includes('termin') ||
            t.includes('mettre fin') ||
            t.includes('end');

        const indiqueTranscription =
            t.includes('transcription') ||
            t.includes('recording') ||
            t.includes('enregistrement') ||
            t.includes('dictee') ||
            t.includes('microphone') ||
            t.includes('micro');

        return indiqueArret && indiqueTranscription;
    }

    function getBoutonArretTranscription() {
        const boutonStopRecording = getCibleCliquableHeidi(document.querySelector(SELECTEUR_BOUTON_ARRET_HEIDI));
        if (elementEstBoutonArretTranscriptionValideHeidi(boutonStopRecording)) return boutonStopRecording;

        const selecteurCandidats = [
            'button',
            '[role="button"]',
            '[aria-label]',
            '[title]',
            '[data-testid]',
            '[data-test-id]'
        ].join(', ');

        const candidats = [...document.querySelectorAll(selecteurCandidats)]
            .map(getCibleCliquableHeidi)
            .filter((element, index, tableau) => element && tableau.indexOf(element) === index);

        const bouton = candidats.find(element => elementEstBoutonArretTranscriptionValideHeidi(element));
        if (bouton) return bouton;

        const descendant = [...document.querySelectorAll('span, div, svg, path')].find(element => {
            const cible = getCibleCliquableHeidi(element);
            if (!cible || !elementEstBoutonArretTranscriptionValideHeidi(cible)) return false;
            return true;
        });

        return descendant ? getCibleCliquableHeidi(descendant) : null;
    }

    function texteIndiqueBoutonCopierHeidi(texte) {
        const t = normaliserTexte(texte).replace(/[_-]/g, ' ');
        if (!t) return false;

        if (t.includes('copier le texte')) return true;
        if (t.includes('copy text')) return true;
        if (t.includes('copy note')) return true;
        if (t.includes('copy clinical note')) return true;

        if (/\b(?:copier|copy)\b/.test(t)) {
            return !/\b(?:logs?|debug|json)\b/.test(t);
        }

        return false;
    }

    function getBoutonCopierHeidi() {
        const selecteurCandidats = [
            'button',
            '[role="button"]',
            '[aria-label]',
            '[title]',
            '[data-testid]',
            '[data-test-id]',
            'span'
        ].join(', ');

        const candidats = [...document.querySelectorAll(selecteurCandidats)]
            .map(getCibleCliquableHeidi)
            .filter((element, index, tableau) => element && tableau.indexOf(element) === index);

        return candidats.find(element => {
            if (!isVisible(element)) return false;
            return texteIndiqueBoutonCopierHeidi(getTexteAccessibleElementHeidi(element));
        }) || null;
    }

    async function attendreAutomatisationHeidiDisponible(nom, timeoutMs = 12000) {
        const start = Date.now();

        while (automatisationEnCours && Date.now() - start < timeoutMs) {
            console.info('[AUTO-HH] Attente disponibilité Heidi pour ' + nom + '...');
            await sleep(150);
        }

        return !automatisationEnCours;
    }

    function decrireBoutonHeidi(element) {
        if (!element) return null;

        return {
            tag: String(element.tagName || '').toLowerCase(),
            texte: getTexteAccessibleElementHeidi(element),
            id: element.id || null,
            role: element.getAttribute?.('role') || null,
            ariaLabel: element.getAttribute?.('aria-label') || null,
            title: element.getAttribute?.('title') || null,
            testId: element.getAttribute?.('data-testid') || element.getAttribute?.('data-test-id') || null,
            className: String(element.className || '').slice(0, 180),
            visible: isVisible(element)
        };
    }

    function elementEstBoutonTranscriptionDemarrageHeidi(element) {
        const cible = getCibleCliquableHeidi(element) || element;
        if (!cible || !isVisible(cible)) return false;

        const texte = getTexteAccessibleElementHeidi(cible);
        if (!texte) return false;

        const contientMotArret = /\b(?:arreter|stop|terminer|termine|end|mettre fin)\b/.test(texte);
        if (contientMotArret) return false;

        const className = String(cible.className || '');
        const testId = String(cible.getAttribute?.('data-testid') || cible.getAttribute?.('data-test-id') || '');

        if (texte === normaliserTexte(TEXTE_BOUTON_TRANSCRIPTION)) return true;

        if (texte.includes(normaliserTexte(TEXTE_BOUTON_TRANSCRIPTION)) && className.includes('bg-validation-success')) return true;
        if (testId.includes('start-recording') || testId.includes('start-transcription')) return true;

        return false;
    }

    function getBoutonTranscriptionDemarrageVisibleHeidi() {
        const boutonPrincipal = getBoutonTranscription();
        if (boutonPrincipal && isVisible(boutonPrincipal) && elementEstBoutonTranscriptionDemarrageHeidi(boutonPrincipal)) return boutonPrincipal;

        const candidats = [...document.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid], [data-test-id]')]
            .map(getCibleCliquableHeidi)
            .filter((element, index, tableau) => element && tableau.indexOf(element) === index);

        return candidats.find(element => elementEstBoutonTranscriptionDemarrageHeidi(element)) || null;
    }

    function elementEstBoutonArretTranscriptionValideHeidi(element) {
        const cible = getCibleCliquableHeidi(element) || element;
        if (!cible || !isVisible(cible)) return false;
        if (elementEstBoutonTranscriptionDemarrageHeidi(cible)) return false;

        const testId = String(cible.getAttribute?.('data-testid') || cible.getAttribute?.('data-test-id') || '');
        if (testId === 'stop-recording-button' || testId.includes('stop-recording-button')) return true;

        const texte = getTexteAccessibleElementHeidi(cible);
        return texteIndiqueBoutonArretHeidi(texte);
    }

    function listerBoutonsHeidiPourDiagnostic() {
        const elements = [...document.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid], [data-test-id]')];
        const uniques = elements
            .map(getCibleCliquableHeidi)
            .filter((element, index, tableau) => element && tableau.indexOf(element) === index)
            .map(decrireBoutonHeidi)
            .filter(Boolean);

        const boutonStopRecording = document.querySelector(SELECTEUR_BOUTON_ARRET_HEIDI);
        if (boutonStopRecording) {
            console.info('[AUTO-HH] Bouton stop-recording-button exact :', decrireBoutonHeidi(getCibleCliquableHeidi(boutonStopRecording)));
        }

        try { console.table(uniques); } catch (e) {}
        console.info('[AUTO-HH] Boutons Heidi détectés :', uniques);
        return uniques;
    }

    function transcriptionHeidiSembleActive() {
        const boutonDemarrage = getBoutonTranscriptionDemarrageVisibleHeidi();
        const boutonTranscription = getBoutonTranscription();
        const boutonArretDiagnostic = getBoutonArretTranscription();
        const boutonStopExactDiagnostic = getCibleCliquableHeidi(document.querySelector(SELECTEUR_BOUTON_ARRET_HEIDI));

        /*
         * Règle de sécurité volontairement stricte :
         * - REC ne doit jamais être validé tant que le bouton vert "Transcription"
         *   reste visible et cliquable.
         * - L'éventuel bouton d'arrêt n'est conservé ici que comme diagnostic
         *   dans les logs, pas comme critère principal suffisant.
         */
        if (boutonDemarrage && isVisible(boutonDemarrage)) {
            return {
                ok: false,
                raison: 'bouton_transcription_demarrage_toujours_visible',
                preuvePrincipale: 'REC interdit car le bouton vert Transcription est encore disponible',
                boutonDemarrage: decrireBoutonHeidi(boutonDemarrage),
                boutonTranscription: decrireBoutonHeidi(boutonTranscription),
                boutonArretDiagnostic: decrireBoutonHeidi(boutonArretDiagnostic),
                boutonStopExactDiagnostic: decrireBoutonHeidi(boutonStopExactDiagnostic),
                boutonCopier: decrireBoutonHeidi(getBoutonCopierHeidi())
            };
        }

        if (boutonTranscription && isVisible(boutonTranscription) && elementEstBoutonTranscriptionDemarrageHeidi(boutonTranscription)) {
            return {
                ok: false,
                raison: 'bouton_transcription_principal_toujours_visible',
                preuvePrincipale: 'REC interdit car le bouton principal Transcription est encore disponible',
                boutonDemarrage: decrireBoutonHeidi(boutonDemarrage),
                boutonTranscription: decrireBoutonHeidi(boutonTranscription),
                boutonArretDiagnostic: decrireBoutonHeidi(boutonArretDiagnostic),
                boutonStopExactDiagnostic: decrireBoutonHeidi(boutonStopExactDiagnostic),
                boutonCopier: decrireBoutonHeidi(getBoutonCopierHeidi())
            };
        }

        return {
            ok: true,
            raison: 'bouton_transcription_demarrage_absent_ou_inactif',
            preuvePrincipale: 'Le bouton vert Transcription n’est plus disponible après PageUp',
            boutonDemarrage: decrireBoutonHeidi(boutonDemarrage),
            boutonTranscription: decrireBoutonHeidi(boutonTranscription),
            boutonArretDiagnostic: decrireBoutonHeidi(boutonArretDiagnostic),
            boutonStopExactDiagnostic: decrireBoutonHeidi(boutonStopExactDiagnostic),
            boutonCopier: decrireBoutonHeidi(getBoutonCopierHeidi())
        };
    }

    async function attendreConfirmationTranscriptionHeidi(timeoutMs = DELAI_CONFIRMATION_TRANSCRIPTION_HEIDI_MS) {
        const start = Date.now();
        let dernierDiagnostic = null;

        while (Date.now() - start < timeoutMs) {
            dernierDiagnostic = transcriptionHeidiSembleActive();
            if (dernierDiagnostic && dernierDiagnostic.ok) {
                await sleep(DELAI_DOUBLE_CONFIRMATION_TRANSCRIPTION_HEIDI_MS);
                const diagnosticConfirmation = transcriptionHeidiSembleActive();

                if (diagnosticConfirmation && diagnosticConfirmation.ok) {
                    ajouterLogAutoHH('heidi-recording-confirmed', {
                        ageMs: Date.now() - start,
                        diagnosticInitial: dernierDiagnostic,
                        diagnosticConfirmation
                    });
                    return diagnosticConfirmation;
                }

                dernierDiagnostic = diagnosticConfirmation || dernierDiagnostic;
                ajouterLogAutoHH('heidi-recording-confirmation-rejected-second-check', {
                    ageMs: Date.now() - start,
                    diagnostic: dernierDiagnostic
                });
            }

            await sleep(INTERVALLE_CONFIRMATION_TRANSCRIPTION_HEIDI_MS);
        }

        dernierDiagnostic = dernierDiagnostic || transcriptionHeidiSembleActive();
        ajouterLogAutoHH('heidi-recording-confirmation-timeout', {
            timeoutMs,
            diagnostic: dernierDiagnostic,
            boutons: listerBoutonsHeidiPourDiagnostic()
        });
        return { ok: false, raison: 'timeout_confirmation_transcription', diagnostic: dernierDiagnostic };
    }

    async function cliquerBoutonArretTranscriptionHeidi(boutonInitial) {
        let bouton = boutonInitial || getBoutonArretTranscription();
        if (!bouton) return false;

        for (let tentative = 1; tentative <= 3; tentative += 1) {
            console.info('[AUTO-HH] Tentative arrêt transcription Heidi #' + tentative + ' :', decrireBoutonHeidi(bouton));
            afficherBadge('AUTO-HH : clic Arrêter transcription', 2500);

            clickElement(bouton, 'Terminer la transcription Heidi', { cibleAuPoint: true, clavierSecours: true });

            await sleep(700);

            if (getBoutonCopierHeidi()) {
                console.info('[AUTO-HH] Bouton Copier détecté après clic arrêt Heidi.');
                return true;
            }

            const boutonEncorePresent = getBoutonArretTranscription();
            if (!boutonEncorePresent) {
                console.info('[AUTO-HH] Bouton arrêt Heidi disparu après clic.');
                return true;
            }

            bouton = boutonEncorePresent;
        }

        console.warn('[AUTO-HH] Le bouton arrêt Heidi semble toujours présent après plusieurs clics.', decrireBoutonHeidi(bouton));
        listerBoutonsHeidiPourDiagnostic();
        return false;
    }

    function getContenuHeidiGenere() {
        const zone = document.querySelector(SELECTEUR_TEXTE_HEIDI);
        if (!zone) return null;

        const texte = nettoyerTexte(zone.innerText || zone.textContent || '');
        if (!texte) return null;

        const texteNormalise = normaliserTexte(texte);
        if (texteNormalise.includes('your note will appear here') || texteNormalise === '') return null;

        const html = nettoyerHtmlHeidi(zone.innerHTML || '');
        return { texte, html };
    }

    function contenuHeidiEstContexteWeda(contenu) {
        const texte = normaliserTexte(contenu && contenu.texte ? contenu.texte : '');
        const entete = normaliserTexte(ENTETE_CONTEXTE_WEDA_SECURITE);
        return !!texte && (texte.startsWith(entete) || texte.includes(entete + ' '));
    }

    async function waitForContenuHeidi(timeoutMs = TIMEOUT_GENERATION_HEIDI_MS) {
        return attendreParVerification(
            getContenuHeidiGenere,
            contenu => !!(contenu && contenu.texte && contenu.texte.length > 0),
            'contenu Heidi généré',
            timeoutMs,
            150
        );
    }

    async function waitForContenuHeidiStable(timeoutMs = TIMEOUT_GENERATION_HEIDI_MS, signal = null, cibleSession = null) {
    const start = Date.now();
    let dernierContenu = null;
    let derniereSignature = '';
    let depuisStable = 0;

    while (Date.now() - start < timeoutMs) {
        if (cibleSession && cibleSession.id) {
            const okSession = await verifierOuRestaurerSessionHeidiPendantPhase(signal, cibleSession, 'attente_contenu_stable');
            if (!okSession) {
                await sleep(INTERVALLE_STABILITE_CONTENU_HEIDI_MS);
                continue;
            }
        }

        const contenu = getContenuHeidiGenere();

        if (contenu && contenu.texte) {
            const signature = [
                contenu.texte.length,
                contenu.html ? contenu.html.length : 0,
                contenu.texte.slice(-300)
            ].join('|');

            if (signature === derniereSignature) {
                if (!depuisStable) depuisStable = Date.now();

                if (Date.now() - depuisStable >= DELAI_STABILITE_CONTENU_HEIDI_MS) {
                    console.info('[AUTO-HH] Contenu Heidi stable, récupération validée :', {
                        longueurTexte: contenu.texte.length,
                        longueurHtml: contenu.html ? contenu.html.length : 0
                    });
                    return contenu;
                }
            } else {
                derniereSignature = signature;
                depuisStable = 0;
                dernierContenu = contenu;
            }
        }

        await sleep(INTERVALLE_STABILITE_CONTENU_HEIDI_MS);
    }

   console.warn('[AUTO-HH] Contenu Heidi non stabilisé avant timeout, transfert annulé.', dernierContenu);
afficherBadge('AUTO-HH : contenu Heidi non stabilisé, transfert annulé', 8000);
return null;

}


    async function lancerNouvelleTranscription(signal = null) {
    if (!EST_HEIDI) return false;

    ajouterLogAutoHH('heidi-launch-start', {
        signal,
        automatisationEnCours,
        workerLocal: getHeidiWorkerIdLocal(),
        instance: instanceHeidiAutoHH
    });

    if (signal && signal.action === 'start') {
        const verrouOk = await verrouillerLancementSessionHeidi(signal, 'lancerNouvelleTranscription');
        if (!verrouOk) {
            ajouterLogAutoHH('heidi-launch-aborted-lock', {
                signal,
                instance: instanceHeidiAutoHH
            });
            afficherBadge('AUTO-HH : lancement déjà pris en charge', 3000);
            return false;
        }
    }

    if (automatisationEnCours) {
        console.info('[AUTO-HH] Automatisation déjà en cours, signal ignoré.');
        ajouterLogAutoHH('heidi-launch-ignored-busy', {
            signal,
            instance: instanceHeidiAutoHH
        });
        return false;
    }

    if (!verrouillerClicNouvelleSessionHeidi(signal, 'lancerNouvelleTranscription')) {
        afficherBadge('AUTO-HH : clic Nouvelle session déjà lancé', 3000);
        return false;
    }

    automatisationEnCours = true;

    try {
        console.info('[AUTO-HH] Début automatisation Heidi : lancement transcription.');
        definirFaviconHeidiStatut('starting');
        afficherBadge('AUTO-HH : début lancement Heidi', 3000);

        const sessionAvantNouvelle = getSessionHeidiCourante({ preferMenu: true, includeStorage: false });
        ajouterLogAutoHH('heidi-session-before-new-session', {
            signal,
            sessionAvantNouvelle
        });

        const boutonNouvelleSession = await waitForElement(getBoutonNouvelleSession, 'Nouvelle session');
        ajouterLogAutoHH('heidi-new-session-button-found', {
            bouton: decrireBoutonHeidi(boutonNouvelleSession),
            signal
        });
        if (!boutonNouvelleSession) {
            definirFaviconHeidiStatut('error', { duree: 7000 });
            afficherBadge('AUTO-HH : bouton Nouvelle session introuvable', 6000);
            libererVerrouLancementHeidi(signal);
            libererVerrouClicNouvelleSessionHeidi(signal);
            ajouterLogAutoHH('heidi-launch-failed-new-session-missing', { signal });
            return false;
        }

        afficherBadge('AUTO-HH : clic Nouvelle session', 2500);
        const okNouvelleSession = clickElement(boutonNouvelleSession, 'Nouvelle session', { clicUnique: true });
        ajouterLogAutoHH('heidi-new-session-click-result', {
            ok: okNouvelleSession,
            bouton: decrireBoutonHeidi(boutonNouvelleSession),
            mode: 'clicUnique',
            signal
        });
        if (!okNouvelleSession) {
            definirFaviconHeidiStatut('error', { duree: 7000 });
            libererVerrouLancementHeidi(signal);
            libererVerrouClicNouvelleSessionHeidi(signal);
            ajouterLogAutoHH('heidi-launch-failed-new-session-click', { signal });
            return false;
        }

        const sessionApresNouvelle = await attendreSessionHeidiApresNouvelleSession(sessionAvantNouvelle, 18000);
        if (sessionApresNouvelle && sessionApresNouvelle.id) {
            verrouillerSessionHeidiConnecteur(signal, sessionApresNouvelle, 'new_session_created_before_recording');
        } else {
            ajouterLogAutoHH('heidi-session-after-new-session-missing', { signal, sessionAvantNouvelle });
        }

        if (DELAI_APRES_NOUVELLE_SESSION_MS > 0) await sleep(DELAI_APRES_NOUVELLE_SESSION_MS);

        const boutonTranscription = await waitForElement(getBoutonTranscription, 'Transcription');
        ajouterLogAutoHH('heidi-transcription-button-found', {
            bouton: decrireBoutonHeidi(boutonTranscription),
            signal
        });
        if (!boutonTranscription) {
            definirFaviconHeidiStatut('error', { duree: 7000 });
            afficherBadge('AUTO-HH : bouton Transcription introuvable', 6000);
            ajouterLogAutoHH('heidi-launch-failed-transcription-missing', { signal });
            return false;
        }

        afficherBadge('AUTO-HH : clic Transcription', 2500);
        const okTranscription = clickElement(boutonTranscription, 'Transcription');
        ajouterLogAutoHH('heidi-transcription-click-result', {
            ok: okTranscription,
            bouton: decrireBoutonHeidi(boutonTranscription),
            signal
        });
        if (!okTranscription) {
            definirFaviconHeidiStatut('error', { duree: 7000, message: 'Clic Transcription impossible' });
            ajouterLogAutoHH('heidi-launch-failed-transcription-click', { signal });
            return false;
        }

        const confirmationTranscription = await attendreConfirmationTranscriptionHeidi(DELAI_CONFIRMATION_TRANSCRIPTION_HEIDI_MS);
        if (!confirmationTranscription || !confirmationTranscription.ok) {
            definirFaviconHeidiStatut('error', {
                duree: 12000,
                message: 'Transcription non confirmée',
                details: confirmationTranscription || {}
            });
            afficherBadge('AUTO-HH : ERREUR transcription non lancée', 10000, { force: true });
            ajouterLogAutoHH('heidi-launch-failed-recording-not-confirmed', {
                signal,
                confirmationTranscription,
                sessionApresNouvelle,
                sessionCourante: getSessionHeidiCourante({ preferMenu: true, includeStorage: false })
            });
            libererVerrouLancementHeidi(signal);
            libererVerrouClicNouvelleSessionHeidi(signal);
            return false;
        }

        const sessionAuMomentEnregistrement = getSessionHeidiCourante({ preferMenu: true, includeStorage: false }) || sessionApresNouvelle;
        if (sessionAuMomentEnregistrement && sessionAuMomentEnregistrement.id) {
            verrouillerSessionHeidiConnecteur(signal, sessionAuMomentEnregistrement, 'recording_started_confirmed');
        }

        definirFaviconHeidiStatut('recording', {
            message: 'Transcription confirmée',
            details: confirmationTranscription
        });
        afficherBadge('AUTO-HH : transcription lancée', 4000);
        console.info('[AUTO-HH] Transcription lancée et confirmée.');
        ajouterLogAutoHH('heidi-launch-done', { signal, sessionAuMomentEnregistrement, confirmationTranscription });
        return true;
    } catch (error) {
        console.error('[AUTO-HH] Erreur lancement Heidi :', error);
        ajouterLogAutoHH('heidi-launch-error', {
            signal,
            erreur: String(error && error.message ? error.message : error),
            stack: String(error && error.stack ? error.stack : '').slice(0, 1500)
        });
        definirFaviconHeidiStatut('error', { duree: 7000 });
        afficherBadge('AUTO-HH erreur lancement : ' + String(error.message || error), 10000);
        return false;
    } finally {
        await sleep(1000);
        automatisationEnCours = false;
    }
}


    async function arreterTranscriptionEtTransferer(signal) {
        if (!EST_HEIDI) return;

        const maintenantStop = Date.now();
        if (
            stopTransferHeidiEnCours ||
            (
                dernierStopTransferHeidiTraite &&
                maintenantStop - dernierStopTransferHeidiTraite < DELAI_BLOCAGE_DOUBLE_STOP_TRANSFER_MS
            )
        ) {
            console.info('[AUTO-HH] Arrêt/transfert Heidi ignoré : opération déjà en cours ou récente.', {
                stopTransferHeidiEnCours,
                ageMs: dernierStopTransferHeidiTraite ? maintenantStop - dernierStopTransferHeidiTraite : null
            });
            afficherBadge('AUTO-HH : arrêt/transfert déjà en cours', 5000);
            return;
        }

        stopTransferHeidiEnCours = true;
        dernierStopTransferHeidiTraite = maintenantStop;

        if (automatisationEnCours) {
            afficherBadge('AUTO-HH : arrêt demandé, attente fin action en cours', 3500);
            const disponible = await attendreAutomatisationHeidiDisponible('arrêt/transfert', 12000);
            if (!disponible) {
                console.warn('[AUTO-HH] Heidi encore occupé, arrêt/transfert impossible pour le moment.');
                definirFaviconHeidiStatut('error', { duree: 8000 });
                afficherBadge('AUTO-HH : Heidi occupé, arrêt non lancé', 8000);
                stopTransferHeidiEnCours = false;
                return;
            }
        }

        automatisationEnCours = true;

        try {
            console.info('[AUTO-HH] Début arrêt Heidi + transfert WEDA.');
            definirFaviconHeidiStatut('stopping');
            afficherBadge('AUTO-HH : arrêt transcription demandé', 3000);

            const sessionCibleStop = getSessionHeidiCibleDepuisSignal(signal);
            ajouterLogAutoHH('heidi-stop-session-target', {
                signal,
                sessionCibleStop,
                sessionCouranteAvantStop: getSessionHeidiCourante({ preferMenu: true, includeStorage: false })
            });

            const sessionRestauree = await restaurerSessionHeidiCible(signal, 'avant_arret_transcription');
            if (!sessionRestauree) {
                definirFaviconHeidiStatut('error', { duree: 8000 });
                afficherBadge('AUTO-HH : mauvaise session Heidi, arrêt annulé', 9000);
                ajouterLogAutoHH('heidi-stop-aborted-session-restore-failed', {
                    signal,
                    sessionCourante: getSessionHeidiCourante(),
                    sessionCible: getSessionHeidiCibleDepuisSignal(signal)
                });
                return;
            }

            ajouterLogAutoHH('heidi-stop-session-restored', {
                signal,
                sessionCibleStop,
                sessionCouranteApresRestore: getSessionHeidiCourante({ preferMenu: true, includeStorage: false })
            });

            await sleep(700);

            let boutonArret = getBoutonArretTranscription();
            let boutonCopierInitial = getBoutonCopierHeidi();

            ajouterLogAutoHH('heidi-stop-buttons-initial', {
                boutonArret: decrireBoutonHeidi(boutonArret),
                boutonCopier: decrireBoutonHeidi(boutonCopierInitial)
            });

            if (!boutonArret && !boutonCopierInitial) {
                boutonArret = await waitForElement(getBoutonArretTranscription, 'Arrêter la transcription Heidi', 8000);
                boutonCopierInitial = getBoutonCopierHeidi();
                ajouterLogAutoHH('heidi-stop-button-wait-result', {
                    boutonArret: decrireBoutonHeidi(boutonArret),
                    boutonCopier: decrireBoutonHeidi(boutonCopierInitial),
                    boutons: boutonArret || boutonCopierInitial ? null : listerBoutonsHeidiPourDiagnostic()
                });
            }

            if (boutonArret) {
                const okArret = await cliquerBoutonArretTranscriptionHeidi(boutonArret);
                ajouterLogAutoHH('heidi-stop-button-click-result', {
                    okArret,
                    boutonArret: decrireBoutonHeidi(boutonArret),
                    boutonCopierApresClic: decrireBoutonHeidi(getBoutonCopierHeidi())
                });
                if (!okArret) {
                    afficherBadge('AUTO-HH : clic arrêt tenté, attente génération', 5000);
                }
            } else {
                console.info('[AUTO-HH] Bouton Arrêter non trouvé. On continue si le bouton Copier est déjà disponible.');
                listerBoutonsHeidiPourDiagnostic();
                afficherBadge('AUTO-HH : arrêt non trouvé, attente génération', 4000);
            }

            ajouterLogAutoHH('heidi-copy-wait-start', {
                signal,
                sessionCibleStop,
                boutonCopierInitial: decrireBoutonHeidi(getBoutonCopierHeidi()),
                timeoutMs: TIMEOUT_GENERATION_HEIDI_MS
            });

            const boutonCopier = sessionCibleStop && sessionCibleStop.id
                ? await attendreBoutonCopierHeidiSurSession(signal, sessionCibleStop, TIMEOUT_GENERATION_HEIDI_MS)
                : await waitForElement(getBoutonCopierHeidi, 'Copier Heidi', TIMEOUT_GENERATION_HEIDI_MS);

            ajouterLogAutoHH(boutonCopier ? 'heidi-copy-button-found' : 'heidi-copy-button-missing', {
                boutonCopier: decrireBoutonHeidi(boutonCopier),
                boutons: boutonCopier ? null : listerBoutonsHeidiPourDiagnostic()
            });

            if (!boutonCopier) {
                definirFaviconHeidiStatut('error', { duree: 8000 });
                afficherBadge('AUTO-HH : bouton Copier introuvable', 8000);
                return;
            }

            afficherBadge('AUTO-HH : génération Heidi terminée', 3000);

            await sleep(DELAI_MIN_APRES_BOUTON_COPIER_HEIDI_MS);
            await verifierOuRestaurerSessionHeidiPendantPhase(signal, sessionCibleStop, 'avant_lecture_contenu_final');
            const contenuHeidi = await waitForContenuHeidiStable(TIMEOUT_GENERATION_HEIDI_MS, signal, sessionCibleStop);

            ajouterLogAutoHH(contenuHeidi && contenuHeidi.texte ? 'heidi-content-stable-found' : 'heidi-content-stable-missing', {
                longueurTexte: contenuHeidi && contenuHeidi.texte ? contenuHeidi.texte.length : 0,
                longueurHtml: contenuHeidi && contenuHeidi.html ? contenuHeidi.html.length : 0,
                apercu: contenuHeidi && contenuHeidi.texte ? contenuHeidi.texte.slice(0, 220) : ''
            });

            if (!contenuHeidi || !contenuHeidi.texte) {
                definirFaviconHeidiStatut('error', { duree: 8000 });
                afficherBadge('AUTO-HH : contenu Heidi vide ou introuvable', 8000);
                return;
            }

            if (contenuHeidiEstContexteWeda(contenuHeidi)) {
                definirFaviconHeidiStatut('error', { duree: 8000 });
                afficherBadge('AUTO-HH : transfert annulé, contexte WEDA détecté', 8000);
                console.warn('[AUTO-HH] Transfert annulé : le contenu récupéré correspond au contexte WEDA, pas à une consultation.', {
                    apercu: String(contenuHeidi.texte || '').slice(0, 300)
                });
                return;
            }

            const wedaUrl = signal?.wedaUrl || GM_getValue(CLE_LAST_WEDA_URL, null);
            if (!wedaUrl) {
                definirFaviconHeidiStatut('error', { duree: 8000 });
                afficherBadge('AUTO-HH : aucun onglet WEDA connu', 8000);
                console.warn('[AUTO-HH] Aucun URL WEDA disponible pour le transfert.');
                return;
            }

            const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            const job = {
                jobId,
                status: 'pending',
                createdAt: Date.now(),
                wedaUrl,
                wedaOpenerId: signal?.wedaOpenerId || null,
                sourceWedaUrl: signal?.wedaUrl || wedaUrl || null,
                heidiWorkerId: signal?.heidiWorkerId || getHeidiWorkerIdLocal() || null,
                heidiSessionId: (sessionCibleStop && sessionCibleStop.id) || getSessionHeidiCourante({ preferMenu: true, includeStorage: false })?.id || signal?.heidiSessionId || null,
                heidiSessionUrl: (sessionCibleStop && sessionCibleStop.url) || getSessionHeidiCourante({ preferMenu: true, includeStorage: false })?.url || signal?.heidiSessionUrl || null,
                texte: contenuHeidi.texte,
                html: contenuHeidi.html
            };

            GM_setValue(CLE_TRANSFER_PREFIX + jobId, job);
            ajouterLogAutoHH('heidi-transfer-job-created', {
                jobId,
                wedaUrl,
                heidiWorkerId: job.heidiWorkerId || null,
                heidiSessionId: job.heidiSessionId || null,
                longueurTexte: contenuHeidi.texte.length,
                longueurHtml: contenuHeidi.html ? contenuHeidi.html.length : 0
            });
            ouvrirWedaEnArrierePlan(wedaUrl, jobId, job);

            definirFaviconHeidiStatut('transferring');
            afficherBadge('AUTO-HH : contenu envoyé vers WEDA', 5000);
            console.info('[AUTO-HH] Job transfert créé :', {
                jobId,
                wedaUrl,
                heidiWorkerId: job.heidiWorkerId || null,
                longueurTexte: contenuHeidi.texte.length,
                longueurHtml: contenuHeidi.html ? contenuHeidi.html.length : 0
            });

            surveillerStatutTransfert(jobId);
        } catch (error) {
            console.error('[AUTO-HH] Erreur arrêt/transfert :', error);
            definirFaviconHeidiStatut('error', { duree: 8000 });
            afficherBadge('AUTO-HH erreur transfert : ' + String(error.message || error), 10000);
        } finally {
            await sleep(1000);
            automatisationEnCours = false;
            stopTransferHeidiEnCours = false;
        }
    }

    /************************************************************
     * WEDA WORKER
     ************************************************************/

    function nettoyerUrlPourOnglet(url) {
        return String(url || '').split('#')[0];
    }

    function publierDemandeOuvertureWorkerWeda(wedaUrl, jobId, job = null) {
        if (!jobId || !String(jobId).startsWith('job_')) return null;

        const urlBase = nettoyerUrlPourOnglet(wedaUrl);
        const patDk = getParamPatDkDepuisUrl(urlBase);
        const demande = {
            type: 'weda_worker_open_request',
            version: VERSION_AUTO_HH,
            jobId,
            timestamp: Date.now(),
            nonce: Math.random().toString(36).slice(2),
            wedaUrl: urlBase,
            patDk,
            wedaOpenerId: job && (job.wedaOpenerId || job.wedaOpenedBy) || null,
            source: location.href,
            sourceHost: HOST
        };

        try { GM_setValue(CLE_WEDA_WORKER_OPEN_REQUEST, demande); } catch (e) {}
        ajouterLogAutoHH('weda-worker-open-request-published', demande);
        return demande;
    }

    function getOwnerRepriseWorkerWeda() {
        let owner = null;
        try { owner = sessionStorage.getItem('auto_hh_weda_worker_claim_owner_stable'); } catch (e) {}
        if (!owner) {
            owner = 'weda_worker_claim_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            try { sessionStorage.setItem('auto_hh_weda_worker_claim_owner_stable', owner); } catch (e) {}
        }
        return owner;
    }

    function jobTransfertWedaEstReprenable(jobId, demande) {
        if (!jobId || !String(jobId).startsWith('job_')) return false;

        let job = null;
        try { job = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null); } catch (e) { job = null; }
        if (!job || job.jobId !== jobId) return false;

        if (['saved', 'saved_and_closed', 'error'].includes(String(job.status || ''))) return false;

        const hrefCourant = getTopHref();
        const hrefCourantLower = String(hrefCourant || '').toLowerCase();
        const pageDossierPatientCourante =
            hrefCourantLower.includes(PAGE_WEDA_PATIENT) ||
            hrefCourantLower.includes(PAGE_WEDA_CONSULTATION) ||
            hrefCourantLower.includes(PAGE_WEDA_FSE);
        const patDkCourant = getParamPatDkDepuisUrl(hrefCourant);

        if (!pageDossierPatientCourante || !patDkCourant) {
            ajouterLogAutoHH('weda-worker-open-request-ignored-not-patient-page', {
                jobId,
                href: hrefCourant,
                pageDossierPatientCourante,
                patDkCourant
            });
            return false;
        }

        const patDkDemande = demande && demande.patDk ? String(demande.patDk) : '';
        const patDkJob = getParamPatDkDepuisUrl(job.wedaUrl || job.sourceWedaUrl || '');

        if (patDkDemande && patDkDemande !== patDkCourant) return false;
        if (patDkJob && String(patDkJob) !== String(patDkCourant)) return false;

        return true;
    }

    function revendiquerDemandeOuvertureWorkerWeda(demande, origine) {
        if (!demande || !demande.jobId) return false;

        const owner = getOwnerRepriseWorkerWeda();
        const maintenant = Date.now();

        try {
            const demandeCourante = GM_getValue(CLE_WEDA_WORKER_OPEN_REQUEST, null);
            if (!demandeCourante || demandeCourante.jobId !== demande.jobId || demandeCourante.nonce !== demande.nonce) return false;

            if (
                demandeCourante.claimedBy &&
                demandeCourante.claimedBy !== owner &&
                maintenant - Number(demandeCourante.claimedAt || 0) < DELAI_REPRISE_WORKER_WEDA_MS
            ) {
                ajouterLogAutoHH('weda-worker-open-request-claim-existing', {
                    origine,
                    owner,
                    demandeCourante
                });
                return false;
            }

            GM_setValue(CLE_WEDA_WORKER_OPEN_REQUEST, {
                ...demandeCourante,
                claimedBy: owner,
                claimedAt: maintenant,
                claimedHref: getTopHref(),
                claimedVisibility: (() => { try { return document.visibilityState; } catch (e) { return null; } })()
            });

            const verification = GM_getValue(CLE_WEDA_WORKER_OPEN_REQUEST, null);
            const ok = !!(verification && verification.jobId === demande.jobId && verification.claimedBy === owner);

            ajouterLogAutoHH(ok ? 'weda-worker-open-request-claim-won' : 'weda-worker-open-request-claim-lost', {
                origine,
                owner,
                demande,
                verification
            });

            return ok;
        } catch (e) {
            ajouterLogAutoHH('weda-worker-open-request-claim-error', {
                origine,
                demande,
                erreur: String(e && e.message ? e.message : e)
            });
            return true;
        }
    }

    function estOngletWorkerContexteWedaActuel() {
        if (!EST_WEDA) return false;

        try {
            const hash = String(location.hash || '').replace(/^#/, '');
            const params = new URLSearchParams(hash);
            const jobContexteHash = params.get('AUTO_HH_WEDA_CONTEXT_WORKER');
            if (jobContexteHash && String(jobContexteHash).startsWith('ctx_')) return true;
        } catch (e) {}

        try {
            const jobContexteSession = sessionStorage.getItem('auto_hh_weda_context_worker_job_stable');
            if (jobContexteSession && String(jobContexteSession).startsWith('ctx_')) return true;
        } catch (e) {}

        return false;
    }

    function getJobIdDepuisDemandeOuvertureWorkerWeda() {
        if (!EST_WEDA || !isTopFrame()) return null;

        if (estOngletWorkerContexteWedaActuel()) {
            ajouterLogAutoHH('weda-worker-open-request-ignored-context-worker', {
                href: getTopHref()
            });
            return null;
        }

        let demande = null;
        try { demande = GM_getValue(CLE_WEDA_WORKER_OPEN_REQUEST, null); } catch (e) { demande = null; }
        if (!demande || demande.type !== 'weda_worker_open_request' || !demande.jobId) return null;

        const ageMs = Date.now() - Number(demande.timestamp || 0);
        if (!Number.isFinite(ageMs) || ageMs < -5000 || ageMs > DELAI_REPRISE_WORKER_WEDA_MS) return null;

        try {
            if (document.visibilityState !== 'hidden') {
                ajouterLogAutoHH('weda-worker-open-request-ignored-visible-tab', {
                    demande,
                    href: getTopHref(),
                    visibility: document.visibilityState
                });
                return null;
            }
        } catch (e) {}

        if (!jobTransfertWedaEstReprenable(demande.jobId, demande)) {
            ajouterLogAutoHH('weda-worker-open-request-ignored-not-recoverable', {
                demande,
                href: getTopHref()
            });
            return null;
        }

        if (!revendiquerDemandeOuvertureWorkerWeda(demande, 'initialiserWorkerWedaSiBesoin')) return null;
        return demande.jobId;
    }

    function ouvrirWedaEnArrierePlan(wedaUrl, jobId, job = null) {
        const urlBase = nettoyerUrlPourOnglet(wedaUrl);
        const urlWorker = urlBase + '#AUTO_HH_WEDA_WORKER=' + encodeURIComponent(jobId);
        console.info('[AUTO-HH] Ouverture WEDA worker en arrière-plan :', urlWorker);
        publierDemandeOuvertureWorkerWeda(wedaUrl, jobId, job);
        ajouterLogAutoHH('weda-worker-open-tab-request', {
            jobId,
            wedaUrl,
            urlWorker
        });

        try {
            const onglet = GM_openInTab(urlWorker, { active: false, insert: true, setParent: true });
            if (onglet) ongletsWedaWorkers[jobId] = onglet;
        } catch (e) {
            console.warn('[AUTO-HH] GM_openInTab indisponible, fallback window.open :', e);
            window.open(urlWorker, '_blank');
        }
    }

    async function surveillerStatutTransfert(jobId) {
        if (!EST_HEIDI && !EST_WEDA) return;

        definirFaviconHeidiStatut('transferring');

        const key = CLE_TRANSFER_PREFIX + jobId;
        const start = Date.now();
        let fermetureDemandee = false;

        function demanderFermetureOnglet(job, raison) {
            if (fermetureDemandee) return;
            fermetureDemandee = true;

            const jobFinal = {
                ...job,
                status: 'saved_and_closed',
                message: 'Consultation WEDA sauvegardée, fermeture onglet demandée',
                closeReason: raison,
                updatedAt: Date.now()
            };

            delete jobFinal.texte;
            delete jobFinal.html;

            try { GM_setValue(key, jobFinal); } catch (e) {}

            demanderRetourAccueilOrigineWeda(jobId, jobFinal, raison);

            envoyerNotificationGlobale('done', 'Toutes les tâches sont terminées, fermeture de l’onglet WEDA', { jobId, raison, duree: 9000 });
            definirFaviconHeidiStatut('done', { duree: 9000 });
            console.info('[AUTO-HH] Demande fermeture onglet WEDA worker :', { jobId, raison, job: jobFinal });

            try {
                const onglet = ongletsWedaWorkers[jobId];
                if (onglet && typeof onglet.close === 'function') {
                    onglet.close();
                    console.info('[AUTO-HH] Onglet WEDA worker fermé via handle GM_openInTab.');
                } else {
                    console.warn('[AUTO-HH] Aucun handle GM_openInTab disponible pour fermer l’onglet.');
                }
            } catch (e) {
                console.warn('[AUTO-HH] Impossible de fermer l’onglet WEDA via handle :', e);
            }

            delete ongletsWedaWorkers[jobId];
            setTimeout(() => {
                try { GM_deleteValue(key); } catch (e) {}
            }, 15000);
        }

        const timer = setInterval(() => {
            const job = GM_getValue(key, null);
            if (!job) {
                clearInterval(timer);
                return;
            }

            if (job.status === 'saved_and_closed' || job.status === 'saved') {
                clearInterval(timer);
                demanderFermetureOnglet(job, job.status);
                return;
            }

            if (job.status === 'saving' && job.saveCloseReason === 'accueil_patient') {
                clearInterval(timer);
                demanderFermetureOnglet(job, 'accueil_patient_detecte');
                return;
            }

            if (job.status === 'saving') {
                const ageSaving = Date.now() - (job.updatedAt || job.createdAt || start);
                if (ageSaving > Math.max(DELAI_APRES_SAVE_AVANT_FERMETURE_MS + 800, 2500)) {
                    clearInterval(timer);
                    demanderFermetureOnglet(job, 'saving_confirmed_after_weda_navigation');
                    return;
                }
                console.info('[AUTO-HH] Sauvegarde WEDA en cours, attente fermeture...', { jobId, ageSaving });
                return;
            }

            if (job.status === 'inserted' || job.status === 'tagging' || job.status === 'tags_done') {
                console.info('[AUTO-HH] Transfert WEDA en cours :', job.status);
                return;
            }

            if (job.status === 'error') {
                clearInterval(timer);
                definirFaviconHeidiStatut('error', { duree: 10000 });
                afficherBadge('AUTO-HH : erreur insertion/sauvegarde WEDA', 8000);
                console.warn('[AUTO-HH] Transfert WEDA en erreur :', job);
                delete ongletsWedaWorkers[jobId];
                return;
            }

            if (job.status === 'weda_error_page') {
                clearInterval(timer);
                definirFaviconHeidiStatut('error', { duree: 10000 });
                afficherBadge('AUTO-HH : page erreur WEDA pendant le transfert', 10000);
                console.warn('[AUTO-HH] Worker WEDA tombé sur error.aspx :', job);
                delete ongletsWedaWorkers[jobId];
                return;
            }

            if (Date.now() - start > 150000) {
                clearInterval(timer);
                definirFaviconHeidiStatut('error', { duree: 10000 });
                console.warn('[AUTO-HH] Surveillance transfert expirée.');
                delete ongletsWedaWorkers[jobId];
            }
        }, 500);
    }

    function getJobIdDepuisHash() {
        try {
            const hash = String(location.hash || '').replace(/^#/, '');
            const params = new URLSearchParams(hash);
            return params.get('AUTO_HH_WEDA_WORKER');
        } catch (e) {
            return null;
        }
    }

   function memoriserDernierWedaActif(origine = 'auto') {
    if (!EST_WEDA || !isTopFrame()) return;

    try {
        if (document.visibilityState === 'hidden') return;
    } catch (e) {}

    const jobHash = getJobIdDepuisHash();
    const jobSession = sessionStorage.getItem(CLE_SESSION_JOB);

    if (jobSession && String(jobSession).startsWith('ctx_')) {
        try { sessionStorage.removeItem(CLE_SESSION_JOB); } catch (e) {}
        console.info('[AUTO-HH] Ancien job contexte retiré de la session WEDA active :', jobSession);
    } else if (jobSession) {
        return;
    }

    if (jobHash) return;

    const href = getTopHref().split('#')[0];
    const hrefLower = String(href || '').toLowerCase();
    const patDk = getParamPatDkDepuisUrl(href);

    if (!patDk) return;

    const estPagePatient =
        hrefLower.includes(PAGE_WEDA_PATIENT) ||
        hrefLower.includes(PAGE_WEDA_CONSULTATION) ||
        hrefLower.includes(PAGE_WEDA_FSE);

    if (!estPagePatient) return;

    const snapshot = {
        url: href,
        patDk: patDk,
        timestamp: Date.now(),
        origine: origine
    };

    GM_setValue(CLE_WEDA_ACTIVE_SNAPSHOT, snapshot);
    GM_setValue(CLE_LAST_WEDA_URL, href);

    console.info('[AUTO-HH] Page WEDA active mémorisée :', snapshot);
}

    function mettreAJourJob(jobId, patch, retirerContenu = false) {
        const key = CLE_TRANSFER_PREFIX + jobId;
        const job = GM_getValue(key, null);
        if (!job) return;

        const nouveauJob = { ...job, ...patch, updatedAt: Date.now() };
        if (retirerContenu) {
            delete nouveauJob.texte;
            delete nouveauJob.html;
        }
        GM_setValue(key, nouveauJob);
    }

    function decoderChaineJavascriptAttributWeda(valeur) {
        return String(valeur || '')
            .replace(/\\\\/g, '\\')
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"');
    }

    function extrairePostBackWedaDepuisElement(element) {
        if (!element) return null;

        const candidats = [];
        let courant = element;
        for (let i = 0; courant && i < 5; i += 1) {
            candidats.push(courant);
            courant = courant.parentElement;
        }

        for (const el of candidats) {
            const valeurs = [
                el.getAttribute?.('onclick') || '',
                el.getAttribute?.('href') || '',
                el.getAttribute?.('onmousedown') || ''
            ];

            for (const valeurBrute of valeurs) {
                const valeur = String(valeurBrute || '');
                if (!valeur.includes('__doPostBack')) continue;

                const matchSimple = valeur.match(/__doPostBack\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
                if (matchSimple) {
                    return {
                        eventTarget: decoderChaineJavascriptAttributWeda(matchSimple[1]),
                        eventArgument: decoderChaineJavascriptAttributWeda(matchSimple[2]),
                        eventTargetBrut: matchSimple[1],
                        eventArgumentBrut: matchSimple[2],
                        source: 'attribut_simple_quote',
                        attribut: valeur
                    };
                }

                const matchDouble = valeur.match(/__doPostBack\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/);
                if (matchDouble) {
                    return {
                        eventTarget: decoderChaineJavascriptAttributWeda(matchDouble[1]),
                        eventArgument: decoderChaineJavascriptAttributWeda(matchDouble[2]),
                        eventTargetBrut: matchDouble[1],
                        eventArgumentBrut: matchDouble[2],
                        source: 'attribut_double_quote',
                        attribut: valeur
                    };
                }
            }
        }

        return null;
    }

    function decrireElementWeda(element) {
        if (!element) return null;

        let rect = null;
        try {
            const r = element.getBoundingClientRect();
            rect = {
                x: Math.round(r.x),
                y: Math.round(r.y),
                width: Math.round(r.width),
                height: Math.round(r.height)
            };
        } catch (e) {}

        return {
            tag: String(element.tagName || '').toLowerCase(),
            id: element.id || null,
            href: String(element.getAttribute?.('href') || '').slice(0, 180),
            onclick: String(element.getAttribute?.('onclick') || '').slice(0, 220),
            title: String(element.getAttribute?.('title') || '').slice(0, 120),
            text: String(element.innerText || element.textContent || element.value || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            visible: isVisible(element),
            rect
        };
    }

    function getBoutonAccueilWeda() {
        const images = [...document.querySelectorAll(SELECTEUR_IMAGE_ACCUEIL_WEDA)];
        const candidatsImages = images
            .map(img => img.closest('a, button, [role="button"]') || img)
            .filter(Boolean);

        const candidatAvecPostBack = candidatsImages.find(el => {
            const postBack = extrairePostBackWedaDepuisElement(el);
            const src = String(el.querySelector?.('img')?.getAttribute('src') || el.getAttribute?.('src') || '');
            return postBack && String(postBack.eventTarget || '').includes('MenuNavigate') && /W_BLEU|Weda|weda/i.test(src);
        });
        if (candidatAvecPostBack) return candidatAvecPostBack;

        const imageW = images.find(img => {
            const src = String(img.getAttribute('src') || img.src || '');
            const alt = String(img.getAttribute('alt') || '');
            const title = String(img.getAttribute('title') || '');
            return src.includes('W_BLEU') || alt.toLowerCase().includes('weda') || title.toLowerCase().includes('weda') || title.toLowerCase().includes('accueil');
        });

        if (imageW) return imageW.closest('a, button, [role="button"]') || imageW;

        const liens = [...document.querySelectorAll('a, button, [role="button"]')];
        return liens.find(el => {
            const texte = normaliserTexte(el.innerText || el.textContent || '');
            const title = normaliserTexte(el.getAttribute?.('title') || '');
            const postBack = extrairePostBackWedaDepuisElement(el);
            return (postBack && String(postBack.eventTarget || '').includes('MenuNavigate') && (texte === 'w' || title.includes('accueil') || title.includes('weda'))) ||
                texte === 'w' || texte.includes('accueil') || title.includes('accueil') || title.includes('weda');
        }) || null;
    }

    function appelerPostBackAccueilPatientWeda(sourceLog, details = {}) {
        const boutonAccueil = getBoutonAccueilWeda();
        const postBackBouton = extrairePostBackWedaDepuisElement(boutonAccueil);

        if (postBackBouton && postBackBouton.eventTarget) {
            const okPostBackBouton = appelerPostBackWeda(postBackBouton.eventTarget, postBackBouton.eventArgument || '');
            ajouterLogAutoHH('weda-home-return-postback-from-button', {
                sourceLog,
                okPostBackBouton,
                postBackBouton,
                bouton: decrireElementWeda(boutonAccueil),
                ...details
            });
            if (okPostBackBouton) return true;
        }

        if (estPageConsultationWeda()) {
            const okConsultation = appelerPostBackWeda(POSTBACK_MENU_EVENTTARGET_WEDA, POSTBACK_RETOUR_ACCUEIL_WEDA);
            ajouterLogAutoHH('weda-home-return-eventuc-postback', {
                sourceLog,
                okConsultation,
                eventTarget: POSTBACK_MENU_EVENTTARGET_WEDA,
                eventArgument: POSTBACK_RETOUR_ACCUEIL_WEDA,
                ...details
            });
            if (okConsultation) return true;
        }

        const okGeneral = appelerPostBackWeda(POSTBACK_MENU_GENERAL_EVENTTARGET_WEDA, POSTBACK_RETOUR_ACCUEIL_GENERAL_WEDA);
        ajouterLogAutoHH('weda-home-return-general-postback', {
            sourceLog,
            okGeneral,
            eventTarget: POSTBACK_MENU_GENERAL_EVENTTARGET_WEDA,
            eventArgument: POSTBACK_RETOUR_ACCUEIL_GENERAL_WEDA,
            ...details
        });
        if (okGeneral) return true;

        const okGeneralAlt = appelerPostBackWeda(POSTBACK_MENU_GENERAL_EVENTTARGET_WEDA, POSTBACK_RETOUR_ACCUEIL_GENERAL_ALT_WEDA);
        ajouterLogAutoHH('weda-home-return-general-postback-alt', {
            sourceLog,
            okGeneralAlt,
            eventTarget: POSTBACK_MENU_GENERAL_EVENTTARGET_WEDA,
            eventArgument: POSTBACK_RETOUR_ACCUEIL_GENERAL_ALT_WEDA,
            ...details
        });
        if (okGeneralAlt) return true;

        if (boutonAccueil) {
            afficherBadge('AUTO-HH : clic bouton W / accueil', 4000);
            const okClic = clickElement(boutonAccueil, 'Bouton W / accueil WEDA', { clicUnique: true });
            ajouterLogAutoHH('weda-home-return-native-click-fallback', {
                sourceLog,
                okClic,
                bouton: decrireElementWeda(boutonAccueil),
                ...details
            });
            if (okClic) return true;
        }

        return false;
    }

    function ouvrirAccueilPatientWeda() {
        console.info('[AUTO-HH] Tentative retour accueil patient WEDA.');

        const okRetourNatif = appelerPostBackAccueilPatientWeda('ouvrirAccueilPatientWeda', {
            hrefAvant: getTopHref(),
            dejaAccueilPatient: estPageAccueilPatientWeda()
        });
        if (okRetourNatif) return true;

        console.warn('[AUTO-HH] Impossible de revenir à l’accueil patient WEDA par contrôle natif. Navigation directe interdite pour éviter une déconnexion.');
        return false;
    }


    function estOngletWorkerWedaAutoHH() {
        if (!EST_WEDA || !isTopFrame()) return false;
        const jobHash = getJobIdDepuisHash();
        if (jobHash) return true;
        try {
            const jobSession = sessionStorage.getItem(CLE_SESSION_JOB);
            if (jobSession && String(jobSession).startsWith('job_')) return true;
        } catch (e) {}
        return false;
    }

    function construireDemandeRetourAccueilOrigineWeda(jobId, job, raison) {
        const wedaUrl = String((job && (job.sourceWedaUrl || job.wedaUrl)) || '');
        const urlAccueil = construireUrlPatientDepuisUrl(wedaUrl);
        const patDk = getParamPatDkDepuisUrl(wedaUrl);
        if (!urlAccueil || !patDk) return null;

        return {
            type: 'retour_accueil_origine_weda',
            version: VERSION_AUTO_HH,
            jobId: jobId || (job && job.jobId) || null,
            timestamp: Date.now(),
            nonce: Math.random().toString(36).slice(2),
            wedaOpenerId: (job && (job.wedaOpenerId || job.wedaOpenedBy)) || null,
            patDk,
            urlAccueil,
            sourceWedaUrl: wedaUrl,
            raison: raison || null
        };
    }

    function demanderRetourAccueilOrigineWeda(jobId, job, raison) {
        const demande = construireDemandeRetourAccueilOrigineWeda(jobId, job, raison);
        if (!demande) {
            ajouterLogAutoHH('weda-origin-home-return-request-skipped', {
                jobId,
                raison,
                cause: 'url_accueil_introuvable',
                job: job ? {
                    status: job.status || null,
                    wedaUrl: job.wedaUrl || null,
                    sourceWedaUrl: job.sourceWedaUrl || null,
                    wedaOpenerId: job.wedaOpenerId || null,
                    wedaOpenedBy: job.wedaOpenedBy || null
                } : null
            });
            return false;
        }

        try {
            GM_setValue(CLE_RETOUR_ACCUEIL_ORIGINE_WEDA, demande);
            ajouterLogAutoHH('weda-origin-home-return-request-sent', demande);
            console.info('[AUTO-HH] Demande retour accueil envoyée à l’onglet WEDA d’origine :', demande);
            return true;
        } catch (e) {
            console.warn('[AUTO-HH] Impossible d’envoyer la demande retour accueil origine WEDA :', e);
            return false;
        }
    }

    function getCleRetourAccueilOrigineWeda(demande) {
        if (!demande) return '';
        return [demande.jobId || '', demande.timestamp || '', demande.nonce || ''].join('|');
    }

    function demandeRetourAccueilOrigineDejaTraitee(cleTraitement) {
        if (!cleTraitement) return false;
        if (cleTraitement === derniereDemandeRetourAccueilOrigineTraitee) return true;

        try {
            const marqueur = GM_getValue(CLE_RETOUR_ACCUEIL_ORIGINE_WEDA_TRAITE, null);
            if (!marqueur) return false;
            if (String(marqueur.cle || '') !== String(cleTraitement)) return false;

            const ageMs = Date.now() - Number(marqueur.timestamp || 0);
            if (Number.isFinite(ageMs) && ageMs > 0 && ageMs < 10 * 60 * 1000) {
                return true;
            }
        } catch (e) {}

        return false;
    }

    function marquerDemandeRetourAccueilOrigineTraitee(cleTraitement, demande, origine) {
        if (!cleTraitement) return;
        derniereDemandeRetourAccueilOrigineTraitee = cleTraitement;

        try {
            GM_setValue(CLE_RETOUR_ACCUEIL_ORIGINE_WEDA_TRAITE, {
                cle: cleTraitement,
                jobId: demande && demande.jobId || null,
                nonce: demande && demande.nonce || null,
                requestTimestamp: demande && demande.timestamp || null,
                timestamp: Date.now(),
                origine: origine || null,
                version: VERSION_AUTO_HH
            });
        } catch (e) {}

        try {
            const demandeCourante = GM_getValue(CLE_RETOUR_ACCUEIL_ORIGINE_WEDA, null);
            const cleCourante = getCleRetourAccueilOrigineWeda(demandeCourante);
            if (cleCourante && cleCourante === cleTraitement) {
                GM_deleteValue(CLE_RETOUR_ACCUEIL_ORIGINE_WEDA);
            }
        } catch (e) {}
    }

    function traiterDemandeRetourAccueilOrigineWeda(demande, origine) {
        if (!EST_WEDA || !isTopFrame()) return false;
        if (!demande || demande.type !== 'retour_accueil_origine_weda') return false;
        if (!demande.jobId || !demande.urlAccueil || !demande.patDk) return false;

        const cleTraitement = getCleRetourAccueilOrigineWeda(demande);
        if (demandeRetourAccueilOrigineDejaTraitee(cleTraitement)) {
            ajouterLogAutoHH('weda-origin-home-return-ignored-already-done', {
                origine,
                cleTraitement,
                demande,
                href: getTopHref()
            });
            return false;
        }

        const ageMs = Date.now() - Number(demande.timestamp || 0);
        if (!Number.isFinite(ageMs) || ageMs < -5000 || ageMs > 120000) return false;

        if (estOngletWorkerWedaAutoHH()) {
            ajouterLogAutoHH('weda-origin-home-return-ignored-worker', {
                origine,
                demande,
                href: getTopHref(),
                jobSession: (() => { try { return sessionStorage.getItem(CLE_SESSION_JOB); } catch (e) { return null; } })()
            });
            return false;
        }

        const openerLocal = obtenirWedaOpenerId();
        if (demande.wedaOpenerId && openerLocal && demande.wedaOpenerId !== openerLocal) {
            return false;
        }

        const patDkCourant = getParamPatDkDepuisUrl(getTopHref());
        if (patDkCourant && demande.patDk && String(patDkCourant) !== String(demande.patDk)) {
            ajouterLogAutoHH('weda-origin-home-return-ignored-other-patient', {
                origine,
                demandePatDk: demande.patDk,
                patDkCourant,
                href: getTopHref()
            });
            return false;
        }

        marquerDemandeRetourAccueilOrigineTraitee(cleTraitement, demande, origine);
        ajouterLogAutoHH('weda-origin-home-return-run', {
            origine,
            demande,
            hrefAvant: getTopHref(),
            openerLocal
        });

        afficherBadge('AUTO-HH : retour accueil patient pour contrôle', 5000, { force: true });

        setTimeout(() => {
            try {
                const hrefAvant = getTopHref();
                const dejaAccueilPatient = estPageAccueilPatientWeda();
                const okRetourNatif = appelerPostBackAccueilPatientWeda('retour_accueil_origine', {
                    origine,
                    hrefAvant,
                    dejaAccueilPatient,
                    demande
                });

                if (okRetourNatif) {
                    ajouterLogAutoHH('weda-origin-home-return-native-ok', {
                        origine,
                        hrefAvant,
                        dejaAccueilPatient,
                        demande
                    });
                    return;
                }

                ajouterLogAutoHH('weda-origin-home-return-safe-skip', {
                    origine,
                    hrefAvant,
                    dejaAccueilPatient,
                    cause: 'aucun_controle_weda_natif_trouve_navigation_url_directe_interdite'
                });
            } catch (e) {
                console.warn('[AUTO-HH] Retour accueil onglet WEDA d’origine impossible :', e);
            }
        }, 350);

        return true;
    }

    function initialiserEcouteRetourAccueilOrigineWeda() {
        if (!EST_WEDA || !isTopFrame()) return;

        try {
            GM_addValueChangeListener(CLE_RETOUR_ACCUEIL_ORIGINE_WEDA, function (_name, _oldValue, newValue) {
                traiterDemandeRetourAccueilOrigineWeda(newValue, 'GM_addValueChangeListener');
            });
        } catch (e) {}

        setInterval(function () {
            try {
                traiterDemandeRetourAccueilOrigineWeda(GM_getValue(CLE_RETOUR_ACCUEIL_ORIGINE_WEDA, null), 'GM_getValue');
            } catch (e) {}
        }, 1200);
    }

    function appelerPostBackWeda(eventTarget, eventArgument) {
        try {
            const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (typeof w.__doPostBack === 'function') {
                const eventTargetDecode = decoderChaineJavascriptAttributWeda(eventTarget);
                const eventArgumentDecode = decoderChaineJavascriptAttributWeda(eventArgument || '');
                w.__doPostBack(eventTargetDecode, eventArgumentDecode || '');
                return true;
            }
        } catch (e) {
            console.warn('[AUTO-HH] Échec appel __doPostBack WEDA :', { eventTarget, eventArgument, e });
        }
        return false;
    }

    function getPageRequestManagerWeda() {
        try {
            const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (w.Sys && w.Sys.WebForms && w.Sys.WebForms.PageRequestManager && typeof w.Sys.WebForms.PageRequestManager.getInstance === 'function') {
                return w.Sys.WebForms.PageRequestManager.getInstance();
            }
        } catch (e) {}
        return null;
    }

    function attendreFinAsyncPostBackWeda(timeoutMs = TIMEOUT_ATTENTE_FIN_POSTBACK_TAG_MS) {
        const prm = getPageRequestManagerWeda();
        if (!prm || typeof prm.get_isInAsyncPostBack !== 'function' || !prm.get_isInAsyncPostBack()) return Promise.resolve('aucun_postback');

        return new Promise(resolve => {
            let termine = false;
            let timer = null;

            function finir(raison) {
                if (termine) return;
                termine = true;
                try { if (typeof prm.remove_endRequest === 'function') prm.remove_endRequest(handlerEndRequest); } catch (e) {}
                if (timer) clearTimeout(timer);
                console.info('[AUTO-HH] Fin attente postback WEDA avant sauvegarde directe :', raison);
                resolve(raison);
            }

            function handlerEndRequest() { finir('endRequest'); }

            try {
                if (typeof prm.add_endRequest === 'function') prm.add_endRequest(handlerEndRequest);
            } catch (e) {
                finir('add_endRequest_impossible');
                return;
            }

            timer = setTimeout(() => finir('timeout_postback'), timeoutMs);
        });
    }

    function cliquerButtonAutoSaveWedaDirect() {
        const bouton = getElementDansDocumentsWeda(SELECTEUR_BOUTON_AUTOSAVE_WEDA) || document.getElementById('ButtonAutoSave');
        if (!bouton) {
            console.warn('[AUTO-HH] ButtonAutoSave introuvable pour sauvegarde directe.');
            return false;
        }

        try {
            console.info('[AUTO-HH] Clic direct ButtonAutoSave WEDA.', bouton);
            clickElement(bouton, 'ButtonAutoSave WEDA', { autoriserInvisible: true });
            return true;
        } catch (e) {
            console.warn('[AUTO-HH] Échec clic ButtonAutoSave direct :', e);
            return false;
        }
    }

    function retourAccueilDirectWeda(jobId) {
        try {
            const ok = appelerPostBackWeda(POSTBACK_MENU_EVENTTARGET_WEDA, POSTBACK_RETOUR_ACCUEIL_WEDA);
            if (ok) {
                console.info('[AUTO-HH] Retour accueil direct WEDA via __doPostBack(MenuNavigate, 0).');
                return true;
            }
        } catch (e) {
            console.warn('[AUTO-HH] Retour accueil direct WEDA impossible, fallback clic W.', e);
        }
        return ouvrirAccueilPatientWeda();
    }

    function getTexteRechercheElementWeda(element) {
        if (!element) return '';
        return normaliserTexte([
            element.innerText || '',
            element.textContent || '',
            element.value || '',
            element.getAttribute?.('title') || '',
            element.getAttribute?.('aria-label') || '',
            element.getAttribute?.('id') || '',
            element.getAttribute?.('href') || '',
            element.getAttribute?.('onclick') || ''
        ].join(' ')).replace(/[_:.-]+/g, ' ');
    }

    function collecterCandidatsOuvertureConsultationWeda() {
        const resultats = [];
        const vus = new Set();

        function ajouter(element, source, score) {
            if (!element || vus.has(element)) return;
            vus.add(element);
            resultats.push({
                element,
                source,
                score,
                description: decrireElementWeda(element),
                postBack: extrairePostBackWedaDepuisElement(element)
            });
        }

        const docs = collecterDocumentsAccessibles(document);
        docs.forEach(doc => {
            try {
                const boutonConnu = doc.querySelector(SELECTEUR_NOUVELLE_CONSULTATION_WEDA);
                if (boutonConnu) ajouter(boutonConnu, 'selecteur_nouvelle_consultation', 100);
            } catch (e) {}

            let elements = [];
            try {
                elements = Array.from(doc.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]'));
            } catch (e) {
                elements = [];
            }

            elements.forEach(element => {
                const texte = getTexteRechercheElementWeda(element);
                if (!texte) return;

                const estNouvelleConsultation =
                    texte.includes('nouvelle consultation') ||
                    texte.includes('nouveau consultation') ||
                    texte.includes('creer consultation') ||
                    texte.includes('creer une consultation') ||
                    texte.includes('nouvel evenement consultation') ||
                    texte.includes('menunavigate submenu 2');

                const estConsultationSimple =
                    texte === 'consultation' ||
                    /^consultation\s*\(\d+\)$/.test(texte) ||
                    (texte.includes('consultation') && texte.includes('menunavigate'));

                if (!estNouvelleConsultation && !estConsultationSimple) return;

                const exclu =
                    texte.includes('distinct') ||
                    texte.includes('historique') ||
                    texte.includes('compte rendu') ||
                    texte.includes('courrier') ||
                    texte.includes('hprim') ||
                    texte.includes('biologie') ||
                    texte.includes('ordonnance');

                if (exclu) return;

                ajouter(element, estNouvelleConsultation ? 'texte_nouvelle_consultation' : 'texte_consultation', estNouvelleConsultation ? 90 : 70);
            });
        });

        resultats.sort((a, b) => b.score - a.score);
        return resultats;
    }

    function ouvrirConsultationWedaExistante(options = {}) {
        const tentative = Number(options.tentative || 0);
        console.info('[AUTO-HH] Tentative ouverture consultation WEDA.', { tentative });

        const candidats = collecterCandidatsOuvertureConsultationWeda();
        ajouterLogAutoHH('weda-consultation-open-candidates', {
            tentative,
            count: candidats.length,
            candidats: candidats.slice(0, 8).map(candidat => ({
                source: candidat.source,
                score: candidat.score,
                element: candidat.description,
                postBack: candidat.postBack
            }))
        });

        for (const candidat of candidats) {
            const okClic = clickElement(candidat.element, 'Nouvelle consultation WEDA', {
                autoriserInvisible: true,
                clicUnique: true
            });
            ajouterLogAutoHH('weda-consultation-open-click-candidate', {
                tentative,
                okClic,
                source: candidat.source,
                element: candidat.description,
                postBack: candidat.postBack
            });
            if (okClic) return true;

            const postBack = candidat.postBack;
            if (postBack && postBack.eventTarget) {
                const okPostBack = appelerPostBackWeda(postBack.eventTarget, postBack.eventArgument || '');
                ajouterLogAutoHH('weda-consultation-open-postback-from-candidate', {
                    tentative,
                    okPostBack,
                    source: candidat.source,
                    element: candidat.description,
                    postBack
                });
                if (okPostBack) return true;
            }
        }

        const postbacksSecours = [
            { eventTarget: POSTBACK_MENU_GENERAL_EVENTTARGET_WEDA, eventArgument: '0\\1', source: 'menu_general_0_1' }
        ];

        for (const postback of postbacksSecours) {
            const ok = appelerPostBackWeda(postback.eventTarget, postback.eventArgument);
            ajouterLogAutoHH('weda-consultation-open-postback-fallback', {
                tentative,
                ok,
                postback
            });
            if (ok) return true;
        }

        console.warn('[AUTO-HH] Contrôle d’ouverture consultation WEDA introuvable.');
        return false;
    }

    function planifierVerificationOuvertureConsultationWeda(jobId, tentative) {
        setTimeout(() => {
            try {
                const job = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null);
                if (!job || ['saving', 'saved', 'saved_and_closed', 'error'].includes(String(job.status || ''))) return;

                if (estPageConsultationWeda()) {
                    ajouterLogAutoHH('weda-consultation-open-verified', {
                        jobId,
                        tentative,
                        href: getTopHref()
                    });
                    traiterWorkerWeda(jobId);
                    return;
                }

                if (!estPageAccueilPatientWeda()) {
                    ajouterLogAutoHH('weda-consultation-open-wait-navigation', {
                        jobId,
                        tentative,
                        href: getTopHref(),
                        status: job.status || null
                    });
                    traiterWorkerWeda(jobId);
                    return;
                }

                if (Number(job.openConsultAttempts || 0) < NOMBRE_MAX_TENTATIVES_OUVERTURE_CONSULTATION_WEDA) {
                    ajouterLogAutoHH('weda-consultation-open-retry', {
                        jobId,
                        tentative,
                        href: getTopHref(),
                        status: job.status || null
                    });
                    traiterWorkerWeda(jobId);
                    return;
                }

                mettreAJourJob(jobId, {
                    status: 'waiting_manual_consultation',
                    message: 'Ouverture automatique consultation WEDA impossible : attente ouverture manuelle',
                    waitingManualConsultationAt: Date.now()
                });
                ajouterLogAutoHH('weda-consultation-open-waiting-manual', {
                    jobId,
                    tentative,
                    href: getTopHref()
                });
                afficherBadge('AUTO-HH : ouvrez une nouvelle consultation WEDA, le collage suivra', 12000, { force: true });
            } catch (e) {
                ajouterLogAutoHH('weda-consultation-open-verification-error', {
                    jobId,
                    tentative,
                    erreur: String(e && e.message ? e.message : e)
                });
            }
        }, DELAI_VERIFICATION_OUVERTURE_CONSULTATION_WEDA_MS);
    }

    function trouverChampWedaEditable() {
        const docs = collecterDocumentsAccessibles(document);
        for (const doc of docs) {
            try {
                const body = doc.body;
                if (body && (body.getAttribute('contenteditable') === 'true' || body.isContentEditable)) return body;
                const editable = doc.querySelector('[contenteditable="true"]');
                if (editable) return editable;
            } catch (e) {}
        }
        return null;
    }

    async function waitForChampWedaEditable(timeoutMs = TIMEOUT_WEDA_CHAMP_MS) {
        return attendreParVerification(trouverChampWedaEditable, champ => !!champ, 'champ WEDA contenteditable', timeoutMs, 120);
    }

    function champWedaEstVide(champ) {
        const texte = nettoyerTexte(champ.innerText || champ.textContent || '');
        return texte.length === 0;
    }

    function nettoyerChampVideWeda(champ) {
        if (champWedaEstVide(champ)) champ.innerHTML = '';
    }

    function ajouterContenuDansChampWeda(champ, contenu) {
        const doc = champ.ownerDocument || document;
        const win = doc.defaultView || window;

        const texteNettoye = nettoyerTexte(contenu?.texte || '');
        const htmlNettoye = String(contenu?.html || '').trim();
        if (!texteNettoye && !htmlNettoye) return false;

        nettoyerChampVideWeda(champ);
        const dejaDuTexte = !champWedaEstVide(champ);
        if (dejaDuTexte) {
            champ.appendChild(doc.createElement('br'));
            champ.appendChild(doc.createElement('br'));
        }

        if (htmlNettoye) {
            const fragment = creerFragmentWedaDepuisHtml(doc, htmlNettoye);
            champ.appendChild(fragment);
            console.info('[AUTO-HH] HTML enrichi ajouté dans WEDA avec mise en page Heidi respectée.', { longueurHtml: htmlNettoye.length, longueurTexte: texteNettoye.length });
        } else {
            const lignes = texteNettoye.split('\n');
            lignes.forEach((ligne, index) => {
                champ.appendChild(doc.createTextNode(ligne));
                if (index < lignes.length - 1) champ.appendChild(doc.createElement('br'));
            });
            console.info('[AUTO-HH] Texte brut ajouté dans WEDA, longueur :', texteNettoye.length);
        }

        try { champ.focus(); } catch (e) {}
        ['input', 'change', 'keyup', 'blur'].forEach(type => {
            try { champ.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true })); } catch (e) {}
        });

        return true;
    }

    function trouverChampSecuriteMedicoLegaleWeda(champPrincipal) {
        const docs = collecterDocumentsAccessibles(document);
        const candidats = [];
        const dejaVus = new Set();

        function ajouterCandidat(element) {
            if (!element || dejaVus.has(element)) return;
            dejaVus.add(element);
            candidats.push(element);
        }

        for (const doc of docs) {
            try {
                const body = doc.body;
                if (body && (body.getAttribute('contenteditable') === 'true' || body.isContentEditable)) ajouterCandidat(body);
                [...doc.querySelectorAll('[contenteditable="true"]')].forEach(ajouterCandidat);
            } catch (e) {}
        }

        const candidatsSecondaires = candidats.filter(element => element !== champPrincipal);
        const candidatsVides = candidatsSecondaires.filter(element => champWedaEstVide(element));

        const candidatBodyVide = candidatsVides.find(element => {
            try { return String(element.tagName || '').toLowerCase() === 'body'; } catch (e) { return false; }
        });

        if (candidatBodyVide) return candidatBodyVide;
        if (candidatsVides.length > 0) return candidatsVides[0];

        console.warn('[AUTO-HH] Aucun champ dédié vide trouvé pour la phrase médico-légale. Phrase non ajoutée au champ principal pour éviter de polluer la consultation.');
        return null;
    }

    function ajouterPhraseSecuriteMedicoLegaleDansChampWeda(champPrincipal) {
        const champ = trouverChampSecuriteMedicoLegaleWeda(champPrincipal);
        if (!champ) {
            afficherBadge('AUTO-HH : champ phrase médico-légale introuvable', 5000);
            return false;
        }

        const doc = champ.ownerDocument || document;
        const win = doc.defaultView || window;
        const phrase = PHRASE_SECURITE_MEDICO_LEGALE;
        const texteActuel = String(champ.innerText || champ.textContent || '');

        if (normaliserTexte(texteActuel).includes(normaliserTexte(phrase))) {
            console.info('[AUTO-HH] Phrase médico-légale déjà présente dans le champ dédié, non dupliquée.');
            afficherBadge('AUTO-HH : phrase médico-légale déjà présente', 3000);
            return false;
        }

        nettoyerChampVideWeda(champ);
        const dejaDuTexte = !champWedaEstVide(champ);
        if (dejaDuTexte) {
            champ.appendChild(doc.createElement('br'));
            champ.appendChild(doc.createElement('br'));
        }

        champ.appendChild(doc.createTextNode(phrase));
        try { champ.focus(); } catch (e) {}
        ['input', 'change', 'keyup', 'blur'].forEach(type => {
            try { champ.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true })); } catch (e) {}
        });

        console.info('[AUTO-HH] Phrase médico-légale ajoutée dans le champ dédié vide.', champ);
        afficherBadge('AUTO-HH : phrase médico-légale ajoutée dans le champ dédié', 4000);
        return true;
    }

    function getBoutonSauvegardeWeda() {
        const boutonAutoSave = getElementDansDocumentsWeda(SELECTEUR_BOUTON_AUTOSAVE_WEDA) || document.getElementById('ButtonAutoSave');
        if (boutonAutoSave) return boutonAutoSave;

        const imgSelector = document.querySelector(SELECTEUR_IMAGE_SAUVEGARDE_WEDA);
        if (imgSelector) return imgSelector.closest('a') || imgSelector;

        const imgSave = [...document.querySelectorAll('img')].find(img => {
            const src = String(img.getAttribute('src') || img.src || '');
            return src.includes('W_BLEU.png') || src.includes('W_BLEU');
        });

        if (imgSave) return imgSave.closest('a') || imgSave;
        return null;
    }

    async function attendreRetourAccueilOuFinSauvegardeWeda(timeoutMs = DELAI_APRES_SAVE_AVANT_FERMETURE_MS) {
        const start = Date.now();

        return new Promise(resolve => {
            const verifier = () => {
                if (estPageAccueilPatientWeda()) {
                    console.info('[AUTO-HH] Retour accueil patient WEDA détecté après sauvegarde : fermeture accélérée.');
                    resolve('accueil_patient');
                    return;
                }

                const hrefLower = getHrefLower();
                if (EST_WEDA && !hrefLower.includes(PAGE_WEDA_CONSULTATION) && !hrefLower.includes(PAGE_WEDA_FSE)) {
                    console.info('[AUTO-HH] Sortie de la page consultation détectée après sauvegarde : fermeture accélérée.', hrefLower);
                    resolve('sortie_consultation');
                    return;
                }

                if (Date.now() - start > timeoutMs) {
                    console.info('[AUTO-HH] Délai sauvegarde atteint sans retour accueil explicite.');
                    resolve('timeout_prudent');
                    return;
                }

                setTimeout(verifier, 80);
            };
            verifier();
        });
    }

    async function sauvegarderConsultationWeda(jobId) {
        console.info('[AUTO-HH] Sauvegarde WEDA standard.');
        afficherBadge('AUTO-HH : sauvegarde WEDA', 2500);

        let okClick = cliquerButtonAutoSaveWedaDirect();

        if (!okClick) {
            const boutonSave = await waitForElement(getBoutonSauvegardeWeda, 'Sauvegarde WEDA', 8000);
            if (!boutonSave) {
                mettreAJourJob(jobId, { status: 'error', message: 'Bouton sauvegarde WEDA introuvable' }, true);
                afficherBadge('AUTO-HH : bouton sauvegarde introuvable', 8000);
                return false;
            }
            okClick = clickElement(boutonSave, 'Sauvegarde WEDA', { autoriserInvisible: true });
        }

        if (!okClick) {
            mettreAJourJob(jobId, { status: 'error', message: 'Clic sauvegarde WEDA impossible' }, true);
            afficherBadge('AUTO-HH : clic sauvegarde impossible', 8000);
            return false;
        }

        mettreAJourJob(jobId, { status: 'saving', message: 'Sauvegarde WEDA déclenchée' });
        const raisonSauvegarde = await attendreRetourAccueilOuFinSauvegardeWeda(DELAI_APRES_SAVE_AVANT_FERMETURE_MS);

        mettreAJourJob(jobId, {
            status: 'saved',
            message: 'Consultation WEDA sauvegardée',
            saveCloseReason: raisonSauvegarde
        }, true);

        afficherBadge('AUTO-HH : consultation sauvegardée', 3500);
        return true;
    }

    function fermerOngletWorkerWeda() {
        console.info('[AUTO-HH] Tentative fermeture onglet WEDA worker.');
        try { window.close(); } catch (e) { console.warn('[AUTO-HH] window.close() impossible :', e); }

        setTimeout(() => {
            try {
                if (!window.closed) afficherBadge('AUTO-HH : onglet à fermer manuellement si toujours ouvert', 10000);
            } catch (e) {}
        }, 900);
    }

    function finaliserEtFermerWorkerWeda(jobId, raison) {
        const key = CLE_TRANSFER_PREFIX + jobId;
        const job = GM_getValue(key, null) || { jobId };

        const jobFinal = {
            ...job,
            status: 'saved_and_closed',
            message: 'Toutes les tâches sont terminées, fermeture immédiate de l’onglet WEDA',
            closeReason: raison || 'fermeture_immediate',
            updatedAt: Date.now()
        };

        delete jobFinal.texte;
        delete jobFinal.html;

        try { GM_setValue(key, jobFinal); } catch (e) {}

        demanderRetourAccueilOrigineWeda(jobId, jobFinal, raison || 'fermeture_immediate');

        envoyerNotificationGlobale('done', 'Toutes les tâches sont terminées, fermeture de l’onglet WEDA', { jobId, raison: raison || 'fermeture_immediate', duree: 9000 });
        setTimeout(() => {
    try { GM_deleteValue(CLE_NOTIFICATION); } catch (e) {}
}, 12000);

        try { sessionStorage.removeItem(CLE_SESSION_JOB); } catch (e) {}

        setTimeout(() => {
            try { GM_deleteValue(key); } catch (e) {}
        }, 15000);

        fermerOngletWorkerWeda();
        return true;
    }

    async function sauvegarderEtRetourAccueilDirectWeda(jobId) {
        console.info('[AUTO-HH] Sauvegarde + retour accueil direct WEDA.');
        afficherBadge('AUTO-HH : sauvegarde WEDA', 4000);

        await attendreFinAsyncPostBackWeda(TIMEOUT_ATTENTE_FIN_POSTBACK_TAG_MS);

        const okRetourDirect = retourAccueilDirectWeda(jobId);
        if (!okRetourDirect) return sauvegarderConsultationWeda(jobId);

        mettreAJourJob(jobId, {
            status: 'saving',
            message: 'Sauvegarde WEDA déclenchée par retour accueil direct',
            directAccueilPostback: true
        });

        const raisonSauvegarde = await attendreRetourAccueilOuFinSauvegardeWeda(DELAI_APRES_SAVE_AVANT_FERMETURE_MS);

        mettreAJourJob(jobId, {
            status: 'saved',
            message: 'Consultation WEDA sauvegardée par retour accueil direct',
            saveCloseReason: raisonSauvegarde,
            directAccueilPostback: true
        }, true);

        afficherBadge('AUTO-HH : consultation sauvegardée', 5000);
        return true;
    }

    async function terminerTagsPuisSauvegarder(jobId) {
        let jobAvantTags = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null);
        if (!jobAvantTags) return;

        const etatAvantTags = getEtatEtiquettesJob(jobAvantTags);
        const tagsDejaTermines =
            jobAvantTags.status === 'tags_done' ||
            jobAvantTags.skipTagGridReopen === true ||
            (etatAvantTags.etiquettes.length > 0 && etatAvantTags.restantes.length === 0);

        if (tagsDejaTermines) {
            console.info('[AUTO-HH] Tags déjà terminés : aucune réouverture de grille, sauvegarde directe.', {
                jobId,
                status: jobAvantTags.status,
                skipTagGridReopen: jobAvantTags.skipTagGridReopen,
                etatAvantTags
            });

            mettreAJourJob(jobId, {
                status: 'tags_done',
                message: 'Tags déjà terminés, sauvegarde directe sans réouverture de grille',
                tagIndex: etatAvantTags.etiquettes.length,
                tagsToApply: etatAvantTags.etiquettes,
                tagsClicked: etatAvantTags.tagsClicked,
                tagsApplied: tableauUnique([...etatAvantTags.tagsApplied, ...etatAvantTags.tagsClicked]),
                tagsFailed: etatAvantTags.tagsFailed,
                skipTagGridReopen: true,
                directSaveAfterTags: true
            });
        } else {
            const okTags = await appliquerEtiquettesWedaDepuisJob(jobId);
            if (!okTags) return;
        }

        const jobApresTags = GM_getValue(CLE_TRANSFER_PREFIX + jobId, null);
        if (!jobApresTags || jobApresTags.status !== 'tags_done') return;

        let okSave = false;
        const ancienEtatBadgesPhaseCritique = badgesPhaseCritiqueSuspendus;
        badgesPhaseCritiqueSuspendus = true;

        try {
            if (jobApresTags.directSaveAfterTags === true || jobApresTags.skipTagGridReopen === true) okSave = await sauvegarderEtRetourAccueilDirectWeda(jobId);
            else okSave = await sauvegarderConsultationWeda(jobId);
        } finally {
            badgesPhaseCritiqueSuspendus = ancienEtatBadgesPhaseCritique;
        }

        if (!okSave) return;
        finaliserEtFermerWorkerWeda(jobId, 'worker_apres_sauvegarde_directe');
        console.info('[AUTO-HH] Étiquettes + sauvegarde + fermeture terminées pour job :', jobId);
    }

    async function traiterWorkerWeda(jobId) {
        if (!EST_WEDA || !isTopFrame()) return;

        const key = CLE_TRANSFER_PREFIX + jobId;
        const job = GM_getValue(key, null);
        if (!job) {
            console.warn('[AUTO-HH] Job WEDA introuvable :', jobId);
            ajouterLogAutoHH('weda-worker-job-missing', {
                jobId,
                key,
                href: getTopHref(),
                jobSession: (() => { try { return sessionStorage.getItem(CLE_SESSION_JOB); } catch (e) { return null; } })()
            });
            return;
        }

        console.info('[AUTO-HH] Worker WEDA actif pour job :', job);
        ajouterLogAutoHH('weda-worker-start', {
            jobId,
            status: job.status || null,
            href: getTopHref(),
            wedaUrl: job.wedaUrl || null,
            sourceWedaUrl: job.sourceWedaUrl || null,
            texteLength: String(job.texte || '').length,
            htmlLength: String(job.html || '').length
        });
        sessionStorage.setItem(CLE_SESSION_JOB, jobId);

        if (estPageErreurWeda()) {
            mettreAJourJob(jobId, {
                status: 'weda_error_page',
                message: 'Page erreur WEDA détectée avant ouverture de la consultation',
                wedaErrorUrl: getTopHref(),
                wedaErrorAt: Date.now()
            });
            ajouterLogAutoHH('weda-worker-error-page-detected', {
                jobId,
                href: getTopHref(),
                status: job.status || null,
                texteLength: String(job.texte || '').length,
                htmlLength: String(job.html || '').length
            });
            envoyerNotificationGlobale('error', 'AUTO-HH : WEDA a affiché une erreur pendant l’ouverture de consultation', {
                jobId,
                duree: 12000
            });
            afficherBadge('AUTO-HH : page erreur WEDA détectée, transfert arrêté', 12000, { force: true });
            try { sessionStorage.removeItem(CLE_SESSION_JOB); } catch (e) {}
            return;
        }

        if ((job.status === 'saving' || job.status === 'saved' || job.status === 'saved_and_closed') && estPageAccueilPatientWeda()) {
            console.info('[AUTO-HH] Retour accueil détecté avec job déjà sauvegardé/en sauvegarde : fermeture immédiate.', { jobId, status: job.status, href: getTopHref() });
            ajouterLogAutoHH('weda-worker-finalize-on-home', {
                jobId,
                status: job.status,
                href: getTopHref()
            });
            finaliserEtFermerWorkerWeda(jobId, 'retour_accueil_detecte_initialisation_worker');
            return;
        }

        if (job.status === 'saving' || job.status === 'saved' || job.status === 'saved_and_closed' || job.status === 'error') {
            ajouterLogAutoHH('weda-worker-skip-terminal-status', {
                jobId,
                status: job.status,
                href: getTopHref()
            });
            return;
        }

        if (!estPageConsultationWeda()) {
            if (!estPageAccueilPatientWeda()) {
                mettreAJourJob(jobId, { status: 'opening_patient_home', message: 'Retour accueil patient WEDA demandé' });
                const okAccueil = ouvrirAccueilPatientWeda();
                if (!okAccueil) {
                    mettreAJourJob(jobId, { status: 'error', message: 'Impossible de revenir à l’accueil patient WEDA' }, true);
                    afficherBadge('AUTO-HH : accueil patient WEDA introuvable', 8000);
                    return;
                }
                return;
            }

            if (job.status === 'waiting_manual_consultation') {
                ajouterLogAutoHH('weda-worker-waiting-manual-consultation', {
                    jobId,
                    href: getTopHref(),
                    openConsultAttempts: job.openConsultAttempts || 0
                });
                afficherBadge('AUTO-HH : ouvrez une nouvelle consultation WEDA, le collage suivra', 10000, { force: true });
                return;
            }

            const tentativeOuvertureConsultation = Number(job.openConsultAttempts || 0) + 1;
            if (tentativeOuvertureConsultation > NOMBRE_MAX_TENTATIVES_OUVERTURE_CONSULTATION_WEDA) {
                mettreAJourJob(jobId, {
                    status: 'waiting_manual_consultation',
                    message: 'Ouverture automatique consultation WEDA impossible : attente ouverture manuelle',
                    waitingManualConsultationAt: Date.now()
                });
                ajouterLogAutoHH('weda-worker-consultation-open-max-attempts', {
                    jobId,
                    href: getTopHref(),
                    openConsultAttempts: job.openConsultAttempts || 0
                });
                afficherBadge('AUTO-HH : ouvrez une nouvelle consultation WEDA, le collage suivra', 12000, { force: true });
                return;
            }

            mettreAJourJob(jobId, {
                status: 'opening_consultation',
                message: 'Ouverture consultation WEDA demandée',
                openConsultAttempts: tentativeOuvertureConsultation,
                openConsultRequestedAt: Date.now()
            });
            afficherBadge('AUTO-HH : ouverture consultation WEDA', 5000);
            const okConsultation = ouvrirConsultationWedaExistante({
                jobId,
                tentative: tentativeOuvertureConsultation
            });
            if (!okConsultation) {
                mettreAJourJob(jobId, {
                    status: 'waiting_manual_consultation',
                    message: 'Contrôle consultation WEDA introuvable : attente ouverture manuelle',
                    waitingManualConsultationAt: Date.now()
                });
                ajouterLogAutoHH('weda-worker-consultation-open-no-control', {
                    jobId,
                    href: getTopHref(),
                    openConsultAttempts: tentativeOuvertureConsultation
                });
                afficherBadge('AUTO-HH : ouvrez une nouvelle consultation WEDA, le collage suivra', 12000, { force: true });
                return;
            }
            planifierVerificationOuvertureConsultationWeda(jobId, tentativeOuvertureConsultation);
            return;
        }

        if (job.status === 'tagging' || job.status === 'tags_done') {
            await terminerTagsPuisSauvegarder(jobId);
            return;
        }

        mettreAJourJob(jobId, { status: 'waiting_field', message: 'Recherche du champ de consultation' });
        afficherBadge('AUTO-HH : recherche champ WEDA', 5000);

        const champ = await waitForChampWedaEditable();
        if (!champ) {
            mettreAJourJob(jobId, { status: 'error', message: 'Champ WEDA contenteditable introuvable' }, true);
            afficherBadge('AUTO-HH : champ WEDA introuvable', 8000);
            return;
        }

        const contenu = { texte: job.texte, html: job.html };
        if (contenuHeidiEstContexteWeda(contenu)) {
            mettreAJourJob(jobId, { status: 'error', message: 'Import WEDA annulé : contenu contexte détecté' }, true);
            afficherBadge('AUTO-HH : import annulé, contexte WEDA détecté', 8000);
            console.warn('[AUTO-HH] Import WEDA annulé : un contexte WEDA allait être inséré comme consultation.', {
                jobId,
                apercu: String(job.texte || '').slice(0, 300)
            });
            return;
        }

        const okInsertion = ajouterContenuDansChampWeda(champ, contenu);
        if (!okInsertion) {
            mettreAJourJob(jobId, { status: 'error', message: 'Insertion WEDA impossible' }, true);
            afficherBadge('AUTO-HH : insertion WEDA impossible', 8000);
            return;
        }

        ajouterPhraseSecuriteMedicoLegaleDansChampWeda(champ);

        const rapportExtraction = enregistrerRapportExtraction(creerRapportExtractionDepuisTexte(job.texte || '', { source: 'WEDA worker', jobId }));
        await remplirChampsStructuresDepuisTranscription(job.texte || '', rapportExtraction);

        const etiquettes = tableauUnique((rapportExtraction && rapportExtraction.tags) || extraireEtiquettesDepuisTexte(job.texte || ''));
        mettreAJourJob(jobId, {
            status: 'tagging',
            message: 'Contenu inséré, ajout des étiquettes WEDA',
            tagsToApply: etiquettes,
            tagIndex: 0,
            tagsApplied: [],
            tagsFailed: [],
            rapportExtraction
        });

        afficherBadge('AUTO-HH : contenu inséré dans WEDA', 4000);
        await terminerTagsPuisSauvegarder(jobId);
        console.info('[AUTO-HH] Insertion + champs + étiquettes + sauvegarde lancées pour job :', jobId);
    }

    function initialiserWorkerWedaSiBesoin() {
        if (!EST_WEDA || !isTopFrame()) return;

        const jobDepuisHash = getJobIdDepuisHash();
        if (jobDepuisHash && String(jobDepuisHash).startsWith('ctx_')) return;

        if (jobDepuisHash) {
            sessionStorage.setItem(CLE_SESSION_JOB, jobDepuisHash);
            try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) {}
            ajouterLogAutoHH('weda-worker-init-from-hash', {
                jobId: jobDepuisHash,
                href: getTopHref()
            });
        }

        let jobId = sessionStorage.getItem(CLE_SESSION_JOB);
        if (!jobId) {
            const jobDepuisDemande = getJobIdDepuisDemandeOuvertureWorkerWeda();
            if (jobDepuisDemande) {
                sessionStorage.setItem(CLE_SESSION_JOB, jobDepuisDemande);
                jobId = jobDepuisDemande;
                ajouterLogAutoHH('weda-worker-init-from-open-request', {
                    jobId,
                    href: getTopHref()
                });
            }
        }

        if (!jobId) return;
        if (String(jobId).startsWith('ctx_')) {
            try { sessionStorage.removeItem(CLE_SESSION_JOB); } catch (e) {}
            return;
        }

        ajouterLogAutoHH('weda-worker-init-scheduled', {
            jobId,
            href: getTopHref(),
            jobHash: jobDepuisHash || null
        });
        setTimeout(() => { traiterWorkerWeda(jobId); }, 300);
    }

    /************************************************************
     * SIGNAUX HEIDI ET RACCOURCIS
     ************************************************************/

    async function executerActionConnecteurAutoHH(actionSignal, triggerSignal, options = {}) {
        const maintenant = Number(options.maintenant || Date.now());
        const origine = options.origine || 'raccourci';

        if (!await verrouillerRaccourciGlobal(actionSignal, triggerSignal, maintenant)) {
            ajouterLogAutoHH('connector-action-ignored-global-lock', {
                actionSignal,
                triggerSignal,
                origine,
                maintenant
            });
            return null;
        }

        ajouterLogAutoHH('connector-action-lock-won', {
            actionSignal,
            triggerSignal,
            origine,
            maintenant,
            host: HOST,
            topFrame: isTopFrame()
        });

        const demandeLancement = actionSignal === 'start';
        const demandeStopTransfer = actionSignal === 'stop_transfer';

        if (EST_WEDA) memoriserDernierWedaActif(origine + '_avant_signal');

        let heidiWorkerPrepare = null;
        const extrasSignal = {};

        if (EST_WEDA && demandeLancement) {
            heidiWorkerPrepare = preparerHeidiWorkerDepuisWeda();
            if (heidiWorkerPrepare) extrasSignal.heidiWorkerId = heidiWorkerPrepare.workerId;
            ajouterLogAutoHH('weda-heidi-worker-prepared', {
                origine,
                heidiWorkerPrepare,
                extrasSignal
            });
        }

        if (EST_WEDA && demandeStopTransfer) {
            const workerIdWeda = getHeidiWorkerDedieWedaId(false);

            if (!workerIdWeda) {
                afficherBadge('AUTO-HH : aucun onglet Heidi dédié actif', 7000);
                console.warn('[AUTO-HH] Arrêt WEDA ignoré : aucun worker Heidi dédié à cet onglet WEDA.');
                ajouterLogAutoHH('weda-stop-ignored-no-heidi-worker', {
                    actionSignal,
                    triggerSignal,
                    origine
                });
                return null;
            }

            extrasSignal.heidiWorkerId = workerIdWeda;

            const workerActifStop = getHeidiWorkerActif();
            const presenceStop = getPresenceHeidiWorker(workerIdWeda);
            const workerVivantStop = presenceHeidiWorkerEstVivable(workerIdWeda, presenceStop);

            if (workerActifStop && workerActifStop.workerId === workerIdWeda && workerActifStop.heidiSessionId) {
                extrasSignal.heidiSessionId = workerActifStop.heidiSessionId;
                extrasSignal.heidiSessionUrl = workerActifStop.heidiSessionUrl || construireUrlSessionHeidi(workerActifStop.heidiSessionId);
                ajouterLogAutoHH('weda-stop-session-target-added', {
                    workerIdWeda,
                    heidiSessionId: extrasSignal.heidiSessionId,
                    heidiSessionUrl: extrasSignal.heidiSessionUrl
                });
            } else {
                ajouterLogAutoHH('weda-stop-session-target-missing', {
                    workerIdWeda,
                    workerActifStop
                });
            }

            const sessionUrlPourReveil = extrasSignal.heidiSessionUrl ||
                (extrasSignal.heidiSessionId ? construireUrlSessionHeidi(extrasSignal.heidiSessionId) : null);

            if (!workerVivantStop) {
                const workerPourReveil = {
                    ...(workerActifStop && workerActifStop.workerId === workerIdWeda ? workerActifStop : {}),
                    workerId: workerIdWeda,
                    heidiSessionId: extrasSignal.heidiSessionId || (workerActifStop && workerActifStop.heidiSessionId) || null,
                    heidiSessionUrl: sessionUrlPourReveil,
                    status: 'stop_reopen_requested'
                };

                const okReveilHeidi = sessionUrlPourReveil
                    ? ouvrirOngletHeidiDedie(workerPourReveil, {
                        sessionUrl: sessionUrlPourReveil,
                        raison: 'stop_transfer_worker_inactif'
                    })
                    : false;

                ajouterLogAutoHH('weda-heidi-worker-reopen-for-stop', {
                    workerIdWeda,
                    workerVivantStop,
                    presenceStop,
                    sessionUrlPourReveil,
                    okReveilHeidi
                });

                afficherBadge(
                    okReveilHeidi ? 'AUTO-HH : réveil onglet Heidi dédié' : 'AUTO-HH : onglet Heidi dédié inactif',
                    okReveilHeidi ? 5000 : 8000
                );
            }

            memoriserHeidiWorkerActif({
                ...(workerActifStop && workerActifStop.workerId === workerIdWeda ? workerActifStop : {}),
                workerId: workerIdWeda,
                status: 'stop_signal_prepare'
            });
        }

        if (EST_HEIDI && (demandeLancement || demandeStopTransfer)) {
            const sessionCouranteHeidi = demandeStopTransfer
                ? (getSessionHeidiVerrouilleeLocale() || getSessionHeidiCourante({ preferMenu: true, includeStorage: false }))
                : getSessionHeidiCourante({ preferMenu: true, includeStorage: false });
            const workerLocalHeidi = getHeidiWorkerIdLocal();
            if (workerLocalHeidi) extrasSignal.heidiWorkerId = workerLocalHeidi;
            if (sessionCouranteHeidi && sessionCouranteHeidi.id) {
                extrasSignal.heidiSessionId = sessionCouranteHeidi.id;
                extrasSignal.heidiSessionUrl = sessionCouranteHeidi.url || construireUrlSessionHeidi(sessionCouranteHeidi.id);
            }
            ajouterLogAutoHH('heidi-local-signal-target-added', {
                actionSignal,
                triggerSignal,
                workerLocalHeidi,
                sessionCouranteHeidi,
                extrasSignal
            });
        }

        const signal = envoyerSignal(actionSignal, triggerSignal, extrasSignal);
        if (!signal) {
            ajouterLogAutoHH('signal-null-after-action', {
                actionSignal,
                triggerSignal,
                origine,
                extrasSignal
            });
            return null;
        }

        if (EST_WEDA && demandeLancement && heidiWorkerPrepare && signal.heidiWorkerId === heidiWorkerPrepare.workerId) {
            const workerActif = memoriserHeidiWorkerActif({
                ...heidiWorkerPrepare,
                status: 'start_signal_sent',
                signalTimestamp: signal.timestamp,
                signalNonce: signal.nonce || null
            });

            const workerVivant = heidiWorkerDedieEstVivant(workerActif.workerId);
            const okOuvertureHeidi = workerVivant || ouvrirOngletHeidiDedie(workerActif);
            ajouterLogAutoHH('weda-heidi-worker-open-or-reuse', {
                origine,
                workerId: workerActif.workerId,
                workerVivant,
                okOuvertureHeidi,
                signal
            });
            afficherBadge(
                workerVivant ? 'AUTO-HH : onglet Heidi dédié réutilisé' : (okOuvertureHeidi ? 'AUTO-HH : onglet Heidi dédié ouvert' : 'AUTO-HH : ouverture onglet Heidi impossible'),
                okOuvertureHeidi ? 5000 : 8000
            );
        }

        if (EST_WEDA && demandeStopTransfer && signal.heidiWorkerId) {
            const workerAvantStopSignal = getHeidiWorkerActif();
            memoriserHeidiWorkerActif({
                ...(workerAvantStopSignal && workerAvantStopSignal.workerId === signal.heidiWorkerId ? workerAvantStopSignal : {}),
                workerId: signal.heidiWorkerId,
                heidiSessionId: signal.heidiSessionId || (workerAvantStopSignal && workerAvantStopSignal.heidiSessionId) || null,
                heidiSessionUrl: signal.heidiSessionUrl || (workerAvantStopSignal && workerAvantStopSignal.heidiSessionUrl) || null,
                status: 'stop_signal_sent',
                stopSignalTimestamp: signal.timestamp,
                stopSignalNonce: signal.nonce || null
            });
            ajouterLogAutoHH('weda-heidi-worker-stop-signal-sent', {
                origine,
                workerId: signal.heidiWorkerId,
                signal
            });
        }

        return signal;
    }

    function traiterSignalHeidi(signal, origine) {
    if (!EST_HEIDI) return;
    if (!signal || !signal.timestamp) return;
    if (!signalDestineAOngletHeidiCourant(signal)) return;

    const cleSignal = getCleTraitementSignalHeidi(signal);
    if (cleSignal && cleSignal === derniereCleSignalTraiteHeidi) {
        return;
    }

    if (!revendiquerSignalHeidi(signal, origine)) return;

    derniereCleSignalTraiteHeidi = cleSignal;
    dernierSignalTraiteHeidi = Number(signal.timestamp || Date.now());

    console.info('[AUTO-HH] Signal reçu dans Heidi via ' + origine + ' :', signal);
    ajouterLogAutoHH('heidi-signal-processing', {
        origine,
        signal,
        cleSignal,
        workerLocal: getHeidiWorkerIdLocal(),
        instance: instanceHeidiAutoHH
    });

    if (signal.action === 'start') {
        afficherBadge('AUTO-HH : signal lancement reçu', 4000);

        lancerNouvelleTranscription(signal).then(ok => {
            if (ok) {
                enregistrerAckHeidi(signal, 'start_done');
                ajouterLogAutoHH('heidi-start-ack-sent', { signal });
                afficherBadge('AUTO-HH : lancement Heidi confirmé', 2500);
                return;
            }

            supprimerAckHeidiSiSignal(signal);
            libererClaimSignalHeidi(signal);
            ajouterLogAutoHH('heidi-start-no-ack', { signal });
            console.warn('[AUTO-HH] Lancement Heidi non confirmé, ACK absent pour permettre une relance.');
        });

        return;
    }

    if (signal.action === 'stop_transfer') {
        annulerJobsContexteActifsAutoHH('Signal PageDown reçu dans Heidi');
        enregistrerAckHeidi(signal, 'stop_transfer_received');
        ajouterLogAutoHH('heidi-stop-transfer-ack-sent', { signal });
        afficherBadge('AUTO-HH : signal arrêt + transfert reçu', 4000);
        arreterTranscriptionEtTransferer(signal);
    }
}


    async function traiterRaccourciClavier(event) {
        const demandeLancement = touchePageUpDetectee(event);
        const demandeStopTransfer = touchePageDownDetectee(event);
        if (!demandeLancement && !demandeStopTransfer) return;
        if (event.__AUTO_HH_TRAITE) return;

        const elementActif = (() => {
            try {
                const element = document.activeElement;
                if (!element) return null;
                return {
                    tag: String(element.tagName || '').toLowerCase(),
                    id: element.id || null,
                    testId: element.getAttribute?.('data-testid') || null,
                    className: String(element.className || '').slice(0, 120)
                };
            } catch (e) {
                return null;
            }
        })();

        ajouterLogAutoHH('shortcut-detected', {
            eventType: event.type,
            key: event.key,
            code: event.code,
            keyCode: event.keyCode,
            which: event.which,
            demandeLancement,
            demandeStopTransfer,
            host: HOST,
            topFrame: isTopFrame(),
            connecteurWedaActif: connecteurWedaActif(),
            activeElement: elementActif
        });

        try { event.__AUTO_HH_TRAITE = true; } catch (e) {}

        if (event.type && event.type !== 'keydown') {
            ajouterLogAutoHH('shortcut-ignored-non-keydown', {
                eventType: event.type,
                key: event.key,
                code: event.code,
                demandeLancement,
                demandeStopTransfer
            });
            return;
        }

        const maintenant = Date.now();
        if (maintenant - dernierEvenementClavierTraite < 250) {
            ajouterLogAutoHH('shortcut-ignored-fast-key-event', {
                eventType: event.type,
                key: event.key,
                code: event.code,
                ageMs: maintenant - dernierEvenementClavierTraite
            });
            return;
        }
        dernierEvenementClavierTraite = maintenant;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (maintenant - dernierDeclenchement < DELAI_ANTI_DOUBLE_DECLENCHEMENT_MS) {
            console.info('[AUTO-HH] Déclenchement trop rapproché, ignoré.');
            ajouterLogAutoHH('shortcut-ignored-local-antidouble', {
                eventType: event.type,
                key: event.key,
                code: event.code,
                ageMs: maintenant - dernierDeclenchement
            });
            return;
        }

       dernierDeclenchement = maintenant;

const actionSignal = demandeLancement ? 'start' : 'stop_transfer';
const triggerSignal = demandeLancement ? 'page_up' : 'page_down';

const signal = await executerActionConnecteurAutoHH(actionSignal, triggerSignal, {
    origine: 'raccourci_clavier',
    maintenant
});

if (!signal) return;


        if (demandeLancement) {
            if (EST_WEDA) {
                afficherBadge('AUTO-HH : PageUp WEDA → lancement Heidi', 4000);
                console.info('[AUTO-HH] PageUp WEDA : signal lancement envoyé.', signal);
            }
            if (EST_HEIDI) {
                afficherBadge('AUTO-HH : lancement depuis Heidi', 4000);
                console.info('[AUTO-HH] PageUp Heidi : lancement local.', signal);
                traiterSignalHeidi(signal, 'raccourci local Heidi');
            }
        }

        if (demandeStopTransfer) {
            if (EST_WEDA) {
                afficherBadge('AUTO-HH : PageDown WEDA → arrêt + transfert Heidi', 5000);
                console.info('[AUTO-HH] PageDown WEDA : signal arrêt + transfert envoyé.', signal);
            }
            if (EST_HEIDI) {
                afficherBadge('AUTO-HH : arrêt + transfert depuis Heidi', 5000);
                console.info('[AUTO-HH] PageDown Heidi : arrêt + transfert local.', signal);
                traiterSignalHeidi(signal, 'raccourci local Heidi');
            }
        }
    }

    function ajouterEcouteursRaccourcisAutoHH(cible) {
        if (!cible || typeof cible.addEventListener !== 'function') return;
        cible.addEventListener('keydown', traiterRaccourciClavier, true);
    }

    if (EST_WEDA || EST_HEIDI) {
        ajouterEcouteursRaccourcisAutoHH(window);
        ajouterEcouteursRaccourcisAutoHH(document);
        setTimeout(() => {
            try {
                ajouterEcouteursRaccourcisAutoHH(document.body);
            } catch (e) {}
        }, 1000);
    }

    function corrigerStatutInterfaceDepuisEtatHeidi() {
        if (!EST_HEIDI || !isTopFrame()) return;

        let statutRecord = null;
        try { statutRecord = GM_getValue(CLE_STATUT_INTERFACE, null); } catch (e) { statutRecord = null; }
        if (!statutRecord || !statutRecord.statut) return;

        const statut = normaliserStatutInterfaceAutoHH(statutRecord.statut);
        const ageMs = Date.now() - Number(statutRecord.timestamp || 0);
        const doitVerifierRec = statut === 'recording' && ageMs > DELAI_CORRECTION_STATUT_REC_HEIDI_MS;
        const doitVerifierDemarrage = statut === 'starting' && ageMs > DELAI_MAX_STATUT_DEMARRAGE_HEIDI_MS;

        if (!doitVerifierRec && !doitVerifierDemarrage) return;

        const diagnostic = transcriptionHeidiSembleActive();
        if (diagnostic && diagnostic.ok) {
            if (statut === 'starting') {
                definirFaviconHeidiStatut('recording', {
                    message: 'Transcription confirmée par surveillance',
                    details: diagnostic
                });
            }
            return;
        }

        if (statut === 'recording') {
            /*
             * Sécurité v7.75 : ne jamais rétrograder automatiquement REC en ERREUR
             * pendant une transcription déjà confirmée.
             * Heidi peut conserver un bouton libellé « Transcription » visible même
             * lorsque l’enregistrement est réellement en cours, ce qui rend la
             * vérification DOM trop ambiguë après coup.
             * L’erreur reste possible au démarrage initial si PageUp ne confirme
             * jamais le lancement, mais une fois REC validé on le conserve jusqu’à
             * PageDown / transfert / erreur explicite de workflow.
             */
            ajouterLogAutoHH('heidi-status-recording-preserved-ambiguous-dom', {
                statutRecord,
                ageMs,
                diagnostic,
                raison: 'REC conservé malgré diagnostic DOM ambigu pour éviter ERREUR sur transcription active'
            });
            return;
        }

        if (Date.now() - derniereCorrectionStatutHeidi < 5000) return;
        derniereCorrectionStatutHeidi = Date.now();

        definirFaviconHeidiStatut('error', {
            duree: 12000,
            message: 'Démarrage non confirmé',
            details: { statutRecord, ageMs, diagnostic }
        });

        ajouterLogAutoHH('heidi-status-corrected-not-recording', {
            statutRecord,
            ageMs,
            diagnostic
        });
    }

    function initialiserSurveillanceStatutHeidiAutoHH() {
        if (!EST_HEIDI || !isTopFrame()) return;

        setTimeout(corrigerStatutInterfaceDepuisEtatHeidi, 2500);
        setInterval(corrigerStatutInterfaceDepuisEtatHeidi, INTERVALLE_SURVEILLANCE_STATUT_HEIDI_MS);
    }

    /************************************************************
     * TESTS CONSOLE
     ************************************************************/

    try {
        window.AUTO_HH_LAST_REPORT = afficherDernierRapportExtraction;
        window.AUTO_HH_TEST_EXTRACTION = function (texte) {
            const rapport = enregistrerRapportExtraction(creerRapportExtractionDepuisTexte(String(texte || ''), { source: 'AUTO_HH_TEST_EXTRACTION' }));
            afficherDernierRapportExtraction();
            return rapport;
        };
        window.AUTO_HH_TEST_TAGS = function (texte) {
            const tags = extraireEtiquettesDepuisTexte(String(texte || ''));
            console.info('[AUTO-HH] Tags testés :', tags);
            return tags;
        };
        window.AUTO_HH_TEST_FAVICON = function (statut, duree) {
            definirFaviconHeidiStatut(statut || 'starting', { duree: Number(duree || 5000) });
            return statut || 'starting';
        };
        window.AUTO_HH_LISTE_BOUTONS_HEIDI = listerBoutonsHeidiPourDiagnostic;
        window.AUTO_HH_TEST_ARRET_HEIDI = async function () {
            const bouton = getBoutonArretTranscription();
            console.info('[AUTO-HH] Bouton arrêt trouvé pour test :', decrireBoutonHeidi(bouton));
            return cliquerBoutonArretTranscriptionHeidi(bouton);
        };
        window.AUTO_HH_TEST_ETAT_TRANSCRIPTION = function () {
            const diagnostic = transcriptionHeidiSembleActive();
            console.info('[AUTO-HH] Diagnostic état transcription :', diagnostic);
            return diagnostic;
        };

    } catch (e) {}

    /************************************************************
     * INITIALISATION HEIDI
     ************************************************************/

    if (EST_HEIDI) {
        initialiserOngletHeidiDedie();
        initialiserSurveillanceStatutHeidiAutoHH();

        try {
    const signalInitial = GM_getValue(CLE_SIGNAL, null);

    if (signalInitial && signalInitial.timestamp) {
        const ack = GM_getValue(CLE_ACK_HEIDI, null);
        const dejaRecu = ackHeidiCorrespondAuSignal(ack, signalInitial);
        const ageSignal = Date.now() - Number(signalInitial.timestamp || 0);

        if (dejaRecu || ageSignal > DELAI_SIGNAL_INITIAL_RECENT_HEIDI_MS) {
            dernierSignalTraiteHeidi = signalInitial.timestamp;
            derniereCleSignalTraiteHeidi = getCleTraitementSignalHeidi(signalInitial);
        } else {
            setTimeout(() => {
                traiterSignalHeidi(signalInitial, 'signal initial récent Heidi');
            }, DELAI_TRAITEMENT_SIGNAL_INITIAL_HEIDI_MS);
        }
    }
} catch (e) {}


        GM_addValueChangeListener(CLE_SIGNAL, function (_name, _oldValue, newValue) {
            traiterSignalHeidi(newValue, 'GM_addValueChangeListener');
        });

        setInterval(function () {
            const signal = GM_getValue(CLE_SIGNAL, null);
            traiterSignalHeidi(signal, 'GM_getValue');
        }, INTERVALLE_POLL_SIGNAL_HEIDI_MS);

        window.AUTO_HH_TEST_START = function () {
            console.info('[AUTO-HH] Test manuel lancement depuis Heidi.');
            afficherBadge('AUTO-HH : test manuel lancement', 3000);
            lancerNouvelleTranscription();
        };

        window.AUTO_HH_TEST_STOP_TRANSFER = function () {
            console.info('[AUTO-HH] Test manuel arrêt + transfert depuis Heidi.');
            afficherBadge('AUTO-HH : test manuel arrêt + transfert', 3000);
            arreterTranscriptionEtTransferer({ timestamp: Date.now(), wedaUrl: GM_getValue(CLE_LAST_WEDA_URL, null) });
        };
    }

    /************************************************************
     * INITIALISATION WEDA
     ************************************************************/

    initialiserNotificationsGlobales();
    initialiserEcouteStatutInterfaceAutoHH();

   if (EST_WEDA) {
    memoriserDernierWedaActif();
    initialiserWorkerWedaSiBesoin();
    initialiserEcouteRetourAccueilOrigineWeda();
    initialiserPanneauDebugWedaAutoHH();
    initialiserCompatibiliteDragInfoFlottanteWedaAutoHH();

    setInterval(memoriserDernierWedaActif, 1000);

    window.addEventListener('focus', memoriserDernierWedaActif, true);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) memoriserDernierWedaActif();
    });
}

    console.info('[AUTO-HH] Script chargé :', {
        version: VERSION_AUTO_HH,
        host: HOST,
        href: location.href,
        topHref: getTopHref(),
        weda: EST_WEDA,
        heidi: EST_HEIDI,
        topFrame: isTopFrame(),
        estFse: EST_WEDA ? estPageFseWedaAvecPatient() : false
    });

    if (EST_WEDA) afficherBadge('AUTO-HH actif sur WEDA');
    if (EST_HEIDI) afficherBadge('AUTO-HH actif sur Heidi');

})();

/************************************************************
 * MODULE CONTEXTE WEDA -> HEIDI
 ************************************************************/

(function () {
    'use strict';

    const CLE_SIGNAL_CONTEXTE = 'auto_hh_signal_stable_v768';
    const CLE_LAST_WEDA_URL_CONTEXTE = 'auto_hh_last_weda_url_stable';
    const CLE_CONTEXT_PREFIX = 'auto_hh_context_job_stable_';
    const CLE_SESSION_JOB_PRINCIPAL = 'auto_hh_weda_worker_job_stable';
    const CLE_SESSION_JOB_CONTEXTE = 'auto_hh_weda_context_worker_job_stable';
    const CLE_SESSION_HEIDI_WORKER_CONTEXTE = 'auto_hh_heidi_worker_id_stable';
    const CLE_SESSION_HEIDI_ID_CONTEXTE = 'auto_hh_heidi_session_id_stable';
    const CLE_SESSION_HEIDI_URL_CONTEXTE = 'auto_hh_heidi_session_url_stable';
    const CLE_HEIDI_WORKER_ACTIF_CONTEXTE = 'auto_hh_heidi_worker_actif_stable';
    const CLE_HEIDI_BIO_TAB_ROLE_CONTEXTE = 'wedaBioHeidiContext.heidiTabRole';
    const PARAM_WORKER_CONTEXTE = 'AUTO_HH_WEDA_CONTEXT_WORKER';
    const PARAM_WORKER_HEIDI_CONTEXTE = 'AUTO_HH_HEIDI_WORKER';
    const PARAM_HEIDI_BIO_JOB_CONTEXTE = 'wedaBioJob';
    const CLE_OUVERTURE_CONTEXTE_LOCK = 'auto_hh_context_open_lock_stable';

    const PAGE_WEDA_PATIENT_CONTEXTE = '/foldermedical/patientviewform.aspx';
    const PAGE_WEDA_HPRIM_CONTEXTE = '/foldermedical/hprimform.aspx';
    const SELECTEUR_BOUTON_SUITE_WEDA_CONTEXTE = '#ContentPlaceHolder1_HistoriqueUCForm1_ButtonSuiteWeda';

    const SELECTEUR_ONGLET_CONTEXTE_HEIDI = 'button[data-testid="session-tab-context"]';
    const SELECTEUR_CHAMP_CONTEXTE_HEIDI = 'div[data-testid="context-tab-block-editor"] [contenteditable="true"]';

    const ENTETE_CONTEXTE_WEDA = 'Contexte WEDA patient';

    const DELAI_APRES_SIGNAL_START_CONTEXTE_MS = 60000;
    const DELAI_SIGNAL_INITIAL_RECENT_CONTEXTE_MS = 90000;
    const DELAI_APRES_CLIC_SUITE_CONTEXTE_MS = 1800;
    const TIMEOUT_CONTEXTE_HEIDI_MS = 30000;
    const TIMEOUT_JOB_CONTEXTE_MS = 120000;
    const NOMBRE_MAX_CLICS_SUITE_CONTEXTE = 25;
    const DELAI_VERROU_OUVERTURE_CONTEXTE_MS = 180000;

    const HOST_CONTEXTE = location.hostname;
    const EST_WEDA_CONTEXTE = HOST_CONTEXTE === 'secure.weda.fr' || HOST_CONTEXTE.endsWith('.weda.fr');
    const EST_HEIDI_CONTEXTE = HOST_CONTEXTE === 'scribe.heidihealth.com';

    const CLE_WEDA_ACTIVE_SNAPSHOT_CONTEXTE = 'auto_hh_weda_active_snapshot_stable';

    if (!EST_WEDA_CONTEXTE && !EST_HEIDI_CONTEXTE) return;

    if (EST_WEDA_CONTEXTE && getHrefLowerContexte().includes(PAGE_WEDA_HPRIM_CONTEXTE)) {
        try { console.info('[AUTO-HH CONTEXTE] Module contexte désactivé sur HprimForm.aspx.'); } catch (e) {}
        return;
    }

    if (EST_HEIDI_CONTEXTE && estOngletHeidiAnalyseBiologieContexte()) {
        try { console.info('[AUTO-HH CONTEXTE] Onglet Heidi réservé au script Analyse Biologies : module contexte désactivé sur cet onglet.'); } catch (e) {}
        return;
    }

    function estOngletHeidiAnalyseBiologieContexte() {
        if (!EST_HEIDI_CONTEXTE) return false;
        try {
            const params = new URLSearchParams(location.search || '');
            if (params.has(PARAM_HEIDI_BIO_JOB_CONTEXTE)) return true;
        } catch (e) {}
        try {
            if (sessionStorage.getItem(CLE_HEIDI_BIO_TAB_ROLE_CONTEXTE) === 'biology') return true;
        } catch (e) {}
        return false;
    }

    let dernierSignalStartContexteTraite = 0;
    let derniereCleSignalContexteIgnore = '';
    let timerBadgeContexte = null;
    const ongletsContexteWeda = {};

    function sleepContexte(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function isTopFrameContexte() {
        try { return window.top === window.self; } catch (e) { return false; }
    }

    function getTopHrefContexte() {
        try { return window.top.location.href; } catch (e) { return location.href; }
    }

    function getHrefLowerContexte() {
        return String(getTopHrefContexte() || '').toLowerCase();
    }

    function normaliserTexteContexte(texte) {
        return String(texte || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/œ/g, 'oe')
            .replace(/Œ/g, 'oe')
            .toLowerCase()
            .replace(/[’']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function nettoyerTexteContexte(texte) {
        return String(texte || '')
            .replace(/\r\n/g, '\n')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .split('\n')
            .map(ligne => ligne.trim())
            .filter(ligne => ligne && !ligne.includes('AUTO-HH'))
            .join('\n')
            .replace(/\n{4,}/g, '\n\n\n')
            .trim();
    }

    function normaliserVerificationContexte(texte) {
        return nettoyerTexteContexte(texte).replace(/\s+/g, ' ').trim();
    }

    function afficherBadgeContexte(message, duree) {
        try {
            if (!isTopFrameContexte() || !document.body) return;

            let badge = document.getElementById('auto-hh-contexte-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'auto-hh-contexte-badge';
                badge.style.position = 'fixed';
                badge.style.left = '24px';
                badge.style.bottom = '96px';
                badge.style.zIndex = '999999';
                badge.style.background = '#4a1434';
                badge.style.color = '#ffffff';
                badge.style.padding = '14px 20px';
                badge.style.borderRadius = '14px';
                badge.style.fontSize = '17px';
                badge.style.fontWeight = '700';
                badge.style.lineHeight = '1.35';
                badge.style.fontFamily = 'Arial, sans-serif';
                badge.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
                badge.style.border = '1px solid rgba(255,255,255,0.22)';
                badge.style.maxWidth = '560px';
                badge.style.minWidth = '300px';
                badge.style.pointerEvents = 'none';
                document.body.appendChild(badge);
            }

            badge.textContent = String(message || '');
            badge.style.display = 'block';

            if (timerBadgeContexte) clearTimeout(timerBadgeContexte);
            timerBadgeContexte = setTimeout(() => {
                try { badge.remove(); } catch (e) {}
                timerBadgeContexte = null;
            }, duree || 4000);
        } catch (e) {}
    }

    function isVisibleContexte(element) {
        if (!element) return false;
        try {
            const win = element.ownerDocument.defaultView || window;
            const style = win.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                !element.disabled &&
                element.getAttribute('aria-disabled') !== 'true'
            );
        } catch (e) {
            return false;
        }
    }

    function clickElementContexte(element, nom, options) {
        if (!element) return false;

        const autoriserInvisible = !!(options && options.autoriserInvisible);
        if (!autoriserInvisible && !isVisibleContexte(element)) return false;

        try { element.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
        try { element.focus(); } catch (e) {}

        const doc = element.ownerDocument || document;
        const win = doc.defaultView || window;
        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);

        function dispatchMouse(type, buttonsValue) {
            try {
                element.dispatchEvent(new win.MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    screenX: x,
                    screenY: y,
                    button: 0,
                    buttons: buttonsValue
                }));
            } catch (e) {}
        }

        function dispatchPointer(type, buttonsValue) {
            try {
                if (typeof win.PointerEvent === 'function') {
                    element.dispatchEvent(new win.PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        clientX: x,
                        clientY: y,
                        screenX: x,
                        screenY: y,
                        button: 0,
                        buttons: buttonsValue,
                        pointerId: 1,
                        pointerType: 'mouse',
                        isPrimary: true
                    }));
                }
            } catch (e) {}
        }

        dispatchPointer('pointerover', 0);
        dispatchMouse('mouseover', 0);
        dispatchPointer('pointerdown', 1);
        dispatchMouse('mousedown', 1);
        dispatchPointer('pointerup', 0);
        dispatchMouse('mouseup', 0);
        dispatchMouse('click', 0);

        try { element.click(); } catch (e) {}

        console.info('[AUTO-HH CONTEXTE] Clic :', nom, element);
        return true;
    }

    function attendreParVerificationContexte(getterFunction, conditionFunction, nom, timeoutMs, intervalMs) {
        const start = Date.now();
        const intervalle = intervalMs || 100;

        return new Promise(resolve => {
            const verifier = () => {
                let element = null;
                try { element = getterFunction(); } catch (e) { element = null; }

                if (conditionFunction(element)) {
                    resolve(element);
                    return;
                }

                if (Date.now() - start > timeoutMs) {
                    console.warn('[AUTO-HH CONTEXTE] Élément introuvable après délai :', nom);
                    resolve(null);
                    return;
                }

                setTimeout(verifier, intervalle);
            };

            verifier();
        });
    }

    function getParamPatDkDepuisUrlContexte(urlBrute) {
        try {
            const url = new URL(urlBrute);
            for (const [key, value] of url.searchParams.entries()) {
                if (String(key).toLowerCase() === 'patdk' && value) return value;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function construireUrlPatientDepuisUrlContexte(urlBrute) {
        try {
            const url = new URL(urlBrute);
            const patDk = getParamPatDkDepuisUrlContexte(urlBrute);
            if (!patDk) return null;
            return url.origin + '/FolderMedical/PatientViewForm.aspx?PatDk=' + encodeURIComponent(patDk);
        } catch (e) {
            return null;
        }
    }

    function estPageAccueilPatientWedaContexte() {
        return EST_WEDA_CONTEXTE && getHrefLowerContexte().includes(PAGE_WEDA_PATIENT_CONTEXTE);
    }

    function nettoyerUrlPourOngletContexte(url) {
        return String(url || '').split('#')[0];
    }

    function getJobIdDepuisHashPrincipalContexte() {
        try {
            const hash = String(location.hash || '').replace(/^#/, '');
            const params = new URLSearchParams(hash);
            return params.get(PARAM_WORKER_CONTEXTE) || params.get('AUTO_HH_WEDA_WORKER');
        } catch (e) {
            return null;
        }
    }

    function signalContexteCorrespondAuSignal(signalCourant, signalReference) {
        if (!signalCourant || !signalReference) return false;
        if (signalCourant.timestamp !== signalReference.timestamp) return false;
        if (signalCourant.action !== signalReference.action) return false;
        if (signalReference.nonce && signalCourant.nonce !== signalReference.nonce) return false;
        if (signalReference.heidiWorkerId && signalCourant.heidiWorkerId !== signalReference.heidiWorkerId) return false;
        return true;
    }

    function getHeidiWorkerIdDepuisHashContexte() {
        try {
            const hash = String(location.hash || '').replace(/^#/, '');
            const params = new URLSearchParams(hash);
            return params.get(PARAM_WORKER_HEIDI_CONTEXTE);
        } catch (e) {
            return null;
        }
    }

    function getHeidiWorkerIdLocalContexte() {
        try {
            return sessionStorage.getItem(CLE_SESSION_HEIDI_WORKER_CONTEXTE) || getHeidiWorkerIdDepuisHashContexte();
        } catch (e) {
            return getHeidiWorkerIdDepuisHashContexte();
        }
    }

    function getHeidiSessionIdDepuisUrlContexte(urlBrute) {
        try {
            const url = new URL(urlBrute || location.href, location.origin);
            const match = String(url.pathname || '').match(/\/scribe\/session\/([^\/?#]+)/i);
            return match && match[1] ? decodeURIComponent(match[1]) : null;
        } catch (e) {
            const match = String(urlBrute || location.href || '').match(/\/scribe\/session\/([^\/?#]+)/i);
            return match && match[1] ? decodeURIComponent(match[1]) : null;
        }
    }

    function construireUrlSessionHeidiContexte(sessionId) {
        if (!sessionId) return null;
        let locale = 'fr-FR';
        try {
            const matchLocale = String(location.pathname || '').match(/^\/([a-z]{2}-[A-Z]{2})\/scribe\//);
            if (matchLocale && matchLocale[1]) locale = matchLocale[1];
        } catch (e) {}
        const origineHeidi = EST_HEIDI_CONTEXTE ? location.origin : 'https://scribe.heidihealth.com';
        return origineHeidi + '/' + locale + '/scribe/session/' + encodeURIComponent(sessionId);
    }

    function getSessionHeidiCouranteContexte() {
        const liens = Array.from(document.querySelectorAll('[data-testid="session-list-session-item"] a[href*="/scribe/session/"], a[href*="/scribe/session/"]'));
        for (const lien of liens) {
            const actif = lien.querySelector('[data-active="true"]') || lien.closest?.('[data-active="true"]');
            if (!actif) continue;
            const id = getHeidiSessionIdDepuisUrlContexte(lien.getAttribute('href') || lien.href || '');
            if (id) return { id, url: construireUrlSessionHeidiContexte(id), source: 'menu_actif' };
        }

        const idUrl = getHeidiSessionIdDepuisUrlContexte(location.href);
        if (idUrl) return { id: idUrl, url: construireUrlSessionHeidiContexte(idUrl), source: 'url' };

        try {
            const sessionId = sessionStorage.getItem(CLE_SESSION_HEIDI_ID_CONTEXTE);
            const sessionUrl = sessionStorage.getItem(CLE_SESSION_HEIDI_URL_CONTEXTE);
            if (sessionId) return { id: sessionId, url: sessionUrl || construireUrlSessionHeidiContexte(sessionId), source: 'session_storage' };
        } catch (e) {}

        return null;
    }

    function trouverLienSessionHeidiContexte(sessionId) {
        if (!sessionId) return null;
        const liens = Array.from(document.querySelectorAll('a[href*="/scribe/session/"]'));
        return liens.find(lien => getHeidiSessionIdDepuisUrlContexte(lien.getAttribute('href') || lien.href || '') === sessionId) || null;
    }

    async function attendreSessionHeidiContexte(sessionId, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const session = getSessionHeidiCouranteContexte();
            if (session && session.id === sessionId) return true;
            await sleepContexte(180);
        }
        return false;
    }

    async function restaurerSessionHeidiContextePourJob(job) {
        if (!EST_HEIDI_CONTEXTE || !job) return true;
        if (jobContexteEstAnnule(job.jobId)) {
            console.info('[AUTO-HH CONTEXTE] Restauration session ignorée : job contexte annulé.', job);
            return false;
        }

        let sessionId = job.heidiSessionId || (job.sourceSignal && job.sourceSignal.heidiSessionId) || null;
        let sessionUrl = job.heidiSessionUrl || (job.sourceSignal && job.sourceSignal.heidiSessionUrl) || null;

        if (!sessionId) {
            try {
                const workerActif = GM_getValue(CLE_HEIDI_WORKER_ACTIF_CONTEXTE, null);
                const workerJob = job.sourceSignal && job.sourceSignal.heidiWorkerId;
                if (workerActif && workerActif.heidiSessionId && (!workerJob || workerActif.workerId === workerJob)) {
                    sessionId = workerActif.heidiSessionId;
                    sessionUrl = workerActif.heidiSessionUrl || construireUrlSessionHeidiContexte(sessionId);
                }
            } catch (e) {}
        }

        if (!sessionId) return true;

        const courante = getSessionHeidiCouranteContexte();
        if (courante && courante.id === sessionId) return true;

        if (jobContexteEstAnnule(job.jobId)) {
            console.info('[AUTO-HH CONTEXTE] Restauration session annulée juste avant clic : job contexte annulé.', job);
            return false;
        }

        afficherBadgeContexte('AUTO-HH contexte : retour bonne session Heidi', 4000);
        console.info('[AUTO-HH CONTEXTE] Restauration session Heidi avant collage contexte :', { job, sessionId, sessionUrl, courante });

        const lien = trouverLienSessionHeidiContexte(sessionId);
        if (lien) {
            clickElementContexte(lien, 'Session Heidi contexte cible', { autoriserInvisible: true });
            await sleepContexte(900);
        }

        let ok = await attendreSessionHeidiContexte(sessionId, 8000);
        if (!ok) {
            const url = sessionUrl || construireUrlSessionHeidiContexte(sessionId);
            try { window.location.assign(url); } catch (e) { try { location.href = url; } catch (e2) {} }
            await sleepContexte(2500);
            ok = await attendreSessionHeidiContexte(sessionId, 9000);
        }

        console.info('[AUTO-HH CONTEXTE] Restauration session Heidi contexte :', { ok, sessionId, apres: getSessionHeidiCouranteContexte() });
        return ok;
    }

    function signalDestineAHeidiContexteCourant(signal) {
        const workerCible = signal && signal.heidiWorkerId ? String(signal.heidiWorkerId) : '';
        if (!workerCible) return true;

        const workerLocal = getHeidiWorkerIdLocalContexte();
        const ok = workerLocal === workerCible;

        const cleIgnore = [signal.timestamp, signal.nonce || '', signal.action || '', workerCible].join('|');
        if (!ok && cleIgnore !== derniereCleSignalContexteIgnore) {
            derniereCleSignalContexteIgnore = cleIgnore;
            console.info('[AUTO-HH CONTEXTE] Signal contexte ignoré par cet onglet Heidi : autre onglet dédié ciblé.', {
                workerCible,
                workerLocal: workerLocal || null,
                timestamp: signal.timestamp
            });
        }

        return ok;
    }

    function mettreAJourHeidiWorkerActifDepuisContexte(signal, wedaUrl, statut) {
        if (!signal || !signal.heidiWorkerId || !wedaUrl) return null;

        try {
            const workerExistant = GM_getValue(CLE_HEIDI_WORKER_ACTIF_CONTEXTE, null) || {};

            if (workerExistant.workerId && workerExistant.workerId !== signal.heidiWorkerId) {
                console.warn('[AUTO-HH CONTEXTE] Worker Heidi actif différent, association contexte ignorée.', {
                    workerExistant,
                    signal,
                    wedaUrl
                });
                return null;
            }

            const patDk = getParamPatDkDepuisUrlContexte(wedaUrl);
            const workerMisAJour = {
                ...workerExistant,
                workerId: signal.heidiWorkerId,
                status: statut || 'context_weda_selected',
                wedaUrl: wedaUrl,
                patDk: patDk,
                contextWedaUrl: wedaUrl,
                contextPatDk: patDk,
                contextUpdatedAt: Date.now(),
                updatedAt: Date.now(),
                sourceSignal: {
                    timestamp: signal.timestamp,
                    nonce: signal.nonce || null,
                    action: signal.action,
                    trigger: signal.trigger || null
                }
            };

            GM_setValue(CLE_HEIDI_WORKER_ACTIF_CONTEXTE, workerMisAJour);
            console.info('[AUTO-HH CONTEXTE] Onglet Heidi dédié relié au patient du contexte WEDA :', workerMisAJour);
            return workerMisAJour;
        } catch (e) {
            console.warn('[AUTO-HH CONTEXTE] Mise à jour du patient lié à l’onglet Heidi impossible :', e);
            return null;
        }
    }

    function verrouillerOuvertureContextePourSignal(signal) {
        try {
            const maintenant = Date.now();
            const lock = GM_getValue(CLE_OUVERTURE_CONTEXTE_LOCK, null);
            const memeSignal = signalContexteCorrespondAuSignal(lock, signal);

            if (
                memeSignal &&
                Number(lock.timestampLock || 0) > 0 &&
                maintenant - Number(lock.timestampLock || 0) < DELAI_VERROU_OUVERTURE_CONTEXTE_MS
            ) {
                console.info('[AUTO-HH CONTEXTE] Ouverture contexte déjà prise en charge pour ce signal.', { signal, lock });
                return false;
            }

            GM_setValue(CLE_OUVERTURE_CONTEXTE_LOCK, {
                timestampLock: maintenant,
                timestamp: signal.timestamp,
                nonce: signal.nonce || null,
                action: signal.action,
                heidiWorkerId: signal.heidiWorkerId || null,
                source: location.href
            });

            return true;
        } catch (e) {
            console.warn('[AUTO-HH CONTEXTE] Verrou ouverture contexte indisponible, poursuite normale :', e);
            return true;
        }
    }

    function getCleJobContexte(jobId) {
        return CLE_CONTEXT_PREFIX + jobId;
    }

    function mettreAJourJobContexte(jobId, patch) {
        const key = getCleJobContexte(jobId);
        const job = GM_getValue(key, null);
        if (!job) return null;

        const nouveauJob = { ...job, ...patch, updatedAt: Date.now() };
        GM_setValue(key, nouveauJob);
        return nouveauJob;
    }

    function jobContexteEstAnnule(jobId) {
        if (!jobId) return false;
        try {
            const job = GM_getValue(getCleJobContexte(jobId), null);
            return !job || job.status === 'cancelled' || !!job.cancelledAt;
        } catch (e) {
            return false;
        }
    }

    function collecterDocumentsAccessiblesContexte(docInitial) {
        const docs = [];
        const dejaVus = new Set();

        function visiter(doc) {
            if (!doc || dejaVus.has(doc)) return;
            dejaVus.add(doc);
            docs.push(doc);

            let frames = [];
            try { frames = [...doc.querySelectorAll('iframe, frame')]; } catch (e) { frames = []; }

            for (const frame of frames) {
                try {
                    if (frame.contentDocument) visiter(frame.contentDocument);
                } catch (e) {}
            }
        }

        visiter(docInitial);
        return docs;
    }

    function getElementDansDocumentsContexte(selecteur) {
        const docs = collecterDocumentsAccessiblesContexte(document);

        for (const doc of docs) {
            try {
                const element = doc.querySelector(selecteur);
                if (element) return element;
            } catch (e) {}
        }

        return null;
    }

    function getBoutonSuiteWedaContexte() {
        const boutonDirect = getElementDansDocumentsContexte(SELECTEUR_BOUTON_SUITE_WEDA_CONTEXTE);
        if (boutonDirect) return boutonDirect;

        const docs = collecterDocumentsAccessiblesContexte(document);

        for (const doc of docs) {
            try {
                const candidats = [...doc.querySelectorAll('input, button, a')];
                const bouton = candidats.find(element => {
                    const id = String(element.id || '');
                    const name = String(element.getAttribute('name') || '');
                    const value = String(element.getAttribute('value') || element.value || '');
                    const title = String(element.getAttribute('title') || '');
                    const texte = String(element.innerText || element.textContent || '');

                    return (
                        id.includes('ButtonSuiteWeda') ||
                        name.includes('ButtonSuiteWeda') ||
                        normaliserTexteContexte(value).includes('suite') ||
                        normaliserTexteContexte(title).includes('suite des documents weda') ||
                        normaliserTexteContexte(texte).includes('suite')
                    );
                });

                if (bouton) return bouton;
            } catch (e) {}
        }

        return null;
    }

    function extraireTexteVisibleWedaContexte() {
        const docs = collecterDocumentsAccessiblesContexte(document);
        const blocs = [];

        for (const doc of docs) {
            try {
                if (!doc.body) continue;
                const texte = nettoyerTexteContexte(doc.body.innerText || doc.body.textContent || '');
                if (texte && !blocs.includes(texte)) blocs.push(texte);
            } catch (e) {}
        }

        return nettoyerTexteContexte(blocs.join('\n\n'));
    }

    async function deployerHistoriqueWedaContexte(jobId) {
        let job = GM_getValue(getCleJobContexte(jobId), null);
        let clicsDejaFaits = Number(job && job.suiteClicks ? job.suiteClicks : 0);

        while (clicsDejaFaits < NOMBRE_MAX_CLICS_SUITE_CONTEXTE) {
            const boutonSuite = getBoutonSuiteWedaContexte();

            if (!boutonSuite || !isVisibleContexte(boutonSuite)) return true;

            const longueurAvant = extraireTexteVisibleWedaContexte().length;
            clicsDejaFaits += 1;

            mettreAJourJobContexte(jobId, {
                status: 'expanding_history',
                message: 'Dépliage historique WEDA',
                suiteClicks: clicsDejaFaits
            });

            afficherBadgeContexte('AUTO-HH contexte : dépliage WEDA ' + clicsDejaFaits, 3000);
            clickElementContexte(boutonSuite, 'Bouton Suite WEDA', { autoriserInvisible: true });

            await sleepContexte(DELAI_APRES_CLIC_SUITE_CONTEXTE_MS);

            job = GM_getValue(getCleJobContexte(jobId), null);
            if (!job) return false;

            const longueurApres = extraireTexteVisibleWedaContexte().length;
            if (clicsDejaFaits > 1 && longueurApres <= longueurAvant + 20) {
                console.info('[AUTO-HH CONTEXTE] Suite cliqué sans nouveau texte significatif, arrêt du dépliage.');
                return true;
            }
        }

        return true;
    }

    function getBoutonAccueilWedaContexte() {
        const images = [...document.querySelectorAll('img[src*="W_BLEU.png"], img[src*="W_BLEU"], img[src*="Weda"], img[src*="weda"]')];

        const imageW = images.find(img => {
            const src = String(img.getAttribute('src') || img.src || '');
            const alt = String(img.getAttribute('alt') || '');
            const title = String(img.getAttribute('title') || '');

            return (
                src.includes('W_BLEU') ||
                src.includes('Weda') ||
                src.includes('weda') ||
                alt.toLowerCase().includes('weda') ||
                title.toLowerCase().includes('weda') ||
                title.toLowerCase().includes('accueil')
            );
        });

        if (imageW) return imageW.closest('a, button, [role="button"]') || imageW;

        const liens = [...document.querySelectorAll('a, button, [role="button"]')];

        return liens.find(el => {
            const texte = normaliserTexteContexte(el.innerText || el.textContent || '');
            const title = normaliserTexteContexte((el.getAttribute && el.getAttribute('title')) || '');
            return texte === 'w' || texte.includes('accueil') || title.includes('accueil') || title.includes('weda');
        }) || null;
    }

    function ouvrirAccueilPatientWedaContexte(job) {
        const boutonAccueil = getBoutonAccueilWedaContexte();

        if (boutonAccueil) {
            afficherBadgeContexte('AUTO-HH contexte : clic bouton W / accueil', 4000);
            clickElementContexte(boutonAccueil, 'Bouton W / accueil WEDA');
            return true;
        }

        const urlPatient = construireUrlPatientDepuisUrlContexte(job && job.wedaUrl ? job.wedaUrl : getTopHrefContexte());

        if (urlPatient) {
            afficherBadgeContexte('AUTO-HH contexte : fallback accueil patient', 6000);
            window.location.href = urlPatient;
            return true;
        }

        return false;
    }

    async function traiterWorkerContexteWeda(jobId) {
        if (!EST_WEDA_CONTEXTE || !isTopFrameContexte()) return;

        const key = getCleJobContexte(jobId);
        const job = GM_getValue(key, null);

        if (!job) return;

        sessionStorage.setItem(CLE_SESSION_JOB_CONTEXTE, jobId);

        if (job.status === 'context_ready' || job.status === 'context_pasted' || job.status === 'error' || job.status === 'cancelled') return;

        afficherBadgeContexte('AUTO-HH contexte : lecture WEDA', 4000);

        if (!estPageAccueilPatientWedaContexte()) {
            mettreAJourJobContexte(jobId, {
                status: 'opening_patient_home',
                message: 'Ouverture accueil patient WEDA pour contexte'
            });

            const okAccueil = ouvrirAccueilPatientWedaContexte(job);

            if (!okAccueil) {
                mettreAJourJobContexte(jobId, {
                    status: 'error',
                    message: 'Impossible d’ouvrir l’accueil patient WEDA pour le contexte'
                });
                afficherBadgeContexte('AUTO-HH contexte : accueil WEDA introuvable', 8000);
            }

            return;
        }

        mettreAJourJobContexte(jobId, {
            status: 'collecting',
            message: 'Collecte du contexte WEDA'
        });

        await sleepContexte(700);
        await deployerHistoriqueWedaContexte(jobId);
        await sleepContexte(600);

        const jobApresDeploiement = GM_getValue(key, null);
        if (!jobApresDeploiement || jobApresDeploiement.status === 'cancelled') {
            console.info('[AUTO-HH CONTEXTE] Collecte WEDA interrompue : job contexte annulé.', { jobId });
            try { sessionStorage.removeItem(CLE_SESSION_JOB_CONTEXTE); } catch (e) {}
            return;
        }

        const contexte = extraireTexteVisibleWedaContexte();

        if (!contexte || contexte.length < 20) {
            mettreAJourJobContexte(jobId, {
                status: 'error',
                message: 'Contexte WEDA vide ou introuvable'
            });
            afficherBadgeContexte('AUTO-HH contexte : texte WEDA vide', 8000);
            return;
        }

        mettreAJourJobContexte(jobId, {
            status: 'context_ready',
            message: 'Contexte WEDA prêt',
            contexte: contexte,
            longueurContexte: contexte.length
        });

        afficherBadgeContexte('AUTO-HH contexte : WEDA copié', 5000);

        try { sessionStorage.removeItem(CLE_SESSION_JOB_CONTEXTE); } catch (e) {}

        try {
            const principal = sessionStorage.getItem(CLE_SESSION_JOB_PRINCIPAL);
            if (principal === jobId) sessionStorage.removeItem(CLE_SESSION_JOB_PRINCIPAL);
        } catch (e) {}

        setTimeout(() => {
            try { window.close(); } catch (e) {}
        }, 500);
    }

    function initialiserWorkerContexteWeda() {
        if (!EST_WEDA_CONTEXTE || !isTopFrameContexte()) return;

        const jobDepuisHash = getJobIdDepuisHashPrincipalContexte();

        if (jobDepuisHash && String(jobDepuisHash).startsWith('ctx_')) {
            sessionStorage.setItem(CLE_SESSION_JOB_CONTEXTE, jobDepuisHash);
            try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) {}
        }

        let jobId = sessionStorage.getItem(CLE_SESSION_JOB_CONTEXTE);

        if (!jobId) {
            const jobPrincipal = sessionStorage.getItem(CLE_SESSION_JOB_PRINCIPAL);
            if (jobPrincipal && String(jobPrincipal).startsWith('ctx_')) jobId = jobPrincipal;
        }

        if (!jobId || !String(jobId).startsWith('ctx_')) return;

        setTimeout(() => {
            traiterWorkerContexteWeda(jobId);
        }, 500);
    }

    function ouvrirWorkerContexteWeda(wedaUrl, jobId) {
        const urlBase = nettoyerUrlPourOngletContexte(wedaUrl);
        const urlWorker = urlBase + '#' + PARAM_WORKER_CONTEXTE + '=' + encodeURIComponent(jobId);

        try {
            const onglet = GM_openInTab(urlWorker, {
                active: false,
                insert: true,
                setParent: true
            });

            if (onglet) ongletsContexteWeda[jobId] = onglet;
        } catch (e) {
            window.open(urlWorker, '_blank');
        }
    }

    function getOngletContexteHeidi() {
        return document.querySelector(SELECTEUR_ONGLET_CONTEXTE_HEIDI);
    }

    function getChampContexteHeidi() {
        return document.querySelector(SELECTEUR_CHAMP_CONTEXTE_HEIDI);
    }

    async function attendreChampContexteHeidi() {
        return attendreParVerificationContexte(
            getChampContexteHeidi,
            champ => !!champ && isVisibleContexte(champ),
            'champ contexte Heidi',
            TIMEOUT_CONTEXTE_HEIDI_MS,
            120
        );
    }

    async function ouvrirOngletContexteHeidi() {
        const bouton = await attendreParVerificationContexte(
            getOngletContexteHeidi,
            element => !!element && isVisibleContexte(element),
            'onglet Contexte Heidi',
            TIMEOUT_CONTEXTE_HEIDI_MS,
            120
        );

        if (!bouton) return false;

        clickElementContexte(bouton, 'Onglet Contexte Heidi');
        await sleepContexte(500);
        return true;
    }

    function selectionnerToutDansChampContexte(champ) {
        try {
            const doc = champ.ownerDocument || document;
            const win = doc.defaultView || window;
            const range = doc.createRange();

            range.selectNodeContents(champ);

            const selection = win.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            return true;
        } catch (e) {
            return false;
        }
    }

    function viderChampContexte(champ) {
        try {
            const doc = champ.ownerDocument || document;
            selectionnerToutDansChampContexte(champ);
            doc.execCommand('delete', false, null);
            return true;
        } catch (e) {
            try { champ.textContent = ''; } catch (e2) {}
            return false;
        }
    }

    function declencherEvenementsEditeurContexte(champ, texte) {
        const doc = champ.ownerDocument || document;
        const win = doc.defaultView || window;

        ['beforeinput', 'input', 'change', 'keyup', 'blur'].forEach(type => {
            try {
                let event;

                if ((type === 'beforeinput' || type === 'input') && typeof win.InputEvent === 'function') {
                    event = new win.InputEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertFromPaste',
                        data: texte
                    });
                } else {
                    event = new win.Event(type, { bubbles: true, cancelable: true });
                }

                champ.dispatchEvent(event);
            } catch (e) {}
        });
    }

    function collerTexteBrutParPaste(champ, texte) {
        try {
            const win = champ.ownerDocument.defaultView || window;

            if (typeof win.DataTransfer !== 'function' || typeof win.ClipboardEvent !== 'function') return false;

            const dataTransfer = new win.DataTransfer();
            dataTransfer.setData('text/plain', texte);

            const event = new win.ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
            });

            try {
                if (!event.clipboardData) {
                    Object.defineProperty(event, 'clipboardData', {
                        value: dataTransfer
                    });
                }
            } catch (e) {}

            champ.dispatchEvent(event);
            return true;
        } catch (e) {
            return false;
        }
    }

    function insererTexteBrutParCommande(champ, texte) {
        try {
            const doc = champ.ownerDocument || document;
            return doc.execCommand('insertText', false, texte);
        } catch (e) {
            return false;
        }
    }

    function remplirDirectementTexteBrut(champ, texte) {
        try {
            champ.textContent = texte;
            declencherEvenementsEditeurContexte(champ, texte);
            return true;
        } catch (e) {
            return false;
        }
    }

    function champContientContexte(champ, texteReference) {
        const visible = normaliserVerificationContexte(champ.innerText || champ.textContent || '');
        const attendu = normaliserVerificationContexte(texteReference);

        if (!attendu) return false;
        if (attendu.length <= 200) return visible.includes(attendu) || visible.length >= attendu.length * 0.9;

        const debut = attendu.slice(0, 120);
        const fin = attendu.slice(-120);

        return visible.includes(debut) && visible.includes(fin) && visible.length >= attendu.length * 0.95;
    }

    async function attendreContexteVisible(champ, texteReference, timeoutMs) {
        const start = Date.now();

        return new Promise(resolve => {
            const verifier = () => {
                if (champContientContexte(champ, texteReference)) {
                    resolve(true);
                    return;
                }

                if (Date.now() - start > timeoutMs) {
                    resolve(false);
                    return;
                }

                setTimeout(verifier, 150);
            };

            verifier();
        });
    }

    async function insererTexteDansContexteHeidi(champ, texte) {
        if (!champ || !texte) return false;

        const texteNettoye = nettoyerTexteContexte(texte);

        try { champ.focus(); } catch (e) {}
        try { champ.click(); } catch (e) {}

        await sleepContexte(80);

        viderChampContexte(champ);
        await sleepContexte(80);

        let ok = collerTexteBrutParPaste(champ, texteNettoye);
        if (ok && await attendreContexteVisible(champ, texteNettoye, 2500)) return true;

        viderChampContexte(champ);
        await sleepContexte(80);

        ok = insererTexteBrutParCommande(champ, texteNettoye);
        declencherEvenementsEditeurContexte(champ, texteNettoye);
        if (ok && await attendreContexteVisible(champ, texteNettoye, 3000)) return true;

        viderChampContexte(champ);
        await sleepContexte(80);

        ok = remplirDirectementTexteBrut(champ, texteNettoye);
        await sleepContexte(600);

        return ok && champContientContexte(champ, texteNettoye);
    }

    async function collerContexteDansHeidi(jobId) {
        const key = getCleJobContexte(jobId);
        const job = GM_getValue(key, null);

        if (!job || !job.contexte) return false;
        if (job.status === 'cancelled') {
            console.info('[AUTO-HH CONTEXTE] Collage contexte ignoré : job annulé.', job);
            return false;
        }

        mettreAJourJobContexte(jobId, {
            status: 'context_pasting',
            message: 'Collage texte brut du contexte dans Heidi'
        });

        if (jobContexteEstAnnule(jobId)) {
            console.info('[AUTO-HH CONTEXTE] Collage contexte stoppé avant restauration : job annulé.', { jobId });
            return false;
        }

        afficherBadgeContexte('AUTO-HH contexte : collage texte brut', 5000);

        const okSession = await restaurerSessionHeidiContextePourJob(job);
        if (!okSession) {
            mettreAJourJobContexte(jobId, {
                status: 'error',
                message: 'Session Heidi de transcription introuvable pour le collage contexte'
            });
            afficherBadgeContexte('AUTO-HH contexte : mauvaise session Heidi', 8000);
            return false;
        }

        if (jobContexteEstAnnule(jobId)) {
            console.info('[AUTO-HH CONTEXTE] Collage contexte stoppé après restauration : job annulé.', { jobId });
            return false;
        }

        const okOnglet = await ouvrirOngletContexteHeidi();

        if (!okOnglet) {
            mettreAJourJobContexte(jobId, {
                status: 'error',
                message: 'Onglet Contexte Heidi introuvable'
            });

            afficherBadgeContexte('AUTO-HH contexte : onglet Heidi introuvable', 8000);
            return false;
        }

        const champ = await attendreChampContexteHeidi();

        if (!champ) {
            mettreAJourJobContexte(jobId, {
                status: 'error',
                message: 'Champ Contexte Heidi introuvable'
            });

            afficherBadgeContexte('AUTO-HH contexte : champ Heidi introuvable', 8000);
            return false;
        }

        const texteAInserer = ENTETE_CONTEXTE_WEDA + '\n\n' + job.contexte;
        const okInsertion = await insererTexteDansContexteHeidi(champ, texteAInserer);

        if (!okInsertion) {
            mettreAJourJobContexte(jobId, {
                status: 'error',
                message: 'Insertion du contexte dans Heidi impossible'
            });

            afficherBadgeContexte('AUTO-HH contexte : insertion impossible', 8000);
            return false;
        }

        mettreAJourJobContexte(jobId, {
            status: 'context_pasted',
            message: 'Contexte WEDA collé dans Heidi en texte brut'
        });

        afficherBadgeContexte('AUTO-HH contexte : contexte ajouté', 5000);

        try {
            const onglet = ongletsContexteWeda[jobId];
            if (onglet && typeof onglet.close === 'function') onglet.close();
        } catch (e) {}

        delete ongletsContexteWeda[jobId];

        setTimeout(() => {
            try { GM_deleteValue(key); } catch (e) {}
        }, 15000);

        console.info('[AUTO-HH CONTEXTE] Contexte collé dans Heidi, texte brut :', {
            jobId: jobId,
            longueur: texteAInserer.length
        });

        return true;
    }

    function surveillerJobContexteDepuisHeidi(jobId) {
        if (!EST_HEIDI_CONTEXTE) return;

        const key = getCleJobContexte(jobId);
        const start = Date.now();

        const timer = setInterval(() => {
            const job = GM_getValue(key, null);

            if (!job) {
                clearInterval(timer);
                return;
            }

            if (job.status === 'context_ready') {
                clearInterval(timer);
                const signalReference = {
                    timestamp: job.sourceSignal && job.sourceSignal.timestamp,
                    nonce: job.sourceSignal && job.sourceSignal.nonce,
                    action: 'start',
                    heidiWorkerId: job.sourceSignal && job.sourceSignal.heidiWorkerId
                };
                const signalCourant = GM_getValue(CLE_SIGNAL_CONTEXTE, null);
                if (!signalContexteCorrespondAuSignal(signalCourant, signalReference)) {
                    mettreAJourJobContexte(jobId, {
                        status: 'cancelled',
                        message: 'Contexte annulé car PageDown ou un signal plus récent a été reçu'
                    });
                    afficherBadgeContexte('AUTO-HH contexte : collage annulé', 5000);
                    console.info('[AUTO-HH CONTEXTE] Collage contexte annulé : signal remplacé.', { jobId, signalReference, signalCourant });
                    setTimeout(() => {
                        try { GM_deleteValue(key); } catch (e) {}
                    }, 15000);
                    return;
                }
                collerContexteDansHeidi(jobId);
                return;
            }

            if (job.status === 'error') {
                clearInterval(timer);
                afficherBadgeContexte('AUTO-HH contexte : erreur WEDA', 8000);
                console.warn('[AUTO-HH CONTEXTE] Job contexte en erreur :', job);
                return;
            }

            if (job.status === 'cancelled') {
                clearInterval(timer);
                afficherBadgeContexte('AUTO-HH contexte : annulé', 4000);
                console.info('[AUTO-HH CONTEXTE] Job contexte annulé :', job);
                setTimeout(() => {
                    try { GM_deleteValue(key); } catch (e) {}
                }, 15000);
                return;
            }

            if (Date.now() - start > TIMEOUT_JOB_CONTEXTE_MS) {
                clearInterval(timer);

                mettreAJourJobContexte(jobId, {
                    status: 'error',
                    message: 'Timeout collecte contexte WEDA'
                });

                afficherBadgeContexte('AUTO-HH contexte : délai dépassé', 8000);
                return;
            }
        }, 700);
    }

   function choisirWedaUrlContexteApresTemporisation(signal) {
    const snapshot = GM_getValue(CLE_WEDA_ACTIVE_SNAPSHOT_CONTEXTE, null);
    const urlWedaActuelle = GM_getValue(CLE_LAST_WEDA_URL_CONTEXTE, null);
    const urlSignal = signal && signal.wedaUrl ? signal.wedaUrl : null;
    const timestampSignal = Number(signal && signal.timestamp ? signal.timestamp : 0);

    if (snapshot && snapshot.url) {
        const timestampSnapshot = Number(snapshot.timestamp || 0);
        const snapshotRecent = timestampSnapshot > 0 && Date.now() - timestampSnapshot <= 120000;
        const snapshotCompatiblePageUp = snapshotRecent && (!timestampSignal || timestampSnapshot >= timestampSignal - 2000);

        if (snapshotCompatiblePageUp) {
            const patientSnapshot = getParamPatDkDepuisUrlContexte(snapshot.url);
            const patientSignal = getParamPatDkDepuisUrlContexte(urlSignal);

            if (patientSnapshot && patientSignal && patientSnapshot !== patientSignal) {
                console.info('[AUTO-HH CONTEXTE] Patient WEDA changé après PageUp, utilisation du patient actif.', {
                    patientSignal,
                    patientSnapshot,
                    urlSignal,
                    urlActive: snapshot.url
                });
            }

            return snapshot.url;
        }
    }

    return urlSignal || urlWedaActuelle || null;
}


    async function traiterSignalStartContexte(signal, origine) {
        if (!EST_HEIDI_CONTEXTE) return;
        if (!signal || signal.action !== 'start' || !signal.timestamp) return;
        if (!signalDestineAHeidiContexteCourant(signal)) return;
        if (signal.timestamp <= dernierSignalStartContexteTraite) return;

        dernierSignalStartContexteTraite = signal.timestamp;

        console.info('[AUTO-HH CONTEXTE] Signal start reçu via ' + origine + ' :', signal);

        afficherBadgeContexte('AUTO-HH contexte : ouverture WEDA dans 1 minute', 5000);

        await sleepContexte(DELAI_APRES_SIGNAL_START_CONTEXTE_MS);

        const signalCourant = GM_getValue(CLE_SIGNAL_CONTEXTE, null);
        if (!signalContexteCorrespondAuSignal(signalCourant, signal)) {
            console.info('[AUTO-HH CONTEXTE] Collecte contexte annulée : un signal plus récent a remplacé le PageUp.', {
                signalInitial: signal,
                signalCourant
            });
            afficherBadgeContexte('AUTO-HH contexte : annulé par signal plus récent', 5000);
            return;
        }

       const wedaUrl = choisirWedaUrlContexteApresTemporisation(signal);

        if (!wedaUrl) {
            afficherBadgeContexte('AUTO-HH contexte : aucun WEDA connu', 7000);
            return;
        }

        if (!verrouillerOuvertureContextePourSignal(signal)) {
            afficherBadgeContexte('AUTO-HH contexte : déjà en cours', 5000);
            return;
        }

        const workerActifContexte = mettreAJourHeidiWorkerActifDepuisContexte(signal, wedaUrl, 'context_weda_selected');

        const jobId = 'ctx_' + Date.now() + '_' + Math.random().toString(36).slice(2);

        const job = {
            jobId: jobId,
            status: 'pending',
            message: 'Job contexte créé',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceSignal: {
                timestamp: signal.timestamp,
                nonce: signal.nonce || null,
                action: signal.action,
                heidiWorkerId: signal.heidiWorkerId || null,
                heidiSessionId: signal.heidiSessionId || (workerActifContexte && workerActifContexte.heidiSessionId) || null,
                heidiSessionUrl: signal.heidiSessionUrl || (workerActifContexte && workerActifContexte.heidiSessionUrl) || null,
                trigger: signal.trigger || null,
                source: signal.source || null
            },
            heidiSessionId: signal.heidiSessionId || (workerActifContexte && workerActifContexte.heidiSessionId) || null,
            heidiSessionUrl: signal.heidiSessionUrl || (workerActifContexte && workerActifContexte.heidiSessionUrl) || null,
            wedaUrl: wedaUrl,
            suiteClicks: 0
        };

        GM_setValue(getCleJobContexte(jobId), job);

        afficherBadgeContexte('AUTO-HH contexte : ouverture WEDA', 5000);
        ouvrirWorkerContexteWeda(wedaUrl, jobId);
        surveillerJobContexteDepuisHeidi(jobId);
    }

    function initialiserHeidiContexte() {
        if (!EST_HEIDI_CONTEXTE) return;

        try {
    const signalInitial = GM_getValue(CLE_SIGNAL_CONTEXTE, null);

    if (signalInitial && signalInitial.timestamp) {
        const ageSignal = Date.now() - Number(signalInitial.timestamp || 0);

        if (
            signalInitial.action === 'start' &&
            ageSignal <= DELAI_SIGNAL_INITIAL_RECENT_CONTEXTE_MS
        ) {
            setTimeout(() => {
                traiterSignalStartContexte(signalInitial, 'signal initial récent contexte Heidi');
            }, 700);
        } else {
            dernierSignalStartContexteTraite = signalInitial.timestamp;
        }
    }
} catch (e) {}


        try {
            GM_addValueChangeListener(CLE_SIGNAL_CONTEXTE, function (_name, _oldValue, newValue) {
                traiterSignalStartContexte(newValue, 'GM_addValueChangeListener');
            });
        } catch (e) {}

        setInterval(function () {
            try {
                const signal = GM_getValue(CLE_SIGNAL_CONTEXTE, null);
                traiterSignalStartContexte(signal, 'GM_getValue');
            } catch (e) {}
        }, 500);

        window.AUTO_HH_TEST_CONTEXTE_HEIDI = function () {
            const wedaUrl = GM_getValue(CLE_LAST_WEDA_URL_CONTEXTE, null);

            const signalTest = {
                action: 'start',
                timestamp: Date.now(),
                trigger: 'test_contexte_heidi',
                wedaUrl: wedaUrl,
                source: location.href
            };

            traiterSignalStartContexte(signalTest, 'test manuel Heidi');
            return signalTest;
        };
    }

    function initialiserWedaContexte() {
        if (!EST_WEDA_CONTEXTE) return;

        initialiserWorkerContexteWeda();

        window.AUTO_HH_TEST_CONTEXTE_WEDA = async function () {
            const texte = extraireTexteVisibleWedaContexte();

            console.info('[AUTO-HH CONTEXTE] Texte visible WEDA actuel :', {
                longueur: texte.length,
                texte: texte
            });

            return texte;
        };
    }

    initialiserHeidiContexte();
    initialiserWedaContexte();

    console.info('[AUTO-HH CONTEXTE] Module chargé :', {
        host: HOST_CONTEXTE,
        href: location.href,
        topHref: getTopHrefContexte(),
        weda: EST_WEDA_CONTEXTE,
        heidi: EST_HEIDI_CONTEXTE,
        topFrame: isTopFrameContexte()
    });
})();
// AUTO-HH debug module
// Integration:
// 1. Paste this block at the very end of the existing userscript, after the two current IIFEs.
// 2. Optional but recommended in the Tampermonkey header:
//    // @grant        GM_listValues
//
// Usage:
// - Press Ctrl+Alt+D on WEDA or Heidi to open the diagnostic panel.
// - Or run AUTO_HH_DEBUG.show() in the browser console.
// - Run AUTO_HH_DEBUG.run() for a JSON report in the console.

(function () {
    'use strict';

    const DEBUG_VERSION = '1.0.0';
    const HOST = location.hostname;
    const EST_WEDA = HOST === 'secure.weda.fr' || HOST.endsWith('.weda.fr');
    const EST_HEIDI = HOST === 'scribe.heidihealth.com';

    if (!EST_WEDA && !EST_HEIDI) return;

    if (EST_WEDA && getHrefLower().includes('/foldermedical/hprimform.aspx')) {
        try { console.info('[AUTO-HH DEBUG] Module debug désactivé sur HprimForm.aspx.'); } catch (e) {}
        return;
    }

    const PAGE_WEDA_CONSULTATION = '/foldermedical/consultationform.aspx';
    const PAGE_WEDA_PATIENT = '/foldermedical/patientviewform.aspx';
    const PAGE_WEDA_FSE = '/vitalzen/fse.aspx';
    const PAGE_WEDA_HPRIM = '/foldermedical/hprimform.aspx';

    const CLE_SIGNAL = 'auto_hh_signal_stable_v768';
    const CLE_LAST_WEDA_URL = 'auto_hh_last_weda_url_stable';
    const CLE_TRANSFER_PREFIX = 'auto_hh_transfer_job_stable_';
    const CLE_CONTEXT_PREFIX = 'auto_hh_context_job_stable_';
    const CLE_SESSION_JOB = 'auto_hh_weda_worker_job_stable';
    const CLE_SESSION_CONTEXT_JOB = 'auto_hh_weda_context_worker_job_stable';
    const CLE_NOTIFICATION = 'auto_hh_notification_stable';
    const CLE_LAST_REPORT = 'auto_hh_last_report_stable';
    const CLE_WEDA_ACTIVE_SNAPSHOT = 'auto_hh_weda_active_snapshot_stable';
    const CLE_DEBUG_LAST_REPORT = 'auto_hh_debug_last_report_stable';

    const SELECTEURS = {
        heidiNouvelleSession: 'button[data-testid="sessions-panel-action-new-session"]',
        heidiTexteGenere: '#template-block-editor-content > div',
        heidiOngletContexte: 'button[data-testid="session-tab-context"]',
        heidiChampContexte: 'div[data-testid="context-tab-block-editor"] [contenteditable="true"]',
        wedaAutosave: '#ButtonAutoSave',
        wedaImageSauvegarde: '#ContentPlaceHolder1_EvenementUcForm1_MenuNavigate > ul > li > a > img',
        wedaBoutonEtiquette: '#ContentPlaceHolder1_EvenementUcForm1_ButtonStatEtiquette',
        wedaGridGlossaires: '#ContentPlaceHolder1_EvenementUcForm1_GlossairesGrid',
        wedaSuite: '#ContentPlaceHolder1_HistoriqueUCForm1_ButtonSuiteWeda',
        wedaPoids: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_0',
        wedaTaille: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_1',
        wedaTensionSys: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_3',
        wedaTensionDia: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_4',
        wedaAutomesure: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_5',
        wedaTemperature: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_6',
        wedaTabac: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_7',
        wedaAlcool: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_8',
        wedaExamenPieds: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_9',
        wedaHemocult: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_10',
        wedaFrottis: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_11',
        wedaMammographie: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_12',
        wedaDentiste: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_13',
        wedaDtp: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_14',
        wedaPapillomavirus: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_15',
        wedaFondOeil: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_20',
        wedaCardiologue: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_21',
        wedaMms: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_23',
        wedaMadrs: '#ContentPlaceHolder1_SuivisGrid_EditBoxGridSuiviReponse_24'
    };

    const erreursCapturees = [];
    const evenementsGm = [];
    let dernierRapport = null;
    let timerWatch = null;
    let timerBadge = null;

    function maintenantIso() {
        return new Date().toISOString();
    }

    function normaliserTexte(texte) {
        return String(texte || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/œ/g, 'oe')
            .replace(/Œ/g, 'oe')
            .toLowerCase()
            .replace(/[’']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function texteCourt(texte, max) {
        const propre = String(texte || '').replace(/\s+/g, ' ').trim();
        if (propre.length <= max) return propre;
        return propre.slice(0, max - 3) + '...';
    }

    function safe(fn, fallback) {
        try { return fn(); } catch (e) { return fallback; }
    }

    function isTopFrame() {
        return safe(() => window.top === window.self, false);
    }

    function getTopHref() {
        return safe(() => window.top.location.href, location.href);
    }

    function getHrefLower() {
        return String(getTopHref() || '').toLowerCase();
    }

    function getParamPatDkDepuisUrl(urlBrute) {
        return safe(() => {
            const url = new URL(urlBrute);
            for (const entree of url.searchParams.entries()) {
                if (String(entree[0]).toLowerCase() === 'patdk' && entree[1]) return entree[1];
            }
            return null;
        }, null);
    }

    function estPageWeda(type) {
        const href = getHrefLower();
        if (type === 'patient') return href.includes(PAGE_WEDA_PATIENT);
        if (type === 'consultation') return href.includes(PAGE_WEDA_CONSULTATION);
        if (type === 'fse') return href.includes(PAGE_WEDA_FSE);
        return false;
    }

    function collecterDocumentsAccessibles(docInitial) {
        const docs = [];
        const vus = new Set();

        function visiter(doc, chemin) {
            if (!doc || vus.has(doc)) return;
            vus.add(doc);
            docs.push({ doc, chemin });

            let frames = [];
            try { frames = Array.from(doc.querySelectorAll('iframe, frame')); } catch (e) { frames = []; }

            frames.forEach((frame, index) => {
                try {
                    if (frame.contentDocument) visiter(frame.contentDocument, chemin + ' > frame[' + index + ']');
                } catch (e) {}
            });
        }

        visiter(docInitial || document, 'document');
        return docs;
    }

    function isVisible(element) {
        if (!element) return false;
        return safe(() => {
            if (element.tagName && element.tagName.toLowerCase() === 'option') {
                return !!element.parentElement && isVisible(element.parentElement);
            }

            const win = element.ownerDocument.defaultView || window;
            const style = win.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                !element.disabled &&
                element.getAttribute('aria-disabled') !== 'true'
            );
        }, false);
    }

    function cheminCss(element) {
        if (!element || !element.tagName) return null;

        const morceaux = [];
        let courant = element;

        while (courant && courant.nodeType === 1 && morceaux.length < 5) {
            let morceau = courant.tagName.toLowerCase();
            if (courant.id) {
                morceau += '#' + courant.id;
                morceaux.unshift(morceau);
                break;
            }

            const classes = String(courant.className || '')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2);
            if (classes.length) morceau += '.' + classes.join('.');

            const parent = courant.parentElement;
            if (parent) {
                const similaires = Array.from(parent.children).filter(child => child.tagName === courant.tagName);
                if (similaires.length > 1) morceau += ':nth-of-type(' + (similaires.indexOf(courant) + 1) + ')';
            }

            morceaux.unshift(morceau);
            courant = parent;
        }

        return morceaux.join(' > ');
    }

    function decrireElement(element, cheminDoc) {
        if (!element) return null;
        const rect = safe(() => element.getBoundingClientRect(), null);
        const texte = element.innerText || element.textContent || element.value || '';

        return {
            tag: String(element.tagName || '').toLowerCase(),
            id: element.id || null,
            name: element.getAttribute ? (element.getAttribute('name') || null) : null,
            type: element.getAttribute ? (element.getAttribute('type') || null) : null,
            role: element.getAttribute ? (element.getAttribute('role') || null) : null,
            title: element.getAttribute ? texteCourt(element.getAttribute('title') || '', 100) : '',
            ariaLabel: element.getAttribute ? texteCourt(element.getAttribute('aria-label') || '', 100) : '',
            text: texteCourt(texte, 140),
            visible: isVisible(element),
            disabled: !!element.disabled,
            rect: rect ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            } : null,
            doc: cheminDoc || 'document',
            cssPath: cheminCss(element)
        };
    }

    function queryAllDocuments(selecteur) {
        const resultats = [];
        collecterDocumentsAccessibles(document).forEach(item => {
            try {
                Array.from(item.doc.querySelectorAll(selecteur)).forEach(element => {
                    resultats.push({ element, chemin: item.chemin });
                });
            } catch (e) {}
        });
        return resultats;
    }

    function checkSelecteur(id, label, selecteur, options) {
        const opts = options || {};
        const trouves = queryAllDocuments(selecteur);
        const visibles = trouves.filter(item => isVisible(item.element));
        const ok = opts.visibleRequired ? visibles.length > 0 : trouves.length > 0;

        return {
            id,
            label,
            type: 'selector',
            critical: !!opts.critical,
            ok,
            count: trouves.length,
            visibleCount: visibles.length,
            selector: selecteur,
            sample: (visibles[0] || trouves[0]) ? decrireElement((visibles[0] || trouves[0]).element, (visibles[0] || trouves[0]).chemin) : null,
            note: opts.note || ''
        };
    }

    function trouverElementsParTexte(selecteur, predicate) {
        const resultats = [];
        collecterDocumentsAccessibles(document).forEach(item => {
            try {
                Array.from(item.doc.querySelectorAll(selecteur)).forEach(element => {
                    const texte = normaliserTexte(element.innerText || element.textContent || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '');
                    if (predicate(texte, element)) resultats.push({ element, chemin: item.chemin });
                });
            } catch (e) {}
        });
        return resultats;
    }

    function checkTexte(id, label, selecteur, predicate, options) {
        const opts = options || {};
        const trouves = trouverElementsParTexte(selecteur, predicate);
        const visibles = trouves.filter(item => isVisible(item.element));
        const ok = opts.visibleRequired ? visibles.length > 0 : trouves.length > 0;

        return {
            id,
            label,
            type: 'text',
            critical: !!opts.critical,
            ok,
            count: trouves.length,
            visibleCount: visibles.length,
            selector: selecteur,
            sample: (visibles[0] || trouves[0]) ? decrireElement((visibles[0] || trouves[0]).element, (visibles[0] || trouves[0]).chemin) : null,
            note: opts.note || ''
        };
    }

    function checkPredicate(id, label, ok, details, options) {
        const opts = options || {};
        return {
            id,
            label,
            type: 'predicate',
            critical: !!opts.critical,
            ok: !!ok,
            count: ok ? 1 : 0,
            visibleCount: ok ? 1 : 0,
            selector: null,
            sample: details || null,
            note: opts.note || ''
        };
    }

    function diagnosticsHeidi() {
        const checks = [];

        checks.push(checkSelecteur(
            'heidi.new_session',
            'Heidi - bouton Nouvelle session',
            SELECTEURS.heidiNouvelleSession,
            { critical: true, visibleRequired: true, note: 'Necessaire au PageUp.' }
        ));

        checks.push(checkTexte(
            'heidi.transcription',
            'Heidi - bouton Transcription',
            'button',
            texte => texte.includes('transcription') && !texte.includes('arreter'),
            { critical: true, visibleRequired: true, note: 'Necessaire au lancement de transcription.' }
        ));

        checks.push(checkTexte(
            'heidi.stop',
            'Heidi - bouton Arreter transcription',
            'button, [role="button"], [aria-label], [title], [data-testid], div, span',
            texte => (
                texte.includes('stop-recording-button') ||
                (
                    texte.includes('arreter') ||
                    texte.includes('stop') ||
                    texte.includes('terminer') ||
                    texte.includes('mettre fin') ||
                    texte.includes('end')
                ) &&
                (
                    texte.includes('transcription') ||
                    texte.includes('recording') ||
                    texte.includes('enregistrement') ||
                    texte.includes('dictee') ||
                    texte.includes('micro')
                )
            ),
            { critical: false, visibleRequired: true, note: 'Peut etre absent si la transcription est deja arretee.' }
        ));

        checks.push(checkTexte(
            'heidi.copy',
            'Heidi - bouton Copier',
            'button, span',
            texte => texte === 'copier' || texte.includes('copier'),
            { critical: true, visibleRequired: true, note: 'Necessaire au PageDown apres generation.' }
        ));

        checks.push(checkSelecteur(
            'heidi.generated_text',
            'Heidi - zone de texte genere',
            SELECTEURS.heidiTexteGenere,
            { critical: true, visibleRequired: false, note: 'Necessaire pour recuperer le contenu Heidi.' }
        ));

        checks.push(checkSelecteur(
            'heidi.context_tab',
            'Heidi - onglet Contexte',
            SELECTEURS.heidiOngletContexte,
            { critical: false, visibleRequired: true, note: 'Necessaire au module contexte WEDA vers Heidi.' }
        ));

        checks.push(checkSelecteur(
            'heidi.context_field',
            'Heidi - champ Contexte',
            SELECTEURS.heidiChampContexte,
            { critical: false, visibleRequired: false, note: 'Peut etre absent tant que l onglet Contexte n est pas ouvert.' }
        ));

        const lastWeda = gmGet(CLE_LAST_WEDA_URL, null);
        checks.push(checkPredicate(
            'heidi.last_weda_url',
            'Heidi - URL WEDA memorisee',
            !!lastWeda,
            { value: lastWeda || null },
            { critical: true, note: 'Necessaire pour savoir vers quel patient WEDA transferer.' }
        ));

        return checks;
    }

    function diagnosticsWeda() {
        const checks = [];
        const href = getTopHref();
        const patDk = getParamPatDkDepuisUrl(href);
        const pagePatient = estPageWeda('patient');
        const pageConsultation = estPageWeda('consultation');
        const pageFse = estPageWeda('fse');

        checks.push(checkPredicate(
            'weda.patient_context',
            'WEDA - contexte patient reconnu',
            !!patDk && (pagePatient || pageConsultation || pageFse),
            { patDk, pagePatient, pageConsultation, pageFse, href },
            { critical: true, note: 'Necessaire pour memoriser le bon patient.' }
        ));

        checks.push(checkPredicate(
            'weda.consultation_page',
            'WEDA - page consultation',
            pageConsultation,
            { href },
            { critical: false, note: 'Necessaire uniquement au moment de l insertion.' }
        ));

        const editables = queryAllDocuments('[contenteditable="true"], body[contenteditable="true"]');
        const editablesVisibles = editables.filter(item => isVisible(item.element));
        checks.push({
            id: 'weda.editable_field',
            label: 'WEDA - champ de consultation editable',
            type: 'selector',
            critical: pageConsultation,
            ok: editables.length > 0,
            count: editables.length,
            visibleCount: editablesVisibles.length,
            selector: '[contenteditable="true"], body[contenteditable="true"]',
            sample: (editablesVisibles[0] || editables[0]) ? decrireElement((editablesVisibles[0] || editables[0]).element, (editablesVisibles[0] || editables[0]).chemin) : null,
            note: 'Necessaire pour coller la consultation.'
        });

        checks.push(checkSelecteur(
            'weda.autosave',
            'WEDA - bouton ButtonAutoSave',
            SELECTEURS.wedaAutosave,
            { critical: pageConsultation, visibleRequired: false, note: 'Utilise pour sauvegarde directe si disponible.' }
        ));

        checks.push(checkSelecteur(
            'weda.save_image',
            'WEDA - image/menu sauvegarde',
            SELECTEURS.wedaImageSauvegarde,
            { critical: false, visibleRequired: false, note: 'Fallback de sauvegarde.' }
        ));

        checks.push(checkTexte(
            'weda.home_button_candidate',
            'WEDA - bouton accueil/W candidat',
            'a, button, [role="button"], img',
            (texte, element) => {
                const title = normaliserTexte(element.getAttribute && element.getAttribute('title'));
                const alt = normaliserTexte(element.getAttribute && element.getAttribute('alt'));
                const src = String((element.getAttribute && element.getAttribute('src')) || element.src || '').toLowerCase();
                return texte === 'w' || texte.includes('accueil') || title.includes('accueil') || title.includes('weda') || alt.includes('weda') || src.includes('w_bleu') || src.includes('weda');
            },
            { critical: false, visibleRequired: false, note: 'Utilise pour revenir a l accueil patient.' }
        ));

        checks.push(checkTexte(
            'weda.consultation_link',
            'WEDA - lien Consultation candidat',
            'a',
            texte => texte === 'consultation' || /^consultation\s*\(\d+\)$/.test(texte),
            { critical: pagePatient, visibleRequired: false, note: 'Utilise pour ouvrir la consultation existante.' }
        ));

        checks.push(checkPredicate(
            'weda.postback',
            'WEDA - fonction __doPostBack',
            safe(() => {
                const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                return typeof w.__doPostBack === 'function';
            }, false),
            null,
            { critical: false, note: 'Utilisee pour navigation WEDA directe.' }
        ));

        checks.push(checkSelecteur(
            'weda.tag_button',
            'WEDA - bouton panneau etiquettes',
            SELECTEURS.wedaBoutonEtiquette,
            { critical: false, visibleRequired: false, note: 'Necessaire pour ajouter les etiquettes.' }
        ));

        checks.push(checkSelecteur(
            'weda.tag_grid',
            'WEDA - grille etiquettes',
            SELECTEURS.wedaGridGlossaires,
            { critical: false, visibleRequired: false, note: 'Peut etre absente tant que le panneau etiquettes est ferme.' }
        ));

        checks.push(checkSelecteur(
            'weda.history_suite',
            'WEDA - bouton Suite historique',
            SELECTEURS.wedaSuite,
            { critical: false, visibleRequired: false, note: 'Necessaire seulement au module contexte.' }
        ));

        const champs = [
            ['weda.field.poids', 'Poids', SELECTEURS.wedaPoids],
            ['weda.field.taille', 'Taille', SELECTEURS.wedaTaille],
            ['weda.field.tension_sys', 'Tension systolique', SELECTEURS.wedaTensionSys],
            ['weda.field.tension_dia', 'Tension diastolique', SELECTEURS.wedaTensionDia],
            ['weda.field.automesure', 'Automesure', SELECTEURS.wedaAutomesure],
            ['weda.field.temperature', 'Temperature', SELECTEURS.wedaTemperature],
            ['weda.field.tabac', 'Tabac', SELECTEURS.wedaTabac],
            ['weda.field.alcool', 'Alcool', SELECTEURS.wedaAlcool],
            ['weda.field.examen_pieds', 'Examen pieds', SELECTEURS.wedaExamenPieds],
            ['weda.field.hemocult', 'Hemocult', SELECTEURS.wedaHemocult],
            ['weda.field.frottis', 'Frottis', SELECTEURS.wedaFrottis],
            ['weda.field.mammographie', 'Mammographie', SELECTEURS.wedaMammographie],
            ['weda.field.dentiste', 'Dentiste', SELECTEURS.wedaDentiste],
            ['weda.field.dtp', 'DTP', SELECTEURS.wedaDtp],
            ['weda.field.papillomavirus', 'Papillomavirus', SELECTEURS.wedaPapillomavirus],
            ['weda.field.fond_oeil', 'Fond oeil', SELECTEURS.wedaFondOeil],
            ['weda.field.cardiologue', 'Cardiologue', SELECTEURS.wedaCardiologue],
            ['weda.field.mms', 'MMS', SELECTEURS.wedaMms],
            ['weda.field.madrs', 'MADRS', SELECTEURS.wedaMadrs]
        ];

        champs.forEach(item => {
            checks.push(checkSelecteur(
                item[0],
                'WEDA - champ suivi ' + item[1],
                item[2],
                { critical: false, visibleRequired: false, note: 'Champ structure optionnel.' }
            ));
        });

        return checks;
    }

    function gmGet(key, fallback) {
        return safe(() => {
            if (typeof GM_getValue !== 'function') return fallback;
            return GM_getValue(key, fallback);
        }, fallback);
    }

    function gmSet(key, value) {
        return safe(() => {
            if (typeof GM_setValue !== 'function') return false;
            GM_setValue(key, value);
            return true;
        }, false);
    }

    function gmListKeys() {
        return safe(() => {
            if (typeof GM_listValues !== 'function') return null;
            const keys = GM_listValues();
            if (keys && typeof keys.then === 'function') return null;
            return Array.isArray(keys) ? keys : null;
        }, null);
    }

    function resumerValeur(value) {
        if (value == null) return value;
        if (typeof value !== 'object') return value;

        const clone = Array.isArray(value) ? value.slice() : Object.assign({}, value);

        ['texte', 'html', 'contexte'].forEach(key => {
            if (typeof clone[key] === 'string') {
                clone[key + 'Length'] = clone[key].length;
                clone[key + 'Preview'] = texteCourt(clone[key], 180);
                delete clone[key];
            }
        });

        if (clone.rapportExtraction && clone.rapportExtraction.champs) {
            clone.rapportExtraction = {
                version: clone.rapportExtraction.version,
                timestamp: clone.rapportExtraction.timestamp,
                champs: clone.rapportExtraction.champs,
                tags: clone.rapportExtraction.tags,
                correctionsQualite: clone.rapportExtraction.correctionsQualite
            };
        }

        return clone;
    }

    function diagnosticsStockage() {
        const knownKeys = [
            CLE_SIGNAL,
            CLE_LAST_WEDA_URL,
            CLE_SESSION_JOB,
            CLE_SESSION_CONTEXT_JOB,
            CLE_NOTIFICATION,
            CLE_LAST_REPORT,
            CLE_WEDA_ACTIVE_SNAPSHOT,
            CLE_DEBUG_LAST_REPORT
        ];

        const gmKeys = gmListKeys();
        const toutesLesCles = gmKeys
            ? gmKeys.filter(key => String(key).startsWith('auto_hh_'))
            : knownKeys;

        const transferJobs = [];
        const contextJobs = [];
        const valeursConnues = {};

        toutesLesCles.forEach(key => {
            const value = gmGet(key, null);
            if (String(key).startsWith(CLE_TRANSFER_PREFIX)) {
                transferJobs.push(Object.assign({ key }, resumerValeur(value)));
            } else if (String(key).startsWith(CLE_CONTEXT_PREFIX)) {
                contextJobs.push(Object.assign({ key }, resumerValeur(value)));
            } else if (knownKeys.includes(key)) {
                valeursConnues[key] = resumerValeur(value);
            }
        });

        knownKeys.forEach(key => {
            if (!(key in valeursConnues)) valeursConnues[key] = resumerValeur(gmGet(key, null));
        });

        return {
            gmAvailable: typeof GM_getValue === 'function',
            gmListValuesAvailable: typeof GM_listValues === 'function',
            keyInventoryMode: gmKeys ? 'complete' : 'limited_without_GM_listValues',
            knownValues: valeursConnues,
            transferJobs,
            contextJobs,
            gmEvents: evenementsGm.slice(-30)
        };
    }

    function causesProbables(checks, stockage) {
        const causes = [];
        const parId = {};
        checks.forEach(check => { parId[check.id] = check; });

        checks
            .filter(check => check.critical && !check.ok)
            .forEach(check => causes.push({
                severity: 'critical',
                check: check.id,
                message: check.label + ' introuvable. Selecteur ou structure probablement modifiee.',
                selector: check.selector || null
            }));

        if (EST_HEIDI && parId['heidi.last_weda_url'] && !parId['heidi.last_weda_url'].ok) {
            causes.push({
                severity: 'critical',
                check: 'heidi.last_weda_url',
                message: 'Aucun patient WEDA memorise. Ouvrir/focaliser WEDA sur le patient puis relancer PageUp.'
            });
        }

        if (EST_WEDA && parId['weda.patient_context'] && !parId['weda.patient_context'].ok) {
            causes.push({
                severity: 'critical',
                check: 'weda.patient_context',
                message: 'La page WEDA courante ne contient pas de PatDk patient reconnu.'
            });
        }

        if (stockage.keyInventoryMode === 'limited_without_GM_listValues') {
            causes.push({
                severity: 'info',
                check: 'gm_list_values',
                message: 'Ajouter @grant GM_listValues pour lister automatiquement les jobs de transfert/contexte.'
            });
        }

        stockage.transferJobs
            .filter(job => job && job.status === 'error')
            .forEach(job => causes.push({
                severity: 'critical',
                check: 'transfer_job',
                message: 'Un job de transfert est en erreur : ' + (job.message || job.key),
                job: job
            }));

        stockage.contextJobs
            .filter(job => job && job.status === 'error')
            .forEach(job => causes.push({
                severity: 'critical',
                check: 'context_job',
                message: 'Un job contexte est en erreur : ' + (job.message || job.key),
                job: job
            }));

        if (erreursCapturees.length > 0) {
            causes.push({
                severity: 'warning',
                check: 'browser_errors',
                message: erreursCapturees.length + ' erreur(s) JavaScript capturee(s) depuis le chargement du module debug.'
            });
        }

        return causes;
    }

    async function runDiagnostics(options) {
        const opts = options || {};
        const checks = EST_HEIDI ? diagnosticsHeidi() : diagnosticsWeda();
        const stockage = diagnosticsStockage();
        const missingCritical = checks.filter(check => check.critical && !check.ok);
        const missingOptional = checks.filter(check => !check.critical && !check.ok);
        const causes = causesProbables(checks, stockage);

        const rapport = {
            debugVersion: DEBUG_VERSION,
            generatedAt: maintenantIso(),
            environment: {
                host: HOST,
                href: location.href,
                topHref: getTopHref(),
                topFrame: isTopFrame(),
                visibilityState: safe(() => document.visibilityState, null),
                isWeda: EST_WEDA,
                isHeidi: EST_HEIDI,
                userAgent: navigator.userAgent
            },
            summary: {
                ok: missingCritical.length === 0,
                checksTotal: checks.length,
                missingCritical: missingCritical.length,
                missingOptional: missingOptional.length,
                transferJobs: stockage.transferJobs.length,
                contextJobs: stockage.contextJobs.length,
                capturedErrors: erreursCapturees.length
            },
            checks,
            probableCauses: causes,
            storage: stockage,
            capturedErrors: erreursCapturees.slice(-30)
        };

        dernierRapport = rapport;
        safe(() => { window.AUTO_HH_DEBUG_LAST_REPORT = rapport; }, null);
        gmSet(CLE_DEBUG_LAST_REPORT, rapport);

        if (!opts.silent) imprimerRapportConsole(rapport);
        return rapport;
    }

    function imprimerRapportConsole(rapport) {
        try {
            console.group('[AUTO-HH DEBUG] Rapport diagnostic ' + rapport.generatedAt);
            console.info('[AUTO-HH DEBUG] Resume :', rapport.summary);
            console.table(rapport.checks.map(check => ({
                ok: check.ok,
                critical: check.critical,
                id: check.id,
                label: check.label,
                count: check.count,
                visible: check.visibleCount,
                selector: check.selector,
                note: check.note
            })));
            if (rapport.probableCauses.length) console.table(rapport.probableCauses.map(cause => ({
                severity: cause.severity,
                check: cause.check,
                message: cause.message,
                selector: cause.selector || ''
            })));
            if (rapport.storage.transferJobs.length) console.table(rapport.storage.transferJobs);
            if (rapport.storage.contextJobs.length) console.table(rapport.storage.contextJobs);
            console.info('[AUTO-HH DEBUG] Rapport complet :', rapport);
            console.groupEnd();
        } catch (e) {}
    }

    function couleurStatut(ok) {
        return ok ? '#137333' : '#b3261e';
    }

    function severiteCouleur(severity) {
        if (severity === 'critical') return '#b3261e';
        if (severity === 'warning') return '#9a6700';
        return '#185abc';
    }

    function creerLigneCheck(check) {
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td style="padding:6px 8px;color:' + couleurStatut(check.ok) + ';font-weight:700">' + (check.ok ? 'OK' : 'KO') + '</td>' +
            '<td style="padding:6px 8px">' + escapeHtml(check.label) + '</td>' +
            '<td style="padding:6px 8px;text-align:right">' + check.count + '</td>' +
            '<td style="padding:6px 8px;text-align:right">' + check.visibleCount + '</td>' +
            '<td style="padding:6px 8px;font-family:Consolas,monospace;font-size:12px">' + escapeHtml(check.selector || check.id) + '</td>';
        return tr;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function showPanel() {
        const rapport = await runDiagnostics({ silent: true });

        let overlay = document.getElementById('auto-hh-debug-panel');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'auto-hh-debug-panel';
        overlay.style.position = 'fixed';
        overlay.style.inset = '24px 24px auto auto';
        overlay.style.width = 'min(980px, calc(100vw - 48px))';
        overlay.style.maxHeight = 'calc(100vh - 48px)';
        overlay.style.overflow = 'auto';
        overlay.style.zIndex = '2147483647';
        overlay.style.background = '#ffffff';
        overlay.style.color = '#1f1f1f';
        overlay.style.border = '1px solid #d0d7de';
        overlay.style.borderRadius = '10px';
        overlay.style.boxShadow = '0 12px 40px rgba(0,0,0,0.24)';
        overlay.style.fontFamily = 'Arial, sans-serif';
        overlay.style.fontSize = '13px';

        const causesHtml = rapport.probableCauses.length
            ? rapport.probableCauses.map(cause =>
                '<div style="margin:6px 0;padding:8px 10px;border-left:4px solid ' + severiteCouleur(cause.severity) + ';background:#f6f8fa">' +
                    '<strong>' + escapeHtml(cause.severity.toUpperCase()) + '</strong> ' +
                    escapeHtml(cause.message) +
                    (cause.selector ? '<div style="font-family:Consolas,monospace;font-size:12px;margin-top:4px">' + escapeHtml(cause.selector) + '</div>' : '') +
                '</div>'
            ).join('')
            : '<div style="padding:8px 10px;background:#ecfdf3;border-left:4px solid #137333">Aucune cause critique evidente detectee.</div>';

        overlay.innerHTML =
            '<div style="position:sticky;top:0;background:#0b2a4a;color:white;padding:12px 14px;display:flex;align-items:center;gap:10px;z-index:1">' +
                '<div style="font-weight:700;font-size:15px;flex:1">AUTO-HH diagnostic</div>' +
                '<button type="button" data-action="rerun" style="border:0;border-radius:6px;padding:7px 10px;background:#ffffff;color:#0b2a4a;font-weight:700;cursor:pointer">Relancer</button>' +
                '<button type="button" data-action="copy" style="border:0;border-radius:6px;padding:7px 10px;background:#ffffff;color:#0b2a4a;font-weight:700;cursor:pointer">Copier JSON</button>' +
                '<button type="button" data-action="close" style="border:0;border-radius:6px;padding:7px 10px;background:#ffffff;color:#0b2a4a;font-weight:700;cursor:pointer">Fermer</button>' +
            '</div>' +
            '<div style="padding:14px">' +
                '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px">' +
                    metricHtml('Etat', rapport.summary.ok ? 'OK' : 'A verifier', rapport.summary.ok ? '#137333' : '#b3261e') +
                    metricHtml('Critiques KO', String(rapport.summary.missingCritical), rapport.summary.missingCritical ? '#b3261e' : '#137333') +
                    metricHtml('Jobs transfert', String(rapport.summary.transferJobs), '#185abc') +
                    metricHtml('Jobs contexte', String(rapport.summary.contextJobs), '#185abc') +
                '</div>' +
                '<div style="margin-bottom:12px;line-height:1.45">' +
                    '<strong>Page :</strong> ' + escapeHtml(rapport.environment.host) +
                    '<br><strong>URL :</strong> <span style="font-family:Consolas,monospace;font-size:12px">' + escapeHtml(texteCourt(rapport.environment.topHref, 180)) + '</span>' +
                    '<br><strong>Inventaire GM :</strong> ' + escapeHtml(rapport.storage.keyInventoryMode) +
                '</div>' +
                '<h3 style="font-size:14px;margin:14px 0 8px">Causes probables</h3>' +
                causesHtml +
                '<h3 style="font-size:14px;margin:14px 0 8px">Selecteurs et points de controle</h3>' +
                '<table style="width:100%;border-collapse:collapse;border:1px solid #d0d7de">' +
                    '<thead><tr style="background:#f6f8fa">' +
                        '<th style="text-align:left;padding:6px 8px">Etat</th>' +
                        '<th style="text-align:left;padding:6px 8px">Controle</th>' +
                        '<th style="text-align:right;padding:6px 8px">Trouves</th>' +
                        '<th style="text-align:right;padding:6px 8px">Visibles</th>' +
                        '<th style="text-align:left;padding:6px 8px">Selecteur</th>' +
                    '</tr></thead>' +
                    '<tbody></tbody>' +
                '</table>' +
            '</div>';

        const tbody = overlay.querySelector('tbody');
        rapport.checks
            .slice()
            .sort((a, b) => Number(b.critical) - Number(a.critical) || Number(a.ok) - Number(b.ok) || a.id.localeCompare(b.id))
            .forEach(check => tbody.appendChild(creerLigneCheck(check)));

        overlay.addEventListener('click', async event => {
            const bouton = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
            if (!bouton) return;
            const action = bouton.getAttribute('data-action');
            if (action === 'close') overlay.remove();
            if (action === 'rerun') showPanel();
            if (action === 'copy') {
                const ok = await copierRapport();
                afficherBadgeDebug(ok ? 'AUTO-HH debug : rapport copie' : 'AUTO-HH debug : copie impossible', ok ? 2500 : 5000);
            }
        });

        document.body.appendChild(overlay);
        return rapport;
    }

    function metricHtml(label, value, color) {
        return '<div style="border:1px solid #d0d7de;border-radius:8px;padding:10px;background:#f6f8fa">' +
            '<div style="font-size:12px;color:#57606a">' + escapeHtml(label) + '</div>' +
            '<div style="font-weight:700;color:' + color + ';font-size:18px;margin-top:2px">' + escapeHtml(value) + '</div>' +
        '</div>';
    }

    async function copierRapport(report) {
        const rapport = report || dernierRapport || await runDiagnostics({ silent: true });
        const texte = JSON.stringify(rapport, null, 2);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(texte);
                return true;
            } catch (e) {
                return false;
            }
        }

        return safe(() => {
            const textarea = document.createElement('textarea');
            textarea.value = texte;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            textarea.remove();
            return ok;
        }, false);
    }

    function afficherBadgeDebug(message, duree) {
        if (!isTopFrame() || !document.body) return;

        let badge = document.getElementById('auto-hh-debug-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'auto-hh-debug-badge';
            badge.style.position = 'fixed';
            badge.style.right = '24px';
            badge.style.bottom = '24px';
            badge.style.zIndex = '2147483647';
            badge.style.background = '#3b2f00';
            badge.style.color = '#ffffff';
            badge.style.padding = '12px 16px';
            badge.style.borderRadius = '10px';
            badge.style.font = '700 14px Arial, sans-serif';
            badge.style.boxShadow = '0 8px 24px rgba(0,0,0,0.28)';
            badge.style.pointerEvents = 'none';
            document.body.appendChild(badge);
        }

        badge.textContent = String(message || '');
        badge.style.display = 'block';

        if (timerBadge) clearTimeout(timerBadge);
        timerBadge = setTimeout(() => {
            try { badge.remove(); } catch (e) {}
            timerBadge = null;
        }, duree || 3500);
    }

    async function startWatch(intervalMs) {
        stopWatch();
        const delai = Math.max(2000, Number(intervalMs || 5000));
        timerWatch = setInterval(async () => {
            const rapport = await runDiagnostics({ silent: true });
            if (!rapport.summary.ok) {
                afficherBadgeDebug('AUTO-HH debug : ' + rapport.summary.missingCritical + ' point(s) critique(s) KO', 3500);
            }
        }, delai);
        afficherBadgeDebug('AUTO-HH debug : surveillance active', 2500);
        return true;
    }

    function stopWatch() {
        if (timerWatch) clearInterval(timerWatch);
        timerWatch = null;
        return true;
    }

    function capturerErreur(type, payload) {
        erreursCapturees.push(Object.assign({
            type,
            timestamp: maintenantIso(),
            href: location.href
        }, payload || {}));
        while (erreursCapturees.length > 50) erreursCapturees.shift();
    }

    function enregistrerEvenementGm(key, oldValue, newValue) {
        evenementsGm.push({
            timestamp: maintenantIso(),
            key,
            oldValue: resumerValeur(oldValue),
            newValue: resumerValeur(newValue)
        });
        while (evenementsGm.length > 50) evenementsGm.shift();
    }

    function installerEcouteurs() {
        window.addEventListener('error', event => {
            capturerErreur('error', {
                message: event.message,
                source: event.filename,
                line: event.lineno,
                column: event.colno,
                stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 2000) : null
            });
        }, true);

        window.addEventListener('unhandledrejection', event => {
            const reason = event.reason;
            capturerErreur('unhandledrejection', {
                message: reason && reason.message ? reason.message : String(reason),
                stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : null
            });
        }, true);

        if (typeof GM_addValueChangeListener === 'function') {
            [
                CLE_SIGNAL,
                CLE_LAST_WEDA_URL,
                CLE_SESSION_JOB,
                CLE_SESSION_CONTEXT_JOB,
                CLE_NOTIFICATION,
                CLE_LAST_REPORT,
                CLE_WEDA_ACTIVE_SNAPSHOT
            ].forEach(key => {
                safe(() => {
                    GM_addValueChangeListener(key, (_name, oldValue, newValue) => {
                        enregistrerEvenementGm(key, oldValue, newValue);
                    });
                }, null);
            });
        }

        window.addEventListener('keydown', event => {
            if (!event.ctrlKey || !event.altKey) return;
            const key = String(event.key || '').toLowerCase();
            if (key !== 'd') return;
            event.preventDefault();
            event.stopPropagation();
            showPanel();
        }, true);
    }

    const api = {
        version: DEBUG_VERSION,
        run: runDiagnostics,
        show: showPanel,
        copy: copierRapport,
        watch: startWatch,
        stopWatch,
        last: () => dernierRapport,
        errors: () => erreursCapturees.slice(),
        gmEvents: () => evenementsGm.slice()
    };

    installerEcouteurs();

    safe(() => {
        window.AUTO_HH_DEBUG = api;
        window.AUTO_HH_DIAGNOSTIC = showPanel;
        if (typeof unsafeWindow !== 'undefined') {
            unsafeWindow.AUTO_HH_DEBUG = api;
            unsafeWindow.AUTO_HH_DIAGNOSTIC = showPanel;
        }
    }, null);

    console.info('[AUTO-HH DEBUG] Module charge', {
        version: DEBUG_VERSION,
        host: HOST,
        weda: EST_WEDA,
        heidi: EST_HEIDI,
        raccourci: 'Ctrl+Alt+D',
        gmListValues: typeof GM_listValues === 'function'
    });
})();
