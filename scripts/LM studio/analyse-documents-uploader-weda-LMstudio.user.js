// ==UserScript==
// @name         Weda - Synthese documents uploader LM Studio
// @namespace    https://secure.weda.fr/
// @version      0.2.0
// @description  Analyse les PDF de UpLoaderForm.aspx ligne par ligne avec LM Studio local, renseigne une synthese courte et prepare l'ajout ATCD CIM-10 si detecte.
// @match        https://secure.weda.fr/FolderMedical/UpLoaderForm.aspx*
// @match        https://secure.weda.fr/FolderMedical/PatientViewForm.aspx*
// @match        https://secure.weda.fr/FolderMedical/AntecedentForm.aspx*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      secure.weda.fr
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_VERSION = "0.2.0";
  const WEDA_HOST = "secure.weda.fr";

  const LMSTUDIO_API_BASE_URL = "http://localhost:1234/v1";
  const LMSTUDIO_CHAT_COMPLETIONS_URL = `${LMSTUDIO_API_BASE_URL}/chat/completions`;
  const LMSTUDIO_MODELS_URL = `${LMSTUDIO_API_BASE_URL}/models`;
  const LMSTUDIO_MODEL = "";
  const LMSTUDIO_REQUEST_TIMEOUT_MS = 300000;
  const LMSTUDIO_TEMPERATURE = 0;
  const LMSTUDIO_MAX_TOKENS = 900;
  const LMSTUDIO_MAX_DOCUMENT_TEXT_LENGTH = 45000;

  const COURRIER_ATCD_PROMPT = `Tu dois produire deux blocs balisés, et uniquement ces deux blocs.

Pour le bloc <TITRE_COURRIER>, applique strictement le prompt suivant, sans le modifier, et place uniquement la phrase finale obtenue entre les balises <TITRE_COURRIER> et </TITRE_COURRIER>.

--- PROMPT TITRE COURRIER À APPLIQUER STRICTEMENT ---

Rôle : médecin généraliste en France.

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
Spé abrégée ou examen si utile : résultat principal ; CAT / ttt / suivi si mentionné.

--- FIN DU PROMPT TITRE COURRIER ---

Pour le bloc <ANTECEDENT_CIM10>, cherche si le courrier permet d’identifier un éventuel nouvel antécédent à ajouter au dossier.

Consignes pour l’antécédent :
- Répondre en français.
- Ne jamais inventer d’information absente du document.
- Ne retenir qu’un diagnostic certifié, affirmé, posé ou confirmé.
- Ne pas retenir une suspicion, une hypothèse, un diagnostic différentiel, un simple motif d’examen, un symptôme isolé, une anomalie en cours d’exploration, une absence de diagnostic ou une recommandation de dépistage.
- Ne pas retenir un antécédent simplement listé comme déjà connu dans le courrier, dans une rubrique “antécédents”, “ATCD”, “histoire connue”, “connu pour”, “suivi pour”, “porteur de” ou équivalent.
- L’objectif est de signaler un antécédent nouveau par rapport à l'historique médical du patient.
- Ne pas retenir un antécédent familial sauf si le courrier affirme explicitement qu’un antécédent familial doit être ajouté.
- Si plusieurs nouveaux diagnostics certifiés sont présents, choisir le plus structurant pour le suivi en médecine générale.
- Chercher le code CIM-10 français le plus adapté correspondant au nouvel antécédent.
- Si aucun nouvel antécédent certain n’est identifiable, mettre STATUT: NON et laisser les autres champs vides.

Format de sortie obligatoire, sans texte avant ni après :
<TITRE_COURRIER>
Phrase de titre produite en appliquant strictement le prompt titre courrier ci-dessus.
</TITRE_COURRIER>
<ANTECEDENT_CIM10>
STATUT: OUI ou NON
SECTION: medical ou chirurgical ou familial
LIBELLE: libellé court de l’antécédent
CODE: code CIM-10 sans crochets
DATE: date du diagnostic si explicitement présente, sinon vide
CERTITUDE: raison courte montrant que le diagnostic est certifié
SOURCE: fragment très court du courrier justifiant l’ajout
</ANTECEDENT_CIM10>`;

  const PDFJS_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const PDF_MIN_TEXT_LENGTH = 35;
  const PDF_FETCH_RETRY_MS = 15000;
  const PDF_FETCH_RETRY_INTERVAL_MS = 900;
  const PDF_DISPLAY_WAIT_MS = 20000;
  const PDF_SAME_URL_ACCEPT_DELAY_MS = 1600;
  const PDF_IMAGE_FALLBACK_ENABLED = true;
  const PDF_IMAGE_MAX_PAGES = 4;
  const PDF_IMAGE_SCALE = 1.55;
  const PDF_IMAGE_MAX_SIDE_PX = 1800;
  const PDF_IMAGE_MIME_TYPE = "image/jpeg";
  const PDF_IMAGE_QUALITY = 0.86;
  const PDF_IMAGE_MAX_TOTAL_DATA_URL_LENGTH = 10 * 1024 * 1024;

  const MAX_SUMMARY_LENGTH = 190;
  const MAX_REMEMBERED_SUMMARIES = 1000;
  const MAX_DEBUG_LOG_ENTRIES = 500;
  const AUTO_RESUME_MAX_AGE_MS = 20 * 60 * 1000;
  const NEXT_ROW_DELAY_MS = 650;
  const APPLY_MEMORY_INTERVAL_MS = 4000;

  const STORAGE_PREFIX = "wedaUploaderLmStudioSummary.";
  const STATE_KEY = `${STORAGE_PREFIX}state.v1`;
  const MEMORY_KEY = `${STORAGE_PREFIX}summaries.v1`;
  const DEBUG_LOG_KEY = `${STORAGE_PREFIX}debugLog.v1`;
  const WEDA_ATCD_JOB_KEY = `${STORAGE_PREFIX}wedaAtcdJob.v1`;
  const WEDA_ATCD_WORKER_LOCK_KEY = `${STORAGE_PREFIX}wedaAtcdWorkerLock.v1`;
  const WEDA_ATCD_WORKER_TAB_ID_KEY = `${STORAGE_PREFIX}wedaAtcdWorkerTabId.v1`;
  const WEDA_ATCD_WORKER_HASH_PREFIX = "WEDA_UPLOADER_ATCD_LMSTUDIO_WORKER=";
  const WEDA_ATCD_WORKER_LOCK_MS = 45000;
  const WEDA_ATCD_WORKER_BADGE_ID = "weda-uploader-lmstudio-atcd-worker-badge";
  const WEDA_ATCD_OPEN_IN_BACKGROUND = true;

  const GRID_SELECTOR = "#ContentPlaceHolder1_FileStreamClassementsGrid";
  const TITLE_INPUT_SELECTOR = "input[id^='ContentPlaceHolder1_FileStreamClassementsGrid_EditBoxGridFileStreamClassementTitre_']";
  const DATE_INPUT_SELECTOR = "input[id^='ContentPlaceHolder1_FileStreamClassementsGrid_EditBoxGridFileStreamClassementDate_']";
  const PATIENT_LINK_SELECTOR = "a[id^='ContentPlaceHolder1_FileStreamClassementsGrid_LinkButtonFileStreamClassementsGridPatientNom_']";
  const PATIENT_OPEN_LINK_SELECTOR = "a[id^='ContentPlaceHolder1_FileStreamClassementsGrid_HyperLinkGotoPatient_']";
  const DESTINATION_SELECT_SELECTOR = "select[id^='ContentPlaceHolder1_FileStreamClassementsGrid_DropDownListGridFileStreamClassementEvenementType_']";
  const CLASSIFICATION_SELECT_SELECTOR = "select[id^='ContentPlaceHolder1_FileStreamClassementsGrid_DropDownListGridFileStreamClassementLabelClassification_']";
  const POSTBACK_ANTECEDENTS_WEDA = "ctl00$ContentPlaceHolder1$ButtonGotoAntecedent";
  const POSTBACK_SEARCH_CIM10_WEDA = "ctl00$ContentPlaceHolder1$TextBoxFind";
  const SELECTOR_PATIENT_PANEL = "#ContentPlaceHolder1_PanelPatient";
  const SELECTOR_WEDA_GOTO_ANTECEDENTS = "[onclick*='ButtonGotoAntecedent']";
  const SELECTOR_WEDA_ANTECEDENT_UPDATE_PANEL = "#ContentPlaceHolder1_UpdatePanelAntecedent";
  const SELECTOR_WEDA_CIM10_SEARCH = "#ContentPlaceHolder1_TextBoxFind";
  const SELECTOR_WEDA_CIM10_TREE = "#ContentPlaceHolder1_ArbreCim10UCForm1_TreeViewCim10";
  const SELECTOR_WEDA_COMMENT = "#ContentPlaceHolder1_TextBoxAntecedentCommentaire";
  const SELECTOR_WEDA_DATE_PONCTUELLE = "#ContentPlaceHolder1_TextBoxAntecedentDatePonctuel";
  const SELECTOR_WEDA_VALID = "#ContentPlaceHolder1_ButtonValid";

  const PDF_EMBED_SELECTOR = [
    "embed[original-url]",
    "iframe[original-url]",
    "embed[type='application/x-google-chrome-pdf']",
    "embed[type*='pdf']",
    "iframe[type='application/pdf']",
    "object[type='application/pdf']",
    "object[data*='BinaryData']",
    "embed[src*='BinaryData']",
    "iframe[src*='BinaryData']",
    "a[href*='BinaryData']",
    "[original-url*='BinaryData']",
    "[data-original-url*='BinaryData']",
    "[href*='application%2Fpdf']",
    "[src*='application%2Fpdf']",
  ].join(", ");

  const PANEL_ID = "weda-uploader-lmstudio-panel";
  const STATUS_ID = "weda-uploader-lmstudio-status";

  let workflowRunning = false;
  let stopRequested = false;
  let cachedLmStudioModelId = "";
  let memoryApplyTimer = null;

  if (window.top !== window.self) {
    return;
  }

  const IS_UPLOADER_PAGE = location.hostname === WEDA_HOST && /\/FolderMedical\/UpLoaderForm\.aspx$/i.test(location.pathname);
  const IS_PATIENT_VIEW_PAGE = location.hostname === WEDA_HOST && /\/FolderMedical\/PatientViewForm\.aspx$/i.test(location.pathname);
  const IS_ANTECEDENT_PAGE = location.hostname === WEDA_HOST && /\/FolderMedical\/AntecedentForm\.aspx$/i.test(location.pathname);

  if (!IS_UPLOADER_PAGE && !IS_PATIENT_VIEW_PAGE && !IS_ANTECEDENT_PAGE) {
    return;
  }

  if (!IS_UPLOADER_PAGE || getWedaAtcdWorkerJobIdFromHash()) {
    initWedaAtcdWorker().catch((error) => {
      appendDebugLog("weda-atcd-worker:init-failed", { error: getErrorMessage(error) });
    });
  }

  if (IS_UPLOADER_PAGE) {
    init();
  }

  function init() {
    ensurePanel();
    applyRememberedSummariesToRows({ force: false, silent: true });

    if (!memoryApplyTimer) {
      memoryApplyTimer = window.setInterval(() => {
        applyRememberedSummariesToRows({ force: false, silent: true });
      }, APPLY_MEMORY_INTERVAL_MS);
    }

    const state = getState();
    if (state && state.running && isStateFresh(state)) {
      setPanelStatus("Reprise de l'analyse en cours...");
      window.setTimeout(() => {
        processQueue(Number(state.currentIndex || 0), { resume: true, state }).catch((error) => {
          handleWorkflowFatalError(error);
        });
      }, 800);
    } else if (state && state.running) {
      setState({ running: false, phase: "expired", message: "Ancienne analyse abandonnee" });
    }

    appendDebugLog("script:init", {
      version: SCRIPT_VERSION,
      rowCount: getDocumentRows().length,
    });
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID) || !document.body) {
      return;
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.position = "fixed";
    panel.style.right = "14px";
    panel.style.bottom = "14px";
    panel.style.zIndex = "2147483647";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "7px";
    panel.style.padding = "10px";
    panel.style.border = "1px solid rgba(255,255,255,0.28)";
    panel.style.borderRadius = "8px";
    panel.style.background = "rgba(17, 46, 73, 0.94)";
    panel.style.color = "#fff";
    panel.style.boxShadow = "0 8px 24px rgba(0,0,0,0.28)";
    panel.style.font = "12px Arial, sans-serif";
    panel.style.maxWidth = "340px";

    const title = document.createElement("div");
    title.textContent = `Uploader LM Studio v${SCRIPT_VERSION}`;
    title.style.fontWeight = "700";
    title.style.color = "#d8ecff";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "Pret";
    status.style.lineHeight = "1.3";
    status.style.maxWidth = "320px";
    status.style.whiteSpace = "normal";

    const buttons = document.createElement("div");
    buttons.style.display = "flex";
    buttons.style.flexWrap = "wrap";
    buttons.style.gap = "6px";

    const startButton = createPanelButton("Analyser");
    const stopButton = createPanelButton("Stop");
    const memoryButton = createPanelButton("Memoire");
    const logsButton = createPanelButton("Logs");

    startButton.addEventListener("click", () => {
      stopRequested = false;
      processQueue(0, { resume: false }).catch((error) => {
        handleWorkflowFatalError(error);
      });
    }, true);

    stopButton.addEventListener("click", () => {
      stopRequested = true;
      setState({ running: false, phase: "stopped", message: "Arret demande" });
      setPanelStatus("Arret demande. La ligne en cours se terminera ou echouera proprement.");
      appendDebugLog("workflow:stop-requested", {});
    }, true);

    memoryButton.addEventListener("click", () => {
      const count = applyRememberedSummariesToRows({ force: false, silent: false });
      setPanelStatus(`${count} titre(s) restaure(s) depuis la memoire.`);
    }, true);

    logsButton.addEventListener("click", async () => {
      const ok = await copyDebugLogs();
      setPanelStatus(ok ? "Logs copies dans le presse-papiers." : "Copie des logs impossible.");
    }, true);

    buttons.appendChild(startButton);
    buttons.appendChild(stopButton);
    buttons.appendChild(memoryButton);
    buttons.appendChild(logsButton);

    panel.appendChild(title);
    panel.appendChild(status);
    panel.appendChild(buttons);
    document.body.appendChild(panel);
  }

  function createPanelButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.border = "1px solid rgba(255,255,255,0.35)";
    button.style.background = "rgba(255,255,255,0.12)";
    button.style.color = "#fff";
    button.style.borderRadius = "6px";
    button.style.padding = "5px 8px";
    button.style.font = "700 12px Arial, sans-serif";
    button.style.cursor = "pointer";
    return button;
  }

  function setPanelStatus(message) {
    const status = document.getElementById(STATUS_ID);
    if (status) {
      status.textContent = message || "";
    }
    try {
      console.info("[WedaUploaderLmStudio]", message);
    } catch (_error) {
      // Console indisponible.
    }
  }

  async function processQueue(startIndex = 0, options = {}) {
    if (workflowRunning) {
      setPanelStatus("Analyse deja en cours.");
      return;
    }

    workflowRunning = true;
    stopRequested = false;

    try {
      const initialRows = getDocumentRows();
      if (!initialRows.length) {
        setPanelStatus("Aucune ligne de document trouvee.");
        setState({ running: false, phase: "empty", currentIndex: 0 });
        return;
      }

      setState({
        running: true,
        phase: options.resume ? "resume" : "started",
        currentIndex: Math.max(0, Number(startIndex || 0)),
        rowCount: initialRows.length,
        startedAt: Date.now(),
      });

      for (let index = Math.max(0, Number(startIndex || 0)); index < getDocumentRows().length; index += 1) {
        if (stopRequested) {
          break;
        }

        setState({
          running: true,
          phase: "row-start",
          currentIndex: index,
          rowCount: getDocumentRows().length,
        });

        try {
          await processRow(index, {
            resume: options.resume && index === Number(startIndex || 0),
            state: options.state || getState(),
          });
        } catch (error) {
          const message = getErrorMessage(error);
          markRowByIndex(index, "error", message);
          appendDebugLog("workflow:row-error", {
            rowIndex: index,
            error: message,
            fatal: isFatalWorkflowError(error),
          });
          setPanelStatus(`Ligne ${index + 1} en erreur : ${message}`);

          if (isFatalWorkflowError(error)) {
            throw error;
          }
        }

        await sleep(NEXT_ROW_DELAY_MS);
      }

      setState({
        running: false,
        phase: stopRequested ? "stopped" : "done",
        currentIndex: getDocumentRows().length,
        message: stopRequested ? "Arret demande" : "Analyse terminee",
      });
      setPanelStatus(stopRequested ? "Analyse arretee." : "Analyse terminee pour les lignes visibles.");
    } finally {
      workflowRunning = false;
    }
  }

  async function processRow(index, options = {}) {
    const item = getDocumentRows()[index];
    if (!item) {
      appendDebugLog("workflow:row-missing", { rowIndex: index });
      return;
    }

    const baseKeys = buildRowMemoryKeys(item);
    const remembered = getRememberedSummary(baseKeys);
    if (remembered && sanitizeSummary(item.titleInput.value) === remembered.summary) {
      markRow(item, "done", "Deja renseigne");
      return;
    }
    if (remembered && shouldApplyMemoryToInput(item.titleInput, remembered.summary, false)) {
      setTitleInputValue(item.titleInput, remembered.summary);
      rememberSummary(baseKeys, remembered.summary, remembered);
      markRow(item, "done", "Titre restaure depuis la memoire");
      return;
    }

    markRow(item, "running", "Ouverture du PDF");
    setPanelStatus(`Ligne ${index + 1} : ouverture du PDF...`);
    setState({
      running: true,
      phase: "waiting-pdf",
      currentIndex: index,
      pendingRowKey: item.rowKey,
      pendingRowIndex: item.rowIndex,
    });

    let displayed = null;
    const resumeState = options.state || {};
    const canReuseDisplayedPdf = Boolean(
      options.resume &&
      resumeState.currentIndex === index &&
      /waiting-pdf|extracting|analyzing|resume/i.test(String(resumeState.phase || ""))
    );

    if (canReuseDisplayedPdf) {
      displayed = getDisplayedPdf({ includePerformance: true });
    }

    if (!displayed || !displayed.pdfUrl) {
      const previousPdfUrl = getDisplayedPdfUrl({ includePerformance: false });
      const minPerformanceStartTime = getCurrentPerformanceTime();
      clickElement(item.patientLink);
      displayed = await waitForDisplayedPdf({
        previousPdfUrl,
        minPerformanceStartTime,
      });
    }

    const pdfKeys = displayed && displayed.urlKey ? [displayed.urlKey] : [];
    const rememberedPdf = getRememberedSummary(pdfKeys);
    if (rememberedPdf && shouldApplyMemoryToInput(item.titleInput, rememberedPdf.summary, false)) {
      setTitleInputValue(item.titleInput, rememberedPdf.summary);
      rememberSummary([...baseKeys, ...pdfKeys], rememberedPdf.summary, rememberedPdf);
      markRow(item, "done", "Titre restaure depuis la memoire PDF");
      return;
    }

    setPanelStatus(`Ligne ${index + 1} : extraction du PDF...`);
    markRow(item, "running", "Extraction PDF");
    setState({
      running: true,
      phase: "extracting",
      currentIndex: index,
      pendingPdfKey: displayed.urlKey,
    });

    const documentData = await extractPdfDocument(displayed.pdfUrl);
    if (!documentData.text && !documentData.pageImages.length) {
      throw new Error("PDF sans texte exploitable ni image de secours");
    }

    setPanelStatus(`Ligne ${index + 1} : analyse LM Studio...`);
    markRow(item, "running", "Analyse LM Studio");
    setState({
      running: true,
      phase: "analyzing",
      currentIndex: index,
      pendingPdfKey: displayed.urlKey,
      sourceType: documentData.pageImages.length ? "pdf-image" : "pdf-text",
    });

    const answer = await analyzeDocumentWithLmStudio(documentData, item);
    const parsedResult = parseLmStudioCourrierAtcdOutput(answer);
    const summary = parsedResult.title || extractSummaryFromLmStudioAnswer(answer);
    if (!summary) {
      throw new Error("reponse LM Studio sans synthese utilisable");
    }

    const freshItem = getDocumentRows()[index] || item;
    setTitleInputValue(freshItem.titleInput || item.titleInput, summary);
    rememberSummary([...baseKeys, displayed.urlKey, documentData.urlKey].filter(Boolean), summary, {
      source: "lmstudio",
      pdfUrlHash: hashString(displayed.pdfUrl || ""),
      textLength: documentData.text.length,
      pageCount: documentData.pageCount,
      imageFallback: documentData.pageImages.length > 0,
      imageFallbackReason: documentData.imageFallbackReason || "",
    });

    const atcdWorkerOpened = await openWedaAntecedentWorkerFromUploaderIfNeeded({
      ...parsedResult,
      jobId: `uploader-row-${index}-${Date.now()}`,
      rowIndex: index,
      rowStableKey: item.rowKey,
      pdfUrl: displayed.pdfUrl || "",
      urlKey: displayed.urlKey || documentData.urlKey || "",
      contentKey: documentData.text ? `text-${hashString(documentData.text.slice(0, 12000))}` : "",
    }, summary, freshItem || item).catch((error) => {
      appendDebugLog("weda-atcd:open-worker-error", {
        rowIndex: index,
        error: getErrorMessage(error),
      });
      markRow(freshItem || item, "warning", "Synthese inseree, ATCD non prepare");
      return false;
    });

    const atcdWasDetected = Boolean(parsedResult.antecedent && (parsedResult.antecedent.status === "OUI" || parsedResult.antecedent.rejectionReason));
    markRow(
      freshItem || item,
      atcdWasDetected && !atcdWorkerOpened ? "warning" : "done",
      atcdWorkerOpened ? "Synthese inseree + ATCD ouvert" : atcdWasDetected ? "Synthese inseree, ATCD non prepare" : "Synthese inseree"
    );
    setState({
      running: true,
      phase: "row-done",
      currentIndex: index + 1,
      lastPdfKey: displayed.urlKey,
    });
    setPanelStatus(`Ligne ${index + 1} : synthese inseree.`);
  }

  function getDocumentRows() {
    const grid = document.querySelector(GRID_SELECTOR);
    if (!grid) {
      return [];
    }

    const body = grid.tBodies && grid.tBodies[0] ? grid.tBodies[0] : null;
    const rows = Array.from(body ? body.children : grid.querySelectorAll(":scope > tbody > tr"))
      .filter((row) => row && row.tagName === "TR")
      .filter((row) => row.querySelector(TITLE_INPUT_SELECTOR) && row.querySelector(PATIENT_LINK_SELECTOR));

    return rows.map((row, index) => buildRowItem(row, index));
  }

  function buildRowItem(row, index) {
    const titleInput = row.querySelector(TITLE_INPUT_SELECTOR);
    const patientLink = row.querySelector(PATIENT_LINK_SELECTOR);
    const patientOpenLink = row.querySelector(PATIENT_OPEN_LINK_SELECTOR);
    const dateInput = row.querySelector(DATE_INPUT_SELECTOR);
    const destinationSelect = row.querySelector(DESTINATION_SELECT_SELECTOR);
    const classificationSelect = row.querySelector(CLASSIFICATION_SELECT_SELECTOR);
    const rowIndex = extractTrailingIndex(titleInput && titleInput.id) ?? index;
    const originalTitle = sanitizeTitle(titleInput ? titleInput.getAttribute("value") || titleInput.defaultValue || titleInput.value : "");
    const currentTitle = sanitizeTitle(titleInput ? titleInput.value : "");
    const date = normalizeText(dateInput ? dateInput.value : "");
    const destination = getSelectedOptionText(destinationSelect);
    const classification = getSelectedOptionText(classificationSelect);
    const patientState = normalizeText(patientLink ? patientLink.getAttribute("title") || patientLink.textContent || "" : "");
    const rowKeySource = [
      "uploader-row-v1",
      rowIndex,
      date,
      originalTitle,
      normalizeText(patientLink ? patientLink.getAttribute("href") || "" : ""),
      patientState,
    ].join("|");

    return {
      row,
      index,
      rowIndex,
      titleInput,
      patientLink,
      patientOpenLink,
      date,
      originalTitle,
      currentTitle,
      destination,
      classification,
      rowKey: `row-${hashString(rowKeySource)}`,
    };
  }

  function extractTrailingIndex(value) {
    const match = String(value || "").match(/_(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  function getSelectedOptionText(select) {
    if (!select || !select.options || select.selectedIndex < 0) {
      return "";
    }
    return normalizeText(select.options[select.selectedIndex].textContent || "");
  }

  function buildRowMemoryKeys(item) {
    return [
      item && item.rowKey,
      item && item.date && item.originalTitle ? `row-title-${hashString([item.date, item.originalTitle, item.rowIndex].join("|"))}` : "",
    ].filter(Boolean);
  }

  async function openWedaAntecedentWorkerFromUploaderIfNeeded(result, title, rowItem) {
    const item = normalizeAntecedentForWeda(result && result.antecedent);
    if (!item) {
      if (result && result.antecedent && result.antecedent.rejectionReason) {
        appendDebugLog("weda-atcd:skipped-rejected", {
          rowIndex: result.rowIndex,
          reason: result.antecedent.rejectionReason,
          code: result.antecedent.code || "",
          label: result.antecedent.label || "",
        });
      }
      return null;
    }

    const context = await resolveUploaderPatientContextForAtcd(rowItem);
    if (!context || !context.patientId || !context.patientUrl) {
      appendDebugLog("weda-atcd:skipped-no-patient-context", {
        rowIndex: result && result.rowIndex,
        item,
        hasRowItem: Boolean(rowItem),
      });
      setPanelStatus(`Synthese inseree. ATCD detecte (${item.label} [${item.code}]), mais lien patient WEDA introuvable.`);
      return false;
    }

    const workerJobId = createId("uploader-atcd");
    const workerJob = buildWedaAntecedentWorkerJob(result, title, item, context, workerJobId);
    const workerUrl = buildWedaAtcdWorkerUrl(context.patientUrl, workerJobId);

    saveWedaAtcdWorkerJob(workerJob);

    try {
      if (typeof GM_openInTab === "function") {
        GM_openInTab(workerUrl, {
          active: !WEDA_ATCD_OPEN_IN_BACKGROUND,
          insert: !WEDA_ATCD_OPEN_IN_BACKGROUND,
          setParent: true,
        });
      } else {
        window.open(workerUrl, "_blank");
      }

      appendDebugLog("weda-atcd:worker-opened", {
        workerJobId,
        rowIndex: result && result.rowIndex,
        patientId: context.patientId,
        item,
        workerUrl,
      });
      setPanelStatus(`Synthese inseree. Onglet WEDA ouvert pour preparer l'ATCD : ${item.label} [${item.code}].`);
      return true;
    } catch (error) {
      appendDebugLog("weda-atcd:worker-open-failed", {
        workerJobId,
        error: getErrorMessage(error),
      });
      setPanelStatus("Synthese inseree. Echec ouverture du dossier patient pour l'ATCD : " + getErrorMessage(error));
      return false;
    }
  }

  function normalizeAntecedentForWeda(antecedent) {
    if (!antecedent || antecedent.status !== "OUI") {
      return null;
    }

    const code = normalizeCim10Code(antecedent.code);
    const label = sanitizeAntecedentLabel(antecedent.label);
    if (!label || !isLikelyCim10Code(code)) {
      return null;
    }

    return {
      section: normalizeAntecedentSection(antecedent.section),
      label,
      code,
      date: sanitizeAntecedentDate(antecedent.date),
      comment: label,
      description: label,
      certainty: normalizeText(antecedent.certainty || ""),
      source: normalizeText(antecedent.source || ""),
    };
  }

  async function resolveUploaderPatientContextForAtcd(rowItem) {
    const freshItem = findFreshRowItem(rowItem) || rowItem;
    let openLink = getUsablePatientOpenLink(freshItem);

    if (!openLink && freshItem && freshItem.patientLink) {
      appendDebugLog("weda-atcd:patient-context-click-detect", {
        rowIndex: freshItem.rowIndex,
      });
      clickElement(freshItem.patientLink);
      openLink = await waitFor(() => getUsablePatientOpenLink(findFreshRowItem(rowItem) || freshItem), {
        timeout: 12000,
        interval: 250,
        description: "le lien Ouvrir dossier patient WEDA",
      }).catch(() => null);
    }

    if (!openLink) {
      return null;
    }

    const patientUrl = normalizeWedaHref(openLink.getAttribute("href") || openLink.href || "");
    const patientId = extractWedaPatDkFromUrl(patientUrl);
    if (!patientUrl || !patientId) {
      return null;
    }

    return {
      patientId,
      patientUrl,
      patientLabel: normalizeText((openLink.getAttribute("title") || "").replace(/^Ouvrir la fiche patient dans un onglet\s*:\s*/i, "")),
      source: "uploader-row-open-link",
      openMode: "direct-patient-url",
    };
  }

  function findFreshRowItem(rowItem) {
    if (!rowItem) {
      return null;
    }

    const rows = getDocumentRows();
    return rows.find((candidate) => candidate.rowIndex === rowItem.rowIndex) ||
      rows.find((candidate) => candidate.index === rowItem.index) ||
      null;
  }

  function getUsablePatientOpenLink(rowItem) {
    if (!rowItem) {
      return null;
    }

    const link = (rowItem.row && rowItem.row.querySelector(PATIENT_OPEN_LINK_SELECTOR)) || rowItem.patientOpenLink || null;
    const href = link ? normalizeWedaHref(link.getAttribute("href") || link.href || "") : "";
    return href && /PatientViewForm\.aspx/i.test(href) && extractWedaPatDkFromUrl(href) ? link : null;
  }

  function normalizeWedaHref(href) {
    const raw = String(href || "").replace(/&amp;/gi, "&").trim();
    if (!raw || /^javascript:/i.test(raw)) {
      return "";
    }

    try {
      return new URL(raw, location.href).href;
    } catch (_error) {
      return raw;
    }
  }

  function extractWedaPatDkFromUrl(value) {
    try {
      const url = new URL(String(value || ""), `https://${WEDA_HOST}/`);
      for (const [key, val] of url.searchParams.entries()) {
        if (String(key).toLowerCase() === "patdk" && val) {
          return val;
        }
      }
    } catch (_error) {
      const match = String(value || "").match(/[?&]PatDk=([^&#]+)/i);
      if (match) {
        return safeDecodeURIComponent(match[1]);
      }
    }
    return "";
  }

  function buildWedaPatientUrlFromPatDk(patientId, sourceUrl = location.href) {
    if (!patientId) {
      return "";
    }

    try {
      const url = new URL(sourceUrl, `https://${WEDA_HOST}/`);
      return `${url.origin}/FolderMedical/PatientViewForm.aspx?PatDk=${encodeURIComponent(patientId)}`;
    } catch (_error) {
      return `https://${WEDA_HOST}/FolderMedical/PatientViewForm.aspx?PatDk=${encodeURIComponent(patientId)}`;
    }
  }

  function buildWedaAtcdWorkerUrl(url, jobId) {
    const base = String(url || `https://${WEDA_HOST}/`).split("#")[0];
    return `${base}#${WEDA_ATCD_WORKER_HASH_PREFIX}${encodeURIComponent(jobId)}`;
  }

  function getWedaAtcdJobStorageKey(workerJobId) {
    return `${WEDA_ATCD_JOB_KEY}.${encodeURIComponent(String(workerJobId || ""))}`;
  }

  function saveWedaAtcdWorkerJob(job) {
    if (!job || !job.id) {
      return null;
    }
    GM_setValue(getWedaAtcdJobStorageKey(job.id), job);
    GM_setValue(WEDA_ATCD_JOB_KEY, job);
    return job;
  }

  function getWedaAtcdWorkerJob(workerJobId) {
    if (!workerJobId) {
      return null;
    }

    const direct = GM_getValue(getWedaAtcdJobStorageKey(workerJobId), null);
    if (direct && direct.id === workerJobId) {
      return direct;
    }

    const latest = GM_getValue(WEDA_ATCD_JOB_KEY, null);
    return latest && latest.id === workerJobId ? latest : null;
  }

  function buildWedaAntecedentWorkerJob(result, title, item, context = {}, workerJobId = createId("uploader-atcd")) {
    return {
      id: workerJobId,
      sourceJobId: result && result.jobId ? result.jobId : "",
      status: "PENDING_WEDA_WORKER",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: title || "",
      rowIndex: result ? result.rowIndex : null,
      rowStableKey: result && result.rowStableKey ? result.rowStableKey : "",
      contentKey: result && result.contentKey ? result.contentKey : "",
      urlKey: result && result.urlKey ? result.urlKey : "",
      pdfUrl: result && result.pdfUrl ? result.pdfUrl : "",
      patientId: context.patientId || "",
      patientUrl: context.patientUrl || "",
      patientLabel: context.patientLabel || "",
      patientContextSource: context.source || "",
      patientOpenMode: context.openMode || "",
      sourceWedaUrl: location.href,
      item,
      rawLmStudioAntecedent: result && result.antecedent ? result.antecedent : null,
      persistentUntilManualValidation: true,
    };
  }

  async function initWedaAtcdWorker() {
    const workerJobId = getWedaAtcdWorkerJobIdForThisTab();
    if (!workerJobId) {
      return;
    }

    appendDebugLog("weda-atcd-worker:init", {
      workerJobId,
      version: SCRIPT_VERSION,
      path: location.pathname,
    });
    showWedaAtcdWorkerBadge("Preparation de l'antecedent CIM-10...", { sticky: true });

    try {
      await runWedaAtcdWorker(workerJobId);
    } catch (error) {
      appendDebugLog("weda-atcd-worker:error", {
        workerJobId,
        error: getErrorMessage(error),
      });
      updateWedaAtcdWorkerJob(workerJobId, {
        status: "ERROR",
        error: getErrorMessage(error),
      });
      showWedaAtcdWorkerBadge("Erreur ajout antecedent : " + getErrorMessage(error), {
        error: true,
        sticky: true,
      });
    }
  }

  function getWedaAtcdWorkerJobIdForThisTab() {
    const fromHash = getWedaAtcdWorkerJobIdFromHash();
    if (fromHash) {
      try {
        sessionStorage.setItem(WEDA_ATCD_WORKER_TAB_ID_KEY + ".job", fromHash);
      } catch (_error) {
        // SessionStorage optionnel.
      }
      return fromHash;
    }

    try {
      return sessionStorage.getItem(WEDA_ATCD_WORKER_TAB_ID_KEY + ".job") || "";
    } catch (_error) {
      return "";
    }
  }

  function getWedaAtcdWorkerJobIdFromHash() {
    const hash = String(location.hash || "").replace(/^#/, "");
    if (!hash) {
      return "";
    }

    if (hash.startsWith(WEDA_ATCD_WORKER_HASH_PREFIX)) {
      return safeDecodeURIComponent(hash.slice(WEDA_ATCD_WORKER_HASH_PREFIX.length));
    }

    const params = new URLSearchParams(hash);
    const value = params.get(WEDA_ATCD_WORKER_HASH_PREFIX.replace(/=$/, "")) ||
      params.get("WEDA_UPLOADER_ATCD_LMSTUDIO_WORKER");
    return value ? safeDecodeURIComponent(value) : "";
  }

  async function runWedaAtcdWorker(workerJobId) {
    let job = await waitFor(() => {
      return getWedaAtcdWorkerJob(workerJobId);
    }, {
      timeout: 30000,
      interval: 250,
      description: "le travail WEDA antecedent",
    });

    if (!acquireWedaAtcdWorkerLock(job)) {
      showWedaAtcdWorkerBadge("Un autre onglet prepare deja cet antecedent.", {
        error: true,
        sticky: true,
      });
      return;
    }

    try {
      job = updateWedaAtcdWorkerJob(workerJobId, {
        status: "RUNNING_WEDA_WORKER",
        workerUrl: location.href,
      }) || job;
      job = refreshWedaAtcdWorkerJobPatientFromCurrentUrl(workerJobId) || job;

      await ensureWedaAntecedentPageForAtcdWorker(job);
      job = refreshWedaAtcdWorkerJobPatientFromCurrentUrl(workerJobId) || job;
      assertWedaAtcdWorkerPatientMatches(job, "after_open_antecedents");

      const root = await waitForWedaAntecedentRootForAtcd();
      if (isAntecedentAlreadyKnownInWeda(job.item, root)) {
        updateWedaAtcdWorkerJob(workerJobId, {
          status: "ALREADY_KNOWN",
          finishedAt: Date.now(),
        });
        showWedaAtcdWorkerBadge(
          `Antecedent deja present ou tres proche dans WEDA : ${job.item.label} [${job.item.code}].\nAucune fenetre d'ajout n'a ete ouverte.`,
          { sticky: true }
        );
        return;
      }

      const found = await searchCim10InWedaForAtcd(job.item.code, job.item.label);
      await dropWedaCim10ForAtcdItem(found.hand, job.item);
      const validButton = await fillWedaAntecedentPopupForUser(job.item, job);

      updateWedaAtcdWorkerJob(workerJobId, {
        status: "NEEDS_USER_VALIDATION",
        matchedCode: found.matchedCode,
        matchedLabel: found.matchedLabel,
        usedFallback: Boolean(found.usedFallback),
        workerUrl: location.href,
        persistentUntilManualValidation: true,
      });

      showWedaAtcdWorkerBadge(
        `Fenetre d'ajout preparee : ${job.item.label} [${found.matchedCode || job.item.code}].\nVerifier puis valider manuellement dans WEDA.`,
        { sticky: true }
      );

      try {
        validButton.focus();
      } catch (_error) {
        // Le bouton reste volontairement non clique.
      }
    } finally {
      releaseWedaAtcdWorkerLock(job);
    }
  }

  function refreshWedaAtcdWorkerJobPatientFromCurrentUrl(workerJobId) {
    const current = getWedaAtcdWorkerJob(workerJobId);
    if (!current || current.id !== workerJobId) {
      return current;
    }

    const currentPatientId = extractWedaPatDkFromUrl(location.href);
    if (!currentPatientId || current.patientId) {
      return current;
    }

    return updateWedaAtcdWorkerJob(workerJobId, {
      patientId: currentPatientId,
      patientUrl: buildWedaPatientUrlFromPatDk(currentPatientId, location.href),
      patientContextSource: current.patientContextSource || "worker-current-url",
    }) || current;
  }

  function updateWedaAtcdWorkerJob(workerJobId, patch) {
    const current = getWedaAtcdWorkerJob(workerJobId);
    if (!current || current.id !== workerJobId) {
      return null;
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    saveWedaAtcdWorkerJob(next);
    return next;
  }

  function acquireWedaAtcdWorkerLock(job) {
    if (!job || !job.id) {
      return false;
    }

    const now = Date.now();
    const tabId = getOrCreateWedaAtcdWorkerTabId();
    const lock = GM_getValue(WEDA_ATCD_WORKER_LOCK_KEY, null);

    if (lock && lock.jobId === job.id && lock.tabId && lock.tabId !== tabId && Number(lock.expiresAt || 0) > now) {
      return false;
    }

    GM_setValue(WEDA_ATCD_WORKER_LOCK_KEY, {
      jobId: job.id,
      tabId,
      acquiredAt: now,
      expiresAt: now + WEDA_ATCD_WORKER_LOCK_MS,
    });
    return true;
  }

  function releaseWedaAtcdWorkerLock(job) {
    try {
      const tabId = getOrCreateWedaAtcdWorkerTabId();
      const lock = GM_getValue(WEDA_ATCD_WORKER_LOCK_KEY, null);
      if (lock && job && lock.jobId === job.id && lock.tabId === tabId) {
        GM_deleteValue(WEDA_ATCD_WORKER_LOCK_KEY);
      }
    } catch (_error) {
      // Lock best effort.
    }
  }

  function getOrCreateWedaAtcdWorkerTabId() {
    try {
      let id = sessionStorage.getItem(WEDA_ATCD_WORKER_TAB_ID_KEY);
      if (!id) {
        id = createId("tab");
        sessionStorage.setItem(WEDA_ATCD_WORKER_TAB_ID_KEY, id);
      }
      return id;
    } catch (_error) {
      return createId("tab");
    }
  }

  function isPatientViewUrlWeda() {
    return location.hostname === WEDA_HOST && /\/foldermedical\/patientviewform\.aspx/i.test(location.pathname);
  }

  function isPatientAccueilWeda() {
    return isPatientViewUrlWeda() && Boolean(document.querySelector(SELECTOR_PATIENT_PANEL));
  }

  function isAntecedentPageWeda() {
    return location.hostname === WEDA_HOST &&
      (/\/foldermedical\/antecedentform\.aspx/i.test(location.pathname) || Boolean(getWedaAntecedentRootForAtcd()));
  }

  function getWedaAntecedentRootForAtcd() {
    return document.querySelector(SELECTOR_WEDA_ANTECEDENT_UPDATE_PANEL) || null;
  }

  async function waitForWedaAntecedentRootForAtcd(timeoutMs = 20000) {
    return waitFor(() => getWedaAntecedentRootForAtcd(), {
      timeout: timeoutMs,
      interval: 500,
      description: "la page Antecedents WEDA",
    });
  }

  async function ensureWedaAntecedentPageForAtcdWorker(job) {
    if (isAntecedentPageWeda()) {
      await waitForWedaAntecedentRootForAtcd(20000);
      return true;
    }

    if (!isPatientAccueilWeda()) {
      if (job && job.patientUrl && !sameWedaPatDk(extractWedaPatDkFromUrl(location.href), job.patientId)) {
        location.assign(buildWedaAtcdWorkerUrl(job.patientUrl, job.id));
        await sleep(2500);
      }

      if (!isPatientAccueilWeda() && isPatientViewUrlWeda()) {
        await waitFor(() => isPatientAccueilWeda(), {
          timeout: 10000,
          interval: 400,
          description: "l'accueil patient WEDA",
        }).catch(() => null);
      }

      if (!isPatientAccueilWeda()) {
        throw new Error("le worker n'est pas sur l'accueil patient WEDA");
      }
    }

    assertWedaAtcdWorkerPatientMatches(job, "before_click_antecedents");
    showWedaAtcdWorkerBadge("Ouverture de la page Antecedents WEDA...", { sticky: true });

    const clicked = clickGotoAntecedentsWeda(job);
    if (!clicked) {
      throw new Error("bouton Antecedents WEDA introuvable");
    }

    try {
      await waitForWedaAntecedentRootForAtcd(12000);
    } catch (error) {
      if (isAntecedentPageWeda()) {
        throw error;
      }

      appendDebugLog("weda-atcd-worker:goto-antecedents-wait-retry", {
        workerJobId: job && job.id,
        error: getErrorMessage(error),
      });

      const fallbackClicked = callWedaPostBack(POSTBACK_ANTECEDENTS_WEDA, "");
      if (!fallbackClicked) {
        throw error;
      }

      await waitForWedaAntecedentRootForAtcd(20000);
    }

    await waitForWedaIdleForAtcd();
    return true;
  }

  function clickGotoAntecedentsWeda(job = null) {
    const candidates = getWedaAntecedentsNavigationCandidates();
    const clickable = candidates.find((element) => isElementVisible(element)) || candidates[0] || null;
    appendDebugLog("weda-atcd-worker:goto-antecedents-candidates", {
      workerJobId: job && job.id,
      count: candidates.length,
      hasPostBack: typeof ((typeof unsafeWindow !== "undefined" && unsafeWindow.__doPostBack) || window.__doPostBack) === "function",
    });

    if (clickable) {
      clickElement(clickable);
      return true;
    }

    return callWedaPostBack(POSTBACK_ANTECEDENTS_WEDA, "");
  }

  function getWedaAntecedentsNavigationCandidates() {
    const candidates = [];
    const add = (element) => {
      if (element && !candidates.includes(element)) {
        candidates.push(element);
      }
    };

    [
      SELECTOR_WEDA_GOTO_ANTECEDENTS,
      "#ContentPlaceHolder1_ButtonGotoAntecedent",
      "[id$='ButtonGotoAntecedent']",
      "[name='ctl00$ContentPlaceHolder1$ButtonGotoAntecedent']",
    ].forEach((selector) => {
      try {
        Array.from(document.querySelectorAll(selector)).forEach(add);
      } catch (_error) {
        // Selecteur best effort.
      }
    });

    Array.from(document.querySelectorAll("a, button, input, [role='button'], [onclick]"))
      .filter((element) => {
        const text = normalizeForCompare([
          element.innerText || element.textContent || "",
          element.getAttribute("value") || "",
          element.getAttribute("title") || "",
          element.getAttribute("aria-label") || "",
          element.id || "",
          element.name || "",
          element.getAttribute("onclick") || "",
        ].join(" "));
        return /antecedent/.test(text) && !/famil|chirurg/.test(text);
      })
      .forEach(add);

    return candidates;
  }

  function callWedaPostBack(target, argument = "") {
    const postBack = (typeof unsafeWindow !== "undefined" && unsafeWindow.__doPostBack) || window.__doPostBack;
    if (typeof postBack === "function") {
      postBack(target, argument);
      return true;
    }
    return false;
  }

  async function waitForWedaIdleForAtcd(timeoutMs = 12000) {
    await sleep(150);
    await waitFor(() => {
      try {
        const sys = (typeof unsafeWindow !== "undefined" && unsafeWindow.Sys) || window.Sys;
        const prm = sys && sys.WebForms && sys.WebForms.PageRequestManager && sys.WebForms.PageRequestManager.getInstance
          ? sys.WebForms.PageRequestManager.getInstance()
          : null;
        if (prm && typeof prm.get_isInAsyncPostBack === "function" && prm.get_isInAsyncPostBack()) {
          return false;
        }
      } catch (_error) {
        // Pas d'async postback detectable.
      }
      return true;
    }, {
      timeout: timeoutMs,
      interval: 250,
      description: "la fin du chargement WEDA",
    });
    await sleep(300);
    return true;
  }

  function sameWedaPatDk(expected, actual) {
    const left = normalizeText(expected);
    const right = normalizeText(actual);
    if (!left || !right) {
      return false;
    }
    return left === right || left.split("|")[0] === right.split("|")[0];
  }

  function assertWedaAtcdWorkerPatientMatches(job, phase) {
    const expected = normalizeText(job && job.patientId);
    const current = extractWedaPatDkFromUrl(location.href);

    if (!expected || !current || !sameWedaPatDk(expected, current)) {
      throw new Error(`securite patient (${phase}) : attendu ${expected || "inconnu"}, onglet ${current || "inconnu"}`);
    }
  }

  function isAntecedentAlreadyKnownInWeda(item, root = getWedaAntecedentRootForAtcd()) {
    if (!item || !root) {
      return false;
    }

    const text = normalizeText(root.innerText || root.textContent || "");
    const normalizedText = normalizeForCompare(text);
    const code = normalizeCim10Code(item.code);
    const looseCode = getCim10CodeLooseKey(code);

    if (code && new RegExp(`\\[?${escapeRegExp(code)}\\]?`, "i").test(text)) {
      return true;
    }

    if (looseCode && normalizedText.replace(/\./g, "").includes(looseCode.toLowerCase())) {
      return true;
    }

    const label = normalizeForCompare(item.label || item.description || "");
    if (label && normalizedText.includes(label)) {
      return true;
    }

    const overlap = getMeaningfulTokenOverlap(label, normalizedText);
    return overlap.common >= 3 && overlap.recall >= 0.8;
  }

  function getMeaningfulTokenOverlap(referenceText, candidateText) {
    const stop = new Set([
      "antecedent", "antecedents", "medical", "medicaux", "chirurgical", "chirurgicaux",
      "familial", "familiaux", "maladie", "syndrome", "trouble", "autre", "sans", "avec",
    ]);
    const refTokens = tokenizeAtcdText(referenceText).filter((token) => !stop.has(token));
    const candidateTokens = new Set(tokenizeAtcdText(candidateText));
    const common = refTokens.filter((token) => candidateTokens.has(token)).length;
    return {
      common,
      total: refTokens.length,
      recall: refTokens.length ? common / refTokens.length : 0,
    };
  }

  function tokenizeAtcdText(text) {
    return normalizeForCompare(text)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4);
  }

  function getCim10SearchQueriesForCode(code) {
    const normalized = normalizeCim10Code(code);
    const loose = getCim10CodeLooseKey(normalized);
    return [normalized, loose].filter((query, index, list) => query && list.indexOf(query) === index);
  }

  function sanitizeCim10SearchQuery(query) {
    return normalizeCim10Code(query).replace(/[\[\]]/g, "");
  }

  function getParentCim10Codes(code) {
    const cleanCode = normalizeCim10Code(code);
    const parents = [];

    if (!cleanCode) {
      return parents;
    }

    if (cleanCode.includes(".")) {
      const [root, extRaw] = cleanCode.split(".");
      let ext = String(extRaw || "");
      while (ext.length > 1) {
        ext = ext.slice(0, -1);
        parents.push(`${root}.${ext}`);
      }
      if (root && root !== cleanCode) {
        parents.push(root);
      }
    } else if (cleanCode.length > 3) {
      for (let index = cleanCode.length - 1; index >= 3; index -= 1) {
        parents.push(cleanCode.slice(0, index));
      }
    }

    return Array.from(new Set(parents.filter((parent) => parent && parent !== cleanCode)));
  }

  function cim10CodeEqualsLoose(left, right) {
    const a = getCim10CodeLooseKey(left);
    const b = getCim10CodeLooseKey(right);
    return Boolean(a && b && a === b);
  }

  function cim10CodeMatchesParentLoose(code, parentCode) {
    const codeKey = getCim10CodeLooseKey(code);
    const parentKey = getCim10CodeLooseKey(parentCode);
    return Boolean(codeKey && parentKey && (codeKey === parentKey || codeKey.startsWith(parentKey)));
  }

  function extractCim10CodesFromText(text) {
    const codes = [];
    const regex = /\[([A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?(?:-[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?)?)\]/gi;
    let match = null;

    while ((match = regex.exec(String(text || ""))) !== null) {
      const code = normalizeCim10Code(match[1]);
      if (isLikelyCim10Code(code) && !codes.includes(code)) {
        codes.push(code);
      }
    }

    return codes;
  }

  function removeCim10CodesFromText(text) {
    return normalizeText(String(text || "").replace(/\[[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?(?:-[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?)?\]/gi, ""));
  }

  async function performWedaCim10SearchQuery(query) {
    const safeQuery = sanitizeCim10SearchQuery(query);
    if (!safeQuery) {
      throw new Error("requete CIM-10 vide");
    }

    const input = await waitFor(() => document.querySelector(SELECTOR_WEDA_CIM10_SEARCH), {
      timeout: 12000,
      interval: 300,
      description: "le champ de recherche CIM-10",
    });

    showWedaAtcdWorkerBadge(`Recherche CIM-10 : ${safeQuery}`, { sticky: true });
    input.focus();
    setNativeInputValue(input, safeQuery);
    input.dispatchEvent(new KeyboardEvent("keydown", enterKeyOptions()));
    input.dispatchEvent(new KeyboardEvent("keypress", enterKeyOptions()));
    input.dispatchEvent(new KeyboardEvent("keyup", enterKeyOptions()));
    await sleep(150);
    callWedaPostBack(POSTBACK_SEARCH_CIM10_WEDA, "");
    await waitForWedaIdleForAtcd();
  }

  async function searchCim10InWedaForAtcd(code, referenceName = "") {
    await waitForWedaIdleForAtcd();

    const cleanCode = normalizeCim10Code(code);
    for (const query of getCim10SearchQueriesForCode(cleanCode)) {
      await performWedaCim10SearchQuery(query);
      const exact = await waitFor(() => findExactCim10Result(cleanCode), {
        timeout: 10000,
        interval: 400,
        description: "le resultat CIM-10 exact",
      }).catch(() => null);
      if (exact) {
        return exact;
      }
    }

    for (const parentCode of getParentCim10Codes(cleanCode)) {
      for (const query of getCim10SearchQueriesForCode(parentCode)) {
        await performWedaCim10SearchQuery(query);
        const best = await waitFor(() => findBestCim10ResultBySimilarity(parentCode, referenceName || cleanCode), {
          timeout: 10000,
          interval: 400,
          description: "un resultat CIM-10 parent",
        }).catch(() => null);
        if (best) {
          return best;
        }
      }
    }

    throw new Error(`CIM-10 introuvable : ${cleanCode}`);
  }

  function collectCim10TreeCandidates(parentCode = "") {
    const tree = document.querySelector(SELECTOR_WEDA_CIM10_TREE);
    if (!tree) {
      return [];
    }

    const wantedParent = normalizeCim10Code(parentCode);
    return Array.from(tree.querySelectorAll("a"))
      .map((anchor) => {
        const text = normalizeText(anchor.innerText || anchor.textContent || "");
        const codes = extractCim10CodesFromText(text);
        const hand = anchor.querySelector('img[title*="Drag"], img[alt="hand"], img[src*="hand"]') || anchor;
        return codes.map((candidateCode) => ({
          anchor,
          hand,
          code: candidateCode,
          label: removeCim10CodesFromText(text),
          text,
        }));
      })
      .flat()
      .filter((candidate) => {
        if (!wantedParent) {
          return true;
        }
        return candidate.code === wantedParent ||
          candidate.code.startsWith(wantedParent) ||
          cim10CodeMatchesParentLoose(candidate.code, wantedParent);
      });
  }

  function findExactCim10Result(code) {
    const normalizedCode = normalizeCim10Code(code);
    const exact = collectCim10TreeCandidates("")
      .find((candidate) => candidate.code === normalizedCode || cim10CodeEqualsLoose(candidate.code, normalizedCode));

    return exact ? {
      anchor: exact.anchor,
      hand: exact.hand,
      matchedCode: exact.code,
      matchedLabel: exact.label,
      searchCode: normalizedCode,
      usedFallback: false,
      similarityScore: 999,
    } : null;
  }

  function findBestCim10ResultBySimilarity(parentCode, referenceName) {
    const candidates = collectCim10TreeCandidates(parentCode);
    if (!candidates.length) {
      return null;
    }

    const scored = candidates.map((candidate) => ({
      ...candidate,
      similarityScore: scoreTextSimilarity(referenceName, candidate.label) + (candidate.code === parentCode ? 4 : 0),
    })).sort((left, right) => {
      if (right.similarityScore !== left.similarityScore) {
        return right.similarityScore - left.similarityScore;
      }
      if (left.code.length !== right.code.length) {
        return left.code.length - right.code.length;
      }
      return left.label.length - right.label.length;
    });

    const best = scored[0];
    return {
      anchor: best.anchor,
      hand: best.hand,
      matchedCode: best.code,
      matchedLabel: best.label,
      searchCode: parentCode,
      usedFallback: true,
      similarityScore: best.similarityScore,
    };
  }

  function scoreTextSimilarity(referenceText, candidateText) {
    const refTokens = new Set(tokenizeAtcdText(referenceText));
    const candidateTokens = new Set(tokenizeAtcdText(candidateText));

    if (!refTokens.size || !candidateTokens.size) {
      const left = normalizeForCompare(referenceText);
      const right = normalizeForCompare(candidateText);
      return left && right && (left.includes(right) || right.includes(left)) ? 60 : 0;
    }

    let intersection = 0;
    refTokens.forEach((token) => {
      if (candidateTokens.has(token)) {
        intersection += 1;
      }
    });

    const union = new Set([...refTokens, ...candidateTokens]).size || 1;
    const recall = intersection / refTokens.size;
    const jaccard = intersection / union;
    let score = Math.round(jaccard * 70 + recall * 50);
    const left = normalizeForCompare(referenceText);
    const right = normalizeForCompare(candidateText);

    if (left && right && right.includes(left)) {
      score += 35;
    }
    if (left && right && left.includes(right)) {
      score += 20;
    }

    return score;
  }

  function armWedaCim10Hand(hand) {
    if (!hand) {
      return false;
    }

    try {
      hand.scrollIntoView({ block: "center", inline: "center" });
    } catch (_error) {
      // Le drag synthetique est tente quand meme.
    }

    dispatchMouseForAtcd(hand, "mouseover");
    dispatchMouseForAtcd(hand, "mousemove");
    dispatchMouseForAtcd(hand, "mousedown");
    dispatchMouseForAtcd(hand, "mouseup");
    dispatchMouseForAtcd(hand, "click");

    try {
      if (typeof hand.onclick === "function") {
        hand.onclick.call(hand, dispatchMouseForAtcd(hand, "click"));
      }
    } catch (_error) {
      // WEDA peut ignorer l'appel direct.
    }

    return true;
  }

  async function dropWedaCim10ForAtcdItem(hand, item) {
    const sectionsToTry = item.section === "familial"
      ? ["familial", "medical"]
      : [item.section || "medical"];
    let lastError = null;

    for (const section of sectionsToTry) {
      try {
        await dropWedaCim10OnCategoryForAtcd(hand, section);
        return section;
      } catch (error) {
        lastError = error;
        await waitForWedaIdleForAtcd(5000);
      }
    }

    throw lastError || new Error("depot CIM-10 impossible");
  }

  async function dropWedaCim10OnCategoryForAtcd(hand, section) {
    const targets = getWedaDropTargetsForAtcdSection(section);
    if (!targets.length) {
      throw new Error("aucune rubrique WEDA trouvee pour " + section);
    }

    for (const target of targets) {
      try {
        target.scrollIntoView({ block: "center", inline: "center" });
      } catch (_error) {
        // Le clic reste tente.
      }

      await sleep(250);
      armWedaCim10Hand(hand);
      await sleep(250);
      dispatchMouseForAtcd(target, "mouseover");
      dispatchMouseForAtcd(target, "mousemove");
      dispatchDragForAtcd(hand, "dragstart");
      dispatchDragForAtcd(target, "dragenter");
      dispatchDragForAtcd(target, "dragover");
      dispatchDragForAtcd(target, "drop");
      dispatchMouseForAtcd(target, "mouseup");
      dispatchMouseForAtcd(target, "click");

      try {
        target.click();
      } catch (_error) {
        // Deja tente via evenements synthetiques.
      }

      const popup = await waitForWedaAntecedentPopupForAtcd(3500);
      if (popup) {
        return true;
      }

      await sleep(300);
      armWedaCim10Hand(hand);
      await sleep(250);
      clickElement(target);

      const popupAfterClick = await waitForWedaAntecedentPopupForAtcd(3500);
      if (popupAfterClick) {
        return true;
      }
    }

    throw new Error("la fenetre de detail antecedent WEDA ne s'est pas ouverte");
  }

  function getWedaDropTargetsForAtcdSection(section) {
    const root = getWedaAntecedentRootForAtcd() || document.body;
    const expected = expectedAtcdSectionHeader(section);
    return Array.from(root.querySelectorAll("div, span, td, th, a, table, tr"))
      .filter((element) => isElementVisible(element))
      .map((element, index) => ({
        element,
        index,
        score: scoreAtcdDropTarget(element, expected, section),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 18)
      .map((entry) => entry.element);
  }

  function expectedAtcdSectionHeader(section) {
    if (section === "chirurgical") {
      return "antecedents chirurgicaux";
    }
    if (section === "familial") {
      return "antecedents familiaux";
    }
    return "antecedents medicaux";
  }

  function scoreAtcdDropTarget(element, expected, section) {
    const rawText = normalizeText([
      getOwnElementText(element),
      element.getAttribute("title") || "",
      element.getAttribute("aria-label") || "",
      element.className || "",
    ].join(" "));
    const text = normalizeForCompare(rawText);
    const fullText = normalizeForCompare(element.innerText || element.textContent || "");

    if (!text && !fullText) {
      return 0;
    }
    if (/allerg|traitement|facteur de risque|ald|mode de vie|pathologie/.test(text)) {
      return 0;
    }
    if (section === "chirurgical" && /gyneco|obstetric/.test(text)) {
      return 0;
    }

    let score = 0;
    if (text === expected) {
      score += 120;
    }
    if (text.includes(expected)) {
      score += 90;
    }
    if (fullText.includes(expected)) {
      score += 45;
    }
    if (/sma|sm|antecedent/.test(String(element.className || "").toLowerCase())) {
      score += 20;
    }
    if (["TD", "DIV", "SPAN", "TABLE", "TR"].includes(element.tagName)) {
      score += 5;
    }
    if (section === "familial" && !/famil/.test(`${text} ${fullText}`)) {
      return 0;
    }

    return score;
  }

  function getOwnElementText(element) {
    if (!element) {
      return "";
    }

    return Array.from(element.childNodes || [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ");
  }

  async function waitForWedaAntecedentPopupForAtcd(timeoutMs = 2500) {
    return waitFor(() => {
      const textarea = document.querySelector(SELECTOR_WEDA_COMMENT);
      return textarea && isElementVisible(textarea) ? textarea : null;
    }, {
      timeout: timeoutMs,
      interval: 200,
      description: "la fenetre de detail antecedent",
    }).catch(() => null);
  }

  async function fillWedaAntecedentPopupForUser(item, job = null) {
    const textarea = await waitFor(() => {
      const element = document.querySelector(SELECTOR_WEDA_COMMENT);
      return element && isElementVisible(element) ? element : null;
    }, {
      timeout: 15000,
      interval: 300,
      description: "le champ commentaire de l'antecedent",
    });

    assertWedaAtcdWorkerPatientMatches(job, "before_fill_popup");
    textarea.focus();
    setNativeInputValue(textarea, item.comment || item.label || item.description || "");

    if (item.date) {
      const dateInput = document.querySelector(SELECTOR_WEDA_DATE_PONCTUELLE);
      if (dateInput && isElementVisible(dateInput)) {
        setNativeInputValue(dateInput, item.date);
      }
    }

    const validButton = await waitFor(() => {
      const button = document.querySelector(SELECTOR_WEDA_VALID);
      return button && isElementVisible(button) ? button : null;
    }, {
      timeout: 10000,
      interval: 300,
      description: "le bouton Valider WEDA",
    });

    appendDebugLog("weda-atcd-worker:popup-filled-no-validate", {
      workerJobId: job && job.id,
      item,
      hasValidButton: Boolean(validButton),
    });

    return validButton;
  }

  function dispatchMouseForAtcd(element, type) {
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const x = Math.max(1, Math.round(rect.left + rect.width / 2));
    const y = Math.max(1, Math.round(rect.top + rect.height / 2));

    try {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: type === "mouseup" || type === "click" ? 0 : 1,
      });
      element.dispatchEvent(event);
      return event;
    } catch (_error) {
      return null;
    }
  }

  function dispatchDragForAtcd(element, type) {
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const x = Math.max(1, Math.round(rect.left + rect.width / 2));
    const y = Math.max(1, Math.round(rect.top + rect.height / 2));

    try {
      const event = typeof DragEvent === "function"
        ? new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
        : new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      element.dispatchEvent(event);
      return event;
    } catch (_error) {
      return null;
    }
  }

  function showWedaAtcdWorkerBadge(message, options = {}) {
    try {
      const old = document.getElementById(WEDA_ATCD_WORKER_BADGE_ID);
      if (old) {
        old.remove();
      }

      const badge = document.createElement("div");
      badge.id = WEDA_ATCD_WORKER_BADGE_ID;
      badge.textContent = message;
      badge.style.position = "fixed";
      badge.style.left = "14px";
      badge.style.bottom = "14px";
      badge.style.zIndex = "2147483647";
      badge.style.maxWidth = "380px";
      badge.style.whiteSpace = "pre-line";
      badge.style.background = options.error ? "#7a1020" : "#12395f";
      badge.style.color = "#ffffff";
      badge.style.borderRadius = "8px";
      badge.style.padding = "10px 12px";
      badge.style.font = "13px Arial, sans-serif";
      badge.style.fontWeight = "700";
      badge.style.boxShadow = "0 8px 24px rgba(0,0,0,0.28)";
      document.documentElement.appendChild(badge);

      if (!options.sticky) {
        window.setTimeout(() => {
          try {
            badge.remove();
          } catch (_error) {
            // Badge deja supprime.
          }
        }, options.duration || 8000);
      }
    } catch (_error) {
      // Notification non critique.
    }
  }

  function markRowByIndex(index, status, message) {
    const item = getDocumentRows()[index];
    if (item) {
      markRow(item, status, message);
    }
  }

  function markRow(item, status, message) {
    if (!item || !item.row) {
      return;
    }

    const badge = ensureRowBadge(item);
    badge.textContent = message || status || "";
    badge.dataset.status = status || "";
    badge.style.color = status === "error" ? "#a40000" : status === "done" ? "#007f0e" : "#7a4b00";
    badge.style.background = status === "error" ? "#ffe2e2" : status === "done" ? "#e5ffe8" : "#fff2c2";
    item.row.style.outline = status === "error" ? "2px solid #d93025" : status === "running" ? "2px solid #f9ab00" : "";
  }

  function ensureRowBadge(item) {
    const existing = item.row.querySelector(".weda-uploader-lmstudio-row-status");
    if (existing) {
      return existing;
    }

    const badge = document.createElement("span");
    badge.className = "weda-uploader-lmstudio-row-status";
    badge.style.display = "inline-block";
    badge.style.marginTop = "3px";
    badge.style.padding = "2px 5px";
    badge.style.borderRadius = "4px";
    badge.style.font = "700 10px Arial, sans-serif";
    badge.style.maxWidth = "240px";
    badge.style.whiteSpace = "normal";

    const titleInput = item.titleInput;
    const parent = titleInput && titleInput.parentElement ? titleInput.parentElement.parentElement || titleInput.parentElement : item.row.cells[1];
    if (parent) {
      parent.appendChild(document.createElement("br"));
      parent.appendChild(badge);
    }
    return badge;
  }

  function clickElement(element) {
    if (!element) {
      return false;
    }

    try {
      element.scrollIntoView({ block: "center", inline: "center" });
    } catch (_error) {
      // scrollIntoView peut echouer dans certains conteneurs WEDA.
    }
    try {
      element.focus();
    } catch (_error) {
      // Focus non critique.
    }

    const doc = element.ownerDocument || document;
    const win = doc.defaultView || window;
    const rect = typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect()
      : { left: 0, top: 0, width: 1, height: 1 };
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    ["mouseover", "mousedown", "mouseup", "click"].forEach((type) => {
      try {
        element.dispatchEvent(new win.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
        }));
      } catch (_error) {
        // Evenement de confort seulement.
      }
    });

    try {
      element.click();
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function waitForDisplayedPdf(options = {}) {
    const startedAt = Date.now();
    const previousPdfUrl = options.previousPdfUrl || "";
    const minPerformanceStartTime = Number(options.minPerformanceStartTime || 0);

    return waitFor(() => {
      const displayed = getDisplayedPdf({ includePerformance: false });
      const freshPerformanceUrl = getFreshPerformancePdfUrl(minPerformanceStartTime, previousPdfUrl);

      if (displayed && displayed.pdfUrl && (!previousPdfUrl || displayed.pdfUrl !== previousPdfUrl)) {
        return displayed;
      }

      if (freshPerformanceUrl) {
        return buildDisplayedPdfFromUrl(freshPerformanceUrl);
      }

      if (!displayed || !displayed.pdfUrl) {
        return null;
      }

      if (previousPdfUrl && displayed.pdfUrl === previousPdfUrl) {
        if (Date.now() - startedAt < PDF_SAME_URL_ACCEPT_DELAY_MS) {
          return null;
        }
        return null;
      }

      return displayed;
    }, {
      timeout: PDF_DISPLAY_WAIT_MS,
      interval: 250,
      description: "le PDF affiche par WEDA",
    });
  }

  function getDisplayedPdf(options = {}) {
    const pdfUrl = getDisplayedPdfUrl(options);
    if (!pdfUrl) {
      return null;
    }
    return buildDisplayedPdfFromUrl(pdfUrl);
  }

  function buildDisplayedPdfFromUrl(pdfUrl) {
    return {
      pdfUrl,
      urlKey: `pdfurl-${hashString(pdfUrl)}`,
      element: findDisplayedPdfElement(),
    };
  }

  function getFreshPerformancePdfUrl(minPerformanceStartTime, previousPdfUrl) {
    return collectPdfUrlCandidatesFromPerformance(minPerformanceStartTime || 0)
      .map(normalizePdfUrl)
      .filter((url, index, list) => url && list.indexOf(url) === index)
      .find((url) => !previousPdfUrl || url !== previousPdfUrl) || "";
  }

  function getDisplayedPdfUrl(options = {}) {
    const candidates = getDisplayedPdfUrlCandidates(options);
    return candidates[0] || "";
  }

  function getDisplayedPdfUrlCandidates(options = {}) {
    const candidates = [];
    const addCandidate = (value) => {
      const url = normalizePdfUrl(value);
      if (url && isLikelyPdfUrl(url) && !/^chrome-extension:/i.test(url) && !candidates.includes(url)) {
        candidates.push(url);
      }
    };

    const visibleElements = querySelectorAllDeep(document, PDF_EMBED_SELECTOR)
      .filter((element) => isDisplayedPdfCandidateVisible(element));
    visibleElements.forEach((element) => addPdfElementCandidates(element, addCandidate));

    querySelectorAllDeep(document, PDF_EMBED_SELECTOR).forEach((element) => addPdfElementCandidates(element, addCandidate));

    if (options.includePerformance) {
      collectPdfUrlCandidatesFromPerformance(options.minPerformanceStartTime || 0).forEach(addCandidate);
    }

    return candidates;
  }

  function addPdfElementCandidates(element, addCandidate) {
    if (!element || !addCandidate) {
      return;
    }
    addCandidate(element.getAttribute("original-url"));
    addCandidate(element.getAttribute("data-original-url"));
    addCandidate(element.getAttribute("data"));
    addCandidate(element.getAttribute("href"));
    addCandidate(element.getAttribute("src"));
    addCandidate(element.getAttribute("data-src"));

    Array.from(element.attributes || []).forEach((attribute) => {
      if (isLikelyPdfUrl(attribute.value || "")) {
        addCandidate(attribute.value);
      }
    });
  }

  function findDisplayedPdfElement() {
    return querySelectorAllDeep(document, PDF_EMBED_SELECTOR)
      .find((element) => isDisplayedPdfCandidateVisible(element)) || null;
  }

  function isDisplayedPdfCandidateVisible(element) {
    if (!element) {
      return false;
    }
    if (isElementVisible(element)) {
      return true;
    }
    const container = typeof element.closest === "function" ? element.closest("#container, .pdfViewer, pdf-viewer") : null;
    return Boolean(container && isElementVisible(container));
  }

  function collectPdfUrlCandidatesFromPerformance(minStartTime = 0) {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
      return [];
    }

    return performance.getEntriesByType("resource")
      .filter((entry) => !minStartTime || entry.startTime >= minStartTime)
      .filter((entry) => isLikelyPdfUrl(entry.name || ""))
      .sort((left, right) => right.startTime - left.startTime)
      .map((entry) => entry.name);
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
        ["iframe", "frame"].includes(String(element.tagName || "").toLowerCase()) && visitFrameDocument(element);
      });
    };

    const visitFrameDocument = (frame) => {
      try {
        if (frame.contentDocument) {
          visit(frame.contentDocument);
        }
      } catch (_error) {
        // Les frames Chrome PDF ou cross-origin ne sont pas toujours lisibles.
      }
    };

    visit(root || document);
    return results;
  }

  function isLikelyPdfUrl(value) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }
    const decoded = safeDecodeURIComponent(text);
    return /BinaryData\.aspx/i.test(text) ||
      /\.pdf(?:[?#]|$)/i.test(text) ||
      /application(?:%2f|\/)pdf/i.test(text) ||
      /application\/pdf/i.test(decoded);
  }

  function normalizePdfUrl(rawUrl) {
    const text = String(rawUrl || "").trim();
    if (!text || /^javascript:/i.test(text) || /^blob:/i.test(text)) {
      return "";
    }
    try {
      return new URL(text.replace(/&amp;/g, "&"), location.origin).href;
    } catch (_error) {
      return text.replace(/&amp;/g, "&");
    }
  }

  async function extractPdfDocument(pdfUrl) {
    if (!pdfUrl) {
      throw new Error("URL du PDF introuvable");
    }

    await ensurePdfJsReady();
    const bytes = await fetchPdfBytes(pdfUrl);
    const originalBytes = new Uint8Array(bytes);
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(originalBytes),
      disableFontFace: true,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;

    try {
      const pageTexts = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (stopRequested) {
          throw new Error("analyse arretee");
        }
        const page = await pdf.getPage(pageNumber);
        const pageText = await extractPdfPageText(page);
        if (pageText) {
          pageTexts.push(`Page ${pageNumber}\n${pageText}`);
        }
        cleanupPdfPage(page);
      }

      const text = truncateLmStudioDocumentText(normalizePdfText(pageTexts.join("\n\n")));
      const quality = inspectPdfTextQuality(text, {
        pageCount: pdf.numPages || 0,
        byteLength: originalBytes.length,
      });
      let pageImages = [];

      if (PDF_IMAGE_FALLBACK_ENABLED && quality.shouldUseImages) {
        pageImages = await renderPdfPageImages(pdf);
      }

      appendDebugLog("pdf:extracted", {
        urlKey: `pdfurl-${hashString(pdfUrl)}`,
        textLength: text.length,
        pageCount: pdf.numPages || 0,
        byteLength: originalBytes.length,
        imageFallback: pageImages.length > 0,
        imageFallbackReason: quality.reason,
      });

      return {
        pdfUrl,
        urlKey: `pdfurl-${hashString(pdfUrl)}`,
        text,
        pageCount: pdf.numPages || 0,
        byteLength: originalBytes.length,
        pageImages,
        imageFallbackReason: pageImages.length ? quality.reason : "",
        textQuality: quality,
      };
    } finally {
      try {
        if (pdf && typeof pdf.destroy === "function") {
          await pdf.destroy();
        }
      } catch (_error) {
        // Nettoyage best effort.
      }
    }
  }

  async function ensurePdfJsReady() {
    const lib = typeof pdfjsLib !== "undefined" ? pdfjsLib : null;
    if (!lib || typeof lib.getDocument !== "function") {
      throw new Error("PDF.js n'est pas charge par Tampermonkey");
    }
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    }
  }

  async function fetchPdfBytes(pdfUrl) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt <= PDF_FETCH_RETRY_MS) {
      try {
        const response = await fetch(pdfUrl, {
          credentials: "include",
          cache: "no-store",
        });
        if (response.ok) {
          const bytes = await normalizePdfResponseBytes(await response.arrayBuffer(), {
            source: "fetch",
            status: response.status,
            contentType: response.headers ? response.headers.get("content-type") || "" : "",
          });
          if (bytes.length) {
            return bytes;
          }
          lastError = createPdfFetchError("corps PDF vide via fetch", { source: "fetch", status: response.status });
        } else {
          lastError = createPdfFetchError(`HTTP ${response.status}`, { source: "fetch", status: response.status });
        }
      } catch (error) {
        lastError = error;
      }

      if (typeof GM_xmlhttpRequest === "function") {
        try {
          return await fetchPdfBytesWithTampermonkey(pdfUrl);
        } catch (error) {
          lastError = error;
        }
      }

      await sleep(PDF_FETCH_RETRY_INTERVAL_MS);
    }

    throw new Error(`telechargement PDF impossible : ${lastError ? lastError.message : "erreur inconnue"}`);
  }

  async function fetchPdfBytesWithTampermonkey(pdfUrl) {
    let lastError = null;
    for (const responseType of ["arraybuffer", "blob", ""]) {
      try {
        const bytes = await requestPdfBytesWithTampermonkey(pdfUrl, responseType);
        if (bytes.length) {
          return bytes;
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("requete PDF Tampermonkey vide");
  }

  function requestPdfBytesWithTampermonkey(pdfUrl, responseType) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: pdfUrl,
        ...(responseType ? { responseType } : {}),
        headers: {
          Accept: "application/pdf,*/*",
        },
        anonymous: false,
        withCredentials: true,
        timeout: PDF_FETCH_RETRY_MS,
        onload: async (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(createPdfFetchError(`HTTP ${response.status}`, {
              source: "tampermonkey",
              responseType: responseType || "text",
              status: response.status,
            }));
            return;
          }
          try {
            const bytes = await normalizePdfResponseBytes(response.response || response.responseText || "", {
              source: "tampermonkey",
              responseType: responseType || "text",
              status: response.status,
              contentType: response.responseHeaders || "",
            });
            resolve(bytes);
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error("requete PDF Tampermonkey en echec")),
        ontimeout: () => reject(new Error("requete PDF Tampermonkey expiree")),
        onabort: () => reject(new Error("requete PDF Tampermonkey annulee")),
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
    } else if (typeof body === "string") {
      bytes = binaryStringToUint8Array(body);
    } else if (body && typeof body === "object" && Number.isFinite(Number(body.byteLength))) {
      bytes = new Uint8Array(body);
    } else {
      bytes = new Uint8Array(0);
    }

    bytes.pdfFetchInfo = {
      ...fetchInfo,
      byteLength: bytes.length,
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

  function cleanupPdfPage(page) {
    try {
      if (page && typeof page.cleanup === "function") {
        page.cleanup();
      }
    } catch (_error) {
      // Nettoyage best effort.
    }
  }

  async function renderPdfPageImages(pdf) {
    const images = [];
    const pageCount = Math.min(pdf.numPages || 0, PDF_IMAGE_MAX_PAGES);
    let totalLength = 0;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (stopRequested) {
        throw new Error("analyse arretee");
      }
      const page = await pdf.getPage(pageNumber);
      try {
        const image = await renderPdfPageToImageDataUrl(page, pageNumber);
        const nextTotal = totalLength + image.dataUrl.length;
        if (images.length && nextTotal > PDF_IMAGE_MAX_TOTAL_DATA_URL_LENGTH) {
          break;
        }
        images.push(image);
        totalLength = nextTotal;
      } finally {
        cleanupPdfPage(page);
      }
    }

    return images;
  }

  async function renderPdfPageToImageDataUrl(page, pageNumber) {
    const baseViewport = page.getViewport({ scale: 1 });
    const baseScale = Number(PDF_IMAGE_SCALE) || 1.5;
    const maxSide = Number(PDF_IMAGE_MAX_SIDE_PX) || 1800;
    const ratio = Math.min(1, maxSide / Math.max(baseViewport.width * baseScale, baseViewport.height * baseScale));
    const scale = Math.max(0.5, baseScale * ratio);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    if (!context) {
      throw new Error("canvas 2D indisponible pour convertir le PDF en image");
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    const dataUrl = canvas.toDataURL(PDF_IMAGE_MIME_TYPE, PDF_IMAGE_QUALITY);
    const result = {
      pageNumber,
      dataUrl,
      mimeType: PDF_IMAGE_MIME_TYPE,
      width: canvas.width,
      height: canvas.height,
      dataUrlLength: dataUrl.length,
    };

    canvas.width = 1;
    canvas.height = 1;
    return result;
  }

  function inspectPdfTextQuality(text, info = {}) {
    const normalized = normalizePdfText(text);
    const textLength = normalized.length;
    const words = normalized.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/g) || [];
    const lineCount = normalized ? normalized.split("\n").filter((line) => normalizeText(line)).length : 0;
    const privateUseCount = (normalized.match(/[\uE000-\uF8FF]/g) || []).length;
    const replacementCharCount = (normalized.match(/\uFFFD/g) || []).length;
    const symbolCount = (normalized.match(/[^\s\wÀ-ÖØ-öø-ÿ.,;:!?'"()/%+-]/g) || []).length;
    const commonWords = ["patient", "traitement", "consultation", "examen", "clinique", "diagnostic", "compte", "rendu", "docteur", "medical", "medecin", "hospitalier", "resultat"];
    const compare = normalizeForCompare(normalized);
    const commonHits = commonWords.filter((word) => compare.includes(word)).length;

    let reason = "";
    if (textLength < PDF_MIN_TEXT_LENGTH) {
      reason = "empty-text";
    } else if (textLength < 900 && (words.length < 80 || lineCount <= 8)) {
      reason = "sparse-text";
    } else if (
      privateUseCount >= 3 ||
      replacementCharCount >= 3 ||
      (textLength > 1000 && words.length / textLength < 0.012 && symbolCount / textLength > 0.08) ||
      (words.length >= 70 && commonHits < 3 && symbolCount / Math.max(1, textLength) > 0.07)
    ) {
      reason = "garbled-text";
    }

    return {
      textLength,
      wordCount: words.length,
      lineCount,
      pageCount: info.pageCount || 0,
      byteLength: info.byteLength || 0,
      privateUseCount,
      replacementCharCount,
      symbolCount,
      commonHits,
      reason,
      shouldUseImages: Boolean(reason),
    };
  }

  async function analyzeDocumentWithLmStudio(documentData, item) {
    const model = await getLmStudioModelId();
    const userContent = buildLmStudioUserMessageContent(documentData, item);
    const payload = {
      model,
      temperature: LMSTUDIO_TEMPERATURE,
      max_tokens: LMSTUDIO_MAX_TOKENS,
      stream: false,
      messages: [
        {
          role: "system",
          content: "Tu suis strictement les consignes fournies par l'utilisateur. Réponds uniquement avec les deux blocs XML demandés, sans texte autour.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    };

    appendDebugLog("lmstudio:request", {
      model,
      rowIndex: item && item.index,
      textLength: documentData.text.length,
      imageCount: documentData.pageImages.length,
      imageFallbackReason: documentData.imageFallbackReason || "",
    });

    const response = await gmJsonRequest({
      method: "POST",
      url: LMSTUDIO_CHAT_COMPLETIONS_URL,
      timeout: LMSTUDIO_REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify(payload),
    });

    const answer = extractLmStudioAnswer(response);
    appendDebugLog("lmstudio:response", {
      answerLength: answer.length,
      rowIndex: item && item.index,
    });
    return answer;
  }

  async function getLmStudioModelId() {
    if (LMSTUDIO_MODEL) {
      return LMSTUDIO_MODEL;
    }
    if (cachedLmStudioModelId) {
      return cachedLmStudioModelId;
    }

    try {
      const response = await gmJsonRequest({
        method: "GET",
        url: LMSTUDIO_MODELS_URL,
        timeout: 15000,
      });
      const models = Array.isArray(response && response.data) ? response.data : [];
      const firstModel = models.find((model) => model && model.id);
      if (firstModel && firstModel.id) {
        cachedLmStudioModelId = String(firstModel.id);
        return cachedLmStudioModelId;
      }
    } catch (error) {
      appendDebugLog("lmstudio:model-detect-error", {
        error: getErrorMessage(error),
      });
    }

    cachedLmStudioModelId = "local-model";
    return cachedLmStudioModelId;
  }

  function buildLmStudioUserMessageContent(documentData, item) {
    const prompt = buildLmStudioPrompt(documentData, item);
    if (!documentData.pageImages.length) {
      return prompt;
    }

    return [
      {
        type: "text",
        text: [
          prompt,
          documentData.imageFallbackReason === "garbled-text"
            ? "IMPORTANT : le texte extrait est probablement encode ou illisible. Utilise prioritairement les images jointes comme OCR visuel."
            : "IMPORTANT : le texte extrait est vide ou partiel. Utilise les images jointes comme source principale.",
        ].join("\n\n"),
      },
      ...documentData.pageImages.map((image) => ({
        type: "image_url",
        image_url: {
          url: image.dataUrl,
        },
      })),
    ];
  }

  function buildLmStudioPrompt(documentData, item) {
    const metadata = [
      item && item.date ? `Date WEDA : ${item.date}` : "",
      item && item.originalTitle ? `Titre actuel : ${item.originalTitle}` : "",
      item && item.destination ? `Destination WEDA : ${item.destination}` : "",
      item && item.classification && item.classification !== "..." ? `Classification WEDA : ${item.classification}` : "",
    ].filter(Boolean).join("\n");

    const sourceText = documentData.text
      ? truncateLmStudioDocumentText(documentData.text)
      : "[Aucun texte fiable extrait du PDF ; analyse les images jointes si presentes.]";

    return [
      COURRIER_ATCD_PROMPT,
      "",
      "COURRIER MÉDICAL À SYNTHÉTISER CI-DESSOUS",
      "",
      metadata ? `Contexte WEDA :\n${metadata}` : "",
      "",
      "Texte extrait du PDF :",
      sourceText,
    ].filter((part) => part !== "").join("\n");
  }

  function extractLmStudioAnswer(response) {
    const choices = Array.isArray(response && response.choices) ? response.choices : [];
    const firstChoice = choices[0] || {};
    const message = firstChoice.message || {};
    const content = typeof message.content === "string" ? message.content : firstChoice.text || "";
    return normalizeMultilineText(content);
  }

  function extractSummaryFromLmStudioAnswer(answer) {
    const tagged = extractTaggedBlock(answer, "TITRE_COURRIER") ||
      extractTaggedBlock(answer, "SYNTHESE_DOCUMENT");
    const source = tagged || stripAtcdBlock(answer);
    return sanitizeSummary(source);
  }

  function parseLmStudioCourrierAtcdOutput(rawAnswer) {
    const raw = String(rawAnswer || "").replace(/\r/g, "\n");
    const titleBlock = extractTaggedBlock(raw, "TITRE_COURRIER") || extractTaggedBlock(raw, "SYNTHESE_DOCUMENT");
    const atcdBlock = extractTaggedBlock(raw, "ANTECEDENT_CIM10");
    const fields = parseSimpleKeyValueBlock(atcdBlock);
    const status = normalizeAtcdStatus(fields.STATUT);
    const code = normalizeCim10Code(fields.CODE);
    const label = sanitizeAntecedentLabel(fields.LIBELLE);

    const antecedent = {
      status: status === "OUI" && isLikelyCim10Code(code) && label ? "OUI" : "NON",
      section: normalizeAntecedentSection(fields.SECTION),
      label,
      code,
      date: sanitizeAntecedentDate(fields.DATE),
      certainty: normalizeText(fields.CERTITUDE || ""),
      source: normalizeText(fields.SOURCE || ""),
      rawBlock: atcdBlock,
    };

    if (status === "OUI" && antecedent.status !== "OUI") {
      antecedent.rejectionReason = !label
        ? "libelle manquant"
        : !isLikelyCim10Code(code)
          ? "code CIM-10 absent ou invalide"
          : "antecedent inexploitable";
    }

    return {
      title: sanitizeSummary(titleBlock),
      antecedent,
      raw,
    };
  }

  function parseSimpleKeyValueBlock(blockText) {
    const fields = {};
    const raw = String(blockText || "").replace(/\r/g, "\n");

    raw.split("\n").forEach((line) => {
      const match = line.match(/^\s*([A-Z_À-ÖØ-Ý0-9 -]{2,40})\s*:\s*(.*?)\s*$/i);
      if (!match) {
        return;
      }

      const key = normalizeForCompare(match[1])
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
      fields[key] = normalizeText(match[2] || "");
    });

    const fieldRegex = /\b(STATUT|SECTION|LIBELLE|CODE|DATE|CERTITUDE|SOURCE)\s*:/gi;
    const matches = [];
    let match = null;

    while ((match = fieldRegex.exec(raw)) !== null) {
      matches.push({
        key: normalizeForCompare(match[1]).toUpperCase(),
        valueStart: fieldRegex.lastIndex,
        labelStart: match.index,
      });
    }

    matches.forEach((entry, index) => {
      const next = matches[index + 1];
      const value = normalizeText(raw.slice(entry.valueStart, next ? next.labelStart : raw.length));
      if (value) {
        fields[entry.key] = value;
      }
    });

    return fields;
  }

  function normalizeAtcdStatus(value) {
    return /^(oui|yes|o|1|true)\b/.test(normalizeForCompare(value)) ? "OUI" : "NON";
  }

  function sanitizeAntecedentLabel(value) {
    return normalizeText(value)
      .replace(/^\s*(?:ant[eé]c[eé]dent|diagnostic)\s*:\s*/i, "")
      .replace(/\s*\[[A-Z][0-9][0-9A-Z](?:\.[0-9A-Z]+)?\]\s*$/i, "")
      .slice(0, 180)
      .trim();
  }

  function normalizeAntecedentSection(value) {
    const normalized = normalizeForCompare(value);
    if (/chir/.test(normalized)) {
      return "chirurgical";
    }
    if (/famil/.test(normalized)) {
      return "familial";
    }
    return "medical";
  }

  function sanitizeAntecedentDate(value) {
    const text = normalizeText(value);
    if (!text || /^(?:non|vide|inconnue?|nc|na|n\/a)$/i.test(text)) {
      return "";
    }
    return text.replace(/[^\d/.\-]/g, "").slice(0, 20);
  }

  function normalizeCim10Code(code) {
    return String(code || "")
      .toUpperCase()
      .replace(/^\[+|\]+$/g, "")
      .replace(/\s+/g, "")
      .replace(/,$/, "")
      .trim();
  }

  function getCim10CodeLooseKey(code) {
    return normalizeCim10Code(code).replace(/\./g, "");
  }

  function isLikelyCim10Code(code) {
    return /^[A-Z][0-9][0-9A-Z](?:\.[0-9A-Z]+)?(?:-[A-Z][0-9][0-9A-Z](?:\.[0-9A-Z]+)?)?$/.test(normalizeCim10Code(code));
  }

  function stripAtcdBlock(value) {
    return String(value || "")
      .replace(/<ANTECEDENT_CIM10>[\s\S]*?<\/ANTECEDENT_CIM10>/gi, "")
      .trim();
  }

  function extractTaggedBlock(text, tagName) {
    const tag = escapeRegExp(tagName);
    const match = String(text || "").match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i"));
    return match && match[1] ? match[1].trim() : "";
  }

  function sanitizeSummary(value) {
    let text = normalizeText(value)
      .replace(/<\/?SYNTHESE_DOCUMENT>/gi, "")
      .replace(/<\/?TITRE_COURRIER>/gi, "")
      .replace(/<ANTECEDENT_CIM10>[\s\S]*$/i, "")
      .replace(/^\s*(?:synth[eè]se(?:\s+document)?|titre|r[eé]sum[eé])\s*:?\s*/i, "")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\s*(?:Copier le texte|Copier)$/i, "")
      .trim();

    text = text.replace(/[<>]/g, "").replace(/\s{2,}/g, " ").trim();

    if (text.length > MAX_SUMMARY_LENGTH) {
      const cut = text.slice(0, MAX_SUMMARY_LENGTH + 1);
      const lastBreak = Math.max(cut.lastIndexOf(" - "), cut.lastIndexOf("; "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
      text = cut.slice(0, lastBreak > 80 ? lastBreak : MAX_SUMMARY_LENGTH).trim();
    }

    return text;
  }

  function setTitleInputValue(input, value) {
    if (!input) {
      return false;
    }
    const clean = sanitizeSummary(value);
    if (!clean) {
      return false;
    }

    const doc = input.ownerDocument || document;
    const win = doc.defaultView || window;

    try {
      input.focus();
    } catch (_error) {
      // Focus non critique.
    }

    try {
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(input, clean);
      } else {
        input.value = clean;
      }
    } catch (_error) {
      input.value = clean;
    }

    try {
      input.title = clean;
    } catch (_error) {
      // Attribut title non critique.
    }

    ["input", "change", "keyup", "blur"].forEach((type) => {
      try {
        const event = type === "input" && typeof win.InputEvent === "function"
          ? new win.InputEvent(type, { bubbles: true, cancelable: true, inputType: "insertText", data: clean })
          : new win.Event(type, { bubbles: true, cancelable: true });
        input.dispatchEvent(event);
      } catch (_error) {
        // Evenement de confort.
      }
    });

    input.dataset.wedaUploaderLmstudioSummary = "1";
    return true;
  }

  function setNativeInputValue(input, value) {
    if (!input) {
      return false;
    }

    const doc = input.ownerDocument || document;
    const win = doc.defaultView || window;
    const prototype = input instanceof win.HTMLTextAreaElement
      ? win.HTMLTextAreaElement.prototype
      : win.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    try {
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
    } catch (_error) {
      input.value = value;
    }

    ["input", "change", "keyup", "blur"].forEach((type) => {
      try {
        const event = type === "input" && typeof win.InputEvent === "function"
          ? new win.InputEvent(type, { bubbles: true, cancelable: true, inputType: "insertText", data: value })
          : new win.Event(type, { bubbles: true, cancelable: true });
        input.dispatchEvent(event);
      } catch (_error) {
        // Evenement best effort.
      }
    });

    return true;
  }

  function applyRememberedSummariesToRows(options = {}) {
    const rows = getDocumentRows();
    let applied = 0;

    rows.forEach((item) => {
      const remembered = getRememberedSummary(buildRowMemoryKeys(item));
      if (!remembered || !remembered.summary) {
        return;
      }
      if (document.activeElement === item.titleInput) {
        return;
      }
      if (!shouldApplyMemoryToInput(item.titleInput, remembered.summary, Boolean(options.force))) {
        return;
      }
      if (setTitleInputValue(item.titleInput, remembered.summary)) {
        applied += 1;
        markRow(item, "done", "Titre restaure depuis la memoire");
      }
    });

    if (applied && !options.silent) {
      appendDebugLog("memory:applied", { count: applied });
    }
    return applied;
  }

  function shouldApplyMemoryToInput(input, summary, force) {
    if (!input || !summary) {
      return false;
    }
    const current = sanitizeSummary(input.value || "");
    if (current === summary) {
      return false;
    }
    if (force) {
      return true;
    }
    return !current || looksLikeRawPdfTitle(current);
  }

  function looksLikeRawPdfTitle(value) {
    const text = normalizeText(value);
    return /\.pdf$/i.test(text) ||
      /^\d{6,8}[\s_-].*\.pdf$/i.test(text) ||
      /^(?:scan|document|piece jointe|pdf|courrier scanne|fichier)\b/i.test(text);
  }

  function getRememberedSummary(keys) {
    const memory = getMemory();
    const lookup = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));
    for (const key of lookup) {
      const entry = memory[key];
      if (entry && entry.summary) {
        return entry;
      }
    }
    return null;
  }

  function rememberSummary(keys, summary, metadata = {}) {
    const clean = sanitizeSummary(summary);
    if (!clean) {
      return;
    }

    const memory = getMemory();
    const now = Date.now();
    Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean))).forEach((key) => {
      const previous = memory[key] || {};
      memory[key] = {
        ...previous,
        ...metadata,
        summary: clean,
        version: SCRIPT_VERSION,
        createdAt: previous.createdAt || now,
        updatedAt: now,
      };
    });

    GM_setValue(MEMORY_KEY, pruneMemory(memory));
  }

  function getMemory() {
    try {
      const memory = GM_getValue(MEMORY_KEY, {});
      return memory && typeof memory === "object" && !Array.isArray(memory) ? memory : {};
    } catch (_error) {
      return {};
    }
  }

  function pruneMemory(memory) {
    const entries = Object.entries(memory || {});
    if (entries.length <= MAX_REMEMBERED_SUMMARIES) {
      return memory;
    }
    return Object.fromEntries(
      entries
        .sort((left, right) => Number(right[1] && right[1].updatedAt || 0) - Number(left[1] && left[1].updatedAt || 0))
        .slice(0, MAX_REMEMBERED_SUMMARIES)
    );
  }

  function getState() {
    try {
      const state = GM_getValue(STATE_KEY, null);
      return state && typeof state === "object" ? state : null;
    } catch (_error) {
      return null;
    }
  }

  function setState(patch) {
    const current = getState() || {};
    const next = {
      ...current,
      ...patch,
      version: SCRIPT_VERSION,
      updatedAt: Date.now(),
      href: location.href,
    };
    GM_setValue(STATE_KEY, next);
    return next;
  }

  function isStateFresh(state) {
    return Boolean(state && Number(state.updatedAt || 0) > 0 && Date.now() - Number(state.updatedAt || 0) < AUTO_RESUME_MAX_AGE_MS);
  }

  function handleWorkflowFatalError(error) {
    const message = getErrorMessage(error);
    workflowRunning = false;
    setState({
      running: false,
      phase: "fatal-error",
      message,
    });
    setPanelStatus(`Analyse interrompue : ${message}`);
    appendDebugLog("workflow:fatal-error", {
      error: message,
    });
  }

  function isFatalWorkflowError(error) {
    const message = getErrorMessage(error);
    if (stopRequested && /analyse arret/i.test(normalizeForCompare(message))) {
      return false;
    }
    return /LM Studio|connexion|chat\/completions|models|HTTP|d[eé]lai|timeout|annulee|arretee/i.test(message);
  }

  function gmJsonRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest indisponible : verifiez les permissions Tampermonkey"));
        return;
      }

      GM_xmlhttpRequest({
        method: options.method || "GET",
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        timeout: options.timeout || LMSTUDIO_REQUEST_TIMEOUT_MS,
        onload: (response) => {
          const status = Number(response.status || 0);
          const body = response.responseText || "";
          if (status < 200 || status >= 300) {
            reject(new Error(`LM Studio HTTP ${status || "?"} : ${body.slice(0, 500)}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (error) {
            reject(new Error(`reponse LM Studio non JSON : ${error.message}`));
          }
        },
        onerror: () => reject(new Error("connexion a LM Studio impossible")),
        ontimeout: () => reject(new Error("delai depasse pendant l'appel a LM Studio")),
        onabort: () => reject(new Error("appel a LM Studio annule")),
      });
    });
  }

  async function copyDebugLogs() {
    const payload = JSON.stringify({
      generatedAt: new Date().toISOString(),
      version: SCRIPT_VERSION,
      state: getState(),
      logs: getDebugLogs(),
    }, null, 2);

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload);
        return true;
      }
    } catch (_error) {
      // Fallback execCommand.
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = payload;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch (_error) {
      return false;
    }
  }

  function appendDebugLog(eventName, data = {}) {
    try {
      const logs = getDebugLogs();
      logs.push({
        at: new Date().toISOString(),
        event: String(eventName || "log"),
        env: {
          version: SCRIPT_VERSION,
          path: location.pathname,
          visibility: document.visibilityState || "",
          readyState: document.readyState,
        },
        data: sanitizeDebugData(data),
      });
      GM_setValue(DEBUG_LOG_KEY, logs.slice(-MAX_DEBUG_LOG_ENTRIES));
    } catch (error) {
      try {
        console.warn("[WedaUploaderLmStudio] debug log failed", error);
      } catch (_nestedError) {
        // Rien d'autre a faire.
      }
    }
  }

  function getDebugLogs() {
    try {
      const logs = GM_getValue(DEBUG_LOG_KEY, []);
      return Array.isArray(logs) ? logs : [];
    } catch (_error) {
      return [];
    }
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
      return {
        tag: value.tagName || "",
        id: value.id || "",
        visible: isElementVisible(value),
      };
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
    return /^(?:patient|nom|prenom|birth|naissance|identity|title|titre|originalTitle|currentTitle|text|tableText|prompt|answer|summary|raw|dataUrl|image_url|pdfPageImages)$/i.test(String(key || ""));
  }

  function sanitizeDebugString(value, maxLength = 360) {
    const text = normalizeText(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function isElementVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return false;
    }
    const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      (!style || (style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0));
  }

  function waitFor(condition, options = {}) {
    const timeout = options.timeout || 30000;
    const interval = options.interval || 250;
    const description = options.description || "l'element attendu";
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        if (stopRequested) {
          reject(new Error("analyse arretee"));
          return;
        }

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
          reject(new Error(`delai depasse en attendant ${description}`));
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

  function createId(prefix = "id") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

  function getCurrentPerformanceTime() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : 0;
  }

  function truncateLmStudioDocumentText(value) {
    const text = normalizePdfText(value);
    if (text.length <= LMSTUDIO_MAX_DOCUMENT_TEXT_LENGTH) {
      return text;
    }
    const headLength = Math.floor(LMSTUDIO_MAX_DOCUMENT_TEXT_LENGTH * 0.7);
    const tailLength = LMSTUDIO_MAX_DOCUMENT_TEXT_LENGTH - headLength;
    return [
      text.slice(0, headLength).trim(),
      "[... document tronque pour LM Studio local ...]",
      text.slice(-tailLength).trim(),
    ].filter(Boolean).join("\n\n");
  }

  function normalizePdfText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeMultilineText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeTitle(value) {
    return normalizeText(value)
      .replace(/\s*(?:\n|\r)+\s*/g, " - ")
      .replace(/["“”]/g, "")
      .trim();
  }

  function normalizeForCompare(value) {
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (_error) {
      return String(value || "");
    }
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function getErrorMessage(error) {
    return error && error.message ? error.message : String(error || "erreur inconnue");
  }
})();
