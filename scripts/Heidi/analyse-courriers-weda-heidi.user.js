// ==UserScript==
// @name         Weda - Analyse courriers PDF avec Heidi Contexte
// @namespace    https://secure.weda.fr/
// @version      1.0.1
// @description  Analyse les courriers PDF de Weda Échanges avec Heidi puis renseigne le titre du document.
// @match        https://secure.weda.fr/FolderMedical/WedaEchanges*
// @match        https://secure.weda.fr/FolderMedical/WedaEchanges/*
// @match        https://scribe.heidihealth.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      secure.weda.fr
// @connect      message.weda.fr
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const WEDA_HOST = "secure.weda.fr";
  const WEDA_PATH_PREFIX = "/FolderMedical/WedaEchanges";
  const HEIDI_HOST = "scribe.heidihealth.com";
  const HEIDI_URL = "https://scribe.heidihealth.com/";
  const DOCUMENT_SIGNAL = "COURRIER MÉDICAL À SYNTHÉTISER CI-DESSOUS";
  const BIOLOGY_SIGNAL = DOCUMENT_SIGNAL;
  const SCRIPT_VERSION = "1.0.1";
  const PDFJS_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const MAX_PDF_TEXT_LENGTH = 70000;

  const STORAGE_PREFIX = "wedaCourrierHeidiContext.";
  const STATE_KEY = `${STORAGE_PREFIX}state`;
  const JOB_KEY = `${STORAGE_PREFIX}job`;
  const RESULT_KEY = `${STORAGE_PREFIX}result`;
  const CANCEL_KEY = `${STORAGE_PREFIX}cancel`;
  const STATUS_KEY = `${STORAGE_PREFIX}status`;
  const DEBUG_LOG_KEY = `${STORAGE_PREFIX}debugLog.v1`;
  const TITLES_KEY = `${STORAGE_PREFIX}rememberedTitles.v1`;
  const AUTO_SEEN_ROWS_KEY = `${STORAGE_PREFIX}autoSeenRows.v1`;
  const HEIDI_COURRIER_TAB_ROLE_KEY = `${STORAGE_PREFIX}heidiTabRole`;
  const HEIDI_COURRIER_SESSION_ID_KEY = `${STORAGE_PREFIX}heidiSessionId`;
  const HEIDI_COURRIER_SESSION_URL_KEY = `${STORAGE_PREFIX}heidiSessionUrl`;
  const HEIDI_COURRIER_SESSION_PHASE_KEY = `${STORAGE_PREFIX}heidiSessionPhase`;

  const PANEL_ID = "weda-courrier-heidi-context-panel";
  const PANEL_POSITION_MARGIN_PX = 8;
  const STATUS_ID = "weda-courrier-heidi-context-status";
  const DEBUG_LOG_PANEL_ID = "weda-courrier-heidi-context-log-panel";
  const DEBUG_LOG_TEXTAREA_ID = "weda-courrier-heidi-context-log-textarea";
  const MESSAGE_LIST_SELECTOR = "#messageList";
  const MESSAGE_ROW_SELECTOR = "#messageList > div.messageListItem";
  const PDF_EMBED_SELECTOR = [
    "#messageContainer div.mssAttachment embed[src*='downloadAttachment']",
    "#messageContainer div.mssAttachment embed[src*='application%2Fpdf']",
    "#messageContainer div.mssAttachment iframe[type='application/pdf']",
    "#container #plugin",
    "embed#plugin",
    "embed[type='application/x-google-chrome-pdf']",
    "embed[type*='pdf']",
    "embed[src*='downloadAttachment']",
    "embed[src*='application%2Fpdf']",
    "iframe[type='application/pdf']",
    "pdf-viewer embed#plugin",
    "pdf-viewer embed[type*='pdf']",
  ].join(", ");
  const DOC_TITLE_PRIMARY_SELECTOR = [
    "#messageContainer > div.messageAttachment.flexColStart.ng-star-inserted > we-doc-import > div > div:nth-child(1) > div.flexCol.ml10.flex1 > input",
    "#messageContainer > div.messageAttachment.flexColStart > we-doc-import > div > div:nth-child(1) > div.flexCol.ml10.flex1 > input",
  ].join(", ");
  const DOC_TITLE_FALLBACK_SELECTOR = "input.docTitle";
  const IMPORT_MESSAGE_SELECTOR = "#messageContainer > div.docImportBody.mt10.flexColStart.ng-star-inserted > div.flexColStart.mt10.width100.ng-star-inserted > div.mt5.flexRow.ng-star-inserted > div > table > tr.ng-star-inserted > td:nth-child(5) > a";
  const IMPORT_PATIENT_SELECTOR = "#messageContainer > div.docImportBody.mt10.flexColStart > div > div.btnImport.importPatient.targetSupprimer, #messageContainer .btnImport.importPatient.targetSupprimer";
  const PDF_PARSER_RESET_SELECTOR = "#pdfParserResetButton";
  const AUTO_INTERVAL_MS = 15 * 60 * 1000;
  const AUTO_HEARTBEAT_MS = 60 * 1000;
  const AUTO_STALE_RUNNING_MS = 10 * 60 * 1000;
  const AUTO_GRID_WAIT_MS = 45000;
  const PDF_DISPLAY_WAIT_MS = 15000;
  const PDF_PERFORMANCE_FALLBACK_SETTLE_MS = 1800;
  const PDF_EMPTY_TEXT_RETRY_MS = 12000;
  const PDF_EMPTY_TEXT_RETRY_INTERVAL_MS = 900;
  const PDF_MIN_TEXT_LENGTH = 20;
  const TITLE_INPUT_WAIT_AFTER_IMPORT_MS = 3500;
  const TITLE_INPUT_WAIT_AFTER_PATIENT_MS = 10000;
  const TITLE_PRIORITY_WATCH_INTERVAL_MS = 700;
  const PATIENT_IMPORT_SETTLE_MS = 800;
  const WEDA_ROW_OPEN_RETRY_DELAYS_MS = [3500, 9000];
  const NEXT_AFTER_SAVE_MS = 4200;
  const NEXT_AFTER_RELOAD_SAVE_MS = 2500;
  const TITLE_STABILITY_GUARD_MS = 11000;
  const TITLE_STABILITY_CHECK_INTERVAL_MS = 500;
  const TITLE_STABILITY_REOPEN_INPUT_AFTER_MS = 1500;
  const NEXT_AFTER_TITLE_STABLE_MS = 450;
  const PDF_FETCH_RETRY_MS = 15000;
  const PDF_FETCH_RETRY_INTERVAL_MS = 900;
  const HEIDI_ANSWER_STABLE_WITH_COPY_MS = 1000;
  const HEIDI_ANSWER_STABLE_WITHOUT_COPY_MS = 2800;
  const HEIDI_ANSWER_STABLE_WITH_STUCK_THINKING_MS = 7000;
  const HEIDI_FOCUS_IF_HIDDEN_AFTER_MS = 5000;
  const HEIDI_RELAUNCH_IF_STUCK_AFTER_MS = 14000;
  const HEIDI_RELAUNCH_COOLDOWN_MS = 16000;
  const HEIDI_MAX_RELAUNCHES = 2;
  const HEIDI_WORKERS_OPEN_IN_BACKGROUND = false;
  const HEIDI_CONTEXT_MAX_ATTEMPTS = 10;
  const HEIDI_CONTEXT_RETRY_MS = 900;
  const HEIDI_CONTEXT_FOREGROUND_FALLBACK_AFTER_ATTEMPT = 2;
  const HEIDI_CONTEXT_ACTIVATE_TIMEOUT_MS = 4500;
  const HEIDI_STARTUP_WATCHDOG_MS = 14000;
  const HEIDI_STARTUP_MAX_REOPENS = 2;
  const HEIDI_CONTEXT_VISIBLE_SETTLE_MS = 1800;
  const HEIDI_CONTEXT_HIDDEN_SETTLE_MS = 8000;
  const MAX_REMEMBERED_TITLES = 5000;
  const REMEMBERED_TITLE_TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const MAX_AUTO_SEEN_ROWS = 1000;
  const MAX_DEBUG_LOG_ENTRIES = 800;

  let titleAutofillInterval = null;
  let titleAutofillInputOpening = false;
  let autoRefreshTimer = null;
  let autoHeartbeatTimer = null;
  let currentHeidiTab = null;
  let heidiForegroundFallbackUsed = false;
  let patientImportBeforePdfStableKey = "";
  let lastPatientImportPerformanceStartTime = 0;

  const HEIDI_PROMPT_ACTIVE = `Rôle : médecin généraliste en France.

Objectif : synthétiser un courrier médical, compte rendu de consultation spécialisée ou résultat d’examen transmis par un confrère en une seule phrase très courte, pertinente et directement utilisable dans le dossier médical.

Consignes :
- Répondre en français.
- Faire une seule phrase, sur une seule ligne.
- Ne pas faire de titre, de puces, d’introduction ni de conclusion.
- Ne jamais inventer d’information absente du document.
- Ne pas mentionner la date du courrier.
- Ne pas reprendre les formules de politesse, l’identité du patient, l’adresse, les coordonnées, les détails administratifs ou les éléments non utiles au suivi médical.
- Extraire uniquement l’information médicale utile pour le suivi en médecine générale.
- Mentionner le résultat principal de la consultation, de l’examen ou du courrier de façon très concise.
- Mentionner uniquement si présent : CAT, ttt modifié, examen demandé, surveillance, contrôle ou suivi prévu.
- Si aucune CAT n’est mentionnée, ne rien ajouter.
- Style médical télégraphique, très compact.
- Utiliser le maximum d’abréviations médicales usuelles.
- Abréger la spécialité ou le type d’avis si utile :
  - HGE = hépato-gastro-entérologie
  - Uro = urologie
  - Cardio = cardiologie
  - Pneumo = pneumologie
  - ORL = oto-rhino-laryngologie
  - Ophtalmo = ophtalmologie
  - Gynéco = gynécologie
  - Dermato = dermatologie
  - Rhumato = rhumatologie
  - Neuro = neurologie
  - Psy = psychiatrie
  - Endoc = endocrinologie
  - Néphro = néphrologie
  - Chir = chirurgie
  - Radio = radiologie
  - Bio = biologie
- Conserver seulement les diagnostics, résultats anormaux, traitements, posologies, examens demandés et délais de suivi réellement utiles.
- Supprimer les détails secondaires, les valeurs normales non utiles et les répétitions.
- Ne pas écrire “le confrère indique que”, “courrier reçu”, “compte rendu de”, sauf nécessité absolue.
- Préférer les formats courts : “Cardio : ETT RAS, poursuite ttt, contrôle 1 an.” plutôt que phrase longue.
- Ne pas dépasser une phrase courte.

Format attendu :
Spé abrégée ou examen si utile : résultat principal ; CAT / ttt / suivi si mentionné.`;
  const HEIDI_PROMPT = HEIDI_PROMPT_ACTIVE;

  const isWedaPage = location.hostname === WEDA_HOST && location.pathname.toLowerCase().startsWith(WEDA_PATH_PREFIX.toLowerCase());
  const isHeidiPage = location.hostname === HEIDI_HOST;

  if (isWedaPage) {
    initWeda();
  }

  if (isHeidiPage) {
    initHeidi();
  }

  function initWeda() {
    createWedaPanel();
    syncPanelWithState();
    appendDebugLog("weda:init", {
      version: getScriptVersion(),
      hasMessageList: Boolean(document.querySelector(MESSAGE_LIST_SELECTOR)),
    });

    GM_addValueChangeListener(RESULT_KEY, (_name, _oldValue, result) => {
      if (result) {
        handleHeidiResult(result);
      }
    });

    GM_addValueChangeListener(STATUS_KEY, (_name, _oldValue, status) => {
      const state = getState();
      if (status && status.jobId === state.currentJobId) {
        appendDebugLog("weda:heidi-status-received", {
          jobId: status.jobId,
          message: status.message,
          action: status.action || "",
        });
        setPanelStatus(status.message);
        if (status.action === "focusWeda") {
          try {
            window.focus();
          } catch (_error) {
            // Le navigateur peut refuser le focus programmatique.
          }
        }
      }
    });

    GM_addValueChangeListener(DEBUG_LOG_KEY, () => {
      renderDebugLogs();
    });

    const existingResult = GM_getValue(RESULT_KEY, null);
    if (existingResult) {
      window.setTimeout(() => handleHeidiResult(existingResult), 250);
    }

    const state = getState();
    if (state.running) {
      window.setTimeout(() => resumeWedaWorkflow(), 700);
    }

    setupRememberedTitleAutofill();
    window.setTimeout(() => applyRememberedTitleForSelectedRow({ autoSave: true }), 900);
    setupAutoHeartbeat();
    handleAutoOnLoad();
  }

  function createWedaPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="wbh-header" id="wbh-drag-handle" title="Glisser pour déplacer le module. Double-clic : position initiale.">
        <div class="wbh-drag-icon" aria-hidden="true">↕</div>
        <div class="wbh-title">Analyse courriers Heidi contexte</div>
        <div class="wbh-version">v${SCRIPT_VERSION}</div>
        <button type="button" id="wbh-collapse" title="Réduire le module" aria-label="Réduire le module">↘</button>
      </div>
      <div class="wbh-body">
        <button type="button" id="wbh-start">ANALYSE COURRIERS PDF</button>
        <button type="button" id="wbh-auto">MODE AUTO 15 MIN</button>
        <button type="button" id="wbh-clear-memory">Effacer mémoire</button>
        <button type="button" id="wbh-show-logs">Logs</button>
        <button type="button" id="wbh-copy-logs">Copier logs</button>
        <button type="button" id="wbh-stop">Arrêter</button>
        <div id="${STATUS_ID}">Prêt.</div>
        <div id="${DEBUG_LOG_PANEL_ID}" hidden>
          <textarea id="${DEBUG_LOG_TEXTAREA_ID}" readonly></textarea>
          <button type="button" id="wbh-clear-logs">Effacer logs</button>
        </div>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 999999;
        width: 285px;
        padding: 12px;
        border: 1px solid #9fb7e8;
        border-radius: 8px;
        background: #f7faff;
        box-shadow: 0 8px 26px rgba(20, 42, 90, 0.22);
        color: #14264a;
        font-family: Arial, sans-serif;
        font-size: 13px;
        box-sizing: border-box;
        transition: width 160ms ease, padding 160ms ease, border-radius 160ms ease, background 160ms ease;
      }
      #${PANEL_ID} .wbh-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        cursor: move;
        user-select: none;
      }
      #${PANEL_ID} .wbh-drag-icon {
        flex: 0 0 auto;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(23, 78, 166, 0.12);
        color: #174ea6;
        font-size: 13px;
        font-weight: 900;
        line-height: 1;
      }
      #${PANEL_ID} .wbh-title {
        flex: 1;
        font-weight: 700;
      }
      #${PANEL_ID} .wbh-version {
        flex: 0 0 auto;
        border: 1px solid #b9c7e6;
        border-radius: 999px;
        padding: 3px 7px;
        background: #ffffff;
        color: #174ea6;
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
        white-space: nowrap;
      }
      #${PANEL_ID} button {
        margin: 0 6px 8px 0;
        border: 1px solid #6d8bd4;
        border-radius: 6px;
        padding: 7px 9px;
        background: #174ea6;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
      }
      #${PANEL_ID} #wbh-collapse {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        margin: 0;
        border-radius: 999px;
        padding: 0;
        line-height: 1;
        font-size: 15px;
      }
      #${PANEL_ID}.wbh-collapsed {
        width: auto;
        padding: 5px;
        border-color: #174ea6;
        border-radius: 999px;
        background: #174ea6;
      }
      #${PANEL_ID}.wbh-collapsed .wbh-header {
        margin-bottom: 0;
      }
      #${PANEL_ID}.wbh-collapsed .wbh-title,
      #${PANEL_ID}.wbh-collapsed .wbh-version,
      #${PANEL_ID}.wbh-collapsed .wbh-drag-icon,
      #${PANEL_ID}.wbh-collapsed .wbh-body {
        display: none;
      }
      #${PANEL_ID}.wbh-collapsed #wbh-collapse {
        width: 34px;
        height: 34px;
        border-color: #174ea6;
        background: #174ea6;
        color: #fff;
      }
      #${PANEL_ID} #wbh-stop {
        background: #fff;
        color: #174ea6;
      }
      #${PANEL_ID} #wbh-clear-memory {
        background: #fff;
        border-color: #b91c1c;
        color: #b91c1c;
      }
      #${PANEL_ID} #wbh-show-logs,
      #${PANEL_ID} #wbh-copy-logs,
      #${PANEL_ID} #wbh-clear-logs {
        background: #fff;
        border-color: #475569;
        color: #334155;
      }
      #${PANEL_ID} #wbh-auto {
        background: #0f766e;
        border-color: #0f766e;
      }
      #${PANEL_ID} #wbh-auto.wbh-auto-on {
        background: #a74400;
        border-color: #a74400;
      }
      #${PANEL_ID} button:disabled {
        opacity: 0.55;
        cursor: default;
      }
      #${STATUS_ID} {
        min-height: 34px;
        line-height: 1.35;
        color: #293957;
      }
      #${DEBUG_LOG_PANEL_ID} {
        margin-top: 8px;
      }
      #${DEBUG_LOG_TEXTAREA_ID} {
        width: 100%;
        height: 190px;
        box-sizing: border-box;
        border: 1px solid #b9c7e6;
        border-radius: 6px;
        padding: 6px;
        resize: vertical;
        font-family: Consolas, "Courier New", monospace;
        font-size: 11px;
        line-height: 1.35;
        color: #111827;
        background: #fff;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById("wbh-collapse").addEventListener("click", toggleWedaPanelCollapsed);
    document.getElementById("wbh-start").addEventListener("click", startWedaWorkflow);
    document.getElementById("wbh-auto").addEventListener("click", toggleAutoMode);
    document.getElementById("wbh-clear-memory").addEventListener("click", clearRememberedTitles);
    document.getElementById("wbh-show-logs").addEventListener("click", toggleDebugLogPanel);
    document.getElementById("wbh-copy-logs").addEventListener("click", copyDebugLogs);
    document.getElementById("wbh-clear-logs").addEventListener("click", clearDebugLogs);
    document.getElementById("wbh-stop").addEventListener("click", stopWedaWorkflow);
    setupWedaPanelDrag();
    applyWedaPanelPosition(getState().panelPosition);
  }

  function setupWedaPanelDrag() {
    const panel = document.getElementById(PANEL_ID);
    const handle = document.getElementById("wbh-drag-handle");

    if (!panel || !handle) {
      return;
    }

    let dragging = false;
    let startClientX = 0;
    let startClientY = 0;
    let startLeft = 0;
    let startTop = 0;
    let lastPosition = null;

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }

      event.preventDefault();
      const nextPosition = getSafePanelPosition(
        startLeft + event.clientX - startClientX,
        startTop + event.clientY - startClientY
      );
      lastPosition = nextPosition;
      applyWedaPanelPosition(nextPosition);
    };

    const onPointerUp = (event) => {
      if (!dragging) {
        return;
      }

      event.preventDefault();
      dragging = false;
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.body.style.userSelect = "";

      if (lastPosition) {
        setState({
          panelPosition: lastPosition,
        });
      }
    };

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      if (event.target && event.target.closest && event.target.closest("button, a, input, textarea, select")) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      dragging = true;
      startClientX = event.clientX;
      startClientY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      lastPosition = getSafePanelPosition(startLeft, startTop);

      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerup", onPointerUp, true);
      document.body.style.userSelect = "none";

      try {
        handle.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Le suivi global document suffit si setPointerCapture est indisponible.
      }

      event.preventDefault();
    }, true);

    handle.addEventListener("dblclick", (event) => {
      if (event.target && event.target.closest && event.target.closest("button")) {
        return;
      }

      setState({
        panelPosition: null,
      });
      event.preventDefault();
    }, true);

    window.addEventListener("resize", () => {
      const state = getState();
      if (state.panelPosition) {
        const safePosition = getSafePanelPosition(state.panelPosition.left, state.panelPosition.top);
        if (safePosition.left !== state.panelPosition.left || safePosition.top !== state.panelPosition.top) {
          setState({ panelPosition: safePosition });
        } else {
          applyWedaPanelPosition(safePosition);
        }
      }
    });
  }

  function getSafePanelPosition(left, top) {
    const panel = document.getElementById(PANEL_ID);
    const rect = panel ? panel.getBoundingClientRect() : { width: 285, height: 120 };
    const panelWidth = Math.max(40, rect.width || 285);
    const panelHeight = Math.max(34, rect.height || 120);
    const maxLeft = Math.max(PANEL_POSITION_MARGIN_PX, window.innerWidth - panelWidth - PANEL_POSITION_MARGIN_PX);
    const maxTop = Math.max(PANEL_POSITION_MARGIN_PX, window.innerHeight - panelHeight - PANEL_POSITION_MARGIN_PX);

    return {
      left: Math.min(Math.max(PANEL_POSITION_MARGIN_PX, Math.round(Number(left) || 0)), maxLeft),
      top: Math.min(Math.max(PANEL_POSITION_MARGIN_PX, Math.round(Number(top) || 0)), maxTop),
    };
  }

  function applyWedaPanelPosition(position) {
    const panel = document.getElementById(PANEL_ID);

    if (!panel) {
      return;
    }

    if (!position || !Number.isFinite(Number(position.left)) || !Number.isFinite(Number(position.top))) {
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "18px";
      panel.style.bottom = "18px";
      return;
    }

    const safePosition = getSafePanelPosition(position.left, position.top);
    panel.style.left = safePosition.left + "px";
    panel.style.top = safePosition.top + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function syncPanelWithState() {
    const state = getState();
    const startButton = document.getElementById("wbh-start");
    const autoButton = document.getElementById("wbh-auto");
    const stopButton = document.getElementById("wbh-stop");

    applyWedaPanelCollapsed(Boolean(state.panelCollapsed));
    applyWedaPanelPosition(state.panelPosition);

    if (startButton) {
      startButton.disabled = Boolean(state.running);
    }

    if (autoButton) {
      autoButton.textContent = state.autoEnabled ? "DÉSACTIVER AUTO" : "MODE AUTO 15 MIN";
      autoButton.classList.toggle("wbh-auto-on", Boolean(state.autoEnabled));
      autoButton.disabled = false;
    }

    if (stopButton) {
      stopButton.disabled = !state.running;
    }

    if (state.message) {
      setPanelStatus(state.message);
    }
  }

  function toggleWedaPanelCollapsed() {
    const state = getState();
    setState({
      panelCollapsed: !state.panelCollapsed,
    });
  }

  function applyWedaPanelCollapsed(collapsed) {
    const panel = document.getElementById(PANEL_ID);
    const button = document.getElementById("wbh-collapse");

    if (!panel || !button) {
      return;
    }

    panel.classList.toggle("wbh-collapsed", collapsed);
    button.textContent = collapsed ? "↖" : "↘";
    button.title = collapsed ? "Déployer le module" : "Réduire le module";
    button.setAttribute("aria-label", button.title);
  }

  function setPanelStatus(message) {
    const status = document.getElementById(STATUS_ID);
    if (status) {
      status.textContent = message;
    }
  }

  function toggleDebugLogPanel() {
    const panel = document.getElementById(DEBUG_LOG_PANEL_ID);
    const button = document.getElementById("wbh-show-logs");

    if (!panel) {
      return;
    }

    panel.hidden = !panel.hidden;
    if (button) {
      button.textContent = panel.hidden ? "Logs" : "Masquer logs";
    }

    if (!panel.hidden) {
      renderDebugLogs();
    }
  }

  function renderDebugLogs() {
    const textarea = document.getElementById(DEBUG_LOG_TEXTAREA_ID);
    const panel = document.getElementById(DEBUG_LOG_PANEL_ID);

    if (!textarea || !panel || panel.hidden) {
      return;
    }

    textarea.value = formatDebugLogs();
    textarea.scrollTop = textarea.scrollHeight;
  }

  async function copyDebugLogs() {
    const text = formatDebugLogs();

    if (!text) {
      setPanelStatus("Aucun log à copier.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setPanelStatus("Logs copiés.");
      return;
    } catch (_error) {
      const panel = document.getElementById(DEBUG_LOG_PANEL_ID);
      const textarea = document.getElementById(DEBUG_LOG_TEXTAREA_ID);

      if (panel) {
        panel.hidden = false;
      }

      if (textarea) {
        textarea.value = text;
        textarea.focus();
        textarea.select();
      }

      setPanelStatus("Copie automatique refusée : les logs sont sélectionnés.");
    }
  }

  function clearDebugLogs() {
    const confirmed = window.confirm("Effacer le journal de debug ?");

    if (!confirmed) {
      return;
    }

    GM_deleteValue(DEBUG_LOG_KEY);
    renderDebugLogs();
    setPanelStatus("Journal de debug effacé.");
  }

  function formatDebugLogs() {
    const logs = GM_getValue(DEBUG_LOG_KEY, []);

    if (!Array.isArray(logs) || !logs.length) {
      return "";
    }

    return logs.map((entry) => JSON.stringify(entry)).join("\n");
  }

  function getState() {
    return GM_getValue(STATE_KEY, {
      running: false,
      phase: "idle",
      mode: "manual",
      autoEnabled: false,
      autoRefreshPending: false,
      autoNextCheckAt: null,
      autoTargetKeys: [],
      manualTargetKeys: [],
      currentIndex: 0,
      currentStableKey: null,
      currentContentKey: null,
      allowUnchangedContentKey: "",
      currentJobId: null,
      panelCollapsed: false,
      panelPosition: null,
      message: "Prêt.",
      updatedAt: Date.now(),
    });
  }

  function setState(patch) {
    const next = {
      ...getState(),
      ...patch,
      updatedAt: Date.now(),
    };

    GM_setValue(STATE_KEY, next);
    syncPanelWithState();
    return next;
  }

  function isWorkflowStopped(state = getState()) {
    return !state.running || state.phase === "stopped";
  }

  function isCurrentRowWorkflowActive(row, allowedPhases = ["clickedRow"]) {
    const state = getState();

    if (isWorkflowStopped(state)) {
      return false;
    }

    if (allowedPhases.length && !allowedPhases.includes(state.phase)) {
      return false;
    }

    if (row && Number.isFinite(Number(row.index)) && state.currentIndex !== row.index) {
      return false;
    }

    if (row && row.stableKey && state.currentStableKey !== row.stableKey) {
      return false;
    }

    return true;
  }

  function isCurrentJobStillActive(jobId, allowedPhases = []) {
    const state = getState();

    if (isWorkflowStopped(state)) {
      return false;
    }

    if (jobId && state.currentJobId !== jobId) {
      return false;
    }

    if (allowedPhases.length && !allowedPhases.includes(state.phase)) {
      return false;
    }

    return true;
  }

  function abortIfWorkflowStopped() {
    if (isWorkflowStopped()) {
      throw new Error("analyse arrêtée");
    }
  }

  function clearWorkflowCancellation() {
    GM_deleteValue(CANCEL_KEY);
  }

  function requestWorkflowCancellation(reason, jobId = "") {
    GM_setValue(CANCEL_KEY, {
      jobId: jobId || "",
      reason: reason || "arrêt demandé",
      createdAt: Date.now(),
    });
  }

  function isCancellationForJob(cancel, jobId = "") {
    return Boolean(cancel && (!cancel.jobId || !jobId || cancel.jobId === jobId));
  }

  function getWorkflowCancellation(jobId = "") {
    const cancel = GM_getValue(CANCEL_KEY, null);
    return isCancellationForJob(cancel, jobId) ? cancel : null;
  }

  function abortIfHeidiJobCancelled(jobId = "") {
    const cancel = getWorkflowCancellation(jobId);
    if (cancel) {
      throw new Error("analyse arrêtée");
    }
  }

  function isHeidiCancellationError(error, jobId = "") {
    return /analyse arrêtée/i.test(error && error.message ? error.message : "") ||
      Boolean(getWorkflowCancellation(jobId));
  }

  function scheduleAutoRefresh() {
    window.clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;

    const state = getState();
    if (!state.autoEnabled) {
      return;
    }

    if (recoverStaleAutoRun(state)) {
      return;
    }

    if (state.running) {
      return;
    }

    const nextCheckAt = state.autoNextCheckAt || Date.now() + AUTO_INTERVAL_MS;
    const delay = Math.max(1000, nextCheckAt - Date.now());

    autoRefreshTimer = window.setTimeout(() => {
      const latest = getState();
      if (!latest.autoEnabled) {
        return;
      }

      if (recoverStaleAutoRun(latest)) {
        return;
      }

      if (latest.running) {
        scheduleAutoRefresh();
        return;
      }

      setState({
        autoRefreshPending: true,
        message: "Veille auto : actualisation de Weda...",
      });
      window.location.reload();
    }, delay);
  }

  function setupAutoHeartbeat() {
    if (!autoHeartbeatTimer) {
      autoHeartbeatTimer = window.setInterval(autoHeartbeat, AUTO_HEARTBEAT_MS);
    }

    window.addEventListener("focus", autoHeartbeat);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        autoHeartbeat();
      }
    });
  }

  function autoHeartbeat() {
    const state = getState();

    if (!state.autoEnabled) {
      return;
    }

    if (recoverStaleAutoRun(state)) {
      return;
    }

    if (state.running) {
      return;
    }

    if (state.autoRefreshPending || !state.autoNextCheckAt || state.autoNextCheckAt <= Date.now()) {
      handleAutoOnLoad();
      return;
    }

    scheduleAutoRefresh();
  }

  function recoverStaleAutoRun(state = getState()) {
    if (!state.autoEnabled || !state.running || state.mode !== "auto") {
      return false;
    }

    const updatedAt = state.updatedAt || 0;
    if (Date.now() - updatedAt < AUTO_STALE_RUNNING_MS) {
      return false;
    }

    GM_deleteValue(JOB_KEY);
    GM_deleteValue(RESULT_KEY);
    requestWorkflowCancellation("reprise auto après cycle bloqué", state.currentJobId || "");
    closeCurrentHeidiTab();

    const nextCheckAt = Date.now() + 1000;
    setState({
      running: false,
      mode: "manual",
      phase: "autoRecovered",
      currentIndex: 0,
      currentRowKey: null,
      currentStableKey: null,
      currentContentKey: null,
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      autoTargetKeys: [],
      manualTargetKeys: [],
      autoRefreshPending: true,
      autoNextCheckAt: nextCheckAt,
      message: "Veille auto : reprise après cycle bloqué, nouvelle actualisation...",
    });

    window.setTimeout(() => window.location.reload(), 1000);
    return true;
  }

  function toggleAutoMode() {
    const state = getState();

    if (state.autoEnabled) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
      if (state.mode === "auto") {
        GM_deleteValue(JOB_KEY);
        GM_deleteValue(RESULT_KEY);
        requestWorkflowCancellation("mode auto désactivé", state.currentJobId || "");
        closeCurrentHeidiTab();
      }
      setState({
        running: state.mode === "auto" ? false : state.running,
        phase: state.mode === "auto" ? "stopped" : state.phase,
        autoEnabled: false,
        autoRefreshPending: false,
        autoNextCheckAt: null,
        autoTargetKeys: [],
        manualTargetKeys: [],
        currentJobId: state.mode === "auto" ? null : state.currentJobId,
        message: "Mode auto désactivé.",
      });
      return;
    }

    markRowsSeen(getBiologyRows());
    const nextCheckAt = Date.now() + AUTO_INTERVAL_MS;
    setState({
      autoEnabled: true,
      autoRefreshPending: false,
      autoNextCheckAt: nextCheckAt,
      autoTargetKeys: [],
      manualTargetKeys: [],
      message: `Mode auto activé. Prochaine vérification vers ${formatTime(nextCheckAt)}.`,
    });
    scheduleAutoRefresh();
  }

  function handleAutoOnLoad() {
    const state = getState();

    if (!state.autoEnabled) {
      scheduleAutoRefresh();
      return;
    }

    if (recoverStaleAutoRun(state)) {
      return;
    }

    if (state.running) {
      scheduleAutoRefresh();
      return;
    }

    if (state.autoRefreshPending) {
      setState({
        autoRefreshPending: false,
        message: "Veille auto : recherche de nouveaux courriers...",
      });
      window.setTimeout(() => startAutoWorkflowIfNeeded(), 1600);
      return;
    }

    if (!state.autoNextCheckAt || state.autoNextCheckAt <= Date.now()) {
      setState({
        autoRefreshPending: true,
        message: "Veille auto : actualisation de Weda...",
      });
      window.setTimeout(() => window.location.reload(), 400);
      return;
    }

    scheduleAutoRefresh();
  }

  async function startAutoWorkflowIfNeeded() {
    const state = getState();

    if (!state.autoEnabled) {
      scheduleAutoRefresh();
      return;
    }

    if (recoverStaleAutoRun(state)) {
      return;
    }

    if (state.running) {
      scheduleAutoRefresh();
      return;
    }

    appendDebugLog("weda:auto-start", {
      hasMessageList: Boolean(document.querySelector(MESSAGE_LIST_SELECTOR)),
    });

    const listState = await waitForAutoBiologyGrid();
    const latestState = getState();

    if (!latestState.autoEnabled) {
      scheduleAutoRefresh();
      return;
    }

    if (recoverStaleAutoRun(latestState)) {
      return;
    }

    if (latestState.running) {
      scheduleAutoRefresh();
      return;
    }

    if (!listState.ready) {
      const nextCheckAt = Date.now() + AUTO_HEARTBEAT_MS;
      setState({
        autoRefreshPending: false,
        autoNextCheckAt: nextCheckAt,
        autoTargetKeys: [],
        manualTargetKeys: [],
        message: "Veille auto : liste Weda indisponible, nouvel essai vers " + formatTime(nextCheckAt) + ".",
      });
      scheduleAutoRefresh();
      return;
    }

    const rows = listState.rows;
    const seen = getSeenRowMap();
    const newRows = rows.filter((row) => !isAutoRowSeen(row, seen));

    appendDebugLog("weda:auto-rows-read", {
      rows: rows.length,
      knownRows: Object.keys(seen).length,
      newRows: newRows.length,
      duplicateRows: rows.filter((row) => row.duplicateCount > 1).length,
      newDuplicateRows: newRows.filter((row) => row.duplicateCount > 1).length,
    });

    if (!newRows.length) {
      const nextCheckAt = Date.now() + AUTO_INTERVAL_MS;
      markRowsSeen(rows);
      setState({
        autoRefreshPending: false,
        autoNextCheckAt: nextCheckAt,
        autoTargetKeys: [],
        manualTargetKeys: [],
        message: "Veille auto : aucun nouveau courrier. Prochaine vérification vers " + formatTime(nextCheckAt) + ".",
      });
      scheduleAutoRefresh();
      return;
    }

    setState({
      running: true,
      mode: "auto",
      phase: "readyToClick",
      currentIndex: newRows[0].index,
      currentRowKey: newRows[0].key,
      currentStableKey: newRows[0].stableKey,
      currentContentKey: null,
      allowUnchangedContentKey: "",
      currentJobId: null,
      autoRefreshPending: false,
      autoTargetKeys: newRows.map((row) => getAutoRowKey(row)),
      manualTargetKeys: [],
      message: "Veille auto : " + newRows.length + " nouveau(x) courrier(s) à traiter.",
    });
    clearWorkflowCancellation();

    clickBiologyRow(newRows[0].index);
  }

  async function waitForAutoBiologyGrid() {
    const readList = () => {
      const list = document.querySelector(MESSAGE_LIST_SELECTOR);

      if (!list) {
        return null;
      }

      return {
        ready: true,
        rows: getBiologyRows(),
      };
    };

    const current = readList();

    if (current) {
      return current;
    }

    try {
      return await waitFor(readList, {
        timeout: AUTO_GRID_WAIT_MS,
        interval: 600,
        description: "la liste Weda des courriers",
      });
    } catch (error) {
      appendDebugLog("weda:auto-list-unavailable", {
        error: error.message,
        hasMessageList: Boolean(document.querySelector(MESSAGE_LIST_SELECTOR)),
      });

      return {
        ready: false,
        rows: [],
      };
    }
  }

  function startWedaWorkflow() {
    const rows = getBiologyRows();
    const selectedIndex = getSelectedBiologyIndex();
    const startIndex = selectedIndex >= 0 ? selectedIndex : 0;
    appendDebugLog("weda:start-manual", {
      rows: rows.length,
      selectedIndex,
      hasMessageList: Boolean(document.querySelector(MESSAGE_LIST_SELECTOR)),
      hasPdf: Boolean(getDisplayedPdfUrl()),
    });

    if (!rows.length) {
      setState({
        running: false,
        phase: "error",
        message: "Aucun courrier trouvé dans la liste.",
      });
      return;
    }

    GM_deleteValue(RESULT_KEY);
    GM_deleteValue(JOB_KEY);
    clearWorkflowCancellation();

    setState({
      running: true,
      mode: "manual",
      phase: "readyToClick",
      currentIndex: startIndex,
      currentRowKey: rows[startIndex] ? rows[startIndex].key : null,
      currentStableKey: rows[startIndex] ? rows[startIndex].stableKey : null,
      currentContentKey: null,
      allowUnchangedContentKey: "",
      autoTargetKeys: [],
      manualTargetKeys: rows.slice(startIndex).map((row) => row.key).filter(Boolean),
      currentJobId: null,
      message: "Démarrage : " + (rows.length - startIndex) + " courrier(s) à parcourir.",
    });

    clickBiologyRow(startIndex);
  }

  function stopWedaWorkflow() {
    const state = getState();
    GM_deleteValue(JOB_KEY);
    GM_deleteValue(RESULT_KEY);
    requestWorkflowCancellation("arrêt manuel", state.currentJobId || "");
    appendDebugLog("weda:stop-requested", {
      state,
    });
    closeCurrentHeidiTab();
    setState({
      running: false,
      mode: "manual",
      phase: "stopped",
      autoTargetKeys: [],
      manualTargetKeys: [],
      currentStableKey: null,
      currentContentKey: null,
      currentPdfUrl: "",
      currentUrlKey: "",
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      message: "Analyse arrêtée. Les opérations en cours seront ignorées.",
    });
    scheduleAutoRefresh();
  }

  function clearRememberedTitles() {
    const confirmed = window.confirm("Effacer tous les titres mémorisés par le script ?");

    if (!confirmed) {
      return;
    }

    GM_deleteValue(TITLES_KEY);
    setPanelStatus("Mémoire des titres effacée.");
  }

  function resumeWedaWorkflow() {
    const state = getState();

    if (!state.running) {
      syncPanelWithState();
      return;
    }

    if (state.phase === "clickedRow") {
      extractAndSendCurrentBiology();
      return;
    }

    if (state.phase === "waitingHeidi") {
      setPanelStatus("Analyse Heidi en cours pour le courrier " + (state.currentIndex + 1) + "...");
      return;
    }

    if (state.phase === "savingTitle") {
      setPanelStatus("Titre transmis à Weda, préparation du courrier suivant...");
      window.setTimeout(() => goToNextBiology(state.currentJobId), NEXT_AFTER_RELOAD_SAVE_MS);
      return;
    }

    if (state.phase === "readyToClick") {
      if (state.mode === "auto") {
        const nextAutoIndex = findNextAutoRowIndex(state);
        if (nextAutoIndex >= 0) {
          clickBiologyRow(nextAutoIndex);
          return;
        }
        finishAutoCycle("Veille auto : aucun nouveau courrier restant.");
        return;
      }

      const row = findBiologyRowByIndexAndStableKey(state.currentIndex, state.currentStableKey) ||
        findBiologyRowByStableKey(state.currentStableKey);
      clickBiologyRow(row ? row.index : (state.currentIndex || 0));
    }
  }

  function getBiologyRows() {
    const rows = Array.from(document.querySelectorAll(MESSAGE_ROW_SELECTOR))
      .map((row, index) => {
        const sender = normalizeText((row.querySelector(".sender") || {}).textContent || "");
        const date = normalizeText((row.querySelector(".date") || {}).textContent || "");
        const unread = Boolean(row.querySelector(".sender.unread"));
        const cells = [sender, date, unread ? "non lu" : "lu"];
        const stableKey = buildBiologyStableRowKey(cells);

        return {
          index,
          row,
          link: row.querySelector(".messageLineItem") || row,
          stableKey,
          date,
          label: sender,
          identityLabel: buildBiologyIdentityLabel(cells),
          cells,
          unread,
        };
      })
      .filter((item) => item.row);

    const stableKeyCounts = rows.reduce((counts, row) => {
      counts[row.stableKey] = (counts[row.stableKey] || 0) + 1;
      return counts;
    }, {});
    const stableKeyOccurrences = {};

    return rows.map((row) => {
      const occurrence = (stableKeyOccurrences[row.stableKey] || 0) + 1;
      stableKeyOccurrences[row.stableKey] = occurrence;
      const duplicateCount = stableKeyCounts[row.stableKey] || 0;
      const rowKey = duplicateCount > 1 ? row.stableKey + "#" + occurrence : row.stableKey;

      return {
        ...row,
        key: rowKey,
        duplicateCount,
        duplicateOccurrence: occurrence,
      };
    });
  }

  function buildBiologyStableRowKey(cells) {
    return "message-" + hashString(buildBiologyIdentityText(cells));
  }

  function buildBiologyIdentityText(cells) {
    const sender = cells[0] || "";
    const date = cells[1] || "";

    return [sender, date]
      .map((part) => normalizeForCompare(part))
      .join("|");
  }

  function buildBiologyIdentityLabel(cells) {
    const sender = cells[0] || "";
    const date = cells[1] || "";
    return normalizeText([sender, date].filter(Boolean).join(" - "));
  }

  function findBiologyRowByStableKey(stableKey, rows = getBiologyRows()) {
    if (!stableKey) {
      return null;
    }

    return rows.find((row) => row.stableKey === stableKey) || null;
  }

  function findBiologyRowsByStableKey(stableKey, rows = getBiologyRows()) {
    if (!stableKey) {
      return [];
    }

    return rows.filter((row) => row.stableKey === stableKey);
  }

  function findBiologyRowByIndexAndStableKey(index, stableKey = "", rows = getBiologyRows()) {
    const numericIndex = Number(index);

    if (!Number.isFinite(numericIndex)) {
      return null;
    }

    const row = rows[numericIndex];

    if (!row) {
      return null;
    }

    return !stableKey || row.stableKey === stableKey ? row : null;
  }

  function getCurrentWorkflowRow(state = getState(), rows = getBiologyRows()) {
    const indexedRow = findBiologyRowByIndexAndStableKey(state.currentIndex, state.currentStableKey, rows) ||
      rows[Number(state.currentIndex)];

    return indexedRow || findBiologyRowByStableKey(state.currentStableKey, rows) || null;
  }

  function getSelectedBiologyItem() {
    const rows = getBiologyRows();
    const selected = rows.find((item) => item.row.classList.contains("selected"));
    const state = getState();

    return selected || findBiologyRowByStableKey(state.currentStableKey, rows) || rows[state.currentIndex] || null;
  }

  function getSelectedBiologyIndex() {
    const rows = getBiologyRows();
    const selected = rows.find((item) => item.row.classList.contains("selected"));
    return selected ? selected.index : -1;
  }

  function getPageWindow() {
    return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  }

  function getLinkScriptSource(link) {
    return link ? String(link.getAttribute("onclick") || link.getAttribute("href") || "") : "";
  }

  function extractWedaPostBackOptions(_link) {
    return null;
  }

  function triggerWedaBiologyRowOpen(item, reason = "open") {
    const row = item && item.row;
    const checkbox = row ? row.querySelector('input[type="checkbox"]') : null;
    const messageLine = row ? row.querySelector(".messageLineItem") : null;
    const sender = row ? row.querySelector(".sender") : null;
    const date = row ? row.querySelector(".date") : null;
    const clickable = item && (messageLine || sender || date || item.link || row);

    appendDebugLog("weda:row-open-start", {
      reason,
      rowIndex: item ? item.index : null,
      hasRow: Boolean(row),
      hasCheckbox: Boolean(checkbox),
      hasMessageLine: Boolean(messageLine),
      hasSender: Boolean(sender),
      selectedBefore: Boolean(row && row.classList.contains("selected")),
    });

    if (!row || !clickable) {
      throw new Error("ligne Weda introuvable pour ouvrir le courrier");
    }

    try {
      row.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_error) {
      // Le clic reste tenté même si le défilement échoue.
    }

    const targets = [clickable, sender, date, item && item.link]
      .filter(Boolean)
      .filter((element, index, list) => list.indexOf(element) === index)
      .filter((element) => element !== checkbox && !(element.closest && element.closest('input[type="checkbox"]')));

    const clickTargets = targets.length ? targets : [row];

    clickTargets
      .forEach((element) => {
        dispatchPointerLikeEvents(element);
        try {
          element.click();
        } catch (_error) {
          // Best effort : certains handlers Angular répondent seulement aux événements pointeur.
        }
      });

    appendDebugLog("weda:row-open-triggered", {
      reason,
      method: "message-row-click",
      rowIndex: item.index,
      selectedAfter: Boolean(row.classList.contains("selected")),
    });
    return "message-row-click";
  }

  function scheduleWedaRowOpenRetries(targetRow, previousContentKey) {
    const targetIndex = targetRow ? targetRow.index : -1;
    const targetStableKey = targetRow ? targetRow.stableKey : "";

    WEDA_ROW_OPEN_RETRY_DELAYS_MS.forEach((delay, retryIndex) => {
      window.setTimeout(() => {
        const state = getState();

        if (
          !state.running ||
          state.phase !== "clickedRow" ||
          state.currentStableKey !== targetStableKey ||
          state.currentIndex !== targetIndex
        ) {
          return;
        }

        const freshRows = getBiologyRows();
        const freshRow = findBiologyRowByIndexAndStableKey(targetIndex, targetStableKey, freshRows) ||
          findBiologyRowByStableKey(targetStableKey, freshRows);

        if (targetStableKey && patientImportBeforePdfStableKey === targetStableKey) {
          appendDebugLog("weda:row-open-retry-skip", {
            retry: retryIndex + 1,
            rowIndex: freshRow ? freshRow.index : targetIndex,
            reason: "patient-import-before-pdf",
          });
          return;
        }

        const contentKey = getDisplayedBiologyContentKey();
        const displayedOk = freshRow && isDisplayedBiologyForRow(freshRow);
        const changedOk = !previousContentKey || contentKey !== previousContentKey || contentKey === state.allowUnchangedContentKey;

        if (displayedOk && changedOk) {
          appendDebugLog("weda:row-open-retry-skip", {
            retry: retryIndex + 1,
            rowIndex: freshRow.index,
            reason: "displayed",
          });
          return;
        }

        if (!freshRow) {
          appendDebugLog("weda:row-open-retry-skip", {
            retry: retryIndex + 1,
            reason: "row-missing",
          });
          return;
        }

        appendDebugLog("weda:row-open-retry", {
          retry: retryIndex + 1,
          delay,
          rowIndex: freshRow.index,
          displayedOk,
          changedOk,
        });

        try {
          triggerWedaBiologyRowOpen(freshRow, "retry-" + (retryIndex + 1));
        } catch (error) {
          appendDebugLog("weda:row-open-retry-error", {
            retry: retryIndex + 1,
            error: error.message,
          });
        }
      }, delay);
    });
  }

  function getDisplayedBiologyContentKey(documentText = "") {
    const text = normalizePdfText(documentText);
    if (text) {
      return "pdftext-" + hashString(text);
    }

    return getDisplayedPdfUrlKey();
  }

  function getDisplayedPdfUrlKey() {
    const pdfUrl = getDisplayedPdfUrl();
    return pdfUrl ? "pdfurl-" + hashString(pdfUrl) : "";
  }

  function getDisplayedBiologyHeaderText() {
    const selected = getSelectedBiologyItem();
    return selected ? selected.identityLabel : "";
  }

  function isDisplayedBiologyForRow(item) {
    if (!item || !item.row) {
      return false;
    }

    return Boolean(getDisplayedPdfUrl()) && (
      item.row.classList.contains("selected") ||
      getSelectedBiologyIndex() === item.index
    );
  }

  function getDisplayedPdfEmbed() {
    return findDisplayedPdfElement(document);
  }

  function getDisplayedPdfUrl(options = {}) {
    const candidates = getDisplayedPdfUrlCandidates(options);
    return candidates[0] || "";
  }

  function getDisplayedPdfUrlCandidates(options = {}) {
    const candidates = [];
    const addCandidate = (value) => {
      const url = normalizePdfUrl(value);
      if (url && isLikelyPdfUrl(url) && !candidates.includes(url)) {
        candidates.push(url);
      }
    };

    collectMssAttachmentPdfUrlCandidates().forEach(addCandidate);
    collectPdfUrlCandidatesFromDocument(document, { visibleOnly: true }).forEach(addCandidate);

    Array.from(querySelectorAllDeep(document, "iframe, frame")).forEach((frame) => {
      addCandidate(frame.getAttribute("original-url"));
      addCandidate(frame.getAttribute("data-original-url"));
      addCandidate(frame.getAttribute("src"));
      addCandidate(frame.getAttribute("data-src"));

      try {
        if (frame.contentDocument) {
          collectPdfUrlCandidatesFromDocument(frame.contentDocument, {
            visibleOnly: false,
            scopedFallback: true,
          }).forEach(addCandidate);
        }
      } catch (_error) {
        // Les iframes Chrome PDF ou cross-origin ne sont pas toujours lisibles.
      }
    });

    const scopedRoots = [
      document.querySelector("#messageContainer"),
      document.querySelector("#container"),
    ].filter(Boolean);

    (scopedRoots.length ? scopedRoots : [document]).forEach((root) => {
      collectPdfUrlCandidatesFromDocument(root, {
        visibleOnly: false,
        scopedFallback: true,
      }).forEach(addCandidate);
    });

    if (options.includePerformance) {
      collectPdfUrlCandidatesFromPerformance(options.minPerformanceStartTime || 0).forEach(addCandidate);
    }

    return candidates.filter((url) => !/^chrome-extension:/i.test(url));
  }

  function collectMssAttachmentPdfUrlCandidates() {
    return querySelectorAllDeep(document, "#messageContainer div.mssAttachment embed[src]")
      .map((element) => element.getAttribute("src"))
      .filter((url) => isLikelyPdfUrl(url));
  }

  function collectPdfUrlCandidatesFromPerformance(minStartTime = 0) {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
      return [];
    }

    return performance.getEntriesByType("resource")
      .filter((entry) => !minStartTime || entry.startTime >= minStartTime)
      .filter((entry) => isLikelyPdfUrl(entry.name))
      .sort((a, b) => b.startTime - a.startTime)
      .map((entry) => entry.name);
  }

  function collectPdfUrlCandidatesFromDocument(rootDocument, options = {}) {
    const root = rootDocument || document;
    const visibleOnly = options.visibleOnly !== false;
    const candidates = [];
    const elements = querySelectorAllDeep(root, [
      PDF_EMBED_SELECTOR,
      "#messageContainer div.mssAttachment embed[src]",
      "#messageContainer div.mssAttachment iframe[type='application/pdf']",
      "embed[original-url]",
      "embed[src*='downloadAttachment']",
      "embed[src*='application%2Fpdf']",
      "embed[type*='pdf']",
      "embed[type='application/x-google-chrome-pdf']",
      "object[data*='BinaryData']",
      "object[data*='downloadAttachment']",
      "object[data*='application%2Fpdf']",
      "iframe[original-url]",
      "iframe[type='application/pdf']",
      "iframe[src*='BinaryData']",
      "iframe[src*='downloadAttachment']",
      "iframe[src*='application%2Fpdf']",
      "a[href*='BinaryData']",
      "a[href*='downloadAttachment']",
      "a[href*='application%2Fpdf']",
      "[href*='BinaryData']",
      "[href*='downloadAttachment']",
      "[href*='application%2Fpdf']",
      "[src*='BinaryData']",
      "[src*='downloadAttachment']",
      "[src*='application%2Fpdf']",
      "[data*='BinaryData']",
      "[data*='downloadAttachment']",
      "[data*='application%2Fpdf']",
      "[original-url*='BinaryData']",
      "[original-url*='downloadAttachment']",
      "[original-url*='application%2Fpdf']",
      "[original-url*='application/pdf']",
      "[data-original-url*='BinaryData']",
      "[data-original-url*='downloadAttachment']",
      "[data-original-url*='application%2Fpdf']",
    ].join(","));

    elements.forEach((element) => {
      if (visibleOnly && !isDisplayedPdfCandidateVisible(element)) {
        return;
      }

      candidates.push(
        element.getAttribute("original-url"),
        element.getAttribute("data-original-url"),
        element.getAttribute("data"),
        element.getAttribute("href"),
        element.getAttribute("src"),
        element.getAttribute("ng-src"),
        element.getAttribute("data-src")
      );
    });

    if (options.scopedFallback) {
      const fallbackElements = querySelectorAllDeep(root, "*");
      if (root && root.nodeType === 1) {
        fallbackElements.unshift(root);
      }

      fallbackElements.forEach((element) => {
        Array.from(element.attributes || []).forEach((attribute) => {
          if (isLikelyPdfUrl(attribute.value || "")) {
            candidates.push(attribute.value);
          }
        });
      });
    }

    return candidates.filter(Boolean);
  }

  function findDisplayedPdfElement(rootDocument) {
    const root = rootDocument || document;
    const element = querySelectorAllDeep(root, [
      PDF_EMBED_SELECTOR,
      "#messageContainer div.mssAttachment embed[src]",
      "#messageContainer div.mssAttachment iframe[type='application/pdf']",
      "embed[original-url]",
      "embed[src*='downloadAttachment']",
      "embed[src*='application%2Fpdf']",
      "embed[type*='pdf']",
      "embed[type='application/x-google-chrome-pdf']",
      "object[data*='BinaryData']",
      "object[data*='downloadAttachment']",
      "object[data*='application%2Fpdf']",
      "iframe[original-url]",
      "iframe[type='application/pdf']",
      "iframe[src*='BinaryData']",
      "iframe[src*='downloadAttachment']",
      "iframe[src*='application%2Fpdf']",
    ].join(",")).find((candidate) => isDisplayedPdfCandidateVisible(candidate));

    return element || null;
  }

  function isDisplayedPdfCandidateVisible(element) {
    if (isElementVisible(element)) {
      return true;
    }

    if (element && typeof element.closest === "function" && element.closest("#messageContainer div.mssAttachment")) {
      return true;
    }

    const container = element && typeof element.closest === "function" ? element.closest("#container") : null;
    return Boolean(container && isElementVisible(container));
  }

  function querySelectorAllDeep(root, selector) {
    const results = [];
    const visited = new Set();

    const visit = (node) => {
      if (!node || visited.has(node)) {
        return;
      }
      visited.add(node);

      if (node.nodeType === 1 && typeof node.matches === "function") {
        try {
          if (node.matches(selector)) {
            results.push(node);
          }
        } catch (_error) {
          return;
        }
      }

      if (typeof node.querySelectorAll !== "function") {
        return;
      }

      let descendants = [];
      try {
        descendants = Array.from(node.querySelectorAll(selector));
      } catch (_error) {
        return;
      }

      descendants.forEach((element) => {
        if (!results.includes(element)) {
          results.push(element);
        }
      });

      let allElements = [];
      try {
        allElements = Array.from(node.querySelectorAll("*"));
      } catch (_error) {
        return;
      }

      allElements.forEach((element) => {
        if (element.shadowRoot) {
          visit(element.shadowRoot);
        }
      });
    };

    visit(root || document);
    return results;
  }

  function isLikelyPdfUrl(value) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }

    const decodedText = safeDecodeURIComponent(text);
    return (
      /BinaryData\.aspx/i.test(text) ||
      /\/mss\/downloadAttachment\//i.test(text) ||
      /downloadAttachment/i.test(text) ||
      /application(?:%2f|\/)pdf/i.test(text) ||
      /\.pdf(?:[?#]|$)/i.test(text) ||
      /application\/pdf/i.test(decodedText)
    );
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (_error) {
      return String(value || "");
    }
  }

  function normalizePdfUrl(rawUrl) {
    if (!rawUrl) {
      return "";
    }

    const text = String(rawUrl || "").trim();
    if (!text || /^javascript:/i.test(text) || /^blob:/i.test(text)) {
      return "";
    }

    try {
      return new URL(text.replace(/&amp;/g, "&"), location.origin).href;
    } catch (_error) {
      return text;
    }
  }

  function findWedaTitleInput(options = {}) {
    const container = document.querySelector("#messageContainer") || document;
    const selectors = [
      DOC_TITLE_PRIMARY_SELECTOR,
      "div.messageAttachment.flexColStart we-doc-import input.docTitle",
      "div.messageAttachment.flexColStart we-doc-import input[placeholder='Titre du document']",
      "div.messageAttachment.flexColStart we-doc-import input[title*='titre']",
      "we-doc-import input.docTitle[placeholder='Titre du document']",
      "#messageContainer input.docTitle[placeholder='Titre du document']",
      "#messageContainer input.docTitle[title*='titre']",
      DOC_TITLE_FALLBACK_SELECTOR,
    ].join(", ");
    const candidates = [
      ...Array.from(document.querySelectorAll(DOC_TITLE_PRIMARY_SELECTOR)),
      ...Array.from(container.querySelectorAll(selectors)),
    ];

    return pickWedaTitleInput(candidates, options);
  }

  function pickWedaTitleInput(inputs, options = {}) {
    const candidates = Array.from(inputs || [])
      .filter((input, index, list) => input && list.indexOf(input) === index)
      .filter((input) => /^(?:input|textarea)$/i.test(input.tagName || ""));

    if (candidates.length <= 1) {
      return candidates.find((input) => isElementVisible(input)) || candidates[0] || null;
    }

    const context = buildWedaTitleInputSelectionContext(options);
    const scored = candidates
      .map((input, index) => ({
        input,
        index,
        score: scoreWedaTitleInput(input, context, index),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return scored[0] ? scored[0].input : null;
  }

  function buildWedaTitleInputSelectionContext(options = {}) {
    const targetPdfUrl = normalizePdfUrl(options.pdfUrl || options.targetPdfUrl || getDisplayedPdfUrl());
    const displayedPdfElement = getDisplayedPdfEmbed();
    const targetRoot = findWedaPdfAttachmentRoot(targetPdfUrl, displayedPdfElement);

    return {
      targetPdfUrl,
      displayedPdfElement,
      targetRoot,
      attachmentRoots: getWedaAttachmentRoots(),
    };
  }

  function scoreWedaTitleInput(input, context, index = 0) {
    const root = getWedaTitleAttachmentRoot(input);
    let score = 0;

    if (isElementVisible(input)) {
      score += 1000;
    }

    if (context.targetRoot && root === context.targetRoot) {
      score += 10000;
    }

    if (context.targetPdfUrl && root && rootContainsPdfUrl(root, context.targetPdfUrl)) {
      score += 7000;
    }

    if (context.displayedPdfElement && root && root.contains(context.displayedPdfElement)) {
      score += 5000;
    }

    if (root && rootContainsAnyPdf(root)) {
      score += 1500;
    }

    if (context.displayedPdfElement) {
      score += getVerticalProximityScore(input, context.displayedPdfElement);
      if (input.compareDocumentPosition(context.displayedPdfElement) & Node.DOCUMENT_POSITION_FOLLOWING) {
        score += 150;
      }
    }

    return score - index;
  }

  function getWedaAttachmentRoots() {
    const container = document.querySelector("#messageContainer") || document;
    return Array.from(container.querySelectorAll([
      "div.messageAttachment.flexColStart",
      "div.messageAttachment",
      "we-doc-import",
    ].join(", ")))
      .filter((root, index, list) => root && list.indexOf(root) === index);
  }

  function getWedaTitleAttachmentRoot(element) {
    if (!element || typeof element.closest !== "function") {
      return null;
    }

    return element.closest("div.messageAttachment.flexColStart, div.messageAttachment") ||
      element.closest("we-doc-import") ||
      null;
  }

  function findWedaPdfAttachmentRoot(targetPdfUrl = "", displayedPdfElement = null) {
    const roots = getWedaAttachmentRoots();

    if (displayedPdfElement) {
      const displayedRoot = getWedaTitleAttachmentRoot(displayedPdfElement);
      if (displayedRoot) {
        return displayedRoot;
      }
    }

    if (targetPdfUrl) {
      const urlRoot = roots.find((root) => rootContainsPdfUrl(root, targetPdfUrl));
      if (urlRoot) {
        return urlRoot;
      }
    }

    return roots.find((root) => rootContainsAnyPdf(root) && root.querySelector("input.docTitle, input[placeholder='Titre du document'], input[title*='titre']")) || null;
  }

  function rootContainsPdfUrl(root, targetPdfUrl = "") {
    if (!root || !targetPdfUrl) {
      return false;
    }

    return collectPdfUrlCandidatesFromDocument(root, {
      visibleOnly: false,
      scopedFallback: true,
    }).some((url) => areSamePdfUrls(url, targetPdfUrl));
  }

  function rootContainsAnyPdf(root) {
    if (!root) {
      return false;
    }

    if (querySelectorAllDeep(root, PDF_EMBED_SELECTOR).length) {
      return true;
    }

    return collectPdfUrlCandidatesFromDocument(root, {
      visibleOnly: false,
      scopedFallback: true,
    }).some((url) => isLikelyPdfUrl(url));
  }

  function areSamePdfUrls(left, right) {
    const normalizedLeft = normalizePdfUrl(left);
    const normalizedRight = normalizePdfUrl(right);

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    return normalizedLeft === normalizedRight ||
      safeDecodeURIComponent(normalizedLeft) === safeDecodeURIComponent(normalizedRight);
  }

  function getVerticalProximityScore(input, pdfElement) {
    if (!input || !pdfElement || typeof input.getBoundingClientRect !== "function") {
      return 0;
    }

    const inputRect = input.getBoundingClientRect();
    const pdfRect = pdfElement.getBoundingClientRect();
    const distance = Math.abs((inputRect.top + inputRect.bottom) / 2 - (pdfRect.top + pdfRect.bottom) / 2);

    return Math.max(0, 900 - Math.min(900, Math.round(distance)));
  }

  function getWedaTitleInputIndex(input) {
    const container = document.querySelector("#messageContainer") || document;
    const inputs = Array.from(container.querySelectorAll("input.docTitle, input[placeholder='Titre du document'], input[title*='titre']"));
    return inputs.indexOf(input);
  }

  function isWedaTitleInputAssociatedWithPdf(input, targetPdfUrl = "") {
    const root = getWedaTitleAttachmentRoot(input);
    return Boolean(root && (
      (targetPdfUrl && rootContainsPdfUrl(root, targetPdfUrl)) ||
      rootContainsAnyPdf(root)
    ));
  }

  function findImportMessageLink() {
    const candidates = [
      document.querySelector(IMPORT_MESSAGE_SELECTOR),
      ...Array.from(document.querySelectorAll("#messageContainer a"))
        .filter((link) => /importer\s+le\s+message/i.test(normalizeText(link.textContent))),
    ].filter(Boolean);

    return candidates.find((link) => isElementVisible(link)) || null;
  }

  function findImportPatientButton() {
    const candidates = [
      document.querySelector(IMPORT_PATIENT_SELECTOR),
      ...Array.from(document.querySelectorAll("#messageContainer .btnImport, #messageContainer div"))
        .filter((element) => {
          const text = normalizeText(element.textContent);
          return element.classList.contains("importPatient") || /^Un patient\b/i.test(text);
        }),
    ].filter(Boolean);

    return candidates.find((element) => isElementVisible(element)) || null;
  }

  function findPdfParserResetButton() {
    return document.querySelector(PDF_PARSER_RESET_SELECTOR);
  }

  async function resetPdfParserBeforePatientImport(jobId = "") {
    const resetButton = findPdfParserResetButton();

    if (!resetButton) {
      appendDebugLog("weda:pdf-parser-reset-missing", { jobId });
      return;
    }

    appendDebugLog("weda:pdf-parser-reset-click", {
      jobId,
      button: resetButton,
    });
    setPanelStatus("Réinitialisation auto-imports avant sélection patient...");
    clickButtonLikeUser(resetButton);
    await sleep(250);
  }

  async function openPatientImportForCurrentMessage(jobId = "", reason = "title-input", options = {}) {
    let patientButton = findImportPatientButton();
    if (!patientButton) {
      try {
        patientButton = await waitFor(() => findImportPatientButton(), {
          timeout: 2500,
          interval: 250,
          description: "le bouton Un patient",
        });
      } catch (_error) {
        patientButton = null;
      }
    }

    if (jobId && !isCurrentJobStillActive(jobId, ["waitingHeidi", "savingTitle"])) {
      appendDebugLog("weda:import-title-cancelled-before-patient", { jobId });
      return null;
    }

    if (!patientButton) {
      appendDebugLog("weda:import-patient-missing", { jobId, reason });
      return null;
    }

    await resetPdfParserBeforePatientImport(jobId);

    appendDebugLog("weda:import-patient-click", {
      jobId,
      reason,
      button: patientButton,
    });
    setPanelStatus("Champ titre absent : tentative via Un patient...");
    lastPatientImportPerformanceStartTime = getCurrentPerformanceTime();
    clickButtonLikeUser(patientButton);
    await sleep(PATIENT_IMPORT_SETTLE_MS);

    const input = await waitForOptionalTitleInput(TITLE_INPUT_WAIT_AFTER_PATIENT_MS, "le champ titre après sélection patient", options);
    if (!input) {
      appendDebugLog("weda:import-title-missing-after-patient", {
        jobId,
        reason,
        timeout: TITLE_INPUT_WAIT_AFTER_PATIENT_MS,
      });
    }

    return input;
  }

  async function waitForOptionalTitleInput(timeout, description, options = {}) {
    try {
      return await waitFor(() => findWedaTitleInput(options), {
        timeout,
        interval: 250,
        description,
      });
    } catch (_error) {
      return null;
    }
  }

  async function ensureWedaTitleInputVisible(jobId = "", options = {}) {
    let input = findWedaTitleInput(options);

    if (input) {
      return input;
    }

    if (jobId && !isCurrentJobStillActive(jobId, ["waitingHeidi", "savingTitle"])) {
      return null;
    }

    const importMessageLink = findImportMessageLink();
    if (importMessageLink) {
      appendDebugLog("weda:import-message-click", {
        jobId,
        link: importMessageLink,
      });
      setPanelStatus("Ouverture de l'import du message...");
      clickButtonLikeUser(importMessageLink);

      input = await waitForOptionalTitleInput(TITLE_INPUT_WAIT_AFTER_IMPORT_MS, "le champ titre après import du message", options);
      if (input) {
        return input;
      }
    } else {
      appendDebugLog("weda:import-message-missing", { jobId });
    }

    if (jobId && !isCurrentJobStillActive(jobId, ["waitingHeidi", "savingTitle"])) {
      appendDebugLog("weda:import-title-cancelled-after-import-wait", { jobId });
      return null;
    }

    return openPatientImportForCurrentMessage(jobId, importMessageLink ? "after-import-message" : "missing-import-message", options);
  }

  async function prepareImportBeforePdfWait(row) {
    const importMessageLink = findImportMessageLink();

    if (importMessageLink) {
      appendDebugLog("weda:pre-pdf-import-message-found", {
        rowIndex: row ? row.index : null,
        link: importMessageLink,
      });
      return { patientImportOpened: false, titleInputRequired: false };
    }

    appendDebugLog("weda:pre-pdf-import-message-missing", {
      rowIndex: row ? row.index : null,
    });

    patientImportBeforePdfStableKey = row ? row.stableKey : "";
    const input = await openPatientImportForCurrentMessage("", "before-pdf-missing-import-message");
    if (!input) {
      throw new Error("champ titre indisponible après clic sur Un patient");
    }

    return {
      patientImportOpened: true,
      titleInputRequired: true,
      pdfPerformanceStartTime: lastPatientImportPerformanceStartTime,
    };
  }

  async function waitForDisplayedBiology(item, previousContentKey, options = {}) {
    let pdfSeenSince = 0;
    const waitStartedAt = options.pdfPerformanceStartTime || Math.max(0, getCurrentPerformanceTime() - 500);
    const displayed = await waitFor(() => {
      abortIfWorkflowStopped();
      const pdfUrl = getDisplayedPdfUrl({
        includePerformance: getElapsedPerformanceMs(waitStartedAt) >= PDF_PERFORMANCE_FALLBACK_SETTLE_MS,
        minPerformanceStartTime: waitStartedAt,
      });
      const urlKey = pdfUrl ? "pdfurl-" + hashString(pdfUrl) : "";
      const selectedOk = item && item.row && (
        item.row.classList.contains("selected") ||
        getSelectedBiologyIndex() === item.index
      );
      const changedOk = !previousContentKey || urlKey !== previousContentKey;
      const expectedPdfUrl = options.expectedPdfUrl || "";
      const allowContentKey = options.allowContentKey || "";
      const now = Date.now();

      if (!pdfUrl) {
        pdfSeenSince = 0;
        return null;
      }

      pdfSeenSince = pdfSeenSince || now;

      if (expectedPdfUrl && pdfUrl !== expectedPdfUrl) {
        return null;
      }

      if (expectedPdfUrl || selectedOk || changedOk || urlKey === allowContentKey || now - pdfSeenSince >= 1200) {
        return {
          pdfUrl,
          urlKey,
          selectedOk,
        };
      }

      return null;
    }, {
      timeout: PDF_DISPLAY_WAIT_MS,
      interval: 350,
      description: "le PDF correspondant à la ligne cliquée",
    });

    abortIfWorkflowStopped();
    setPanelStatus("Extraction du texte du PDF...");
    const extracted = await extractDisplayedPdfTextWithRetry(displayed, waitStartedAt);
    abortIfWorkflowStopped();
    const documentText = extracted.documentText;
    const contentKey = getDisplayedBiologyContentKey(documentText);

    return {
      table: null,
      tableText: documentText,
      tableHtml: "",
      contentKey,
      sourceType: extracted.pdfTextExtractionEmpty ? "pdf-attachment" : "pdf",
      pdfUrl: extracted.displayed.pdfUrl,
      urlKey: extracted.displayed.urlKey,
      pdfAttachmentBase64: extracted.pdfAttachmentBase64 || "",
      pdfAttachmentName: extracted.pdfAttachmentName || "",
      pdfAttachmentMimeType: extracted.pdfAttachmentMimeType || "",
      pdfAttachmentByteLength: extracted.pdfAttachmentByteLength || 0,
      pdfTextExtractionEmpty: Boolean(extracted.pdfTextExtractionEmpty),
    };
  }

  function getCurrentPerformanceTime() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : 0;
  }

  function getElapsedPerformanceMs(startTime) {
    if (!startTime || typeof performance === "undefined" || typeof performance.now !== "function") {
      return Infinity;
    }

    return performance.now() - startTime;
  }

  async function extractDisplayedPdfTextWithRetry(initialDisplayed, waitStartedAt) {
    const startedAt = Date.now();
    let displayed = initialDisplayed;
    let lastError = null;
    let attempt = 0;
    const emptyUrlKeys = new Set();

    while (Date.now() - startedAt <= PDF_EMPTY_TEXT_RETRY_MS) {
      abortIfWorkflowStopped();
      attempt += 1;

      try {
        const rawText = await extractPdfTextFromUrl(displayed.pdfUrl);
        const documentText = truncateDocumentText(rawText);

        if (documentText && documentText.length >= PDF_MIN_TEXT_LENGTH) {
          return {
            documentText,
            displayed,
          };
        }

        lastError = new Error("texte du PDF vide ou illisible");
      } catch (error) {
        lastError = error;
      }

      if (!isRetryablePdfExtractionError(lastError)) {
        throw lastError;
      }

      emptyUrlKeys.add(displayed.urlKey || ("pdfurl-" + hashString(displayed.pdfUrl || "")));

      appendDebugLog("weda:pdf-text-empty-retry", {
        attempt,
        urlKey: displayed.urlKey,
        error: lastError ? lastError.message : "",
        pdfInfo: lastError && lastError.pdfInfo ? lastError.pdfInfo : null,
        fetchInfo: lastError && lastError.pdfFetchInfo ? lastError.pdfFetchInfo : null,
        candidateCount: getDisplayedPdfUrlCandidates({
          includePerformance: true,
          minPerformanceStartTime: waitStartedAt,
        }).length,
        hasPlugin: Boolean(querySelectorAllDeep(document, PDF_EMBED_SELECTOR).length),
        hasAnyPdfElement: Boolean(getDisplayedPdfEmbed()),
      });

      const attachmentFallback = buildPdfAttachmentFallbackFromError(lastError, displayed);
      if (attachmentFallback) {
        appendDebugLog("weda:pdf-text-empty-attachment-fallback", {
          attempt,
          urlKey: displayed.urlKey,
          byteLength: attachmentFallback.pdfAttachmentByteLength,
          fileNameHash: hashString(attachmentFallback.pdfAttachmentName),
        });
        return attachmentFallback;
      }

      await sleep(PDF_EMPTY_TEXT_RETRY_INTERVAL_MS);
      const nextPdfCandidates = getDisplayedPdfUrlCandidates({
        includePerformance: true,
        minPerformanceStartTime: waitStartedAt,
      });
      const nextPdfUrl = nextPdfCandidates.find((candidate) => {
        const candidateKey = "pdfurl-" + hashString(candidate);
        return !emptyUrlKeys.has(candidateKey);
      }) || displayed.pdfUrl;

      if (nextPdfUrl) {
        displayed = {
          pdfUrl: nextPdfUrl,
          urlKey: "pdfurl-" + hashString(nextPdfUrl),
          selectedOk: displayed.selectedOk,
        };
      }
    }

    throw lastError || new Error("texte du PDF vide ou illisible");
  }

  function buildPdfAttachmentFallbackFromError(error, displayed) {
    const byteLength = Number(error && error.pdfAttachmentByteLength) || 0;

    if (!error || !error.pdfAttachmentBase64 || !byteLength) {
      return null;
    }

    return {
      documentText: buildPdfAttachmentFallbackText(displayed, error.pdfInfo),
      displayed,
      pdfAttachmentBase64: error.pdfAttachmentBase64,
      pdfAttachmentName: error.pdfAttachmentName || buildPdfAttachmentFileName(displayed && displayed.pdfUrl),
      pdfAttachmentMimeType: "application/pdf",
      pdfAttachmentByteLength: byteLength,
      pdfTextExtractionEmpty: true,
    };
  }

  function buildPdfAttachmentFallbackText(displayed, pdfInfo = {}) {
    const urlKey = displayed && displayed.urlKey ? displayed.urlKey : "";
    const pageCount = Number(pdfInfo && pdfInfo.pageCount) || 0;
    const byteLength = Number(
      (pdfInfo && pdfInfo.byteLength) ||
      (pdfInfo && pdfInfo.fetchInfo && pdfInfo.fetchInfo.byteLength)
    ) || 0;

    return normalizePdfText([
      "PDF original joint à Heidi.",
      "Le texte de ce PDF n'a pas pu être extrait automatiquement par PDF.js.",
      "Analyser directement la pièce jointe PDF pour produire le titre médical demandé.",
      urlKey ? "Identifiant PDF : " + urlKey : "",
      pageCount ? "Nombre de pages détecté : " + pageCount : "",
      byteLength ? "Taille PDF détectée : " + byteLength + " octets" : "",
    ].filter(Boolean).join("\n"));
  }

  function buildPdfAttachmentFileName(pdfUrl = "") {
    return "weda-courrier-" + hashString(pdfUrl || Date.now()) + ".pdf";
  }

  function isRetryablePdfExtractionError(error) {
    const message = String(error && error.message || "");
    return (
      /texte du PDF vide ou illisible/i.test(message) ||
      /Invalid PDF/i.test(message) ||
      /Missing PDF/i.test(message) ||
      /téléchargement PDF impossible/i.test(message) ||
      /Failed to fetch/i.test(message)
    );
  }

  async function extractPdfTextFromUrl(pdfUrl) {
    if (!pdfUrl) {
      throw new Error("URL du PDF introuvable");
    }

    await ensurePdfJsReady();
    abortIfWorkflowStopped();
    const bytes = await fetchPdfBytes(pdfUrl);
    const pdfFetchInfo = bytes.pdfFetchInfo || null;
    const originalBytes = new Uint8Array(bytes);
    abortIfWorkflowStopped();
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(originalBytes),
      disableFontFace: true,
      useSystemFonts: true,
    }).promise;

    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      abortIfWorkflowStopped();
      const page = await pdf.getPage(pageNumber);
      const pageText = await extractPdfPageText(page);
      if (pageText) {
        pages.push("Page " + pageNumber + "\n" + pageText);
      }
    }

    const text = normalizePdfText(pages.join("\n\n"));
    if (!text || text.length < PDF_MIN_TEXT_LENGTH) {
      const error = new Error("texte du PDF vide ou illisible");
      error.pdfInfo = {
        byteLength: originalBytes.length,
        fetchInfo: pdfFetchInfo,
        pageCount: pdf.numPages,
        extractedLength: text.length,
        urlKey: "pdfurl-" + hashString(pdfUrl),
      };
      if (originalBytes.length) {
        error.pdfAttachmentBase64 = uint8ArrayToBase64(originalBytes);
        error.pdfAttachmentByteLength = originalBytes.length;
        error.pdfAttachmentName = buildPdfAttachmentFileName(pdfUrl);
      }
      throw error;
    }

    return text;
  }

  async function ensurePdfJsReady() {
    const lib = typeof pdfjsLib !== "undefined" ? pdfjsLib : null;

    if (!lib || typeof lib.getDocument !== "function") {
      throw new Error("PDF.js n'est pas chargé par Tampermonkey");
    }

    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    }
  }

  async function fetchPdfBytes(pdfUrl) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt <= PDF_FETCH_RETRY_MS) {
      abortIfWorkflowStopped();
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const abortTimer = controller ? window.setInterval(() => {
        if (isWorkflowStopped()) {
          controller.abort();
        }
      }, 250) : null;

      try {
        const response = await fetch(pdfUrl, {
          credentials: "include",
          cache: "no-store",
          signal: controller ? controller.signal : undefined,
        });

        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const bytes = await normalizePdfResponseBytes(buffer, {
            source: "fetch",
            status: response.status,
            contentType: response.headers ? response.headers.get("content-type") || "" : "",
          });
          abortIfWorkflowStopped();
          if (bytes.length) {
            return bytes;
          }

          lastError = createPdfFetchError("corps PDF vide via fetch", {
            source: "fetch",
            status: response.status,
            byteLength: 0,
            contentType: response.headers ? response.headers.get("content-type") || "" : "",
          });
        } else {
          lastError = createPdfFetchError("HTTP " + response.status, {
            source: "fetch",
            status: response.status,
          });
        }
      } catch (error) {
        lastError = error;
      } finally {
        if (abortTimer) {
          window.clearInterval(abortTimer);
        }
      }

      if (typeof GM_xmlhttpRequest === "function") {
        try {
          return await fetchPdfBytesWithTampermonkey(pdfUrl);
        } catch (error) {
          lastError = error;
        }
      }

      abortIfWorkflowStopped();
      await sleep(PDF_FETCH_RETRY_INTERVAL_MS);
    }

    const error = new Error("téléchargement PDF impossible après 15 s : " + (lastError ? lastError.message : "erreur inconnue"));
    if (lastError && lastError.pdfFetchInfo) {
      error.pdfFetchInfo = lastError.pdfFetchInfo;
    }
    throw error;
  }

  async function fetchPdfBytesWithTampermonkey(pdfUrl) {
    let lastError = null;

    for (const responseType of ["blob", "arraybuffer", ""]) {
      try {
        const bytes = await requestPdfBytesWithTampermonkey(pdfUrl, responseType);
        if (bytes.length) {
          return bytes;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || createPdfFetchError("requête PDF Tampermonkey vide", {
      source: "tampermonkey",
      byteLength: 0,
    });
  }

  function requestPdfBytesWithTampermonkey(pdfUrl, responseType = "blob") {
    return new Promise((resolve, reject) => {
      let request = null;
      const abortTimer = window.setInterval(() => {
        if (isWorkflowStopped() && request && typeof request.abort === "function") {
          request.abort();
        }
      }, 250);

      const finish = (callback) => {
        window.clearInterval(abortTimer);
        callback();
      };

      request = GM_xmlhttpRequest({
        method: "GET",
        url: pdfUrl,
        ...(responseType ? { responseType } : {}),
        headers: {
          Accept: "application/pdf,*/*",
        },
        anonymous: false,
        withCredentials: true,
        timeout: PDF_FETCH_RETRY_MS,
        onload: (response) => finish(async () => {
          if (response.status >= 200 && response.status < 300) {
            try {
              const bytes = await normalizePdfResponseBytes(response.response || response.responseText || "", {
                source: "tampermonkey",
                responseType: responseType || "text",
                status: response.status,
                contentType: response.responseHeaders || "",
              });

              if (bytes.length) {
                resolve(bytes);
                return;
              }

              reject(createPdfFetchError("corps PDF vide via Tampermonkey", {
                source: "tampermonkey",
                responseType: responseType || "text",
                status: response.status,
                byteLength: 0,
                contentType: response.responseHeaders || "",
              }));
            } catch (error) {
              reject(error);
            }
            return;
          }

          reject(createPdfFetchError("HTTP " + response.status, {
            source: "tampermonkey",
            responseType: responseType || "text",
            status: response.status,
            contentType: response.responseHeaders || "",
          }));
        }),
        onerror: () => finish(() => reject(new Error("requête PDF Tampermonkey en échec"))),
        ontimeout: () => finish(() => reject(new Error("requête PDF Tampermonkey expirée"))),
        onabort: () => finish(() => reject(new Error("requête PDF Tampermonkey annulée"))),
      });
    });
  }

  async function normalizePdfResponseBytes(body, fetchInfo = {}) {
    let bytes = null;

    if (body instanceof Uint8Array) {
      bytes = body;
    } else if (body instanceof ArrayBuffer) {
      bytes = new Uint8Array(body);
    } else if (body && typeof body.arrayBuffer === "function") {
      bytes = new Uint8Array(await body.arrayBuffer());
      fetchInfo.contentType = fetchInfo.contentType || body.type || "";
      fetchInfo.blobSize = Number.isFinite(Number(body.size)) ? Number(body.size) : null;
    } else if (typeof body === "string") {
      bytes = binaryStringToUint8Array(body);
    } else if (body && typeof body === "object" && Number.isFinite(Number(body.byteLength))) {
      try {
        bytes = new Uint8Array(body);
      } catch (_error) {
        bytes = new Uint8Array(0);
      }
    } else {
      bytes = new Uint8Array(0);
    }

    bytes.pdfFetchInfo = {
      ...fetchInfo,
      byteLength: bytes.length,
      header: bytes.length ? bytesToAscii(bytes.slice(0, 8)) : "",
    };

    return bytes;
  }

  function binaryStringToUint8Array(text) {
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
      bytes[index] = text.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  function uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
  }

  function base64ToUint8Array(base64) {
    const binary = atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  function bytesToAscii(bytes) {
    return Array.from(bytes || [])
      .map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".")
      .join("");
  }

  function createPdfFetchError(message, fetchInfo = {}) {
    const error = new Error(message);
    error.pdfFetchInfo = fetchInfo;
    return error;
  }

  async function extractPdfPageText(page) {
    const textContent = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });

    const items = textContent.items
      .map((item) => ({
        text: normalizeText(item.str || ""),
        x: item.transform ? item.transform[4] : 0,
        y: item.transform ? item.transform[5] : 0,
      }))
      .filter((item) => item.text);

    if (!items.length) {
      return "";
    }

    items.sort((left, right) => {
      const yDiff = right.y - left.y;
      return Math.abs(yDiff) > 2 ? yDiff : left.x - right.x;
    });

    const lines = [];
    items.forEach((item) => {
      const last = lines[lines.length - 1];
      if (!last || Math.abs(last.y - item.y) > 2.5) {
        lines.push({ y: item.y, parts: [item] });
        return;
      }
      last.parts.push(item);
    });

    return lines
      .map((line) => line.parts
        .sort((left, right) => left.x - right.x)
        .map((part) => part.text)
        .join(" "))
      .map(normalizeText)
      .filter(Boolean)
      .join("\n");
  }

  function truncateDocumentText(value) {
    const text = normalizePdfText(value);

    if (text.length <= MAX_PDF_TEXT_LENGTH) {
      return text;
    }

    const headLength = Math.floor(MAX_PDF_TEXT_LENGTH * 0.65);
    const tailLength = MAX_PDF_TEXT_LENGTH - headLength;
    return normalizePdfText(
      text.slice(0, headLength) +
      "\n\n[Document tronqué par le script : début et fin conservés.]\n\n" +
      text.slice(-tailLength)
    );
  }

  function normalizePdfText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .split(/\n+/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function setupRememberedTitleAutofill() {
    const list = document.querySelector(MESSAGE_LIST_SELECTOR);
    if (list) {
      list.addEventListener("click", () => {
        window.setTimeout(() => applyRememberedTitleForSelectedRow({ autoSave: true }), 1500);
      }, true);
    }

    if (!titleAutofillInterval) {
      titleAutofillInterval = window.setInterval(() => {
        applyRememberedTitleForSelectedRow({ autoSave: true, silent: true, enforcePriority: true });
      }, TITLE_PRIORITY_WATCH_INTERVAL_MS);
    }

    const container = document.querySelector("#messageContainer") || document.body;
    if (!container || typeof MutationObserver === "undefined") {
      return;
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => applyRememberedTitleForSelectedRow({ autoSave: true }), 500);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });
  }

  async function applyRememberedTitleForSelectedRow(options = {}) {
    const state = getState();
    const item = getSelectedBiologyItem();

    if (item && !isDisplayedBiologyForRow(item)) {
      return;
    }

    const urlKey = getDisplayedPdfUrlKey();
    const rememberedEntry = getRememberedTitleForKeys([
      urlKey,
      item && item.key,
      item && item.stableKey,
    ]);
    const remembered = rememberedEntry.title;

    if (!remembered) {
      return;
    }

    let input = findWedaTitleInput();

    if (!input) {
      if (state.running && state.phase !== "savingTitle") {
        return;
      }

      if (options.autoOpenInput === false || titleAutofillInputOpening) {
        return;
      }

      titleAutofillInputOpening = true;
      appendDebugLog("weda:remembered-title-input-open", {
        rowIndex: item ? item.index : null,
        rememberedKey: rememberedEntry.key,
        lookupKeys: rememberedEntry.keys,
      });

      let openedInput = null;
      try {
        openedInput = await ensureWedaTitleInputVisible("");
      } catch (error) {
        appendDebugLog("weda:remembered-title-input-open-error", {
          rowIndex: item ? item.index : null,
          rememberedKey: rememberedEntry.key,
          error: error && error.message ? error.message : String(error),
        });
        return;
      } finally {
        titleAutofillInputOpening = false;
      }

      if (!openedInput) {
        appendDebugLog("weda:remembered-title-input-missing", {
          rowIndex: item ? item.index : null,
          rememberedKey: rememberedEntry.key,
        });
        return;
      }

      await sleep(120);
      applyRememberedTitleToInput(findWedaTitleInput() || openedInput, rememberedEntry, item, {
        ...options,
        force: true,
        openedInput: true,
      });
      return;
    }

    applyRememberedTitleToInput(input, rememberedEntry, item, {
      enforcePriority: true,
      ...options,
    });
  }

  function applyRememberedTitleToInput(input, rememberedEntry, item, options = {}) {
    const remembered = rememberedEntry && rememberedEntry.title;

    if (!input || !remembered) {
      appendDebugLog("weda:remembered-title-input-unusable", {
        rowIndex: item ? item.index : null,
        hasInput: Boolean(input),
        rememberedKey: rememberedEntry ? rememberedEntry.key : "",
      });
      return false;
    }

    const currentTitle = sanitizeTitle(input.value);
    const enforcePriority = options.enforcePriority !== false;

    if (currentTitle === remembered) {
      touchRememberedTitleKeys(rememberedEntry.keys, remembered);
      if (!options.silent) {
        appendDebugLog("weda:remembered-title-already-present", {
          rowIndex: item ? item.index : null,
          rememberedKey: rememberedEntry.key,
          titleLength: remembered.length,
        });
      }
      return true;
    }

    if (currentTitle && !options.force && !enforcePriority && !isRememberedTitleFromAnotherBiology(currentTitle, rememberedEntry.keys)) {
      appendDebugLog("weda:remembered-title-skip-existing", {
        rowIndex: item ? item.index : null,
        rememberedKey: rememberedEntry.key,
        currentLength: currentTitle.length,
        titleLength: remembered.length,
      });
      return false;
    }

    try {
      input.focus();
    } catch (_error) {
      // Le focus est seulement une aide pour Angular/Weda.
    }

    setNativeInputValue(input, remembered);
    touchRememberedTitleKeys(rememberedEntry.keys, remembered);

    if (options.autoSave) {
      triggerWedaTitleSave(input);
    }

    appendDebugLog(currentTitle ? "weda:remembered-title-priority-restore" : "weda:remembered-title-applied", {
      rowIndex: item ? item.index : null,
      rememberedKey: rememberedEntry.key,
      autoSave: Boolean(options.autoSave),
      previousLength: currentTitle.length,
      titleLength: remembered.length,
    });

    if (!options.noRetry) {
      window.setTimeout(() => {
        const freshInput = findWedaTitleInput();
        if (!freshInput || sanitizeTitle(freshInput.value) === remembered) {
          return;
        }

        applyRememberedTitleToInput(freshInput, rememberedEntry, item, {
          ...options,
          force: true,
          noRetry: true,
          silent: true,
        });
      }, 600);
    }

    if (!options.silent) {
      const lineLabel = item ? " pour le courrier " + (item.index + 1) : "";
      setPanelStatus((currentTitle ? "Titre du script rétabli" : "Titre mémorisé réaffiché") + lineLabel + ".");
    }

    return true;
  }

  function rememberTitle(rowKey, title, metadata = {}) {
    if (!rowKey || !title) {
      return;
    }

    const cleanTitle = sanitizeTitle(title);

    if (!isExpectedTitleLine(cleanTitle)) {
      appendDebugLog("weda:remember-title-rejected", {
        rowKey,
        titleLength: cleanTitle.length,
      });
      return;
    }

    const titles = GM_getValue(TITLES_KEY, {});
    const previous = titles[rowKey] || {};
    const now = Date.now();
    titles[rowKey] = {
      ...previous,
      title: cleanTitle,
      ...metadata,
      createdAt: previous.createdAt || now,
      updatedAt: now,
      lastUsedAt: previous.lastUsedAt || now,
    };

    GM_setValue(TITLES_KEY, pruneRememberedTitles(titles));
  }

  function getRememberedTitle(rowKey) {
    if (!rowKey) {
      return "";
    }

    const titles = GM_getValue(TITLES_KEY, {});
    const entry = titles[rowKey];
    const title = entry ? sanitizeTitle(entry.title) : "";

    if (title && !isExpectedTitleLine(title)) {
      delete titles[rowKey];
      GM_setValue(TITLES_KEY, titles);
      appendDebugLog("weda:remembered-title-dropped", {
        rowKey,
        titleLength: title.length,
      });
      return "";
    }

    return title;
  }

  function touchRememberedTitleKeys(keys, expectedTitle = "") {
    const lookupKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));
    const cleanExpectedTitle = sanitizeTitle(expectedTitle);

    if (!lookupKeys.length) {
      return;
    }

    const titles = GM_getValue(TITLES_KEY, {});
    const now = Date.now();
    let changed = false;

    lookupKeys.forEach((key) => {
      const entry = titles[key];
      const title = sanitizeTitle(entry && entry.title);

      if (!title || (cleanExpectedTitle && title !== cleanExpectedTitle)) {
        return;
      }

      const lastUsedAt = Number(entry.lastUsedAt || 0);
      if (lastUsedAt && now - lastUsedAt < REMEMBERED_TITLE_TOUCH_INTERVAL_MS) {
        return;
      }

      titles[key] = {
        ...entry,
        lastUsedAt: now,
      };
      changed = true;
    });

    if (changed) {
      GM_setValue(TITLES_KEY, pruneRememberedTitles(titles));
    }
  }

  function pruneRememberedTitles(titles) {
    const entries = Object.entries(titles || {})
      .filter(([_key, entry]) => entry && isExpectedTitleLine(sanitizeTitle(entry.title)))
      .sort((left, right) => getRememberedTitleSortTime(right[1]) - getRememberedTitleSortTime(left[1]))
      .slice(0, MAX_REMEMBERED_TITLES);

    return Object.fromEntries(entries);
  }

  function getRememberedTitleSortTime(entry) {
    return Math.max(
      Number(entry && entry.lastUsedAt) || 0,
      Number(entry && entry.updatedAt) || 0,
      Number(entry && entry.createdAt) || 0
    );
  }

  function getRememberedTitleForKeys(keys) {
    const lookupKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));

    for (const key of lookupKeys) {
      const title = getRememberedTitle(key);
      if (title) {
        return { key, keys: lookupKeys, title };
      }
    }

    return { key: "", keys: lookupKeys, title: "" };
  }

  function isRememberedTitleFromAnotherBiology(title, currentKeys) {
    const currentTitle = sanitizeTitle(title);
    const currentKeySet = new Set((Array.isArray(currentKeys) ? currentKeys : [currentKeys]).filter(Boolean));
    const titles = GM_getValue(TITLES_KEY, {});

    return Object.entries(titles).some(([key, entry]) => {
      const rememberedTitle = sanitizeTitle(entry && entry.title);
      return !currentKeySet.has(key) && isExpectedTitleLine(rememberedTitle) && rememberedTitle === currentTitle;
    });
  }

  function getSeenRowMap() {
    return GM_getValue(AUTO_SEEN_ROWS_KEY, {});
  }

  function getAutoRowKey(row) {
    return row ? (row.key || row.stableKey || "") : "";
  }

  function isAutoRowSeen(row, seen = getSeenRowMap()) {
    const rowKey = getAutoRowKey(row);
    return Boolean(rowKey && seen[rowKey]);
  }

  function markRowsSeen(rows) {
    const seen = getSeenRowMap();
    rows.forEach((row) => {
      const rowKey = getAutoRowKey(row);
      if (rowKey) {
        seen[rowKey] = Date.now();
      }
    });
    saveSeenRowMap(seen);
  }

  function markRowSeen(rowKey) {
    if (!rowKey) {
      return;
    }

    const seen = getSeenRowMap();
    seen[rowKey] = Date.now();
    saveSeenRowMap(seen);
  }

  function saveSeenRowMap(seen) {
    const entries = Object.entries(seen)
      .sort((left, right) => (right[1] || 0) - (left[1] || 0))
      .slice(0, MAX_AUTO_SEEN_ROWS);

    GM_setValue(AUTO_SEEN_ROWS_KEY, Object.fromEntries(entries));
  }

  function findNextAutoRowIndex(state = getState()) {
    const rows = getBiologyRows();
    const seen = getSeenRowMap();
    const targetKeys = new Set(state.autoTargetKeys || []);
    const next = rows.find((row) => targetKeys.has(getAutoRowKey(row)) && !isAutoRowSeen(row, seen));

    return next ? next.index : -1;
  }

  function findNextManualRowIndex(state = getState()) {
    const rows = getBiologyRows();
    const currentIndex = Number.isFinite(Number(state.currentIndex)) ? Number(state.currentIndex) : -1;
    const nextIndex = currentIndex + 1;

    return nextIndex < rows.length ? nextIndex : -1;
  }

  function finishAutoCycle(message) {
    const nextCheckAt = Date.now() + AUTO_INTERVAL_MS;
    setState({
      running: false,
      mode: "manual",
      phase: "autoIdle",
      currentIndex: 0,
      currentRowKey: null,
      currentStableKey: null,
      currentContentKey: null,
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      autoTargetKeys: [],
      manualTargetKeys: [],
      autoNextCheckAt: nextCheckAt,
      message: message + " Prochaine vérification vers " + formatTime(nextCheckAt) + ".",
    });
    scheduleAutoRefresh();
  }

  function clickBiologyRow(index) {
    const state = getState();
    const rows = getBiologyRows();
    patientImportBeforePdfStableKey = "";
    lastPatientImportPerformanceStartTime = 0;

    if (index >= rows.length) {
      GM_deleteValue(JOB_KEY);
      GM_deleteValue(RESULT_KEY);

      if (state.mode === "auto") {
        finishAutoCycle("Veille auto : traitement terminé.");
        return;
      }

      setState({
        running: false,
        mode: "manual",
        phase: "done",
        currentJobId: null,
        allowUnchangedContentKey: "",
        manualTargetKeys: [],
        message: "Terminé : " + rows.length + " courrier(s) parcouru(s).",
      });
      scheduleAutoRefresh();
      return;
    }

    const row = rows[index];
    const previousContentKey = getDisplayedBiologyContentKey();
    const alreadyDisplayed = getSelectedBiologyIndex() === index && isDisplayedBiologyForRow(row);

    setState({
      running: true,
      phase: "clickedRow",
      currentIndex: index,
      currentRowKey: row.key,
      currentStableKey: row.stableKey,
      previousContentKey,
      allowUnchangedContentKey: alreadyDisplayed ? previousContentKey : "",
      currentJobId: null,
      message: "Ouverture du courrier " + (index + 1) + "/" + rows.length + "...",
    });

    const clickedStableKey = row.stableKey;
    const clickedIndex = row.index;

    try {
      triggerWedaBiologyRowOpen(row, "initial");
      scheduleWedaRowOpenRetries(row, previousContentKey);
    } catch (error) {
      appendDebugLog("weda:row-open-error", {
        rowIndex: row.index,
        error: error.message,
      });
      failWeda("Impossible d'ouvrir le courrier : " + error.message);
      return;
    }

    window.setTimeout(() => {
      const state = getState();
      if (
        state.running &&
        state.phase === "clickedRow" &&
        state.currentStableKey === clickedStableKey &&
        state.currentIndex === clickedIndex
      ) {
        extractAndSendCurrentBiology();
      }
    }, 1600);
  }

  async function extractAndSendCurrentBiology() {
    const state = getState();
    const rows = getBiologyRows();
    const row = getCurrentWorkflowRow(state, rows);
    appendDebugLog("weda:extract-start", {
      phase: state.phase,
      currentIndex: state.currentIndex,
      rows: rows.length,
      hasTargetRow: Boolean(row),
    });

    if (isWorkflowStopped(state) || state.phase !== "clickedRow") {
      return;
    }

    if (!row) {
      failWeda("La ligne Weda en cours est introuvable.");
      return;
    }

    setPanelStatus("Lecture du courrier " + (state.currentIndex + 1) + "/" + (rows.length || "?") + "...");

    try {
      if (row.index !== state.currentIndex || row.stableKey !== state.currentStableKey) {
        setState({
          currentIndex: row.index,
          currentRowKey: row.key,
          currentStableKey: row.stableKey,
        });
      }

      if (!isCurrentRowWorkflowActive(row)) {
        appendDebugLog("weda:extract-cancelled-before-wait", {
          rowIndex: row.index,
          stableKey: row.stableKey,
        });
        return;
      }

      const importPreparation = await prepareImportBeforePdfWait(row);

      if (!isCurrentRowWorkflowActive(row)) {
        appendDebugLog("weda:extract-cancelled-after-import-prep", {
          rowIndex: row.index,
          stableKey: row.stableKey,
        });
        return;
      }

      const displayedDocument = await waitForDisplayedBiology(row, state.previousContentKey || "", {
        allowContentKey: state.allowUnchangedContentKey || "",
        pdfPerformanceStartTime: importPreparation.pdfPerformanceStartTime || 0,
      });

      if (!isCurrentRowWorkflowActive(row)) {
        appendDebugLog("weda:extract-cancelled-after-wait", {
          rowIndex: row.index,
          stableKey: row.stableKey,
          contentKey: displayedDocument && displayedDocument.contentKey,
        });
        return;
      }

      const documentText = displayedDocument.tableText;
      const contentKey = displayedDocument.contentKey;

      if (importPreparation.titleInputRequired && !findWedaTitleInput()) {
        throw new Error("champ titre indisponible après ouverture Un patient");
      }

      appendDebugLog("weda:displayed-document-ready", {
        rowIndex: row.index,
        contentKey,
        urlKey: displayedDocument.urlKey,
        sourceType: displayedDocument.sourceType,
        pdfUrlHash: hashString(displayedDocument.pdfUrl || ""),
        pdfAttachment: Boolean(displayedDocument.pdfAttachmentBase64),
        pdfAttachmentByteLength: displayedDocument.pdfAttachmentByteLength || 0,
        pdfTextExtractionEmpty: Boolean(displayedDocument.pdfTextExtractionEmpty),
        documentLines: countBiologyLinesForLog(documentText, "pdf"),
        documentLength: documentText.length,
      });

      if ((!documentText || documentText.length < 20) && !displayedDocument.pdfAttachmentBase64) {
        throw new Error("Le texte du PDF est vide ou illisible.");
      }

      if (!isCurrentRowWorkflowActive(row)) {
        appendDebugLog("weda:extract-cancelled-before-job", {
          rowIndex: row.index,
          stableKey: row.stableKey,
          contentKey,
        });
        return;
      }

      const jobId = createId("courrier");
      const job = {
        id: jobId,
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        rowIdentity: row.identityLabel,
        contentKey,
        urlKey: displayedDocument.urlKey,
        pdfUrl: displayedDocument.pdfUrl,
        tableText: documentText,
        tableHtml: "",
        sourceType: displayedDocument.sourceType || "pdf",
        pdfAttachmentBase64: displayedDocument.pdfAttachmentBase64 || "",
        pdfAttachmentName: displayedDocument.pdfAttachmentName || "",
        pdfAttachmentMimeType: displayedDocument.pdfAttachmentMimeType || "",
        pdfAttachmentByteLength: displayedDocument.pdfAttachmentByteLength || 0,
        pdfTextExtractionEmpty: Boolean(displayedDocument.pdfTextExtractionEmpty),
        prompt: HEIDI_PROMPT_ACTIVE,
        createdAt: Date.now(),
      };

      GM_deleteValue(RESULT_KEY);
      GM_setValue(JOB_KEY, job);
      appendDebugLog("weda:job-created", {
        jobId,
        rowIndex: row.index,
        contentKey,
        urlKey: displayedDocument.urlKey,
        sourceType: displayedDocument.sourceType || "pdf",
        pdfAttachment: Boolean(displayedDocument.pdfAttachmentBase64),
        pdfAttachmentByteLength: displayedDocument.pdfAttachmentByteLength || 0,
        pdfTextExtractionEmpty: Boolean(displayedDocument.pdfTextExtractionEmpty),
        documentLines: countBiologyLinesForLog(documentText, "pdf"),
        documentLength: documentText.length,
      });

      setState({
        running: true,
        phase: "waitingHeidi",
        currentJobId: jobId,
        currentContentKey: contentKey,
        currentPdfUrl: displayedDocument.pdfUrl,
        currentUrlKey: displayedDocument.urlKey,
        allowUnchangedContentKey: "",
        message: "Envoi à Heidi : courrier " + (state.currentIndex + 1) + "/" + (rows.length || "?") + ".",
      });

      openHeidiJobTab(jobId, {
        forceForeground: false,
        reason: "initial",
      });
      scheduleHeidiStartupWatchdog(jobId, job.createdAt, 1);
    } catch (error) {
      if (!isCurrentRowWorkflowActive(row)) {
        appendDebugLog("weda:extract-cancelled", {
          error: error.message,
          rowIndex: row && row.index,
          stableKey: row && row.stableKey,
          state: getState(),
        });
        return;
      }

      const pdfCandidates = getDisplayedPdfUrlCandidates({ includePerformance: true });
      appendDebugLog("weda:extract-error", {
        error: error.message,
        selectedIndex: getSelectedBiologyIndex(),
        pdfCandidateCount: pdfCandidates.length,
        pdfCandidateHashes: pdfCandidates.map((url) => hashString(url)),
        hasPlugin: Boolean(querySelectorAllDeep(document, PDF_EMBED_SELECTOR).length),
        hasAnyPdfElement: Boolean(getDisplayedPdfEmbed()),
      });

      skipOrFailCurrentDocument("Impossible de lire le courrier : " + error.message);
    }
  }

  function skipOrFailCurrentDocument(message) {
    const state = getState();

    if (isWorkflowStopped(state)) {
      appendDebugLog("weda:skip-ignored-after-stop", {
        message,
        phase: state.phase,
        currentIndex: state.currentIndex,
        currentRowKey: state.currentRowKey || state.currentStableKey,
      });
      return;
    }

    if (state.mode === "auto") {
      appendDebugLog("weda:skip-auto-document", {
        message,
        currentRowKey: state.currentRowKey || state.currentStableKey,
      });
      markRowSeen(state.currentRowKey || state.currentStableKey);
      const nextAutoIndex = findNextAutoRowIndex(state);

      if (nextAutoIndex >= 0) {
        if (isWorkflowStopped()) {
          appendDebugLog("weda:skip-auto-next-cancelled", { nextAutoIndex });
          return;
        }

        setState({
          running: true,
          mode: "auto",
          phase: "readyToClick",
          currentIndex: nextAutoIndex,
          currentRowKey: null,
          currentStableKey: null,
          currentContentKey: null,
          allowUnchangedContentKey: "",
          previousContentKey: null,
          currentJobId: null,
          manualTargetKeys: [],
          message: message + " Courrier ignoré, passage au suivant.",
        });
        clickBiologyRow(nextAutoIndex);
        return;
      }

      finishAutoCycle(message + " Courrier ignoré.");
      return;
    }

    appendDebugLog("weda:skip-manual-document", {
      message,
      currentIndex: state.currentIndex,
      currentRowKey: state.currentRowKey || state.currentStableKey,
    });

    const nextIndex = findNextManualRowIndex(state);

    if (nextIndex >= 0) {
      if (isWorkflowStopped()) {
        appendDebugLog("weda:skip-manual-next-cancelled", { nextIndex });
        return;
      }

      setState({
        running: true,
        mode: "manual",
        phase: "readyToClick",
        currentIndex: nextIndex,
        currentRowKey: null,
        currentStableKey: null,
        currentContentKey: null,
        currentPdfUrl: "",
        currentUrlKey: "",
        allowUnchangedContentKey: "",
        previousContentKey: null,
        currentJobId: null,
        message: message + " Courrier ignoré, passage au suivant.",
      });
      clickBiologyRow(nextIndex);
      return;
    }

    setState({
      running: false,
      mode: "manual",
      phase: "done",
      currentJobId: null,
      manualTargetKeys: [],
      message: message + " Aucun courrier suivant.",
    });
    scheduleAutoRefresh();
  }

  function isStructuredHprimTableText(_tableText) {
    return false;
  }

  function countBiologyLinesForLog(tableText, _sourceType = "") {
    return String(tableText || "").split(/\n+/).filter(Boolean).length;
  }

  function summarizeTableStatuses(tableText) {
    return {
      PDF: countBiologyLinesForLog(tableText, "pdf"),
    };
  }

  function getBiologyValueStatus() {
    return "";
  }

  function mergeBiologyStatuses(numericStatus, visualStatus) {
    return visualStatus || numericStatus || "";
  }

  function getBiologyVisualStatus() {
    return "";
  }

  function elementHasRedAnomalyStyle() {
    return false;
  }

  function isRedCssColor() {
    return false;
  }

  function parseBiologyNumber() {
    return null;
  }

  function isUsableBiologyNorm(value) {
    return Number.isFinite(value) && Math.abs(value) < 99999;
  }

  function isDefinitelyBelowMinimum() {
    return false;
  }

  function isDefinitelyAboveMaximum() {
    return false;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  }

  async function handleHeidiResult(result) {
    const state = getState();
    appendDebugLog("weda:result-received", {
      jobId: result && result.jobId,
      ok: Boolean(result && result.ok),
      statePhase: state.phase,
      expectedJobId: state.currentJobId,
      rawLength: result && result.raw ? String(result.raw).length : 0,
      contentKey: result && result.contentKey,
    });

    if (!state.running || state.phase !== "waitingHeidi" || result.jobId !== state.currentJobId) {
      return;
    }

    if (result.rowStableKey && result.rowStableKey !== state.currentStableKey) {
      setState({
        currentStableKey: result.rowStableKey,
        currentContentKey: result.contentKey || state.currentContentKey,
      });
    }

    GM_deleteValue(RESULT_KEY);

    if (!result.ok) {
      closeCurrentHeidiTab();
      appendDebugLog("weda:result-error", {
        jobId: result.jobId,
        error: result.error || "erreur inconnue",
      });
      skipOrFailCurrentDocument(`Heidi n'a pas renvoyé de titre : ${result.error || "erreur inconnue"}`);
      return;
    }

    closeCurrentHeidiTab();

    const title = sanitizeTitle(result.title || result.raw || "");
    appendDebugLog("weda:title-sanitized", {
      jobId: result.jobId,
      titleLength: title.length,
      rasLike: isRasLikeHeidiTitle(title),
    });

    if (!title) {
      failWeda("Le titre reçu de Heidi est vide.");
      return;
    }

    if (!isExpectedTitleLine(title)) {
      appendDebugLog("weda:title-rejected", {
        jobId: result.jobId,
        titleLength: title.length,
        promptInstructionLike: isPromptInstructionLine(title),
      });
      failWeda("Le titre reçu de Heidi ressemble à une consigne du prompt, il n'a pas été écrit dans Weda.");
      return;
    }

    if (!isCurrentJobStillActive(result.jobId, ["waitingHeidi"])) {
      appendDebugLog("weda:result-ignored-after-stop", {
        jobId: result.jobId,
        state: getState(),
      });
      return;
    }

    try {
      await fillAndSaveWedaTitle(title, result);
    } catch (error) {
      if (isWorkflowStopped()) {
        appendDebugLog("weda:title-insert-cancelled", {
          jobId: result.jobId,
          error: error.message,
          state: getState(),
        });
        return;
      }

      skipOrFailCurrentDocument(`Impossible d'insérer le titre Weda : ${error.message}`);
    }
  }

  async function ensureCurrentBiologyDisplayed(target = {}) {
    const state = getState();
    const targetJobId = target.jobId || "";

    if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingHeidi", "savingTitle"])) {
      throw new Error("analyse arrêtée");
    }

    const rows = getBiologyRows();
    const targetIndex = Number.isFinite(Number(target.rowIndex)) ? Number(target.rowIndex) : state.currentIndex;
    const targetStableKey = target.rowStableKey || state.currentStableKey;
    const targetPdfUrl = target.pdfUrl || state.currentPdfUrl || "";
    const matchingRows = findBiologyRowsByStableKey(targetStableKey, rows);
    const indexedTargetRow = findBiologyRowByIndexAndStableKey(targetIndex, targetStableKey, rows);
    const fallbackRow = rows[state.currentIndex];
    const row = indexedTargetRow || matchingRows[0] || fallbackRow;

    if (!row) {
      throw new Error("la ligne Weda cible est introuvable");
    }

    if ((!targetPdfUrl || getDisplayedPdfUrl() === targetPdfUrl) && isDisplayedBiologyForRow(row)) {
      return row;
    }

    const candidates = [indexedTargetRow, ...matchingRows, row]
      .filter(Boolean)
      .filter((candidate, index, list) => list.indexOf(candidate) === index);

    for (const candidate of candidates) {
      if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingHeidi", "savingTitle"])) {
        throw new Error("analyse arrêtée");
      }

      setPanelStatus("Retour sur le courrier cible pour enregistrer le titre...");

      setState({
        running: true,
        phase: "waitingHeidi",
        currentIndex: candidate.index,
        currentRowKey: candidate.key,
        currentStableKey: candidate.stableKey,
        previousContentKey: getDisplayedBiologyContentKey(),
        allowUnchangedContentKey: "",
      });

      triggerWedaBiologyRowOpen(candidate, "return-to-target");

      try {
        await waitFor(() => {
          if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingHeidi", "savingTitle"])) {
            throw new Error("analyse arrêtée");
          }

          const selectedOk = candidate.row.classList.contains("selected");
          const pdfUrl = getDisplayedPdfUrl();
          return selectedOk && pdfUrl && (!targetPdfUrl || pdfUrl === targetPdfUrl) ? pdfUrl : null;
        }, {
          timeout: 25000,
          interval: 350,
          description: "le courrier cible affiché",
        });

        if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingHeidi", "savingTitle"])) {
          throw new Error("analyse arrêtée");
        }

        setState({
          running: true,
          phase: "waitingHeidi",
          currentIndex: candidate.index,
          currentRowKey: candidate.key,
          currentStableKey: candidate.stableKey,
          currentPdfUrl: getDisplayedPdfUrl(),
          allowUnchangedContentKey: "",
        });

        return candidate;
      } catch (_error) {
        if (isWorkflowStopped() || /analyse arrêtée/i.test(_error && _error.message ? _error.message : "")) {
          throw _error;
        }

        if (!targetPdfUrl) {
          throw _error;
        }
      }
    }

    throw new Error("le courrier affiché ne correspond pas au PDF envoyé à Heidi");
  }

  async function fillAndSaveWedaTitle(title, result) {
    const target = {
      jobId: result.jobId,
      rowIndex: result.rowIndex,
      rowStableKey: result.rowStableKey || "",
      rowIdentity: result.rowIdentity || "",
      contentKey: result.contentKey || "",
      urlKey: result.urlKey || "",
      pdfUrl: result.pdfUrl || "",
    };

    if (!isCurrentJobStillActive(result.jobId, ["waitingHeidi", "savingTitle"])) {
      appendDebugLog("weda:title-fill-cancelled-before-start", {
        jobId: result.jobId,
        state: getState(),
      });
      return;
    }

    const targetRow = await ensureCurrentBiologyDisplayed(target);

    if (!isCurrentJobStillActive(result.jobId, ["waitingHeidi", "savingTitle"])) {
      appendDebugLog("weda:title-fill-cancelled-after-display", {
        jobId: result.jobId,
        targetRowIndex: targetRow && targetRow.index,
        state: getState(),
      });
      return;
    }

    const displayedPdfUrl = getDisplayedPdfUrl();
    const displayedUrlKey = getDisplayedPdfUrlKey();

    if (target.pdfUrl && displayedPdfUrl !== target.pdfUrl) {
      throw new Error("sécurité d'affectation : le PDF affiché ne correspond pas au résultat Heidi");
    }

    const titleMetadata = {
      rowStableKey: targetRow.stableKey,
      rowIdentity: targetRow.identityLabel,
      pdfUrlHash: hashString(target.pdfUrl || displayedPdfUrl || ""),
      contentKey: target.contentKey,
      urlKey: target.urlKey || displayedUrlKey,
    };

    [
      target.contentKey,
      target.urlKey || displayedUrlKey,
      targetRow.key,
      targetRow.stableKey,
    ].forEach((key) => rememberTitle(key, title, titleMetadata));

    const titleInputTarget = {
      pdfUrl: target.pdfUrl || displayedPdfUrl,
      urlKey: target.urlKey || displayedUrlKey,
      contentKey: target.contentKey,
    };
    const input = await ensureWedaTitleInputVisible(result.jobId, titleInputTarget);

    if (!isCurrentJobStillActive(result.jobId, ["waitingHeidi", "savingTitle"])) {
      appendDebugLog("weda:title-fill-cancelled-after-input-wait", {
        jobId: result.jobId,
        targetRowIndex: targetRow.index,
        hasInput: Boolean(input),
        state: getState(),
      });
      return;
    }

    if (!input) {
      appendDebugLog("weda:title-input-missing-skip", {
        jobId: result.jobId,
        targetRowIndex: targetRow.index,
        contentKey: target.contentKey,
        urlKey: target.urlKey || displayedUrlKey,
      });

      setState({
        running: true,
        phase: "savingTitle",
        currentIndex: targetRow.index,
        currentRowKey: targetRow.key,
        currentStableKey: targetRow.stableKey,
        currentContentKey: target.contentKey,
        currentPdfUrl: target.pdfUrl || displayedPdfUrl,
        currentUrlKey: target.urlKey || displayedUrlKey,
        allowUnchangedContentKey: "",
        currentJobId: result.jobId,
        message: "Champ titre indisponible après import, passage au courrier suivant...",
        lastTitle: title,
        lastTitleKey: target.contentKey || target.urlKey || displayedUrlKey,
      });

      window.setTimeout(() => goToNextBiology(result.jobId), 500);
      return;
    }

    appendDebugLog("weda:title-fill", {
      jobId: result.jobId,
      contentKey: target.contentKey,
      urlKey: target.urlKey || displayedUrlKey,
      titleLength: title.length,
      targetRowIndex: targetRow.index,
      inputIndex: getWedaTitleInputIndex(input),
      titleInputs: (document.querySelector("#messageContainer") || document).querySelectorAll("input.docTitle, input[placeholder='Titre du document'], input[title*='titre']").length,
      associatedWithPdf: isWedaTitleInputAssociatedWithPdf(input, titleInputTarget.pdfUrl),
      inputCurrentLength: sanitizeTitle(input.value).length,
    });

    setState({
      running: true,
      phase: "savingTitle",
      currentIndex: targetRow.index,
      currentRowKey: targetRow.key,
      currentStableKey: targetRow.stableKey,
      currentContentKey: target.contentKey,
      currentPdfUrl: target.pdfUrl || displayedPdfUrl,
      currentUrlKey: target.urlKey || displayedUrlKey,
      allowUnchangedContentKey: "",
      currentJobId: result.jobId,
      message: "Titre reçu, insertion dans Weda...",
      lastTitle: title,
      lastTitleKey: target.contentKey || target.urlKey || displayedUrlKey,
    });

    input.focus();
    setNativeInputValue(input, title);
    triggerWedaTitleSave(input);

    await guardWedaTitleStability({
      jobId: result.jobId,
      title,
      targetRow,
      targetPdfUrl: target.pdfUrl || displayedPdfUrl,
      urlKey: target.urlKey || displayedUrlKey,
      contentKey: target.contentKey,
    });

    window.setTimeout(() => goToNextBiology(result.jobId), NEXT_AFTER_TITLE_STABLE_MS);
  }

  function setNativeInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  function triggerWedaTitleSave(input) {
    try {
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: input.value,
      }));
    } catch (_error) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", enterKeyOptions()));
    input.dispatchEvent(new KeyboardEvent("keyup", enterKeyOptions()));

    try {
      input.blur();
    } catch (_error) {
      // Le changement Angular est déjà notifié par les événements précédents.
    }
  }

  async function guardWedaTitleStability(options = {}) {
    const jobId = options.jobId || "";
    const title = sanitizeTitle(options.title || "");
    const targetRow = options.targetRow || null;
    const targetPdfUrl = options.targetPdfUrl || "";
    const startedAt = Date.now();
    let restoredCount = 0;
    let inputMissingSince = 0;
    let reopenAttemptedAt = 0;

    if (!jobId || !title || !targetRow) {
      return false;
    }

    appendDebugLog("weda:title-stability-start", {
      jobId,
      targetRowIndex: targetRow.index,
      rowStableKey: targetRow.stableKey,
      urlKey: options.urlKey || "",
      contentKey: options.contentKey || "",
      guardMs: TITLE_STABILITY_GUARD_MS,
      titleLength: title.length,
    });

    while (Date.now() - startedAt <= TITLE_STABILITY_GUARD_MS) {
      if (!isCurrentJobStillActive(jobId, ["savingTitle"])) {
        appendDebugLog("weda:title-stability-cancelled", {
          jobId,
          restoredCount,
          state: getState(),
        });
        return false;
      }

      if (!isWedaTitleStabilityTargetStillDisplayed(targetRow, targetPdfUrl)) {
        appendDebugLog("weda:title-stability-target-changed", {
          jobId,
          restoredCount,
          selectedIndex: getSelectedBiologyIndex(),
          expectedRowIndex: targetRow.index,
          expectedPdfHash: targetPdfUrl ? hashString(targetPdfUrl) : "",
          displayedPdfHash: getDisplayedPdfUrl() ? hashString(getDisplayedPdfUrl()) : "",
        });
        return false;
      }

      let input = findWedaTitleInput({ pdfUrl: targetPdfUrl });

      if (!input) {
        inputMissingSince = inputMissingSince || Date.now();
        if (
          Date.now() - inputMissingSince >= TITLE_STABILITY_REOPEN_INPUT_AFTER_MS &&
          (!reopenAttemptedAt || Date.now() - reopenAttemptedAt >= TITLE_STABILITY_REOPEN_INPUT_AFTER_MS)
        ) {
          reopenAttemptedAt = Date.now();
          appendDebugLog("weda:title-stability-input-reopen", {
            jobId,
            missingMs: Date.now() - inputMissingSince,
            restoredCount,
          });
          input = await ensureWedaTitleInputVisible(jobId, { pdfUrl: targetPdfUrl });
          if (!isCurrentJobStillActive(jobId, ["savingTitle"])) {
            return false;
          }
          if (!isWedaTitleStabilityTargetStillDisplayed(targetRow, targetPdfUrl)) {
            return false;
          }
        }

        if (!input) {
          await sleep(TITLE_STABILITY_CHECK_INTERVAL_MS);
          continue;
        }
      }

      inputMissingSince = 0;
      const currentTitle = sanitizeTitle(input.value);

      if (currentTitle !== title) {
        restoredCount += 1;
        appendDebugLog("weda:title-restored-after-clear", {
          jobId,
          restoredCount,
          currentLength: currentTitle.length,
          titleLength: title.length,
          targetRowIndex: targetRow.index,
        });
        try {
          input.focus();
        } catch (_error) {
          // Le champ peut être recréé par Angular, la sauvegarde reste tentée.
        }
        setNativeInputValue(input, title);
        triggerWedaTitleSave(input);
      }

      await sleep(TITLE_STABILITY_CHECK_INTERVAL_MS);
    }

    const finalInput = findWedaTitleInput({ pdfUrl: targetPdfUrl });
    const finalTitle = sanitizeTitle(finalInput && finalInput.value);
    if (finalInput && finalTitle === title) {
      triggerWedaTitleSave(finalInput);
    }

    appendDebugLog("weda:title-stability-ok", {
      jobId,
      restoredCount,
      finalPresent: finalTitle === title,
      finalLength: finalTitle.length,
      elapsedMs: Date.now() - startedAt,
    });
    return finalTitle === title;
  }

  function isWedaTitleStabilityTargetStillDisplayed(targetRow, targetPdfUrl = "") {
    if (!targetRow) {
      return false;
    }

    const rows = getBiologyRows();
    const row = findBiologyRowByIndexAndStableKey(targetRow.index, targetRow.stableKey, rows) ||
      findBiologyRowByStableKey(targetRow.stableKey, rows);
    const selectedIndex = getSelectedBiologyIndex();
    const displayedPdfUrl = getDisplayedPdfUrl();

    if (!row) {
      return false;
    }

    if (selectedIndex >= 0 && selectedIndex !== row.index) {
      return false;
    }

    if (targetPdfUrl && displayedPdfUrl && displayedPdfUrl !== targetPdfUrl) {
      return false;
    }

    return true;
  }

  function goToNextBiology(jobId) {
    const state = getState();

    if (!state.running || state.phase !== "savingTitle" || state.currentJobId !== jobId) {
      return;
    }

    markRowSeen(state.currentRowKey || state.currentStableKey);

    if (state.mode === "auto") {
      const nextAutoIndex = findNextAutoRowIndex(state);

      if (nextAutoIndex < 0) {
        finishAutoCycle("Veille auto : nouveaux courriers traités.");
        return;
      }

      setState({
        running: true,
        mode: "auto",
        phase: "readyToClick",
        currentIndex: nextAutoIndex,
        currentRowKey: null,
        currentStableKey: null,
        currentContentKey: null,
        currentPdfUrl: "",
        currentUrlKey: "",
        allowUnchangedContentKey: "",
        previousContentKey: null,
        currentJobId: null,
        manualTargetKeys: [],
        message: "Veille auto : passage au nouveau courrier suivant...",
      });

      clickBiologyRow(nextAutoIndex);
      return;
    }

    const nextIndex = findNextManualRowIndex(state);
    appendDebugLog("weda:next-manual", {
      jobId,
      currentIndex: state.currentIndex,
      currentStableKey: state.currentStableKey,
      nextIndex,
      rows: getBiologyRows().length,
    });

    if (nextIndex < 0) {
      const rows = getBiologyRows();
      setState({
        running: false,
        mode: "manual",
        phase: "done",
        currentJobId: null,
        manualTargetKeys: [],
        message: "Terminé : " + rows.length + " courrier(s) parcouru(s).",
      });
      scheduleAutoRefresh();
      return;
    }

    setState({
      running: true,
      mode: "manual",
      phase: "readyToClick",
      currentIndex: nextIndex,
      currentRowKey: null,
      currentStableKey: null,
      currentContentKey: null,
      currentPdfUrl: "",
      currentUrlKey: "",
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      message: "Passage au courrier suivant...",
    });

    clickBiologyRow(nextIndex);
  }

  function openHeidiJobTab(jobId, options = {}) {
    const forceForeground = Boolean(options.forceForeground);
    const background = HEIDI_WORKERS_OPEN_IN_BACKGROUND && !forceForeground;

    currentHeidiTab = GM_openInTab(`${HEIDI_URL}?wedaCourrierJob=${encodeURIComponent(jobId)}`, {
      active: !background,
      insert: !background,
      setParent: true,
    });
    appendDebugLog("weda:heidi-tab-opened", {
      jobId,
      reason: options.reason || "",
      background,
      active: !background,
      insert: !background,
    });
  }

  function scheduleHeidiStartupWatchdog(jobId, launchedAt, reopenAttempt = 1) {
    window.setTimeout(() => {
      const state = getState();

      if (!state.running || state.phase !== "waitingHeidi" || state.currentJobId !== jobId) {
        return;
      }

      const result = GM_getValue(RESULT_KEY, null);
      if (result && result.jobId === jobId) {
        return;
      }

      const status = GM_getValue(STATUS_KEY, null);
      const hasFreshStatus = status &&
        status.jobId === jobId &&
        (!launchedAt || !status.createdAt || status.createdAt >= launchedAt);

      if (hasFreshStatus) {
        return;
      }

      appendDebugLog("weda:heidi-startup-timeout", {
        jobId,
        reopenAttempt,
        launchedAt,
        lastStatusJobId: status ? status.jobId : "",
        lastStatusAgeMs: status && status.createdAt ? Date.now() - status.createdAt : null,
      });

      if (reopenAttempt > HEIDI_STARTUP_MAX_REOPENS) {
        failWeda("Heidi ne démarre pas pour ce courrier. Ouvrez Heidi au premier plan puis relancez l'analyse.");
        return;
      }

      closeCurrentHeidiTab();
      setPanelStatus("Heidi ne démarre pas en arrière-plan, ouverture au premier plan...");
      openHeidiJobTab(jobId, {
        forceForeground: true,
        reason: `startup-watchdog-${reopenAttempt}`,
      });
      scheduleHeidiStartupWatchdog(jobId, Date.now(), reopenAttempt + 1);
    }, HEIDI_STARTUP_WATCHDOG_MS);
  }

  function failWeda(message) {
    appendDebugLog("weda:fail", {
      message,
      state: getState(),
    });
    GM_deleteValue(JOB_KEY);
    const state = getState();
    const nextCheckAt = state.autoEnabled ? Date.now() + AUTO_INTERVAL_MS : state.autoNextCheckAt;
    setState({
      running: false,
      mode: "manual",
      phase: "error",
      autoTargetKeys: [],
      manualTargetKeys: [],
      autoNextCheckAt: nextCheckAt,
      allowUnchangedContentKey: "",
      currentJobId: null,
      message,
    });
    scheduleAutoRefresh();
  }

  function closeCurrentHeidiTab() {
    if (!currentHeidiTab || typeof currentHeidiTab.close !== "function") {
      appendDebugLog("weda:heidi-tab-close-skip", {
        hasTab: Boolean(currentHeidiTab),
      });
      currentHeidiTab = null;
      return;
    }

    try {
      appendDebugLog("weda:heidi-tab-close", {});
      currentHeidiTab.close();
    } catch (_error) {
      // L'onglet Heidi tente aussi de se fermer lui-même après avoir transmis le résultat.
    } finally {
      currentHeidiTab = null;
    }
  }

  async function initHeidi() {
    const jobId = new URLSearchParams(location.search).get("wedaCourrierJob");

    if (!jobId) {
      return;
    }

    markHeidiTabAsCourrierWorker(jobId);

    appendDebugLog("heidi:init", {
      jobId,
      version: getScriptVersion(),
      contextTabs: document.querySelectorAll('[data-testid="session-tab-context"], button[id="context/"], [role="tab"][id="context/"]').length,
      askInputs: document.querySelectorAll(".ask-ai-input [contenteditable='true'], .ask-ai-input textarea").length,
    });
    setupHeidiDebugLifecycleLogs(jobId);
    GM_addValueChangeListener(CANCEL_KEY, (_name, _oldValue, cancel) => {
      if (isCancellationForJob(cancel, jobId)) {
        appendDebugLog("heidi:cancel-signal-received", {
          jobId,
          reason: cancel && cancel.reason,
        });
        window.setTimeout(() => window.close(), 250);
      }
    });

    try {
      const job = await waitForJob(jobId);
      abortIfHeidiJobCancelled(jobId);
      appendDebugLog("heidi:job-loaded", {
        jobId,
        contentKey: job.contentKey,
        urlKey: job.urlKey || "",
        sourceType: job.sourceType || "pdf",
        documentLines: countBiologyLinesForLog(job.tableText, "pdf"),
        documentLength: String(job.tableText || "").length,
      });
      updateHeidiStatus(jobId, "Heidi chargé, prise en charge du courrier...");
      await claimJob(jobId);
      abortIfHeidiJobCancelled(jobId);
      await runHeidiJob(job);
    } catch (error) {
      if (isHeidiCancellationError(error, jobId)) {
        appendDebugLog("heidi:cancelled", {
          jobId,
          error: error.message,
        });
        window.setTimeout(() => window.close(), 250);
        return;
      }

      appendDebugLog("heidi:error", {
        jobId,
        error: error.message,
      });
      GM_setValue(RESULT_KEY, {
        jobId,
        ok: false,
        error: error.message,
        createdAt: Date.now(),
      });
      updateHeidiStatus(jobId, "Erreur Heidi : " + error.message);
    }
  }

  function markHeidiTabAsCourrierWorker(jobId = "") {
    try {
      sessionStorage.setItem(HEIDI_COURRIER_TAB_ROLE_KEY, "courrier");
      if (jobId) {
        sessionStorage.setItem(`${STORAGE_PREFIX}heidiTabJobId`, jobId);
      }
    } catch (_error) {
      // sessionStorage peut être indisponible dans certains contextes stricts.
    }
  }

  function extractHeidiSessionIdFromUrl(urlValue = location.href) {
    try {
      const url = new URL(urlValue || location.href, location.origin);
      const match = String(url.pathname || "").match(/\/scribe\/session\/([^\/?#]+)/i);
      return match && match[1] ? decodeURIComponent(match[1]) : "";
    } catch (_error) {
      const match = String(urlValue || "").match(/\/scribe\/session\/([^\/?#]+)/i);
      return match && match[1] ? decodeURIComponent(match[1]) : "";
    }
  }

  function buildHeidiSessionUrl(sessionId = "") {
    if (!sessionId) {
      return "";
    }

    let locale = "fr-FR";
    try {
      const localeMatch = String(location.pathname || "").match(/^\/([a-z]{2}-[A-Z]{2})\/scribe\//);
      if (localeMatch && localeMatch[1]) {
        locale = localeMatch[1];
      }
    } catch (_error) {
      // Locale française par défaut.
    }

    return `${location.origin}/${locale}/scribe/session/${encodeURIComponent(sessionId)}`;
  }

  function findHeidiSessionLink(sessionId = "") {
    if (!sessionId) {
      return null;
    }

    const links = Array.from(document.querySelectorAll('a[href*="/scribe/session/"]'));
    return links.find((link) => extractHeidiSessionIdFromUrl(link.getAttribute("href") || link.href || "") === sessionId) || null;
  }

  function getActiveHeidiSessionFromMenu() {
    const links = Array.from(document.querySelectorAll('[data-testid="session-list-session-item"] a[href*="/scribe/session/"], a[href*="/scribe/session/"]'));

    for (const link of links) {
      if (!link.querySelector('[data-active="true"]') && !link.closest?.('[data-active="true"]')) {
        continue;
      }

      const sessionId = extractHeidiSessionIdFromUrl(link.getAttribute("href") || link.href || "");
      if (!sessionId) {
        continue;
      }

      return {
        id: sessionId,
        url: buildHeidiSessionUrl(sessionId),
        title: link.getAttribute("title") || normalizeText(link.textContent || ""),
        source: "menu_active",
      };
    }

    return null;
  }

  function getCurrentHeidiSessionInfo() {
    const menuSession = getActiveHeidiSessionFromMenu();
    if (menuSession && menuSession.id) {
      return menuSession;
    }

    const urlSessionId = extractHeidiSessionIdFromUrl(location.href);
    if (urlSessionId) {
      return {
        id: urlSessionId,
        url: buildHeidiSessionUrl(urlSessionId),
        title: document.title || "",
        source: "url",
      };
    }

    try {
      const sessionId = sessionStorage.getItem(HEIDI_COURRIER_SESSION_ID_KEY) || "";
      const sessionUrl = sessionStorage.getItem(HEIDI_COURRIER_SESSION_URL_KEY) || "";
      if (sessionId) {
        return {
          id: sessionId,
          url: sessionUrl || buildHeidiSessionUrl(sessionId),
          title: "",
          source: "session_storage",
        };
      }
    } catch (_error) {
      // Ignorer.
    }

    return null;
  }

  async function waitForHeidiSessionAfterNewSession(previousSession = null, timeoutMs = 18000) {
    const previousId = previousSession && previousSession.id ? previousSession.id : "";
    const startedAt = Date.now();
    let lastSession = null;

    while (Date.now() - startedAt < timeoutMs) {
      const session = getCurrentHeidiSessionInfo();
      if (session && session.id) {
        lastSession = session;
        if (!previousId || session.id !== previousId) {
          return session;
        }
      }
      await sleep(180);
    }

    return lastSession || getCurrentHeidiSessionInfo();
  }

  function rememberHeidiSessionForCourrierJob(jobId, sessionInfo, phase = "") {
    if (!sessionInfo || !sessionInfo.id) {
      appendDebugLog("heidi:session-not-memorized", {
        jobId,
        phase,
        currentHref: location.href,
      });
      return null;
    }

    const sessionUrl = sessionInfo.url || buildHeidiSessionUrl(sessionInfo.id);

    try {
      sessionStorage.setItem(HEIDI_COURRIER_SESSION_ID_KEY, sessionInfo.id);
      sessionStorage.setItem(HEIDI_COURRIER_SESSION_URL_KEY, sessionUrl);
      sessionStorage.setItem(HEIDI_COURRIER_SESSION_PHASE_KEY, phase || "known");
    } catch (_error) {
      // Ignorer.
    }

    const job = GM_getValue(JOB_KEY, null);
    if (job && job.id === jobId) {
      GM_setValue(JOB_KEY, {
        ...job,
        heidiSessionId: sessionInfo.id,
        heidiSessionUrl: sessionUrl,
        heidiSessionTitle: String(sessionInfo.title || "").replace(/\s+/g, " ").trim().slice(0, 160),
        heidiSessionPhase: phase || "known",
        heidiSessionUpdatedAt: Date.now(),
      });
    }

    appendDebugLog("heidi:session-memorized", {
      jobId,
      phase,
      sessionInfo: {
        id: sessionInfo.id,
        url: sessionUrl,
        title: sessionInfo.title || "",
        source: sessionInfo.source || "",
      },
    });

    return {
      ...sessionInfo,
      url: sessionUrl,
    };
  }

  function getTargetHeidiSessionForCourrierJob(jobId = "") {
    const job = GM_getValue(JOB_KEY, null);

    if (job && job.id === jobId && job.heidiSessionId) {
      return {
        id: job.heidiSessionId,
        url: job.heidiSessionUrl || buildHeidiSessionUrl(job.heidiSessionId),
        source: "job",
      };
    }

    try {
      const sessionId = sessionStorage.getItem(HEIDI_COURRIER_SESSION_ID_KEY) || "";
      const sessionUrl = sessionStorage.getItem(HEIDI_COURRIER_SESSION_URL_KEY) || "";
      if (sessionId) {
        return {
          id: sessionId,
          url: sessionUrl || buildHeidiSessionUrl(sessionId),
          source: "session_storage",
        };
      }
    } catch (_error) {
      // Ignorer.
    }

    return null;
  }

  async function waitUntilCurrentHeidiSessionIs(sessionId, timeoutMs = 12000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const current = getCurrentHeidiSessionInfo();
      if (current && current.id === sessionId) {
        return true;
      }
      await sleep(180);
    }

    return false;
  }

  async function ensureHeidiSessionForCourrierJob(jobId = "", phase = "") {
    const target = getTargetHeidiSessionForCourrierJob(jobId);
    if (!target || !target.id) {
      appendDebugLog("heidi:session-ensure-skipped-no-target", {
        jobId,
        phase,
      });
      return true;
    }

    const current = getCurrentHeidiSessionInfo();
    if (current && current.id === target.id) {
      appendDebugLog("heidi:session-ensure-current", {
        jobId,
        phase,
        target,
        current,
      });
      return true;
    }

    appendDebugLog("heidi:session-restore-start", {
      jobId,
      phase,
      target,
      current,
      hasMenuLink: Boolean(findHeidiSessionLink(target.id)),
    });
    updateHeidiStatus(jobId, "Retour sur la session Heidi du courrier...");

    const link = findHeidiSessionLink(target.id);
    if (link) {
      clickButtonLikeUser(link);
      await sleep(900);
    }

    let ok = await waitUntilCurrentHeidiSessionIs(target.id, link ? 9000 : 1500);

    if (!ok) {
      const url = target.url || buildHeidiSessionUrl(target.id);
      appendDebugLog("heidi:session-restore-url-fallback", {
        jobId,
        phase,
        target,
        url,
      });
      try {
        window.location.assign(url);
      } catch (_error) {
        location.href = url;
      }
      await sleep(2500);
      ok = await waitUntilCurrentHeidiSessionIs(target.id, 9000);
    }

    appendDebugLog(ok ? "heidi:session-restore-ok" : "heidi:session-restore-failed", {
      jobId,
      phase,
      target,
      before: current,
      after: getCurrentHeidiSessionInfo(),
    });

    if (!ok) {
      throw new Error("la session Heidi du courrier n'a pas pu être restaurée");
    }

    return true;
  }

  function setupHeidiDebugLifecycleLogs(jobId) {
    document.addEventListener("visibilitychange", () => {
      appendDebugLog("heidi:visibilitychange", {
        jobId,
        visibility: document.visibilityState,
        hidden: document.hidden,
      });
    });

    window.addEventListener("focus", () => {
      appendDebugLog("heidi:focus", { jobId });
    });

    window.addEventListener("blur", () => {
      appendDebugLog("heidi:blur", { jobId });
    });
  }

  function focusCurrentHeidiWindow() {
    try {
      window.focus();
    } catch (_error) {
      // Le navigateur peut refuser le focus programmatique.
    }

    try {
      if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.focus === "function") {
        unsafeWindow.focus();
      }
    } catch (_error) {
      // Le focus standard reste tenté juste au-dessus.
    }
  }

  async function waitForJob(jobId) {
    return waitFor(() => {
      abortIfHeidiJobCancelled(jobId);
      const job = GM_getValue(JOB_KEY, null);
      return job && job.id === jobId ? job : null;
    }, {
      timeout: 30000,
      interval: 250,
      description: "le travail envoyé par Weda",
    });
  }

  async function claimJob(jobId) {
    abortIfHeidiJobCancelled(jobId);
    const workerId = createId("heidi");
    const job = GM_getValue(JOB_KEY, null);
    appendDebugLog("heidi:claim-start", {
      jobId,
      workerId,
      hasJob: Boolean(job),
      claimedBy: job && job.claimedBy ? "yes" : "no",
      claimedAgeMs: job && job.claimedAt ? Date.now() - job.claimedAt : null,
    });

    if (!job || job.id !== jobId) {
      throw new Error("travail Heidi introuvable");
    }

    if (job.claimedBy && Date.now() - (job.claimedAt || 0) < 120000) {
      throw new Error("ce travail est déjà pris en charge par un autre onglet Heidi");
    }

    GM_setValue(JOB_KEY, {
      ...job,
      claimedBy: workerId,
      claimedAt: Date.now(),
    });

    await sleep(250);
    abortIfHeidiJobCancelled(jobId);

    const verified = GM_getValue(JOB_KEY, null);
    if (!verified || verified.claimedBy !== workerId) {
      throw new Error("impossible de réserver l'onglet Heidi");
    }

    appendDebugLog("heidi:claim-ok", {
      jobId,
      workerId,
    });
  }

  async function runHeidiJob(job) {
    abortIfHeidiJobCancelled(job.id);
    appendDebugLog("heidi:run-start", {
      jobId: job.id,
      contentKey: job.contentKey,
      urlKey: job.urlKey || "",
      sourceType: job.sourceType || "pdf",
      pdfAttachment: Boolean(job.pdfAttachmentBase64),
      pdfAttachmentByteLength: job.pdfAttachmentByteLength || 0,
      pdfTextExtractionEmpty: Boolean(job.pdfTextExtractionEmpty),
      documentLines: countBiologyLinesForLog(job.tableText, "pdf"),
      documentLength: String(job.tableText || "").length,
    });
    updateHeidiStatus(job.id, "Ouverture d'une nouvelle session Heidi...");

    const newSessionButton = await findHeidiNewSessionButtonWithRetry(job.id);
    abortIfHeidiJobCancelled(job.id);
    if (!newSessionButton) {
      throw new Error("bouton Nouvelle session Heidi introuvable");
    }

    appendDebugLog("heidi:new-session-button-found", {
      jobId: job.id,
      button: newSessionButton,
      clickStrategy: "single-click-only",
    });
    const sessionBeforeNew = getCurrentHeidiSessionInfo();
    const beforeSessionFingerprint = getHeidiCurrentSessionFingerprint();
    clickButtonOnceLikeUser(newSessionButton);
    appendDebugLog("heidi:new-session-clicked-once", {
      jobId: job.id,
      beforeSessionFingerprint,
      sessionBeforeNew,
    });
    await waitForHeidiSessionAfterNewSessionClick(job.id, beforeSessionFingerprint);
    abortIfHeidiJobCancelled(job.id);

    const sessionForJob = await waitForHeidiSessionAfterNewSession(sessionBeforeNew, 18000);
    rememberHeidiSessionForCourrierJob(job.id, sessionForJob, "new_session_created");
    await ensureHeidiSessionForCourrierJob(job.id, "before_context");
    abortIfHeidiJobCancelled(job.id);

    updateHeidiStatus(job.id, "Préparation du contexte Heidi...");
    await sleep(1200);
    await ensureHeidiSessionForCourrierJob(job.id, "before_context_after_wait");
    abortIfHeidiJobCancelled(job.id);

    const contextEditor = await openHeidiContextAndGetEditor(job.id);
    abortIfHeidiJobCancelled(job.id);
    const contextText = buildHeidiContextText(job.tableText);
    const contextHtml = buildHeidiContextHtml(job.tableHtml || "");
    const contextMarkers = buildHeidiContextVerificationMarkers(job.tableText);
    appendDebugLog("heidi:context-insert-start", {
      jobId: job.id,
      editor: contextEditor,
      sourceType: job.sourceType || "pdf",
      markersCount: contextMarkers.length,
      markerLengths: contextMarkers.map((marker) => marker.length),
      textLength: contextText.length,
      htmlLength: contextHtml.length,
    });
    await insertTextIntoHeidiEditor(contextEditor, contextText, contextHtml, contextMarkers);
    abortIfHeidiJobCancelled(job.id);
    appendDebugLog("heidi:context-insert-ok", {
      jobId: job.id,
      markersCount: contextMarkers.length,
      storedLength: getHeidiEditorStoredText(contextEditor).length,
    });
    await waitForHeidiContextSettled(job.id, contextEditor, contextMarkers);
    await ensureHeidiSessionForCourrierJob(job.id, "after_context_before_ask");
    abortIfHeidiJobCancelled(job.id);

    updateHeidiStatus(job.id, "Préparation de la demande Heidi...");
    const askEditor = await waitForHeidiAskEditor(job.id);
    abortIfHeidiJobCancelled(job.id);

    if (job.pdfAttachmentBase64) {
      updateHeidiStatus(job.id, "Ajout du PDF original dans Heidi...");
      job.pdfAttachmentInserted = await attachHeidiPdfIfNeeded(job, askEditor);
      abortIfHeidiJobCancelled(job.id);
    }

    const promptText = buildHeidiPromptText(job.prompt, job.tableText, job);
    const promptMarkers = buildHeidiPromptVerificationMarkers(promptText);
    appendDebugLog("heidi:ask-insert-start", {
      jobId: job.id,
      editor: askEditor,
      promptLength: promptText.length,
      markersCount: promptMarkers.length,
      markerLengths: promptMarkers.map((marker) => marker.length),
    });
    await insertTextIntoHeidiEditor(askEditor, promptText, "", promptMarkers);
    abortIfHeidiJobCancelled(job.id);
    if (!heidiEditorContainsExpected(askEditor, promptMarkers)) {
      appendDebugLog("heidi:ask-insert-lost-content", {
        jobId: job.id,
        storedLength: getHeidiEditorStoredText(askEditor).length,
        markersCount: promptMarkers.length,
      });
      throw new Error("le prompt Heidi n'est plus détecté après collage");
    }
    appendDebugLog("heidi:ask-insert-ok", {
      jobId: job.id,
      storedLength: getHeidiEditorStoredText(askEditor).length,
      markersCount: promptMarkers.length,
    });

    await ensureHeidiSessionForCourrierJob(job.id, "before_send");
    abortIfHeidiJobCancelled(job.id);

    updateHeidiStatus(job.id, "Lancement de l'analyse Heidi...");
    const sendButton = await waitFor(() => findHeidiSendButton(), {
      timeout: 20000,
      interval: 250,
      description: "le bouton d'envoi Heidi",
    });
    abortIfHeidiJobCancelled(job.id);
    appendDebugLog("heidi:send-button-found", {
      jobId: job.id,
      button: sendButton,
    });
    clickButtonLikeUser(sendButton);
    appendDebugLog("heidi:send-clicked", {
      jobId: job.id,
    });

    if (heidiForegroundFallbackUsed) {
      updateHeidiStatus(job.id, "Analyse Heidi lancée, retour vers Weda...", {
        action: "focusWeda",
      });
      tryReturnFocusToParent();
    }

    updateHeidiStatus(job.id, "Heidi analyse le courrier...");
    await ensureHeidiSessionForCourrierJob(job.id, "before_read_answer");
    abortIfHeidiJobCancelled(job.id);
    const answer = await waitForStableHeidiAnswer(job.id);
    await ensureHeidiSessionForCourrierJob(job.id, "after_read_answer");
    abortIfHeidiJobCancelled(job.id);
    const title = sanitizeTitle(answer);
    appendDebugLog("heidi:answer-received", {
      jobId: job.id,
      answerLength: answer.length,
      titleLength: title.length,
    });

    if (!title) {
      throw new Error("réponse Heidi vide ou non reconnue");
    }

    if (!isExpectedTitleLine(title)) {
      appendDebugLog("heidi:answer-rejected", {
        jobId: job.id,
        titleLength: title.length,
        promptInstructionLike: isPromptInstructionLine(title),
      });
      throw new Error("réponse Heidi rejetée car elle ressemble à une consigne du prompt");
    }

    updateHeidiStatus(job.id, "Réponse Heidi reçue, retour vers Weda...");
    abortIfHeidiJobCancelled(job.id);
    GM_setValue(RESULT_KEY, {
      jobId: job.id,
      ok: true,
      raw: answer,
      title,
      rowIndex: job.rowIndex,
      rowStableKey: job.rowStableKey || "",
      rowIdentity: job.rowIdentity || "",
      contentKey: job.contentKey || "",
      urlKey: job.urlKey || "",
      pdfUrl: job.pdfUrl || "",
      heidiSessionId: getCurrentHeidiSessionInfo() && getCurrentHeidiSessionInfo().id ? getCurrentHeidiSessionInfo().id : "",
      heidiSessionUrl: getCurrentHeidiSessionInfo() && getCurrentHeidiSessionInfo().url ? getCurrentHeidiSessionInfo().url : "",
      createdAt: Date.now(),
    });

    GM_deleteValue(JOB_KEY);

    window.setTimeout(() => {
      window.close();
    }, 1200);
  }

  async function findHeidiNewSessionButtonWithRetry(jobId = "") {
    try {
      return await waitFor(() => {
        abortIfHeidiJobCancelled(jobId);
        return findHeidiNewSessionButton();
      }, {
        timeout: 30000,
        interval: 250,
        description: "le bouton Nouvelle session Heidi",
      });
    } catch (firstError) {
      appendDebugLog("heidi:new-session-button-first-timeout", {
        jobId,
        error: firstError.message,
        debug: getHeidiNewSessionDebugSnapshot(),
      });
    }

    updateHeidiStatus(jobId, "Bouton Nouvelle session non visible, retour sur Heidi...");
    focusCurrentHeidiWindow();
    await sleep(700);

    try {
      return await waitFor(() => {
        abortIfHeidiJobCancelled(jobId);
        return findHeidiNewSessionButton();
      }, {
        timeout: 15000,
        interval: 250,
        description: "le bouton Nouvelle session Heidi après focus",
      });
    } catch (secondError) {
      appendDebugLog("heidi:new-session-button-unavailable", {
        jobId,
        error: secondError.message,
        debug: getHeidiNewSessionDebugSnapshot(),
      });
      return null;
    }
  }

  function findHeidiNewSessionButton() {
    const direct = document.querySelector('[data-testid="sessions-panel-action-new-session"]');
    const directButton = direct && (direct.closest("button") || direct);

    if (directButton && isElementVisible(directButton) && isUsableButton(directButton)) {
      return directButton;
    }

    const candidates = Array.from(document.querySelectorAll("button, [role='button'], a[href]"))
      .filter((element) => isElementVisible(element) && isUsableButton(element));

    return candidates.find((element) => {
      const text = getElementSearchText(element);

      return (
        /sessions-panel-action-new-session/.test(text) ||
        /(?:nouvelle|nouveau|new).{0,40}(?:session|consultation|scribe|note)/.test(text) ||
        /(?:session|consultation|scribe|note).{0,40}(?:nouvelle|nouveau|new)/.test(text)
      );
    }) || null;
  }

  function getElementSearchText(element) {
    if (!element) {
      return "";
    }

    return normalizeForCompare([
      element.textContent || "",
      element.getAttribute ? element.getAttribute("aria-label") || "" : "",
      element.getAttribute ? element.getAttribute("title") || "" : "",
      element.getAttribute ? element.getAttribute("data-testid") || "" : "",
      element.id || "",
      element.className || "",
    ].join(" "));
  }

  function getHeidiNewSessionDebugSnapshot() {
    const buttonLike = Array.from(document.querySelectorAll("button, [role='button'], a[href]"));
    const candidates = buttonLike
      .filter((element) => isElementVisible(element))
      .filter((element) => {
        const text = getElementSearchText(element);
        return /session|nouvelle|nouveau|new|scribe|note/.test(text);
      })
      .slice(0, 12)
      .map(describeDebugElement);

    return {
      buttonLikeCount: buttonLike.length,
      visibleButtonLikeCount: buttonLike.filter(isElementVisible).length,
      candidateButtons: candidates,
      hasAskInput: Boolean(document.querySelector(".ask-ai-input")),
      hasContextTab: Boolean(document.querySelector('[data-testid="session-tab-context"], button[id="context/"], [role="tab"][id="context/"]')),
    };
  }

  function clickButtonOnceLikeUser(button) {
    if (!button) {
      return;
    }

    try {
      button.scrollIntoView({ block: "center", inline: "center" });
    } catch (_error) {
      // scrollIntoView peut échouer sur certains nœuds virtuels.
    }

    try {
      button.focus();
    } catch (_error) {
      // Le bouton peut rester cliquable même si focus échoue.
    }

    // Un seul click natif : sur Heidi, la séquence mousedown + click + button.click()
    // peut être interprétée comme deux demandes de nouvelle session.
    try {
      button.click();
    } catch (_error) {
      try {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch (_nestedError) {
        // Le log appelant documentera l'échec éventuel.
      }
    }
  }

  function getHeidiCurrentSessionFingerprint() {
    try {
      const urlPath = location.pathname || "";
      const urlSearch = location.search || "";
      const activeTab = document.querySelector('[role="tab"][aria-selected="true"], [data-state="active"][role="tab"]');
      const activeTabText = activeTab ? normalizeText(activeTab.textContent || "") : "";
      const contentText = normalizeText(getRawElementText(document.querySelector("#ask-ai-content"))).slice(0, 160);
      const inputText = normalizeText(getRawElementText(findHeidiAskInputEditorForSnapshot())).slice(0, 160);

      return hashString([urlPath, urlSearch, activeTabText, contentText, inputText].join("||"));
    } catch (error) {
      appendDebugLog("heidi:session-fingerprint-error", {
        error: error && error.message ? error.message : String(error),
      });
      return hashString(`${Date.now()}|fingerprint-error`);
    }
  }

  async function waitForHeidiSessionAfterNewSessionClick(jobId = "", beforeFingerprint = "") {
    try {
      await waitFor(() => {
        abortIfHeidiJobCancelled(jobId);
        const snapshot = getHeidiCurrentSessionContentSnapshot();
        const afterFingerprint = getHeidiCurrentSessionFingerprint();
        const askInputReady = snapshot.askInputPresent && snapshot.askInputTextLength === 0;
        const noOldOutput = snapshot.askContentTextLength === 0 &&
          snapshot.directAnswerTextLength === 0 &&
          !snapshot.copyButtonPresent &&
          !snapshot.stillThinking;
        const changed = beforeFingerprint && afterFingerprint && afterFingerprint !== beforeFingerprint;

        if (askInputReady && (noOldOutput || changed)) {
          return { snapshot, afterFingerprint, changed };
        }

        return null;
      }, {
        timeout: 8000,
        interval: 250,
        description: "la nouvelle session Heidi vide",
      });

      appendDebugLog("heidi:new-session-ready", {
        jobId,
        beforeFingerprint,
        afterFingerprint: getHeidiCurrentSessionFingerprint(),
        snapshot: getHeidiCurrentSessionContentSnapshot(),
      });
    } catch (error) {
      appendDebugLog("heidi:new-session-ready-timeout", {
        jobId,
        error: error.message,
        beforeFingerprint,
        afterFingerprint: getHeidiCurrentSessionFingerprint(),
        snapshot: getHeidiCurrentSessionContentSnapshot(),
      });
      await sleep(900);
    }
  }

  function getHeidiCurrentSessionContentSnapshot() {
    const askInput = findHeidiAskInputEditorForSnapshot();
    const askContent = document.querySelector("#ask-ai-content");
    const askInputText = normalizeHeidiAskInputSnapshotText(getRawElementText(askInput));
    const askContentText = normalizeText(getRawElementText(askContent));
    const directAnswerText = extractHeidiAnswerFromDirectBlock();

    return {
      urlPath: location.pathname || "",
      askInputPresent: Boolean(askInput),
      askInputTextLength: askInputText.length,
      askContentPresent: Boolean(askContent),
      askContentTextLength: askContentText.length,
      directAnswerTextLength: normalizeText(directAnswerText).length,
      copyButtonPresent: Boolean(findHeidiCopyTextButton()),
      stillThinking: isHeidiStillThinking(),
      activeElement: document.activeElement ? describeDebugElement(document.activeElement) : null,
    };
  }

  function findHeidiAskInputEditorForSnapshot() {
    return document.querySelector(".ask-ai-input [contenteditable='true']") ||
      document.querySelector("[data-testid='ask-ai-input-block-editor'] [contenteditable='true']") ||
      document.querySelector(".ask-ai-input textarea") ||
      document.querySelector("[data-testid='ask-ai-input-block-editor'] textarea") ||
      null;
  }

  function normalizeHeidiAskInputSnapshotText(value) {
    const text = normalizeText(value || "");
    const normalized = normalizeForCompare(text);

    if (!normalized || /^(?:poser|posez|demander|demandez|ask|message)\b/.test(normalized)) {
      return "";
    }

    return text;
  }

  function getRawElementText(element) {
    if (!element) {
      return "";
    }

    return element.innerText || element.textContent || element.value || "";
  }

  async function openHeidiContextAndGetEditor(jobId = "") {
    let foregroundFallbackRequested = false;
    abortIfHeidiJobCancelled(jobId);
    appendDebugLog("heidi:context-open-start", {
      jobId,
      maxAttempts: HEIDI_CONTEXT_MAX_ATTEMPTS,
      foregroundFallbackAfter: HEIDI_CONTEXT_FOREGROUND_FALLBACK_AFTER_ATTEMPT,
      backgroundWorkers: HEIDI_WORKERS_OPEN_IN_BACKGROUND,
    });

    for (let attempt = 1; attempt <= HEIDI_CONTEXT_MAX_ATTEMPTS; attempt += 1) {
      abortIfHeidiJobCancelled(jobId);
      const existingEditor = findHeidiContextEditor();
      if (existingEditor) {
        appendDebugLog("heidi:context-existing-editor", {
          jobId,
          attempt,
          editor: existingEditor,
          debug: getHeidiContextDebugSnapshot(),
        });
        return existingEditor;
      }

      updateHeidiStatus(jobId, `Ouverture du contexte Heidi (${attempt}/${HEIDI_CONTEXT_MAX_ATTEMPTS})...`);
      appendDebugLog("heidi:context-attempt", {
        jobId,
        attempt,
        debug: getHeidiContextDebugSnapshot(),
      });

      if (
        HEIDI_WORKERS_OPEN_IN_BACKGROUND &&
        !foregroundFallbackRequested &&
        attempt >= HEIDI_CONTEXT_FOREGROUND_FALLBACK_AFTER_ATTEMPT &&
        (document.hidden || !document.hasFocus())
      ) {
        foregroundFallbackRequested = true;
        await bringHeidiWorkerToForegroundForContext(jobId);
      }

      let tabs = [];
      try {
        tabs = await waitFor(() => {
          abortIfHeidiJobCancelled(jobId);
          const found = findHeidiContextTabs();
          return found.length ? found : null;
        }, {
          timeout: 12000,
          interval: 300,
          description: "l'onglet Contexte Heidi",
        });
      } catch (error) {
        appendDebugLog("heidi:context-tab-timeout", {
          jobId,
          attempt,
          error: error.message,
          debug: getHeidiContextDebugSnapshot(),
        });
        await sleep(HEIDI_CONTEXT_RETRY_MS);
        continue;
      }

      appendDebugLog("heidi:context-tab-found", {
        jobId,
        attempt,
        tabs: tabs.slice(0, 4).map(describeDebugElement),
      });

      for (const tab of tabs.slice(0, 4)) {
        abortIfHeidiJobCancelled(jobId);
        clickHeidiTab(tab);
        appendDebugLog("heidi:context-tab-clicked", {
          jobId,
          attempt,
          tab: describeDebugElement(tab),
          debug: getHeidiContextDebugSnapshot(),
        });

        try {
          const editor = await waitFor(() => {
            abortIfHeidiJobCancelled(jobId);
            return findHeidiContextEditor();
          }, {
            timeout: HEIDI_CONTEXT_ACTIVATE_TIMEOUT_MS,
            interval: 250,
            description: "l'éditeur Contexte Heidi après clic",
          });
          abortIfHeidiJobCancelled(jobId);
          appendDebugLog("heidi:context-editor-found", {
            jobId,
            attempt,
            editor,
            debug: getHeidiContextDebugSnapshot(),
          });
          return editor;
        } catch (error) {
          appendDebugLog("heidi:context-editor-after-click-missing", {
            jobId,
            attempt,
            error: error.message,
            tab: describeDebugElement(tab),
            debug: getHeidiContextDebugSnapshot(),
          });
        }
      }

      if (
        HEIDI_WORKERS_OPEN_IN_BACKGROUND &&
        !foregroundFallbackRequested &&
        (document.hidden || !document.hasFocus())
      ) {
        foregroundFallbackRequested = true;
        await bringHeidiWorkerToForegroundForContext(jobId);
      }

      await sleep(HEIDI_CONTEXT_RETRY_MS);
      abortIfHeidiJobCancelled(jobId);
    }

    appendDebugLog("heidi:context-open-failed", {
      jobId,
      debug: getHeidiContextDebugSnapshot(),
    });
    throw new Error("Heidi n'a pas affiché l'onglet Contexte");
  }

  async function bringHeidiWorkerToForegroundForContext(jobId = "") {
    heidiForegroundFallbackUsed = true;
    appendDebugLog("heidi:foreground-fallback", {
      jobId,
      beforeFocus: getDebugEnvironment(),
    });
    updateHeidiStatus(jobId, "Heidi bloque en arrière-plan : activation brève pour ouvrir Contexte...");

    try {
      window.focus();
    } catch (_error) {
      // Certains navigateurs refusent le focus programmatique.
    }

    try {
      if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.focus === "function") {
        unsafeWindow.focus();
      }
    } catch (_error) {
      // Le focus standard reste tenté juste au-dessus.
    }

    await sleep(1600);
  }

  function tryReturnFocusToParent() {
    window.setTimeout(() => {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.focus();
          return;
        }
      } catch (_error) {
        // Si l'opener n'est pas disponible, on tente simplement de quitter le focus.
      }

      try {
        window.blur();
      } catch (_error) {
        // Le navigateur garde parfois l'onglet actif.
      }
    }, 600);
  }

  async function waitForHeidiContextEditor() {
    return waitFor(() => {
      return findHeidiContextEditor();
    }, {
      timeout: 45000,
      interval: 250,
      description: "la zone Contexte Heidi",
    });
  }

  function findHeidiContextTab() {
    const candidates = findHeidiContextTabs();

    return candidates[0] || null;
  }

  function findHeidiContextTabs() {
    const rawCandidates = [
      ...Array.from(document.querySelectorAll(
        'button[data-testid="session-tab-context"], [data-testid="session-tab-context"], button[id="context/"], [role="tab"][id="context/"], a[href*="context"]'
      )),
      ...Array.from(document.querySelectorAll('button, [role="tab"], [role="button"]'))
        .filter((element) => normalizeText(element.textContent).includes("Contexte")),
    ];
    const seen = new Set();

    return rawCandidates
      .map((element) => element.closest('button, a, [role="tab"], [role="button"]') || element)
      .filter((element) => {
        if (!element || seen.has(element)) {
          return false;
        }
        seen.add(element);
        return true;
      })
      .sort((left, right) => getHeidiContextTabPriority(left) - getHeidiContextTabPriority(right));
  }

  function getHeidiContextTabPriority(element) {
    let priority = isElementVisible(element) ? 0 : 100;

    if (element.getAttribute("data-testid") === "session-tab-context") {
      priority += 0;
    } else if (element.id === "context/") {
      priority += 5;
    } else if (element.getAttribute("role") === "tab") {
      priority += 10;
    } else if (element.tagName === "BUTTON") {
      priority += 20;
    } else {
      priority += 30;
    }

    if (
      element.getAttribute("aria-selected") === "true" ||
      element.getAttribute("data-state") === "active"
    ) {
      priority -= 3;
    }

    return priority;
  }

  function getHeidiContextDebugSnapshot() {
    const tabs = Array.from(document.querySelectorAll(
      '[data-testid="session-tab-context"], button[id="context/"], [role="tab"][id="context/"], button, [role="tab"], [role="button"]'
    ));
    const contextLikeTabs = tabs.filter((element) => (
      element.getAttribute("data-testid") === "session-tab-context" ||
      element.id === "context/" ||
      normalizeText(element.textContent).includes("Contexte")
    ));
    const editorRoots = Array.from(document.querySelectorAll('#template-block-editor-content, [data-testid="template-block-editor-content"]'));
    const askInput = document.querySelector(".ask-ai-input");

    return {
      contextLikeTabs: contextLikeTabs.length,
      contextLikeTabDescriptions: contextLikeTabs.slice(0, 5).map(describeDebugElement),
      editorRoots: editorRoots.length,
      visibleEditorRoots: editorRoots.filter(isElementVisible).length,
      askInputVisible: Boolean(askInput && isElementVisible(askInput)),
      activeElement: document.activeElement ? describeDebugElement(document.activeElement) : null,
    };
  }

  function clickHeidiTab(tab) {
    const clickable = tab.closest('button, a, [role="tab"], [role="button"]') || tab;

    dispatchPointerLikeEvents(clickable);
    clickButtonLikeUser(clickable);
    dispatchKeyboardActivation(clickable);

    const wrapper = clickable.closest('[role="button"], .sortable-item');
    if (wrapper && wrapper !== clickable) {
      dispatchPointerLikeEvents(wrapper);
      clickButtonLikeUser(wrapper);
      dispatchKeyboardActivation(wrapper);
    }
  }

  function dispatchKeyboardActivation(element) {
    try {
      element.focus();
    } catch (_error) {
      // L'activation clavier est seulement un renfort au clic.
    }

    ["Enter", " "].forEach((key) => {
      ["keydown", "keyup"].forEach((eventName) => {
        try {
          element.dispatchEvent(new KeyboardEvent(eventName, {
            bubbles: true,
            cancelable: true,
            composed: true,
            key,
            code: key === " " ? "Space" : "Enter",
          }));
        } catch (_error) {
          // Le clic souris reste la méthode principale.
        }
      });
    });
  }

  function dispatchPointerLikeEvents(element) {
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((eventName) => {
      try {
        const EventConstructor = eventName.startsWith("pointer") && typeof PointerEvent === "function"
          ? PointerEvent
          : MouseEvent;

        element.dispatchEvent(new EventConstructor(eventName, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
          buttons: eventName.endsWith("down") ? 1 : 0,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }));
      } catch (_error) {
        try {
          element.dispatchEvent(new Event(eventName, {
            bubbles: true,
            cancelable: true,
          }));
        } catch (_nestedError) {
          // Le clic renforcé est best effort.
        }
      }
    });
  }

  function findHeidiContextEditor() {
    const roots = Array.from(document.querySelectorAll('#template-block-editor-content, [data-testid="template-block-editor-content"]'))
      .filter((candidate) => !candidate.closest(".ask-ai-input") && !candidate.closest("#ask-ai-content"));

    const root = roots.find((candidate) => isElementVisible(candidate) && (
      candidate.querySelector('p[data-placeholder*="informations contextuelles"]') ||
      candidate.querySelector('p[data-placeholder*="patient"]')
    )) || roots.find((candidate) => {
      const text = normalizeForCompare(candidate.textContent);
      return isElementVisible(candidate) && (
        text.includes("ajoutez des informations contextuelles") ||
        text.includes("informations contextuelles sur le patient")
      );
    });

    return root && (
      root.querySelector('[contenteditable="true"]') ||
      root.querySelector(".ProseMirror") ||
      root
    );
  }

  async function waitForHeidiAskEditor(jobId = "") {
    const editor = await waitFor(() => {
      abortIfHeidiJobCancelled(jobId);
      const inputArea = document.querySelector(".ask-ai-input") || document;
      const placeholder = inputArea.querySelector('p[data-placeholder*="Demandez"]');
      const fromPlaceholder = placeholder
        ? placeholder.closest(".ProseMirror") || placeholder.closest('[contenteditable="true"]')
        : null;

      return (
        fromPlaceholder ||
        inputArea.querySelector(".ProseMirror[contenteditable='true']") ||
        inputArea.querySelector("[contenteditable='true']") ||
        inputArea.querySelector("textarea")
      );
    }, {
      timeout: 45000,
      interval: 250,
      description: "la zone de demande Heidi",
    });
    appendDebugLog("heidi:ask-editor-found", {
      editor,
      askInputVisible: Boolean(document.querySelector(".ask-ai-input") && isElementVisible(document.querySelector(".ask-ai-input"))),
    });
    return editor;
  }

  async function attachHeidiPdfIfNeeded(job, askEditor) {
    if (!job || !job.pdfAttachmentBase64) {
      return false;
    }

    let file = null;
    try {
      file = createPdfFileFromJob(job);
    } catch (error) {
      appendDebugLog("heidi:pdf-attachment-create-failed", {
        jobId: job.id,
        error: error.message,
        byteLength: job.pdfAttachmentByteLength || 0,
      });
      return false;
    }

    appendDebugLog("heidi:pdf-attachment-start", {
      jobId: job.id,
      byteLength: file.size || job.pdfAttachmentByteLength || 0,
      fileNameHash: hashString(file.name || ""),
      askEditor,
      fileInputs: document.querySelectorAll("input[type='file']").length,
    });

    let fileInput = findHeidiFileInput();
    if (!fileInput) {
      const attachButton = findHeidiAttachmentButton();
      if (attachButton) {
        appendDebugLog("heidi:pdf-attachment-button-click", {
          jobId: job.id,
          button: attachButton,
        });
        clickButtonLikeUser(attachButton);
        await sleep(500);
        fileInput = findHeidiFileInput();
      }
    }

    if (fileInput && setFileInputFiles(fileInput, [file])) {
      await sleep(1400);
      appendDebugLog("heidi:pdf-attachment-ok", {
        jobId: job.id,
        strategy: "file-input",
        input: fileInput,
        byteLength: file.size || job.pdfAttachmentByteLength || 0,
        attachmentHintVisible: isHeidiAttachmentHintVisible(file.name),
      });
      return true;
    }

    if (dispatchFileToHeidiEditor(askEditor, file)) {
      await sleep(1400);
      appendDebugLog("heidi:pdf-attachment-ok", {
        jobId: job.id,
        strategy: "paste-drop",
        byteLength: file.size || job.pdfAttachmentByteLength || 0,
        attachmentHintVisible: isHeidiAttachmentHintVisible(file.name),
      });
      return true;
    }

    appendDebugLog("heidi:pdf-attachment-failed", {
      jobId: job.id,
      fileInputs: document.querySelectorAll("input[type='file']").length,
      attachButtons: findHeidiAttachmentButtons().length,
      askEditor,
      byteLength: file.size || job.pdfAttachmentByteLength || 0,
    });
    return false;
  }

  function createPdfFileFromJob(job) {
    const bytes = base64ToUint8Array(job.pdfAttachmentBase64 || "");
    const name = sanitizePdfAttachmentName(job.pdfAttachmentName || buildPdfAttachmentFileName(job.pdfUrl || job.urlKey || job.id));
    const type = job.pdfAttachmentMimeType || "application/pdf";

    if (!bytes.length) {
      throw new Error("PDF joint vide");
    }

    if (typeof File === "function") {
      return new File([bytes], name, { type });
    }

    const blob = new Blob([bytes], { type });
    try {
      Object.defineProperty(blob, "name", {
        value: name,
        configurable: true,
      });
    } catch (_error) {
      blob.name = name;
    }
    return blob;
  }

  function sanitizePdfAttachmentName(value) {
    const clean = normalizeText(value)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 120);

    return /\.pdf$/i.test(clean) ? clean : (clean || "weda-courrier") + ".pdf";
  }

  function findHeidiFileInput() {
    const inputs = Array.from(document.querySelectorAll("input[type='file']"))
      .filter((input) => !input.disabled && input.getAttribute("aria-disabled") !== "true");

    return inputs.sort((left, right) => Number(!isElementVisible(left)) - Number(!isElementVisible(right)))[0] || null;
  }

  function findHeidiAttachmentButton() {
    return findHeidiAttachmentButtons()[0] || null;
  }

  function findHeidiAttachmentButtons() {
    const roots = [
      document.querySelector(".ask-ai-input"),
      document.querySelector("#ask-ai-container"),
      document.body,
    ].filter(Boolean);
    const buttons = [];

    roots.forEach((root) => {
      Array.from(root.querySelectorAll("button, [role='button']"))
        .forEach((button) => {
          if (!buttons.includes(button) && isHeidiAttachmentButtonCandidate(button)) {
            buttons.push(button);
          }
        });
    });

    return buttons;
  }

  function isHeidiAttachmentButtonCandidate(button) {
    if (!button || !isUsableButton(button)) {
      return false;
    }

    if (
      button.querySelector(".lucide-arrow-up") ||
      /arrow-up/.test(button.innerHTML || "")
    ) {
      return false;
    }

    const combined = normalizeForCompare([
      button.textContent || "",
      button.getAttribute("aria-label") || "",
      button.getAttribute("title") || "",
      button.getAttribute("data-testid") || "",
      button.className || "",
      button.innerHTML || "",
    ].join(" "));

    return (
      /\b(?:joindre|fichier|document|upload|attachment|paperclip)\b/.test(combined) ||
      /piece\s+jointe/.test(combined) ||
      Boolean(button.querySelector(".lucide-paperclip, [class*='paperclip'], [data-icon*='paperclip'], [class*='upload']"))
    );
  }

  function setFileInputFiles(input, files) {
    const dataTransfer = createFileDataTransfer(files);

    if (!dataTransfer) {
      return false;
    }

    try {
      input.files = dataTransfer.files;
    } catch (_error) {
      try {
        Object.defineProperty(input, "files", {
          value: dataTransfer.files,
          configurable: true,
        });
      } catch (_nestedError) {
        return false;
      }
    }

    ["input", "change"].forEach((eventName) => {
      try {
        input.dispatchEvent(new Event(eventName, {
          bubbles: true,
          cancelable: true,
          composed: true,
        }));
      } catch (_error) {
        // Les frameworks modernes écoutent au moins l'un de ces événements.
      }
    });

    return true;
  }

  function dispatchFileToHeidiEditor(editor, file) {
    const target = resolveHeidiEditableElement(editor) ||
      document.querySelector(".ask-ai-input") ||
      document.querySelector("#ask-ai-container") ||
      document.body;
    const dataTransfer = createFileDataTransfer([file]);

    if (!target || !dataTransfer) {
      return false;
    }

    try {
      target.focus();
    } catch (_error) {
      // Le dépôt synthétique reste tenté même sans focus.
    }

    dataTransfer.setData("text/plain", file.name || "weda-courrier.pdf");

    const eventNames = ["paste", "dragenter", "dragover", "drop"];
    let dispatched = false;

    eventNames.forEach((eventName) => {
      dispatched = dispatchFileTransferEvent(target, eventName, dataTransfer) || dispatched;
    });

    return dispatched;
  }

  function createFileDataTransfer(files) {
    if (typeof DataTransfer !== "function") {
      return null;
    }

    try {
      const dataTransfer = new DataTransfer();
      files.forEach((file) => dataTransfer.items.add(file));
      return dataTransfer;
    } catch (_error) {
      return null;
    }
  }

  function dispatchFileTransferEvent(target, eventName, dataTransfer) {
    try {
      const eventOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      let event = null;

      if (eventName === "paste" && typeof ClipboardEvent === "function") {
        event = new ClipboardEvent(eventName, {
          ...eventOptions,
          clipboardData: dataTransfer,
        });
      } else if (typeof DragEvent === "function") {
        event = new DragEvent(eventName, {
          ...eventOptions,
          dataTransfer,
        });
      } else {
        event = new Event(eventName, eventOptions);
      }

      if (!event.clipboardData && eventName === "paste") {
        Object.defineProperty(event, "clipboardData", {
          value: dataTransfer,
          configurable: true,
        });
      }

      if (!event.dataTransfer && eventName !== "paste") {
        Object.defineProperty(event, "dataTransfer", {
          value: dataTransfer,
          configurable: true,
        });
      }

      target.dispatchEvent(event);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function isHeidiAttachmentHintVisible(fileName = "") {
    const text = normalizeForCompare(getVisibleText(document.querySelector("#ask-ai-container") || document.body));
    const normalizedFileName = normalizeForCompare(fileName);

    return Boolean(
      (normalizedFileName && text.includes(normalizedFileName)) ||
      text.includes(".pdf") ||
      text.includes("pdf")
    );
  }

  function stripTrailingBiologySignal(prompt) {
    const pattern = new RegExp("\\n*" + escapeRegExp(DOCUMENT_SIGNAL) + "\\s*$", "i");
    return String(prompt || "").replace(pattern, "").trim();
  }

  function buildHeidiPromptText(prompt, _tableText = "", job = {}) {
    const basePrompt = stripTrailingBiologySignal(prompt);

    if (!job || !job.pdfTextExtractionEmpty) {
      return basePrompt;
    }

    return basePrompt + "\n\n" + [
      "Important : le PDF original est joint à cette demande.",
      "Son texte n'a pas pu être extrait automatiquement par Weda/PDF.js.",
      "Analyse directement la pièce jointe PDF pour produire uniquement la phrase médicale courte demandée.",
      job.pdfAttachmentInserted ? "" : "Si la pièce jointe n'est pas visible dans Heidi, réponds seulement que le PDF joint est inaccessible.",
    ].filter(Boolean).join("\n");
  }

  function buildHeidiPromptVerificationMarkers(promptText) {
    const markers = [
      "Rôle : médecin généraliste",
      "Objectif : synthétiser le courrier médical",
      "Format attendu",
    ].filter((marker) => String(promptText || "").includes(marker));

    return markers.length ? markers : ["Objectif"];
  }

  function tableHasWedaAbnormalStatus(_tableText) {
    return false;
  }

  function isRasLikeHeidiTitle(_title) {
    return false;
  }

  function buildWedaStatusFallbackTitle(_tableText) {
    return "";
  }

  function extractWedaAbnormalRows(_tableText) {
    return [];
  }

  function formatWedaAbnormalRowForTitle() {
    return "";
  }

  function compactBiologyLabel(label) {
    return normalizeText(label);
  }

  function joinBiologyTitleParts(parts) {
    return parts.filter(Boolean).join(" ; ");
  }

  function buildHeidiContextVerificationMarkers(tableText) {
    const rawMarkers = normalizePdfText(tableText)
      .split(/\n+/)
      .map(normalizeText)
      .filter((line) => line.length >= 4 && line.length <= 140)
      .slice(0, 5);

    return [DOCUMENT_SIGNAL, ...rawMarkers].filter(Boolean);
  }

  function buildHeidiContextText(tableText) {
    return DOCUMENT_SIGNAL + "\n\n" + normalizePdfText(tableText);
  }

  function buildHeidiContextHtml(_tableHtml) {
    return "";
  }

  function addSignalRowToTableHtml(tableHtml) {
    return String(tableHtml || "");
  }

  async function waitForHeidiContextSettled(jobId, editor, markers) {
    const editable = resolveHeidiEditableElement(editor);
    const delay = document.hidden ? HEIDI_CONTEXT_HIDDEN_SETTLE_MS : HEIDI_CONTEXT_VISIBLE_SETTLE_MS;

    abortIfHeidiJobCancelled(jobId);
    commitHeidiEditorChange(editable, "context-settle");
    updateHeidiStatus(jobId, "Contexte Heidi collé, attente de sauvegarde...");
    appendDebugLog("heidi:context-settle-start", {
      jobId,
      delay,
      hidden: document.hidden,
      hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      storedLength: getHeidiEditorStoredText(editable).length,
      markersCount: normalizeExpectedMarkers(markers).length,
    });

    await sleep(delay);
    abortIfHeidiJobCancelled(jobId);

    if (!heidiEditorContainsExpected(editable, markers)) {
      appendDebugLog("heidi:context-settle-lost-content", {
        jobId,
        storedLength: getHeidiEditorStoredText(editable).length,
        markersCount: normalizeExpectedMarkers(markers).length,
      });
      throw new Error("le contexte Heidi n'est plus détecté après attente de sauvegarde");
    }

    appendDebugLog("heidi:context-settle-ok", {
      jobId,
      delay,
      storedLength: getHeidiEditorStoredText(editable).length,
    });
  }

  async function insertTextIntoHeidiEditor(editor, text, html = "", expected = "") {
    const editable = resolveHeidiEditableElement(editor);
    const expectedMarkers = normalizeExpectedMarkers(expected || text);
    if (!editable) {
      appendDebugLog("heidi:editor-insert-no-editor", {
        markerCount: expectedMarkers.length,
      });
      throw new Error("éditeur Heidi introuvable");
    }

    appendDebugLog("heidi:editor-insert-attempt", {
      editor: editable,
      markerCount: expectedMarkers.length,
      markerLengths: expectedMarkers.map((marker) => marker.length),
      textLength: text.length,
      htmlLength: html.length,
      hasProseMirrorView: Boolean(findProseMirrorView(editable)),
      tagName: editable && editable.tagName,
    });
    editable.focus();

    if (editable.tagName === "TEXTAREA" || editable.tagName === "INPUT") {
      editable.value = text;
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      await waitForHeidiEditorText(editable, expectedMarkers);
      appendDebugLog("heidi:editor-insert-success", {
        strategy: "input-value",
        storedLength: getHeidiEditorStoredText(editable).length,
      });
      commitHeidiEditorChange(editable, "input-value");
      return;
    }

    if (replaceProseMirrorContent(editable, text, html)) {
      notifyEditorInput(editable, text, "insertReplacementText");
      await sleep(450);
      if (heidiEditorContainsExpected(editable, expectedMarkers)) {
        appendDebugLog("heidi:editor-insert-success", {
          strategy: html ? "prosemirror-html" : "prosemirror-text",
          storedLength: getHeidiEditorStoredText(editable).length,
        });
        commitHeidiEditorChange(editable, html ? "prosemirror-html" : "prosemirror-text");
        return;
      }
    }

    if (html && replaceProseMirrorContent(editable, text, "")) {
      notifyEditorInput(editable, text, "insertReplacementText");
      await sleep(450);
      if (heidiEditorContainsExpected(editable, expectedMarkers)) {
        appendDebugLog("heidi:editor-insert-success", {
          strategy: "prosemirror-text-fallback",
          storedLength: getHeidiEditorStoredText(editable).length,
        });
        commitHeidiEditorChange(editable, "prosemirror-text-fallback");
        return;
      }
    }

    selectNodeContents(editable);
    dispatchPaste(editable, text, html);
    notifyEditorInput(editable, text, "insertFromPaste");
    await sleep(300);

    if (heidiEditorContainsExpected(editable, expectedMarkers)) {
      appendDebugLog("heidi:editor-insert-success", {
        strategy: html ? "paste-html" : "paste-text",
        storedLength: getHeidiEditorStoredText(editable).length,
      });
      commitHeidiEditorChange(editable, html ? "paste-html" : "paste-text");
      return;
    }

    editable.focus();
    selectNodeContents(editable);
    document.execCommand("insertText", false, text);
    notifyEditorInput(editable, text, "insertText");
    await sleep(300);

    if (heidiEditorContainsExpected(editable, expectedMarkers)) {
      appendDebugLog("heidi:editor-insert-success", {
        strategy: "execCommand",
        storedLength: getHeidiEditorStoredText(editable).length,
      });
      commitHeidiEditorChange(editable, "execCommand");
      return;
    }

    if (!findProseMirrorView(editable)) {
      setHeidiEditorDomContent(editable, text, html);
      await sleep(450);

      if (heidiEditorContainsExpected(editable, expectedMarkers)) {
        appendDebugLog("heidi:editor-insert-success", {
          strategy: html ? "dom-html" : "dom-text",
          storedLength: getHeidiEditorStoredText(editable).length,
        });
        commitHeidiEditorChange(editable, html ? "dom-html" : "dom-text");
        return;
      }
    }

    appendDebugLog("heidi:editor-insert-failed", {
      markerCount: expectedMarkers.length,
      storedLength: getHeidiEditorStoredText(editable).length,
      hasProseMirrorView: Boolean(findProseMirrorView(editable)),
      editor: editable,
    });
    throw new Error(`Heidi n'a pas reçu ${formatExpectedForError(expectedMarkers)}`);
  }

  function resolveHeidiEditableElement(editor) {
    if (!editor) {
      return editor;
    }

    if (
      editor.tagName === "TEXTAREA" ||
      editor.tagName === "INPUT" ||
      editor.getAttribute("contenteditable") === "true"
    ) {
      return editor;
    }

    return (
      editor.querySelector('[contenteditable="true"]') ||
      editor.querySelector(".ProseMirror") ||
      editor
    );
  }

  async function waitForHeidiEditorText(editor, expected) {
    return waitFor(() => heidiEditorContainsExpected(editor, expected), {
      timeout: 4000,
      interval: 150,
      description: "l'insertion dans Heidi",
    });
  }

  function heidiEditorContainsExpected(editor, expected) {
    const expectedMarkers = normalizeExpectedMarkers(expected);
    const current = normalizeText(getHeidiEditorStoredText(editor));

    if (!expectedMarkers.length) {
      return Boolean(current);
    }

    return expectedMarkers.every((marker) => current.includes(marker));
  }

  function normalizeExpectedMarkers(expected) {
    const markers = Array.isArray(expected) ? expected : [expected];
    return markers
      .map((marker) => normalizeText(marker))
      .filter(Boolean);
  }

  function getHeidiEditorStoredText(editor) {
    const view = findProseMirrorView(editor);

    if (view && view.state && view.state.doc && typeof view.state.doc.textBetween === "function") {
      return view.state.doc.textBetween(0, view.state.doc.content.size, "\n", "\n");
    }

    return editor && (editor.innerText || editor.textContent || editor.value || "");
  }

  function formatExpectedForError(markers) {
    const expectedMarkers = normalizeExpectedMarkers(markers);

    if (!expectedMarkers.length) {
      return "le texte à insérer";
    }

    return expectedMarkers.slice(0, 4).join(" / ");
  }

  function replaceProseMirrorContent(editor, text, html = "") {
    const view = findProseMirrorView(editor);

    if (!view || !view.state || !view.dispatch) {
      return false;
    }

    if (html && replaceProseMirrorContentFromHtml(view, html)) {
      return true;
    }

    return replaceProseMirrorContentFromText(view, text);
  }

  function findProseMirrorView(editor) {
    const candidates = [
      editor,
      ...Array.from(editor.querySelectorAll ? editor.querySelectorAll("*") : []),
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.pmViewDesc && candidate.pmViewDesc.view) {
        return candidate.pmViewDesc.view;
      }
    }

    return null;
  }

  function replaceProseMirrorContentFromHtml(view, html) {
    try {
      const parser = view.someProp && view.someProp("clipboardParser");

      if (!parser || typeof parser.parseSlice !== "function") {
        return false;
      }

      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const slice = parser.parseSlice(wrapper, {
        preserveWhitespace: true,
      });

      view.dispatch(view.state.tr.replace(0, view.state.doc.content.size, slice));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function replaceProseMirrorContentFromText(view, text) {
    try {
      const schema = view.state.schema;
      const paragraph = schema.nodes.paragraph;

      if (!paragraph) {
        return false;
      }

      const nodes = String(text || "")
        .split(/\r?\n/)
        .map((line) => paragraph.create(null, line ? schema.text(line) : null));

      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function setHeidiEditorDomContent(editor, text, html = "") {
    if (html) {
      editor.innerHTML = html;
    } else {
      editor.innerHTML = textToParagraphHtml(text);
    }

    notifyEditorInput(editor, text, "insertText");
  }

  function textToParagraphHtml(text) {
    const lines = String(text || "").split(/\r?\n/);
    return lines
      .map((line) => `<p>${line ? escapeHtml(line) : "<br>"}</p>`)
      .join("");
  }

  function dispatchPaste(editor, text, html = "") {
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      if (html) {
        data.setData("text/html", html);
      }
      const event = new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(event);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function notifyEditorInput(editor, text, inputType) {
    try {
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType,
        data: text,
      }));
    } catch (_error) {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function commitHeidiEditorChange(editor, reason = "") {
    if (!editor) {
      return;
    }

    const view = findProseMirrorView(editor);

    try {
      if (view && view.state && view.dispatch) {
        view.dispatch(view.state.tr.setMeta("addToHistory", false));
      }
    } catch (_error) {
      // L'éditeur peut refuser une transaction vide, les événements DOM suivent.
    }

    ["input", "change", "keyup", "blur", "focusout"].forEach((eventName) => {
      try {
        const event = eventName === "keyup"
          ? new KeyboardEvent(eventName, {
            bubbles: true,
            cancelable: true,
            key: " ",
            code: "Space",
          })
          : new Event(eventName, {
            bubbles: true,
            cancelable: true,
          });
        editor.dispatchEvent(event);
      } catch (_error) {
        // Best effort : Heidi varie ses handlers selon les versions.
      }
    });

    appendDebugLog("heidi:editor-commit", {
      reason,
      storedLength: getHeidiEditorStoredText(editor).length,
      hasProseMirrorView: Boolean(view),
    });
  }

  function selectNodeContents(node) {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function findHeidiSendButton() {
    const inputArea = document.querySelector(".ask-ai-input") || document;
    const buttons = Array.from(inputArea.querySelectorAll('button[type="button"], button'))
      .filter(isUsableButton);

    return (
      buttons.find((button) => button.querySelector(".lucide-arrow-up")) ||
      buttons.find((button) => /arrow-up/.test(button.innerHTML)) ||
      buttons[buttons.length - 1] ||
      null
    );
  }

  function isUsableButton(button) {
    if (!button || button.disabled || button.matches("[disabled]")) {
      return false;
    }

    if (button.getAttribute("aria-disabled") === "true") {
      return false;
    }

    return true;
  }

  function clickButtonLikeUser(button) {
    try {
      button.scrollIntoView({ block: "center", inline: "center" });
    } catch (_error) {
      // scrollIntoView peut échouer sur certains nœuds virtuels, le clic reste tenté.
    }

    try {
      button.focus();
    } catch (_error) {
      // Le bouton peut rester cliquable même si focus échoue.
    }

    ["mousedown", "mouseup", "click"].forEach((eventName) => {
      try {
        button.dispatchEvent(new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
        }));
      } catch (_error) {
        try {
          button.dispatchEvent(new Event(eventName, {
            bubbles: true,
            cancelable: true,
          }));
        } catch (_nestedError) {
          // Le clic natif ci-dessous reste le dernier filet de sécurité.
        }
      }
    });

    try {
      button.click();
    } catch (_error) {
      // Les événements précédents ont déjà été tentés.
    }
  }

  function extractHeidiAnswerFromAskContent() {
    const directAnswer = extractHeidiAnswerFromDirectBlock();
    if (directAnswer) {
      return directAnswer;
    }

    const content = document.querySelector("#ask-ai-content");

    if (content) {
      const answer = extractAnswerFromText(getVisibleText(content));
      if (answer) {
        return answer;
      }
    }

    const fallbackContainer = document.querySelector("#ask-ai-container");
    if (fallbackContainer) {
      const answer = extractAnswerFromText(getVisibleText(fallbackContainer));
      if (answer) {
        return answer;
      }
    }

    return "";
  }

  function extractHeidiAnswerFromDirectBlock() {
    const selectors = [
      '[data-testid="ask-ai-block-editor"] [contenteditable="false"]',
      '[data-testid="ask-ai-block-editor"] .ProseMirror',
      '[data-testid="ask-ai-block-editor"]',
      '#ask-ai-content [contenteditable="false"]',
      '#ask-ai-content .ProseMirror',
      '[data-testid="template-block-editor-content"] [contenteditable="false"]',
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!isElementVisibleEnough(node)) {
          continue;
        }

        const text = getVisibleText(node);
        if (isOnlyHeidiThinkingText(text)) {
          continue;
        }

        const answer = extractAnswerFromText(text);
        if (answer) {
          return answer;
        }
      }
    }

    return "";
  }

  function isElementVisibleEnough(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
      return false;
    }

    const text = normalizeText(element.innerText || element.textContent || "");
    return Boolean(text);
  }

  function isOnlyHeidiThinkingText(text) {
    const normalized = normalizeForCompare(text).replace(/['’]/g, " ");
    if (!normalized) {
      return true;
    }

    return (
      /^l\s*ia\s+est\s+en\s+train\s+de\s+reflechir/.test(normalized) ||
      normalized.includes("bientot termine") ||
      normalized === "generation en cours" ||
      normalized === "en train de reflechir"
    );
  }

  async function waitForStableHeidiAnswer(jobId = "") {
    let lastAnswer = "";
    let stableSince = 0;
    let firstThinkingAt = 0;
    let hiddenSince = 0;
    let lastFocusAttemptAt = 0;
    let lastRelaunchAt = 0;
    let relaunchCount = 0;

    return waitFor(() => {
      abortIfHeidiJobCancelled(jobId);
      const answer = extractHeidiAnswerFromAskContent();
      const copyButton = findHeidiCopyTextButton();
      const stillThinking = isHeidiStillThinking();
      const now = Date.now();
      const hiddenOrBlurred = document.hidden || !document.hasFocus();

      if (hiddenOrBlurred) {
        hiddenSince = hiddenSince || now;
      } else {
        hiddenSince = 0;
      }

      if (
        hiddenSince &&
        now - hiddenSince >= HEIDI_FOCUS_IF_HIDDEN_AFTER_MS &&
        (!lastFocusAttemptAt || now - lastFocusAttemptAt >= HEIDI_RELAUNCH_COOLDOWN_MS)
      ) {
        lastFocusAttemptAt = now;
        updateHeidiStatus(jobId, "Heidi doit rester au premier plan pendant l'analyse, retour sur Heidi...");
        focusCurrentHeidiWindow();
      }

      if (answer) {
        if (answer !== lastAnswer) {
          lastAnswer = answer;
          stableSince = now;
          appendDebugLog("heidi:answer-candidate", {
            jobId,
            answerLength: answer.length,
            hasCopyButton: Boolean(copyButton),
            stillThinking,
          });
          return "";
        }

        const stableDelay = stillThinking
          ? HEIDI_ANSWER_STABLE_WITH_STUCK_THINKING_MS
          : copyButton
            ? HEIDI_ANSWER_STABLE_WITH_COPY_MS
            : HEIDI_ANSWER_STABLE_WITHOUT_COPY_MS;

        if (now - stableSince >= stableDelay) {
          if (stillThinking) {
            appendDebugLog("heidi:answer-accepted-with-thinking", {
              jobId,
              answerLength: answer.length,
              stableMs: now - stableSince,
            });
          }
          return answer;
        }

        return "";
      }

      if (stillThinking || !answer) {
        if (!firstThinkingAt) {
          firstThinkingAt = now;
        }

        const stuckLongEnough = now - firstThinkingAt >= HEIDI_RELAUNCH_IF_STUCK_AFTER_MS;
        const cooldownOk = !lastRelaunchAt || now - lastRelaunchAt >= HEIDI_RELAUNCH_COOLDOWN_MS;

        if (stuckLongEnough && cooldownOk && relaunchCount < HEIDI_MAX_RELAUNCHES) {
          const sendButton = findHeidiSendButton();
          if (sendButton) {
            relaunchCount += 1;
            lastRelaunchAt = now;
            updateHeidiStatus(jobId, `Heidi bloqué sans réponse : relance ${relaunchCount}/${HEIDI_MAX_RELAUNCHES}...`);
            appendDebugLog("heidi:answer-relaunch", {
              jobId,
              relaunchCount,
              stillThinking,
              hidden: document.hidden,
              hasFocus: document.hasFocus(),
              sendButton: describeDebugElement(sendButton),
            });
            focusCurrentHeidiWindow();
            clickButtonLikeUser(sendButton);
          }
        }

        return "";
      }

      firstThinkingAt = 0;
      return "";
    }, {
      timeout: 180000,
      interval: 700,
      description: "la fin de génération Heidi",
    });
  }

  function isHeidiStillThinking() {
    if (findVisibleHeidiThinkingElement()) {
      return true;
    }

    const root = document.querySelector("#ask-ai-content") ||
      document.querySelector("#ask-ai-container") ||
      document.body;
    const text = normalizeForCompare(getVisibleText(root)).replace(/['’]/g, " ");

    return (
      /l\s*ia\s+est\s+en\s+train\s+de\s+reflechir/.test(text) ||
      /ia\s+est\s+en\s+train\s+de\s+reflechir/.test(text) ||
      text.includes("bientot termine") ||
      text.includes("generation en cours") ||
      text.includes("en train de reflechir")
    );
  }

  function findVisibleHeidiThinkingElement() {
    const candidates = Array.from(document.querySelectorAll("p, div, span"))
      .filter((element) => /L[’']IA est en train de réfléchir/i.test(normalizeText(element.textContent)));

    return candidates.find(isElementVisible) || null;
  }

  function findHeidiCopyTextButton() {
    return Array.from(document.querySelectorAll("button"))
      .find((button) => {
        if (!isElementVisible(button) || !isUsableButton(button)) {
          return false;
        }

        const text = normalizeText(button.textContent);
        const ariaLabel = normalizeText(button.getAttribute("aria-label") || "");
        const title = normalizeText(button.getAttribute("title") || "");
        const testId = normalizeText(button.getAttribute("data-testid") || "");
        const combined = `${text} ${ariaLabel} ${title} ${testId}`;

        return /copier(?:\s+le\s+texte)?/i.test(combined) ||
          /copy/i.test(combined);
      }) || null;
  }

  function isElementVisible(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  async function extractHeidiAnswer(copyButton) {
    const nearbyAnswer = extractAnswerNear(copyButton);
    if (nearbyAnswer) {
      return nearbyAnswer;
    }

    const container = document.querySelector("#ask-ai-container") || document.body;
    return extractAnswerFromText(getVisibleText(container));
  }

  function extractAnswerNear(button) {
    let node = button;

    for (let depth = 0; node && node !== document.body && depth < 10; depth += 1) {
      const text = getVisibleText(node);
      const answer = extractAnswerFromText(text);
      if (answer) {
        return answer;
      }
      node = node.parentElement;
    }

    return "";
  }

  function extractAnswerFromText(text) {
    const normalized = stripHeidiPromptBlocksFromText(text)
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();

    const shortAnswer = extractShortHeidiLine(normalized);
    if (shortAnswer) {
      return shortAnswer;
    }

    return "";
  }

  function stripHeidiPromptBlocksFromText(text) {
    const lines = String(text || "").replace(/\r/g, "\n").split("\n");
    const output = [];
    let skippingPrompt = false;

    lines.forEach((line) => {
      const normalized = normalizeForCompare(line).replace(/['’]/g, " ");

      if (!skippingPrompt && (
        normalized.includes("role : medecin generaliste") ||
        normalized.includes("objectif : synthetiser le courrier medical") ||
        normalized === "consignes :"
      )) {
        skippingPrompt = true;
        return;
      }

      if (skippingPrompt) {
        if (normalized.includes("specialite ou examen si utile")) {
          skippingPrompt = false;
        }
        return;
      }

      output.push(line);
    });

    return output.join("\n");
  }

  function extractShortHeidiLine(text) {
    const lines = String(text || "")
      .split("\n")
      .map((line) => sanitizeTitle(removeHeidiUiNoise(line)))
      .filter(Boolean);
    const lineCandidate = findLastExpectedTitleLine(lines);

    if (lineCandidate) {
      return lineCandidate;
    }

    const collapsed = sanitizeTitle(removeHeidiUiNoise(text));
    return isExpectedTitleLine(collapsed) ? collapsed : "";
  }

  function removeHeidiUiNoise(value) {
    let text = normalizeText(value);
    const stopMarkers = [
      " Copier le texte",
      " Copier",
      " Bientôt terminé",
      " L'IA est en train",
      " L’IA est en train",
      " Transcrire",
      " COURRIER MÉDICAL À SYNTHÉTISER",
    ];

    stopMarkers.forEach((marker) => {
      const index = text.indexOf(marker);
      if (index > 0) {
        text = text.slice(0, index);
      }
    });

    return text;
  }

  function findLastExpectedTitleLine(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (isExpectedTitleLine(lines[index])) {
        return lines[index];
      }
    }

    return "";
  }

  function isExpectedTitleLine(value) {
    const text = sanitizeTitle(value);

    if (!text) {
      return false;
    }

    if (text.length < 4 || text.length > 260) {
      return false;
    }

    if (/[\n\r•]/.test(text)) {
      return false;
    }

    if (hasForbiddenHeidiLineText(text)) {
      return false;
    }

    if (!/[a-zA-ZÀ-ÖØ-öø-ÿ0-9]/.test(text)) {
      return false;
    }

    return true;
  }

  function hasForbiddenHeidiLineText(text) {
    const normalized = normalizeForCompare(text).replace(/['’]/g, " ");

    return isPromptInstructionLine(text) ||
      /^(?:role|objectif|consignes|format attendu)\s*:/.test(normalized) ||
      /(?:courrier medical a synthetiser|repondre en francais|faire une seule phrase|ne jamais|ne pas faire|extraire uniquement|mentionner de facon concise|utiliser un style|conserver les termes|eviter les details|format attendu|une phrase unique du type|copier le texte|bientot termine|l ia est en train|demandez a l ia|nouvelle session|je ne peux pas|impossible d analyser|pdf joint est inaccessible|piece jointe non accessible|document inaccessible|aucun document accessible)/i.test(normalized);
  }

  function isPromptInstructionLine(text) {
    const normalized = normalizeForCompare(text)
      .replace(/['’]/g, " ")
      .replace(/^(?:[-–—•:;]\s*)+/, "");

    if (!normalized) {
      return false;
    }

    return /^(?:role|objectif|consignes|format attendu|repondre|faire|ne jamais|ne pas|extraire|mentionner|si aucune|utiliser|conserver|eviter|une phrase unique|specialite ou examen)\b/.test(normalized) ||
      /\b(?:prompt|consigne|format attendu|source unique)\b/.test(normalized);
  }

  function looksLikeBiologySummaryLine(text) {
    return isExpectedTitleLine(text);
  }

  function cleanAnswerPart(value) {
    return normalizeText(value)
      .replace(/^(?:-|–|—|:|;)+\s*/, "")
      .replace(/\s*(?:Copier le texte|Copier)$/i, "")
      .trim();
  }

  function sanitizeTitle(value) {
    return normalizeText(value)
      .replace(/\s*(?:\n|\r)+\s*/g, " - ")
      .replace(/\s{2,}/g, " ")
      .replace(/["“”]/g, "")
      .trim();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeForCompare(value) {
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function getVisibleText(root) {
    if (!root) {
      return "";
    }
    return normalizeMultilineText(root.innerText || root.textContent || "");
  }

  function normalizeMultilineText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function findButtonByText(text) {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((button) => normalizeText(button.textContent).includes(text)) || null;
  }

  function appendDebugLog(eventName, data = {}) {
    try {
      const logs = GM_getValue(DEBUG_LOG_KEY, []);
      const nextLogs = Array.isArray(logs) ? logs : [];
      const entry = {
        at: new Date().toISOString(),
        page: isHeidiPage ? "heidi" : isWedaPage ? "weda" : location.hostname,
        event: eventName,
        env: getDebugEnvironment(),
        data: sanitizeDebugData(data),
      };

      nextLogs.push(entry);
      GM_setValue(DEBUG_LOG_KEY, nextLogs.slice(-MAX_DEBUG_LOG_ENTRIES));
      renderDebugLogs();
    } catch (error) {
      try {
        console.warn("[WedaBioHeidi] debug log failed", error);
      } catch (_nestedError) {
        // Rien d'autre à faire si la console est inaccessible.
      }
    }
  }

  function getDebugEnvironment() {
    return {
      version: getScriptVersion(),
      path: location.pathname,
      search: location.search ? sanitizeDebugString(location.search, 140) : "",
      visibility: document.visibilityState || "",
      hidden: Boolean(document.hidden),
      hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      readyState: document.readyState,
    };
  }

  function getScriptVersion() {
    return SCRIPT_VERSION;
  }

  function sanitizeDebugData(data) {
    if (!data || typeof data !== "object") {
      return sanitizeDebugValue(data);
    }

    return Object.fromEntries(
      Object.entries(data)
        .filter(([key]) => !isSensitiveDebugKey(key))
        .map(([key, value]) => [key, sanitizeDebugValue(value)])
    );
  }

  function sanitizeDebugValue(value) {
    if (value == null || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return sanitizeDebugString(value);
    }

    if (Array.isArray(value)) {
      return value.slice(0, 12).map(sanitizeDebugValue);
    }

    if (typeof Element !== "undefined" && value instanceof Element) {
      return describeDebugElement(value);
    }

    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 20)
          .filter(([key]) => !isSensitiveDebugKey(key))
          .map(([key, nestedValue]) => [key, sanitizeDebugValue(nestedValue)])
      );
    }

    return String(value);
  }

  function isSensitiveDebugKey(key) {
    return /^(?:patient|nom|prenom|birth|naissance|identity|rowIdentity|title|titre|lastTitle|tableText|tableHtml|prompt|raw|answer|pdfAttachmentBase64)$/i.test(String(key || ""));
  }

  function sanitizeDebugString(value, maxLength = 400) {
    const text = normalizeText(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function describeDebugElement(element) {
    if (!element) {
      return null;
    }

    const rect = typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect()
      : null;
    const role = element.getAttribute ? element.getAttribute("role") : "";
    const testId = element.getAttribute ? element.getAttribute("data-testid") : "";
    const ariaSelected = element.getAttribute ? element.getAttribute("aria-selected") : "";
    const state = element.getAttribute ? element.getAttribute("data-state") : "";
    const textAllowed = element.matches && element.matches("button, [role='tab'], [role='button']");

    return {
      tag: element.tagName || "",
      id: element.id || "",
      role: role || "",
      testId: testId || "",
      ariaSelected: ariaSelected || "",
      state: state || "",
      className: sanitizeDebugString(element.className || "", 160),
      text: textAllowed ? sanitizeDebugString(element.textContent || "", 120) : "",
      visible: isElementVisible(element),
      rect: rect ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : null,
    };
  }

  function updateHeidiStatus(jobId, message, extra = {}) {
    if (getWorkflowCancellation(jobId)) {
      appendDebugLog("heidi:status-skipped-cancelled", {
        jobId,
        message,
      });
      return;
    }

    appendDebugLog("heidi:status", {
      jobId,
      message,
      ...extra,
    });

    GM_setValue(STATUS_KEY, {
      jobId,
      message,
      ...extra,
      createdAt: Date.now(),
    });
  }

  function waitForElement(selector, options = {}) {
    const root = options.root || document;
    return waitFor(() => root.querySelector(selector), {
      timeout: options.timeout || 30000,
      interval: options.interval || 250,
      description: options.description || selector,
    });
  }

  function waitFor(condition, options = {}) {
    const timeout = options.timeout || 30000;
    const interval = options.interval || 250;
    const description = options.description || "l'élément attendu";
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        let result = null;

        try {
          result = condition();
        } catch (error) {
          reject(error);
          return;
        }

        if (result) {
          resolve(result);
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          appendDebugLog("wait:timeout", {
            description,
            timeout,
            interval,
            elapsed: Date.now() - startedAt,
          });
          reject(new Error(`délai dépassé en attendant ${description}`));
          return;
        }

        window.setTimeout(check, interval);
      };

      check();
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value || "");

    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }

    return Math.abs(hash).toString(36);
  }

  function enterKeyOptions() {
    return {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
  }
})();
