// ==UserScript==
// @name         Weda - Analyse courriers PDF LM Studio + ATCD CIM-10
// @namespace    https://secure.weda.fr/
// @version      0.1.35
// @description  Analyse les courriers PDF de Weda Échanges avec LM Studio local, renseigne le titre et la spécialité, puis prépare l'ajout d'un nouvel antécédent CIM-10 certifié.
// @match        https://secure.weda.fr/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_closeTab
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      secure.weda.fr
// @connect      message.weda.fr
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const WEDA_HOST = "secure.weda.fr";
  const WEDA_PATH_PREFIX = "/FolderMedical/WedaEchanges";
  const HEIDI_HOST = "scribe.heidihealth.com";
  const HEIDI_URL = "https://scribe.heidihealth.com/";
  const LMSTUDIO_API_BASE_URL = "http://localhost:1234/v1";
  const LMSTUDIO_CHAT_COMPLETIONS_URL = `${LMSTUDIO_API_BASE_URL}/chat/completions`;
  const LMSTUDIO_MODELS_URL = `${LMSTUDIO_API_BASE_URL}/models`;
  const LMSTUDIO_MODEL = "";
  const LMSTUDIO_REQUEST_TIMEOUT_MS = 300000;
  const LMSTUDIO_TEMPERATURE = 0;
  const LMSTUDIO_MAX_TOKENS = 900;
  const LMSTUDIO_PATIENT_IDENTITY_MAX_TOKENS = 220;
  const LMSTUDIO_MAX_DOCUMENT_TEXT_LENGTH = 45000;
  const LMSTUDIO_PDF_IMAGE_FALLBACK_ENABLED = true;
  const LMSTUDIO_PDF_TEXT_SPARSE_FALLBACK_ENABLED = true;
  const LMSTUDIO_PDF_TEXT_SPARSE_MAX_CHARS = 900;
  const LMSTUDIO_PDF_TEXT_SPARSE_MAX_LINES = 10;
  const LMSTUDIO_PDF_TEXT_SPARSE_MAX_WORDS = 110;
  const LMSTUDIO_PDF_TEXT_GARBLED_FALLBACK_ENABLED = true;
  const LMSTUDIO_PDF_TEXT_GARBLED_PRIVATE_USE_MIN_CHARS = 3;
  const LMSTUDIO_PDF_TEXT_GARBLED_PRIVATE_USE_MIN_RATIO = 0.002;
  const LMSTUDIO_PDF_TEXT_GARBLED_SYMBOL_MIN_RATIO = 0.08;
  const LMSTUDIO_PDF_TEXT_GARBLED_MIN_WORDS_FOR_LANGUAGE_CHECK = 60;
  const LMSTUDIO_PDF_TEXT_GARBLED_MIN_COMMON_WORD_HITS = 4;
  const LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MIN_CHARS = 1000;
  const LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MIN_WORDS = 80;
  const LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MIN_COMMON_WORD_OCCURRENCES = 12;
  const LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MAX_COMMON_WORD_RATIO = 0.03;
  const LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MIN_CHARS = 1000;
  const LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MAX_RATIO = 0.012;
  const LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MIN_SYMBOL_RATIO = 0.12;
  const LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MAX_COMMON_WORD_OCCURRENCES = 3;
  const LMSTUDIO_ADMINISTRATIVE_TITLE_IMAGE_RETRY_ENABLED = true;
  const LMSTUDIO_PDF_IMAGE_MAX_PAGES = 4;
  const LMSTUDIO_PDF_IMAGE_SCALE = 1.65;
  const LMSTUDIO_PDF_IMAGE_MAX_SIDE_PX = 1800;
  const LMSTUDIO_PDF_IMAGE_MIME_TYPE = "image/jpeg";
  const LMSTUDIO_PDF_IMAGE_QUALITY = 0.86;
  const LMSTUDIO_PDF_IMAGE_MAX_TOTAL_DATA_URL_LENGTH = 10 * 1024 * 1024;
  const LMSTUDIO_UNUSABLE_PDF_FAIL_CLOSED = true;
  const UNUSABLE_PDF_TITLE = "PDF sans texte exploitable - analyse manuelle/OCR nécessaire.";
  const DOCUMENT_SIGNAL = "COURRIER MÉDICAL À SYNTHÉTISER CI-DESSOUS";
  const BIOLOGY_SIGNAL = DOCUMENT_SIGNAL;
  const SCRIPT_VERSION = "0.1.35";
  const PDFJS_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const MAX_PDF_TEXT_LENGTH = 70000;
  const MAX_RESULT_SOURCE_TEXT_LENGTH = 30000;

  const STORAGE_PREFIX = "wedaCourrierLmStudioAtcd.";
  const STATE_KEY = `${STORAGE_PREFIX}state`;
  const JOB_KEY = `${STORAGE_PREFIX}job`;
  const RESULT_KEY = `${STORAGE_PREFIX}result`;
  const WEDA_ATCD_JOB_KEY = `${STORAGE_PREFIX}wedaAtcdJob`;
  const WEDA_ATCD_PENDING_OPEN_KEY = `${STORAGE_PREFIX}wedaAtcdPendingOpen`;
  const WEDA_ATCD_WORKER_LOCK_KEY = `${STORAGE_PREFIX}wedaAtcdWorkerLock`;
  const WEDA_ATCD_CLOSE_REQUEST_KEY = `${STORAGE_PREFIX}wedaAtcdCloseRequest`;
  const PATIENT_IMPORT_CONTEXT_KEY = `${STORAGE_PREFIX}patientImportContext.v1`;
  const DUPLICATE_PDF_REGISTRY_KEY = `${STORAGE_PREFIX}duplicatePdfRegistry.v1`;
  const CANCEL_KEY = `${STORAGE_PREFIX}cancel`;
  const STATUS_KEY = `${STORAGE_PREFIX}status`;
  const DEBUG_LOG_KEY = `${STORAGE_PREFIX}debugLog.v1`;
  const TITLES_KEY = `${STORAGE_PREFIX}rememberedTitles.v7`;
  const SPECIALTIES_KEY = `${STORAGE_PREFIX}rememberedSpecialties.v7`;
  const PATIENTS_KEY = `${STORAGE_PREFIX}rememberedPatients.v1`;
  const AUTO_SEEN_ROWS_KEY = `${STORAGE_PREFIX}autoSeenRows.v1`;
  const AUTO_INTERVAL_KEY = `${STORAGE_PREFIX}autoIntervalMs.v1`;
  const HEIDI_COURRIER_TAB_ROLE_KEY = `${STORAGE_PREFIX}heidiTabRole`;
  const HEIDI_COURRIER_SESSION_ID_KEY = `${STORAGE_PREFIX}heidiSessionId`;
  const HEIDI_COURRIER_SESSION_URL_KEY = `${STORAGE_PREFIX}heidiSessionUrl`;
  const HEIDI_COURRIER_SESSION_PHASE_KEY = `${STORAGE_PREFIX}heidiSessionPhase`;
  const SESSION_WEDA_ATCD_WORKER_JOB_ID_KEY = `${STORAGE_PREFIX}wedaAtcdWorkerJobId`;
  const WEDA_ATCD_WORKER_HASH_PREFIX = "WEDA_ATCD_LMSTUDIO_WORKER=";
  const WEDA_ATCD_WORKER_HASH_PREFIX_LEGACY = "AUTO_LMSTUDIO_WEDA_WORKER=";
  const WEDA_ATCD_WORKER_OPEN_IN_BACKGROUND = true;
  const WEDA_ATCD_WORKER_LOCK_MS = 45000;
  const WEDA_ATCD_PENDING_OPEN_MS = 0; // 0 = pas d'expiration : le job ATCD reste récupérable jusqu'à validation humaine ou abandon manuel.
  const WEDA_ATCD_ALREADY_KNOWN_CLOSE_DELAY_MS = 0;
  const WEDA_ATCD_WORKER_CLOSE_RETRY_MS = 300;
  const WEDA_ATCD_WORKER_CLOSE_MAX_ATTEMPTS = 20;
  const WEDA_ATCD_CLOSE_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
  const WEDA_ATCD_WORKER_STARTUP_WATCHDOG_MS = 10000;
  const WEDA_ATCD_WORKER_BADGE_ID = "weda-courrier-lmstudio-atcd-worker-badge";

  const PANEL_ID = "weda-courrier-lmstudio-atcd-panel";
  const PANEL_POSITION_MARGIN_PX = 8;
  const STATUS_ID = "weda-courrier-lmstudio-atcd-status";
  const DEBUG_LOG_PANEL_ID = "weda-courrier-lmstudio-atcd-log-panel";
  const DEBUG_LOG_TEXTAREA_ID = "weda-courrier-lmstudio-atcd-log-textarea";
  const MESSAGE_LIST_SELECTOR = "#messageList";
  const MESSAGE_ROW_SELECTOR = "#messageList > div.messageListItem";
  const PDF_EMBED_SELECTOR = [
    "#messageContainer div.mssAttachment embed[src*='downloadAttachment']",
    "#messageContainer div.mssAttachment embed[src*='application%2Fpdf']",
    "#messageContainer div.mssAttachment iframe[type='application/pdf']",
    "#messageContainer div.attachmentContainer iframe[src*='BinaryData']",
    "#messageContainer .view-pdf-document-uc-form iframe[src*='BinaryData']",
    "#messageContainer iframe#iFrameViewFile",
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
  const DOC_SPECIALTY_PRIMARY_SELECTOR = [
    "#messageContainer > div.messageAttachment.flexColStart.ng-star-inserted > we-doc-import > div > div:nth-child(1) > div.flexCol.ml10.flex1 > select",
    "#messageContainer > div.messageAttachment.flexColStart > we-doc-import > div > div:nth-child(1) > div.flexCol.ml10.flex1 > select",
  ].join(", ");
  const DOC_SPECIALTY_SELECTORS = [
    DOC_SPECIALTY_PRIMARY_SELECTOR,
    "#messageContainer select[title*='classification' i]",
    "#messageContainer select.entry",
    "#messageContainer > div.messageAttachment.flexColStart > we-doc-import select",
    "#messageContainer we-doc-import select",
    "we-doc-import select[title*='classification' i]",
    "select[title*='Attribuer une classification' i]",
    "#messageContainer select",
  ].join(", ");
  const DOC_TITLE_FALLBACK_SELECTOR = "input.docTitle";
  const MESSAGE_BODY_TEXT_SELECTOR = [
    "#messageContainer > div.messageBody",
    "#messageContainer div.messageBody.importing",
    "#messageContainer div.messageBody",
  ].join(", ");
  const DOC_IMPORT_ATTACHMENT_SELECTOR = [
    "#messageContainer we-doc-import.docImportAttach",
    "#messageContainer .docImportAttach",
    "#messageContainer div.attachmentContainer",
    "#messageContainer .view-pdf-document-uc-form",
    "#messageContainer div.mssAttachment",
    "#messageContainer div.messageAttachment",
  ].join(", ");
  const IMPORT_MESSAGE_SELECTOR = "#messageContainer > div.docImportBody.mt10.flexColStart.ng-star-inserted > div.flexColStart.mt10.width100.ng-star-inserted > div.mt5.flexRow.ng-star-inserted > div > table > tr.ng-star-inserted > td:nth-child(5) > a";
  const IMPORT_PATIENT_SELECTOR = "#messageContainer > div.docImportBody.mt10.flexColStart > div > div.btnImport.importPatient.targetSupprimer, #messageContainer .btnImport.importPatient.targetSupprimer";
  const DELETE_SELECTED_MESSAGES_SELECTOR = "#weInboxContainer > div.flexCenter.messageListToolsContainer > div:nth-child(2) > a:nth-child(1)";
  const PDF_PARSER_RESET_SELECTOR = "#pdfParserResetButton";
  const WEDA_FIND_PATIENT_PANEL_SELECTOR = "#ContentPlaceHolder1_FindPatientUcForm1_PanelFindPatient";
  const WEDA_FIND_PATIENT_MODE_SELECTOR = "#ContentPlaceHolder1_FindPatientUcForm1_DropDownListRechechePatient";
  const WEDA_FIND_PATIENT_SEARCH_INPUT_SELECTOR = "#ContentPlaceHolder1_FindPatientUcForm1_TextBoxRecherche";
  const WEDA_FIND_PATIENT_SEARCH_BUTTON_SELECTOR = "#ContentPlaceHolder1_FindPatientUcForm1_ButtonRecherchePatient";
  const WEDA_FIND_PATIENT_GRID_SELECTOR = "#ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld";
  const WEDA_FIND_PATIENT_NAME_MODE_VALUE = "Nom";
  const WEDA_FIND_PATIENT_MODE_WAIT_MS = 6000;
  const WEDA_FIND_PATIENT_MODE_SETTLE_MS = 900;
  const WEDA_FIND_PATIENT_RESULT_WAIT_MS = 9000;
  const WEDA_FIND_PATIENT_SEARCH_SETTLE_MS = 900;
  const WEDA_FIND_PATIENT_SELECTION_SETTLE_MS = 1200;
  const WEDA_FIND_PATIENT_MIN_SCORE = 420;
  const WEDA_FIND_PATIENT_AMBIGUITY_MARGIN = 160;
  const WEDA_FIND_PATIENT_RESCUE_DUPLICATE_SUPPRESS_MS = 5000;
  const WEDA_STRICT_DUPLICATE_MIN_PDF_BYTES = 1024;
  const WEDA_STRICT_DUPLICATE_MIN_TEXT_CHARS = 900;
  const WEDA_STRICT_DUPLICATE_DELETE_WAIT_MS = 7000;
  const WEDA_STRICT_DUPLICATE_DELETE_SETTLE_MS = 1400;
  const WEDA_MSSANTE_RECONNECT_SELECTOR = [
    "#form1 > div.flex-box > we-main > connection-pro-sante-connect > div > div.info-connexion-pro-sante-connect.not-connected",
    "connection-pro-sante-connect .info-connexion-pro-sante-connect.not-connected",
    "connection-pro-sante-connect .not-connected",
  ].join(", ");
  const WEDA_MSSANTE_RECONNECT_CHECK_MS = 15000;
  const WEDA_MSSANTE_RECONNECT_ATTEMPT_KEY = `${STORAGE_PREFIX}mssanteReconnectAttempt.v1`;
  const WEDA_MSSANTE_RECONNECT_SKIP_LOG_INTERVAL_MS = 10 * 60 * 1000;
  const SELECTOR_WEDA_HELPER_PATIENT_NAME = "#pdfParserPatientName";
  const PATIENT_IMPORT_SELECTION_MIN_SCORE = 280;
  const PATIENT_IMPORT_SELECTION_AMBIGUITY_MARGIN = 120;
  const PATIENT_IMPORT_SOURCE_TEXT_MAX_LENGTH = 18000;
  const PATIENT_IMPORT_SELECTION_ISSUE_MAX_AGE_MS = 2 * 60 * 1000;
  const PATIENT_IMPORT_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000;
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
  const AUTO_INTERVAL_MS = 60 * 1000;
  const AUTO_INTERVAL_MIN_MS = 15 * 1000;
  const AUTO_INTERVAL_MAX_MS = 60 * 60 * 1000;
  const PENDING_COURRIER_FAVICON_REFRESH_MS = 30000;
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
  const PATIENT_IMPORT_CLICK_ATTEMPT_DELAYS_MS = [0, 450, 1200];
  const PATIENT_IMPORT_CLICK_VERIFY_MS = 700;
  const PATIENT_IMPORT_TITLE_ONLY_CONFIRM_MS = 650;
  const MANUAL_ARCHIVE_NEXT_SETTLE_MS = 900;
  const MANUAL_ARCHIVE_NEXT_MAX_WAIT_MS = 8000;
  const WEDA_ROW_OPEN_RETRY_DELAYS_MS = [3500, 9000];
  const NEXT_AFTER_SAVE_MS = 4200;
  const NEXT_AFTER_RELOAD_SAVE_MS = 2500;
  const TITLE_STABILITY_GUARD_MS = 11000;
  const TITLE_STABILITY_CHECK_INTERVAL_MS = 500;
  const TITLE_STABILITY_REOPEN_INPUT_AFTER_MS = 1500;
  const NEXT_AFTER_TITLE_STABLE_MS = 450;
  const TITLE_MANUAL_EDIT_COMMIT_DELAY_MS = 1200;
  const TITLE_MANUAL_EDIT_SUPPRESS_MS = 10 * 60 * 1000;
  const PDF_FETCH_RETRY_MS = 15000;
  const PDF_FETCH_RETRY_INTERVAL_MS = 900;
  const HEIDI_ANSWER_STABLE_WITH_COPY_MS = 1000;
  const HEIDI_ANSWER_STABLE_WITHOUT_COPY_MS = 2800;
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
  const MAX_REMEMBERED_SPECIALTIES = 5000;
  const MAX_REMEMBERED_PATIENTS = 5000;
  const REMEMBERED_TITLE_TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const REMEMBERED_PATIENT_TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const MAX_AUTO_SEEN_ROWS = 1000;
  const MAX_DEBUG_LOG_ENTRIES = 800;
  const DEBUG_LOG_NOISY_EVENT_DEDUP_MS = 5000;

  let titleAutofillInterval = null;
  let titleAutofillInputOpening = false;
  let rememberedPatientAutofillInProgress = false;
  let manualArchiveNextTimer = null;
  let titleManualEditState = null;
  let titleManualEditCommitTimer = null;
  let autoRefreshTimer = null;
  let autoHeartbeatTimer = null;
  let pendingCourrierFaviconOriginal = null;
  let pendingCourrierFaviconObserver = null;
  let pendingCourrierFaviconTimer = null;
  let pendingCourrierFaviconInterval = null;
  let lastPendingCourrierFaviconCount = null;
  let wedaMssanteReconnectTimer = null;
  let wedaMssanteReconnectObserver = null;
  let wedaMssanteReconnectClickAttempted = false;
  let currentHeidiTab = null;
  let currentWedaAtcdWorkerTab = null;
  let currentWedaAtcdWorkerTabJobId = "";
  const wedaAtcdWorkerCloseTimers = new Map();
  let heidiForegroundFallbackUsed = false;
  let cachedLmStudioModelId = "";
  let patientImportBeforePdfStableKey = "";
  let lastPatientImportPerformanceStartTime = 0;
  let lastPatientImportSelectionIssue = null;
  let lastPatientImportSelectionContext = null;
  const wedaFindPatientRescueAttemptKeys = new Map();
  const debugLogNoisyEventLastSeen = new Map();
  const backgroundTaskQueue = [];
  const backgroundTimerTasks = new Map();
  let backgroundTaskChannel = null;
  let backgroundTimerWorker = null;
  let backgroundTimerWorkerUnavailable = false;
  let backgroundTimerTaskSequence = 0;

  const LMSTUDIO_PROMPT_ACTIVE = `Tu dois produire trois blocs balisés, et uniquement ces trois blocs.

Les trois blocs sont obligatoires. Avant d'envoyer, vérifie explicitement que ta réponse contient bien, dans cet ordre :
1. <TITRE_COURRIER>...</TITRE_COURRIER>
2. <SPECIALITE_COURRIER>...</SPECIALITE_COURRIER>
3. <ANTECEDENT_CIM10>...</ANTECEDENT_CIM10>

Ne jamais omettre le bloc <SPECIALITE_COURRIER>. Si la spécialité est difficile à déterminer, choisis quand même la catégorie WEDA la plus proche dans la liste autorisée.

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
- Le bloc <TITRE_COURRIER> doit être un résumé médical du contenu du courrier, jamais une catégorie WEDA.
- Ne jamais écrire uniquement “CARDIO/VASC”, “PNEUMO”, “BIOLOGIE”, “IMAGERIE”, “Papier Administratif” ou toute autre catégorie du bloc <SPECIALITE_COURRIER> dans le titre.
- Ne jamais recopier le contenu du bloc <SPECIALITE_COURRIER> dans le bloc <TITRE_COURRIER>.
- Le titre doit contenir au moins une information médicale utile du document : diagnostic, résultat, conclusion, traitement, examen demandé, surveillance ou CAT.
- Si le document ne contient pas d’information médicale utile, écrire un titre administratif/descriptif court, mais pas une catégorie seule.
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

Format attendu pour <TITRE_COURRIER> :
Spé abrégée ou examen si utile : résultat principal ; CAT / ttt / suivi si mentionné.
Exemples valides : “Cardio : ETT RAS, poursuite ttt, contrôle 1 an.” ; “Bio : HbA1c 7,8 %, adaptation ttt diabète.” ; “Radio genou : gonarthrose fémoro-tibiale médiale.”
Exemples interdits comme titre : “CARDIO/VASC” ; “Biologie” ; “IMAGERIE” ; “Pneumologie”.

--- FIN DU PROMPT TITRE COURRIER ---

Pour le bloc <SPECIALITE_COURRIER>, choisis la spécialité du courrier dans le menu WEDA.

Important : ce bloc est totalement séparé du titre. Il sert uniquement à choisir le menu déroulant WEDA et ne doit jamais remplacer ni résumer le bloc <TITRE_COURRIER>.

Réponds avec exactement une seule des catégories suivantes, sans phrase ni commentaire :
- CARDIO/VASC (cardiologie, angiologie, chirurgie vasculaire)
- GYNECO (gynécologie, obstétrique)
- ORTHO/RHUMATO (traumatologie, rhumatologie, médecine du sport, neurochirurgie, chirurgie orthopédique)
- ENDOC (endocrinologie, diabétologie, thyroïde)
- HEPATO/GASTRO (gastro-entérologie, hépatologie, chirurgie digestive)
- PNEUMO (pneumologie, sommeil, pathologie thoracique, bronchique, pleurale ou médiastinale)
- NEURO (neurologie)
- GERIA (gériatrie)
- HEMATO (hématologie)
- URO/NEPHRO (urologie, néphrologie)
- ORL/STO (ORL, stomatologie)
- DERMATO/ALLERGO (dermatologie, allergologie)
- OPHTALMO (ophtalmologie)
- THYMIE (psychiatrie, psychologie, thymie)
- IMAGERIE (uniquement si le document est un compte rendu autonome d'imagerie/radiologie)
- BIOLOGIE (résultat biologique, laboratoire, compte rendu d'analyses médicales)
- Papier Administratif (MDPH, assurance, invalidité, administratif)

Règles importantes pour <SPECIALITE_COURRIER> :
- Une consultation ou un courrier de spécialiste contenant une échographie, radio, scanner ou IRM reste classé dans la spécialité clinique du courrier.
- Choisir IMAGERIE uniquement si le document est lui-même un compte rendu d'imagerie autonome, sans consultation ni hospitalisation associée.
- La spécialité doit suivre le problème médical principal, pas seulement la spécialité du signataire.
- Si le motif principal est pulmonaire, thoracique, bronchique, pleural ou médiastinal, choisir PNEUMO même si le courrier provient d'un autre spécialiste.
- Diabète ou endocrinologie : ENDOC.
- Cancérologie : choisir la catégorie de l'organe d'origine.
- Tumeur cérébrale/intracrânienne, méningiome, gliome, glioblastome : NEURO.
- Métastases osseuses d'un cancer de la prostate : URO/NEPHRO.

Pour le bloc <ANTECEDENT_CIM10>, cherche si le courrier permet d’identifier un éventuel nouvel antécédent à ajouter au dossier.

Consignes pour l’antécédent :
- Répondre en français.
- Ne jamais inventer d’information absente du document.
- Retenir un diagnostic certifié, affirmé, posé ou confirmé.
- Retenir aussi un résultat positif d’examen complémentaire, en particulier d’imagerie, s’il objective clairement une pathologie, une lésion, une anomalie structurale significative ou une complication utile au suivi en médecine générale.
- Pour l’imagerie, un résultat positif peut être retenu même si le courrier ne dit pas explicitement “antécédent”, à condition qu’il soit affirmatif et suffisamment caractérisé : par exemple fracture, lithiase, anévrysme, sténose, tumeur ou nodule suspect, séquelle, malformation, hernie discale significative, arthrose évoluée, lésion dégénérative structurée, anomalie vasculaire, atteinte d’organe, masse ou kyste pathologique.
- Ne pas retenir une suspicion, une hypothèse, un diagnostic différentiel, un simple motif d’examen, un symptôme isolé, une anomalie mineure non spécifique, une variante anatomique, une anomalie en cours d’exploration non conclue, une absence de diagnostic ou une recommandation de dépistage.
- Ne pas retenir un antécédent simplement listé comme déjà connu dans le courrier, dans une rubrique “antécédents”, “ATCD”, “histoire connue”, “connu pour”, “suivi pour”, “porteur de” ou équivalent.
- L’objectif est de signaler un antécédent nouveau par rapport à l'historique médical du patient.
- Ne pas retenir un antécédent familial sauf si le courrier affirme explicitement qu’un antécédent familial doit être ajouté.
- Si plusieurs nouveaux éléments certains sont présents, choisir le plus structurant pour le suivi en médecine générale.
- Chercher le code CIM-10 français le plus adapté correspondant au nouvel antécédent ou au résultat positif.
- Si le résultat d’imagerie positif ne correspond pas à un diagnostic CIM-10 parfaitement spécifique, choisir le code CIM-10 le plus proche : privilégier la pathologie ou la lésion identifiée ; à défaut, utiliser un code d’anomalie de résultat d’imagerie ou de constat anormal approprié.
- Si aucun nouvel antécédent certain n’est identifiable, mettre STATUT: NON et laisser les autres champs vides.

Format de sortie obligatoire, sans texte avant ni après :
<TITRE_COURRIER>
Phrase de titre produite en appliquant strictement le prompt titre courrier ci-dessus.
</TITRE_COURRIER>
<SPECIALITE_COURRIER>
Une seule catégorie parmi la liste autorisée ci-dessus.
</SPECIALITE_COURRIER>
<ANTECEDENT_CIM10>
STATUT: OUI ou NON
SECTION: medical ou chirurgical ou familial
LIBELLE: libellé court de l’antécédent
CODE: code CIM-10 sans crochets
DATE: date du diagnostic si explicitement présente, sinon vide
CERTITUDE: raison courte montrant que le diagnostic est certifié
SOURCE: fragment très court du courrier justifiant l’ajout
</ANTECEDENT_CIM10>`;
  const HEIDI_PROMPT = LMSTUDIO_PROMPT_ACTIVE;

  const isWedaPage = location.hostname === WEDA_HOST && location.pathname.toLowerCase().startsWith(WEDA_PATH_PREFIX.toLowerCase());
  const isHeidiPage = false;
  const isWedaAtcdWorkerPage = location.hostname === WEDA_HOST && Boolean(getWedaAtcdWorkerJobIdForThisTab());

  if (isWedaPage) {
    initWeda();
  } else if (isWedaAtcdWorkerPage) {
    initWedaAtcdWorker();
  }

  if (isHeidiPage) {
    initHeidi();
  }

  function initWeda() {
    createWedaPanel();
    syncPanelWithState();
    setupPendingCourrierFaviconCounter();
    appendDebugLog("weda:init", {
      version: getScriptVersion(),
      hasMessageList: Boolean(document.querySelector(MESSAGE_LIST_SELECTOR)),
    });

    GM_addValueChangeListener(RESULT_KEY, (_name, _oldValue, result) => {
      if (result) {
        handleLmStudioResult(result);
      }
    });

    GM_addValueChangeListener(STATUS_KEY, (_name, _oldValue, status) => {
      const state = getState();
      if (status && status.jobId === state.currentJobId) {
        appendDebugLog("weda:lmstudio-status-received", {
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

    GM_addValueChangeListener(WEDA_ATCD_CLOSE_REQUEST_KEY, (_name, _oldValue, request) => {
      handleWedaAtcdWorkerCloseRequest(request, "value-listener");
    });

    const existingCloseRequest = GM_getValue(WEDA_ATCD_CLOSE_REQUEST_KEY, null);
    if (existingCloseRequest) {
      window.setTimeout(() => handleWedaAtcdWorkerCloseRequest(existingCloseRequest, "init-existing"), 250);
    }

    const existingResult = GM_getValue(RESULT_KEY, null);
    if (existingResult) {
      window.setTimeout(() => handleLmStudioResult(existingResult), 250);
    }

    const state = getState();
    if (state.running) {
      scheduleBackgroundTask(() => resumeWedaWorkflow(), 700);
    }

    setupRememberedTitleAutofill();
    setupManualArchiveNextNavigation();
    window.setTimeout(() => applyRememberedDocumentFieldsForSelectedRow({ autoSave: true }), 900);
    setupWedaMssanteAutoReconnect();
    setupAutoHeartbeat();
    handleAutoOnLoad();
  }

  function setupWedaMssanteAutoReconnect() {
    if (wedaMssanteReconnectClickAttempted || hasWedaMssanteReconnectAlreadyAttempted()) {
      wedaMssanteReconnectClickAttempted = true;
      maybeLogWedaMssanteReconnectAlreadyAttempted("setup");
      return;
    }

    attemptWedaMssanteReconnect("init");

    if (wedaMssanteReconnectClickAttempted || hasWedaMssanteReconnectAlreadyAttempted()) {
      return;
    }

    if (!wedaMssanteReconnectTimer) {
      wedaMssanteReconnectTimer = window.setInterval(() => {
        attemptWedaMssanteReconnect("interval");
      }, WEDA_MSSANTE_RECONNECT_CHECK_MS);
    }

    if (!wedaMssanteReconnectObserver && typeof MutationObserver !== "undefined") {
      const root = document.querySelector("connection-pro-sante-connect") || document.body;
      if (root) {
        wedaMssanteReconnectObserver = new MutationObserver(() => {
          attemptWedaMssanteReconnect("mutation");
        });
        wedaMssanteReconnectObserver.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden", "aria-hidden"],
        });
      }
    }
  }

  function stopWedaMssanteAutoReconnectWatchers() {
    if (wedaMssanteReconnectTimer) {
      window.clearInterval(wedaMssanteReconnectTimer);
      wedaMssanteReconnectTimer = null;
    }

    if (wedaMssanteReconnectObserver) {
      wedaMssanteReconnectObserver.disconnect();
      wedaMssanteReconnectObserver = null;
    }
  }

  function attemptWedaMssanteReconnect(reason = "check") {
    if (wedaMssanteReconnectClickAttempted || hasWedaMssanteReconnectAlreadyAttempted()) {
      wedaMssanteReconnectClickAttempted = true;
      stopWedaMssanteAutoReconnectWatchers();
      maybeLogWedaMssanteReconnectAlreadyAttempted(reason);
      return false;
    }

    const target = findWedaMssanteReconnectTarget();
    if (!target) {
      return false;
    }

    wedaMssanteReconnectClickAttempted = true;
    rememberWedaMssanteReconnectAttempt(reason, target);
    stopWedaMssanteAutoReconnectWatchers();
    appendDebugLog("weda:mssante-reconnect-click", {
      reason,
      text: normalizeText(target.textContent || "").slice(0, 180),
    });
    setPanelStatus("Connexion MSSanté inactive : tentative de reconnexion Pro Santé Connect...");
    clickButtonLikeUser(target);
    return true;
  }

  function hasWedaMssanteReconnectAlreadyAttempted() {
    return Boolean(getWedaMssanteReconnectAttempt());
  }

  function getWedaMssanteReconnectAttempt() {
    const attempt = GM_getValue(WEDA_MSSANTE_RECONNECT_ATTEMPT_KEY, null);
    return attempt && typeof attempt === "object" && Number(attempt.clickedAt || 0) ? attempt : null;
  }

  function rememberWedaMssanteReconnectAttempt(reason = "", target = null) {
    GM_setValue(WEDA_MSSANTE_RECONNECT_ATTEMPT_KEY, {
      clickedAt: Date.now(),
      reason,
      version: getScriptVersion(),
      path: location.pathname,
      targetTextHash: hashString(normalizeText(target && target.textContent || "")),
      lastSkipLogAt: 0,
    });
  }

  function maybeLogWedaMssanteReconnectAlreadyAttempted(reason = "") {
    const attempt = getWedaMssanteReconnectAttempt();
    if (!attempt) {
      return;
    }

    const now = Date.now();
    const lastSkipLogAt = Number(attempt.lastSkipLogAt || 0);
    if (lastSkipLogAt && now - lastSkipLogAt < WEDA_MSSANTE_RECONNECT_SKIP_LOG_INTERVAL_MS) {
      return;
    }

    GM_setValue(WEDA_MSSANTE_RECONNECT_ATTEMPT_KEY, {
      ...attempt,
      lastSkipLogAt: now,
    });
    appendDebugLog("weda:mssante-reconnect-skip-already-attempted", {
      reason,
      clickedAt: attempt.clickedAt || 0,
      ageMs: now - Number(attempt.clickedAt || 0),
      clickReason: attempt.reason || "",
      version: attempt.version || "",
    });
  }

  function findWedaMssanteReconnectTarget() {
    const candidates = Array.from(document.querySelectorAll(WEDA_MSSANTE_RECONNECT_SELECTOR))
      .filter((element, index, list) => element && list.indexOf(element) === index);

    return candidates.find(isWedaMssanteReconnectTarget) || null;
  }

  function isWedaMssanteReconnectTarget(element) {
    if (!element || !isElementVisible(element)) {
      return false;
    }

    const className = String(element.getAttribute("class") || "");
    const text = normalizeForCompare(element.textContent || "");

    return className.includes("not-connected") &&
      /connexion\s+mssante\s+inactive/.test(text) &&
      /pro\s+sante\s+connect/.test(text);
  }

  function setupPendingCourrierFaviconCounter() {
    rememberPendingCourrierFaviconOriginal();
    schedulePendingCourrierFaviconRefresh("init");

    if (!pendingCourrierFaviconObserver && typeof MutationObserver !== "undefined" && document.body) {
      pendingCourrierFaviconObserver = new MutationObserver(() => {
        schedulePendingCourrierFaviconRefresh("mutation");
      });
      pendingCourrierFaviconObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    if (!pendingCourrierFaviconInterval) {
      pendingCourrierFaviconInterval = window.setInterval(() => {
        schedulePendingCourrierFaviconRefresh("interval");
      }, PENDING_COURRIER_FAVICON_REFRESH_MS);
    }

    window.addEventListener("focus", () => {
      schedulePendingCourrierFaviconRefresh("focus");
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        schedulePendingCourrierFaviconRefresh("visible");
      }
    });
  }

  function schedulePendingCourrierFaviconRefresh(reason = "check") {
    window.clearTimeout(pendingCourrierFaviconTimer);
    pendingCourrierFaviconTimer = window.setTimeout(() => {
      refreshPendingCourrierFavicon(reason);
    }, reason === "init" ? 0 : 250);
  }

  function refreshPendingCourrierFavicon(reason = "check") {
    const count = countPendingCourrierRows();
    if (count === null) {
      if (lastPendingCourrierFaviconCount !== null) {
        restorePendingCourrierFavicon();
        lastPendingCourrierFaviconCount = null;
      }
      return;
    }

    if (lastPendingCourrierFaviconCount === count) {
      return;
    }

    lastPendingCourrierFaviconCount = count;
    setPendingCourrierFaviconBadge(count);
    appendDebugLog("weda:pending-courrier-count-favicon", {
      count,
      reason,
    });
  }

  function countPendingCourrierRows() {
    const list = document.querySelector(MESSAGE_LIST_SELECTOR);
    if (!list) {
      return null;
    }

    return getBiologyRows().length;
  }

  function rememberPendingCourrierFaviconOriginal() {
    if (pendingCourrierFaviconOriginal) {
      return;
    }

    const link = document.querySelector("link[rel~='icon'], link[rel='shortcut icon']");
    pendingCourrierFaviconOriginal = {
      existed: Boolean(link),
      href: link ? (link.getAttribute("href") || "") : "",
      rel: link ? (link.getAttribute("rel") || "icon") : "icon",
      type: link ? (link.getAttribute("type") || "") : "",
    };
  }

  function getPendingCourrierFaviconLink() {
    let link = document.querySelector("link[rel~='icon'], link[rel='shortcut icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.dataset.wedaCourrierLmStudioFavicon = "1";
      document.head.appendChild(link);
    }
    return link;
  }

  function restorePendingCourrierFavicon() {
    rememberPendingCourrierFaviconOriginal();

    const link = document.querySelector("link[rel~='icon'], link[rel='shortcut icon']");
    if (!link) {
      return;
    }

    if (pendingCourrierFaviconOriginal && pendingCourrierFaviconOriginal.existed) {
      link.setAttribute("rel", pendingCourrierFaviconOriginal.rel || "icon");
      if (pendingCourrierFaviconOriginal.href) {
        link.setAttribute("href", pendingCourrierFaviconOriginal.href);
      } else {
        link.removeAttribute("href");
      }
      if (pendingCourrierFaviconOriginal.type) {
        link.setAttribute("type", pendingCourrierFaviconOriginal.type);
      } else {
        link.removeAttribute("type");
      }
      return;
    }

    if (link.dataset && link.dataset.wedaCourrierLmStudioFavicon === "1") {
      link.remove();
    }
  }

  function setPendingCourrierFaviconBadge(count) {
    const dataUrl = drawPendingCourrierFaviconBadge(count);
    if (!dataUrl) {
      return;
    }

    const link = getPendingCourrierFaviconLink();
    link.setAttribute("rel", "icon");
    link.setAttribute("type", "image/png");
    link.setAttribute("href", dataUrl);
  }

  function drawPendingCourrierFaviconBadge(count) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return "";
    }

    const safeCount = Math.max(0, Math.round(Number(count) || 0));
    const label = safeCount > 99 ? "99+" : String(safeCount);
    const fontSize = label.length <= 1 ? 38 : label.length === 2 ? 32 : 24;

    ctx.clearRect(0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fillStyle = "#174ea6";
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 32, label.length > 2 ? 33 : 34);

    return canvas.toDataURL("image/png");
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
        <div class="wbh-title">Analyse courriers LM Studio + ATCD</div>
        <div class="wbh-version">v${SCRIPT_VERSION}</div>
        <button type="button" id="wbh-collapse" title="Réduire le module" aria-label="Réduire le module">↘</button>
      </div>
      <div class="wbh-body">
        <button type="button" id="wbh-start">ANALYSE COURRIERS LM STUDIO + ATCD</button>
        <button type="button" id="wbh-auto">${getAutoModeButtonLabel(false)}</button>
        <label class="wbh-auto-delay" title="Durée entre deux vérifications automatiques">
          <span>Auto</span>
          <input type="number" id="wbh-auto-interval" min="${AUTO_INTERVAL_MIN_MS / 1000}" max="${AUTO_INTERVAL_MAX_MS / 1000}" step="15" inputmode="numeric">
          <span>s</span>
        </label>
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
      #${PANEL_ID} .wbh-auto-delay {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin: 0 6px 8px 0;
        border: 1px solid #b9c7e6;
        border-radius: 6px;
        padding: 4px 6px;
        background: #ffffff;
        color: #174ea6;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
        white-space: nowrap;
        vertical-align: middle;
      }
      #${PANEL_ID} #wbh-auto-interval {
        width: 52px;
        min-width: 52px;
        box-sizing: border-box;
        border: 1px solid #9fb7e8;
        border-radius: 5px;
        padding: 4px 5px;
        color: #14264a;
        font: 700 12px Arial, sans-serif;
        text-align: right;
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
    document.getElementById("wbh-auto-interval").addEventListener("change", handleAutoIntervalInputChange);
    document.getElementById("wbh-auto-interval").addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        handleAutoIntervalInputChange();
        event.currentTarget.blur();
      }
    });
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

  function normalizeAutoIntervalMs(value, fallback = AUTO_INTERVAL_MS) {
    const number = Number(value);
    const fallbackNumber = Number(fallback);
    const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : AUTO_INTERVAL_MS;

    if (!Number.isFinite(number)) {
      return Math.min(AUTO_INTERVAL_MAX_MS, Math.max(AUTO_INTERVAL_MIN_MS, Math.round(safeFallback)));
    }

    return Math.min(AUTO_INTERVAL_MAX_MS, Math.max(AUTO_INTERVAL_MIN_MS, Math.round(number)));
  }

  function getAutoIntervalMs() {
    return normalizeAutoIntervalMs(GM_getValue(AUTO_INTERVAL_KEY, AUTO_INTERVAL_MS));
  }

  function setAutoIntervalMs(value) {
    const intervalMs = normalizeAutoIntervalMs(value);
    GM_setValue(AUTO_INTERVAL_KEY, intervalMs);
    return intervalMs;
  }

  function formatAutoIntervalLabel(intervalMs = getAutoIntervalMs()) {
    const seconds = Math.round(normalizeAutoIntervalMs(intervalMs) / 1000);
    if (seconds >= 60 && seconds % 60 === 0) {
      return `${seconds / 60} MIN`;
    }
    return `${seconds} S`;
  }

  function formatAutoIntervalSentence(intervalMs = getAutoIntervalMs()) {
    const seconds = Math.round(normalizeAutoIntervalMs(intervalMs) / 1000);
    if (seconds >= 60 && seconds % 60 === 0) {
      const minutes = seconds / 60;
      return `${minutes} min`;
    }
    return `${seconds} s`;
  }

  function getAutoModeButtonLabel(enabled, intervalMs = getAutoIntervalMs()) {
    return enabled ? "DÉSACTIVER AUTO" : `MODE AUTO ${formatAutoIntervalLabel(intervalMs)}`;
  }

  function handleAutoIntervalInputChange() {
    const input = document.getElementById("wbh-auto-interval");
    if (!input) {
      return;
    }

    const intervalMs = setAutoIntervalMs(Number(input.value) * 1000);
    input.value = String(Math.round(intervalMs / 1000));

    appendDebugLog("weda:auto-interval-change", {
      intervalMs,
      label: formatAutoIntervalSentence(intervalMs),
    });

    const state = getState();
    if (state.autoEnabled && !state.running) {
      const nextCheckAt = Date.now() + intervalMs;
      setState({
        autoNextCheckAt: nextCheckAt,
        message: `Mode auto : vérification toutes les ${formatAutoIntervalSentence(intervalMs)}. Prochaine vérification vers ${formatTime(nextCheckAt)}.`,
      });
      scheduleAutoRefresh();
      return;
    }

    syncPanelWithState();
    setPanelStatus(`Mode auto : durée réglée à ${formatAutoIntervalSentence(intervalMs)}.`);
  }

  function syncPanelWithState() {
    const state = getState();
    const startButton = document.getElementById("wbh-start");
    const autoButton = document.getElementById("wbh-auto");
    const autoIntervalInput = document.getElementById("wbh-auto-interval");
    const stopButton = document.getElementById("wbh-stop");
    const autoIntervalMs = getAutoIntervalMs();

    applyWedaPanelCollapsed(Boolean(state.panelCollapsed));
    applyWedaPanelPosition(state.panelPosition);

    if (startButton) {
      startButton.disabled = Boolean(state.running);
    }

    if (autoButton) {
      autoButton.textContent = getAutoModeButtonLabel(Boolean(state.autoEnabled), autoIntervalMs);
      autoButton.title = state.autoEnabled
        ? "Désactiver le mode auto"
        : `Activer le mode auto : vérification toutes les ${formatAutoIntervalSentence(autoIntervalMs)}.`;
      autoButton.classList.toggle("wbh-auto-on", Boolean(state.autoEnabled));
      autoButton.disabled = false;
    }

    if (autoIntervalInput) {
      if (document.activeElement !== autoIntervalInput) {
        autoIntervalInput.value = String(Math.round(autoIntervalMs / 1000));
      }
      autoIntervalInput.title = `Durée entre deux vérifications automatiques : ${formatAutoIntervalSentence(autoIntervalMs)}.`;
      autoIntervalInput.disabled = false;
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
      currentAttachmentProcessedUrlKeys: [],
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
    cancelBackgroundTask(autoRefreshTimer);
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

    const nextCheckAt = state.autoNextCheckAt || Date.now() + getAutoIntervalMs();
    const delay = Math.max(1000, nextCheckAt - Date.now());

    autoRefreshTimer = scheduleBackgroundTask(() => {
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
      const runAutoHeartbeat = () => {
        autoHeartbeat();
        autoHeartbeatTimer = scheduleBackgroundTask(runAutoHeartbeat, AUTO_HEARTBEAT_MS);
      };
      autoHeartbeatTimer = scheduleBackgroundTask(runAutoHeartbeat, AUTO_HEARTBEAT_MS);
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
    resetWedaDuplicatePdfRegistry("auto-recovered");
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
      currentAttachmentProcessedUrlKeys: [],
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      autoTargetKeys: [],
      manualTargetKeys: [],
      autoRefreshPending: true,
      autoNextCheckAt: nextCheckAt,
      message: "Veille auto : reprise après cycle bloqué, nouvelle actualisation...",
    });

    scheduleBackgroundTask(() => window.location.reload(), 1000);
    return true;
  }

  function toggleAutoMode() {
    const state = getState();

    if (state.autoEnabled) {
      cancelBackgroundTask(autoRefreshTimer);
      autoRefreshTimer = null;
      if (state.mode === "auto") {
        GM_deleteValue(JOB_KEY);
        GM_deleteValue(RESULT_KEY);
        resetWedaDuplicatePdfRegistry("auto-disabled");
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
    const autoIntervalMs = getAutoIntervalMs();
    const nextCheckAt = Date.now() + autoIntervalMs;
    setState({
      autoEnabled: true,
      autoRefreshPending: false,
      autoNextCheckAt: nextCheckAt,
      autoTargetKeys: [],
      manualTargetKeys: [],
      message: `Mode auto activé : vérification toutes les ${formatAutoIntervalSentence(autoIntervalMs)}. Prochaine vérification vers ${formatTime(nextCheckAt)}.`,
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
      scheduleBackgroundTask(() => startAutoWorkflowIfNeeded(), 1600);
      return;
    }

    if (!state.autoNextCheckAt || state.autoNextCheckAt <= Date.now()) {
      setState({
        autoRefreshPending: true,
        message: "Veille auto : actualisation de Weda...",
      });
      scheduleBackgroundTask(() => window.location.reload(), 400);
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
      const nextCheckAt = Date.now() + getAutoIntervalMs();
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

    resetWedaDuplicatePdfRegistry("auto-workflow-start");
    setState({
      running: true,
      mode: "auto",
      phase: "readyToClick",
      currentIndex: newRows[0].index,
      currentRowKey: newRows[0].key,
      currentStableKey: newRows[0].stableKey,
      currentContentKey: null,
      currentAttachmentProcessedUrlKeys: [],
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
    resetWedaDuplicatePdfRegistry("manual-start");
    clearWorkflowCancellation();

    setState({
      running: true,
      mode: "manual",
      phase: "readyToClick",
      currentIndex: startIndex,
      currentRowKey: rows[startIndex] ? rows[startIndex].key : null,
      currentStableKey: rows[startIndex] ? rows[startIndex].stableKey : null,
      currentContentKey: null,
      currentAttachmentProcessedUrlKeys: [],
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
    resetWedaDuplicatePdfRegistry("stop");
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
      currentAttachmentProcessedUrlKeys: [],
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
    const confirmed = window.confirm("Effacer tous les titres, spécialités et patients mémorisés par le script ?");

    if (!confirmed) {
      return;
    }

    GM_deleteValue(TITLES_KEY);
    GM_deleteValue(SPECIALTIES_KEY);
    GM_deleteValue(PATIENTS_KEY);
    setPanelStatus("Mémoire des titres, spécialités et patients effacée.");
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

    if (state.phase === "waitingLmStudio") {
      setPanelStatus("Analyse LM Studio en cours pour le courrier " + (state.currentIndex + 1) + "...");
      return;
    }

    if (state.phase === "savingTitle") {
      setPanelStatus("Titre transmis à Weda, préparation du courrier suivant...");
      scheduleBackgroundTask(() => goToNextBiology(state.currentJobId), NEXT_AFTER_RELOAD_SAVE_MS);
      return;
    }

    if (state.phase === "deletingDuplicate") {
      setPanelStatus("Suppression d'un doublon strict, reprise de la liste...");
      scheduleBackgroundTask(() => continueAfterStrictDuplicateDeletion(), WEDA_STRICT_DUPLICATE_DELETE_SETTLE_MS);
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

  function getStrictSelectedBiologyItem() {
    return getBiologyRows().find((item) => item.row.classList.contains("selected")) || null;
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
      scheduleBackgroundTask(() => {
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

  function getDisplayedBiologyContentKey(documentText = "", sourceType = "") {
    const text = normalizePdfText(documentText);
    if (text) {
      if (sourceType === "message-body") {
        return "messagebody-" + hashString(text);
      }
      return "pdftext-" + hashString(text);
    }

    return getDisplayedPdfUrlKey();
  }

  function getDisplayedPdfUrlKey() {
    const pdfUrl = getDisplayedPdfUrl();
    return getPdfUrlKey(pdfUrl);
  }

  function getPdfUrlKey(pdfUrl = "") {
    return pdfUrl ? "pdfurl-" + hashString(pdfUrl) : "";
  }

  function normalizePdfUrlKeySet(values = []) {
    const set = new Set();
    const list = Array.isArray(values) ? values : [values];

    list.forEach((value) => {
      const text = String(value || "").trim();
      if (!text) {
        return;
      }

      if (/^pdfurl-/.test(text)) {
        set.add(text);
        return;
      }

      const url = normalizePdfUrl(text);
      if (url) {
        set.add(getPdfUrlKey(url));
      }
    });

    return set;
  }

  function getCurrentAttachmentProcessedUrlKeys(state = getState()) {
    return Array.isArray(state.currentAttachmentProcessedUrlKeys)
      ? state.currentAttachmentProcessedUrlKeys.filter(Boolean)
      : [];
  }

  function appendProcessedAttachmentUrlKey(keys = [], urlKey = "") {
    return Array.from(new Set([
      ...(Array.isArray(keys) ? keys : []),
      urlKey,
    ].filter(Boolean)));
  }

  function findNextDisplayedPdfAttachment(processedUrlKeys = []) {
    const excludedUrlKeys = normalizePdfUrlKeySet(processedUrlKeys);
    const candidates = getDisplayedPdfUrlCandidates({
      excludeUrlKeys: Array.from(excludedUrlKeys),
    });
    const nextPdfUrl = candidates[0] || "";

    return nextPdfUrl
      ? {
        pdfUrl: nextPdfUrl,
        urlKey: getPdfUrlKey(nextPdfUrl),
        remainingCount: candidates.length,
      }
      : null;
  }

  function hasDisplayedAnalyzableAttachment(options = {}) {
    if (getDisplayedPdfUrlCandidates({
      excludeUrlKeys: options.excludeUrlKeys || [],
    }).length) {
      return true;
    }

    const root = document.querySelector("#messageContainer") || document;
    return querySelectorAllDeep(root, [
      DOC_IMPORT_ATTACHMENT_SELECTOR,
      "div.attachmentContainer",
      ".view-pdf-document-uc-form",
      "#PanelViewDocument",
      "iframe#iFrameViewFile",
      "iframe[src*='BinaryData']",
      "iframe[src*='downloadAttachment']",
      "iframe[src*='application%2Fpdf']",
      "embed[src*='downloadAttachment']",
      "embed[src*='application%2Fpdf']",
      "object[data*='BinaryData']",
      "object[data*='downloadAttachment']",
    ].join(",")).some(isDisplayedAnalyzableAttachmentElement);
  }

  function isDisplayedAnalyzableAttachmentElement(element) {
    if (!element || element.nodeType !== 1 || isNonAnalyzableAttachmentElement(element)) {
      return false;
    }

    const pdfUrls = collectPdfUrlCandidatesFromDocument(element, {
      visibleOnly: false,
      scopedFallback: true,
    }).filter(isLikelyPdfUrl);
    const descriptor = normalizeForCompare([
      element.id || "",
      element.className || "",
      element.getAttribute("src") || "",
      element.getAttribute("data") || "",
      element.getAttribute("href") || "",
      element.getAttribute("original-url") || "",
      element.getAttribute("data-original-url") || "",
    ].join(" "));
    const looksLikeAttachment = /(?:attachmentcontainer|view pdf document uc form|panelviewdocument|iframeviewfile|binarydata|downloadattachment|application pdf)/.test(descriptor);
    const hasPdfChild = Boolean(element.querySelector && element.querySelector([
      "iframe[src*='BinaryData']",
      "iframe[src*='downloadAttachment']",
      "iframe[src*='application%2Fpdf']",
      "embed[src*='downloadAttachment']",
      "embed[src*='application%2Fpdf']",
      "object[data*='BinaryData']",
      "object[data*='downloadAttachment']",
    ].join(",")));

    return Boolean((pdfUrls.length || looksLikeAttachment || hasPdfChild) && (isElementVisible(element) || pdfUrls.length || hasPdfChild));
  }

  function getDisplayedBiologyHeaderText() {
    const selected = getSelectedBiologyItem();
    return selected ? selected.identityLabel : "";
  }

  function isDisplayedBiologyForRow(item) {
    if (!item || !item.row) {
      return false;
    }

    const hasPdf = Boolean(getDisplayedPdfUrl());
    const canUseMessageBody = !hasPdf && !hasDisplayedAnalyzableAttachment() && Boolean(extractWedaMessageBodyFallbackText());

    return (hasPdf || canUseMessageBody) && (
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
    const excludedUrlKeys = normalizePdfUrlKeySet(options.excludeUrlKeys || []);
    const nonAnalyzableUrlKeys = normalizePdfUrlKeySet(collectNonAnalyzableAttachmentUrlCandidates());
    const addCandidate = (value) => {
      const url = normalizePdfUrl(value);
      const urlKey = getPdfUrlKey(url);
      if (
        url &&
        isLikelyPdfUrl(url) &&
        !excludedUrlKeys.has(urlKey) &&
        !nonAnalyzableUrlKeys.has(urlKey) &&
        !candidates.includes(url)
      ) {
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
      .filter((element) => !isNonAnalyzableAttachmentElement(element))
      .map((element) => element.getAttribute("src"))
      .filter((url) => isLikelyPdfUrl(url));
  }

  function collectNonAnalyzableAttachmentUrlCandidates(rootDocument = document) {
    const root = rootDocument || document;
    const candidates = [];
    const roots = [
      document.querySelector("#messageContainer"),
      root,
    ].filter(Boolean)
      .filter((element, index, list) => list.indexOf(element) === index);

    roots.forEach((searchRoot) => {
      querySelectorAllDeep(searchRoot, [
        DOC_IMPORT_ATTACHMENT_SELECTOR,
        "a[href]",
        "embed[src]",
        "iframe[src]",
        "object[data]",
        "[href]",
        "[src]",
        "[data]",
        "[original-url]",
        "[data-original-url]",
      ].join(","))
        .filter((element) => isNonAnalyzableAttachmentElement(element))
        .forEach((element) => {
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
    });

    return candidates
      .map((value) => normalizePdfUrl(value))
      .filter((url, index, list) => url && isLikelyPdfUrl(url) && list.indexOf(url) === index);
  }

  function isNonAnalyzableAttachmentElement(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    const root = element.closest([
      "a",
      "td",
      "tr",
      "we-doc-import",
      "div.docImportAttach",
      "div.messageAttachment",
      "div.mssAttachment",
      "div.flexRow",
    ].join(",")) || element;
    const descriptor = [
      element.id || "",
      element.className || "",
      element.getAttribute("title") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("alt") || "",
      element.getAttribute("href") || "",
      element.getAttribute("src") || "",
      element.getAttribute("data") || "",
      element.getAttribute("original-url") || "",
      element.getAttribute("data-original-url") || "",
      root.className || "",
      normalizeText(root.textContent || "").slice(0, 500),
    ].join(" ");

    return isNonAnalyzableAttachmentDescriptor(descriptor);
  }

  function isNonAnalyzableAttachmentDescriptor(value = "") {
    const text = String(value || "");
    const decoded = safeDecodeURIComponent(text);
    return (
      /\.(?:zip|7z|rar)(?:\b|[?#&])/i.test(text) ||
      /\.(?:zip|7z|rar)(?:\b|[?#&])/i.test(decoded) ||
      /\bicon[-_ ]?(?:zip|archive)\b/i.test(text) ||
      /\bapplication\/(?:zip|x-zip-compressed|x-7z-compressed|x-rar-compressed)\b/i.test(decoded) ||
      /\b(?:ihe[_ -]?xdm|archive)\.(?:zip|7z|rar)\b/i.test(decoded)
    );
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
      if (isNonAnalyzableAttachmentElement(element)) {
        return;
      }

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
        if (isNonAnalyzableAttachmentElement(element)) {
          return;
        }

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
    ].join(",")).find((candidate) => !isNonAnalyzableAttachmentElement(candidate) && isDisplayedPdfCandidateVisible(candidate));

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

  function findWedaSpecialtySelect(options = {}) {
    const titleInput = options.titleInput || null;
    const targetPdfUrl = normalizePdfUrl(options.pdfUrl || options.targetPdfUrl || getDisplayedPdfUrl());
    const displayedPdfElement = getDisplayedPdfEmbed();
    const scopedRoot = options.root ||
      (titleInput ? getWedaTitleAttachmentRoot(titleInput) : null) ||
      findWedaPdfAttachmentRoot(targetPdfUrl, displayedPdfElement);
    const candidates = [];

    try {
      candidates.push(...Array.from(document.querySelectorAll(DOC_SPECIALTY_PRIMARY_SELECTOR)));
    } catch (_error) {
      // Le sélecteur primaire reste un bonus, les fallbacks ci-dessous prennent le relais.
    }

    const searchRoots = [
      scopedRoot,
      document.querySelector("#messageContainer"),
      document,
    ].filter(Boolean)
      .filter((root, index, list) => list.indexOf(root) === index);

    searchRoots.forEach((root) => {
      try {
        candidates.push(...Array.from(root.querySelectorAll(root === scopedRoot ? "select" : DOC_SPECIALTY_SELECTORS)));
      } catch (_error) {
        // WEDA peut recréer le bloc d'import pendant la recherche.
      }
    });

    const uniqueCandidates = candidates
      .filter((select, index, list) => select && list.indexOf(select) === index)
      .filter((select) => String(select.tagName || "").toLowerCase() === "select");

    if (!uniqueCandidates.length) {
      return null;
    }

    const scored = uniqueCandidates
      .map((select, index) => ({
        select,
        index,
        score: scoreWedaSpecialtySelect(select, {
          ...options,
          titleInput,
          root: scopedRoot,
        }),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return scored[0] ? scored[0].select : null;
  }

  function scoreWedaSpecialtySelect(select, options = {}) {
    const optionText = Array.from(select.options || [])
      .map((option) => option.textContent || option.label || option.value || "")
      .join(" ");
    const selectDescriptor = normalizeSpecialtyLabel([
      select.getAttribute("title") || "",
      select.getAttribute("name") || "",
      select.id || "",
      select.className || "",
    ].join(" "));
    const scopedRoot = options.root || null;
    let score = isElementVisible(select) ? 1000 : 0;

    if (scopedRoot && scopedRoot.contains(select)) {
      score += 10000;
    }

    if (select.matches && select.matches(DOC_SPECIALTY_PRIMARY_SELECTOR)) {
      score += 500;
    }

    if (/(classification|document|entry)/.test(selectDescriptor)) {
      score += 650;
    }

    if (select.closest && select.closest("we-doc-import")) {
      score += 250;
    }

    if (select.closest && select.closest("#messageContainer")) {
      score += 100;
    }

    if (options.titleInput && document.contains(options.titleInput)) {
      score += getWedaElementProximityScore(select, options.titleInput);
      if (options.titleInput.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING) {
        score += 350;
      }

      const titleRoot = getWedaTitleAttachmentRoot(options.titleInput);
      if (titleRoot && titleRoot.contains(select)) {
        score += 1000;
      }

      const titleColumn = options.titleInput.closest("div.flexCol.ml10.flex1, div.flexCol.flex1");
      if (titleColumn && titleColumn.contains(select)) {
        score += 450;
      }
    }

    if (/(cardiologie|gynécologie|gynecologie|orthopédie|orthopedie|rhumatologie|neurologie|neurochirurgie|pneumologie|hématologie|hematologie|ophtalmologie|dermatologie|urologie|angiologie|chirurgie\s+vasculaire|gastro|hépato|hepato|proctologie|orl|dentiste|psychiatrie|psychologie|imagerie|administratif|biologie)/i.test(optionText)) {
      score += 500;
    }

    return score;
  }

  function getWedaElementProximityScore(left, right) {
    if (!left || !right || typeof left.getBoundingClientRect !== "function" || typeof right.getBoundingClientRect !== "function") {
      return 0;
    }

    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    const distance = Math.abs((leftRect.top + leftRect.bottom) / 2 - (rightRect.top + rightRect.bottom) / 2);

    return Math.max(0, 900 - Math.min(900, Math.round(distance)));
  }

  async function waitForWedaSpecialtySelect(timeoutMs = 5000, options = {}) {
    try {
      return await waitFor(() => findWedaSpecialtySelect(options), {
        timeout: timeoutMs,
        interval: 250,
        description: "le menu spécialité Weda",
      });
    } catch (_error) {
      return null;
    }
  }

  async function fillWedaSpecialtyFromHeidi(title, jobId = "", targetRow = null, options = {}, specialtyCode = "") {
    const raw = options.raw || "";
    const sourceText = options.sourceText || "";
    const taggedSpecialtyCode = parseHeidiSpecialtyCode(extractTaggedBlock(raw, "SPECIALITE_COURRIER"));
    const choice = resolveWedaSpecialtyChoice(title, specialtyCode || taggedSpecialtyCode, raw, sourceText);

    if (!choice) {
      appendDebugLog("weda:specialty-skip-no-code", {
        jobId,
        specialtyCode,
        taggedSpecialtyCode,
        hasTaggedSpecialty: Boolean(extractTaggedBlock(raw, "SPECIALITE_COURRIER")),
        sourceTextLength: normalizePdfText(sourceText).length,
        titleLength: sanitizeTitle(title).length,
      });
      return null;
    }

    appendDebugLog("weda:specialty-choice-resolved", {
      jobId,
      specialtyCode,
      taggedSpecialtyCode,
      code: choice.code,
      preferred: choice.optionNames,
      reason: choice.reason,
      sourceTextLength: normalizePdfText(sourceText).length,
    });

    const select = await waitForWedaSpecialtySelect(5000, options);

    if (jobId && !isCurrentJobStillActive(jobId, ["savingTitle"])) {
      appendDebugLog("weda:specialty-fill-cancelled-after-select-wait", {
        jobId,
        hasSelect: Boolean(select),
        state: getState(),
      });
      return null;
    }

    if (!select) {
      appendDebugLog("weda:specialty-select-missing", {
        jobId,
        code: choice.code,
        preferred: choice.optionNames,
        candidateCount: document.querySelectorAll(DOC_SPECIALTY_SELECTORS).length,
        messageSelectCount: (document.querySelector("#messageContainer") || document).querySelectorAll("select").length,
      });
      return null;
    }

    const selected = setWedaSpecialtySelectValue(select, choice);

    if (!selected) {
      appendDebugLog("weda:specialty-option-missing", {
        jobId,
        code: choice.code,
        preferred: choice.optionNames,
        availableOptions: Array.from(select.options || [])
          .map((option) => normalizeText(option.textContent || option.label || option.value || ""))
          .filter(Boolean)
          .slice(0, 80),
      });
      return null;
    }

    appendDebugLog("weda:specialty-selected", {
      jobId,
      rowIndex: targetRow ? targetRow.index : null,
      code: choice.code,
      reason: choice.reason,
      optionText: selected.optionText,
      optionValue: selected.optionValue,
    });

    return {
      ...choice,
      ...selected,
    };
  }

  function resolveWedaSpecialtyChoice(title = "", specialtyCode = "", raw = "", sourceText = "") {
    const source = [title, raw, sourceText].map((part) => normalizePdfText(part)).filter(Boolean).join("\n");
    const detailSource = stripHeidiSpecialtyCodeLabels(source);
    const explicitCode = parseHeidiSpecialtyCode(specialtyCode);
    const detectedCode = detectHeidiSpecialtyCode(detailSource || source);
    const pulmonaryEvidence = matchPulmonaryClinicalEvidence(source);
    let code = pulmonaryEvidence ? "PNEUMO" : explicitCode || detectedCode;

    if ((code === "IMAGERIE" || isWedaImagingDocument(source)) && isWedaStandaloneImagingDocument(source) && !isWedaClinicalDocument(source)) {
      return buildWedaSpecialtyChoice("IMAGERIE", ["Imagerie"], "document-imagerie");
    }

    if (code === "IMAGERIE" && isWedaClinicalDocument(source)) {
      code = detectedCode && detectedCode !== "IMAGERIE" ? detectedCode : "";
    }

    if (!code) {
      return null;
    }

    if (code === "CARDIO/VASC") {
      if (textMatchesSpecialtyPattern(detailSource, /\b(chirurgie\s+vasculaire|chirurgien\s+vasculaire|pontage|anevrysme|anévrysme|arteriopathie|artériopathie)\b/)) {
        return buildWedaSpecialtyChoice(code, ["Chirurgie Vasculaire", "Angiologie", "Cardiologie - ECG"], "chirurgie-vasculaire");
      }
      if (textMatchesSpecialtyPattern(detailSource, /\b(angiologie|medecine\s+vasculaire|médecine\s+vasculaire|phlebologie|phlébologie|doppler|arteriel|artériel|arterielle|artérielle|veineux|veineuse)\b/)) {
        return buildWedaSpecialtyChoice(code, ["Angiologie", "Chirurgie Vasculaire", "Cardiologie - ECG"], "angiologie");
      }
      return buildWedaSpecialtyChoice(code, ["Cardiologie - ECG", "Cardiologie", "Angiologie", "Chirurgie Vasculaire"], "cardiologie-par-defaut");
    }

    if (code === "ORTHO/RHUMATO") {
      if (textMatchesSpecialtyPattern(detailSource, /\bneurochir(?:urgie|urgical|urgien)?\b/)) {
        return buildWedaSpecialtyChoice(code, ["Neurologie - Neurochirurgie", "Neurochirurgie", "Neurologie"], "neurochirurgie");
      }
      if (textMatchesSpecialtyPattern(detailSource, /\b(rhumato|polyarthrite|spondylarthrite|lupus|goutte|chondrocalcinose|connectivite|fibromyalgie|osteoporose|osteopenie)\b/)) {
        return buildWedaSpecialtyChoice(code, ["Rhumatologie"], "rhumatologie");
      }
      return buildWedaSpecialtyChoice(code, ["Chirurgie Orthopédique", "Chirurgie orthopédique", "Chirurgie orthopedique", "Orthopédie", "Orthopedie"], "orthopedie-par-defaut");
    }

    if (code === "HEPATO/GASTRO") {
      if (textMatchesSpecialtyPattern(detailSource, /\b(chirurgie\s+(?:digestive|viscerale|viscérale)|chirurgien\s+(?:digestif|visceral|viscéral))\b/)) {
        return buildWedaSpecialtyChoice(code, ["Chirurgie Viscérale", "Gastro Hépato Entérologie - Proctologie"], "chirurgie-digestive");
      }
      return buildWedaSpecialtyChoice(code, ["Gastro Hépato Entérologie - Proctologie", "Gastro Hépato Entérologie", "Gastro Hepato Enterologie", "Gastro entérologie"], "gastro-par-defaut");
    }

    if (code === "URO/NEPHRO") {
      if (textMatchesSpecialtyPattern(detailSource, /\b(nephro|renal|renale|rein|reins|dialyse|hemodialyse|proteinurie|glomerulo|creatinine|insuffisance renale)\b/)) {
        return buildWedaSpecialtyChoice(code, ["Urologie", "Néphrologie", "Nephrologie"], "nephrologie-via-urologie");
      }
      return buildWedaSpecialtyChoice(code, ["Urologie"], "urologie-par-defaut");
    }

    if (code === "ORL/STO") {
      if (textMatchesSpecialtyPattern(detailSource, /\b(stomato|stomatologie|dentaire|dent|dents|buccal|bucco|mandibule|mandibulaire|maxillo|chirurgie orale)\b/)) {
        return buildWedaSpecialtyChoice(code, ["Dentiste", "ORL", "Stomatologie"], "stomatologie-dentaire");
      }
      return buildWedaSpecialtyChoice(code, ["ORL", "O R L"], "orl-par-defaut");
    }

    if (code === "DERMATO/ALLERGO") {
      if (textMatchesSpecialtyPattern(detailSource, /\b(allerg|allergologie|urticaire|anaphyl|prick|desensibilisation|immunotherapie|rhinite allergique)\b/)) {
        return buildWedaSpecialtyChoice(code, ["Allergologie"], "allergologie");
      }
      return buildWedaSpecialtyChoice(code, ["Dermatologie"], "dermatologie-par-defaut");
    }

    const directChoices = {
      GYNECO: ["Gynécologie", "Gynecologie"],
      ENDOC: ["Endocrinologie"],
      PNEUMO: ["Pneumologie"],
      NEURO: ["Neurologie - Neurochirurgie", "Neurologie", "Neurochirurgie"],
      GERIA: ["Gériatrie", "Geriatrie"],
      HEMATO: ["Hématologie", "Hematologie"],
      OPHTALMO: ["Ophtalmologie"],
      THYMIE: ["Psychiatrie", "PSYCHOLOGIE", "Psychologie"],
      IMAGERIE: ["Imagerie"],
      BIOLOGIE: ["Biologie"],
      "Papier Administratif": ["Administratif", "A.L.D.", "Arrêt / Accident de Travail", "Papier Administratif", "Document administratif", "Documents administratifs", "Médecine administrative"],
    };

    return directChoices[code] ? buildWedaSpecialtyChoice(code, directChoices[code], pulmonaryEvidence ? "probleme-clinique-pulmonaire-prioritaire" : "correspondance-directe") : null;
  }

  function buildWedaSpecialtyChoice(code, optionNames, reason) {
    return {
      code,
      optionNames,
      reason,
    };
  }

  function parseHeidiSpecialtyCode(value = "") {
    return detectHeidiSpecialtyCode(stripHeidiSpecialtyNoise(value));
  }

  function stripHeidiSpecialtyNoise(value = "") {
    return String(value || "")
      .replace(/<\/?SPECIALITE_COURRIER>/gi, "")
      .replace(/^\s*(?:specialite|spécialité|specialite_courrier)\s*:?\s*/i, "")
      .trim();
  }

  function isStandaloneHeidiSpecialtyCode(value = "") {
    const compact = normalizeForCompare(stripHeidiSpecialtyNoise(value))
      .replace(/[^a-z0-9/]+/g, "");
    return [
      "cardio/vasc",
      "ortho/rhumato",
      "hepato/gastro",
      "uro/nephro",
      "orl/sto",
      "dermato/allergo",
      "papieradministratif",
      "imagerie",
      "biologie",
      "gyneco",
      "endoc",
      "pneumo",
      "neuro",
      "geria",
      "hemato",
      "ophtalmo",
      "thymie",
    ].includes(compact);
  }

  function detectHeidiSpecialtyCode(source = "") {
    const text = normalizeForCompare(source).replace(/['’]/g, " ");
    const exactCodes = [
      ["CARDIO/VASC", /\bcardio\s*\/\s*vasc\b/],
      ["ORTHO/RHUMATO", /\bortho\s*\/\s*rhumato\b/],
      ["HEPATO/GASTRO", /\bhepato\s*\/\s*gastro\b/],
      ["URO/NEPHRO", /\buro\s*\/\s*nephro\b/],
      ["ORL/STO", /\borl\s*\/\s*sto\b/],
      ["DERMATO/ALLERGO", /\bdermato\s*\/\s*allergo\b/],
      ["Papier Administratif", /\bpapier\s+administratif\b/],
      ["IMAGERIE", /\bimagerie\b/],
      ["BIOLOGIE", /\bbiologie\b/],
      ["GYNECO", /\bgyneco\b/],
      ["ENDOC", /\bendoc\b/],
      ["PNEUMO", /\bpneumo\b/],
      ["NEURO", /\bneuro\b/],
      ["GERIA", /\bgeria\b/],
      ["HEMATO", /\bhemato\b/],
      ["OPHTALMO", /\bophtalmo\b/],
      ["THYMIE", /\bthymie\b/],
    ];
    const exact = exactCodes.find(([_code, pattern]) => pattern.test(text));

    if (exact) {
      return exact[0];
    }

    if (/^\s*(?:bio|biologie|laboratoire)\b/.test(text)) {
      return "BIOLOGIE";
    }

    const keywordRules = [
      ["CARDIO/VASC", /\b(cardio|cardiologie|angiologie|chirurgie\s+vasculaire|vasculaire|medecine\s+vasculaire|phlebologie|arterite|arteriel|arterielle|veineux|veineuse|coronar|rythmo|hta|holter|ecg)\b/],
      ["GYNECO", /\b(gyneco|gynecologie|obstetrique|grossesse|uterus|uterin|endometre|ovaire|ovarien|pelvien|pelvienne|mammographie|mammaire|sein|senologie)\b/],
      ["ORTHO/RHUMATO", /\b(ortho|orthopedie|chirurgie\s+orthopedique|rhumato|rhumatologie|traumato|traumatologie|medecine\s+du\s+sport|neurochir|neurochirurgie|fracture|arthrose|prothese|rachis|tendon|ligament|menisque)\b/],
      ["ENDOC", /\b(endoc|endocrino|diabete|thyroide|dysthyroidie|surrenale)\b/],
      ["HEPATO/GASTRO", /\b(hepato|gastro|gastroenterologie|digestif|digestive|chirurgie\s+digestive|foie|hepatique|colon|coloscopie|estomac|pancreas|biliaire)\b/],
      ["PNEUMO", /\b(pneumo|pneumologie|sommeil|medecine\s+du\s+sommeil|apnee|bronche|bpco|asthme|spirometrie|polygraphie|polysomnographie)\b/],
      ["NEURO", /\b(neurologie|neurologue|epilepsie|avc|parkinson|migraine|encephale|emg)\b/],
      ["GERIA", /\b(geria|geriatrie|gerontologie|ehpad|fragilite)\b/],
      ["HEMATO", /\b(hemato|hematologie|lymphome|leucemie|myelome|anemie|polyglobulie|thrombopenie|thrombocytopenie)\b/],
      ["URO/NEPHRO", /\b(uro|urologie|nephro|nephrologie|prostate|vessie|rein|renal|sonde urinaire)\b/],
      ["ORL/STO", /\b(orl|stomato|stomatologie|amygdale|amygdalectomie|otite|audition|sinus|larynx|dentaire)\b/],
      ["DERMATO/ALLERGO", /\b(dermato|dermatologie|allergo|allergologie|allergies?|eczema|psoriasis|urticaire|naevus|melanome)\b/],
      ["OPHTALMO", /\b(ophtalmo|ophtalmologie|retine|cataracte|glaucome|macula|oct)\b/],
      ["IMAGERIE", /\b(scanner|irm|radiographie|radio(?:graphie)?|echographie|echocardiographie|mammographie|scintigraphie|tdm|tomodensitometrie|pet\s*scan|tep|osteodensitometrie|densitometrie|doppler|angioscanner|arthroscanner|cone\s*beam|panoramique\s+dentaire)\b/],
      ["BIOLOGIE", /\b(biologie|bio|laboratoire|analyse(?:s)?\s+medicale(?:s)?|bilan\s+biologique|prise\s+de\s+sang|hemogramme|hémogramme|nfs|ionogramme|creatinine|créatinine|glycemie|glycémie|hba1c|tsh)\b/],
      ["THYMIE", /\b(thymie|psychiatrie|psychiatre|psychologie|psychologue|depression|anxiete|bipolaire|psychose|sante\s+mentale)\b/],
      ["Papier Administratif", /\b(administratif|mdph|assurance|invalidite|certificat|dossier\s+administratif)\b/],
    ];
    const keyword = keywordRules.find(([_code, pattern]) => pattern.test(text));

    return keyword ? keyword[0] : "";
  }

  function matchPulmonaryClinicalEvidence(source = "") {
    const text = normalizeForCompare(source).replace(/['’]/g, " ");
    const patterns = [
      /\b(lesion|lesions|nodule|nodules|masse|opacite|opacites|foyer|foyers|tumeur|tumoral|tumorale|neoplasie|cancer|adenocarcinome|carcinome)\s+(?:du\s+)?(?:poumon|pulmonaire|pulmonaires|bronchique|broncho\s*pulmonaire|pleural|pleurale|mediastinal|mediastinale|thoracique)\b/,
      /\b(?:poumon|pulmonaire|pulmonaires|bronchique|broncho\s*pulmonaire|pleural|pleurale|mediastinal|mediastinale|thoracique)\s+(lesion|lesions|nodule|nodules|masse|opacite|opacites|foyer|foyers|tumeur|tumoral|tumorale|neoplasie|cancer|adenocarcinome|carcinome)\b/,
      /\b(pathologie|atteinte|anomalie)\s+(?:du\s+)?(?:poumon|pulmonaire|pleurale|bronchique|thoracique|mediastinale)\b/,
      /\b(pneumologue|pneumologie|oncopneumologie|chirurgie\s+thoracique|thoracoscopie|fibroscopie\s+bronchique|bronchoscopie)\b/,
    ];
    const matched = patterns.find((pattern) => pattern.test(text));
    const match = matched ? text.match(matched) : null;

    return match && match[0] ? normalizeText(match[0]).slice(0, 180) : "";
  }

  function textMatchesSpecialtyPattern(source = "", pattern) {
    return pattern.test(normalizeForCompare(source).replace(/['’]/g, " "));
  }

  function isWedaImagingDocument(source = "") {
    return isWedaStandaloneImagingDocument(source);
  }

  function isWedaStandaloneImagingDocument(source = "") {
    const title = getWedaHeidiTitleLine(source);
    if (!title || isWedaClinicalDocument(source)) {
      return false;
    }

    return /^(?:cr\s+)?(?:compte\s+rendu\s+)?(?:d[' ]?)?(?:imagerie|radiologie|radiographie|radio|echographie|echocardiographie|scanner|irm|mammographie|scintigraphie|tdm|tomodensitometrie|pet\s*scan|tep|osteodensitometrie|densitometrie|doppler|angioscanner|arthroscanner|cone\s*beam|panoramique\s+dentaire)\b/.test(title) ||
      /\b(?:compte\s+rendu|cr)\s+(?:d[' ]?)?(?:imagerie|radiologie|radiographie|echographie|scanner|irm|mammographie|doppler)\b/.test(title);
  }

  function isWedaClinicalDocument(source = "") {
    const title = getWedaHeidiTitleLine(source);
    if (!title) {
      return false;
    }

    if (/\b(?:consultation|hospitalisation|sortie\s+d[' ]?hospitalisation|lettre\s+de\s+liaison|compte\s+rendu\s+de\s+consultation|cr\s+de\s+consultation|visite|avis\s+specialise|suivi)\b/.test(title)) {
      return true;
    }

    return /\b(?:cardiologie|angiologie|rhumatologie|orthopedie|traumatologie|endocrinologie|gastro|pneumologie|neurologie|geriatrie|hematologie|urologie|nephrologie|orl|stomatologie|dermatologie|allergologie|ophtalmologie|psychiatrie)\b/.test(title) &&
      /\b(?:consultation|compte\s+rendu|courrier|avis|suivi)\b/.test(title);
  }

  function getWedaHeidiTitleLine(source = "") {
    return normalizeForCompare(String(source || "")
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .find(Boolean) || "")
      .replace(/['’]/g, " ");
  }

  function stripHeidiSpecialtyCodeLabels(value = "") {
    return String(value || "")
      .replace(/\bCARDIO\s*\/\s*VASC\b/gi, " ")
      .replace(/\bORTHO\s*\/\s*RHUMATO\b/gi, " ")
      .replace(/\bHEPATO\s*\/\s*GASTRO\b/gi, " ")
      .replace(/\bURO\s*\/\s*NEPHRO\b/gi, " ")
      .replace(/\bORL\s*\/\s*STO\b/gi, " ")
      .replace(/\bDERMATO\s*\/\s*ALLERGO\b/gi, " ")
      .replace(/\bPAPIER\s+ADMINISTRATIF\b/gi, " ")
      .replace(/\b(?:IMAGERIE|BIOLOGIE|GYNECO|ENDOC|PNEUMO|NEURO|GERIA|HEMATO|OPHTALMO|THYMIE)\b/gi, " ");
  }

  function setWedaSpecialtySelectValue(select, choice) {
    const option = findWedaSpecialtyOption(select, choice);

    if (!select || !option) {
      return null;
    }

    try {
      select.focus();
    } catch (_error) {
      // Les événements ci-dessous notifient quand même WEDA.
    }

    Array.from(select.options || []).forEach((candidate) => {
      candidate.selected = candidate === option;
    });

    setNativeSelectValue(select, option.value);
    dispatchWedaSelectValueEvents(select);
    scheduleWedaSpecialtySelectionCommit(select, choice);

    try {
      select.blur();
    } catch (_error) {
      // Le changement est déjà transmis.
    }

    return {
      optionText: normalizeText(option.textContent || option.label || option.value || ""),
      optionValue: option.value,
    };
  }

  function scheduleWedaSpecialtySelectionCommit(select, choice) {
    [250, 900, 1800, 3200].forEach((delay) => {
      scheduleBackgroundTask(() => {
        if (!select || !document.contains(select)) {
          return;
        }

        const option = findWedaSpecialtyOption(select, choice);
        if (!option) {
          return;
        }

        if (!isWedaSpecialtySelectionPresent(select, {
          ...choice,
          optionText: normalizeText(option.textContent || option.label || option.value || ""),
          optionValue: option.value,
        })) {
          Array.from(select.options || []).forEach((candidate) => {
            candidate.selected = candidate === option;
          });
          setNativeSelectValue(select, option.value);
        }

        dispatchWedaSelectValueEvents(select);
      }, delay);
    });
  }

  function setNativeSelectValue(select, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(select, value);
    } else {
      select.value = value;
    }
  }

  function dispatchWedaSelectValueEvents(select) {
    try {
      select.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      select.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    } catch (_error) {
      // Les événements standards ci-dessous restent suffisants dans la plupart des cas.
    }

    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new KeyboardEvent("keydown", enterKeyOptions()));
    select.dispatchEvent(new KeyboardEvent("keyup", enterKeyOptions()));

    try {
      select.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      select.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      select.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    } catch (_error) {
      // Best effort pour les versions WEDA qui sauvegardent sur blur/focusout.
    }
  }

  function findWedaSpecialtyOption(select, choiceOrNames = []) {
    if (!select) {
      return null;
    }

    const choice = Array.isArray(choiceOrNames) ? { optionNames: choiceOrNames } : choiceOrNames || {};
    const options = Array.from(select.options || [])
      .filter((option) => option && !option.disabled);
    const optionNames = Array.isArray(choice.optionNames) ? choice.optionNames : [];
    const targets = optionNames
      .concat(choice.optionText || "", choice.code || "", getWedaSpecialtyOptionAliasesForCode(choice.code || ""))
      .map((name) => normalizeSpecialtyLabel(name))
      .filter(Boolean);

    if (choice.optionValue) {
      const exactValue = options.find((option) => String(option.value || "") === String(choice.optionValue || ""));
      if (exactValue) {
        return exactValue;
      }
    }

    for (const target of targets) {
      const exact = options.find((option) => getWedaOptionLabels(option).some((label) => label === target));
      if (exact) {
        return exact;
      }
    }

    for (const target of targets) {
      const contained = options.find((option) => getWedaOptionLabels(option).some((label) => label && target && label.includes(target)));
      if (contained) {
        return contained;
      }
    }

    const scored = options
      .map((option, index) => ({
        option,
        index,
        score: scoreWedaSpecialtyOption(option, targets),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    if (scored[0]) {
      return scored[0].option;
    }

    return null;
  }

  function getWedaSpecialtyOptionAliasesForCode(code = "") {
    const aliases = {
      "CARDIO/VASC": ["Cardiologie - ECG", "Angiologie", "Chirurgie Vasculaire", "Cardiologie"],
      GYNECO: ["Gynécologie", "Gynecologie"],
      "ORTHO/RHUMATO": ["Chirurgie Orthopédique", "Rhumatologie", "Neurologie - Neurochirurgie"],
      ENDOC: ["Endocrinologie"],
      "HEPATO/GASTRO": ["Gastro Hépato Entérologie - Proctologie", "Chirurgie Viscérale"],
      PNEUMO: ["Pneumologie"],
      NEURO: ["Neurologie - Neurochirurgie", "Neurologie"],
      GERIA: ["Gériatrie", "Geriatrie"],
      HEMATO: ["Hématologie", "Hematologie"],
      "URO/NEPHRO": ["Urologie"],
      "ORL/STO": ["ORL", "Dentiste"],
      "DERMATO/ALLERGO": ["Dermatologie", "Allergologie"],
      OPHTALMO: ["Ophtalmologie"],
      THYMIE: ["Psychiatrie", "PSYCHOLOGIE", "Psychologie"],
      IMAGERIE: ["Imagerie"],
      BIOLOGIE: ["Biologie"],
      "Papier Administratif": ["Administratif", "A.L.D.", "Arrêt / Accident de Travail"],
    };

    return aliases[code] || [];
  }

  function scoreWedaSpecialtyOption(option, targets = []) {
    if (!option) {
      return 0;
    }

    const labels = getWedaOptionLabels(option);
    let bestScore = 0;

    labels.forEach((label) => {
      if (!label || label === "0" || label === "...") {
        return;
      }

      targets.forEach((target) => {
        if (!target) {
          return;
        }

        if (label === target) {
          bestScore = Math.max(bestScore, 1000);
          return;
        }

        if (label.includes(target)) {
          bestScore = Math.max(bestScore, 850);
          return;
        }

        if (target.includes(label) && label.length >= 4) {
          bestScore = Math.max(bestScore, 700);
          return;
        }

        const targetTokens = getSpecialtyMatchTokens(target);
        const labelTokens = getSpecialtyMatchTokens(label);
        const hits = targetTokens.filter((token) => labelTokens.includes(token)).length;
        if (hits >= Math.min(2, targetTokens.length)) {
          bestScore = Math.max(bestScore, 350 + hits * 90);
        }
      });
    });

    return bestScore;
  }

  function getSpecialtyMatchTokens(label = "") {
    return normalizeSpecialtyLabel(label)
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !["avec", "pour", "document", "papier"].includes(token));
  }

  function isWedaSpecialtySelectionPresent(select, selection) {
    if (!select || !selection) {
      return false;
    }

    if (selection.optionValue && select.value === selection.optionValue) {
      return true;
    }

    const selectedOption = Array.from(select.options || []).find((option) => option.selected) || null;
    const selectedLabels = selectedOption ? getWedaOptionLabels(selectedOption) : [];
    const expectedLabels = (selection.optionNames || [])
      .concat(selection.optionText || "", selection.code || "", getWedaSpecialtyOptionAliasesForCode(selection.code || ""))
      .map((name) => normalizeSpecialtyLabel(name))
      .filter(Boolean);

    return expectedLabels.some((expected) => selectedLabels.some((label) => label === expected || label.includes(expected))) ||
      scoreWedaSpecialtyOption(selectedOption, expectedLabels) > 0;
  }

  function getWedaOptionLabels(option) {
    return [
      option.textContent || "",
      option.label || "",
      option.value || "",
    ].map((value) => normalizeSpecialtyLabel(value)).filter(Boolean);
  }

  function normalizeSpecialtyLabel(value) {
    return normalizeForCompare(value)
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findImportMessageLink(options = {}) {
    return resolveImportMessageLink(options).link || null;
  }

  function resolveImportMessageLink(options = {}) {
    const candidates = collectImportMessageLinkCandidates()
      .filter((candidate) => candidate && candidate.link && isElementVisible(candidate.link));

    if (!candidates.length) {
      return {
        link: null,
        reason: "missing",
        candidateCount: 0,
        patientCandidateCount: 0,
      };
    }

    const patientCandidates = candidates.filter((candidate) => candidate.isPatientCandidate);
    if (candidates.length === 1 || patientCandidates.length <= 1) {
      clearPatientImportSelectionIssue();
      return {
        link: candidates[0].link,
        reason: patientCandidates.length === 1 ? "single-patient-candidate" : "single-import-link",
        candidateCount: candidates.length,
        patientCandidateCount: patientCandidates.length,
        selectedIndex: candidates[0].index,
        score: 0,
        scoreGap: 0,
        patientContext: candidates[0].patientContext || buildWedaPatientContextFromImportCandidate(candidates[0]),
      };
    }

    const context = buildPatientImportSelectionContext(options);
    const scored = patientCandidates
      .map((candidate) => {
        const score = scorePatientImportCandidate(candidate, context);
        return {
          ...candidate,
          score: score.value,
          scoreReasons: score.reasons,
          nameMatch: score.nameMatch,
          birthDateMatch: Boolean(candidate.birthDate && context.birthDates.includes(candidate.birthDate)),
          strongBirthDateMatch: Boolean(candidate.birthDate && context.strongBirthDates.includes(candidate.birthDate)),
        };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const best = scored[0] || null;
    const second = scored[1] || null;
    const scoreGap = best && second ? best.score - second.score : best ? best.score : 0;
    const strongBirthMatches = scored.filter((candidate) => candidate.strongBirthDateMatch);
    const birthMatches = scored.filter((candidate) => candidate.birthDateMatch);
    let selected = null;
    let reason = "";

    if (strongBirthMatches.length === 1) {
      selected = strongBirthMatches[0];
      reason = "unique-strong-birth-date";
    } else if (birthMatches.length === 1 && birthMatches[0].score >= PATIENT_IMPORT_SELECTION_MIN_SCORE) {
      selected = birthMatches[0];
      reason = "unique-birth-date";
    } else if (
      best &&
      best.score >= PATIENT_IMPORT_SELECTION_MIN_SCORE &&
      (!second || scoreGap >= PATIENT_IMPORT_SELECTION_AMBIGUITY_MARGIN)
    ) {
      selected = best;
      reason = "best-score";
    }

    if (selected) {
      clearPatientImportSelectionIssue();
      return {
        link: selected.link,
        reason,
        candidateCount: candidates.length,
        patientCandidateCount: patientCandidates.length,
        selectedIndex: selected.index,
        score: selected.score,
        scoreGap,
        birthDateMatch: selected.birthDateMatch,
        strongBirthDateMatch: selected.strongBirthDateMatch,
        nameMatch: selected.nameMatch,
        patientLabel: selected.patientLabel || "",
        birthDate: selected.birthDate || "",
        patientContext: selected.patientContext || buildWedaPatientContextFromImportCandidate(selected),
      };
    }

    const issue = buildPatientImportSelectionIssue(scored, context, options);
    recordPatientImportSelectionIssue(issue);
    return {
      link: null,
      blocked: true,
      reason: issue.reason,
      message: issue.message,
      candidateCount: candidates.length,
      patientCandidateCount: patientCandidates.length,
      topScore: best ? best.score : 0,
      scoreGap,
      hasBirthDateHint: context.birthDates.length > 0,
      hasIdentityHint: context.hasIdentityHint,
    };
  }

  function collectImportMessageLinkCandidates() {
    const links = [
      document.querySelector(IMPORT_MESSAGE_SELECTOR),
      ...Array.from(document.querySelectorAll("#messageContainer a"))
        .filter((link) => /importer\s+le\s+message/i.test(normalizeText(link.textContent))),
    ].filter(Boolean)
      .filter((link, index, list) => list.indexOf(link) === index);

    return links.map((link, index) => buildImportMessageLinkCandidate(link, index));
  }

  function buildImportMessageLinkCandidate(link, index) {
    const row = link && typeof link.closest === "function" ? link.closest("tr") : null;
    const cells = row ? Array.from(row.children || []).filter((cell) => /^(?:td|th)$/i.test(cell.tagName || "")) : [];
    const table = row && typeof row.closest === "function" ? row.closest("table") : null;
    const columnIndexes = getPatientImportTableColumnIndexes(table);
    const actionIndex = cells.findIndex((cell) => cell.contains(link));
    const patientCell = columnIndexes.patientIndex >= 0 ? cells[columnIndexes.patientIndex] : null;
    const birthDateCell = columnIndexes.birthDateIndex >= 0 ? cells[columnIndexes.birthDateIndex] : null;
    const patientLabel = cleanPatientImportLabel(
      patientCell ? patientCell.textContent : pickPatientImportLabelFromCells(cells, actionIndex)
    );
    const birthDate = normalizePatientBirthDate(
      birthDateCell ? birthDateCell.textContent : pickPatientImportBirthDateFromCells(cells, actionIndex)
    );

    return {
      link,
      row,
      index,
      patientLabel,
      birthDate,
      nameParts: parsePatientImportName(patientLabel),
      patientContext: buildWedaPatientContextFromImportCandidate({
        link,
        row,
        patientLabel,
      }),
      isPatientCandidate: Boolean(row && (patientLabel || birthDate)),
    };
  }

  function buildWedaPatientContextFromImportCandidate(candidate = {}) {
    const values = [];
    const addValuesFromRoot = (root) => {
      collectWedaPatientCandidateValues(root, { excludePatientImportRows: false })
        .forEach((value) => values.push(value));
    };

    addValuesFromRoot(candidate.row);
    addValuesFromRoot(candidate.link);

    for (const value of uniqueStrings(values)) {
      const patientId = extractWedaPatDkFromUrl(value);
      if (!patientId) {
        continue;
      }

      return {
        patientId,
        patientUrl: buildWedaPatientUrlFromPatDk(patientId, value),
        patientLabel: normalizeText(candidate.patientLabel || ""),
        source: "patient-import-selection",
        openMode: "direct-patient-url",
      };
    }

    return {
      patientId: "",
      patientUrl: "",
      patientLabel: normalizeText(candidate.patientLabel || ""),
      source: "patient-import-selection-no-patdk",
      openMode: "unknown",
    };
  }

  function getPatientImportTableColumnIndexes(table) {
    const missing = {
      patientIndex: -1,
      birthDateIndex: -1,
    };

    if (!table || typeof table.querySelectorAll !== "function") {
      return missing;
    }

    const headerRow = Array.from(table.querySelectorAll("tr"))
      .find((row) => {
        const text = normalizeForCompare(row.textContent || "");
        return /\bpatient\b/.test(text) && /naissance/.test(text);
      });

    if (!headerRow) {
      return missing;
    }

    const headers = Array.from(headerRow.children || [])
      .filter((cell) => /^(?:td|th)$/i.test(cell.tagName || ""))
      .map((cell) => normalizeForCompare(cell.textContent || ""));

    return {
      patientIndex: headers.findIndex((text) => /\bpatient\b/.test(text)),
      birthDateIndex: headers.findIndex((text) => /naissance/.test(text)),
    };
  }

  function pickPatientImportLabelFromCells(cells, actionIndex = -1) {
    const limit = actionIndex >= 0 ? actionIndex : cells.length;
    return cells.slice(0, limit)
      .map((cell) => normalizeText(cell.textContent || ""))
      .find((text) => {
        const normalized = normalizeForCompare(text);
        return /[a-z]/i.test(normalized) &&
          !normalizePatientBirthDate(text) &&
          !/^(?:patient|ville|action|statut|ins|qualifie|qualifié|non qualifie|non qualifié)$/.test(normalized) &&
          !/importer\s+le\s+message/.test(normalized);
      }) || "";
  }

  function pickPatientImportBirthDateFromCells(cells, actionIndex = -1) {
    const limit = actionIndex >= 0 ? actionIndex : cells.length;
    const textWithDate = cells.slice(0, limit)
      .map((cell) => normalizeText(cell.textContent || ""))
      .find((text) => normalizePatientBirthDate(text));
    return textWithDate || "";
  }

  function cleanPatientImportLabel(value) {
    return normalizeText(value)
      .replace(/\bImporter\s+le\s+message\b/gi, "")
      .replace(/\bQualifi[eé]\b/gi, "")
      .replace(/\bNon\s+qualifi[eé]\b/gi, "")
      .trim();
  }

  function parsePatientImportName(label) {
    const tokens = normalizeText(label)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    const familyTokens = [];

    for (const token of tokens) {
      if (!isUppercaseNameToken(token)) {
        break;
      }
      familyTokens.push(token);
    }

    let familyName = familyTokens.join(" ");
    let givenName = tokens.slice(familyTokens.length).join(" ");

    if (!familyName && tokens.length >= 2) {
      familyName = tokens[0];
      givenName = tokens.slice(1).join(" ");
    }

    if (!givenName && tokens.length >= 2) {
      givenName = tokens.slice(-1).join(" ");
      familyName = tokens.slice(0, -1).join(" ");
    }

    return {
      familyName: normalizeText(familyName),
      givenName: normalizeText(givenName),
      fullName: normalizeText(label),
      invertedName: normalizeText([givenName, familyName].filter(Boolean).join(" ")),
    };
  }

  function isUppercaseNameToken(token) {
    const letters = String(token || "").replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
    return Boolean(letters && letters !== letters.toLowerCase() && letters === letters.toUpperCase());
  }

  function buildPatientImportSelectionContext(options = {}) {
    const wedaIdentityText = getWedaPatientIdentityHintText();
    const sourceText = truncatePatientImportSourceText(options.sourceText || options.documentText || options.tableText || "");
    const sourceIdentityText = extractLikelyPatientIdentitySourceText(sourceText);
    const identityText = normalizeMultilineText([
      wedaIdentityText,
      normalizeMultilineText(options.patientIdentityText || ""),
    ].filter(Boolean).join("\n"));
    const strongBirthDates = extractPatientBirthDateHints(identityText, { allowLooseParentheses: true });
    const sourceBirthDates = extractPatientBirthDateHints(sourceIdentityText, { allowLooseParentheses: false });
    const birthDates = uniqueStrings(strongBirthDates.concat(sourceBirthDates));

    return {
      identityText,
      sourceIdentityText,
      birthDates,
      strongBirthDates,
      normalizedIdentityText: normalizePatientCompareText(identityText),
      normalizedSourceIdentityText: normalizePatientCompareText(sourceIdentityText),
      hasIdentityHint: Boolean(identityText || sourceIdentityText || birthDates.length),
    };
  }

  function getWedaPatientIdentityHintText() {
    const container = document.querySelector("#messageContainer") || document.body;
    const text = normalizeMultilineText(container && (container.innerText || container.textContent) || "");

    if (!text) {
      return "";
    }

    const patientListSplit = text.split(/Patients\s+Weda\s+dont\s+le\s+nom\s+correspond/i);
    const beforePatientList = patientListSplit.length > 1 ? patientListSplit[0] : text;
    const detailMatch = beforePatientList.match(/D[ée]tails\s+transmis\s+par\s+l['’]exp[ée]diteur\s*:?\s*[\s\S]{0,500}/i);
    if (detailMatch) {
      return normalizeMultilineText(detailMatch[0]);
    }

    const usefulLines = beforePatientList.split("\n")
      .map((line) => normalizeText(line))
      .filter((line) => {
        const normalized = normalizeForCompare(line);
        return /(?:patient|expediteur|expediteur|transmis|naissance|ne le|nee le)/.test(normalized) ||
          /\(\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s*\)/.test(line);
      });

    return normalizeMultilineText(usefulLines.join("\n"));
  }

  function truncatePatientImportSourceText(value) {
    const text = normalizePdfText(value);
    if (text.length <= PATIENT_IMPORT_SOURCE_TEXT_MAX_LENGTH) {
      return text;
    }
    return text.slice(0, PATIENT_IMPORT_SOURCE_TEXT_MAX_LENGTH);
  }

  function extractLikelyPatientIdentitySourceText(sourceText) {
    const lines = normalizeMultilineText(sourceText)
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);
    const headLines = lines.slice(0, 50);
    const identityLines = lines
      .filter((line) => {
        const normalized = normalizeForCompare(line);
        return /\b(?:patient|patiente|identite|identite|nom|prenom|naissance|ne le|nee le|date de naissance|dob|beneficiaire|assure|assuree|concerne)\b/.test(normalized);
      })
      .slice(0, 30);

    return normalizeMultilineText(uniqueStrings(headLines.concat(identityLines)).join("\n"));
  }

  function extractPatientBirthDateHints(text, options = {}) {
    const source = String(text || "");
    const dates = [];
    const datePattern = "(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4})";
    [
      new RegExp(`(?:n[ée]e?|date\\s+de\\s+naissance|naissance|dob|birth)\\D{0,45}${datePattern}`, "gi"),
      new RegExp(`(?:patient|patiente|b[ée]n[ée]ficiaire|assur[ée]e?|identit[ée]|nom|pr[ée]nom)\\D{0,95}${datePattern}`, "gi"),
    ].forEach((pattern) => collectPatientBirthDateMatches(source, pattern, dates));

    if (options.allowLooseParentheses) {
      collectPatientBirthDateMatches(source, new RegExp(`\\(\\s*${datePattern}\\s*\\)`, "g"), dates);
      collectPatientBirthDateMatches(source, new RegExp(`:\\s*[^\\n:]{0,90}${datePattern}`, "g"), dates);
    }

    return uniqueStrings(dates);
  }

  function collectPatientBirthDateMatches(source, pattern, dates) {
    let match = null;
    while ((match = pattern.exec(source)) !== null) {
      const date = normalizePatientBirthDate(match[1] || "");
      if (date) {
        dates.push(date);
      }
    }
  }

  function normalizePatientBirthDate(value) {
    const match = String(value || "").match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (!match) {
      return "";
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = String(match[3] || "");

    if (!day || !month || day > 31 || month > 12) {
      return "";
    }

    if (year.length === 2) {
      const numericYear = Number(year);
      year = String(numericYear >= 30 ? 1900 + numericYear : 2000 + numericYear);
    }

    if (!/^\d{4}$/.test(year)) {
      return "";
    }

    return [
      String(day).padStart(2, "0"),
      String(month).padStart(2, "0"),
      year,
    ].join("/");
  }

  function scorePatientImportCandidate(candidate, context) {
    const reasons = [];
    let value = 0;
    let nameMatch = false;

    if (candidate.birthDate && context.strongBirthDates.includes(candidate.birthDate)) {
      value += 1200;
      reasons.push("strong-birth-date");
    } else if (candidate.birthDate && context.birthDates.includes(candidate.birthDate)) {
      value += 900;
      reasons.push("birth-date");
    }

    const nameScore = scorePatientImportCandidateName(candidate, context);
    value += nameScore.value;
    nameMatch = nameScore.match;
    reasons.push(...nameScore.reasons);

    return {
      value,
      reasons,
      nameMatch,
    };
  }

  function scorePatientImportCandidateName(candidate, context) {
    const nameParts = candidate.nameParts || {};
    const phrases = uniqueStrings([
      nameParts.fullName,
      nameParts.invertedName,
    ].filter(Boolean));
    const family = nameParts.familyName || "";
    const given = nameParts.givenName || "";
    const familyNeedle = normalizePatientCompareText(family).trim();
    const givenNeedle = normalizePatientCompareText(given).trim();
    let value = 0;
    let match = false;
    const reasons = [];

    phrases.forEach((phrase) => {
      if (containsPatientPhrase(context.normalizedIdentityText, phrase)) {
        value += 520;
        match = true;
        reasons.push("identity-full-name");
      } else if (containsPatientPhrase(context.normalizedSourceIdentityText, phrase)) {
        value += 420;
        match = true;
        reasons.push("source-full-name");
      }
    });

    if (familyNeedle && givenNeedle) {
      const identityHasBoth = context.normalizedIdentityText.includes(` ${familyNeedle} `) &&
        context.normalizedIdentityText.includes(` ${givenNeedle} `);
      const sourceHasBoth = context.normalizedSourceIdentityText.includes(` ${familyNeedle} `) &&
        context.normalizedSourceIdentityText.includes(` ${givenNeedle} `);

      if (identityHasBoth) {
        value += 340;
        match = true;
        reasons.push("identity-name-tokens");
      } else if (sourceHasBoth) {
        value += 260;
        match = true;
        reasons.push("source-name-tokens");
      }
    }

    if (givenNeedle && context.normalizedIdentityText.includes(` ${givenNeedle} `)) {
      value += 80;
      reasons.push("identity-given-name");
    }

    if (familyNeedle && context.normalizedIdentityText.includes(` ${familyNeedle} `)) {
      value += 60;
      reasons.push("identity-family-name");
    }

    return {
      value,
      match,
      reasons,
    };
  }

  function containsPatientPhrase(normalizedHaystack, phrase) {
    const needle = normalizePatientCompareText(phrase).trim();
    return Boolean(needle && normalizedHaystack.includes(` ${needle} `));
  }

  function normalizePatientCompareText(value) {
    const text = normalizeForCompare(value)
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text ? ` ${text} ` : " ";
  }

  function buildPatientImportSelectionIssue(scoredCandidates, context, options = {}) {
    const best = scoredCandidates[0] || null;
    const second = scoredCandidates[1] || null;
    const scoreGap = best && second ? best.score - second.score : 0;
    const reason = !context.hasIdentityHint
      ? "missing-identity-hint"
      : best && best.score > 0
        ? "ambiguous-patient-selection"
        : "no-patient-match";

    return {
      blocked: true,
      reason,
      at: Date.now(),
      message: buildPatientImportSelectionMessage(reason),
      candidateCount: scoredCandidates.length,
      topScore: best ? best.score : 0,
      scoreGap,
      hasBirthDateHint: context.birthDates.length > 0,
      source: options.reason || "",
    };
  }

  function buildPatientImportSelectionMessage(reason) {
    if (reason === "missing-identity-hint") {
      return "Import patient bloqué : plusieurs patients proposés, identité du courrier introuvable.";
    }

    if (reason === "no-patient-match") {
      return "Import patient bloqué : aucun patient WEDA ne correspond clairement à l'identité du courrier.";
    }

    return "Import patient bloqué : plusieurs patients WEDA restent plausibles.";
  }

  function recordPatientImportSelectionIssue(issue) {
    lastPatientImportSelectionIssue = issue;
  }

  function clearPatientImportSelectionIssue() {
    lastPatientImportSelectionIssue = null;
  }

  function getLastPatientImportSelectionIssue() {
    if (
      !lastPatientImportSelectionIssue ||
      Date.now() - Number(lastPatientImportSelectionIssue.at || 0) > PATIENT_IMPORT_SELECTION_ISSUE_MAX_AGE_MS
    ) {
      return null;
    }

    return lastPatientImportSelectionIssue;
  }

  function rememberPatientImportSelectionContext(selection = {}, options = {}, source = "") {
    const context = selection.patientContext || {};
    if (!context.patientId || !context.patientUrl) {
      appendDebugLog("weda:patient-import-context-missing", {
        source,
        selectionReason: selection.reason || "",
        hasPatientLabel: Boolean(context.patientLabel),
        candidateCount: selection.candidateCount || 0,
        selectedIndex: selection.selectedIndex,
      });
      return null;
    }

    const entry = {
      patientId: context.patientId,
      patientUrl: context.patientUrl,
      patientLabel: context.patientLabel || "",
      birthDate: selection.birthDate || "",
      identity: buildWedaRememberedPatientIdentityFromSelection(selection, context),
      source: context.source || "patient-import-selection",
      openMode: context.openMode || "direct-patient-url",
      jobId: options.jobId || "",
      contentKey: options.contentKey || "",
      urlKey: options.urlKey || "",
      rowStableKey: options.rowStableKey || "",
      createdAt: Date.now(),
    };

    lastPatientImportSelectionContext = entry;
    GM_setValue(PATIENT_IMPORT_CONTEXT_KEY, entry);
    rememberWedaPatientForDocument(
      buildWedaRememberedPatientIdentityFromSelection(selection, context),
      {
        ...selection,
        patientId: context.patientId || "",
        patientUrl: context.patientUrl || "",
        patientLabel: context.patientLabel || selection.patientLabel || "",
      },
      options,
      source || "patient-import-selection"
    );
    appendDebugLog("weda:patient-import-context-remembered", {
      source,
      selectionReason: selection.reason || "",
      hasPatientId: Boolean(entry.patientId),
      hasPatientUrl: Boolean(entry.patientUrl),
      jobId: entry.jobId || "",
      contentKey: entry.contentKey || "",
      urlKey: entry.urlKey || "",
      rowStableKey: entry.rowStableKey || "",
      selectedIndex: selection.selectedIndex,
    });
    return entry;
  }

  function getRememberedPatientImportContext(options = {}) {
    const result = options.result || {};
    const candidates = [
      lastPatientImportSelectionContext,
      GM_getValue(PATIENT_IMPORT_CONTEXT_KEY, null),
    ].filter(Boolean);

    return candidates.find((context) => doesPatientImportContextMatch(context, {
      jobId: options.jobId || result.jobId || "",
      contentKey: options.contentKey || result.contentKey || "",
      urlKey: options.urlKey || result.urlKey || "",
      rowStableKey: options.rowStableKey || result.rowStableKey || "",
    })) || null;
  }

  function doesPatientImportContextMatch(context = {}, expected = {}) {
    if (!context.patientId || !context.patientUrl) {
      return false;
    }

    if (Date.now() - Number(context.createdAt || 0) > PATIENT_IMPORT_CONTEXT_MAX_AGE_MS) {
      return false;
    }

    return patientImportContextFieldMatches(context, expected, "jobId") &&
      patientImportContextFieldMatches(context, expected, "contentKey") &&
      patientImportContextFieldMatches(context, expected, "urlKey") &&
      patientImportContextFieldMatches(context, expected, "rowStableKey");
  }

  function patientImportContextFieldMatches(context, expected, fieldName) {
    const expectedValue = normalizeText(expected && expected[fieldName]);
    const contextValue = normalizeText(context && context[fieldName]);
    return !expectedValue || !contextValue || expectedValue === contextValue;
  }

  function resolveWedaPatientContextForAntecedent(anchor = null, result = {}, options = {}) {
    const remembered = getRememberedPatientImportContext({
      ...options,
      result,
    });

    if (remembered) {
      return {
        patientId: remembered.patientId,
        patientUrl: remembered.patientUrl,
        patientLabel: remembered.patientLabel || "",
        source: remembered.source || "patient-import-selection",
        openMode: remembered.openMode || "direct-patient-url",
      };
    }

    const rememberedPatient = getRememberedWedaPatientForOptions({
      ...options,
      result,
    });

    if (rememberedPatient && rememberedPatient.entry && rememberedPatient.entry.patientId && rememberedPatient.entry.patientUrl) {
      return {
        patientId: rememberedPatient.entry.patientId,
        patientUrl: rememberedPatient.entry.patientUrl,
        patientLabel: rememberedPatient.entry.patientLabel || "",
        source: rememberedPatient.entry.source || "remembered-patient",
        openMode: rememberedPatient.entry.openMode || "direct-patient-url",
      };
    }

    return findWedaPatientContextForCurrentMessage(anchor);
  }

  function rememberCurrentPatientImportContextForDocument(options = {}) {
    const row = options.row || null;
    const context = getRememberedPatientImportContext({
      contentKey: options.contentKey || "",
      urlKey: options.urlKey || "",
      rowStableKey: options.rowStableKey || (row ? row.stableKey : ""),
    });

    if (!context) {
      return null;
    }

    const expectedStableKey = options.rowStableKey || (row ? row.stableKey : "");
    if (context.rowStableKey && expectedStableKey && context.rowStableKey !== expectedStableKey) {
      return null;
    }

    const scopedContext = Boolean(context.rowStableKey || context.contentKey || context.urlKey || context.jobId);
    if (!scopedContext && Date.now() - Number(context.createdAt || 0) > PATIENT_IMPORT_SELECTION_ISSUE_MAX_AGE_MS) {
      return null;
    }

    const identity = normalizeWedaFindPatientIdentity(context.identity || {
      fullName: context.patientLabel || "",
      birthDate: context.birthDate || "",
      source: context.source || "patient-import-context",
    });

    return rememberWedaPatientForDocument(identity, {
      patientId: context.patientId || "",
      patientUrl: context.patientUrl || "",
      patientLabel: context.patientLabel || "",
      birthDate: context.birthDate || "",
      openMode: context.openMode || "",
      reason: context.source || "patient-import-context",
      score: 0,
      scoreGap: 0,
    }, {
      ...options,
      rowStableKey: options.rowStableKey || (row ? row.stableKey : ""),
    }, "patient-import-context-promoted");
  }

  function buildWedaRememberedPatientIdentityFromSelection(selection = {}, context = {}) {
    return normalizeWedaFindPatientIdentity({
      fullName: selection.patientLabel || context.patientLabel || "",
      familyName: selection.familyName || "",
      givenName: selection.givenName || "",
      birthDate: selection.birthDate || "",
      source: selection.reason ? "selection-" + selection.reason : "selection",
    });
  }

  function rememberWedaPatientForDocument(identity = {}, selection = {}, options = {}, source = "patient-selection") {
    const normalizedIdentity = normalizeWedaFindPatientIdentity(identity);
    if (!hasUsableWedaFindPatientIdentity(normalizedIdentity)) {
      appendDebugLog("weda:patient-memory-skip-unusable-identity", {
        source,
        hasFamilyName: Boolean(normalizedIdentity.familyName),
        hasGivenName: Boolean(normalizedIdentity.givenName),
        hasBirthDate: Boolean(normalizedIdentity.birthDate),
      });
      return null;
    }

    const context = buildWedaPatientMemoryContext(options);
    if (!context.keys.length) {
      appendDebugLog("weda:patient-memory-skip-weak-keys", {
        source,
        rowIndex: context.rowIndex,
        rowStableKey: context.rowStableKey,
        hasContentKey: Boolean(context.contentKey),
        hasUrlKey: Boolean(context.urlKey),
      });
      return null;
    }

    const patients = GM_getValue(PATIENTS_KEY, {});
    const now = Date.now();
    const patientLabel = normalizeText(selection.patientLabel || normalizedIdentity.searchLabel || "");
    const entryPatch = {
      identity: normalizedIdentity,
      patientLabel,
      birthDate: normalizedIdentity.birthDate || normalizePatientBirthDate(selection.birthDate || ""),
      maidenName: normalizeText(selection.maidenName || ""),
      patientId: selection.patientId || "",
      patientUrl: selection.patientUrl || "",
      source,
      openMode: selection.openMode || (selection.patientUrl ? "direct-patient-url" : ""),
      selectionReason: selection.reason || "",
      selectedIndex: Number.isFinite(Number(selection.selectedIndex)) ? Number(selection.selectedIndex) : null,
      score: Number(selection.score || 0),
      scoreGap: Number(selection.scoreGap || 0),
      rowKey: context.rowKey || "",
      rowStableKey: context.rowStableKey || "",
      rowIdentity: context.rowIdentity || "",
      pdfUrlHash: context.pdfUrlHash || "",
      contentKey: context.contentKey || "",
      urlKey: context.urlKey || "",
      updatedAt: now,
      lastUsedAt: now,
    };

    context.keys.forEach((key) => {
      const previous = patients[key] || {};
      patients[key] = {
        ...previous,
        ...entryPatch,
        createdAt: previous.createdAt || now,
      };
    });

    GM_setValue(PATIENTS_KEY, pruneRememberedPatients(patients));
    appendDebugLog("weda:patient-memory-remembered", {
      source,
      rowIndex: context.rowIndex,
      rowStableKey: context.rowStableKey,
      keys: context.keys,
      hasPatientId: Boolean(entryPatch.patientId),
      hasPatientUrl: Boolean(entryPatch.patientUrl),
      hasBirthDate: Boolean(entryPatch.birthDate),
      selectionReason: entryPatch.selectionReason,
      score: entryPatch.score,
      scoreGap: entryPatch.scoreGap,
    });

    return {
      keys: context.keys,
      entry: entryPatch,
    };
  }

  function buildWedaPatientMemoryContext(options = {}) {
    const state = getState();
    const rows = getBiologyRows();
    const item = options.row ||
      (options.rowStableKey ? findBiologyRowByStableKey(options.rowStableKey, rows) : null) ||
      getStrictSelectedBiologyItem() ||
      getSelectedBiologyItem();
    const stateMatchesItem = !item || !state.currentStableKey || state.currentStableKey === item.stableKey;
    const explicitUrlKey = options.urlKey || (options.pdfUrl ? "pdfurl-" + hashString(options.pdfUrl) : "");
    const displayedUrlKey = getDisplayedPdfUrlKey();
    const contentKey = options.contentKey || (stateMatchesItem ? state.currentContentKey || "" : "");
    const urlKey = explicitUrlKey || (stateMatchesItem ? state.currentUrlKey || "" : "") || displayedUrlKey;
    const keys = buildWedaDocumentMemoryKeys([
      options.contentKey,
      options.urlKey,
      contentKey,
      urlKey,
      stateMatchesItem && state.lastTitleKey,
      displayedUrlKey,
    ]);

    return {
      keys,
      rowIndex: item ? item.index : state.currentIndex,
      rowKey: item ? item.key : state.currentRowKey,
      rowStableKey: options.rowStableKey || (item ? item.stableKey : state.currentStableKey) || "",
      rowIdentity: item ? item.identityLabel : "",
      pdfUrlHash: hashString(options.pdfUrl || getDisplayedPdfUrl() || ""),
      contentKey,
      urlKey,
    };
  }

  function getRememberedWedaPatientForOptions(options = {}) {
    const result = options.result || {};
    const context = buildWedaPatientMemoryContext({
      ...options,
      contentKey: options.contentKey || result.contentKey || "",
      urlKey: options.urlKey || result.urlKey || "",
      rowStableKey: options.rowStableKey || result.rowStableKey || "",
      pdfUrl: options.pdfUrl || result.pdfUrl || "",
    });
    const lookupKeys = context.keys;

    for (const key of lookupKeys) {
      const entry = getRememberedWedaPatientEntry(key);
      if (!entry || !isRememberedWedaPatientCompatibleWithContext(entry, context)) {
        continue;
      }

      const identity = normalizeWedaFindPatientIdentity(entry.identity || {
        familyName: entry.familyName || "",
        givenName: entry.givenName || "",
        fullName: entry.patientLabel || "",
        birthDate: entry.birthDate || "",
        source: entry.source || "remembered-patient",
      });

      if (!hasUsableWedaFindPatientIdentity(identity)) {
        continue;
      }

      return {
        key,
        keys: lookupKeys,
        entry,
        identity,
      };
    }

    return null;
  }

  function getRememberedWedaPatientEntry(key) {
    if (!key) {
      return null;
    }

    const patients = GM_getValue(PATIENTS_KEY, {});
    const entry = patients[key];
    if (!entry) {
      return null;
    }

    const identity = normalizeWedaFindPatientIdentity(entry.identity || {
      fullName: entry.patientLabel || "",
      birthDate: entry.birthDate || "",
      source: entry.source || "remembered-patient",
    });
    if (!hasUsableWedaFindPatientIdentity(identity)) {
      delete patients[key];
      GM_setValue(PATIENTS_KEY, patients);
      appendDebugLog("weda:patient-memory-dropped", {
        key,
        reason: "unusable-identity",
      });
      return null;
    }

    return {
      ...entry,
      key,
      identity,
    };
  }

  function isRememberedWedaPatientCompatibleWithContext(entry = {}, context = {}) {
    const expectedStableKey = String(context.rowStableKey || "").trim();
    const rememberedStableKey = String(entry.rowStableKey || "").trim();
    if (expectedStableKey && rememberedStableKey && expectedStableKey !== rememberedStableKey) {
      return false;
    }

    const expectedRowKey = String(context.rowKey || "").trim();
    const rememberedRowKey = String(entry.rowKey || "").trim();
    const sameStableDuplicateOccurrence = Boolean(expectedStableKey && rememberedStableKey && expectedStableKey === rememberedStableKey);
    if (expectedRowKey && rememberedRowKey && expectedRowKey !== rememberedRowKey && !sameStableDuplicateOccurrence) {
      return false;
    }

    const expectedIdentity = normalizeForCompare(context.rowIdentity || "");
    const rememberedIdentity = normalizeForCompare(entry.rowIdentity || "");
    return !(expectedIdentity && rememberedIdentity && expectedIdentity !== rememberedIdentity);
  }

  function touchRememberedPatientKeys(keys) {
    const lookupKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));
    if (!lookupKeys.length) {
      return;
    }

    const patients = GM_getValue(PATIENTS_KEY, {});
    const now = Date.now();
    let changed = false;

    lookupKeys.forEach((key) => {
      const entry = patients[key];
      if (!entry) {
        return;
      }

      const lastUsedAt = Number(entry.lastUsedAt || 0);
      if (lastUsedAt && now - lastUsedAt < REMEMBERED_PATIENT_TOUCH_INTERVAL_MS) {
        return;
      }

      patients[key] = {
        ...entry,
        lastUsedAt: now,
      };
      changed = true;
    });

    if (changed) {
      GM_setValue(PATIENTS_KEY, pruneRememberedPatients(patients));
    }
  }

  function pruneRememberedPatients(patients) {
    const entries = Object.entries(patients || {})
      .filter(([_key, entry]) => entry && hasUsableWedaFindPatientIdentity(normalizeWedaFindPatientIdentity(entry.identity || {
        fullName: entry.patientLabel || "",
        birthDate: entry.birthDate || "",
      })))
      .sort((left, right) => getRememberedPatientSortTime(right[1]) - getRememberedPatientSortTime(left[1]))
      .slice(0, MAX_REMEMBERED_PATIENTS);

    return Object.fromEntries(entries);
  }

  function getRememberedPatientSortTime(entry) {
    return Math.max(
      Number(entry && entry.lastUsedAt) || 0,
      Number(entry && entry.updatedAt) || 0,
      Number(entry && entry.createdAt) || 0
    );
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).map((value) => normalizeText(value)).filter(Boolean)));
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
    clearPatientImportSelectionIssue();
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

    if (jobId && !isCurrentJobStillActive(jobId, ["waitingLmStudio", "savingTitle"])) {
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
    await clickImportPatientButtonWithRetry(patientButton, jobId, reason, options);
    await sleep(PATIENT_IMPORT_SETTLE_MS);

    let input = findWedaTitleInput(options);
    if (!input) {
      const patientSelection = resolveImportMessageLink({
        ...options,
        jobId,
        reason: `${reason}-after-patient-click`,
      });

      if (patientSelection.link) {
        appendDebugLog("weda:import-patient-link-selected", {
          jobId,
          reason,
          selectionReason: patientSelection.reason || "",
          candidateCount: patientSelection.candidateCount || 0,
          patientCandidateCount: patientSelection.patientCandidateCount || 0,
          selectedIndex: patientSelection.selectedIndex,
          score: patientSelection.score || 0,
          scoreGap: patientSelection.scoreGap || 0,
          birthDateMatch: Boolean(patientSelection.birthDateMatch),
          nameMatch: Boolean(patientSelection.nameMatch),
        });
        setPanelStatus("Patient WEDA identifié, import du message...");
        rememberPatientImportSelectionContext(patientSelection, {
          ...options,
          jobId,
        }, "after-patient-click");
        clickButtonLikeUser(patientSelection.link);
        await sleep(PATIENT_IMPORT_SETTLE_MS);
      } else if (patientSelection.blocked) {
        appendDebugLog("weda:import-patient-selection-blocked", {
          jobId,
          reason,
          selectionReason: patientSelection.reason || "",
          candidateCount: patientSelection.candidateCount || 0,
          patientCandidateCount: patientSelection.patientCandidateCount || 0,
          topScore: patientSelection.topScore || 0,
          scoreGap: patientSelection.scoreGap || 0,
          hasBirthDateHint: Boolean(patientSelection.hasBirthDateHint),
          hasIdentityHint: Boolean(patientSelection.hasIdentityHint),
        });
        setPanelStatus(patientSelection.message || "Import patient bloqué : choix patient ambigu.");
        return null;
      }
    }

    input = input || await waitForOptionalTitleInput(TITLE_INPUT_WAIT_AFTER_PATIENT_MS, "le champ titre après sélection patient", options);
    const findPatientPanel = findWedaFindPatientPanel();
    const findPatientPanelActionable = Boolean(findPatientPanel && isWedaFindPatientPanelActionable(findPatientPanel));
    if (findPatientPanel && (!input || (findPatientPanelActionable && hasExplicitWedaFindPatientIdentitySource(options)))) {
      const rescuedInput = await rescueWedaFindPatientPanelWithDocumentIdentity({
        ...options,
        jobId,
        reason: `${reason}-find-patient-panel`,
      });
      input = rescuedInput || null;
    } else if (findPatientPanel && input && !findPatientPanelActionable) {
      appendDebugLog("weda:import-patient-panel-non-actionable-with-title-input", {
        jobId,
        reason,
        titleInputIndex: getWedaTitleInputIndex(input),
      });
    }

    if (!input) {
      appendDebugLog("weda:import-title-missing-after-patient", {
        jobId,
        reason,
        timeout: TITLE_INPUT_WAIT_AFTER_PATIENT_MS,
      });
    }

    return input;
  }

  async function clickImportPatientButtonWithRetry(patientButton, jobId = "", reason = "", options = {}) {
    let lastOpenState = getPatientImportOpenState(options);
    if (isPatientImportOpenStateConfirmed(lastOpenState, 0)) {
      return {
        ...lastOpenState,
        confirmed: true,
      };
    }

    for (let attemptIndex = 0; attemptIndex < PATIENT_IMPORT_CLICK_ATTEMPT_DELAYS_MS.length; attemptIndex += 1) {
      const delay = PATIENT_IMPORT_CLICK_ATTEMPT_DELAYS_MS[attemptIndex];
      if (delay) {
        await sleep(delay);
      }

      if (jobId && !isCurrentJobStillActive(jobId, ["waitingLmStudio", "savingTitle"])) {
        appendDebugLog("weda:import-patient-click-cancelled", {
          jobId,
          reason,
          attempt: attemptIndex + 1,
        });
        return lastOpenState;
      }

      const freshButton = findImportPatientButton() || patientButton;
      if (!freshButton || !document.contains(freshButton)) {
        appendDebugLog("weda:import-patient-click-retry-missing-button", {
          jobId,
          reason,
          attempt: attemptIndex + 1,
        });
        return lastOpenState;
      }

      appendDebugLog("weda:import-patient-click-attempt", {
        jobId,
        reason,
        attempt: attemptIndex + 1,
        button: freshButton,
      });
      clickImportPatientButtonLikeUser(freshButton);

      lastOpenState = await waitForPatientImportOpenState(PATIENT_IMPORT_CLICK_VERIFY_MS, options);
      if (lastOpenState.confirmed) {
        appendDebugLog("weda:import-patient-click-confirmed", {
          jobId,
          reason,
          attempt: attemptIndex + 1,
          state: lastOpenState,
        });
        return lastOpenState;
      }

      dispatchImportPatientKeyboardShortcut();
      lastOpenState = await waitForPatientImportOpenState(PATIENT_IMPORT_CLICK_VERIFY_MS, options);
      if (lastOpenState.confirmed) {
        appendDebugLog("weda:import-patient-shortcut-confirmed", {
          jobId,
          reason,
          attempt: attemptIndex + 1,
          state: lastOpenState,
        });
        return lastOpenState;
      }
    }

    appendDebugLog("weda:import-patient-click-not-confirmed", {
      jobId,
      reason,
      attempts: PATIENT_IMPORT_CLICK_ATTEMPT_DELAYS_MS.length,
      state: lastOpenState,
    });
    return lastOpenState;
  }

  function clickImportPatientButtonLikeUser(button) {
    try {
      button.scrollIntoView({ block: "center", inline: "center" });
    } catch (_error) {
      // Le bouton reste tenté même si le scroll échoue.
    }

    try {
      button.focus();
    } catch (_error) {
      // Les événements pointeur ci-dessous peuvent suffire.
    }

    dispatchPointerLikeEvents(button);

    try {
      button.click();
    } catch (_error) {
      // Les événements précédents ont déjà été tentés.
    }
  }

  async function waitForPatientImportOpenState(timeoutMs = PATIENT_IMPORT_CLICK_VERIFY_MS, options = {}) {
    const startedAt = Date.now();
    let state = getPatientImportOpenState(options);

    let titleOnlySeenAt = isPatientImportTitleOnlyOpenState(state) ? Date.now() : 0;

    while (!isPatientImportOpenStateConfirmed(state, titleOnlySeenAt) && Date.now() - startedAt < timeoutMs) {
      await sleep(120);
      state = getPatientImportOpenState(options);
      if (isPatientImportTitleOnlyOpenState(state)) {
        titleOnlySeenAt = titleOnlySeenAt || Date.now();
      } else {
        titleOnlySeenAt = 0;
      }
    }

    const confirmed = isPatientImportOpenStateConfirmed(state, titleOnlySeenAt);
    return {
      ...state,
      confirmed,
      titleOnlySeenMs: titleOnlySeenAt ? Date.now() - titleOnlySeenAt : 0,
    };
  }

  function getPatientImportOpenState(options = {}) {
    const titleInput = findWedaTitleInput(options);
    const findPatientPanel = findWedaFindPatientPanel();
    const importLinkCount = collectImportMessageLinkCandidates()
      .filter((candidate) => candidate && candidate.link && isElementVisible(candidate.link)).length;
    const findPatientPanelActionable = Boolean(findPatientPanel && isWedaFindPatientPanelActionable(findPatientPanel));

    return {
      opened: Boolean(titleInput || findPatientPanel || importLinkCount),
      hasTitleInput: Boolean(titleInput),
      hasFindPatientPanel: Boolean(findPatientPanel),
      findPatientPanelActionable,
      importLinkCount,
    };
  }

  function isPatientImportTitleOnlyOpenState(state = {}) {
    return Boolean(state.hasTitleInput && !state.hasFindPatientPanel && !state.importLinkCount);
  }

  function isPatientImportOpenStateConfirmed(state = {}, titleOnlySeenAt = 0) {
    if (!state.opened) {
      return false;
    }

    if (state.hasFindPatientPanel || state.importLinkCount) {
      return true;
    }

    return Boolean(
      state.hasTitleInput &&
      titleOnlySeenAt &&
      Date.now() - titleOnlySeenAt >= PATIENT_IMPORT_TITLE_ONLY_CONFIRM_MS
    );
  }

  function dispatchImportPatientKeyboardShortcut() {
    const keyboardOptions = {
      key: "s",
      code: "KeyS",
      keyCode: 83,
      which: 83,
      altKey: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const targets = [
      document.activeElement,
      document.body,
      document,
      window,
    ].filter(Boolean)
      .filter((target, index, list) => list.indexOf(target) === index);

    targets.forEach((target) => {
      ["keydown", "keyup"].forEach((eventName) => {
        try {
          target.dispatchEvent(new KeyboardEvent(eventName, keyboardOptions));
        } catch (_error) {
          // Le raccourci clavier est un filet de sécurité best effort.
        }
      });
    });
  }

  async function rescueWedaFindPatientPanelWithDocumentIdentity(options = {}) {
    const panel = findWedaFindPatientPanel();
    if (!panel) {
      return null;
    }

    const sourceText = getWedaFindPatientIdentitySourceText(options);
    const rememberedPatient = getRememberedWedaPatientForOptions(options);
    const identity = rememberedPatient && hasUsableWedaFindPatientIdentity(rememberedPatient.identity)
      ? {
        ...rememberedPatient.identity,
        source: "remembered-patient",
      }
      : await resolveWedaFindPatientSearchIdentity({
        ...options,
        sourceText,
      });

    if (!hasUsableWedaFindPatientIdentity(identity)) {
      const issue = {
        blocked: true,
        reason: "missing-find-patient-identity",
        at: Date.now(),
        message: "Recherche patient WEDA bloquée : identité du patient introuvable dans le courrier.",
        candidateCount: 0,
        topScore: 0,
        scoreGap: 0,
        hasBirthDateHint: false,
        source: options.reason || "find-patient-panel",
      };
      recordPatientImportSelectionIssue(issue);
      appendDebugLog("weda:find-patient-identity-missing", {
        jobId: options.jobId || "",
        reason: options.reason || "",
        sourceLength: sourceText.length,
        hasImagePages: getLmStudioPdfPageImages(options).length > 0,
      });
      setPanelStatus(issue.message);
      return null;
    }

    const rescueKey = buildWedaFindPatientRescueKey(options, identity);
    const previousAttemptAt = Number(wedaFindPatientRescueAttemptKeys.get(rescueKey) || 0);
    if (previousAttemptAt && Date.now() - previousAttemptAt < WEDA_FIND_PATIENT_RESCUE_DUPLICATE_SUPPRESS_MS) {
      appendDebugLog("weda:find-patient-rescue-skip-duplicate", {
        jobId: options.jobId || "",
        reason: options.reason || "",
        rescueKey,
        previousAttemptAgeMs: Date.now() - previousAttemptAt,
      });
      return null;
    }
    wedaFindPatientRescueAttemptKeys.set(rescueKey, Date.now());
    pruneWedaFindPatientRescueAttemptKeys();

    appendDebugLog("weda:find-patient-rescue-start", {
      jobId: options.jobId || "",
      reason: options.reason || "",
      rescueKey,
      source: identity.source || "",
      remembered: Boolean(rememberedPatient),
      rememberedKey: rememberedPatient ? rememberedPatient.key : "",
      hasFamilyName: Boolean(identity.familyName),
      hasGivenName: Boolean(identity.givenName),
      hasBirthDate: Boolean(identity.birthDate),
      searchLength: identity.searchLabel.length,
    });
    setPanelStatus("Patient WEDA non identifié : recherche à partir de l'identité du courrier...");

    const input = await ensureWedaFindPatientNameSearchInput();
    if (!input) {
      const issue = buildWedaFindPatientIssue("missing-search-input", identity, 0, 0, 0);
      recordPatientImportSelectionIssue(issue);
      setPanelStatus(issue.message);
      return null;
    }

    setWedaFindPatientSearchInputValue(input, identity.searchLabel);
    const searchButton = findWedaFindPatientSearchButton();
    if (!searchButton) {
      const issue = buildWedaFindPatientIssue("missing-search-button", identity, 0, 0, 0);
      recordPatientImportSelectionIssue(issue);
      setPanelStatus(issue.message);
      return null;
    }

    appendDebugLog("weda:find-patient-search-click", {
      jobId: options.jobId || "",
      reason: options.reason || "",
      hasBirthDate: Boolean(identity.birthDate),
      searchLength: identity.searchLabel.length,
    });
    clickButtonLikeUser(searchButton);

    let selection = null;
    const searchStartedAt = Date.now();
    try {
      selection = await waitFor(() => {
        if (Date.now() - searchStartedAt < WEDA_FIND_PATIENT_SEARCH_SETTLE_MS) {
          return null;
        }

        const candidates = collectWedaFindPatientGridCandidates();
        if (!candidates.length) {
          return null;
        }
        const currentSelection = resolveWedaFindPatientGridSelection(identity, candidates);
        return currentSelection && currentSelection.link ? currentSelection : null;
      }, {
        timeout: WEDA_FIND_PATIENT_RESULT_WAIT_MS,
        interval: 400,
        description: "les résultats de recherche patient WEDA",
      });
    } catch (_error) {
      selection = resolveWedaFindPatientGridSelection(identity, collectWedaFindPatientGridCandidates());
    }

    if (!selection || !selection.link) {
      const issue = buildWedaFindPatientIssue(
        selection && selection.reason || "no-grid-selection",
        identity,
        selection && selection.candidateCount || 0,
        selection && selection.topScore || 0,
        selection && selection.scoreGap || 0
      );
      recordPatientImportSelectionIssue(issue);
      appendDebugLog("weda:find-patient-selection-blocked", {
        jobId: options.jobId || "",
        reason: issue.reason,
        candidateCount: issue.candidateCount || 0,
        topScore: issue.topScore || 0,
        scoreGap: issue.scoreGap || 0,
        hasBirthDateHint: Boolean(issue.hasBirthDateHint),
      });
      setPanelStatus(issue.message);
      return null;
    }

    clearPatientImportSelectionIssue();
    appendDebugLog("weda:find-patient-row-click", {
      jobId: options.jobId || "",
      reason: options.reason || "",
      selectionReason: selection.reason || "",
      candidateCount: selection.candidateCount || 0,
      selectedIndex: selection.selectedIndex,
      score: selection.score || 0,
      scoreGap: selection.scoreGap || 0,
      birthDateMatch: Boolean(selection.birthDateMatch),
      nameMatch: Boolean(selection.nameMatch),
    });
    setPanelStatus("Patient WEDA retrouvé, sélection de la fiche patient...");
    clickButtonLikeUser(selection.link);

    const appliedInput = await waitForWedaFindPatientSelectionApplied(options);
    if (appliedInput) {
      rememberWedaPatientForDocument(identity, selection, options, rememberedPatient ? "remembered-find-patient-selection" : "find-patient-selection");
      if (rememberedPatient) {
        touchRememberedPatientKeys(rememberedPatient.keys);
      }
    }

    return appliedInput;
  }

  function pruneWedaFindPatientRescueAttemptKeys() {
    const now = Date.now();
    Array.from(wedaFindPatientRescueAttemptKeys.entries()).forEach(([key, at]) => {
      if (now - Number(at || 0) > WEDA_FIND_PATIENT_RESCUE_DUPLICATE_SUPPRESS_MS * 6) {
        wedaFindPatientRescueAttemptKeys.delete(key);
      }
    });
  }

  function findWedaFindPatientPanel() {
    const panel = document.querySelector(WEDA_FIND_PATIENT_PANEL_SELECTOR);
    return isWedaFindPatientPanelOpen(panel) ? panel : null;
  }

  function isWedaFindPatientPanelOpen(panel) {
    if (!panel || panel.hidden || panel.getAttribute("aria-hidden") === "true") {
      return false;
    }

    const style = window.getComputedStyle ? window.getComputedStyle(panel) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0)) {
      return false;
    }

    const rect = typeof panel.getBoundingClientRect === "function" ? panel.getBoundingClientRect() : null;
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function isWedaFindPatientPanelActionable(panel = findWedaFindPatientPanel()) {
    if (!panel) {
      return false;
    }

    return Boolean(
      findWedaFindPatientSearchInput(panel) ||
      findWedaFindPatientModeSelect(panel) ||
      findWedaFindPatientSearchButton(panel) ||
      collectWedaFindPatientGridCandidates().length
    );
  }

  function findWedaFindPatientSearchInput() {
    const panel = arguments.length ? arguments[0] : findWedaFindPatientPanel();
    const roots = [panel, document].filter(Boolean)
      .filter((root, index, list) => list.indexOf(root) === index);
    const fallbackRoots = (panel ? [panel] : [document]).filter(Boolean);

    for (const root of roots) {
      const exact = root.querySelector(WEDA_FIND_PATIENT_SEARCH_INPUT_SELECTOR);
      if (exact && isElementVisible(exact)) {
        return exact;
      }
    }

    const candidates = fallbackRoots
      .flatMap((root) => Array.from(root.querySelectorAll("input, textarea")))
      .filter((input, index, list) => input && list.indexOf(input) === index)
      .filter(isWedaFindPatientSearchInputCandidate)
      .map((input, index) => ({
        input,
        index,
        score: scoreWedaFindPatientSearchInput(input),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return candidates[0] ? candidates[0].input : null;
  }

  function isWedaFindPatientSearchInputCandidate(input) {
    if (!input || !isElementVisible(input) || input.disabled || input.readOnly) {
      return false;
    }

    const type = String(input.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "checkbox", "radio", "button", "submit", "reset"].includes(type)) {
      return false;
    }

    if (input.matches && input.matches("input.docTitle, textarea.docTitle, input[placeholder='Titre du document']")) {
      return false;
    }

    return scoreWedaFindPatientSearchInput(input) > 0;
  }

  function scoreWedaFindPatientSearchInput(input) {
    const descriptor = normalizeForCompare([
      input.id || "",
      input.name || "",
      input.getAttribute("placeholder") || "",
      input.getAttribute("title") || "",
      input.getAttribute("aria-label") || "",
    ].join(" "));
    const contextText = normalizeForCompare(input.closest && input.closest("tr, div, fieldset, form")
      ? input.closest("tr, div, fieldset, form").textContent || ""
      : "");
    let score = 0;

    if (/textboxrecherche|text_box_recherche|recherche/.test(descriptor)) {
      score += 1000;
    }

    if (/\b(?:patient|nom|prenom|pr[eé]nom)\b/.test(descriptor)) {
      score += 500;
    }

    if (/\b(?:rechercher|recherche|patient|nom|prenom|pr[eé]nom)\b/.test(contextText)) {
      score += 180;
    }

    return score;
  }

  function findWedaFindPatientModeSelect(panel = findWedaFindPatientPanel()) {
    const roots = [panel, document].filter(Boolean)
      .filter((root, index, list) => list.indexOf(root) === index);
    const fallbackRoots = (panel ? [panel] : [document]).filter(Boolean);

    for (const root of roots) {
      const exact = root.querySelector(WEDA_FIND_PATIENT_MODE_SELECTOR);
      if (exact && isElementVisible(exact)) {
        return exact;
      }
    }

    const candidates = fallbackRoots
      .flatMap((root) => Array.from(root.querySelectorAll("select")))
      .filter((select, index, list) => select && list.indexOf(select) === index)
      .filter((select) => isElementVisible(select) && scoreWedaFindPatientModeSelect(select) > 0)
      .map((select, index) => ({
        select,
        index,
        score: scoreWedaFindPatientModeSelect(select),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return candidates[0] ? candidates[0].select : null;
  }

  function scoreWedaFindPatientModeSelect(select) {
    const descriptor = normalizeForCompare([
      select.id || "",
      select.name || "",
      select.getAttribute("title") || "",
      select.getAttribute("aria-label") || "",
    ].join(" "));
    const optionText = normalizeForCompare(Array.from(select.options || [])
      .map((option) => option.textContent || option.label || option.value || "")
      .join(" "));
    let score = 0;

    if (/dropdownlistrech(?:e|er)chepatient|findpatient|recherchepatient/.test(descriptor)) {
      score += 1000;
    }

    if (/\b(?:nom|patient|prenom|pr[eé]nom)\b/.test(optionText)) {
      score += 500;
    }

    return score;
  }

  function findWedaFindPatientSearchButton() {
    const panel = arguments.length ? arguments[0] : findWedaFindPatientPanel();
    const roots = [panel, document].filter(Boolean)
      .filter((root, index, list) => list.indexOf(root) === index);
    const fallbackRoots = (panel ? [panel] : [document]).filter(Boolean);

    for (const root of roots) {
      const exact = root.querySelector(WEDA_FIND_PATIENT_SEARCH_BUTTON_SELECTOR);
      if (exact && isElementVisible(exact)) {
        return exact;
      }
    }

    const candidates = fallbackRoots
      .flatMap((root) => Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit'], a")))
      .filter((button, index, list) => button && list.indexOf(button) === index)
      .filter((button) => isElementVisible(button) && scoreWedaFindPatientSearchButton(button) > 0)
      .map((button, index) => ({
        button,
        index,
        score: scoreWedaFindPatientSearchButton(button),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return candidates[0] ? candidates[0].button : null;
  }

  function scoreWedaFindPatientSearchButton(button) {
    const descriptor = normalizeForCompare([
      button.id || "",
      button.name || "",
      button.value || "",
      button.textContent || "",
      button.getAttribute("title") || "",
      button.getAttribute("aria-label") || "",
    ].join(" "));
    let score = 0;

    if (/buttonrecherchepatient|recherchepatient/.test(descriptor)) {
      score += 1000;
    }

    if (/\b(?:rechercher|recherche|chercher|search)\b/.test(descriptor)) {
      score += 500;
    }

    return score;
  }

  function summarizeWedaFindPatientPanel(panel = findWedaFindPatientPanel()) {
    const root = panel || document;
    const visibleInputs = Array.from(root.querySelectorAll("input, textarea"))
      .filter((input) => input && isElementVisible(input));
    const visibleSelects = Array.from(root.querySelectorAll("select"))
      .filter((select) => select && isElementVisible(select));
    const visibleButtons = Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit'], a"))
      .filter((button) => button && isElementVisible(button));

    return {
      hasPanel: Boolean(panel),
      panelVisible: Boolean(panel && isWedaFindPatientPanelOpen(panel)),
      exactSearchInput: Boolean(root.querySelector(WEDA_FIND_PATIENT_SEARCH_INPUT_SELECTOR)),
      exactModeSelect: Boolean(root.querySelector(WEDA_FIND_PATIENT_MODE_SELECTOR)),
      exactSearchButton: Boolean(root.querySelector(WEDA_FIND_PATIENT_SEARCH_BUTTON_SELECTOR)),
      visibleInputCount: visibleInputs.length,
      visibleSelectCount: visibleSelects.length,
      visibleButtonCount: visibleButtons.length,
      panelTextHash: panel ? hashString(normalizeText(panel.textContent || "")) : "",
      panelTextSample: panel ? normalizeText(panel.textContent || "").slice(0, 180) : "",
    };
  }

  async function ensureWedaFindPatientNameSearchInput() {
    const panel = findWedaFindPatientPanel();
    let select = findWedaFindPatientModeSelect(panel);
    if (!select) {
      try {
        select = await waitFor(() => findWedaFindPatientModeSelect(), {
          timeout: WEDA_FIND_PATIENT_MODE_WAIT_MS,
          interval: 300,
          description: "la liste de mode de recherche patient WEDA",
        });
      } catch (_error) {
        select = findWedaFindPatientModeSelect();
      }
    }

    if (!select || !isElementVisible(select)) {
      appendDebugLog("weda:find-patient-mode-select-missing", summarizeWedaFindPatientPanel(panel));
      return null;
    }

    const modeSwitched = await ensureWedaFindPatientNameModeSelected(select);
    if (modeSwitched === null) {
      return null;
    }

    const input = await waitForWedaFindPatientNameSearchInput(
      modeSwitched ? "le champ de recherche patient par nom après changement de mode" : "le champ de recherche patient par nom"
    );
    if (input) {
      return input;
    }

    const freshSelect = findWedaFindPatientModeSelect();
    if (freshSelect) {
      appendDebugLog("weda:find-patient-mode-retry", {
        currentMode: String(freshSelect.value || ""),
        expectedMode: WEDA_FIND_PATIENT_NAME_MODE_VALUE,
        hasPostBackTarget: Boolean(freshSelect.name),
      });

      if (String(freshSelect.value || "") !== WEDA_FIND_PATIENT_NAME_MODE_VALUE) {
        await ensureWedaFindPatientNameModeSelected(freshSelect);
      } else {
        triggerWedaFindPatientModePostBack(freshSelect);
        await sleep(WEDA_FIND_PATIENT_MODE_SETTLE_MS);
      }
    }

    const inputAfterPostback = await waitForWedaFindPatientNameSearchInput("le champ de recherche patient par nom après postback");
    if (inputAfterPostback) {
      return inputAfterPostback;
    }

    const latestSelect = findWedaFindPatientModeSelect();
    appendDebugLog("weda:find-patient-search-input-timeout", {
      selectedMode: latestSelect ? latestSelect.value || "" : "",
      expectedMode: WEDA_FIND_PATIENT_NAME_MODE_VALUE,
    });
    return null;
  }

  async function ensureWedaFindPatientNameModeSelected(select) {
    const currentMode = String(select && select.value || "");
    if (currentMode === WEDA_FIND_PATIENT_NAME_MODE_VALUE) {
      return false;
    }

    const nameOption = Array.from(select.options || [])
      .find((option) => String(option.value || "") === WEDA_FIND_PATIENT_NAME_MODE_VALUE);
    if (!nameOption) {
      appendDebugLog("weda:find-patient-name-mode-option-missing", {
        currentMode,
        expectedMode: WEDA_FIND_PATIENT_NAME_MODE_VALUE,
        availableModes: Array.from(select.options || [])
          .map((option) => String(option.value || ""))
          .filter(Boolean)
          .slice(0, 40),
      });
      return null;
    }

    appendDebugLog("weda:find-patient-mode-switch", {
      fromMode: currentMode,
      toMode: WEDA_FIND_PATIENT_NAME_MODE_VALUE,
      optionText: normalizeText(nameOption.textContent || nameOption.label || ""),
    });

    Array.from(select.options || []).forEach((option) => {
      option.selected = option === nameOption;
    });
    setNativeSelectValue(select, WEDA_FIND_PATIENT_NAME_MODE_VALUE);
    const postBackMethod = triggerWedaFindPatientModePostBack(select);
    appendDebugLog("weda:find-patient-mode-postback", {
      selectedMode: String(select.value || ""),
      expectedMode: WEDA_FIND_PATIENT_NAME_MODE_VALUE,
      method: postBackMethod,
    });
    await sleep(WEDA_FIND_PATIENT_MODE_SETTLE_MS);
    return true;
  }

  function triggerWedaFindPatientModePostBack(select) {
    if (!select) {
      return "missing-select";
    }

    const target = String(select.name || "");
    if (target && callWedaPostBack(target, "")) {
      return "direct-postback";
    }

    dispatchWedaSelectValueEvents(select);
    return "change-event-fallback";
  }

  async function waitForWedaFindPatientNameSearchInput(description) {
    try {
      return await waitFor(() => {
        if (isWedaAsyncPostBackActive()) {
          return null;
        }

        const select = findWedaFindPatientModeSelect();
        if (!select || select.value !== WEDA_FIND_PATIENT_NAME_MODE_VALUE) {
          return null;
        }
        return findWedaFindPatientSearchInput();
      }, {
        timeout: WEDA_FIND_PATIENT_MODE_WAIT_MS,
        interval: 300,
        description,
      });
    } catch (_error) {
      return null;
    }
  }

  function isWedaAsyncPostBackActive() {
    try {
      const sys = (typeof unsafeWindow !== "undefined" && unsafeWindow.Sys) || window.Sys;
      const prm = sys && sys.WebForms && sys.WebForms.PageRequestManager && sys.WebForms.PageRequestManager.getInstance
        ? sys.WebForms.PageRequestManager.getInstance()
        : null;
      return Boolean(prm && typeof prm.get_isInAsyncPostBack === "function" && prm.get_isInAsyncPostBack());
    } catch (_error) {
      return false;
    }
  }

  function setWedaFindPatientSearchInputValue(input, value) {
    input.focus();
    setNativeInputValue(input, value);

    try {
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: value,
      }));
    } catch (_error) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function getWedaFindPatientIdentitySourceText(options = {}) {
    const values = [
      options.sourceText || "",
      options.documentText || "",
      options.tableText || "",
      extractWedaMessageBodyFallbackText(),
    ].filter(Boolean);

    if (!values.length) {
      const messageContainer = document.querySelector("#messageContainer");
      if (messageContainer) {
        values.push(getVisibleText(messageContainer));
      }
    }

    return truncatePatientImportSourceText(values.join("\n\n"));
  }

  async function resolveWedaFindPatientSearchIdentity(options = {}) {
    const heuristic = extractWedaFindPatientIdentityHeuristically(options.sourceText || "");
    if (hasUsableWedaFindPatientIdentity(heuristic)) {
      return heuristic;
    }

    if (!options.sourceText && !getLmStudioPdfPageImages(options).length) {
      return heuristic;
    }

    try {
      const lmStudioIdentity = await requestLmStudioPatientIdentity(options);
      if (hasUsableWedaFindPatientIdentity(lmStudioIdentity)) {
        return lmStudioIdentity;
      }
      return lmStudioIdentity || heuristic;
    } catch (error) {
      appendDebugLog("lmstudio:patient-identity-error", {
        error: error && error.message ? error.message : String(error),
        sourceLength: String(options.sourceText || "").length,
        imageCount: getLmStudioPdfPageImages(options).length,
      });
      return heuristic;
    }
  }

  function extractWedaFindPatientIdentityHeuristically(sourceText = "") {
    const source = normalizeMultilineText(extractLikelyPatientIdentitySourceText(sourceText) || sourceText);
    const compact = normalizeText(source);
    const birthDate = extractPatientBirthDateHints(source, { allowLooseParentheses: true })[0] || "";

    const fieldMatch = compact.match(/\bnom(?:\s+de\s+naissance)?\s*[:\-]\s*([^:;\n,]{2,80})\s+(?:pr[eé]nom|prenom)\s*[:\-]\s*([^:;\n,]{2,80})/i);
    if (fieldMatch) {
      return normalizeWedaFindPatientIdentity({
        familyName: fieldMatch[1],
        givenName: fieldMatch[2],
        birthDate,
        source: "heuristic-fields",
      });
    }

    const inlineMatch = compact.match(/\b(?:patient|patiente|b[ée]n[ée]ficiaire|assur[ée]e?|concerne|identit[ée])\s*[:\-]\s*(?:m(?:me|adame|onsieur)?\.?\s*)?([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý' -]{1,80})\s+([A-ZÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,60})/);
    if (inlineMatch) {
      return normalizeWedaFindPatientIdentity({
        familyName: inlineMatch[1],
        givenName: inlineMatch[2],
        birthDate,
        source: "heuristic-inline",
      });
    }

    return normalizeWedaFindPatientIdentity({
      birthDate,
      source: "heuristic-empty",
    });
  }

  async function requestLmStudioPatientIdentity(options = {}) {
    const model = await getLmStudioModelId();
    const userContent = buildLmStudioPatientIdentityUserContent(options);
    const payload = {
      model,
      temperature: 0,
      max_tokens: LMSTUDIO_PATIENT_IDENTITY_MAX_TOKENS,
      stream: false,
      messages: [
        {
          role: "system",
          content: "Tu extrais uniquement l'identité administrative du patient concerné. Réponds uniquement avec le bloc XML demandé, sans commentaire.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    };

    appendDebugLog("lmstudio:patient-identity-request", {
      model,
      promptLength: getLmStudioUserContentTextLength(userContent),
      imageCount: countLmStudioUserContentImages(userContent),
      maxTokens: LMSTUDIO_PATIENT_IDENTITY_MAX_TOKENS,
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
    const identity = parseLmStudioPatientIdentityOutput(answer);

    appendDebugLog("lmstudio:patient-identity-answer", {
      answerLength: answer.length,
      hasFamilyName: Boolean(identity.familyName),
      hasGivenName: Boolean(identity.givenName),
      hasBirthDate: Boolean(identity.birthDate),
    });

    return identity;
  }

  function buildLmStudioPatientIdentityUserContent(options = {}) {
    const sourceText = truncateLmStudioDocumentText(options.sourceText || "");
    const prompt = [
      "Le panneau WEDA de recherche patient est ouvert parce que le patient du courrier n'a pas été identifié automatiquement.",
      "Analyse le courrier et extrais uniquement l'identité du patient concerné par le document.",
      "N'invente rien. Si une information est absente ou incertaine, laisse le champ vide.",
      "Format obligatoire, sans texte autour :",
      "<PATIENT_IDENTITE>",
      "NOM: nom de famille du patient, en majuscules si possible",
      "PRENOM: prénom usuel du patient",
      "DATE_NAISSANCE: JJ/MM/AAAA si explicitement présent, sinon vide",
      "</PATIENT_IDENTITE>",
      "",
      "COURRIER:",
      sourceText || "[texte non disponible, utiliser les images jointes si présentes]",
    ].join("\n");
    const images = getLmStudioPdfPageImages(options);

    if (!images.length) {
      return prompt;
    }

    return [
      {
        type: "text",
        text: `${prompt}\n\nIMPORTANT : si le texte est incomplet ou illisible, lis les images du courrier ci-dessous comme OCR visuel.`,
      },
      ...images.map((image) => ({
        type: "image_url",
        image_url: {
          url: image.dataUrl,
        },
      })),
    ];
  }

  function parseLmStudioPatientIdentityOutput(answer = "") {
    const block = extractTaggedBlock(answer, "PATIENT_IDENTITE") || answer;
    const fields = parseSimpleKeyValueBlock(block);

    return normalizeWedaFindPatientIdentity({
      familyName: fields.NOM || fields.NOM_PATIENT || fields.PATIENT_NOM || "",
      givenName: fields.PRENOM || fields.PRENOM_PATIENT || fields.PATIENT_PRENOM || "",
      birthDate: fields.DATE_NAISSANCE || fields.NAISSANCE || fields.DATE_DE_NAISSANCE || "",
      source: "lmstudio",
    });
  }

  function normalizeWedaFindPatientIdentity(identity = {}) {
    let familyName = cleanWedaFindPatientNamePart(identity.familyName || identity.nom || "");
    let givenName = cleanWedaFindPatientNamePart(identity.givenName || identity.prenom || "");
    const fullName = cleanWedaFindPatientNamePart(identity.fullName || identity.patientLabel || "");

    if ((!familyName || !givenName) && fullName) {
      const parsed = parsePatientImportName(fullName);
      familyName = familyName || parsed.familyName;
      givenName = givenName || parsed.givenName;
    }

    if (!givenName && familyName.split(/\s+/).length >= 2) {
      const parsed = parsePatientImportName(familyName);
      familyName = parsed.familyName || familyName;
      givenName = parsed.givenName || "";
    }

    familyName = cleanWedaFindPatientNamePart(familyName).toUpperCase();
    givenName = cleanWedaFindPatientNamePart(givenName);
    const birthDate = normalizePatientBirthDate(identity.birthDate || identity.dateNaissance || "");
    const searchLabel = normalizeText([familyName, givenName].filter(Boolean).join(" "));

    return {
      familyName,
      givenName,
      birthDate,
      searchLabel,
      source: identity.source || "",
    };
  }

  function cleanWedaFindPatientNamePart(value = "") {
    return normalizeText(value)
      .replace(/\b(?:m|mr|mme|madame|monsieur|mlle|melle)\.?\b/gi, "")
      .replace(/\b(?:n[ée]e?|date\s+de\s+naissance|naissance|dob)\b[\s\S]*$/i, "")
      .replace(/\b(?:nom|pr[eé]nom|patient|patiente|identit[ée]|b[ée]n[ée]ficiaire|assur[ée]e?|concerne)\b\s*[:\-]?/gi, "")
      .replace(/[()[\]{}<>]/g, " ")
      .replace(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/g, "")
      .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasUsableWedaFindPatientIdentity(identity = {}) {
    return Boolean(identity && identity.searchLabel && identity.familyName && (identity.givenName || identity.birthDate));
  }

  function hasExplicitWedaFindPatientIdentitySource(options = {}) {
    return Boolean(
      normalizePdfText([options.sourceText || "", options.documentText || "", options.tableText || ""].join("\n")).length ||
      getLmStudioPdfPageImages(options).length
    );
  }

  function buildWedaFindPatientRescueKey(options = {}, identity = {}) {
    return [
      options.jobId || "",
      options.contentKey || "",
      options.urlKey || "",
      options.rowStableKey || "",
      options.pdfUrl ? hashString(options.pdfUrl) : "",
      hashString([identity.searchLabel || "", identity.birthDate || ""].join("|")),
    ].filter(Boolean).join("|") || hashString(Date.now() + "|" + Math.random());
  }

  function collectWedaFindPatientGridCandidates() {
    const grid = document.querySelector(WEDA_FIND_PATIENT_GRID_SELECTOR);
    if (!grid || !isElementVisible(grid)) {
      return [];
    }

    return Array.from(grid.querySelectorAll("tr"))
      .filter((row) => row && !row.classList.contains("grid-header"))
      .map((row, index) => buildWedaFindPatientGridCandidate(row, index))
      .filter((candidate) => candidate && candidate.link && (candidate.patientLabel || candidate.birthDate));
  }

  function buildWedaFindPatientGridCandidate(row, index) {
    const cells = Array.from(row.children || []).filter((cell) => /^(?:td|th)$/i.test(cell.tagName || ""));
    const patientLink = row.querySelector("a[id*='LinkButtonOldPatientGetNomPrenom']") ||
      (cells[2] ? cells[2].querySelector("a") : null);
    const birthDateLink = row.querySelector("a[id*='LinkButtonOldPatienDateNaissance']") ||
      (cells[3] ? cells[3].querySelector("a") : null);
    const maidenNameLink = row.querySelector("a[id*='LinkButtonOldPatientNomJeuneFille']") ||
      (cells[6] ? cells[6].querySelector("a") : null);
    const patientLabel = cleanPatientImportLabel(patientLink ? patientLink.textContent : (cells[2] ? cells[2].textContent : ""));
    const birthDate = normalizePatientBirthDate(birthDateLink ? birthDateLink.textContent : (cells[3] ? cells[3].textContent : ""));
    const maidenName = cleanPatientImportLabel(maidenNameLink ? maidenNameLink.textContent : (cells[6] ? cells[6].textContent : ""));

    return {
      row,
      link: patientLink || row.querySelector("a[href*='WebForm_DoPostBackWithOptions']"),
      index,
      patientLabel,
      birthDate,
      maidenName,
      nameParts: parsePatientImportName(patientLabel),
    };
  }

  function resolveWedaFindPatientGridSelection(identity = {}, candidates = collectWedaFindPatientGridCandidates()) {
    if (!candidates.length) {
      return {
        link: null,
        blocked: false,
        reason: "missing-results",
        candidateCount: 0,
      };
    }

    const scored = candidates
      .map((candidate) => {
        const score = scoreWedaFindPatientGridCandidate(candidate, identity);
        return {
          ...candidate,
          score: score.value,
          nameMatch: score.nameMatch,
          birthDateMatch: score.birthDateMatch,
        };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const best = scored[0] || null;
    const second = scored[1] || null;
    const scoreGap = best && second ? best.score - second.score : best ? best.score : 0;
    const birthMatches = scored.filter((candidate) => candidate.birthDateMatch);
    const nameMatches = scored.filter((candidate) => candidate.nameMatch);
    let selected = null;
    let reason = "";

    if (birthMatches.length === 1 && birthMatches[0].score >= WEDA_FIND_PATIENT_MIN_SCORE) {
      selected = birthMatches[0];
      reason = "unique-birth-date";
    } else if (nameMatches.length === 1 && nameMatches[0].score >= WEDA_FIND_PATIENT_MIN_SCORE) {
      selected = nameMatches[0];
      reason = "unique-name";
    } else if (scored.length === 1 && best.score >= WEDA_FIND_PATIENT_MIN_SCORE) {
      selected = best;
      reason = "single-result";
    } else if (
      best &&
      best.score >= WEDA_FIND_PATIENT_MIN_SCORE &&
      (!second || scoreGap >= WEDA_FIND_PATIENT_AMBIGUITY_MARGIN)
    ) {
      selected = best;
      reason = "best-score";
    }

    if (!selected) {
      return {
        link: null,
        blocked: true,
        reason: best && best.score > 0 ? "ambiguous-find-patient-selection" : "no-find-patient-match",
        candidateCount: scored.length,
        topScore: best ? best.score : 0,
        scoreGap,
        hasBirthDateHint: Boolean(identity.birthDate),
      };
    }

    return {
      link: selected.link,
      reason,
      candidateCount: scored.length,
      selectedIndex: selected.index,
      score: selected.score,
      scoreGap,
      birthDateMatch: selected.birthDateMatch,
      nameMatch: selected.nameMatch,
      patientLabel: selected.patientLabel || "",
      birthDate: selected.birthDate || "",
      maidenName: selected.maidenName || "",
    };
  }

  function scoreWedaFindPatientGridCandidate(candidate = {}, identity = {}) {
    let value = 0;
    let nameMatch = false;
    let birthDateMatch = false;
    const labelText = normalizePatientCompareText([candidate.patientLabel, candidate.maidenName].filter(Boolean).join(" "));
    const candidateName = candidate.nameParts || parsePatientImportName(candidate.patientLabel || "");
    const candidateFamily = normalizePatientCompareText(candidateName.familyName || "").trim();
    const candidateGiven = normalizePatientCompareText(candidateName.givenName || "").trim();
    const family = normalizePatientCompareText(identity.familyName || "").trim();
    const given = normalizePatientCompareText(identity.givenName || "").trim();
    const full = normalizePatientCompareText(identity.searchLabel || "").trim();

    if (identity.birthDate && candidate.birthDate === identity.birthDate) {
      value += 1200;
      birthDateMatch = true;
    }

    if (full && labelText.includes(` ${full} `)) {
      value += 850;
      nameMatch = true;
    }

    if (family && given && labelText.includes(` ${family} `) && labelText.includes(` ${given} `)) {
      value += 650;
      nameMatch = true;
    }

    if (family && candidateFamily === family) {
      value += 260;
      nameMatch = true;
    } else if (family && labelText.includes(` ${family} `)) {
      value += 160;
    }

    if (given && candidateGiven === given) {
      value += 220;
      nameMatch = true;
    } else if (given && labelText.includes(` ${given} `)) {
      value += 120;
    }

    return {
      value,
      nameMatch,
      birthDateMatch,
    };
  }

  function buildWedaFindPatientIssue(reason, identity = {}, candidateCount = 0, topScore = 0, scoreGap = 0) {
    const message = reason === "ambiguous-find-patient-selection"
      ? "Recherche patient WEDA bloquée : plusieurs patients restent plausibles."
      : reason === "no-find-patient-match"
        ? "Recherche patient WEDA bloquée : aucun résultat ne correspond clairement au courrier."
        : "Recherche patient WEDA bloquée : impossible de sélectionner automatiquement le patient.";

    return {
      blocked: true,
      reason,
      at: Date.now(),
      message,
      candidateCount,
      topScore,
      scoreGap,
      hasBirthDateHint: Boolean(identity.birthDate),
      source: "find-patient-panel",
    };
  }

  async function waitForWedaFindPatientSelectionApplied(options = {}) {
    try {
      await waitFor(() => !findWedaFindPatientPanel(), {
        timeout: WEDA_FIND_PATIENT_RESULT_WAIT_MS,
        interval: 400,
        description: "la fermeture de la recherche patient WEDA",
      });
    } catch (_error) {
      appendDebugLog("weda:find-patient-panel-still-open-after-click", {
        reason: options.reason || "",
        hasTitleInput: Boolean(findWedaTitleInput(options)),
        candidateCount: collectWedaFindPatientGridCandidates().length,
      });
      return null;
    }

    await sleep(WEDA_FIND_PATIENT_SELECTION_SETTLE_MS);
    return waitForOptionalTitleInput(TITLE_INPUT_WAIT_AFTER_PATIENT_MS, "le champ titre après recherche patient WEDA", options);
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
    clearPatientImportSelectionIssue();
    let input = findWedaTitleInput(options);

    if (input) {
      const findPatientPanel = findWedaFindPatientPanel();
      const findPatientPanelActionable = Boolean(findPatientPanel && isWedaFindPatientPanelActionable(findPatientPanel));
      if (findPatientPanel && findPatientPanelActionable && hasExplicitWedaFindPatientIdentitySource(options)) {
        return rescueWedaFindPatientPanelWithDocumentIdentity({
          ...options,
          jobId,
          reason: "ensure-title-input-existing-find-patient-panel",
        });
      }
      if (findPatientPanel && !findPatientPanelActionable && hasExplicitWedaFindPatientIdentitySource(options)) {
        appendDebugLog("weda:title-input-existing-find-patient-panel-non-actionable", {
          jobId,
          titleInputIndex: getWedaTitleInputIndex(input),
          rowStableKey: options.rowStableKey || "",
        });
      }
      return input;
    }

    if (jobId && !isCurrentJobStillActive(jobId, ["waitingLmStudio", "savingTitle"])) {
      return null;
    }

    const importMessageSelection = resolveImportMessageLink({
      ...options,
      jobId,
      reason: "ensure-title-input",
    });
    const importMessageLink = importMessageSelection.link;
    if (importMessageLink) {
      appendDebugLog("weda:import-message-click", {
        jobId,
        link: importMessageLink,
        selectionReason: importMessageSelection.reason || "",
        candidateCount: importMessageSelection.candidateCount || 0,
        patientCandidateCount: importMessageSelection.patientCandidateCount || 0,
        selectedIndex: importMessageSelection.selectedIndex,
        score: importMessageSelection.score || 0,
        scoreGap: importMessageSelection.scoreGap || 0,
        birthDateMatch: Boolean(importMessageSelection.birthDateMatch),
        nameMatch: Boolean(importMessageSelection.nameMatch),
      });
      setPanelStatus("Ouverture de l'import du message...");
      rememberPatientImportSelectionContext(importMessageSelection, {
        ...options,
        jobId,
      }, "import-message-click");
      clickButtonLikeUser(importMessageLink);

      input = await waitForOptionalTitleInput(TITLE_INPUT_WAIT_AFTER_IMPORT_MS, "le champ titre après import du message", options);
      if (input && !findWedaFindPatientPanel()) {
        return input;
      }

      if (findWedaFindPatientPanel()) {
        input = await rescueWedaFindPatientPanelWithDocumentIdentity({
          ...options,
          jobId,
          reason: "ensure-title-input-find-patient-panel",
        });
        if (input) {
          return input;
        }
      }
    } else if (importMessageSelection.blocked) {
      appendDebugLog("weda:import-message-selection-blocked", {
        jobId,
        selectionReason: importMessageSelection.reason || "",
        candidateCount: importMessageSelection.candidateCount || 0,
        patientCandidateCount: importMessageSelection.patientCandidateCount || 0,
        topScore: importMessageSelection.topScore || 0,
        scoreGap: importMessageSelection.scoreGap || 0,
        hasBirthDateHint: Boolean(importMessageSelection.hasBirthDateHint),
        hasIdentityHint: Boolean(importMessageSelection.hasIdentityHint),
      });
      setPanelStatus(importMessageSelection.message || "Import patient bloqué : choix patient ambigu.");
      return null;
    } else {
      appendDebugLog("weda:import-message-missing", { jobId });
    }

    if (jobId && !isCurrentJobStillActive(jobId, ["waitingLmStudio", "savingTitle"])) {
      appendDebugLog("weda:import-title-cancelled-after-import-wait", { jobId });
      return null;
    }

    return openPatientImportForCurrentMessage(jobId, importMessageLink ? "after-import-message" : "missing-import-message", options);
  }

  async function prepareImportBeforePdfWait(row, options = {}) {
    clearPatientImportSelectionIssue();
    const expectedTitleInput = options.expectedPdfUrl || options.urlKey
      ? findWedaTitleInput({
        pdfUrl: options.expectedPdfUrl || "",
        urlKey: options.urlKey || "",
        rowStableKey: row ? row.stableKey : "",
      })
      : null;

    if (expectedTitleInput) {
      appendDebugLog("weda:pre-pdf-title-input-already-visible", {
        rowIndex: row ? row.index : null,
        rowStableKey: row ? row.stableKey : "",
        urlKey: options.urlKey || "",
        pdfUrlHash: options.expectedPdfUrl ? hashString(options.expectedPdfUrl) : "",
        titleInputIndex: getWedaTitleInputIndex(expectedTitleInput),
      });
      return { patientImportOpened: false, titleInputRequired: true };
    }

    const importMessageSelection = resolveImportMessageLink({
      reason: "before-pdf-wait",
      rowStableKey: row ? row.stableKey : "",
    });
    const importMessageLink = importMessageSelection.link;

    if (importMessageLink) {
      appendDebugLog("weda:pre-pdf-import-message-found", {
        rowIndex: row ? row.index : null,
        link: importMessageLink,
        selectionReason: importMessageSelection.reason || "",
        candidateCount: importMessageSelection.candidateCount || 0,
        patientCandidateCount: importMessageSelection.patientCandidateCount || 0,
        selectedIndex: importMessageSelection.selectedIndex,
        score: importMessageSelection.score || 0,
        scoreGap: importMessageSelection.scoreGap || 0,
        birthDateMatch: Boolean(importMessageSelection.birthDateMatch),
        nameMatch: Boolean(importMessageSelection.nameMatch),
      });
      return { patientImportOpened: false, titleInputRequired: false };
    }

    if (importMessageSelection.blocked) {
      appendDebugLog("weda:pre-pdf-patient-selection-blocked", {
        rowIndex: row ? row.index : null,
        selectionReason: importMessageSelection.reason || "",
        candidateCount: importMessageSelection.candidateCount || 0,
        patientCandidateCount: importMessageSelection.patientCandidateCount || 0,
        topScore: importMessageSelection.topScore || 0,
        scoreGap: importMessageSelection.scoreGap || 0,
        hasBirthDateHint: Boolean(importMessageSelection.hasBirthDateHint),
        hasIdentityHint: Boolean(importMessageSelection.hasIdentityHint),
      });
      return { patientImportOpened: false, titleInputRequired: false, patientSelectionBlocked: true };
    }

    appendDebugLog("weda:pre-pdf-import-message-missing", {
      rowIndex: row ? row.index : null,
    });

    patientImportBeforePdfStableKey = row ? row.stableKey : "";
    const input = await openPatientImportForCurrentMessage("", "before-pdf-missing-import-message", {
      rowStableKey: row ? row.stableKey : "",
    });
    const findPatientPanel = findWedaFindPatientPanel();
    if (input && findPatientPanel) {
      const findPatientPanelActionable = isWedaFindPatientPanelActionable(findPatientPanel);
      appendDebugLog(findPatientPanelActionable
        ? "weda:pre-pdf-find-patient-panel-with-title-input"
        : "weda:pre-pdf-find-patient-panel-non-actionable-with-title-input", {
        rowIndex: row ? row.index : null,
        rowStableKey: row ? row.stableKey : "",
        titleInputIndex: getWedaTitleInputIndex(input),
      });
      return {
        patientImportOpened: true,
        titleInputRequired: true,
        pdfPerformanceStartTime: lastPatientImportPerformanceStartTime,
        findPatientPanelPending: findPatientPanelActionable,
      };
    }

    if (!input) {
      if (findWedaFindPatientPanel()) {
        appendDebugLog("weda:pre-pdf-find-patient-panel-pending", {
          rowIndex: row ? row.index : null,
          rowStableKey: row ? row.stableKey : "",
        });
        return {
          patientImportOpened: true,
          titleInputRequired: true,
          pdfPerformanceStartTime: lastPatientImportPerformanceStartTime,
          findPatientPanelPending: true,
        };
      }

      const patientImportIssue = getLastPatientImportSelectionIssue();
      throw new Error(patientImportIssue && patientImportIssue.blocked
        ? patientImportIssue.message
        : "champ titre indisponible après clic sur Un patient");
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
    let displayed = null;

    try {
      displayed = await waitFor(() => {
        abortIfWorkflowStopped();
        const pdfUrl = getDisplayedPdfUrl({
          includePerformance: getElapsedPerformanceMs(waitStartedAt) >= PDF_PERFORMANCE_FALLBACK_SETTLE_MS,
          minPerformanceStartTime: waitStartedAt,
          excludeUrlKeys: options.excludeUrlKeys || [],
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

        if (expectedPdfUrl && !areSamePdfUrls(pdfUrl, expectedPdfUrl)) {
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
    } catch (error) {
      if (isWorkflowStopped() || /analyse arrêtée/i.test(error && error.message ? error.message : "")) {
        throw error;
      }

      const fallbackDocument = buildDisplayedBiologyDocumentFromMessageBody("weda:pdf-missing-message-body-fallback", {
        error,
        item,
      });

      if (fallbackDocument) {
        abortIfWorkflowStopped();
        return fallbackDocument;
      }

      throw error;
    }

    abortIfWorkflowStopped();
    setPanelStatus("Extraction du texte du PDF...");
    const extracted = await extractDisplayedPdfTextWithRetry(displayed, waitStartedAt, {
      excludeUrlKeys: options.excludeUrlKeys || [],
    });
    abortIfWorkflowStopped();
    const documentText = extracted.documentText;
    const sourceType = extracted.sourceType || (extracted.pdfTextExtractionEmpty ? "pdf-attachment" : "pdf");
    const contentKey = getDisplayedBiologyContentKey(documentText, sourceType);

    return {
      table: null,
      tableText: documentText,
      tableHtml: "",
      contentKey,
      sourceType,
      pdfUrl: extracted.displayed.pdfUrl,
      urlKey: extracted.displayed.urlKey,
      pdfAttachmentBase64: extracted.pdfAttachmentBase64 || "",
      pdfAttachmentName: extracted.pdfAttachmentName || "",
      pdfAttachmentMimeType: extracted.pdfAttachmentMimeType || "",
      pdfAttachmentByteLength: extracted.pdfAttachmentByteLength || 0,
      pdfTextExtractionEmpty: Boolean(extracted.pdfTextExtractionEmpty),
      pdfPageImages: Array.isArray(extracted.pdfPageImages) ? extracted.pdfPageImages : [],
      pdfImagePageCount: Number(extracted.pdfImagePageCount || 0),
      pdfImageTotalPages: Number(extracted.pdfImageTotalPages || 0),
      pdfImageFallbackReason: extracted.pdfImageFallbackReason || "",
      pdfTextExtractionSparse: Boolean(extracted.pdfTextExtractionSparse),
      pdfTextExtractionGarbled: Boolean(extracted.pdfTextExtractionGarbled),
      pdfTextUnusable: Boolean(extracted.pdfTextUnusable),
      pdfUnusableReason: extracted.pdfUnusableReason || "",
      pdfTextPageCount: Number(extracted.pdfTextPageCount || 0),
    };
  }

  async function handleStrictDuplicateDisplayedDocument(row, displayedDocument, documentText = "", rows = getBiologyRows()) {
    if (!row || !displayedDocument || !displayedDocument.pdfUrl) {
      return false;
    }

    const fingerprint = await buildStrictDuplicatePdfFingerprint(displayedDocument, documentText, row);
    if (!fingerprint || !fingerprint.ok) {
      return false;
    }

    const registry = getWedaDuplicatePdfRegistry();
    const previousMatch = findWedaDuplicatePdfPreviousMatch(registry, fingerprint, row);
    const previousEntry = previousMatch ? previousMatch.entry : null;

    if (!previousEntry) {
      const sameRowRegistered = hasSameWedaDuplicateRowRegistered(registry, fingerprint, row);
      registerWedaDuplicatePdfFingerprint(registry, row, displayedDocument, fingerprint);
      saveWedaDuplicatePdfRegistry(registry);
      appendDebugLog(sameRowRegistered ? "weda:duplicate-pdf-registry-refreshed" : "weda:duplicate-pdf-registered", {
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        key: fingerprint.key,
        keys: fingerprint.keys || [],
        byteLength: fingerprint.byteLength,
        textHash: fingerprint.textHash || "",
        textLength: fingerprint.textLength || 0,
        textDuplicateKey: fingerprint.textKey || "",
        contentKey: fingerprint.contentKey || "",
        sourceType: fingerprint.sourceType || "",
      });
      return false;
    }

    if (!isStrictDuplicatePdfFingerprintMatch(previousEntry, fingerprint)) {
      appendDebugLog("weda:duplicate-pdf-hash-collision-ignored", {
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        previousRowIndex: previousEntry.rowIndex,
        previousRowStableKey: previousEntry.rowStableKey || "",
        key: previousMatch.key || fingerprint.key,
        byteLength: fingerprint.byteLength,
        previousByteLength: previousEntry.byteLength || 0,
        textHash: fingerprint.textHash || "",
        previousTextHash: previousEntry.textHash || "",
        textLength: fingerprint.textLength || 0,
        previousTextLength: previousEntry.textLength || 0,
      });
      return false;
    }

    const currentIsOlder = isCurrentWedaRowOlderThanDuplicateEntry(row, previousEntry);
    const previousIsOlder = isWedaDuplicateEntryOlderThanCurrentRow(previousEntry, row);
    const matchMode = getStrictDuplicatePdfFingerprintMatchMode(previousEntry, fingerprint);

    appendDebugLog("weda:duplicate-pdf-strict-match", {
      rowIndex: row.index,
      rowStableKey: row.stableKey,
      previousRowIndex: previousEntry.rowIndex,
      previousRowStableKey: previousEntry.rowStableKey || "",
      key: previousMatch.key || fingerprint.key,
      matchMode,
      byteLength: fingerprint.byteLength,
      previousByteLength: previousEntry.byteLength || 0,
      textLength: fingerprint.textLength || 0,
      previousTextLength: previousEntry.textLength || 0,
      currentIsOlder,
      previousIsOlder,
      currentDate: row.date || "",
      previousDate: previousEntry.rowDate || "",
    });

    if (currentIsOlder) {
      const deleted = await deleteCurrentStrictDuplicateRow(row, previousEntry, fingerprint, rows);
      if (deleted) {
        return true;
      }

      appendDebugLog("weda:duplicate-pdf-delete-failed-continue-analysis", {
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        key: fingerprint.key,
      });
      return false;
    }

    if (previousIsOlder) {
      registerWedaDuplicatePdfFingerprint(registry, row, displayedDocument, fingerprint);
      saveWedaDuplicatePdfRegistry(registry);
      appendDebugLog("weda:duplicate-pdf-older-previous-not-deleted", {
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        previousRowIndex: previousEntry.rowIndex,
        previousRowStableKey: previousEntry.rowStableKey || "",
        key: previousMatch.key || fingerprint.key,
        matchMode,
        reason: "older-row-not-current",
      });
      return false;
    }

    appendDebugLog("weda:duplicate-pdf-age-ambiguous-no-delete", {
      rowIndex: row.index,
      rowStableKey: row.stableKey,
      previousRowIndex: previousEntry.rowIndex,
      previousRowStableKey: previousEntry.rowStableKey || "",
      key: fingerprint.key,
      currentDate: row.date || "",
      previousDate: previousEntry.rowDate || "",
    });
    return false;
  }

  async function buildStrictDuplicatePdfFingerprint(displayedDocument, documentText = "", row = null) {
    try {
      const pdfUrl = displayedDocument && displayedDocument.pdfUrl || "";
      if (!pdfUrl) {
        return { ok: false, reason: "missing-pdf-url" };
      }

      const bytes = await fetchPdfBytes(pdfUrl);
      abortIfWorkflowStopped();

      const byteLength = bytes.length || 0;
      const header = bytesToAscii(bytes.slice(0, 5));
      if (byteLength < WEDA_STRICT_DUPLICATE_MIN_PDF_BYTES || header !== "%PDF-") {
        appendDebugLog("weda:duplicate-pdf-fingerprint-skipped", {
          rowIndex: row ? row.index : null,
          reason: header === "%PDF-" ? "too-small" : "not-a-pdf",
          byteLength,
          header,
        });
        return { ok: false, reason: header === "%PDF-" ? "too-small" : "not-a-pdf" };
      }

      const byteHash = await hashBytes(bytes);
      const normalizedText = normalizePdfText(documentText);
      const textAllowed = isStrictDuplicatePdfTextFingerprintAllowed(displayedDocument, normalizedText);
      const textHash = textAllowed ? await hashText(normalizedText) : "";
      const byteKey = byteHash ? "pdfsha256-" + byteHash : "";
      const textKey = textHash ? "pdftextsha256-" + textHash : "";

      return {
        ok: Boolean(byteKey || textKey),
        key: byteKey || textKey,
        byteKey,
        textKey,
        keys: getStrictDuplicatePdfFingerprintKeys({
          byteKey,
          textKey,
        }),
        byteHash,
        byteLength,
        textHash,
        textLength: normalizedText.length,
        textAllowed,
        urlKey: displayedDocument.urlKey || (pdfUrl ? "pdfurl-" + hashString(pdfUrl) : ""),
        contentKey: displayedDocument.contentKey || "",
        sourceType: displayedDocument.sourceType || "",
        pdfTextExtractionSparse: Boolean(displayedDocument.pdfTextExtractionSparse),
        pdfTextExtractionGarbled: Boolean(displayedDocument.pdfTextExtractionGarbled),
        pdfTextUnusable: Boolean(displayedDocument.pdfTextUnusable),
        pdfTextPageCount: Number(displayedDocument.pdfTextPageCount || 0),
      };
    } catch (error) {
      appendDebugLog("weda:duplicate-pdf-fingerprint-error", {
        rowIndex: row ? row.index : null,
        rowStableKey: row ? row.stableKey : "",
        error: error && error.message ? error.message : String(error),
      });
      return { ok: false, reason: "fingerprint-error" };
    }
  }

  function isStrictDuplicatePdfTextFingerprintAllowed(displayedDocument = {}, normalizedText = "") {
    return Boolean(
      normalizedText &&
      normalizedText.length >= WEDA_STRICT_DUPLICATE_MIN_TEXT_CHARS &&
      displayedDocument.sourceType === "pdf" &&
      !displayedDocument.pdfTextExtractionEmpty &&
      !displayedDocument.pdfTextExtractionSparse &&
      !displayedDocument.pdfTextExtractionGarbled &&
      !displayedDocument.pdfTextUnusable
    );
  }

  async function hashBytes(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);

    if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
      const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      return bytesToHex(new Uint8Array(digest));
    }

    return "fallback-" + hashString(uint8ArrayToBase64(source));
  }

  async function hashText(value = "") {
    const text = String(value || "");
    if (!text) {
      return "";
    }

    if (typeof TextEncoder !== "undefined") {
      return hashBytes(new TextEncoder().encode(text));
    }

    return "fallback-" + hashString(text);
  }

  function bytesToHex(bytes) {
    return Array.from(bytes || [])
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function getWedaDuplicatePdfRegistry() {
    const registry = GM_getValue(DUPLICATE_PDF_REGISTRY_KEY, {});
    return registry && typeof registry === "object" && !Array.isArray(registry) ? registry : {};
  }

  function saveWedaDuplicatePdfRegistry(registry) {
    GM_setValue(DUPLICATE_PDF_REGISTRY_KEY, registry && typeof registry === "object" ? registry : {});
  }

  function resetWedaDuplicatePdfRegistry(reason = "") {
    GM_deleteValue(DUPLICATE_PDF_REGISTRY_KEY);
    appendDebugLog("weda:duplicate-pdf-registry-reset", { reason });
  }

  function buildWedaDuplicatePdfRegistryEntry(row, displayedDocument, fingerprint) {
    return {
      key: fingerprint.key,
      byteKey: fingerprint.byteKey || "",
      textKey: fingerprint.textKey || "",
      keys: fingerprint.keys || [],
      byteHash: fingerprint.byteHash,
      byteLength: fingerprint.byteLength,
      textHash: fingerprint.textHash || "",
      textLength: fingerprint.textLength || 0,
      textAllowed: Boolean(fingerprint.textAllowed),
      contentKey: fingerprint.contentKey || displayedDocument.contentKey || "",
      urlKey: fingerprint.urlKey || displayedDocument.urlKey || "",
      sourceType: fingerprint.sourceType || displayedDocument.sourceType || "",
      pdfTextExtractionSparse: Boolean(fingerprint.pdfTextExtractionSparse),
      pdfTextExtractionGarbled: Boolean(fingerprint.pdfTextExtractionGarbled),
      pdfTextUnusable: Boolean(fingerprint.pdfTextUnusable),
      pdfTextPageCount: Number(fingerprint.pdfTextPageCount || displayedDocument.pdfTextPageCount || 0),
      rowIndex: row ? row.index : null,
      rowKey: row ? row.key || "" : "",
      rowStableKey: row ? row.stableKey || "" : "",
      rowIdentity: row ? row.identityLabel || "" : "",
      rowDate: row ? row.date || "" : "",
      rowAgeTimestamp: row ? parseWedaMessageDateTimestamp(row.date || "") : null,
      pdfUrlHash: hashString(displayedDocument && displayedDocument.pdfUrl || ""),
      registeredAt: Date.now(),
    };
  }

  function registerWedaDuplicatePdfFingerprint(registry, row, displayedDocument, fingerprint) {
    const entry = buildWedaDuplicatePdfRegistryEntry(row, displayedDocument, fingerprint);
    getStrictDuplicatePdfFingerprintKeys(fingerprint).forEach((key) => {
      registry[key] = {
        ...entry,
        registryKey: key,
      };
    });
    return entry;
  }

  function getStrictDuplicatePdfFingerprintKeys(fingerprint = {}) {
    return Array.from(new Set([
      fingerprint.byteKey || fingerprint.key || "",
      fingerprint.textKey || "",
    ].filter(Boolean)));
  }

  function findWedaDuplicatePdfPreviousMatch(registry = {}, fingerprint = {}, row = null) {
    for (const key of getStrictDuplicatePdfFingerprintKeys(fingerprint)) {
      const entry = registry[key];
      if (entry && !isSameWedaDuplicateRow(entry, row)) {
        return {
          key,
          entry,
        };
      }
    }

    return null;
  }

  function hasSameWedaDuplicateRowRegistered(registry = {}, fingerprint = {}, row = null) {
    return getStrictDuplicatePdfFingerprintKeys(fingerprint)
      .some((key) => registry[key] && isSameWedaDuplicateRow(registry[key], row));
  }

  function isSameWedaDuplicateRow(entry = {}, row = null) {
    if (!entry || !row) {
      return false;
    }

    return Boolean(
      (entry.rowKey && row.key && entry.rowKey === row.key) ||
      (entry.rowStableKey && row.stableKey && entry.rowStableKey === row.stableKey && Number(entry.rowIndex) === Number(row.index))
    );
  }

  function isStrictDuplicatePdfFingerprintMatch(entry = {}, fingerprint = {}) {
    if (!entry || !fingerprint) {
      return false;
    }

    return Boolean(getStrictDuplicatePdfFingerprintMatchMode(entry, fingerprint));
  }

  function getStrictDuplicatePdfFingerprintMatchMode(entry = {}, fingerprint = {}) {
    if (isStrictDuplicatePdfBinaryMatch(entry, fingerprint)) {
      return "binary";
    }

    if (isStrictDuplicatePdfTextMatch(entry, fingerprint)) {
      return "text";
    }

    return "";
  }

  function isStrictDuplicatePdfBinaryMatch(entry = {}, fingerprint = {}) {
    return Boolean(
      entry.byteHash &&
      fingerprint.byteHash &&
      entry.byteHash === fingerprint.byteHash &&
      Number(entry.byteLength || 0) === Number(fingerprint.byteLength || 0)
    );
  }

  function isStrictDuplicatePdfTextMatch(entry = {}, fingerprint = {}) {
    if (
      !entry.textAllowed ||
      !fingerprint.textAllowed ||
      !entry.textHash ||
      !fingerprint.textHash ||
      entry.textHash !== fingerprint.textHash
    ) {
      return false;
    }

    if (
      Number(entry.textLength || 0) < WEDA_STRICT_DUPLICATE_MIN_TEXT_CHARS ||
      Number(fingerprint.textLength || 0) < WEDA_STRICT_DUPLICATE_MIN_TEXT_CHARS
    ) {
      return false;
    }

    if (entry.sourceType !== "pdf" || fingerprint.sourceType !== "pdf") {
      return false;
    }

    if (
      entry.pdfTextExtractionSparse ||
      fingerprint.pdfTextExtractionSparse ||
      entry.pdfTextExtractionGarbled ||
      fingerprint.pdfTextExtractionGarbled ||
      entry.pdfTextUnusable ||
      fingerprint.pdfTextUnusable
    ) {
      return false;
    }

    const entryPageCount = Number(entry.pdfTextPageCount || 0);
    const fingerprintPageCount = Number(fingerprint.pdfTextPageCount || 0);
    return !(entryPageCount && fingerprintPageCount && entryPageCount !== fingerprintPageCount);
  }

  function isCurrentWedaRowOlderThanDuplicateEntry(row, entry = {}) {
    const currentTimestamp = parseWedaMessageDateTimestamp(row && row.date || "");
    const previousTimestamp = Number(entry.rowAgeTimestamp || 0);

    if (currentTimestamp && previousTimestamp && currentTimestamp !== previousTimestamp) {
      return currentTimestamp < previousTimestamp;
    }

    const currentIndex = Number(row && row.index);
    const previousIndex = Number(entry.rowIndex);
    return Number.isFinite(currentIndex) && Number.isFinite(previousIndex) && currentIndex > previousIndex;
  }

  function isWedaDuplicateEntryOlderThanCurrentRow(entry = {}, row = null) {
    const currentTimestamp = parseWedaMessageDateTimestamp(row && row.date || "");
    const previousTimestamp = Number(entry.rowAgeTimestamp || 0);

    if (currentTimestamp && previousTimestamp && currentTimestamp !== previousTimestamp) {
      return previousTimestamp < currentTimestamp;
    }

    const currentIndex = Number(row && row.index);
    const previousIndex = Number(entry.rowIndex);
    return Number.isFinite(currentIndex) && Number.isFinite(previousIndex) && previousIndex > currentIndex;
  }

  function parseWedaMessageDateTimestamp(value = "") {
    const raw = normalizeText(value);
    if (!raw) {
      return 0;
    }

    const normalized = normalizeForCompare(raw);
    const timeMatch = raw.match(/\b(\d{1,2})[:h](\d{2})\b/i);
    const hour = timeMatch ? Number(timeMatch[1]) : 0;
    const minute = timeMatch ? Number(timeMatch[2]) : 0;
    const setTime = (date) => {
      date.setHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0);
      return date.getTime();
    };

    if (/\baujourd/.test(normalized)) {
      return setTime(new Date());
    }

    if (/\bhier\b/.test(normalized)) {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return setTime(date);
    }

    const dateMatch = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
    if (!dateMatch) {
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    let year = dateMatch[3] ? Number(dateMatch[3]) : new Date().getFullYear();

    if (year < 100) {
      year += year >= 30 ? 1900 : 2000;
    }

    if (!day || !month || day > 31 || month > 12 || !year) {
      return 0;
    }

    return setTime(new Date(year, month - 1, day));
  }

  async function deleteCurrentStrictDuplicateRow(row, previousEntry, fingerprint, rows = getBiologyRows()) {
    if (!row || !row.row || !document.contains(row.row)) {
      appendDebugLog("weda:duplicate-delete-skip", {
        reason: "row-missing",
        key: fingerprint.key,
      });
      return false;
    }

    if (findWedaFindPatientPanel()) {
      appendDebugLog("weda:duplicate-delete-skip", {
        reason: "find-patient-panel-open",
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        key: fingerprint.key,
      });
      return false;
    }

    const checkbox = findWedaMessageRowCheckbox(row);
    const otherChecked = getCheckedWedaMessageListCheckboxes()
      .filter((candidate) => candidate !== checkbox);

    if (!checkbox || !isElementVisible(checkbox)) {
      appendDebugLog("weda:duplicate-delete-skip", {
        reason: "checkbox-missing",
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        key: fingerprint.key,
      });
      return false;
    }

    if (otherChecked.length) {
      appendDebugLog("weda:duplicate-delete-skip", {
        reason: "other-checkboxes-selected",
        rowIndex: row.index,
        selectedCount: otherChecked.length + 1,
        key: fingerprint.key,
      });
      return false;
    }

    const wasChecked = isWedaCheckboxChecked(checkbox);
    if (!wasChecked && !await setWedaCheckboxChecked(checkbox, true)) {
      appendDebugLog("weda:duplicate-delete-skip", {
        reason: "checkbox-not-checked",
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        key: fingerprint.key,
      });
      return false;
    }

    const deleteLink = await waitForWedaDeleteSelectedMessagesLink();
    if (!deleteLink) {
      appendDebugLog("weda:duplicate-delete-skip", {
        reason: "delete-link-missing-after-checkbox",
        rowIndex: row.index,
        rowStableKey: row.stableKey,
        key: fingerprint.key,
        candidates: getWedaDeleteSelectedMessagesCandidateSummaries(),
      });

      if (!wasChecked && document.contains(checkbox) && isWedaCheckboxChecked(checkbox)) {
        await setWedaCheckboxChecked(checkbox, false);
      }

      return false;
    }

    const previousState = getState();
    const beforeSnapshot = buildWedaMessageListSnapshot();
    const beforeRowsLength = rows.length || getBiologyRows().length;

    setState({
      running: true,
      phase: "deletingDuplicate",
      currentIndex: row.index,
      currentRowKey: row.key,
      currentStableKey: row.stableKey,
      currentJobId: null,
      message: "Doublon strict détecté : suppression du courrier le plus ancien...",
    });

    appendDebugLog("weda:duplicate-delete-click", {
      rowIndex: row.index,
      rowStableKey: row.stableKey,
      previousRowIndex: previousEntry.rowIndex,
      previousRowStableKey: previousEntry.rowStableKey || "",
      key: fingerprint.key,
      byteLength: fingerprint.byteLength,
    });

    clickWedaDeleteLinkWithTemporaryConfirm(deleteLink);

    let deleted = false;
    try {
      await waitFor(() => {
        const currentSnapshot = buildWedaMessageListSnapshot();
        return !document.contains(row.row) ||
          getBiologyRows().length < beforeRowsLength ||
          (beforeSnapshot && currentSnapshot && beforeSnapshot !== currentSnapshot && !document.contains(row.row));
      }, {
        timeout: WEDA_STRICT_DUPLICATE_DELETE_WAIT_MS,
        interval: 350,
        description: "la suppression du courrier doublon",
      });
      deleted = true;
    } catch (_error) {
      deleted = !document.contains(row.row) || getBiologyRows().length < beforeRowsLength;
    }

    if (!deleted) {
      if (!wasChecked && document.contains(checkbox) && isWedaCheckboxChecked(checkbox)) {
        await setWedaCheckboxChecked(checkbox, false);
      }

      setState({
        running: previousState.running,
        phase: previousState.phase || "clickedRow",
        currentIndex: previousState.currentIndex,
        currentRowKey: previousState.currentRowKey,
        currentStableKey: previousState.currentStableKey,
        currentJobId: previousState.currentJobId || null,
        message: "Suppression du doublon non confirmée : analyse conservée.",
      });
      return false;
    }

    appendDebugLog("weda:duplicate-delete-done", {
      rowIndex: row.index,
      rowStableKey: row.stableKey,
      key: fingerprint.key,
      remainingRows: getBiologyRows().length,
    });

    markRowSeen(row.key || row.stableKey);
    await sleep(WEDA_STRICT_DUPLICATE_DELETE_SETTLE_MS);
    continueAfterStrictDuplicateDeletion();
    return true;
  }

  function findWedaMessageRowCheckbox(row) {
    const element = row && row.row;
    if (!element || typeof element.querySelector !== "function") {
      return null;
    }

    return element.querySelector('input[type="checkbox"]') || null;
  }

  function getCheckedWedaMessageListCheckboxes() {
    const list = document.querySelector(MESSAGE_LIST_SELECTOR) || document;
    return Array.from(list.querySelectorAll('input[type="checkbox"]'))
      .filter(isWedaCheckboxChecked);
  }

  function isWedaCheckboxChecked(checkbox) {
    return Boolean(checkbox && checkbox.checked);
  }

  async function setWedaCheckboxChecked(checkbox, checked) {
    if (!checkbox || checkbox.disabled) {
      return false;
    }

    if (isWedaCheckboxChecked(checkbox) === Boolean(checked)) {
      return true;
    }

    try {
      checkbox.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_error) {
      // Le clic reste tenté même si le défilement échoue.
    }

    dispatchPointerLikeEvents(checkbox);
    if (isWedaCheckboxChecked(checkbox) !== Boolean(checked)) {
      try {
        checkbox.click();
      } catch (_error) {
        // Les événements pointeur ci-dessus peuvent suffire.
      }
    }

    if (await waitForCheckboxState(checkbox, checked, 900)) {
      return true;
    }

    setNativeCheckboxChecked(checkbox, checked);
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    return waitForCheckboxState(checkbox, checked, 900);
  }

  function setNativeCheckboxChecked(checkbox, checked) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");

    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(checkbox, Boolean(checked));
    } else {
      checkbox.checked = Boolean(checked);
    }
  }

  async function waitForCheckboxState(checkbox, checked, timeoutMs = 900) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (!document.contains(checkbox) || isWedaCheckboxChecked(checkbox) === Boolean(checked)) {
        return true;
      }
      await sleep(80);
    }
    return isWedaCheckboxChecked(checkbox) === Boolean(checked);
  }

  async function waitForWedaDeleteSelectedMessagesLink(timeoutMs = 2500) {
    try {
      return await waitFor(() => findWedaDeleteSelectedMessagesLink(), {
        timeout: timeoutMs,
        interval: 150,
        description: "le bouton Supprimer les messages selectionnes",
      });
    } catch (_error) {
      return null;
    }
  }

  function findWedaDeleteSelectedMessagesLink() {
    const exact = document.querySelector(DELETE_SELECTED_MESSAGES_SELECTOR);
    if (exact && isElementVisible(exact)) {
      return exact;
    }

    const candidates = collectWedaDeleteSelectedMessagesCandidates()
      .map((element, index) => ({
        element,
        index,
        score: scoreWedaDeleteSelectedMessagesCandidate(element),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return candidates[0] ? candidates[0].element : null;
  }

  function collectWedaDeleteSelectedMessagesCandidates() {
    const containers = [
      ...Array.from(document.querySelectorAll("#weInboxContainer .messageListToolsContainer, .messageListToolsContainer")),
      document.querySelector("#weInboxContainer"),
    ].filter(Boolean)
      .filter((container, index, list) => list.indexOf(container) === index);

    return containers.flatMap((container) => Array.from(container.querySelectorAll([
      "a",
      "button",
      "[role='button']",
      "[onclick]",
      "[title]",
      "[aria-label]",
    ].join(","))))
      .filter((element, index, list) => element && list.indexOf(element) === index)
      .filter((element) => isElementVisible(element))
      .filter((element) => !(element.closest && element.closest("#messageContainer")));
  }

  function scoreWedaDeleteSelectedMessagesCandidate(element) {
    const descriptor = normalizeForCompare(getWedaDeleteSelectedMessagesCandidateDescriptor(element));
    if (!descriptor) {
      return 0;
    }

    let score = 0;
    if (/\b(?:supprim|effac|delete|remove|trash|corbeille|poubelle)\w*\b/.test(descriptor)) {
      score += 1000;
    }

    if (/\b(?:message|messages|courrier|courriers|selection|selectionnes|selected)\b/.test(descriptor)) {
      score += 180;
    }

    if (element.closest && element.closest(".messageListToolsContainer")) {
      score += 500;
    }

    if (/targetsupprimer|delete|remove|trash|corbeille|poubelle/.test(descriptor)) {
      score += 250;
    }

    return score;
  }

  function getWedaDeleteSelectedMessagesCandidateDescriptor(element) {
    if (!element) {
      return "";
    }

    const values = [
      element.textContent || "",
      element.getAttribute("title") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("id") || "",
      element.getAttribute("class") || "",
      element.getAttribute("href") || "",
      element.getAttribute("onclick") || "",
    ];

    Array.from(element.querySelectorAll ? element.querySelectorAll("img, svg, use") : [])
      .forEach((child) => {
        values.push(
          child.getAttribute("title") || "",
          child.getAttribute("alt") || "",
          child.getAttribute("aria-label") || "",
          child.getAttribute("src") || "",
          child.getAttribute("href") || "",
          child.getAttribute("xlink:href") || "",
          child.getAttribute("class") || ""
        );
      });

    return normalizeText(values.filter(Boolean).join(" "));
  }

  function getWedaDeleteSelectedMessagesCandidateSummaries() {
    return collectWedaDeleteSelectedMessagesCandidates()
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName || "",
        id: element.id || "",
        className: String(element.className || ""),
        descriptor: getWedaDeleteSelectedMessagesCandidateDescriptor(element).slice(0, 180),
        score: scoreWedaDeleteSelectedMessagesCandidate(element),
      }));
  }

  function clickWedaDeleteLinkWithTemporaryConfirm(deleteLink) {
    const restoreConfirm = installTemporaryDuplicateDeleteConfirm();
    try {
      clickButtonLikeUser(deleteLink);
    } finally {
      window.setTimeout(restoreConfirm, WEDA_STRICT_DUPLICATE_DELETE_SETTLE_MS);
    }
  }

  function installTemporaryDuplicateDeleteConfirm() {
    const pageWindow = getPageWindow();
    const originalWindowConfirm = window.confirm;
    const originalPageConfirm = pageWindow && pageWindow !== window ? pageWindow.confirm : null;
    let restored = false;

    const confirmHandler = (message) => {
      const text = normalizeForCompare(message || "");
      const accepted = !text || /(?:supprim|effac|delete)/.test(text);
      appendDebugLog("weda:duplicate-delete-confirm", {
        accepted,
        text: sanitizeDebugString(String(message || ""), 180),
      });

      if (accepted) {
        return true;
      }

      return typeof originalWindowConfirm === "function" ? originalWindowConfirm.call(window, message) : false;
    };

    try {
      window.confirm = confirmHandler;
    } catch (_error) {
      // Certains contextes refusent la réassignation, le clic reste tenté.
    }

    if (pageWindow && pageWindow !== window) {
      try {
        pageWindow.confirm = confirmHandler;
      } catch (_error) {
        // Best effort pour les handlers WEDA exécutés dans unsafeWindow.
      }
    }

    return () => {
      if (restored) {
        return;
      }
      restored = true;

      try {
        window.confirm = originalWindowConfirm;
      } catch (_error) {
        // Rien à restaurer si le contexte refuse.
      }

      if (pageWindow && pageWindow !== window && originalPageConfirm) {
        try {
          pageWindow.confirm = originalPageConfirm;
        } catch (_error) {
          // Best effort.
        }
      }
    };
  }

  function buildWedaMessageListSnapshot() {
    return getBiologyRows()
      .map((item) => [item.index, item.key, item.stableKey, item.date, item.identityLabel].join(":"))
      .join("|");
  }

  function continueAfterStrictDuplicateDeletion() {
    const state = getState();
    if (!state.running || state.phase !== "deletingDuplicate") {
      return;
    }

    markRowSeen(state.currentRowKey || state.currentStableKey);

    if (state.mode === "auto") {
      const nextAutoIndex = findNextAutoRowIndex(state);

      if (nextAutoIndex < 0) {
        finishAutoCycle("Veille auto : doublon strict supprimé, aucun nouveau courrier restant.");
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
        currentAttachmentProcessedUrlKeys: [],
        currentPdfUrl: "",
        currentUrlKey: "",
        allowUnchangedContentKey: "",
        previousContentKey: null,
        currentJobId: null,
        manualTargetKeys: [],
        message: "Doublon strict supprimé : passage au courrier suivant...",
      });

      clickBiologyRow(nextAutoIndex);
      return;
    }

    const rows = getBiologyRows();
    const deletedIndex = Number.isFinite(Number(state.currentIndex)) ? Number(state.currentIndex) : 0;
    const nextIndex = Math.min(Math.max(0, deletedIndex), rows.length - 1);

    if (nextIndex < 0 || !rows.length) {
      resetWedaDuplicatePdfRegistry("manual-finished-after-duplicate-delete");
      setState({
        running: false,
        mode: "manual",
        phase: "done",
        currentJobId: null,
        currentAttachmentProcessedUrlKeys: [],
        manualTargetKeys: [],
        message: "Terminé : doublon strict supprimé, aucun courrier restant.",
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
      currentAttachmentProcessedUrlKeys: [],
      currentPdfUrl: "",
      currentUrlKey: "",
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      message: "Doublon strict supprimé : reprise au courrier suivant...",
    });

    clickBiologyRow(nextIndex);
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

  async function extractDisplayedPdfTextWithRetry(initialDisplayed, waitStartedAt, options = {}) {
    const startedAt = Date.now();
    let displayed = initialDisplayed;
    let lastError = null;
    let attempt = 0;
    const skippedUrlKeys = normalizePdfUrlKeySet(options.excludeUrlKeys || []);

    while (Date.now() - startedAt <= PDF_EMPTY_TEXT_RETRY_MS) {
      abortIfWorkflowStopped();
      attempt += 1;

      try {
        const extractedText = await extractPdfTextFromUrl(displayed.pdfUrl);
        const rawText = typeof extractedText === "string" ? extractedText : extractedText.text || "";
        const pdfTextInfo = buildPdfTextExtractionInfo(rawText, extractedText);
        const documentText = truncateDocumentText(rawText);

        if (documentText && documentText.length >= PDF_MIN_TEXT_LENGTH) {
          const garbledInfo = getGarbledExtractedPdfTextInfo(documentText, pdfTextInfo);
          appendDebugLog("weda:pdf-text-quality", {
            attempt,
            urlKey: displayed.urlKey,
            textLength: garbledInfo.textLength,
            lineCount: garbledInfo.lineCount,
            wordCount: garbledInfo.wordCount,
            wordDensityRatio: garbledInfo.wordDensityRatio,
            privateUseCount: garbledInfo.privateUseCount,
            privateUseRatio: garbledInfo.privateUseRatio,
            replacementCharCount: garbledInfo.replacementCharCount,
            symbolRatio: garbledInfo.symbolRatio,
            commonWordHits: garbledInfo.commonWordHits,
            commonWordOccurrences: garbledInfo.commonWordOccurrences,
            commonWordOccurrenceRatio: garbledInfo.commonWordOccurrenceRatio,
            reason: garbledInfo.reason,
            shouldFallback: garbledInfo.shouldFallback,
          });

          if (garbledInfo.shouldFallback) {
            appendDebugLog("weda:pdf-text-garbled-unusable", {
              attempt,
              urlKey: displayed.urlKey,
              textLength: garbledInfo.textLength,
              lineCount: garbledInfo.lineCount,
              wordCount: garbledInfo.wordCount,
              wordDensityRatio: garbledInfo.wordDensityRatio,
              privateUseCount: garbledInfo.privateUseCount,
              privateUseRatio: garbledInfo.privateUseRatio,
              symbolRatio: garbledInfo.symbolRatio,
              commonWordHits: garbledInfo.commonWordHits,
              commonWordOccurrences: garbledInfo.commonWordOccurrences,
              commonWordOccurrenceRatio: garbledInfo.commonWordOccurrenceRatio,
              reason: garbledInfo.reason,
            });

            return buildPdfImageFallbackOrUnusableDocument(displayed, new Error("texte PDF encodé ou illisible"), {
              reason: "garbled-text",
              garbledInfo,
              pdfTextInfo,
            });
          }

          const sparseInfo = getSparseExtractedPdfTextInfo(documentText, pdfTextInfo);
          if (sparseInfo.shouldFallback) {
            appendDebugLog("weda:pdf-text-sparse-unusable", {
              attempt,
              urlKey: displayed.urlKey,
              textLength: sparseInfo.textLength,
              lineCount: sparseInfo.lineCount,
              wordCount: sparseInfo.wordCount,
              pageCount: sparseInfo.pageCount,
              reason: sparseInfo.reason,
            });

            return buildPdfImageFallbackOrUnusableDocument(displayed, new Error("texte PDF partiel ou trop court"), {
              reason: "sparse-text",
              sparseInfo,
              pdfTextInfo,
            });
          }

          return {
            documentText,
            displayed,
            sourceType: sparseInfo.shouldFallback ? "pdf-text-sparse" : "pdf",
            pdfTextExtractionSparse: Boolean(sparseInfo.shouldFallback),
            pdfTextExtractionGarbled: false,
            pdfTextPageCount: pdfTextInfo.pageCount || 0,
            pdfTextInfo,
          };
        }

        lastError = new Error("texte du PDF vide ou illisible");
      } catch (error) {
        lastError = error;
      }

      const currentUrlKey = displayed.urlKey || getPdfUrlKey(displayed.pdfUrl || "");

      if (isNonAnalyzableAttachmentError(lastError)) {
        skippedUrlKeys.add(currentUrlKey);
        appendDebugLog("weda:non-analyzable-attachment-skipped", {
          attempt,
          urlKey: currentUrlKey,
          error: lastError ? lastError.message : "",
          fetchInfo: lastError && lastError.pdfFetchInfo ? lastError.pdfFetchInfo : null,
        });

        const nextPdfUrl = getDisplayedPdfUrlCandidates({
          includePerformance: true,
          minPerformanceStartTime: waitStartedAt,
          excludeUrlKeys: Array.from(skippedUrlKeys),
        })[0] || "";

        if (!nextPdfUrl) {
          throw lastError;
        }

        displayed = {
          pdfUrl: nextPdfUrl,
          urlKey: getPdfUrlKey(nextPdfUrl),
          selectedOk: displayed.selectedOk,
        };
        continue;
      }

      appendDebugLog("weda:pdf-text-empty-retry", {
        attempt,
        urlKey: currentUrlKey,
        error: lastError ? lastError.message : "",
        pdfInfo: lastError && lastError.pdfInfo ? lastError.pdfInfo : null,
        fetchInfo: lastError && lastError.pdfFetchInfo ? lastError.pdfFetchInfo : null,
        candidateCount: getDisplayedPdfUrlCandidates({
          includePerformance: true,
          minPerformanceStartTime: waitStartedAt,
          excludeUrlKeys: options.excludeUrlKeys || [],
        }).length,
        hasPlugin: Boolean(querySelectorAllDeep(document, PDF_EMBED_SELECTOR).length),
        hasAnyPdfElement: Boolean(getDisplayedPdfEmbed()),
      });

      const messageBodyFallback = buildMessageBodyFallbackFromPdfError(lastError, displayed);
      if (messageBodyFallback) {
        appendDebugLog("weda:pdf-text-empty-message-body-fallback", {
          attempt,
          urlKey: displayed.urlKey,
          bodyLength: messageBodyFallback.documentText.length,
          bodyLines: countBiologyLinesForLog(messageBodyFallback.documentText, "message-body"),
        });
        return messageBodyFallback;
      }

      if (!isRetryablePdfExtractionError(lastError)) {
        throw lastError;
      }

      await sleep(PDF_EMPTY_TEXT_RETRY_INTERVAL_MS);
      const nextPdfCandidates = getDisplayedPdfUrlCandidates({
        includePerformance: true,
        minPerformanceStartTime: waitStartedAt,
        excludeUrlKeys: options.excludeUrlKeys || [],
      });
      const currentStillVisible = nextPdfCandidates
        .some((candidate) => getPdfUrlKey(candidate) === currentUrlKey);
      const nextPdfUrl = !currentStillVisible
        ? nextPdfCandidates.find((candidate) => !skippedUrlKeys.has(getPdfUrlKey(candidate)))
        : displayed.pdfUrl;

      if (nextPdfUrl) {
        displayed = {
          pdfUrl: nextPdfUrl,
          urlKey: getPdfUrlKey(nextPdfUrl),
          selectedOk: displayed.selectedOk,
        };
      }
    }

    return buildPdfImageFallbackOrUnusableDocument(displayed, lastError, {
      reason: "empty-text",
    });
  }

  async function buildPdfImageFallbackOrUnusableDocument(displayed, lastError = null, options = {}) {
    const fallback = await buildPdfImageFallbackFromDisplayedPdf(displayed, lastError, options);

    if (fallback && Array.isArray(fallback.pdfPageImages) && fallback.pdfPageImages.length) {
      return fallback;
    }

    return buildUnusablePdfDocumentFromDisplayedPdf(displayed, lastError, options);
  }

  function buildUnusablePdfDocumentFromDisplayedPdf(displayed, lastError = null, options = {}) {
    const reason = options.reason || "unusable-text";
    const textInfo = options.garbledInfo || options.sparseInfo || options.pdfTextInfo || {};
    const documentText = buildUnusablePdfDocumentText(displayed, lastError, {
      ...options,
      reason,
      textInfo,
    });

    appendDebugLog("weda:pdf-text-unusable-no-lmstudio", {
      urlKey: displayed && displayed.urlKey || "",
      reason,
      error: lastError && lastError.message ? lastError.message : "",
      textLength: Number(textInfo.textLength || 0),
      lineCount: Number(textInfo.lineCount || 0),
      wordCount: Number(textInfo.wordCount || 0),
      wordDensityRatio: Number(textInfo.wordDensityRatio || 0),
      pageCount: Number(textInfo.pageCount || 0),
    });
    setPanelStatus("PDF sans texte exploitable : aucun appel LM Studio, titre de sécurité préparé.");

    return {
      documentText,
      displayed,
      sourceType: "pdf-unusable-text",
      pdfAttachmentBase64: "",
      pdfAttachmentName: buildPdfAttachmentFileName(displayed && displayed.pdfUrl || ""),
      pdfAttachmentMimeType: "application/pdf",
      pdfAttachmentByteLength: Number(textInfo.byteLength || 0),
      pdfTextExtractionEmpty: reason === "empty-text",
      pdfTextExtractionSparse: reason === "sparse-text",
      pdfTextExtractionGarbled: reason === "garbled-text",
      pdfTextUnusable: true,
      pdfUnusableReason: reason,
      pdfPageImages: [],
      pdfImagePageCount: 0,
      pdfImageTotalPages: Number(textInfo.pageCount || 0),
      pdfImageFallbackReason: "",
      pdfTextPageCount: Number(textInfo.pageCount || 0),
      pdfTextInfo: textInfo,
    };
  }

  function buildUnusablePdfDocumentText(displayed, lastError = null, options = {}) {
    const textInfo = options.textInfo || {};
    return normalizePdfText([
      UNUSABLE_PDF_TITLE,
      "Le texte extrait du PDF est inexploitable pour une analyse automatique fiable.",
      `Cause : ${formatUnusablePdfReason(options.reason || "unusable-text")}.`,
      `Identifiant PDF local : ${displayed && displayed.urlKey || "pdfurl-" + hashString(displayed && displayed.pdfUrl || "")}.`,
      Number(textInfo.textLength || 0) ? `Texte extrait rejeté : ${textInfo.textLength} caractères, ${textInfo.lineCount || 0} lignes, ${textInfo.wordCount || 0} mots.` : "",
      lastError && lastError.message ? `Erreur : ${lastError.message}.` : "",
    ].filter(Boolean).join("\n"));
  }

  function formatUnusablePdfReason(reason = "") {
    const labels = {
      "empty-text": "aucun texte extractible",
      "garbled-text": "texte encodé ou illisible",
      "sparse-text": "texte trop court ou probablement partiel",
      "unusable-text": "texte inexploitable",
    };

    return labels[reason] || labels["unusable-text"];
  }

  async function buildPdfImageFallbackFromDisplayedPdf(displayed, lastError = null, options = {}) {
    if (!LMSTUDIO_PDF_IMAGE_FALLBACK_ENABLED || !displayed || !displayed.pdfUrl) {
      return null;
    }

    const reason = options.reason || "empty-text";
    const sparseInfo = options.sparseInfo || null;
    const garbledInfo = options.garbledInfo || null;
    appendDebugLog("weda:pdf-image-fallback-start", {
      urlKey: displayed.urlKey || "",
      error: lastError && lastError.message ? lastError.message : "",
      reason,
      maxPages: LMSTUDIO_PDF_IMAGE_MAX_PAGES,
      scale: LMSTUDIO_PDF_IMAGE_SCALE,
      sparseInfo,
      garbledInfo,
    });
    setPanelStatus("PDF sans texte exploitable : préparation des pages en images pour LM Studio...");

    try {
      const rendered = await renderPdfPageImagesFromUrl(displayed.pdfUrl);
      if (!rendered.images.length) {
        appendDebugLog("weda:pdf-image-fallback-empty", {
          urlKey: displayed.urlKey || "",
          totalPages: rendered.totalPages || 0,
          byteLength: rendered.byteLength || 0,
        });
        return null;
      }

      const documentText = buildPdfImageFallbackDocumentText(displayed, rendered, lastError, {
        reason,
        sparseInfo,
        garbledInfo,
      });
      appendDebugLog("weda:pdf-image-fallback-ready", {
        urlKey: displayed.urlKey || "",
        reason,
        totalPages: rendered.totalPages,
        renderedPages: rendered.images.map((image) => image.pageNumber),
        renderers: Array.from(new Set(rendered.images.map((image) => image.renderer).filter(Boolean))),
        imageCount: rendered.images.length,
        totalDataUrlLength: rendered.totalDataUrlLength,
        byteLength: rendered.byteLength || 0,
      });

      return {
        documentText,
        displayed,
        sourceType: "pdf-image",
        pdfAttachmentBase64: "",
        pdfAttachmentName: buildPdfAttachmentFileName(displayed.pdfUrl || ""),
        pdfAttachmentMimeType: "application/pdf",
        pdfAttachmentByteLength: rendered.byteLength || 0,
        pdfTextExtractionEmpty: reason === "empty-text",
        pdfTextExtractionSparse: reason === "sparse-text" || Boolean(sparseInfo),
        pdfTextExtractionGarbled: reason === "garbled-text" || Boolean(options.garbledInfo),
        pdfImageFallbackUsed: true,
        pdfImageFallbackReason: reason,
        pdfPageImages: rendered.images,
        pdfImagePageCount: rendered.images.length,
        pdfImageTotalPages: rendered.totalPages,
        pdfTextPageCount: rendered.totalPages || 0,
      };
    } catch (error) {
      appendDebugLog("weda:pdf-image-fallback-error", {
        urlKey: displayed.urlKey || "",
        error: error && error.message ? error.message : String(error),
      });
      return null;
    }
  }

  async function renderPdfPageImagesFromUrl(pdfUrl) {
    await ensurePdfJsReady();
    abortIfWorkflowStopped();

    const bytes = await fetchPdfBytes(pdfUrl);
    const originalBytes = new Uint8Array(bytes);
    abortIfWorkflowStopped();

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(originalBytes),
      disableFontFace: true,
      useSystemFonts: true,
    }).promise;

    const images = [];
    let totalDataUrlLength = 0;
    const totalPages = pdf.numPages || 0;

    try {
      const pageNumbers = getPdfImageFallbackPageNumbers(totalPages);

      for (const pageNumber of pageNumbers) {
        abortIfWorkflowStopped();
        const image = await renderPdfPageToImageDataUrl(pdf, pageNumber);
        const nextTotal = totalDataUrlLength + image.dataUrl.length;

        if (images.length && nextTotal > LMSTUDIO_PDF_IMAGE_MAX_TOTAL_DATA_URL_LENGTH) {
          appendDebugLog("weda:pdf-image-fallback-page-skipped-size", {
            pageNumber,
            dataUrlLength: image.dataUrl.length,
            totalDataUrlLength,
            maxTotalDataUrlLength: LMSTUDIO_PDF_IMAGE_MAX_TOTAL_DATA_URL_LENGTH,
          });
          break;
        }

        images.push(image);
        totalDataUrlLength = nextTotal;
      }
    } finally {
      if (pdf && typeof pdf.destroy === "function") {
        try {
          await pdf.destroy();
        } catch (_error) {
          // La mémoire canvas/PDF sera quand même relâchée par le navigateur.
        }
      }
    }

    return {
      images,
      totalPages,
      byteLength: originalBytes.length,
      totalDataUrlLength,
    };
  }

  function getPdfImageFallbackPageNumbers(totalPages) {
    const count = Math.max(0, Number(totalPages) || 0);
    const maxPages = Math.max(1, Number(LMSTUDIO_PDF_IMAGE_MAX_PAGES) || 1);

    if (count <= maxPages) {
      return Array.from({ length: count }, (_value, index) => index + 1);
    }

    const headCount = Math.max(1, maxPages - 1);
    const pages = Array.from({ length: headCount }, (_value, index) => index + 1);
    pages.push(count);
    return Array.from(new Set(pages)).slice(0, maxPages);
  }

  async function renderPdfPageToImageDataUrl(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const scale = getPdfImageFallbackScale(page);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    let renderer = "dom-canvas";
    let canvas = null;

    if (typeof OffscreenCanvas === "function") {
      try {
        canvas = new OffscreenCanvas(width, height);
        renderer = "offscreen-canvas";
      } catch (_error) {
        canvas = null;
      }
    }

    if (!canvas) {
      canvas = document.createElement("canvas");
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("canvas 2D indisponible pour convertir le PDF en image");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({
      canvasContext: context,
      viewport,
      background: "white",
    }).promise;

    const dataUrl = await convertPdfCanvasToDataUrl(
      canvas,
      LMSTUDIO_PDF_IMAGE_MIME_TYPE,
      LMSTUDIO_PDF_IMAGE_QUALITY
    );

    try {
      page.cleanup();
    } catch (_error) {
      // Best effort : le canvas est vidé juste après.
    }

    canvas.width = 1;
    canvas.height = 1;

    return {
      pageNumber,
      dataUrl,
      mimeType: LMSTUDIO_PDF_IMAGE_MIME_TYPE,
      width,
      height,
      renderer,
      dataUrlLength: dataUrl.length,
    };
  }

  async function convertPdfCanvasToDataUrl(canvas, mimeType, quality) {
    if (canvas && typeof canvas.convertToBlob === "function") {
      const blob = await canvas.convertToBlob({ type: mimeType, quality });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return `data:${blob.type || mimeType};base64,${uint8ArrayToBase64(bytes)}`;
    }

    if (canvas && typeof canvas.toDataURL === "function") {
      return canvas.toDataURL(mimeType, quality);
    }

    throw new Error("conversion du canvas PDF en image indisponible");
  }

  function getPdfImageFallbackScale(page) {
    const baseScale = Number(LMSTUDIO_PDF_IMAGE_SCALE) || 1.5;
    const maxSide = Number(LMSTUDIO_PDF_IMAGE_MAX_SIDE_PX) || 1800;
    const baseViewport = page.getViewport({ scale: baseScale });
    const largestSide = Math.max(baseViewport.width || 0, baseViewport.height || 0);

    if (!largestSide || largestSide <= maxSide) {
      return baseScale;
    }

    return Math.max(0.5, baseScale * (maxSide / largestSide));
  }

  function buildPdfImageFallbackDocumentText(displayed, rendered, lastError = null, options = {}) {
    const renderedPages = rendered.images.map((image) => image.pageNumber).join(", ");
    const omittedPages = rendered.totalPages > rendered.images.length
      ? `Pages non jointes au modèle pour limiter la taille : ${rendered.totalPages - rendered.images.length}.`
      : "";
    const reason = options.reason || "empty-text";
    const sparseInfo = options.sparseInfo || null;
    const garbledInfo = options.garbledInfo || null;
    const sparseLine = sparseInfo
      ? `Texte extrait ignoré car probablement partiel : ${sparseInfo.textLength} caractères, ${sparseInfo.lineCount} lignes, ${sparseInfo.wordCount} mots.`
      : "";
    const garbledLine = garbledInfo
      ? `Texte extrait ignoré car probablement encodé/illisible : ${garbledInfo.textLength} caractères, ${garbledInfo.privateUseCount} caractères privés, ratio symboles ${Math.round(garbledInfo.symbolRatio * 1000) / 10} %.`
      : "";

    return normalizePdfText([
      reason === "sparse-text"
        ? "PDF avec texte extractible trop court ou partiel : le courrier est transmis à LM Studio sous forme d'images de pages."
        : reason === "garbled-text"
          ? "PDF avec texte extractible encodé ou illisible : le courrier est transmis à LM Studio sous forme d'images de pages."
          : "PDF sans texte extractible par PDF.js : le courrier est transmis à LM Studio sous forme d'images de pages.",
      "Le modèle doit analyser visuellement ces images comme un OCR médical, sans inventer ce qui n'est pas lisible.",
      `Identifiant PDF local : ${displayed.urlKey || "pdfurl-" + hashString(displayed.pdfUrl || "")}.`,
      `Pages jointes en images : ${renderedPages || "aucune"}/${rendered.totalPages || "?"}.`,
      sparseLine,
      garbledLine,
      omittedPages,
      lastError && lastError.message ? `Cause du fallback texte : ${lastError.message}.` : "",
    ].filter(Boolean).join("\n"));
  }

  function buildPdfTextExtractionInfo(text, pdfInfo = {}) {
    const normalized = normalizePdfText(text);
    return {
      textLength: normalized.length,
      lineCount: normalized ? normalized.split(/\n+/).filter(Boolean).length : 0,
      wordCount: countWordsForPdfSparseCheck(normalized),
      pageCount: Number(pdfInfo && pdfInfo.pageCount) || 0,
      byteLength: Number(pdfInfo && pdfInfo.byteLength) || 0,
    };
  }

  function getGarbledExtractedPdfTextInfo(text, pdfInfo = {}) {
    const info = buildPdfTextExtractionInfo(text, pdfInfo);
    const source = String(text || "");
    const enabled = Boolean(LMSTUDIO_PDF_TEXT_GARBLED_FALLBACK_ENABLED);
    const privateUseCount = countPdfPrivateUseCharacters(source);
    const privateUseRatio = info.textLength ? privateUseCount / info.textLength : 0;
    const replacementCharCount = countRegexMatches(source, /\uFFFD/g);
    const symbolCount = countPdfGarbledSymbolCharacters(source);
    const symbolRatio = info.textLength ? symbolCount / info.textLength : 0;
    const commonWordHits = countPdfCommonFrenchWordHits(source);
    const commonWordOccurrences = countPdfCommonFrenchWordOccurrences(source);
    const commonWordOccurrenceRatio = info.wordCount ? commonWordOccurrences / info.wordCount : 0;
    const wordDensityRatio = info.textLength ? info.wordCount / info.textLength : 0;
    let reason = "";

    if (enabled && info.pageCount > 0 && info.textLength >= PDF_MIN_TEXT_LENGTH) {
      if (
        privateUseCount >= LMSTUDIO_PDF_TEXT_GARBLED_PRIVATE_USE_MIN_CHARS ||
        privateUseRatio >= LMSTUDIO_PDF_TEXT_GARBLED_PRIVATE_USE_MIN_RATIO
      ) {
        reason = "private-use-glyphs";
      } else if (replacementCharCount >= 3) {
        reason = "replacement-characters";
      } else if (
        info.textLength >= LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MIN_CHARS &&
        wordDensityRatio <= LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MAX_RATIO &&
        symbolRatio >= LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MIN_SYMBOL_RATIO &&
        commonWordOccurrences <= LMSTUDIO_PDF_TEXT_GARBLED_LOW_WORD_DENSITY_MAX_COMMON_WORD_OCCURRENCES
      ) {
        reason = "low-word-density-symbol-text";
      } else if (
        info.wordCount >= LMSTUDIO_PDF_TEXT_GARBLED_MIN_WORDS_FOR_LANGUAGE_CHECK &&
        symbolRatio >= LMSTUDIO_PDF_TEXT_GARBLED_SYMBOL_MIN_RATIO &&
        commonWordHits < LMSTUDIO_PDF_TEXT_GARBLED_MIN_COMMON_WORD_HITS
      ) {
        reason = "high-symbol-low-language-text";
      } else if (
        info.textLength >= LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MIN_CHARS &&
        info.wordCount >= LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MIN_WORDS &&
        commonWordOccurrences < LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MIN_COMMON_WORD_OCCURRENCES &&
        commonWordOccurrenceRatio < LMSTUDIO_PDF_TEXT_GARBLED_LONG_TEXT_MAX_COMMON_WORD_RATIO
      ) {
        reason = "long-low-language-text";
      }
    }

    return {
      ...info,
      privateUseCount,
      privateUseRatio,
      replacementCharCount,
      symbolCount,
      symbolRatio,
      commonWordHits,
      commonWordOccurrences,
      commonWordOccurrenceRatio,
      wordDensityRatio,
      reason,
      shouldFallback: Boolean(reason),
    };
  }

  function countPdfPrivateUseCharacters(text = "") {
    return countRegexMatches(String(text || ""), /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu);
  }

  function countPdfGarbledSymbolCharacters(text = "") {
    return countRegexMatches(String(text || ""), /[^\p{L}\p{N}\s.,;:!?%/()+\-'"’°²³µ=<>]/gu);
  }

  function countPdfCommonFrenchWordHits(text = "") {
    const words = new Set(normalizeForCompare(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 2));
    return getPdfCommonFrenchWords().filter((word) => words.has(word)).length;
  }

  function countPdfCommonFrenchWordOccurrences(text = "") {
    const words = normalizeForCompare(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 2);
    const commonWords = new Set(getPdfCommonFrenchWords());
    return words.filter((word) => commonWords.has(word)).length;
  }

  function getPdfCommonFrenchWords() {
    return [
      "de", "du", "des", "le", "la", "les", "un", "une", "et", "est", "avec", "pour",
      "dans", "sur", "par", "pas", "sans", "patient", "patiente", "monsieur", "madame",
      "docteur", "medecin", "medical", "compte", "rendu", "consultation", "examen",
      "traitement", "douleur", "diagnostic", "conclusion", "arthrose", "radiographie",
      "scanner", "irm", "genou", "hanche", "rachis", "lombaire", "cervical", "thoracique",
      "pulmonaire", "prostate", "suspicion",
    ];
  }

  function countRegexMatches(text = "", pattern) {
    const matches = String(text || "").match(pattern);
    return matches ? matches.length : 0;
  }

  function getSparseExtractedPdfTextInfo(text, pdfInfo = {}) {
    const info = buildPdfTextExtractionInfo(text, pdfInfo);
    const enabled = Boolean(LMSTUDIO_PDF_TEXT_SPARSE_FALLBACK_ENABLED);
    let reason = "";

    if (enabled && info.pageCount > 0) {
      if (info.textLength < PDF_MIN_TEXT_LENGTH) {
        reason = "below-min-text-length";
      } else if (info.textLength < 260) {
        reason = "very-short-text";
      } else if (
        info.textLength <= LMSTUDIO_PDF_TEXT_SPARSE_MAX_CHARS &&
        info.lineCount <= LMSTUDIO_PDF_TEXT_SPARSE_MAX_LINES &&
        info.wordCount <= LMSTUDIO_PDF_TEXT_SPARSE_MAX_WORDS
      ) {
        reason = "short-low-density-text";
      }
    }

    return {
      ...info,
      reason,
      shouldFallback: Boolean(reason),
    };
  }

  function countWordsForPdfSparseCheck(text) {
    const matches = normalizePdfText(text).match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]{2,}/g);
    return matches ? matches.length : 0;
  }

  function buildMessageBodyFallbackFromPdfError(error, displayed) {
    const hasAnalyzableAttachment = hasDisplayedAnalyzableAttachment();
    if ((displayed && displayed.pdfUrl) || hasAnalyzableAttachment) {
      appendDebugLog("weda:pdf-text-empty-message-body-blocked-attachment", {
        urlKey: displayed && displayed.urlKey ? displayed.urlKey : "",
        hasDisplayedPdfUrl: Boolean(displayed && displayed.pdfUrl),
        hasAnalyzableAttachment,
        error: error && error.message ? error.message : "",
      });
      return null;
    }

    const bodyText = extractWedaMessageBodyFallbackText();

    if (!bodyText) {
      appendDebugLog("weda:pdf-text-empty-message-body-missing", {
        urlKey: displayed && displayed.urlKey ? displayed.urlKey : "",
        error: error && error.message ? error.message : "",
        selector: MESSAGE_BODY_TEXT_SELECTOR,
        bodyCandidates: document.querySelectorAll(MESSAGE_BODY_TEXT_SELECTOR).length,
      });
      return null;
    }

    return {
      documentText: truncateDocumentText(bodyText),
      displayed,
      sourceType: "message-body",
      pdfAttachmentBase64: "",
      pdfAttachmentName: "",
      pdfAttachmentMimeType: "",
      pdfAttachmentByteLength: 0,
      pdfTextExtractionEmpty: false,
      pdfTextFallbackUsed: true,
    };
  }

  function buildDisplayedBiologyDocumentFromMessageBody(logEvent, options = {}) {
    const item = options.item || null;
    const error = options.error || null;

    if (hasDisplayedAnalyzableAttachment()) {
      appendDebugLog("weda:pdf-missing-message-body-blocked-attachment", {
        error: error && error.message ? error.message : "",
        rowIndex: item ? item.index : null,
        hasAnalyzableAttachment: true,
      });
      return null;
    }

    const bodyText = extractWedaMessageBodyFallbackText();
    const selectedOk = item && item.row && (
      item.row.classList.contains("selected") ||
      getSelectedBiologyIndex() === item.index
    );

    if (!bodyText) {
      appendDebugLog("weda:pdf-missing-message-body-missing", {
        error: error && error.message ? error.message : "",
        rowIndex: item ? item.index : null,
        selector: MESSAGE_BODY_TEXT_SELECTOR,
        bodyCandidates: document.querySelectorAll(MESSAGE_BODY_TEXT_SELECTOR).length,
      });
      return null;
    }

    if (item && !selectedOk) {
      appendDebugLog("weda:pdf-missing-message-body-ignored", {
        error: error && error.message ? error.message : "",
        rowIndex: item.index,
        selectedIndex: getSelectedBiologyIndex(),
        bodyLength: bodyText.length,
      });
      return null;
    }

    const documentText = truncateDocumentText(bodyText);
    const urlKey = "messagebody-" + hashString(documentText);

    appendDebugLog(logEvent || "weda:message-body-fallback", {
      rowIndex: item ? item.index : null,
      bodyLength: documentText.length,
      bodyLines: countBiologyLinesForLog(documentText, "message-body"),
      selector: MESSAGE_BODY_TEXT_SELECTOR,
      bodyCandidates: document.querySelectorAll(MESSAGE_BODY_TEXT_SELECTOR).length,
    });

    return {
      table: null,
      tableText: documentText,
      tableHtml: "",
      contentKey: getDisplayedBiologyContentKey(documentText, "message-body"),
      sourceType: "message-body",
      pdfUrl: "",
      urlKey,
      pdfAttachmentBase64: "",
      pdfAttachmentName: "",
      pdfAttachmentMimeType: "",
      pdfAttachmentByteLength: 0,
      pdfTextExtractionEmpty: false,
    };
  }

  function extractWedaMessageBodyFallbackText() {
    const candidates = Array.from(document.querySelectorAll(MESSAGE_BODY_TEXT_SELECTOR))
      .map((element) => normalizePdfText(element.innerText || element.textContent || ""))
      .filter(isUsableWedaMessageBodyFallbackText)
      .sort((left, right) => right.length - left.length);

    return candidates[0] || "";
  }

  function isUsableWedaMessageBodyFallbackText(text) {
    const normalized = normalizePdfText(text);
    const comparable = normalizeForCompare(normalized);

    if (!normalized || normalized.length < PDF_MIN_TEXT_LENGTH) {
      return false;
    }

    if (!/[a-zA-ZÀ-ÖØ-öø-ÿ0-9]/.test(normalized)) {
      return false;
    }

    if (/^(?:x+|test|aucun|vide|na|n\/a|ras)$/i.test(comparable)) {
      return false;
    }

    return true;
  }

  function buildPdfAttachmentFileName(pdfUrl = "") {
    return "weda-courrier-" + hashString(pdfUrl || Date.now()) + ".pdf";
  }

  function isRetryablePdfExtractionError(error) {
    if (isNonAnalyzableAttachmentError(error)) {
      return false;
    }

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
      throw error;
    }

    return {
      text,
      pageCount: pdf.numPages || 0,
      byteLength: originalBytes.length,
      fetchInfo: pdfFetchInfo,
      urlKey: "pdfurl-" + hashString(pdfUrl),
    };
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
        if (isNonAnalyzableAttachmentError(error)) {
          throw error;
        }
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
          if (isNonAnalyzableAttachmentError(error)) {
            throw error;
          }
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
        if (isNonAnalyzableAttachmentError(error)) {
          throw error;
        }
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

    if (isNonAnalyzablePdfFetchInfo(bytes.pdfFetchInfo)) {
      throw createNonAnalyzableAttachmentError("archive compressée", bytes.pdfFetchInfo);
    }

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

  function createNonAnalyzableAttachmentError(reason = "pièce jointe non analysable", fetchInfo = {}) {
    const error = createPdfFetchError("pièce jointe ignorée : " + reason, fetchInfo);
    error.nonAnalyzableAttachment = true;
    return error;
  }

  function isNonAnalyzablePdfFetchInfo(fetchInfo = {}) {
    const header = String(fetchInfo.header || "");
    const contentType = String(fetchInfo.contentType || "");
    return /^PK(?:\.|\x03|\x05|\x07)/.test(header) ||
      /\bapplication\/(?:zip|x-zip-compressed|x-7z-compressed|x-rar-compressed)\b/i.test(contentType);
  }

  function isNonAnalyzableAttachmentError(error) {
    const message = String(error && error.message || "");
    return Boolean(error && error.nonAnalyzableAttachment) ||
      /pi[eè]ce jointe ignor[eé]e|archive compress[eé]e/i.test(message);
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

  function truncateResultSourceText(value) {
    const text = normalizePdfText(value);

    if (text.length <= MAX_RESULT_SOURCE_TEXT_LENGTH) {
      return text;
    }

    const headLength = Math.floor(MAX_RESULT_SOURCE_TEXT_LENGTH * 0.7);
    const tailLength = MAX_RESULT_SOURCE_TEXT_LENGTH - headLength;
    return normalizePdfText(
      text.slice(0, headLength) +
      "\n\n[Document tronqué par le script : début et fin conservés pour la spécialité.]\n\n" +
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
        window.setTimeout(() => applyRememberedDocumentFieldsForSelectedRow({ autoSave: true }), 1500);
      }, true);
    }

    if (!titleAutofillInterval) {
      titleAutofillInterval = window.setInterval(() => {
        applyRememberedDocumentFieldsForSelectedRow({ autoSave: true, silent: true, enforcePriority: true });
      }, TITLE_PRIORITY_WATCH_INTERVAL_MS);
    }

    const container = document.querySelector("#messageContainer") || document.body;
    setupWedaTitleManualEditTracking(container);
    setupWedaSpecialtyManualEditTracking(container);

    if (!container || typeof MutationObserver === "undefined") {
      return;
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => applyRememberedDocumentFieldsForSelectedRow({ autoSave: true }), 500);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });
  }

  function setupManualArchiveNextNavigation() {
    if (document.__wbhManualArchiveNextNavigation) {
      return;
    }
    document.__wbhManualArchiveNextNavigation = true;

    document.addEventListener("click", (event) => {
      const state = getState();
      if (state.running) {
        return;
      }

      const archiveControl = findManualArchiveCourierControlFromTarget(event.target);
      if (!archiveControl) {
        return;
      }

      scheduleManualArchiveNextNavigation(archiveControl);
    }, true);
  }

  function findManualArchiveCourierControlFromTarget(target) {
    let element = target && target.nodeType === 1 ? target : target && target.parentElement;
    const candidates = [];

    while (element && element !== document.body) {
      if (isManualArchiveClickableCandidate(element)) {
        candidates.push(element);
      }
      element = element.parentElement;
    }

    return candidates.find(isManualArchiveCourierControl) || null;
  }

  function isManualArchiveClickableCandidate(element) {
    if (!element || typeof element.matches !== "function") {
      return false;
    }

    try {
      return element.matches("button, a, [role='button'], [onclick], .btnImport, .targetSupprimer, input[type='button'], input[type='submit']");
    } catch (_error) {
      return false;
    }
  }

  function isManualArchiveCourierControl(element) {
    if (!element || !isElementVisible(element) || !(element.closest && element.closest("#messageContainer"))) {
      return false;
    }

    const descriptor = normalizeForCompare(getManualArchiveControlDescriptor(element));
    if (!descriptor || !/\barchiv\w*\b/.test(descriptor)) {
      return false;
    }

    return !/(?:desarchiv|desarchiv|supprim|delete|effac|patient|antecedent|ant[eé]c[eé]dent)/.test(descriptor);
  }

  function getManualArchiveControlDescriptor(element) {
    if (!element) {
      return "";
    }

    const values = [
      element.textContent || "",
      element.getAttribute("value") || "",
      element.getAttribute("title") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("id") || "",
      element.getAttribute("class") || "",
      element.getAttribute("href") || "",
      element.getAttribute("onclick") || "",
    ];

    Array.from(element.querySelectorAll ? element.querySelectorAll("img, svg, use") : [])
      .forEach((child) => {
        values.push(
          child.getAttribute("title") || "",
          child.getAttribute("alt") || "",
          child.getAttribute("aria-label") || "",
          child.getAttribute("src") || "",
          child.getAttribute("href") || "",
          child.getAttribute("xlink:href") || "",
          child.getAttribute("class") || ""
        );
      });

    return normalizeText(values.filter(Boolean).join(" "));
  }

  function scheduleManualArchiveNextNavigation(archiveControl) {
    const item = getStrictSelectedBiologyItem() || getSelectedBiologyItem();
    const rows = getBiologyRows();

    if (!item || !rows.length) {
      return;
    }

    const snapshot = {
      index: item.index,
      key: item.key || "",
      stableKey: item.stableKey || "",
      rowCount: rows.length,
      contentKey: getDisplayedBiologyContentKey(),
    };

    appendDebugLog("weda:manual-archive-next-scheduled", {
      rowIndex: snapshot.index,
      rowStableKey: snapshot.stableKey,
      rowCount: snapshot.rowCount,
      control: archiveControl,
    });

    window.clearTimeout(manualArchiveNextTimer);
    manualArchiveNextTimer = window.setTimeout(() => {
      advanceToNextRowAfterManualArchive(snapshot).catch((error) => {
        appendDebugLog("weda:manual-archive-next-error", {
          rowIndex: snapshot.index,
          rowStableKey: snapshot.stableKey,
          error: error && error.message ? error.message : String(error),
        });
      });
    }, MANUAL_ARCHIVE_NEXT_SETTLE_MS);
  }

  async function advanceToNextRowAfterManualArchive(snapshot) {
    if (getState().running) {
      return;
    }

    const change = await waitForManualArchiveListChange(snapshot);
    if (!change.changed || getState().running) {
      appendDebugLog("weda:manual-archive-next-skip", {
        reason: change.changed ? "workflow-started" : "list-unchanged",
        rowIndex: snapshot.index,
        rowStableKey: snapshot.stableKey,
        rowCount: change.rows.length,
      });
      return;
    }

    const snapshotRowStillPresent = Boolean(findManualArchiveSnapshotRow(snapshot, change.rows));
    const selectedIndex = change.rows.length < snapshot.rowCount || !snapshotRowStillPresent
      ? -1
      : change.selectedIndex;
    const nextIndex = findNextManualArchiveRowIndex(snapshot, change.rows, selectedIndex);
    if (nextIndex < 0) {
      appendDebugLog("weda:manual-archive-next-none", {
        rowIndex: snapshot.index,
        rowStableKey: snapshot.stableKey,
        rowCount: change.rows.length,
      });
      return;
    }

    const nextRow = change.rows[nextIndex];
    appendDebugLog("weda:manual-archive-next-click", {
      archivedRowIndex: snapshot.index,
      archivedRowStableKey: snapshot.stableKey,
      nextIndex,
      nextStableKey: nextRow ? nextRow.stableKey : "",
      rowCount: change.rows.length,
    });

    triggerWedaBiologyRowOpen(nextRow, "manual-archive-next");
    window.setTimeout(() => {
      applyRememberedDocumentFieldsForSelectedRow({ autoSave: true, silent: true });
    }, 1500);
  }

  async function waitForManualArchiveListChange(snapshot) {
    const startedAt = Date.now();
    let rows = getBiologyRows();
    let selectedIndex = getSelectedBiologyIndex();

    while (Date.now() - startedAt < MANUAL_ARCHIVE_NEXT_MAX_WAIT_MS) {
      rows = getBiologyRows();
      selectedIndex = getSelectedBiologyIndex();

      const snapshotRow = findManualArchiveSnapshotRow(snapshot, rows);
      const changed = rows.length < snapshot.rowCount ||
        !snapshotRow ||
        (selectedIndex >= 0 && selectedIndex !== snapshot.index);

      if (changed) {
        return {
          changed: true,
          rows,
          selectedIndex,
        };
      }

      await sleep(250);
    }

    return {
      changed: false,
      rows,
      selectedIndex,
    };
  }

  function findManualArchiveSnapshotRow(snapshot, rows = getBiologyRows()) {
    return rows.find((row) => (
      (snapshot.key && row.key && row.key === snapshot.key) ||
      (snapshot.stableKey && row.stableKey && row.stableKey === snapshot.stableKey && Number(row.index) === Number(snapshot.index))
    )) || null;
  }

  function findNextManualArchiveRowIndex(snapshot, rows = getBiologyRows(), selectedIndex = -1) {
    if (!rows.length) {
      return -1;
    }

    if (selectedIndex >= 0 && rows[selectedIndex]) {
      return selectedIndex;
    }

    const previousIndex = Number.isFinite(Number(snapshot.index)) ? Number(snapshot.index) : 0;
    return Math.min(Math.max(0, previousIndex), rows.length - 1);
  }

  async function applyRememberedDocumentFieldsForSelectedRow(options = {}) {
    await applyRememberedPatientForSelectedRow(options);
    await sleep(80);
    await applyRememberedTitleForSelectedRow(options);
    await sleep(80);
    return applyRememberedSpecialtyForSelectedRow(options);
  }

  async function applyRememberedPatientForSelectedRow(options = {}) {
    const state = getState();
    if (state.running || rememberedPatientAutofillInProgress) {
      return false;
    }

    const item = getStrictSelectedBiologyItem() || getSelectedBiologyItem();
    if (!item || !isDisplayedBiologyForRow(item)) {
      return false;
    }

    const pdfUrl = getDisplayedPdfUrl();
    const urlKey = getPdfUrlKey(pdfUrl);
    const rememberedPatient = getRememberedWedaPatientForOptions({
      row: item,
      rowStableKey: item.stableKey,
      urlKey,
      pdfUrl,
    });

    if (!rememberedPatient) {
      return false;
    }

    const identityHintText = buildWedaRememberedPatientIdentityHintText(rememberedPatient.identity);
    const hasFindPatientPanel = Boolean(findWedaFindPatientPanel());
    const hasTitleInput = Boolean(findWedaTitleInput({ pdfUrl }));
    const patientButton = findImportPatientButton();

    if (!hasFindPatientPanel && hasTitleInput) {
      touchRememberedPatientKeys(rememberedPatient.keys);
      return false;
    }

    if (!hasFindPatientPanel && !patientButton) {
      if (!options.silent) {
        appendDebugLog("weda:remembered-patient-autofill-skip-no-entrypoint", {
          rowIndex: item.index,
          rowStableKey: item.stableKey,
          rememberedKey: rememberedPatient.key,
          hasTitleInput,
          hasPatientButton: false,
        });
      }
      return false;
    }

    rememberedPatientAutofillInProgress = true;
    appendDebugLog("weda:remembered-patient-autofill-start", {
      rowIndex: item.index,
      rowStableKey: item.stableKey,
      rememberedKey: rememberedPatient.key,
      hasBirthDate: Boolean(rememberedPatient.identity && rememberedPatient.identity.birthDate),
      hasFindPatientPanel,
      hasPatientButton: Boolean(patientButton),
      hasTitleInput,
      source: rememberedPatient.entry && rememberedPatient.entry.source || "",
    });

    try {
      let input = null;

      if (!hasFindPatientPanel) {
        appendDebugLog("weda:remembered-patient-import-open", {
          rowIndex: item.index,
          rowStableKey: item.stableKey,
          rememberedKey: rememberedPatient.key,
          hasPatientButton: Boolean(patientButton),
        });
        input = await openPatientImportForCurrentMessage("", "remembered-patient-autofill", {
          ...options,
          row: item,
          rowStableKey: item.stableKey,
          urlKey,
          pdfUrl,
          patientIdentityText: identityHintText,
        });
      }

      if (findWedaFindPatientPanel()) {
        input = await rescueWedaFindPatientPanelWithDocumentIdentity({
          ...options,
          reason: "remembered-patient-autofill",
          row: item,
          rowStableKey: item.stableKey,
          urlKey,
          pdfUrl,
          patientIdentityText: identityHintText,
        });
      }

      input = input || findWedaTitleInput({ pdfUrl });

      if (input) {
        touchRememberedPatientKeys(rememberedPatient.keys);
      }

      appendDebugLog("weda:remembered-patient-autofill-done", {
        rowIndex: item.index,
        rowStableKey: item.stableKey,
        rememberedKey: rememberedPatient.key,
        applied: Boolean(input),
        hasFindPatientPanel: Boolean(findWedaFindPatientPanel()),
        hasTitleInput: Boolean(input),
      });
      return Boolean(input);
    } catch (error) {
      appendDebugLog("weda:remembered-patient-autofill-error", {
        rowIndex: item.index,
        rowStableKey: item.stableKey,
        rememberedKey: rememberedPatient.key,
        error: error && error.message ? error.message : String(error),
      });
      return false;
    } finally {
      rememberedPatientAutofillInProgress = false;
    }
  }

  function buildWedaRememberedPatientIdentityHintText(identity = {}) {
    const normalizedIdentity = normalizeWedaFindPatientIdentity(identity);
    return normalizeMultilineText([
      normalizedIdentity.searchLabel ? `Patient: ${normalizedIdentity.searchLabel}` : "",
      normalizedIdentity.birthDate ? `Date de naissance: ${normalizedIdentity.birthDate}` : "",
    ].filter(Boolean).join("\n"));
  }

  function setupWedaSpecialtyManualEditTracking(container) {
    if (!container || container.__wbhSpecialtyManualEditTracking) {
      return;
    }

    try {
      container.__wbhSpecialtyManualEditTracking = true;
    } catch (_error) {
      // La protection anti-double listener reste best effort.
    }

    ["change", "input"].forEach((eventName) => {
      container.addEventListener(eventName, handleWedaSpecialtyManualEditEvent, true);
    });
  }

  function handleWedaSpecialtyManualEditEvent(event) {
    if (!event || event.isTrusted === false) {
      return;
    }

    const select = getWedaSpecialtySelectFromEvent(event);
    if (!select) {
      return;
    }

    rememberManualEditedWedaSpecialty(select, event.type);
  }

  function getWedaSpecialtySelectFromEvent(event) {
    const target = event && event.target;
    if (isWedaSpecialtySelectElement(target)) {
      return target;
    }

    if (target && typeof target.closest === "function") {
      const closest = target.closest("select");
      return isWedaSpecialtySelectElement(closest) ? closest : null;
    }

    return null;
  }

  function isWedaSpecialtySelectElement(element) {
    if (!element || String(element.tagName || "").toLowerCase() !== "select") {
      return false;
    }

    const bestSelect = findWedaSpecialtySelect({
      titleInput: findWedaTitleInput(),
      pdfUrl: getDisplayedPdfUrl(),
    });

    if (bestSelect === element) {
      return true;
    }

    const optionText = Array.from(element.options || [])
      .map((option) => option.textContent || option.label || option.value || "")
      .join(" ");
    const descriptor = normalizeSpecialtyLabel([
      element.getAttribute("title") || "",
      element.getAttribute("name") || "",
      element.id || "",
      element.className || "",
      optionText,
    ].join(" "));

    return Boolean(
      element.closest &&
      element.closest("#messageContainer, we-doc-import") &&
      /(classification|attribuer une classification|cardiologie|gynécologie|gynecologie|imagerie|biologie|pneumologie|dermatologie|urologie|psychiatrie|psychologie|rhumatologie|ophtalmologie|gastro|hépato|hepato|orl)/i.test(descriptor)
    );
  }

  function rememberManualEditedWedaSpecialty(select, eventType = "change") {
    const item = getSelectedBiologyItem();
    const context = buildWedaSpecialtyMemoryContext(select, item);

    if (!context.keys.length) {
      return false;
    }

    const selection = buildWedaSpecialtySelectionFromSelect(select);

    if (!selection) {
      forgetSpecialtyKeys(context.keys);
      appendDebugLog("weda:specialty-manual-cleared", {
        rowIndex: context.rowIndex,
        rowStableKey: context.rowStableKey,
        keys: context.keys,
        eventType,
      });
      return false;
    }

    const metadata = {
      rowKey: context.rowKey || "",
      rowStableKey: context.rowStableKey || "",
      rowIdentity: context.rowIdentity || "",
      pdfUrlHash: context.pdfUrlHash || "",
      contentKey: context.contentKey || "",
      urlKey: context.urlKey || "",
      manualOverride: true,
      manualUpdatedAt: Date.now(),
    };

    context.keys.forEach((key) => rememberSpecialty(key, selection, metadata));

    appendDebugLog("weda:specialty-manual-remembered", {
      rowIndex: context.rowIndex,
      rowStableKey: context.rowStableKey,
      keys: context.keys,
      eventType,
      optionText: selection.optionText || "",
      optionValue: selection.optionValue || "",
    });

    return true;
  }

  function buildWedaSpecialtySelectionFromSelect(select) {
    if (!select) {
      return null;
    }

    const option = Array.from(select.options || []).find((candidate) => candidate.selected) ||
      Array.from(select.options || []).find((candidate) => String(candidate.value || "") === String(select.value || ""));

    if (!option || String(option.value || "") === "0") {
      return null;
    }

    const optionText = normalizeText(option.textContent || option.label || option.value || "");
    if (!optionText || optionText === "...") {
      return null;
    }

    return {
      code: detectHeidiSpecialtyCode(optionText) || "",
      optionNames: [optionText],
      optionText,
      optionValue: String(option.value || ""),
      reason: "selection-weda-manuelle",
    };
  }

  function setupWedaTitleManualEditTracking(container) {
    if (!container || container.__wbhTitleManualEditTracking) {
      return;
    }

    try {
      container.__wbhTitleManualEditTracking = true;
    } catch (_error) {
      // La protection anti-double listener reste best effort.
    }

    ["beforeinput", "input", "change", "keydown", "paste", "compositionstart"].forEach((eventName) => {
      container.addEventListener(eventName, handleWedaTitleManualEditEvent, true);
    });
  }

  function handleWedaTitleManualEditEvent(event) {
    if (!event || event.isTrusted === false) {
      return;
    }

    const input = getWedaTitleInputFromEvent(event);
    if (!input) {
      return;
    }

    const context = buildWedaTitleManualEditContext(input);
    if (!context.keys.length) {
      return;
    }

    const now = Date.now();
    const previous = titleManualEditState;
    const shouldLog = !previous ||
      !haveSharedTitleKeys(previous.keys, context.keys) ||
      now - Number(previous.loggedAt || 0) > 5000;

    titleManualEditState = {
      ...previous,
      input,
      keys: context.keys,
      rowIndex: context.rowIndex,
      rowKey: context.rowKey,
      rowStableKey: context.rowStableKey,
      rowIdentity: context.rowIdentity,
      pdfUrlHash: context.pdfUrlHash,
      contentKey: context.contentKey,
      urlKey: context.urlKey,
      lastTitle: sanitizeTitle(input.value),
      startedAt: previous && haveSharedTitleKeys(previous.keys, context.keys) ? previous.startedAt : now,
      updatedAt: now,
      eventType: event.type,
      loggedAt: shouldLog ? now : Number(previous && previous.loggedAt) || 0,
    };

    if (shouldLog) {
      appendDebugLog("weda:title-manual-edit-detected", {
        rowIndex: context.rowIndex,
        rowStableKey: context.rowStableKey,
        keys: context.keys,
        eventType: event.type,
        currentLength: sanitizeTitle(input.value).length,
      });
    }

    if (event.type === "input" || event.type === "change") {
      scheduleRememberManualEditedWedaTitle();
    }
  }

  function getWedaTitleInputFromEvent(event) {
    const target = event && event.target;
    if (isWedaTitleInputElement(target)) {
      return target;
    }

    if (target && typeof target.closest === "function") {
      const closest = target.closest("input.docTitle, textarea.docTitle, input[placeholder='Titre du document'], textarea[placeholder='Titre du document'], input[title*='titre'], textarea[title*='titre']");
      return isWedaTitleInputElement(closest) ? closest : null;
    }

    return null;
  }

  function isWedaTitleInputElement(element) {
    if (!element || !/^(?:input|textarea)$/i.test(element.tagName || "")) {
      return false;
    }

    try {
      return element.matches("input.docTitle, textarea.docTitle, input[placeholder='Titre du document'], textarea[placeholder='Titre du document'], input[title*='titre'], textarea[title*='titre']");
    } catch (_error) {
      return false;
    }
  }

  function buildWedaTitleManualEditContext(input, rowOverride = null) {
    const state = getState();
    const item = rowOverride || getSelectedBiologyItem();
    const pdfUrl = getDisplayedPdfUrl();
    const urlKey = getPdfUrlKey(pdfUrl);
    const stateMatchesItem = !item || !state.currentStableKey || state.currentStableKey === item.stableKey;
    const keys = buildWedaDocumentMemoryKeys([
      stateMatchesItem && state.currentContentKey,
      stateMatchesItem && state.currentUrlKey,
      stateMatchesItem && state.lastTitleKey,
      urlKey,
    ]);

    return {
      keys: Array.from(new Set(keys)),
      rowIndex: item ? item.index : state.currentIndex,
      rowKey: item ? item.key : state.currentRowKey,
      rowStableKey: item ? item.stableKey : state.currentStableKey,
      rowIdentity: item ? item.identityLabel : "",
      pdfUrlHash: hashString(pdfUrl || ""),
      contentKey: stateMatchesItem ? state.currentContentKey || "" : "",
      urlKey: stateMatchesItem ? state.currentUrlKey || urlKey : urlKey,
    };
  }

  function scheduleRememberManualEditedWedaTitle() {
    window.clearTimeout(titleManualEditCommitTimer);
    titleManualEditCommitTimer = window.setTimeout(() => {
      rememberManualEditedWedaTitle();
    }, TITLE_MANUAL_EDIT_COMMIT_DELAY_MS);
  }

  function rememberManualEditedWedaTitle() {
    const edit = titleManualEditState;

    if (!edit || !edit.keys || !edit.keys.length) {
      return false;
    }

    const title = sanitizeTitle(edit.input && typeof edit.input.value !== "undefined" ? edit.input.value : edit.lastTitle);
    const now = Date.now();
    titleManualEditState = {
      ...edit,
      lastTitle: title,
      updatedAt: now,
    };

    if (!title || !isRememberableManualTitleLine(title)) {
      appendDebugLog("weda:title-manual-edit-not-remembered", {
        rowIndex: edit.rowIndex,
        rowStableKey: edit.rowStableKey,
        keys: edit.keys,
        titleLength: title.length,
      });
      return false;
    }

    if (edit.committedTitle === title) {
      return true;
    }

    const metadata = {
      rowKey: edit.rowKey || "",
      rowStableKey: edit.rowStableKey || "",
      rowIdentity: edit.rowIdentity || "",
      pdfUrlHash: edit.pdfUrlHash || "",
      contentKey: edit.contentKey || "",
      urlKey: edit.urlKey || "",
      manualOverride: true,
      manualUpdatedAt: now,
    };

    edit.keys.forEach((key) => rememberTitle(key, title, metadata));
    titleManualEditState = {
      ...titleManualEditState,
      committedTitle: title,
      committedAt: now,
    };

    appendDebugLog("weda:title-manual-edit-remembered", {
      rowIndex: edit.rowIndex,
      rowStableKey: edit.rowStableKey,
      keys: edit.keys,
      titleLength: title.length,
    });

    return true;
  }

  function shouldRespectManualTitleEdit(input, rememberedEntry, item, currentTitle, rememberedTitle) {
    const edit = titleManualEditState;
    if (!edit || !edit.keys || !edit.keys.length) {
      return false;
    }

    const comparisonKeys = buildWedaTitleManualEditComparisonKeys(input, rememberedEntry, item);
    if (!haveSharedTitleKeys(edit.keys, comparisonKeys)) {
      return false;
    }

    const cleanCurrent = sanitizeTitle(currentTitle);
    const cleanManual = sanitizeTitle(edit.input && typeof edit.input.value !== "undefined" ? edit.input.value : edit.lastTitle);
    const cleanRemembered = sanitizeTitle(rememberedTitle);
    const activeElement = document.activeElement;
    const active = Boolean(input && (activeElement === input || activeElement === edit.input));
    const recent = Date.now() - Number(edit.updatedAt || 0) <= TITLE_MANUAL_EDIT_SUPPRESS_MS;
    const matchesManualValue = cleanCurrent === cleanManual && (Boolean(cleanCurrent) || recent);

    if (!active && !matchesManualValue) {
      return false;
    }

    if (cleanCurrent && cleanCurrent !== cleanRemembered && isRememberableManualTitleLine(cleanCurrent)) {
      rememberManualEditedWedaTitle();
    }

    return true;
  }

  function buildWedaTitleManualEditComparisonKeys(input, rememberedEntry = {}, item = null) {
    const context = buildWedaTitleManualEditContext(input, item);
    const rememberedKeys = rememberedEntry && rememberedEntry.keys ? rememberedEntry.keys : [];
    return Array.from(new Set([
      ...(Array.isArray(rememberedKeys) ? rememberedKeys : [rememberedKeys]),
      rememberedEntry && rememberedEntry.key,
      ...context.keys,
    ].filter(Boolean)));
  }

  function buildWedaDocumentMemoryKeys(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : [values])
      .map((value) => String(value || "").trim())
      .filter(isStrongWedaDocumentMemoryKey)));
  }

  function isStrongWedaDocumentMemoryKey(value = "") {
    return /^(?:pdftext|pdfurl|messagebody)-[a-z0-9]+$/i.test(String(value || "").trim());
  }

  function haveSharedTitleKeys(left, right) {
    const leftSet = new Set((Array.isArray(left) ? left : [left]).filter(Boolean));
    return (Array.isArray(right) ? right : [right]).some((key) => leftSet.has(key));
  }

  async function applyRememberedTitleForSelectedRow(options = {}) {
    const state = getState();

    if (state.running) {
      if (!options.silent) {
        appendDebugLog(state.phase === "savingTitle" ? "weda:remembered-title-skip-saving-title" : "weda:remembered-title-skip-active-workflow", {
          currentIndex: state.currentIndex,
          currentJobId: state.currentJobId || "",
          phase: state.phase || "",
        });
      }
      return;
    }

    const item = getStrictSelectedBiologyItem();

    if (!item) {
      return;
    }

    if (item && !isDisplayedBiologyForRow(item)) {
      return;
    }

    const pdfUrl = getDisplayedPdfUrl();
    const urlKey = getPdfUrlKey(pdfUrl);
    const titleInputTarget = {
      pdfUrl,
      urlKey,
      rowStableKey: item.stableKey,
    };
    const stateMatchesItem = !item || !state.currentStableKey || state.currentStableKey === item.stableKey;
    const rememberedEntry = getRememberedTitleForKeys(buildWedaDocumentMemoryKeys([
      stateMatchesItem && state.currentContentKey,
      stateMatchesItem && state.currentUrlKey,
      stateMatchesItem && state.lastTitleKey,
      urlKey,
    ]));
    const remembered = rememberedEntry.title;

    if (!remembered) {
      return;
    }

    const compatibility = isRememberedDocumentEntryCompatibleWithRow(rememberedEntry, item, options);
    if (!compatibility.ok) {
      if (!options.silent) {
        appendDebugLog("weda:remembered-title-skip-row-mismatch", {
          rowIndex: item ? item.index : null,
          rowKey: item ? item.key : "",
          rowStableKey: item ? item.stableKey : "",
          rememberedKey: rememberedEntry.key,
          rememberedRowKey: compatibility.rememberedRowKey || "",
          rememberedRowStableKey: compatibility.rememberedStableKey || "",
          reason: compatibility.reason || "",
          lookupKeys: rememberedEntry.keys,
        });
      }
      return;
    }

    let input = findWedaTitleInput(titleInputTarget);

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
        openedInput = await ensureWedaTitleInputVisible("", titleInputTarget);
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
      applyRememberedTitleToInput(findWedaTitleInput(titleInputTarget) || openedInput, rememberedEntry, item, {
        ...options,
        force: true,
        openedInput: true,
        titleInputTarget,
      });
      return;
    }

    applyRememberedTitleToInput(input, rememberedEntry, item, {
      ...options,
      enforcePriority: true,
      titleInputTarget,
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
    const titleInputTarget = options.titleInputTarget || {};

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

    if (shouldRespectManualTitleEdit(input, rememberedEntry, item, currentTitle, remembered)) {
      if (!options.silent) {
        appendDebugLog("weda:remembered-title-skip-manual-edit", {
          rowIndex: item ? item.index : null,
          rememberedKey: rememberedEntry.key,
          currentLength: currentTitle.length,
          titleLength: remembered.length,
        });
        setPanelStatus("Modification manuelle du titre détectée : le titre saisi est conservé.");
      }
      return false;
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
        const freshItem = getStrictSelectedBiologyItem();
        const compatibility = isRememberedDocumentEntryCompatibleWithRow(rememberedEntry, freshItem, options);
        if (!compatibility.ok) {
          return;
        }

        const freshInput = findWedaTitleInput({
          pdfUrl: titleInputTarget.pdfUrl || "",
          urlKey: titleInputTarget.urlKey || "",
          rowStableKey: titleInputTarget.rowStableKey || (freshItem ? freshItem.stableKey : ""),
        });
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
    const manualOverride = Boolean(metadata && metadata.manualOverride);

    if (!isRememberableTitleLine(cleanTitle, { manualOverride })) {
      appendDebugLog("weda:remember-title-rejected", {
        rowKey,
        titleLength: cleanTitle.length,
        manualOverride,
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
      manualOverride,
      createdAt: previous.createdAt || now,
      updatedAt: now,
      lastUsedAt: previous.lastUsedAt || now,
    };

    GM_setValue(TITLES_KEY, pruneRememberedTitles(titles));
  }

  function getRememberedTitle(rowKey) {
    const entry = getRememberedTitleEntry(rowKey);
    return entry ? entry.title : "";
  }

  function getRememberedTitleEntry(rowKey) {
    if (!rowKey) {
      return null;
    }

    const titles = GM_getValue(TITLES_KEY, {});
    const entry = titles[rowKey];
    const title = entry ? sanitizeTitle(entry.title) : "";

    if (title && !isRememberableTitleLine(title, entry)) {
      delete titles[rowKey];
      GM_setValue(TITLES_KEY, titles);
      appendDebugLog("weda:remembered-title-dropped", {
        rowKey,
        titleLength: title.length,
      });
      return null;
    }

    if (!title) {
      return null;
    }

    return {
      ...entry,
      key: rowKey,
      title,
    };
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
      .filter(([_key, entry]) => entry && isRememberableTitleLine(sanitizeTitle(entry.title), entry))
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
      const entry = getRememberedTitleEntry(key);
      if (entry) {
        return { key, keys: lookupKeys, title: entry.title, entry };
      }
    }

    return { key: "", keys: lookupKeys, title: "", entry: null };
  }

  function isRememberedDocumentEntryCompatibleWithRow(rememberedEntry, item, options = {}) {
    if (!rememberedEntry || !rememberedEntry.key || !item || !item.row) {
      return {
        ok: false,
        reason: "missing-row-context",
      };
    }

    const entry = rememberedEntry.entry || rememberedEntry;
    const rememberedRowKey = String(entry.rowKey || "").trim();
    const itemRowKey = String(item.key || "").trim();
    const rememberedStableKey = String(entry.rowStableKey || "").trim();
    const itemStableKey = String(item.stableKey || "").trim();
    const rememberedIdentity = normalizeForCompare(entry.rowIdentity || "");
    const itemIdentity = normalizeForCompare(item.identityLabel || "");
    const matchedByStrongDocumentKey = isRememberedEntryMatchedByStrongDocumentKey(rememberedEntry);
    const sameStableDuplicateOccurrence = Boolean(rememberedStableKey && itemStableKey && rememberedStableKey === itemStableKey);

    if (entry.sourceType === "message-body" && hasDisplayedAnalyzableAttachment()) {
      return {
        ok: false,
        reason: "message-body-entry-with-attachment",
      };
    }

    if (rememberedStableKey && itemStableKey && rememberedStableKey !== itemStableKey) {
      return {
        ok: false,
        reason: "row-stable-key-mismatch",
        rememberedStableKey,
        itemStableKey,
      };
    }

    if (rememberedRowKey && itemRowKey && rememberedRowKey !== itemRowKey && !sameStableDuplicateOccurrence) {
      if (matchedByStrongDocumentKey && !rememberedStableKey && !rememberedIdentity && !options.autoSave) {
        return {
          ok: true,
          reason: "strong-document-key-row-key-mismatch",
        };
      }

      return {
        ok: false,
        reason: "row-key-mismatch",
        rememberedRowKey,
        itemRowKey,
      };
    }

    if (!rememberedStableKey && rememberedIdentity && itemIdentity && rememberedIdentity !== itemIdentity) {
      return {
        ok: false,
        reason: "row-identity-mismatch",
        rememberedIdentity,
        itemIdentity,
      };
    }

    if (matchedByStrongDocumentKey) {
      return {
        ok: true,
        reason: "strong-document-key",
      };
    }

    if (!rememberedRowKey && !rememberedStableKey && !rememberedIdentity && options.autoSave) {
      return {
        ok: false,
        reason: "missing-row-metadata-autosave",
      };
    }

    return {
      ok: true,
      reason: "",
    };
  }

  function isRememberedEntryMatchedByStrongDocumentKey(rememberedEntry = {}) {
    const key = String(rememberedEntry.key || "").trim();
    const lookupKeys = Array.isArray(rememberedEntry.keys) ? rememberedEntry.keys : [rememberedEntry.keys];

    return Boolean(
      isStrongWedaDocumentMemoryKey(key) &&
      lookupKeys.some((lookupKey) => String(lookupKey || "").trim() === key)
    );
  }

  function isRememberedTitleFromAnotherBiology(title, currentKeys) {
    const currentTitle = sanitizeTitle(title);
    const currentKeySet = new Set((Array.isArray(currentKeys) ? currentKeys : [currentKeys]).filter(Boolean));
    const titles = GM_getValue(TITLES_KEY, {});

    return Object.entries(titles).some(([key, entry]) => {
      const rememberedTitle = sanitizeTitle(entry && entry.title);
      return !currentKeySet.has(key) && isRememberableTitleLine(rememberedTitle, entry) && rememberedTitle === currentTitle;
    });
  }

  async function applyRememberedSpecialtyForSelectedRow(options = {}) {
    const state = getState();

    if (state.running) {
      if (!options.silent) {
        appendDebugLog(state.phase === "savingTitle" ? "weda:remembered-specialty-skip-saving-title" : "weda:remembered-specialty-skip-active-workflow", {
          currentIndex: state.currentIndex,
          currentJobId: state.currentJobId || "",
          phase: state.phase || "",
        });
      }
      return false;
    }

    const item = getStrictSelectedBiologyItem();

    if (!item) {
      return false;
    }

    if (item && !isDisplayedBiologyForRow(item)) {
      return false;
    }

    const pdfUrl = getDisplayedPdfUrl();
    const urlKey = getPdfUrlKey(pdfUrl);
    const specialtyTarget = {
      pdfUrl,
      urlKey,
      rowStableKey: item.stableKey,
    };
    const stateMatchesItem = !item || !state.currentStableKey || state.currentStableKey === item.stableKey;
    const rememberedEntry = getRememberedSpecialtyForKeys(buildWedaDocumentMemoryKeys([
      stateMatchesItem && state.currentContentKey,
      stateMatchesItem && state.currentUrlKey,
      stateMatchesItem && state.lastTitleKey,
      urlKey,
    ]));
    const remembered = rememberedEntry.selection;

    if (!remembered) {
      return false;
    }

    const compatibility = isRememberedDocumentEntryCompatibleWithRow(rememberedEntry, item, options);
    if (!compatibility.ok) {
      if (!options.silent) {
        appendDebugLog("weda:remembered-specialty-skip-row-mismatch", {
          rowIndex: item ? item.index : null,
          rowKey: item ? item.key : "",
          rowStableKey: item ? item.stableKey : "",
          rememberedKey: rememberedEntry.key,
          rememberedRowKey: compatibility.rememberedRowKey || "",
          rememberedRowStableKey: compatibility.rememberedStableKey || "",
          reason: compatibility.reason || "",
          lookupKeys: rememberedEntry.keys,
        });
      }
      return false;
    }

    const titleInput = findWedaTitleInput(specialtyTarget);
    const select = findWedaSpecialtySelect({
      titleInput,
      ...specialtyTarget,
    });

    if (!select) {
      if (!options.silent) {
        appendDebugLog("weda:remembered-specialty-select-missing", {
          rowIndex: item ? item.index : null,
          rememberedKey: rememberedEntry.key,
          lookupKeys: rememberedEntry.keys,
        });
      }
      return false;
    }

    if (isWedaSpecialtySelectionPresent(select, remembered)) {
      touchRememberedSpecialtyKeys(rememberedEntry.keys, remembered);
      if (!options.silent) {
        appendDebugLog("weda:remembered-specialty-already-present", {
          rowIndex: item ? item.index : null,
          rememberedKey: rememberedEntry.key,
          optionText: remembered.optionText || "",
          optionValue: remembered.optionValue || "",
        });
      }
      return true;
    }

    const selected = setWedaSpecialtySelectValue(select, remembered);

    if (!selected) {
      appendDebugLog("weda:remembered-specialty-option-missing", {
        rowIndex: item ? item.index : null,
        rememberedKey: rememberedEntry.key,
        optionText: remembered.optionText || "",
        optionValue: remembered.optionValue || "",
        code: remembered.code || "",
        availableOptions: Array.from(select.options || [])
          .map((option) => normalizeText(option.textContent || option.label || option.value || ""))
          .filter(Boolean)
          .slice(0, 80),
      });
      return false;
    }

    touchRememberedSpecialtyKeys(rememberedEntry.keys, remembered);

    appendDebugLog("weda:remembered-specialty-applied", {
      rowIndex: item ? item.index : null,
      rememberedKey: rememberedEntry.key,
      optionText: selected.optionText || "",
      optionValue: selected.optionValue || "",
      code: remembered.code || "",
    });

    if (!options.noRetry) {
      window.setTimeout(() => {
        const freshItem = getStrictSelectedBiologyItem();
        const compatibility = isRememberedDocumentEntryCompatibleWithRow(rememberedEntry, freshItem, options);
        if (!compatibility.ok) {
          return;
        }

        const freshSelect = findWedaSpecialtySelect({
          titleInput: findWedaTitleInput(specialtyTarget),
          ...specialtyTarget,
        });

        if (!freshSelect || isWedaSpecialtySelectionPresent(freshSelect, remembered)) {
          return;
        }

        setWedaSpecialtySelectValue(freshSelect, remembered);
        appendDebugLog("weda:remembered-specialty-retry-applied", {
          rowIndex: item ? item.index : null,
          rememberedKey: rememberedEntry.key,
          optionText: remembered.optionText || "",
          optionValue: remembered.optionValue || "",
        });
      }, 600);
    }

    if (!options.silent) {
      const lineLabel = item ? " pour le courrier " + (item.index + 1) : "";
      setPanelStatus("Spécialité mémorisée réaffichée" + lineLabel + ".");
    }

    return true;
  }

  function buildWedaSpecialtyMemoryContext(select = null, rowOverride = null) {
    const state = getState();
    const item = rowOverride || getSelectedBiologyItem();
    const pdfUrl = getDisplayedPdfUrl();
    const urlKey = getPdfUrlKey(pdfUrl);
    const stateMatchesItem = !item || !state.currentStableKey || state.currentStableKey === item.stableKey;
    const keys = buildWedaDocumentMemoryKeys([
      stateMatchesItem && state.currentContentKey,
      stateMatchesItem && state.currentUrlKey,
      stateMatchesItem && state.lastTitleKey,
      urlKey,
    ]);

    return {
      keys: Array.from(new Set(keys)),
      rowIndex: item ? item.index : state.currentIndex,
      rowKey: item ? item.key : state.currentRowKey,
      rowStableKey: item ? item.stableKey : state.currentStableKey,
      rowIdentity: item ? item.identityLabel : "",
      pdfUrlHash: hashString(pdfUrl || ""),
      contentKey: stateMatchesItem ? state.currentContentKey || "" : "",
      urlKey: stateMatchesItem ? state.currentUrlKey || urlKey : urlKey,
      select,
    };
  }

  function rememberSpecialty(rowKey, selection, metadata = {}) {
    if (!rowKey || !selection) {
      return;
    }

    const cleanSelection = sanitizeRememberedSpecialty(selection);

    if (!cleanSelection) {
      appendDebugLog("weda:remember-specialty-rejected", {
        rowKey,
        hasSelection: Boolean(selection),
      });
      return;
    }

    const specialties = GM_getValue(SPECIALTIES_KEY, {});
    const previous = specialties[rowKey] || {};
    const now = Date.now();
    specialties[rowKey] = {
      ...previous,
      ...metadata,
      selection: cleanSelection,
      createdAt: previous.createdAt || now,
      updatedAt: now,
      lastUsedAt: previous.lastUsedAt || now,
    };

    GM_setValue(SPECIALTIES_KEY, pruneRememberedSpecialties(specialties));
  }

  function sanitizeRememberedSpecialty(selection = {}) {
    const optionText = normalizeText(selection.optionText || "");
    const optionValue = String(selection.optionValue || "").trim();
    const code = parseHeidiSpecialtyCode(selection.code || "") || detectHeidiSpecialtyCode(optionText) || "";
    const optionNames = Array.from(new Set((Array.isArray(selection.optionNames) ? selection.optionNames : [])
      .concat(optionText || "")
      .concat(getWedaSpecialtyOptionAliasesForCode(code))
      .map((name) => normalizeText(name))
      .filter(Boolean)));

    if ((!optionText && !code && !optionNames.length) || optionValue === "0") {
      return null;
    }

    return {
      code,
      optionNames,
      optionText,
      optionValue,
      reason: normalizeText(selection.reason || "memoire-specialite"),
    };
  }

  function getRememberedSpecialty(rowKey) {
    const entry = getRememberedSpecialtyEntry(rowKey);
    return entry ? entry.selection : null;
  }

  function getRememberedSpecialtyEntry(rowKey) {
    if (!rowKey) {
      return null;
    }

    const specialties = GM_getValue(SPECIALTIES_KEY, {});
    const entry = specialties[rowKey];
    const selection = sanitizeRememberedSpecialty(entry && entry.selection);

    if (entry && !selection) {
      delete specialties[rowKey];
      GM_setValue(SPECIALTIES_KEY, specialties);
      appendDebugLog("weda:remembered-specialty-dropped", {
        rowKey,
      });
      return null;
    }

    if (!selection) {
      return null;
    }

    return {
      ...entry,
      key: rowKey,
      selection,
    };
  }

  function getRememberedSpecialtyForKeys(keys) {
    const lookupKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));

    for (const key of lookupKeys) {
      const entry = getRememberedSpecialtyEntry(key);
      if (entry) {
        return { key, keys: lookupKeys, selection: entry.selection, entry };
      }
    }

    return { key: "", keys: lookupKeys, selection: null, entry: null };
  }

  function touchRememberedSpecialtyKeys(keys, expectedSelection = null) {
    const lookupKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));
    const cleanExpected = sanitizeRememberedSpecialty(expectedSelection || {});

    if (!lookupKeys.length) {
      return;
    }

    const specialties = GM_getValue(SPECIALTIES_KEY, {});
    const now = Date.now();
    let changed = false;

    lookupKeys.forEach((key) => {
      const entry = specialties[key];
      const selection = sanitizeRememberedSpecialty(entry && entry.selection);

      if (!selection) {
        return;
      }

      if (cleanExpected && !areSameRememberedSpecialty(selection, cleanExpected)) {
        return;
      }

      const lastUsedAt = Number(entry.lastUsedAt || 0);
      if (lastUsedAt && now - lastUsedAt < REMEMBERED_TITLE_TOUCH_INTERVAL_MS) {
        return;
      }

      specialties[key] = {
        ...entry,
        selection,
        lastUsedAt: now,
      };
      changed = true;
    });

    if (changed) {
      GM_setValue(SPECIALTIES_KEY, pruneRememberedSpecialties(specialties));
    }
  }

  function areSameRememberedSpecialty(left, right) {
    const cleanLeft = sanitizeRememberedSpecialty(left || {});
    const cleanRight = sanitizeRememberedSpecialty(right || {});

    if (!cleanLeft || !cleanRight) {
      return false;
    }

    if (cleanLeft.optionValue && cleanRight.optionValue && cleanLeft.optionValue === cleanRight.optionValue) {
      return true;
    }

    const leftText = normalizeSpecialtyLabel(cleanLeft.optionText || cleanLeft.optionNames[0] || cleanLeft.code || "");
    const rightText = normalizeSpecialtyLabel(cleanRight.optionText || cleanRight.optionNames[0] || cleanRight.code || "");

    return Boolean(leftText && rightText && leftText === rightText);
  }

  function pruneRememberedSpecialties(specialties) {
    const entries = Object.entries(specialties || {})
      .filter(([_key, entry]) => entry && sanitizeRememberedSpecialty(entry.selection))
      .sort((left, right) => getRememberedTitleSortTime(right[1]) - getRememberedTitleSortTime(left[1]))
      .slice(0, MAX_REMEMBERED_SPECIALTIES);

    return Object.fromEntries(entries);
  }

  function forgetSpecialtyKeys(keys) {
    const lookupKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));
    if (!lookupKeys.length) {
      return false;
    }

    const specialties = GM_getValue(SPECIALTIES_KEY, {});
    let changed = false;

    lookupKeys.forEach((key) => {
      if (specialties[key]) {
        delete specialties[key];
        changed = true;
      }
    });

    if (changed) {
      GM_setValue(SPECIALTIES_KEY, specialties);
    }

    return changed;
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
    const nextCheckAt = Date.now() + getAutoIntervalMs();
    resetWedaDuplicatePdfRegistry("auto-cycle-finished");
    setState({
      running: false,
      mode: "manual",
      phase: "autoIdle",
      currentIndex: 0,
      currentRowKey: null,
      currentStableKey: null,
      currentContentKey: null,
      currentAttachmentProcessedUrlKeys: [],
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
      resetWedaDuplicatePdfRegistry("workflow-end");

      if (state.mode === "auto") {
        finishAutoCycle("Veille auto : traitement terminé.");
        return;
      }

      setState({
        running: false,
        mode: "manual",
        phase: "done",
        currentJobId: null,
        currentAttachmentProcessedUrlKeys: [],
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
      currentContentKey: null,
      currentAttachmentProcessedUrlKeys: [],
      currentPdfUrl: "",
      currentUrlKey: "",
      lastTitle: "",
      lastTitleKey: "",
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

    scheduleBackgroundTask(() => {
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

      const processedAttachmentUrlKeys = getCurrentAttachmentProcessedUrlKeys(state);
      const expectedPdfUrl = state.currentPdfUrl || "";
      const expectedUrlKey = state.currentUrlKey || "";
      const importPreparation = await prepareImportBeforePdfWait(row, {
        expectedPdfUrl,
        urlKey: expectedUrlKey,
      });

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
        excludeUrlKeys: processedAttachmentUrlKeys,
        expectedPdfUrl,
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
      const hasPdfImageFallback = Array.isArray(displayedDocument.pdfPageImages) && displayedDocument.pdfPageImages.length > 0;
      const liveFindPatientPanel = findWedaFindPatientPanel();
      const liveFindPatientPanelActionable = Boolean(liveFindPatientPanel && isWedaFindPatientPanelActionable(liveFindPatientPanel));
      const liveTitleInput = findWedaTitleInput({
        pdfUrl: displayedDocument.pdfUrl || "",
        urlKey: displayedDocument.urlKey || "",
        contentKey,
        rowStableKey: row.stableKey,
      });
      rememberCurrentPatientImportContextForDocument({
        row,
        rowStableKey: row.stableKey,
        contentKey,
        urlKey: displayedDocument.urlKey || "",
        pdfUrl: displayedDocument.pdfUrl || "",
      });

      if (importPreparation.titleInputRequired && (liveFindPatientPanelActionable || !liveTitleInput)) {
        const rescuedInput = liveFindPatientPanelActionable
          ? await rescueWedaFindPatientPanelWithDocumentIdentity({
            reason: "pre-pdf-find-patient-panel-after-extract",
            sourceText: documentText,
            pdfPageImages: displayedDocument.pdfPageImages || [],
            pdfImageFallbackReason: displayedDocument.pdfImageFallbackReason || "",
            rowStableKey: row.stableKey,
            contentKey,
            urlKey: displayedDocument.urlKey || "",
            pdfUrl: displayedDocument.pdfUrl || "",
          })
          : null;

        if (!rescuedInput) {
          const fallbackTitleInput = liveTitleInput || findWedaTitleInput({
            pdfUrl: displayedDocument.pdfUrl || "",
            urlKey: displayedDocument.urlKey || "",
            contentKey,
            rowStableKey: row.stableKey,
          });
          const remainingFindPatientPanel = findWedaFindPatientPanel();
          const remainingFindPatientPanelActionable = Boolean(remainingFindPatientPanel && isWedaFindPatientPanelActionable(remainingFindPatientPanel));

          if (fallbackTitleInput && !remainingFindPatientPanelActionable) {
            appendDebugLog("weda:find-patient-rescue-fallback-title-input", {
              rowIndex: row.index,
              rowStableKey: row.stableKey,
              titleInputIndex: getWedaTitleInputIndex(fallbackTitleInput),
              panelStillOpen: Boolean(remainingFindPatientPanel),
            });
          } else {
            const patientImportIssue = getLastPatientImportSelectionIssue();
            throw new Error(patientImportIssue && patientImportIssue.blocked
              ? patientImportIssue.message
              : "champ titre indisponible après ouverture Un patient");
          }
        }
      } else if (importPreparation.titleInputRequired && liveFindPatientPanel && liveTitleInput && !liveFindPatientPanelActionable) {
        appendDebugLog("weda:find-patient-panel-non-actionable-continue-analysis", {
          rowIndex: row.index,
          rowStableKey: row.stableKey,
          titleInputIndex: getWedaTitleInputIndex(liveTitleInput),
        });
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
        pdfImageFallback: hasPdfImageFallback,
        pdfImagePageCount: displayedDocument.pdfImagePageCount || 0,
        pdfImageTotalPages: displayedDocument.pdfImageTotalPages || 0,
        pdfImageFallbackReason: displayedDocument.pdfImageFallbackReason || "",
        pdfTextExtractionSparse: Boolean(displayedDocument.pdfTextExtractionSparse),
        pdfTextExtractionGarbled: Boolean(displayedDocument.pdfTextExtractionGarbled),
        pdfTextUnusable: Boolean(displayedDocument.pdfTextUnusable),
        pdfUnusableReason: displayedDocument.pdfUnusableReason || "",
        pdfTextPageCount: displayedDocument.pdfTextPageCount || 0,
        documentLines: countBiologyLinesForLog(documentText, "pdf"),
        documentLength: documentText.length,
      });

      if (await handleStrictDuplicateDisplayedDocument(row, displayedDocument, documentText, rows)) {
        return;
      }

      if (shouldFailClosedForDisplayedDocument(displayedDocument, documentText)) {
        await handleUnusableDisplayedDocument(row, rows, displayedDocument, contentKey);
        return;
      }

      if ((!documentText || documentText.length < 20) && !hasPdfImageFallback) {
        throw new Error("Le texte du PDF est vide ou illisible ; LM Studio local ne peut pas analyser le PDF joint sans texte extrait.");
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
        pdfTextExtractionSparse: Boolean(displayedDocument.pdfTextExtractionSparse),
        pdfTextExtractionGarbled: Boolean(displayedDocument.pdfTextExtractionGarbled),
        pdfTextPageCount: displayedDocument.pdfTextPageCount || 0,
        pdfPageImages: Array.isArray(displayedDocument.pdfPageImages) ? displayedDocument.pdfPageImages : [],
        pdfImagePageCount: displayedDocument.pdfImagePageCount || 0,
        pdfImageTotalPages: displayedDocument.pdfImageTotalPages || 0,
        pdfImageFallbackReason: displayedDocument.pdfImageFallbackReason || "",
        prompt: LMSTUDIO_PROMPT_ACTIVE,
        createdAt: Date.now(),
      };

      GM_deleteValue(RESULT_KEY);
      GM_setValue(JOB_KEY, buildStoredLmStudioJob(job));
      appendDebugLog("weda:job-created", {
        jobId,
        rowIndex: row.index,
        contentKey,
        urlKey: displayedDocument.urlKey,
        sourceType: displayedDocument.sourceType || "pdf",
        pdfAttachment: Boolean(displayedDocument.pdfAttachmentBase64),
        pdfAttachmentByteLength: displayedDocument.pdfAttachmentByteLength || 0,
        pdfTextExtractionEmpty: Boolean(displayedDocument.pdfTextExtractionEmpty),
        pdfImageFallback: hasPdfImageFallback,
        pdfImagePageCount: displayedDocument.pdfImagePageCount || 0,
        pdfImageTotalPages: displayedDocument.pdfImageTotalPages || 0,
        pdfImageFallbackReason: displayedDocument.pdfImageFallbackReason || "",
        pdfTextExtractionSparse: Boolean(displayedDocument.pdfTextExtractionSparse),
        pdfTextExtractionGarbled: Boolean(displayedDocument.pdfTextExtractionGarbled),
        pdfTextUnusable: Boolean(displayedDocument.pdfTextUnusable),
        pdfUnusableReason: displayedDocument.pdfUnusableReason || "",
        pdfTextPageCount: displayedDocument.pdfTextPageCount || 0,
        documentLines: countBiologyLinesForLog(documentText, "pdf"),
        documentLength: documentText.length,
      });

      setState({
        running: true,
        phase: "waitingLmStudio",
        currentJobId: jobId,
        currentContentKey: contentKey,
        currentAttachmentProcessedUrlKeys: appendProcessedAttachmentUrlKey(
          processedAttachmentUrlKeys,
          displayedDocument.urlKey || getPdfUrlKey(displayedDocument.pdfUrl || "")
        ),
        currentPdfUrl: displayedDocument.pdfUrl,
        currentUrlKey: displayedDocument.urlKey,
        allowUnchangedContentKey: "",
        message: "Analyse LM Studio : courrier " + (state.currentIndex + 1) + "/" + (rows.length || "?") + ".",
      });

      const result = await runLmStudioJob(job);
      await handleLmStudioResult(result);
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

  function shouldFailClosedForDisplayedDocument(displayedDocument, documentText = "") {
    if (!LMSTUDIO_UNUSABLE_PDF_FAIL_CLOSED || !displayedDocument) {
      return false;
    }

    const hasPdfImageFallback = Array.isArray(displayedDocument.pdfPageImages) && displayedDocument.pdfPageImages.length > 0;
    if (hasPdfImageFallback) {
      return false;
    }

    return Boolean(
      displayedDocument.pdfTextUnusable ||
      displayedDocument.pdfTextExtractionGarbled ||
      displayedDocument.pdfTextExtractionEmpty ||
      displayedDocument.sourceType === "pdf-unusable-text" ||
      (displayedDocument.pdfTextExtractionSparse && displayedDocument.sourceType === "pdf-text-sparse") ||
      normalizePdfText(documentText).length < PDF_MIN_TEXT_LENGTH
    );
  }

  async function handleUnusableDisplayedDocument(row, rows, displayedDocument, contentKey) {
    const jobId = createId("courrier-local");
    const result = buildUnusablePdfLocalResult(jobId, row, displayedDocument, contentKey);
    const state = getState();
    const processedAttachmentUrlKeys = getCurrentAttachmentProcessedUrlKeys(state);

    GM_deleteValue(JOB_KEY);
    GM_deleteValue(RESULT_KEY);
    appendDebugLog("weda:pdf-unusable-local-result", {
      jobId,
      rowIndex: row ? row.index : null,
      contentKey,
      urlKey: displayedDocument && displayedDocument.urlKey || "",
      sourceType: displayedDocument && displayedDocument.sourceType || "",
      reason: displayedDocument && displayedDocument.pdfUnusableReason || "",
      pdfTextExtractionEmpty: Boolean(displayedDocument && displayedDocument.pdfTextExtractionEmpty),
      pdfTextExtractionSparse: Boolean(displayedDocument && displayedDocument.pdfTextExtractionSparse),
      pdfTextExtractionGarbled: Boolean(displayedDocument && displayedDocument.pdfTextExtractionGarbled),
    });

    setState({
      running: true,
      phase: "waitingLmStudio",
      currentJobId: jobId,
      currentContentKey: contentKey,
      currentAttachmentProcessedUrlKeys: appendProcessedAttachmentUrlKey(
        processedAttachmentUrlKeys,
        displayedDocument && (displayedDocument.urlKey || getPdfUrlKey(displayedDocument.pdfUrl || "")) || ""
      ),
      currentPdfUrl: displayedDocument && displayedDocument.pdfUrl || "",
      currentUrlKey: displayedDocument && displayedDocument.urlKey || "",
      allowUnchangedContentKey: "",
      message: "PDF sans texte exploitable : insertion d'un titre de sécurité, sans appel LM Studio.",
    });

    setPanelStatus("PDF sans texte exploitable : aucun appel LM Studio.");
    await handleLmStudioResult(result);
  }

  function buildUnusablePdfLocalResult(jobId, row, displayedDocument, contentKey) {
    const raw = [
      "<TITRE_COURRIER>",
      UNUSABLE_PDF_TITLE,
      "</TITRE_COURRIER>",
      "<SPECIALITE_COURRIER>",
      "</SPECIALITE_COURRIER>",
      "<ANTECEDENT_CIM10>",
      "STATUT: NON",
      "SECTION: medical",
      "LIBELLE:",
      "CODE:",
      "DATE:",
      "CERTITUDE: PDF sans texte exploitable",
      "SOURCE:",
      "</ANTECEDENT_CIM10>",
    ].join("\n");

    return {
      jobId,
      ok: true,
      raw,
      title: UNUSABLE_PDF_TITLE,
      specialtyCode: "",
      skipSpecialty: true,
      antecedent: {
        status: "NON",
        section: "medical",
        label: "",
        code: "",
        date: "",
        certainty: "PDF sans texte exploitable",
        source: "",
      },
      sourceText: "",
      rowIndex: row ? row.index : null,
      rowStableKey: row ? row.stableKey || "" : "",
      rowIdentity: row ? row.identityLabel || "" : "",
      contentKey: contentKey || "",
      urlKey: displayedDocument && displayedDocument.urlKey || "",
      pdfUrl: displayedDocument && displayedDocument.pdfUrl || "",
      model: "local-fail-closed",
      sourceType: displayedDocument && displayedDocument.sourceType || "pdf-unusable-text",
      pdfTextUnusable: true,
      pdfUnusableReason: displayedDocument && displayedDocument.pdfUnusableReason || "unusable-text",
      pdfTextExtractionEmpty: Boolean(displayedDocument && displayedDocument.pdfTextExtractionEmpty),
      pdfTextExtractionSparse: Boolean(displayedDocument && displayedDocument.pdfTextExtractionSparse),
      pdfTextExtractionGarbled: Boolean(displayedDocument && displayedDocument.pdfTextExtractionGarbled),
      pdfImageFallback: false,
      pdfImageFallbackReason: "",
      createdAt: Date.now(),
    };
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
          currentAttachmentProcessedUrlKeys: [],
          currentPdfUrl: "",
          currentUrlKey: "",
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
        currentAttachmentProcessedUrlKeys: [],
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
      currentAttachmentProcessedUrlKeys: [],
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

  async function handleLmStudioResult(result) {
    const state = getState();
    appendDebugLog("weda:result-received", {
      jobId: result && result.jobId,
      ok: Boolean(result && result.ok),
      statePhase: state.phase,
      expectedJobId: state.currentJobId,
      rawLength: result && result.raw ? String(result.raw).length : 0,
      contentKey: result && result.contentKey,
    });

    if (!state.running || state.phase !== "waitingLmStudio" || result.jobId !== state.currentJobId) {
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
      appendDebugLog("weda:result-error", {
        jobId: result.jobId,
        error: result.error || "erreur inconnue",
      });
      skipOrFailCurrentDocument(`LM Studio n'a pas renvoyé de titre : ${result.error || "erreur inconnue"}`);
      return;
    }

    const parsedResult = parseHeidiCourrierAtcdOutput(result.raw || result.title || "");
    const specialtyCode = parseHeidiSpecialtyCode(result.specialtyCode || parsedResult.specialtyCode || "");
    const title = sanitizeHeidiCourrierTitle(parsedResult.title || result.title || "", specialtyCode);
    appendDebugLog("weda:title-sanitized", {
      jobId: result.jobId,
      titleLength: title.length,
      specialtyCode,
      sourceTextLength: normalizePdfText(result.sourceText || "").length,
      rasLike: isRasLikeHeidiTitle(title),
      hasAntecedent: Boolean(result.antecedent && result.antecedent.status === "OUI"),
    });

    if (!title) {
      failWeda("Le titre reçu de LM Studio est vide.");
      return;
    }

    if (!isExpectedTitleLine(title)) {
      appendDebugLog("weda:title-rejected", {
        jobId: result.jobId,
        titleLength: title.length,
        promptInstructionLike: isPromptInstructionLine(title),
      });
      failWeda("Le titre reçu de LM Studio ressemble à une consigne du prompt, il n'a pas été écrit dans Weda.");
      return;
    }

    if (!isCurrentJobStillActive(result.jobId, ["waitingLmStudio"])) {
      appendDebugLog("weda:result-ignored-after-stop", {
        jobId: result.jobId,
        state: getState(),
      });
      return;
    }

    try {
      await fillAndSaveWedaTitle(title, {
        ...result,
        specialtyCode,
      });
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

    if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingLmStudio", "savingTitle"])) {
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
      if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingLmStudio", "savingTitle"])) {
        throw new Error("analyse arrêtée");
      }

      setPanelStatus("Retour sur le courrier cible pour enregistrer le titre...");

      setState({
        running: true,
        phase: "waitingLmStudio",
        currentIndex: candidate.index,
        currentRowKey: candidate.key,
        currentStableKey: candidate.stableKey,
        previousContentKey: getDisplayedBiologyContentKey(),
        allowUnchangedContentKey: "",
      });

      triggerWedaBiologyRowOpen(candidate, "return-to-target");

      try {
        await waitFor(() => {
          if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingLmStudio", "savingTitle"])) {
            throw new Error("analyse arrêtée");
          }

          const selectedOk = candidate.row.classList.contains("selected") ||
            getSelectedBiologyIndex() === candidate.index;
          const pdfUrl = getDisplayedPdfUrl();
          const messageBodyText = !targetPdfUrl ? extractWedaMessageBodyFallbackText() : "";
          const hasExpectedDocument = targetPdfUrl ? pdfUrl === targetPdfUrl : Boolean(pdfUrl || messageBodyText);

          return selectedOk && hasExpectedDocument ? (pdfUrl || messageBodyText) : null;
        }, {
          timeout: 25000,
          interval: 350,
          description: "le courrier cible affiché",
        });

        if (targetJobId && !isCurrentJobStillActive(targetJobId, ["waitingLmStudio", "savingTitle"])) {
          throw new Error("analyse arrêtée");
        }

        setState({
          running: true,
          phase: "waitingLmStudio",
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

    throw new Error("le courrier affiché ne correspond pas au document envoyé à LM Studio");
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

    if (!isCurrentJobStillActive(result.jobId, ["waitingLmStudio", "savingTitle"])) {
      appendDebugLog("weda:title-fill-cancelled-before-start", {
        jobId: result.jobId,
        state: getState(),
      });
      return;
    }

    const targetRow = await ensureCurrentBiologyDisplayed(target);

    if (!isCurrentJobStillActive(result.jobId, ["waitingLmStudio", "savingTitle"])) {
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
      throw new Error("sécurité d'affectation : le PDF affiché ne correspond pas au résultat LM Studio");
    }

    const titleMetadata = {
      rowKey: targetRow.key || "",
      rowStableKey: targetRow.stableKey,
      rowIdentity: targetRow.identityLabel,
      pdfUrlHash: hashString(target.pdfUrl || displayedPdfUrl || ""),
      contentKey: target.contentKey,
      urlKey: target.urlKey || displayedUrlKey,
      sourceType: result.sourceType || "",
    };
    const titleMemoryKeys = buildWedaDocumentMemoryKeys([
      target.contentKey,
      target.urlKey || displayedUrlKey,
    ]);

    titleMemoryKeys.forEach((key) => rememberTitle(key, title, titleMetadata));

    if (!titleMemoryKeys.length) {
      appendDebugLog("weda:title-memory-skip-weak-keys", {
        jobId: result.jobId,
        targetRowIndex: targetRow.index,
        rowStableKey: targetRow.stableKey,
        hasContentKey: Boolean(target.contentKey),
        hasUrlKey: Boolean(target.urlKey || displayedUrlKey),
      });
    }

    const titleInputTarget = {
      pdfUrl: target.pdfUrl || displayedPdfUrl,
      urlKey: target.urlKey || displayedUrlKey,
      contentKey: target.contentKey,
      rowStableKey: targetRow.stableKey,
      sourceText: result.sourceText || "",
    };
    const input = await ensureWedaTitleInputVisible(result.jobId, titleInputTarget);

    if (!isCurrentJobStillActive(result.jobId, ["waitingLmStudio", "savingTitle"])) {
      appendDebugLog("weda:title-fill-cancelled-after-input-wait", {
        jobId: result.jobId,
        targetRowIndex: targetRow.index,
        hasInput: Boolean(input),
        state: getState(),
      });
      return;
    }

    if (!input) {
      const patientImportIssue = getLastPatientImportSelectionIssue();
      if (patientImportIssue && patientImportIssue.blocked) {
        appendDebugLog("weda:title-input-blocked-patient-selection", {
          jobId: result.jobId,
          reason: patientImportIssue.reason || "",
          candidateCount: patientImportIssue.candidateCount || 0,
          topScore: patientImportIssue.topScore || 0,
          scoreGap: patientImportIssue.scoreGap || 0,
          hasBirthDateHint: Boolean(patientImportIssue.hasBirthDateHint),
        });
        failWeda(patientImportIssue.message || "Import patient bloqué : choix patient ambigu.");
        return;
      }

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

      openWedaAntecedentWorkerIfNeeded(result, title, resolveWedaPatientContextForAntecedent(null, result, titleInputTarget));
      scheduleBackgroundTask(() => goToNextBiology(result.jobId), 500);
      return;
    }

    const patientContext = resolveWedaPatientContextForAntecedent(input, result, titleInputTarget);

    const inputCurrentTitle = sanitizeTitle(input.value);

    appendDebugLog("weda:title-fill", {
      jobId: result.jobId,
      contentKey: target.contentKey,
      urlKey: target.urlKey || displayedUrlKey,
      titleLength: title.length,
      targetRowIndex: targetRow.index,
      inputIndex: getWedaTitleInputIndex(input),
      titleInputs: (document.querySelector("#messageContainer") || document).querySelectorAll("input.docTitle, input[placeholder='Titre du document'], input[title*='titre']").length,
      associatedWithPdf: isWedaTitleInputAssociatedWithPdf(input, titleInputTarget.pdfUrl),
      inputCurrentLength: inputCurrentTitle.length,
      inputCurrentHash: inputCurrentTitle ? hashString(inputCurrentTitle) : "",
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

    let specialtySelection = null;
    if (result.skipSpecialty) {
      appendDebugLog("weda:specialty-skip-unusable-pdf", {
        jobId: result.jobId,
        targetRowIndex: targetRow.index,
        reason: result.pdfUnusableReason || "",
      });
    } else {
      specialtySelection = await fillWedaSpecialtyFromHeidi(title, result.jobId, targetRow, {
        titleInput: input,
        pdfUrl: titleInputTarget.pdfUrl,
        urlKey: target.urlKey || displayedUrlKey,
        raw: result.raw || "",
        sourceText: result.sourceText || "",
      }, result.specialtyCode || "");
    }

    if (specialtySelection) {
      const specialtyMetadata = {
        rowKey: targetRow.key || "",
        rowStableKey: targetRow.stableKey,
        rowIdentity: targetRow.identityLabel,
        pdfUrlHash: hashString(target.pdfUrl || displayedPdfUrl || ""),
        contentKey: target.contentKey,
        urlKey: target.urlKey || displayedUrlKey,
        sourceType: result.sourceType || "",
        title,
      };
      const specialtyMemoryKeys = buildWedaDocumentMemoryKeys([
        target.contentKey,
        target.urlKey || displayedUrlKey,
      ]);

      specialtyMemoryKeys.forEach((key) => rememberSpecialty(key, specialtySelection, specialtyMetadata));

      if (!specialtyMemoryKeys.length) {
        appendDebugLog("weda:specialty-memory-skip-weak-keys", {
          jobId: result.jobId,
          targetRowIndex: targetRow.index,
          rowStableKey: targetRow.stableKey,
          hasContentKey: Boolean(target.contentKey),
          hasUrlKey: Boolean(target.urlKey || displayedUrlKey),
        });
      }

      appendDebugLog("weda:specialty-remembered", {
        jobId: result.jobId,
        targetRowIndex: targetRow.index,
        optionText: specialtySelection.optionText || "",
        optionValue: specialtySelection.optionValue || "",
        code: specialtySelection.code || "",
      });
    }

    await guardWedaTitleStability({
      jobId: result.jobId,
      title,
      specialtySelection,
      targetRow,
      targetPdfUrl: target.pdfUrl || displayedPdfUrl,
      urlKey: target.urlKey || displayedUrlKey,
      contentKey: target.contentKey,
    });

    openWedaAntecedentWorkerIfNeeded(result, title, patientContext);
    scheduleBackgroundTask(() => goToNextBiology(result.jobId), NEXT_AFTER_TITLE_STABLE_MS);
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
    const specialtySelection = options.specialtySelection || null;
    const targetRow = options.targetRow || null;
    const targetPdfUrl = options.targetPdfUrl || "";
    const startedAt = Date.now();
    let restoredCount = 0;
    let specialtyRestoredCount = 0;
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
      specialty: specialtySelection ? specialtySelection.optionText || specialtySelection.code || "" : "",
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
        if (shouldRespectManualTitleEdit(input, {
          keys: buildWedaTitleManualEditContext(input, targetRow).keys,
          title,
        }, targetRow, currentTitle, title)) {
          appendDebugLog("weda:title-stability-skip-manual-edit", {
            jobId,
            restoredCount,
            currentLength: currentTitle.length,
            titleLength: title.length,
            targetRowIndex: targetRow.index,
          });
          setPanelStatus("Modification manuelle du titre détectée : le titre saisi est conservé.");
          return false;
        }

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

      if (specialtySelection) {
        const specialtySelect = findWedaSpecialtySelect({
          titleInput: input,
          pdfUrl: targetPdfUrl,
          urlKey: options.urlKey || "",
        });

        if (specialtySelect && !isWedaSpecialtySelectionPresent(specialtySelect, specialtySelection)) {
          specialtyRestoredCount += 1;
          appendDebugLog("weda:specialty-restored-after-clear", {
            jobId,
            restoredCount: specialtyRestoredCount,
            optionText: specialtySelection.optionText || "",
            optionValue: specialtySelection.optionValue || "",
            targetRowIndex: targetRow.index,
          });
          setWedaSpecialtySelectValue(specialtySelect, specialtySelection);
        }
      }

      await sleep(TITLE_STABILITY_CHECK_INTERVAL_MS);
    }

    const finalInput = findWedaTitleInput({ pdfUrl: targetPdfUrl });
    const finalTitle = sanitizeTitle(finalInput && finalInput.value);
    if (finalInput && finalTitle === title) {
      triggerWedaTitleSave(finalInput);
    }

    const finalSpecialtySelect = specialtySelection ? findWedaSpecialtySelect({
      titleInput: finalInput,
      pdfUrl: targetPdfUrl,
      urlKey: options.urlKey || "",
    }) : null;

    if (specialtySelection && finalSpecialtySelect && !isWedaSpecialtySelectionPresent(finalSpecialtySelect, specialtySelection)) {
      specialtyRestoredCount += 1;
      setWedaSpecialtySelectValue(finalSpecialtySelect, specialtySelection);
    }

    const finalSpecialtyPresent = specialtySelection
      ? !finalSpecialtySelect || isWedaSpecialtySelectionPresent(finalSpecialtySelect, specialtySelection)
      : true;

    appendDebugLog("weda:title-stability-ok", {
      jobId,
      restoredCount,
      specialtyRestoredCount,
      finalPresent: finalTitle === title,
      finalSpecialtyPresent,
      finalLength: finalTitle.length,
      elapsedMs: Date.now() - startedAt,
    });
    return finalTitle === title && finalSpecialtyPresent;
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

    const processedAttachmentUrlKeys = appendProcessedAttachmentUrlKey(
      getCurrentAttachmentProcessedUrlKeys(state),
      state.currentUrlKey || getPdfUrlKey(state.currentPdfUrl || "")
    );
    const nextAttachment = findNextDisplayedPdfAttachment(processedAttachmentUrlKeys);

    if (nextAttachment) {
      appendDebugLog("weda:next-attachment-same-message", {
        jobId,
        currentIndex: state.currentIndex,
        currentStableKey: state.currentStableKey,
        processedUrlKeys: processedAttachmentUrlKeys,
        nextUrlKey: nextAttachment.urlKey,
        remainingCount: nextAttachment.remainingCount,
      });
      setState({
        running: true,
        mode: state.mode || "manual",
        phase: "clickedRow",
        currentIndex: state.currentIndex,
        currentRowKey: state.currentRowKey,
        currentStableKey: state.currentStableKey,
        currentContentKey: null,
        currentAttachmentProcessedUrlKeys: processedAttachmentUrlKeys,
        currentPdfUrl: nextAttachment.pdfUrl,
        currentUrlKey: nextAttachment.urlKey,
        allowUnchangedContentKey: "",
        previousContentKey: state.currentContentKey || "",
        currentJobId: null,
        message: "Autre pièce jointe détectée : analyse du PDF suivant...",
      });
      scheduleBackgroundTask(() => extractAndSendCurrentBiology(), 250);
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
        currentAttachmentProcessedUrlKeys: [],
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
      resetWedaDuplicatePdfRegistry("manual-finished");
      setState({
        running: false,
        mode: "manual",
        phase: "done",
        currentJobId: null,
        currentAttachmentProcessedUrlKeys: [],
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
      currentAttachmentProcessedUrlKeys: [],
      currentPdfUrl: "",
      currentUrlKey: "",
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      message: "Passage au courrier suivant...",
    });

    clickBiologyRow(nextIndex);
  }

  async function runLmStudioJob(job) {
    const pdfImageCount = getLmStudioPdfPageImages(job).length;
    let activeJobForError = job;
    appendDebugLog("lmstudio:run-start", {
      jobId: job.id,
      contentKey: job.contentKey,
      urlKey: job.urlKey || "",
      sourceType: job.sourceType || "pdf",
      pdfImageFallback: pdfImageCount > 0,
      pdfImagePageCount: pdfImageCount,
      pdfImageTotalPages: job.pdfImageTotalPages || 0,
      pdfImageFallbackReason: job.pdfImageFallbackReason || "",
      pdfTextExtractionSparse: Boolean(job.pdfTextExtractionSparse),
      pdfTextExtractionGarbled: Boolean(job.pdfTextExtractionGarbled),
      pdfTextPageCount: job.pdfTextPageCount || 0,
      documentLines: countBiologyLinesForLog(job.tableText, "pdf"),
      documentLength: String(job.tableText || "").length,
      apiUrl: LMSTUDIO_CHAT_COMPLETIONS_URL,
    });

    try {
      updateLmStudioStatus(job.id, "Connexion à LM Studio local...");
      const model = await getLmStudioModelId();

      updateLmStudioStatus(job.id, "Analyse LM Studio en cours...");
      let activeJob = job;
      activeJobForError = activeJob;
      let response = await requestLmStudioChatCompletion(activeJob, model);
      let answer = extractLmStudioAnswer(response);
      let parsedResult = parseHeidiCourrierAtcdOutput(answer);
      let title = sanitizeHeidiCourrierTitle(parsedResult.title || "", parsedResult.specialtyCode || "");
      let imageRetryReason = "";

      if (shouldRetryLmStudioResultWithPdfImages(job, {
        answer,
        title,
        parsedResult,
      })) {
        const retryJob = await buildLmStudioPdfImageRetryJob(job, "administrative-no-useful-info", {
          title,
          answer,
        });

        if (retryJob) {
          imageRetryReason = retryJob.pdfImageFallbackReason || "administrative-no-useful-info";
          activeJob = retryJob;
          updateLmStudioStatus(job.id, "Réponse texte peu fiable : nouvelle analyse LM Studio en mode image...");
          appendDebugLog("lmstudio:image-retry-start", {
            jobId: job.id,
            reason: imageRetryReason,
            previousTitleLength: title.length,
            previousAnswerLength: answer.length,
            imageCount: getLmStudioPdfPageImages(retryJob).length,
            imagePages: getLmStudioPdfPageImages(retryJob).map((image) => image.pageNumber),
          });
          activeJobForError = activeJob;
          response = await requestLmStudioChatCompletion(activeJob, model);
          answer = extractLmStudioAnswer(response);
          parsedResult = parseHeidiCourrierAtcdOutput(answer);
          title = sanitizeHeidiCourrierTitle(parsedResult.title || "", parsedResult.specialtyCode || "");
        }
      }

      appendDebugLog("lmstudio:answer-received", {
        jobId: job.id,
        model,
        answerLength: answer.length,
        titleLength: title.length,
        sourceType: activeJob.sourceType || "pdf",
        imageRetryReason,
        pdfImageFallback: getLmStudioPdfPageImages(activeJob).length > 0,
        pdfImageFallbackReason: activeJob.pdfImageFallbackReason || "",
        pdfTextExtractionGarbled: Boolean(activeJob.pdfTextExtractionGarbled),
        hasTaggedTitle: Boolean(extractTaggedBlock(answer, "TITRE_COURRIER")),
        hasTaggedSpecialty: Boolean(extractTaggedBlock(answer, "SPECIALITE_COURRIER")),
        hasTaggedAtcd: Boolean(extractTaggedBlock(answer, "ANTECEDENT_CIM10")),
        specialtyCode: parsedResult.specialtyCode || "",
        atcdStatus: parsedResult.antecedent && parsedResult.antecedent.status || "",
      });

      if (!answer) {
        throw new Error("réponse LM Studio vide ou non reconnue");
      }

      if (!title) {
        throw new Error("réponse LM Studio sans titre utilisable");
      }

      GM_deleteValue(JOB_KEY);

      return {
        jobId: job.id,
        ok: true,
        raw: answer,
        title,
        specialtyCode: parsedResult.specialtyCode || "",
        antecedent: parsedResult.antecedent || null,
        sourceText: truncateResultSourceText(activeJob.tableText || ""),
        rowIndex: job.rowIndex,
        rowStableKey: job.rowStableKey || "",
        rowIdentity: job.rowIdentity || "",
        contentKey: job.contentKey || "",
        urlKey: job.urlKey || "",
        pdfUrl: job.pdfUrl || "",
        model,
        sourceType: activeJob.sourceType || job.sourceType || "pdf",
        pdfImageFallback: getLmStudioPdfPageImages(activeJob).length > 0,
        pdfImageFallbackReason: activeJob.pdfImageFallbackReason || "",
        pdfTextExtractionGarbled: Boolean(activeJob.pdfTextExtractionGarbled),
        imageRetryReason,
        createdAt: Date.now(),
      };
    } catch (error) {
      const errorMessage = buildLmStudioErrorMessage(error, activeJobForError);
      appendDebugLog("lmstudio:run-error", {
        jobId: job.id,
        error: errorMessage,
        pdfImageFallback: getLmStudioPdfPageImages(activeJobForError).length > 0,
      });

      GM_deleteValue(JOB_KEY);

      if (getLmStudioPdfPageImages(activeJobForError).length) {
        appendDebugLog("lmstudio:image-fail-closed-local-result", {
          jobId: job.id,
          sourceType: activeJobForError.sourceType || "",
          imageFallbackReason: activeJobForError.pdfImageFallbackReason || "",
          imageCount: getLmStudioPdfPageImages(activeJobForError).length,
          error: errorMessage,
        });

        return buildUnusablePdfLocalResultFromLmStudioImageJob(job.id, activeJobForError, errorMessage);
      }

      return {
        jobId: job.id,
        ok: false,
        error: errorMessage,
        rowIndex: job.rowIndex,
        rowStableKey: job.rowStableKey || "",
        rowIdentity: job.rowIdentity || "",
        contentKey: job.contentKey || "",
        urlKey: job.urlKey || "",
        pdfUrl: job.pdfUrl || "",
        createdAt: Date.now(),
      };
    }
  }

  function buildUnusablePdfLocalResultFromLmStudioImageJob(jobId, job = {}, errorMessage = "") {
    const row = {
      index: job.rowIndex,
      stableKey: job.rowStableKey || "",
      identityLabel: job.rowIdentity || "",
    };
    const displayedDocument = {
      sourceType: "pdf-image-fail-closed",
      urlKey: job.urlKey || "",
      pdfUrl: job.pdfUrl || "",
      pdfUnusableReason: job.pdfImageFallbackReason || "image-analysis-failed",
      pdfTextExtractionEmpty: Boolean(job.pdfTextExtractionEmpty),
      pdfTextExtractionSparse: Boolean(job.pdfTextExtractionSparse),
      pdfTextExtractionGarbled: Boolean(job.pdfTextExtractionGarbled),
    };
    const result = buildUnusablePdfLocalResult(jobId, row, displayedDocument, job.contentKey || "");

    return {
      ...result,
      sourceType: displayedDocument.sourceType,
      pdfImageFallback: true,
      pdfImageFallbackReason: job.pdfImageFallbackReason || "image-analysis-failed",
      pdfImageAnalysisError: errorMessage,
    };
  }

  function shouldRetryLmStudioResultWithPdfImages(job = {}, result = {}) {
    if (!LMSTUDIO_ADMINISTRATIVE_TITLE_IMAGE_RETRY_ENABLED || !job || !job.pdfUrl) {
      return false;
    }

    if (getLmStudioPdfPageImages(job).length) {
      return false;
    }

    const title = result.title || "";
    const answer = result.answer || "";
    const parsedResult = result.parsedResult || {};
    const specialtyCode = parseHeidiSpecialtyCode(parsedResult.specialtyCode || "");

    if (!looksLikeAdministrativeNoUsefulInfoAnswer(title, answer, specialtyCode)) {
      return false;
    }

    return isLmStudioJobTextProbablyPartial(job);
  }

  function looksLikeAdministrativeNoUsefulInfoAnswer(title = "", answer = "", specialtyCode = "") {
    const source = normalizeForCompare([title, answer].filter(Boolean).join("\n")).replace(/['’]/g, " ");

    return (
      /document administratif sans information medicale utile/.test(source) ||
      /\bsans information medicale utile\b/.test(source) ||
      (
        parseHeidiSpecialtyCode(specialtyCode) === "Papier Administratif" &&
        /\b(?:administratif|papier administratif)\b/.test(source) &&
        /\b(?:aucune|sans|pas d)\b.{0,50}\binformation medicale utile\b/.test(source)
      )
    );
  }

  function isLmStudioJobTextProbablyPartial(job = {}) {
    if (
      job.pdfTextExtractionSparse ||
      job.pdfTextExtractionGarbled ||
      job.pdfImageFallbackReason === "sparse-text" ||
      job.pdfImageFallbackReason === "garbled-text"
    ) {
      return true;
    }

    const sparseInfo = getSparseExtractedPdfTextInfo(job.tableText || "", {
      pageCount: job.pdfTextPageCount || job.pdfImageTotalPages || 1,
      byteLength: job.pdfAttachmentByteLength || 0,
    });
    const garbledInfo = getGarbledExtractedPdfTextInfo(job.tableText || "", {
      pageCount: job.pdfTextPageCount || job.pdfImageTotalPages || 1,
      byteLength: job.pdfAttachmentByteLength || 0,
    });

    return Boolean(sparseInfo.shouldFallback || garbledInfo.shouldFallback);
  }

  async function buildLmStudioPdfImageRetryJob(job = {}, reason = "retry-image", context = {}) {
    if (!job.pdfUrl || getLmStudioPdfPageImages(job).length) {
      return null;
    }

    const displayed = {
      pdfUrl: job.pdfUrl,
      urlKey: job.urlKey || (job.pdfUrl ? "pdfurl-" + hashString(job.pdfUrl) : ""),
      selectedOk: true,
    };
    const sparseInfo = getSparseExtractedPdfTextInfo(job.tableText || "", {
      pageCount: job.pdfTextPageCount || job.pdfImageTotalPages || 1,
      byteLength: job.pdfAttachmentByteLength || 0,
    });
    const garbledInfo = getGarbledExtractedPdfTextInfo(job.tableText || "", {
      pageCount: job.pdfTextPageCount || job.pdfImageTotalPages || 1,
      byteLength: job.pdfAttachmentByteLength || 0,
    });
    const fallback = await buildPdfImageFallbackFromDisplayedPdf(displayed, new Error("réponse LM Studio administrative après texte PDF pauvre"), {
      reason,
      sparseInfo: sparseInfo.shouldFallback ? sparseInfo : null,
      garbledInfo: garbledInfo.shouldFallback ? garbledInfo : null,
    });

    if (!fallback || !fallback.pdfPageImages || !fallback.pdfPageImages.length) {
      appendDebugLog("lmstudio:image-retry-unavailable", {
        jobId: job.id,
        reason,
        titleLength: context.title ? String(context.title).length : 0,
        sparseText: sparseInfo,
        garbledText: garbledInfo,
      });
      return null;
    }

    return {
      ...job,
      tableText: fallback.documentText,
      tableHtml: "",
      sourceType: fallback.sourceType || "pdf-image",
      pdfAttachmentBase64: "",
      pdfAttachmentName: fallback.pdfAttachmentName || job.pdfAttachmentName || "",
      pdfAttachmentMimeType: fallback.pdfAttachmentMimeType || job.pdfAttachmentMimeType || "application/pdf",
      pdfAttachmentByteLength: fallback.pdfAttachmentByteLength || job.pdfAttachmentByteLength || 0,
      pdfTextExtractionEmpty: Boolean(fallback.pdfTextExtractionEmpty),
      pdfTextExtractionSparse: Boolean(fallback.pdfTextExtractionSparse || sparseInfo.shouldFallback),
      pdfTextExtractionGarbled: Boolean(fallback.pdfTextExtractionGarbled || garbledInfo.shouldFallback),
      pdfTextPageCount: fallback.pdfTextPageCount || job.pdfTextPageCount || 0,
      pdfPageImages: fallback.pdfPageImages || [],
      pdfImagePageCount: fallback.pdfImagePageCount || 0,
      pdfImageTotalPages: fallback.pdfImageTotalPages || 0,
      pdfImageFallbackReason: reason,
    };
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
        timeout: 12000,
      });
      const models = Array.isArray(response && response.data) ? response.data : [];
      const firstModel = models.find((model) => model && model.id);
      if (firstModel && firstModel.id) {
        cachedLmStudioModelId = String(firstModel.id);
        appendDebugLog("lmstudio:model-detected", {
          model: cachedLmStudioModelId,
          modelCount: models.length,
        });
        return cachedLmStudioModelId;
      }

      appendDebugLog("lmstudio:model-list-empty", {
        modelCount: models.length,
      });
    } catch (error) {
      appendDebugLog("lmstudio:model-detect-error", {
        error: error.message,
      });
    }

    cachedLmStudioModelId = "local-model";
    return cachedLmStudioModelId;
  }

  async function requestLmStudioChatCompletion(job, model) {
    const userContent = buildLmStudioUserMessageContent(job);
    const payload = {
      model,
      temperature: LMSTUDIO_TEMPERATURE,
      max_tokens: LMSTUDIO_MAX_TOKENS,
      stream: false,
      messages: [
        {
          role: "system",
          content: "Tu suis strictement les consignes fournies par l'utilisateur. Réponds uniquement avec les trois blocs XML demandés, sans texte autour.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    };

    appendDebugLog("lmstudio:request", {
      jobId: job.id,
      model,
      promptLength: getLmStudioUserContentTextLength(userContent),
      pdfImageFallback: Array.isArray(userContent),
      imageCount: countLmStudioUserContentImages(userContent),
      imagePages: getLmStudioPdfPageImages(job).map((image) => image.pageNumber),
      imageFallbackReason: job.pdfImageFallbackReason || "",
      pdfTextExtractionGarbled: Boolean(job.pdfTextExtractionGarbled),
      maxTokens: LMSTUDIO_MAX_TOKENS,
      temperature: LMSTUDIO_TEMPERATURE,
    });

    return gmJsonRequest({
      method: "POST",
      url: LMSTUDIO_CHAT_COMPLETIONS_URL,
      timeout: LMSTUDIO_REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify(payload),
    });
  }

  function buildLmStudioUserPrompt(job) {
    const prompt = stripTrailingBiologySignal(job.prompt || LMSTUDIO_PROMPT_ACTIVE);
    return `${prompt}\n\n${buildHeidiContextText(truncateLmStudioDocumentText(job.tableText || ""))}`;
  }

  function buildLmStudioUserMessageContent(job) {
    const images = getLmStudioPdfPageImages(job);
    if (!images.length) {
      return buildLmStudioUserPrompt(job);
    }

    const text = [
      buildLmStudioUserPrompt(job),
      buildLmStudioPdfImageInstruction(job),
    ].join("\n\n");

    return [
      {
        type: "text",
        text,
      },
      ...images.map((image) => ({
        type: "image_url",
        image_url: {
          url: image.dataUrl,
        },
      })),
    ];
  }

  function getLmStudioPdfPageImages(job = {}) {
    return Array.isArray(job.pdfPageImages)
      ? job.pdfPageImages.filter((image) => image && image.dataUrl)
      : [];
  }

  function buildLmStudioPdfImageInstruction(job = {}) {
    if (job.pdfImageFallbackReason === "sparse-text") {
      return "IMPORTANT : le PDF n'a fourni qu'un texte partiel ou trop court. Les images jointes ci-dessous sont les pages du courrier. Ignore le texte partiel s'il contredit l'image, analyse visuellement ces images comme un OCR médical, puis réponds uniquement avec les trois blocs XML demandés.";
    }

    if (job.pdfImageFallbackReason === "garbled-text") {
      return "IMPORTANT : le texte extrait du PDF est encodé ou illisible et ne doit pas être utilisé. Les images jointes ci-dessous sont les pages du courrier. Lis-les visuellement comme un OCR médical, puis réponds uniquement avec les trois blocs XML demandés.";
    }

    if (job.pdfImageFallbackReason === "administrative-no-useful-info") {
      return "IMPORTANT : une première analyse du texte extrait a conclu à tort ou possiblement à tort à un document administratif sans information médicale utile. Les images jointes ci-dessous sont les pages du courrier. Repars des images, lis-les visuellement comme un OCR médical, puis réponds uniquement avec les trois blocs XML demandés.";
    }

    return "IMPORTANT : le PDF n'a pas fourni de texte extractible. Les images jointes ci-dessous sont les pages du courrier. Analyse-les visuellement comme un OCR médical, puis réponds uniquement avec les trois blocs XML demandés.";
  }

  function getLmStudioUserContentTextLength(content) {
    if (typeof content === "string") {
      return content.length;
    }

    if (!Array.isArray(content)) {
      return 0;
    }

    return content.reduce((total, part) => total + String(part && part.text || "").length, 0);
  }

  function countLmStudioUserContentImages(content) {
    if (!Array.isArray(content)) {
      return 0;
    }

    return content.filter((part) => part && part.type === "image_url").length;
  }

  function buildStoredLmStudioJob(job = {}) {
    const images = getLmStudioPdfPageImages(job);
    if (!images.length) {
      return job;
    }

    return {
      ...job,
      pdfPageImages: images.map((image) => ({
        pageNumber: image.pageNumber,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        dataUrlLength: image.dataUrlLength || String(image.dataUrl || "").length,
      })),
    };
  }

  function buildLmStudioErrorMessage(error, job = {}) {
    const message = error && error.message ? error.message : "erreur LM Studio inconnue";

    if (!getLmStudioPdfPageImages(job).length) {
      return message;
    }

    if (/vision|image|image_url|unsupported|schema|invalid|400|422|content/i.test(message)) {
      return message + " | PDF envoyé en images : vérifiez qu'un modèle vision/VLM est chargé dans LM Studio et que l'API accepte les images.";
    }

    return message;
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
      "[... document tronqué pour LM Studio local ...]",
      text.slice(-tailLength).trim(),
    ].filter(Boolean).join("\n\n");
  }

  function extractLmStudioAnswer(response) {
    const choices = Array.isArray(response && response.choices) ? response.choices : [];
    const firstChoice = choices[0] || {};
    const message = firstChoice.message || {};
    const content = typeof message.content === "string" ? message.content : firstChoice.text || "";

    return normalizeMultilineText(content);
  }

  function gmJsonRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest indisponible : vérifiez les permissions Tampermonkey du script"));
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
            reject(new Error(`réponse LM Studio non JSON : ${error.message}`));
          }
        },
        onerror: () => reject(new Error("connexion à LM Studio impossible")),
        ontimeout: () => reject(new Error("délai dépassé pendant l'appel à LM Studio")),
        onabort: () => reject(new Error("appel à LM Studio annulé")),
      });
    });
  }

  function updateLmStudioStatus(jobId, message, extra = {}) {
    appendDebugLog("lmstudio:status", {
      jobId,
      message,
      ...extra,
    });

    setPanelStatus(message);
    GM_setValue(STATUS_KEY, {
      jobId,
      message,
      ...extra,
      createdAt: Date.now(),
    });
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
    const nextCheckAt = state.autoEnabled ? Date.now() + getAutoIntervalMs() : state.autoNextCheckAt;
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

  function openWedaAntecedentWorkerIfNeeded(result, title, patientContext = {}) {
    const item = normalizeHeidiAntecedentForWeda(result && result.antecedent);

    if (!item) {
      if (result && result.antecedent && result.antecedent.rejectionReason) {
        appendDebugLog("weda:atcd-worker-skipped-rejected", {
          jobId: result.jobId,
          reason: result.antecedent.rejectionReason,
        });
      } else if (result && result.antecedent) {
        const code = normalizeCim10Code(result.antecedent.code);
        appendDebugLog("weda:atcd-worker-skipped-unusable-antecedent", {
          jobId: result.jobId,
          status: result.antecedent.status || "",
          section: result.antecedent.section || "",
          hasLabel: Boolean(sanitizeAntecedentLabel(result.antecedent.label)),
          code,
          codeValid: isLikelyCim10Code(code),
        });
      }
      return false;
    }

    const context = patientContext && patientContext.patientUrl
      ? patientContext
      : findWedaPatientContextForCurrentMessage();

    if (!context || !context.patientId || !context.patientUrl) {
      const patientLauncher = findWedaHelperPatientNameLauncher();
      if (patientLauncher) {
        return openWedaAntecedentWorkerViaWedaHelperPatientName(result, title, item, patientLauncher, context);
      }

      appendDebugLog("weda:atcd-worker-skipped-no-patient", {
        jobId: result && result.jobId,
        item,
        context,
        hasWedaHelperPatientName: false,
      });
      setPanelStatus("Titre inséré. Antécédent détecté, mais patient WEDA introuvable : ajout CIM-10 non lancé.");
      return false;
    }

    const workerJobId = createId("weda-atcd");
    const workerJob = buildWedaAntecedentWorkerJob(result, title, item, context, workerJobId);

    GM_setValue(WEDA_ATCD_JOB_KEY, workerJob);

    const workerUrl = buildWedaAtcdWorkerUrl(context.patientUrl, workerJobId);
    const background = WEDA_ATCD_WORKER_OPEN_IN_BACKGROUND;
    setPendingWedaAtcdWorkerOpen(workerJobId, result, item, context, "direct-patient-url");

    try {
      const workerTab = GM_openInTab(workerUrl, {
        active: !background,
        insert: !background,
        setParent: true,
      });
      trackWedaAtcdWorkerTab(workerJobId, workerTab, "direct-patient-url");
      scheduleWedaAtcdWorkerStartupWatchdog(workerJobId, workerUrl, 1);
      setPanelStatus(`Titre inséré. Worker WEDA ouvert pour préparer l'antécédent : ${item.label} [${item.code}].`);
      appendDebugLog("weda:atcd-worker-opened", {
        jobId: result.jobId,
        workerJobId,
        item,
        patientContext: context,
        background,
      });
      return true;
    } catch (error) {
      appendDebugLog("weda:atcd-worker-open-failed", {
        jobId: result.jobId,
        workerJobId,
        error: error.message,
      });
      clearPendingWedaAtcdWorkerOpen(workerJobId);
      setPanelStatus("Titre inséré. Échec ouverture worker WEDA pour l'antécédent : " + error.message);
      return false;
    }
  }

  function openWedaAntecedentWorkerViaWedaHelperPatientName(result, title, item, patientLauncher, missingContext = {}) {
    const workerJobId = createId("weda-atcd");
    const patientLabel = getWedaHelperPatientNameLabel(patientLauncher);
    const context = {
      patientId: "",
      patientUrl: "",
      patientLabel,
      source: "pdfParserPatientName",
      openMode: "ctrl-click-antecedents",
    };
    const workerJob = buildWedaAntecedentWorkerJob(result, title, item, context, workerJobId);
    const now = Date.now();

    GM_setValue(WEDA_ATCD_JOB_KEY, workerJob);
    setPendingWedaAtcdWorkerOpen(workerJobId, result, item, context, "pdf-parser-patient-name", {
      patientLabel,
      createdAt: now,
    });

    const clicked = clickWedaHelperPatientNameForAntecedents(patientLauncher);
    appendDebugLog(clicked ? "weda:atcd-worker-opened-via-pdf-parser-patient" : "weda:atcd-worker-pdf-parser-patient-click-failed", {
      jobId: result && result.jobId,
      workerJobId,
      item,
      missingContext,
      patientLabel,
      launcher: patientLauncher,
      pendingOpenMs: 0,
      persistentUntilAdopted: true,
    });

    if (!clicked) {
      GM_deleteValue(WEDA_ATCD_PENDING_OPEN_KEY);
      setPanelStatus("Titre inséré. Antécédent détecté, mais le raccourci patient Weda-Helper n'a pas pu être cliqué.");
      return false;
    }

    setPanelStatus(`Titre inséré. Ouverture Weda-Helper pour préparer l'antécédent : ${item.label} [${item.code}].`);
    return true;
  }

  function buildWedaAntecedentWorkerJob(result, title, item, context = {}, workerJobId = createId("weda-atcd")) {
    return {
      id: workerJobId,
      sourceJobId: result && result.jobId ? result.jobId : "",
      status: "PENDING_WEDA_WORKER",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: title || "",
      rowIndex: result ? result.rowIndex : null,
      rowStableKey: result && result.rowStableKey ? result.rowStableKey : "",
      rowIdentity: result && result.rowIdentity ? result.rowIdentity : "",
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
      rawHeidiAntecedent: result && result.antecedent ? result.antecedent : null,
      expiresAt: 0,
      validationExpiresAt: 0,
      persistentUntilManualValidation: true,
    };
  }

  function setPendingWedaAtcdWorkerOpen(workerJobId, result, item, context = {}, source = "", extra = {}) {
    const now = Number(extra.createdAt || 0) || Date.now();
    const pending = {
      workerJobId,
      sourceJobId: result && result.jobId ? result.jobId : "",
      sourceWedaUrl: location.href,
      source,
      patientId: context.patientId || "",
      patientUrl: context.patientUrl || "",
      patientLabel: extra.patientLabel || context.patientLabel || "",
      itemCode: item && item.code ? item.code : "",
      itemLabel: item && item.label ? item.label : "",
      createdAt: now,
      expiresAt: 0,
      persistentUntilAdopted: true,
    };

    GM_setValue(WEDA_ATCD_PENDING_OPEN_KEY, pending);
    appendDebugLog("weda:atcd-worker-pending-open-set", {
      workerJobId,
      source,
      patientId: pending.patientId,
      hasPatientUrl: Boolean(pending.patientUrl),
      itemCode: pending.itemCode,
      itemLabel: pending.itemLabel,
      expiresInMs: 0,
      persistentUntilAdopted: true,
    });
    return pending;
  }

  function clearPendingWedaAtcdWorkerOpen(workerJobId = "") {
    const pending = GM_getValue(WEDA_ATCD_PENDING_OPEN_KEY, null);
    if (!pending || (workerJobId && pending.workerJobId !== workerJobId)) {
      return false;
    }

    GM_deleteValue(WEDA_ATCD_PENDING_OPEN_KEY);
    return true;
  }

  function trackWedaAtcdWorkerTab(workerJobId = "", tab = null, reason = "") {
    const hasClosableHandle = Boolean(tab && typeof tab.close === "function");

    currentWedaAtcdWorkerTab = hasClosableHandle ? tab : null;
    currentWedaAtcdWorkerTabJobId = hasClosableHandle ? workerJobId || "" : "";

    appendDebugLog("weda:atcd-worker-tab-tracked", {
      workerJobId,
      reason,
      hasClosableHandle,
    });

    if (hasClosableHandle && "onclose" in tab) {
      try {
        tab.onclose = () => {
          appendDebugLog("weda:atcd-worker-tab-onclose", {
            workerJobId,
            reason,
          });
          if (!currentWedaAtcdWorkerTabJobId || currentWedaAtcdWorkerTabJobId === workerJobId) {
            currentWedaAtcdWorkerTab = null;
            currentWedaAtcdWorkerTabJobId = "";
          }
        };
      } catch (error) {
        appendDebugLog("weda:atcd-worker-tab-onclose-failed", {
          workerJobId,
          reason,
          error: error && error.message ? error.message : String(error),
        });
      }
    }
  }

  function requestWedaAtcdWorkerCloseFromOpener(workerJobId = "", reason = "", delayMs = 0) {
    if (!workerJobId) {
      return null;
    }

    const request = {
      id: createId("weda-atcd-close"),
      workerJobId,
      reason: reason || "close-request",
      delayMs: Math.max(0, Number(delayMs) || 0),
      createdAt: Date.now(),
      requesterUrl: location.href,
    };

    GM_setValue(WEDA_ATCD_CLOSE_REQUEST_KEY, request);
    appendDebugLog("weda-atcd-worker:close-request-sent-to-opener", {
      workerJobId,
      reason: request.reason,
      delayMs: request.delayMs,
      requestId: request.id,
    });

    return request;
  }

  function handleWedaAtcdWorkerCloseRequest(request, source = "") {
    if (!request || !request.workerJobId) {
      return false;
    }

    const workerJobId = request.workerJobId;
    const reason = request.reason || "close-request";
    const requestId = request.id || `${workerJobId}:${reason}`;
    const delayMs = Math.max(0, Number(request.delayMs) || 0);
    const createdAt = Number(request.createdAt || 0);

    if (createdAt && Date.now() - createdAt > WEDA_ATCD_CLOSE_REQUEST_MAX_AGE_MS) {
      appendDebugLog("weda:atcd-worker-close-request-stale", {
        workerJobId,
        reason,
        source,
        requestId,
        ageMs: Date.now() - createdAt,
      });
      GM_deleteValue(WEDA_ATCD_CLOSE_REQUEST_KEY);
      return false;
    }

    if (wedaAtcdWorkerCloseTimers.has(requestId)) {
      return true;
    }

    appendDebugLog("weda:atcd-worker-close-request-received", {
      workerJobId,
      reason,
      source,
      delayMs,
      requestId,
      hasTrackedTab: Boolean(currentWedaAtcdWorkerTab),
      trackedWorkerJobId: currentWedaAtcdWorkerTabJobId || "",
    });

    const timer = window.setTimeout(() => {
      wedaAtcdWorkerCloseTimers.delete(requestId);
      closeTrackedWedaAtcdWorkerTab(workerJobId, reason, source || "close-request");
      const currentRequest = GM_getValue(WEDA_ATCD_CLOSE_REQUEST_KEY, null);
      if (currentRequest && currentRequest.id === requestId) {
        GM_deleteValue(WEDA_ATCD_CLOSE_REQUEST_KEY);
      }
    }, delayMs);

    wedaAtcdWorkerCloseTimers.set(requestId, timer);
    return true;
  }

  function closeTrackedWedaAtcdWorkerTab(workerJobId = "", reason = "", source = "") {
    if (!currentWedaAtcdWorkerTab || typeof currentWedaAtcdWorkerTab.close !== "function") {
      appendDebugLog("weda:atcd-worker-close-by-opener-skip", {
        workerJobId,
        reason,
        source,
        hasTrackedTab: Boolean(currentWedaAtcdWorkerTab),
        trackedWorkerJobId: currentWedaAtcdWorkerTabJobId || "",
      });
      return false;
    }

    if (currentWedaAtcdWorkerTabJobId && workerJobId && currentWedaAtcdWorkerTabJobId !== workerJobId) {
      appendDebugLog("weda:atcd-worker-close-by-opener-mismatch", {
        workerJobId,
        reason,
        source,
        trackedWorkerJobId: currentWedaAtcdWorkerTabJobId,
      });
      return false;
    }

    try {
      appendDebugLog("weda:atcd-worker-close-by-opener", {
        workerJobId,
        reason,
        source,
      });
      currentWedaAtcdWorkerTab.close();
      currentWedaAtcdWorkerTab = null;
      currentWedaAtcdWorkerTabJobId = "";
      return true;
    } catch (error) {
      appendDebugLog("weda:atcd-worker-close-by-opener-failed", {
        workerJobId,
        reason,
        source,
        error: error && error.message ? error.message : String(error),
      });
      return false;
    }
  }

  function scheduleWedaAtcdWorkerStartupWatchdog(workerJobId, workerUrl, attempt = 1) {
    window.setTimeout(() => {
      const job = GM_getValue(WEDA_ATCD_JOB_KEY, null);
      if (!job || job.id !== workerJobId) {
        return;
      }

      if (job.status && job.status !== "PENDING_WEDA_WORKER") {
        return;
      }

      appendDebugLog("weda:atcd-worker-startup-timeout", {
        workerJobId,
        attempt,
        status: job.status || "",
        workerUrlHash: hashString(workerUrl || ""),
      });

      if (attempt > 1 || !workerUrl) {
        setPanelStatus("Antécédent détecté, mais le worker WEDA ne démarre pas. Onglet patient ouvert à vérifier.");
        return;
      }

      try {
        const reopenedTab = GM_openInTab(workerUrl, {
          active: true,
          insert: true,
          setParent: true,
        });
        trackWedaAtcdWorkerTab(workerJobId, reopenedTab, "startup-watchdog-reopen");
        setPanelStatus("Le worker ATCD ne démarrait pas en arrière-plan : réouverture au premier plan...");
        scheduleWedaAtcdWorkerStartupWatchdog(workerJobId, workerUrl, attempt + 1);
      } catch (error) {
        appendDebugLog("weda:atcd-worker-startup-reopen-failed", {
          workerJobId,
          attempt,
          error: error && error.message ? error.message : String(error),
        });
      }
    }, WEDA_ATCD_WORKER_STARTUP_WATCHDOG_MS);
  }

  function findWedaHelperPatientNameLauncher() {
    const candidates = Array.from(document.querySelectorAll(SELECTOR_WEDA_HELPER_PATIENT_NAME));
    return candidates.find((element) => isElementVisible(element)) || candidates[0] || null;
  }

  function getWedaHelperPatientNameLabel(element) {
    return normalizeText(String(element && element.textContent || "").replace(/^Vers dossier\s*:\s*/i, ""));
  }

  function clickWedaHelperPatientNameForAntecedents(element) {
    if (!element) {
      return false;
    }

    try {
      element.scrollIntoView({ block: "center", inline: "center" });
    } catch (_error) {
      // Le raccourci peut rester cliquable même si le scroll échoue.
    }

    try {
      element.focus();
    } catch (_error) {
      // Le span Weda-Helper n'est pas toujours focusable.
    }

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((eventName) => {
      dispatchModifiedMouseEvent(element, eventName, {
        ctrlKey: true,
        button: 0,
        buttons: eventName.endsWith("down") ? 1 : 0,
      });
    });

    return true;
  }

  function dispatchModifiedMouseEvent(element, eventName, options = {}) {
    try {
      const EventConstructor = eventName.startsWith("pointer") && typeof PointerEvent === "function"
        ? PointerEvent
        : MouseEvent;

      element.dispatchEvent(new EventConstructor(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: Number(options.button) || 0,
        buttons: Number(options.buttons) || 0,
        ctrlKey: Boolean(options.ctrlKey),
        shiftKey: Boolean(options.shiftKey),
        altKey: Boolean(options.altKey),
        metaKey: Boolean(options.metaKey),
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }));
      return true;
    } catch (_error) {
      try {
        element.dispatchEvent(new Event(eventName, {
          bubbles: true,
          cancelable: true,
        }));
        return true;
      } catch (_nestedError) {
        return false;
      }
    }
  }

  function normalizeHeidiAntecedentForWeda(antecedent) {
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
      description: label,
      code,
      date: sanitizeAntecedentDate(antecedent.date),
      certainty: normalizeText(antecedent.certainty || ""),
      source: normalizeText(antecedent.source || ""),
      comment: label,
    };
  }

  function findWedaPatientContextForCurrentMessage(anchor = null) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (value, source) => {
      const patientId = extractWedaPatDkFromUrl(value);
      if (!patientId) {
        return;
      }

      const patientUrl = buildWedaPatientUrlFromPatDk(patientId, value);
      const key = `${patientId}|${patientUrl}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      candidates.push({
        patientId,
        patientUrl,
        source,
      });
    };

    addCandidate(location.href, "location");

    const roots = [
      anchor && getWedaTitleAttachmentRoot(anchor),
      anchor && anchor.closest && anchor.closest("#messageContainer"),
      document.querySelector("#messageContainer"),
      document.body,
    ].filter(Boolean)
      .filter((root, index, list) => list.indexOf(root) === index);

    roots.forEach((root, rootIndex) => {
      collectWedaPatientCandidateValues(root, { excludePatientImportRows: true }).forEach((value) => {
        addCandidate(value, rootIndex === 0 ? "title-root" : rootIndex === 1 ? "message-root" : "document");
      });
    });

    return candidates[0] || {
      patientId: "",
      patientUrl: "",
      source: "not-found",
    };
  }

  function collectWedaPatientCandidateValues(root, options = {}) {
    const values = [];
    const excludePatientImportRows = options.excludePatientImportRows !== false;
    const attributes = [
      "href",
      "action",
      "src",
      "value",
      "onclick",
      "data-url",
      "data-href",
      "data-link",
      "ng-click",
    ];
    const add = (value) => {
      const text = String(value || "");
      if (/PatDk=/i.test(text)) {
        values.push(text);
      }
    };

    if (!root || typeof root.querySelectorAll !== "function") {
      return values;
    }

    const addElementValues = (element) => {
      if (!element || (excludePatientImportRows && isInsideWedaPatientImportCandidateTable(element))) {
        return;
      }

      attributes.forEach((attribute) => add(element.getAttribute(attribute)));
    };

    const selectors = [
      "a[href]",
      "form[action]",
      "iframe[src]",
      "frame[src]",
      "input[value]",
      "[onclick]",
      "[data-url]",
      "[data-href]",
      "[data-link]",
      "[href]",
      "[src]",
    ].join(",");

    try {
      if (typeof root.matches === "function" && root.matches(selectors)) {
        addElementValues(root);
      }

      Array.from(root.querySelectorAll(selectors)).slice(0, 2500).forEach((element) => {
        addElementValues(element);
      });
    } catch (_error) {
      // Best effort : l'absence de PatDk sera gérée par la garde patient.
    }

    return values;
  }

  function isInsideWedaPatientImportCandidateTable(element) {
    if (!element || typeof element.closest !== "function") {
      return false;
    }

    const table = element.closest("table");
    if (!table) {
      return false;
    }

    const text = normalizeForCompare(table.textContent || "");
    return /\bpatient\b/.test(text) &&
      /naissance/.test(text) &&
      /importer\s+le\s+message/.test(text);
  }

  function extractWedaPatDkFromUrl(value) {
    const text = String(value || "").replace(/&amp;/g, "&");
    if (!text) {
      return "";
    }

    try {
      const parsed = new URL(text, location.href);
      const patDk = parsed.searchParams.get("PatDk") || "";
      if (patDk) {
        return normalizeText(patDk);
      }
    } catch (_error) {
      // Fallback regex ci-dessous.
    }

    const match = text.match(/[?&]PatDk=([^&#'")\s]+)/i);
    if (!match) {
      return "";
    }

    try {
      return normalizeText(decodeURIComponent(String(match[1] || "").replace(/\+/g, " ")));
    } catch (_error) {
      return normalizeText(match[1] || "");
    }
  }

  function buildWedaPatientUrlFromPatDk(patientId, sourceUrl = "") {
    const patientPath = "/FolderMedical/PatientViewForm.aspx";
    try {
      const parsed = new URL(sourceUrl || patientPath, `https://${WEDA_HOST}`);
      if (/\/foldermedical\/patientviewform\.aspx/i.test(parsed.pathname)) {
        parsed.searchParams.set("PatDk", patientId);
        parsed.hash = "";
        return parsed.href;
      }
    } catch (_error) {
      // URL canonique ci-dessous.
    }

    return `https://${WEDA_HOST}${patientPath}?PatDk=${encodeURIComponent(patientId)}`;
  }

  function buildWedaAtcdWorkerUrl(url, jobId) {
    const base = String(url || `https://${WEDA_HOST}/`).split("#")[0];
    return `${base}#${WEDA_ATCD_WORKER_HASH_PREFIX}${encodeURIComponent(jobId)}`;
  }

  function isWedaAtcdWorkerJobId(jobId) {
    return /^weda-atcd(?:-|$)/i.test(String(jobId || ""));
  }

  function getWedaAtcdHashValue(prefix) {
    const hash = String(location.hash || "").replace(/^#/, "");
    const paramName = String(prefix || "").replace(/=$/, "");

    if (!hash || !paramName) {
      return "";
    }

    try {
      const value = new URLSearchParams(hash).get(paramName);
      if (value) return value;
    } catch (_error) {
      // Fallback manuel ci-dessous.
    }

    const part = hash.split(/[&]/).find((piece) => piece.startsWith(prefix));
    if (!part) return "";

    try {
      return decodeURIComponent(part.slice(prefix.length));
    } catch (_error) {
      return part.slice(prefix.length);
    }
  }

  function getWedaAtcdWorkerJobIdFromHash() {
    const fromCurrentHash = getWedaAtcdHashValue(WEDA_ATCD_WORKER_HASH_PREFIX);
    if (fromCurrentHash) {
      if (isWedaAtcdWorkerJobId(fromCurrentHash)) return fromCurrentHash;

      appendDebugLog("weda-atcd-worker:ignored-invalid-worker-hash", {
        hashPrefix: WEDA_ATCD_WORKER_HASH_PREFIX,
        workerJobId: fromCurrentHash,
      });
      return "";
    }

    const fromLegacyHash = getWedaAtcdHashValue(WEDA_ATCD_WORKER_HASH_PREFIX_LEGACY);
    if (!fromLegacyHash) return "";
    if (isWedaAtcdWorkerJobId(fromLegacyHash)) return fromLegacyHash;

    appendDebugLog("weda-atcd-worker:ignored-foreign-worker-hash", {
      hashPrefix: WEDA_ATCD_WORKER_HASH_PREFIX_LEGACY,
      workerJobId: fromLegacyHash,
    });
    return "";
  }

  function getWedaAtcdWorkerJobIdForThisTab() {
    const fromHash = getWedaAtcdWorkerJobIdFromHash();
    if (fromHash) {
      try {
        sessionStorage.setItem(SESSION_WEDA_ATCD_WORKER_JOB_ID_KEY, fromHash);
      } catch (_error) {
        // sessionStorage peut être indisponible.
      }
      clearPendingWedaAtcdWorkerOpen(fromHash);
      return fromHash;
    }

    try {
      const fromSession = sessionStorage.getItem(SESSION_WEDA_ATCD_WORKER_JOB_ID_KEY) || "";
      if (fromSession) {
        if (!isWedaAtcdWorkerJobId(fromSession)) {
          sessionStorage.removeItem(SESSION_WEDA_ATCD_WORKER_JOB_ID_KEY);
          appendDebugLog("weda-atcd-worker:ignored-foreign-worker-session", {
            workerJobId: fromSession,
          });
        } else {
          return fromSession;
        }
      }
    } catch (_error) {
      // Si sessionStorage est indisponible, on tente quand même l'adoption du job en attente.
    }

    return adoptPendingWedaAtcdWorkerJobForThisTab();
  }

  function adoptPendingWedaAtcdWorkerJobForThisTab() {
    if (!isLikelyWedaAtcdPendingOpenTargetPage()) {
      return "";
    }

    const pending = GM_getValue(WEDA_ATCD_PENDING_OPEN_KEY, null);
    const now = Date.now();
    if (!pending || !pending.workerJobId) {
      return "";
    }

    if (Number(pending.expiresAt || 0) > 0) {
      appendDebugLog("weda-atcd-worker:pending-open-expiration-ignored", {
        workerJobId: pending.workerJobId || "",
        sourceWedaUrl: pending.sourceWedaUrl || "",
        legacyExpiresAt: Number(pending.expiresAt || 0),
        ageMs: now - Number(pending.createdAt || 0),
      });
    }

    const job = GM_getValue(WEDA_ATCD_JOB_KEY, null);
    if (!job || job.id !== pending.workerJobId) {
      appendDebugLog("weda-atcd-worker:pending-open-job-missing", {
        pending,
        currentJobId: job && job.id ? job.id : "",
      });
      return "";
    }

    const currentPatientId = extractWedaPatDkFromUrl(location.href);
    if (
      pending.patientId &&
      currentPatientId &&
      !sameWedaPatDk(pending.patientId, currentPatientId)
    ) {
      appendDebugLog("weda-atcd-worker:pending-open-patient-mismatch", {
        workerJobId: pending.workerJobId,
        expectedPatientId: pending.patientId,
        currentPatientId,
        path: location.pathname,
        search: location.search,
      });
      return "";
    }

    const patch = {
      patientContextSource: job.patientContextSource || "pdfParserPatientName",
      patientOpenMode: job.patientOpenMode || "pending-open-adopted",
      workerUrl: location.href,
      adoptedFromPendingOpen: true,
    };

    if (currentPatientId && !job.patientId) {
      patch.patientId = currentPatientId;
      patch.patientUrl = buildWedaPatientUrlFromPatDk(currentPatientId, location.href);
    }

    updateWedaAtcdWorkerJob(pending.workerJobId, patch);

    try {
      sessionStorage.setItem(SESSION_WEDA_ATCD_WORKER_JOB_ID_KEY, pending.workerJobId);
    } catch (_error) {
      // sessionStorage peut être indisponible.
    }

    GM_deleteValue(WEDA_ATCD_PENDING_OPEN_KEY);
    appendDebugLog("weda-atcd-worker:pending-open-adopted", {
      workerJobId: pending.workerJobId,
      path: location.pathname,
      search: location.search,
      currentPatientId,
      patientLabel: pending.patientLabel || job.patientLabel || "",
      itemCode: pending.itemCode || "",
      itemLabel: pending.itemLabel || "",
    });

    return pending.workerJobId;
  }

  function isLikelyWedaAtcdPendingOpenTargetPage() {
    if (location.hostname !== WEDA_HOST) {
      return false;
    }

    if (location.pathname.toLowerCase().startsWith(WEDA_PATH_PREFIX.toLowerCase())) {
      return false;
    }

    return /\/foldermedical\/(?:patientviewform|antecedentform)\.aspx/i.test(location.pathname) ||
      Boolean(document.querySelector(SELECTOR_PATIENT_PANEL)) ||
      Boolean(document.querySelector(SELECTOR_WEDA_ANTECEDENT_UPDATE_PANEL));
  }

  async function initWedaAtcdWorker() {
    const workerJobId = getWedaAtcdWorkerJobIdForThisTab();
    if (!workerJobId) {
      return;
    }

    appendDebugLog("weda-atcd-worker:init", {
      workerJobId,
      version: getScriptVersion(),
    });

    showWedaAtcdWorkerBadge("Préparation de l'antécédent CIM-10...", { sticky: true });

    try {
      await runWedaAtcdWorker(workerJobId);
    } catch (error) {
      appendDebugLog("weda-atcd-worker:error", {
        workerJobId,
        error: error.message,
      });
      updateWedaAtcdWorkerJob(workerJobId, {
        status: "ERROR",
        error: error.message,
      });
      showWedaAtcdWorkerBadge("Erreur ajout antécédent : " + error.message, {
        error: true,
        sticky: true,
      });
    }
  }

  async function runWedaAtcdWorker(workerJobId) {
    let job = await waitFor(() => {
      const current = GM_getValue(WEDA_ATCD_JOB_KEY, null);
      return current && current.id === workerJobId ? current : null;
    }, {
      timeout: 30000,
      interval: 250,
      description: "le travail WEDA antécédent",
    });

    if (!acquireWedaAtcdWorkerLock(job)) {
      showWedaAtcdWorkerBadge("Un autre onglet prépare déjà cet antécédent.", {
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
          `Antécédent déjà présent ou très proche dans WEDA : ${job.item.label} [${job.item.code}].\nAucune fenêtre d'ajout n'a été ouverte.`,
          { sticky: true }
        );
        closeWedaAtcdWorkerSoon(workerJobId, "already-known");
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
        validationExpiresAt: 0,
        persistentUntilManualValidation: true,
      });

      showWedaAtcdWorkerBadge(
        `Fenêtre d'ajout préparée : ${job.item.label} [${found.matchedCode || job.item.code}].\nÀ vérifier puis valider manuellement dans WEDA.\nCette préparation reste active sans limite de durée côté script.`,
        { sticky: true }
      );

      try {
        validButton.focus();
      } catch (_error) {
        // Le bouton reste volontairement non cliqué.
      }
    } finally {
      releaseWedaAtcdWorkerLock(job);
    }
  }

  function refreshWedaAtcdWorkerJobPatientFromCurrentUrl(workerJobId) {
    const current = GM_getValue(WEDA_ATCD_JOB_KEY, null);
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
    const current = GM_getValue(WEDA_ATCD_JOB_KEY, null);
    if (!current || current.id !== workerJobId) {
      return null;
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    GM_setValue(WEDA_ATCD_JOB_KEY, next);
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
    const key = `${STORAGE_PREFIX}wedaAtcdWorkerTabId`;
    try {
      let id = sessionStorage.getItem(key);
      if (!id) {
        id = createId("tab");
        sessionStorage.setItem(key, id);
      }
      return id;
    } catch (_error) {
      return createId("tab");
    }
  }

  function isPatientViewUrlWeda() {
    return location.hostname === WEDA_HOST &&
      /\/foldermedical\/patientviewform\.aspx/i.test(location.pathname);
  }

  function isPatientAccueilWeda() {
    return isPatientViewUrlWeda() &&
      Boolean(document.querySelector(SELECTOR_PATIENT_PANEL));
  }

  function isAntecedentUrlWeda() {
    return location.hostname === WEDA_HOST && /\/foldermedical\/antecedentform\.aspx/i.test(location.pathname);
  }

  function getWedaAntecedentRootForAtcd() {
    return document.querySelector(SELECTOR_WEDA_ANTECEDENT_UPDATE_PANEL) || null;
  }

  function isAntecedentPageWeda() {
    return location.hostname === WEDA_HOST && (isAntecedentUrlWeda() || Boolean(getWedaAntecedentRootForAtcd()));
  }

  async function waitForWedaAntecedentRootForAtcd(timeoutMs = 20000) {
    return waitFor(() => getWedaAntecedentRootForAtcd(), {
      timeout: timeoutMs,
      interval: 500,
      description: "la page Antécédents WEDA",
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
    showWedaAtcdWorkerBadge("Ouverture de la page Antécédents WEDA...", { sticky: true });

    const clicked = clickGotoAntecedentsWeda(job);
    if (!clicked) {
      throw new Error("bouton Antécédents WEDA introuvable");
    }

    try {
      await waitForWedaAntecedentRootForAtcd(12000);
    } catch (error) {
      if (isAntecedentPageWeda()) {
        throw error;
      }

      appendDebugLog("weda-atcd-worker:goto-antecedents-wait-retry", {
        workerJobId: job && job.id,
        error: error && error.message ? error.message : String(error),
        path: location.pathname,
        search: location.search,
      });

      const fallbackClicked = callWedaPostBack(POSTBACK_ANTECEDENTS_WEDA, "");
      appendDebugLog(fallbackClicked ? "weda-atcd-worker:goto-antecedents-postback-retry" : "weda-atcd-worker:goto-antecedents-postback-retry-missing", {
        workerJobId: job && job.id,
      });

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
      first: candidates[0] || null,
      visibleFirst: clickable || null,
      hasPostBack: typeof ((typeof unsafeWindow !== "undefined" && unsafeWindow.__doPostBack) || window.__doPostBack) === "function",
    });

    if (clickable) {
      clickButtonLikeUser(clickable);
      appendDebugLog("weda-atcd-worker:goto-antecedents-click", {
        workerJobId: job && job.id,
        clickable,
      });
      return true;
    }

    const posted = callWedaPostBack(POSTBACK_ANTECEDENTS_WEDA, "");
    appendDebugLog(posted ? "weda-atcd-worker:goto-antecedents-postback" : "weda-atcd-worker:goto-antecedents-missing", {
      workerJobId: job && job.id,
    });
    return posted;
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
        // Sélecteur best effort.
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
        // Pas d'async postback détectable.
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

    if (!expected && job && job.patientContextSource === "pdfParserPatientName") {
      appendDebugLog("weda-atcd-worker:patient-guard-skipped-no-patdk", {
        phase,
        current,
        patientLabel: job.patientLabel || "",
        source: job.patientContextSource,
        openMode: job.patientOpenMode || "",
      });
      return;
    }

    if (!expected || !current || !sameWedaPatDk(expected, current)) {
      throw new Error(`sécurité patient (${phase}) : attendu ${expected || "inconnu"}, onglet ${current || "inconnu"}`);
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

  function getCim10CategoryRoot(code) {
    const match = normalizeCim10Code(code).match(/^([A-Z][0-9][0-9A-Z])/);
    return match ? match[1] : "";
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
      throw new Error("requête CIM-10 vide");
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
        description: "le résultat CIM-10 exact",
      }).catch(() => null);
      if (exact) {
        return exact;
      }
    }

    const parentCodes = getParentCim10Codes(cleanCode);
    for (const parentCode of parentCodes) {
      for (const query of getCim10SearchQueriesForCode(parentCode)) {
        await performWedaCim10SearchQuery(query);
        const best = await waitFor(() => findBestCim10ResultBySimilarity(parentCode, referenceName || cleanCode), {
          timeout: 10000,
          interval: 400,
          description: "un résultat CIM-10 parent",
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
      // Le drag synthétique est tenté quand même.
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

    throw lastError || new Error("dépôt CIM-10 impossible");
  }

  async function dropWedaCim10OnCategoryForAtcd(hand, section) {
    const targets = getWedaDropTargetsForAtcdSection(section);
    if (!targets.length) {
      throw new Error("aucune rubrique WEDA trouvée pour " + section);
    }

    for (const target of targets) {
      try {
        target.scrollIntoView({ block: "center", inline: "center" });
      } catch (_error) {
        // Le clic reste tenté.
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
        // Déjà tenté via événements synthétiques.
      }

      const popup = await waitForWedaAntecedentPopupForAtcd(3500);
      if (popup) {
        return true;
      }

      await sleep(300);
      armWedaCim10Hand(hand);
      await sleep(250);
      clickButtonLikeUser(target);

      const popupAfterClick = await waitForWedaAntecedentPopupForAtcd(3500);
      if (popupAfterClick) {
        return true;
      }
    }

    throw new Error("la fenêtre de détail antécédent WEDA ne s'est pas ouverte");
  }

  function getWedaDropTargetsForAtcdSection(section) {
    const root = getWedaAntecedentRootForAtcd() || document.body;
    const expected = expectedAtcdSectionHeader(section);
    const candidates = Array.from(root.querySelectorAll("div, span, td, th, a, table, tr"))
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

    return candidates;
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
      description: "la fenêtre de détail antécédent",
    }).catch(() => null);
  }

  async function fillWedaAntecedentPopupForUser(item, job = null) {
    const textarea = await waitFor(() => {
      const element = document.querySelector(SELECTOR_WEDA_COMMENT);
      return element && isElementVisible(element) ? element : null;
    }, {
      timeout: 15000,
      interval: 300,
      description: "le champ commentaire de l'antécédent",
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
      badge.style.maxWidth = "360px";
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
            // Badge déjà supprimé.
          }
        }, options.duration || 8000);
      }
    } catch (_error) {
      // Notification non critique.
    }
  }

  function closeWedaAtcdWorkerSoon(
    workerJobId = "",
    reason = "",
    delayMs = WEDA_ATCD_ALREADY_KNOWN_CLOSE_DELAY_MS,
    maxAttempts = WEDA_ATCD_WORKER_CLOSE_MAX_ATTEMPTS
  ) {
    const safeDelayMs = Math.max(0, Number(delayMs) || 0);
    const safeMaxAttempts = Math.max(1, Number(maxAttempts) || WEDA_ATCD_WORKER_CLOSE_MAX_ATTEMPTS);

    appendDebugLog("weda-atcd-worker:close-scheduled", {
      workerJobId,
      reason,
      delayMs: safeDelayMs,
      maxAttempts: safeMaxAttempts,
    });

    requestWedaAtcdWorkerCloseFromOpener(workerJobId, reason, safeDelayMs);
    window.setTimeout(() => attemptCloseWedaAtcdWorker(workerJobId, reason, 1, safeMaxAttempts), safeDelayMs);
  }

  function attemptCloseWedaAtcdWorker(workerJobId = "", reason = "", attempt = 1, maxAttempts = WEDA_ATCD_WORKER_CLOSE_MAX_ATTEMPTS) {
    appendDebugLog("weda-atcd-worker:close-attempt", {
      workerJobId,
      reason,
      attempt,
    });

    try {
      if (typeof GM_closeTab === "function") {
        GM_closeTab();
      }
    } catch (error) {
      appendDebugLog("weda-atcd-worker:gm-close-tab-failed", {
        workerJobId,
        reason,
        attempt,
        error: error && error.message ? error.message : String(error),
      });
    }

    try {
      if (typeof GM !== "undefined" && GM && typeof GM.closeTab === "function") {
        GM.closeTab();
      }
    } catch (error) {
      appendDebugLog("weda-atcd-worker:gm-close-tab-failed", {
        workerJobId,
        reason,
        attempt,
        api: "GM.closeTab",
        error: error && error.message ? error.message : String(error),
      });
    }

    try {
      window.close();
    } catch (error) {
      appendDebugLog("weda-atcd-worker:close-failed", {
        workerJobId,
        reason,
        attempt,
        error: error && error.message ? error.message : String(error),
      });
    }

    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow && unsafeWindow !== window && typeof unsafeWindow.close === "function") {
        unsafeWindow.close();
      }
    } catch (error) {
      appendDebugLog("weda-atcd-worker:unsafe-window-close-failed", {
        workerJobId,
        reason,
        attempt,
        error: error && error.message ? error.message : String(error),
      });
    }

    try {
      const selfWindow = window.open("", "_self");
      if (selfWindow && typeof selfWindow.close === "function") {
        selfWindow.close();
      }
    } catch (error) {
      appendDebugLog("weda-atcd-worker:self-window-close-failed", {
        workerJobId,
        reason,
        attempt,
        error: error && error.message ? error.message : String(error),
      });
    }

    if (attempt < maxAttempts) {
      window.setTimeout(() => attemptCloseWedaAtcdWorker(workerJobId, reason, attempt + 1, maxAttempts), WEDA_ATCD_WORKER_CLOSE_RETRY_MS);
      return;
    }

    appendDebugLog("weda-atcd-worker:close-attempts-ended", {
      workerJobId,
      reason,
      attempts: maxAttempts,
    });

    if (workerJobId) {
      const job = GM_getValue(WEDA_ATCD_JOB_KEY, null);
      if (job && job.id === workerJobId && job.status === "ALREADY_KNOWN") {
        updateWedaAtcdWorkerJob(workerJobId, {
          closeAttemptsEndedAt: Date.now(),
          closeAttemptsEndedReason: reason || "",
        });
      }
    }

    renderClosedWedaAtcdWorkerFallback(workerJobId, reason);
  }

  function renderClosedWedaAtcdWorkerFallback(workerJobId = "", reason = "") {
    try {
      document.title = "Antécédent déjà connu - worker fermé";
      document.documentElement.innerHTML = [
        "<head><title>Antécédent déjà connu</title></head>",
        "<body style=\"margin:0;font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;\">",
        "<div style=\"max-width:520px;padding:24px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;box-shadow:0 12px 34px rgba(15,23,42,.12);\">",
        "<h1 style=\"margin:0 0 8px;font-size:18px;\">Antécédent déjà présent dans WEDA</h1>",
        "<p style=\"margin:0 0 14px;line-height:1.45;\">Aucune validation n'est nécessaire. Le navigateur a refusé la fermeture automatique de cet onglet.</p>",
        "<button type=\"button\" id=\"weda-atcd-close-fallback\" style=\"border:1px solid #174ea6;background:#174ea6;color:#fff;border-radius:6px;padding:8px 12px;font-weight:700;cursor:pointer;\">Fermer l'onglet</button>",
        "</div></body>",
      ].join("");
      const closeButton = document.getElementById("weda-atcd-close-fallback");
      if (closeButton) {
        closeButton.addEventListener("click", () => {
          attemptCloseWedaAtcdWorker(workerJobId, reason || "fallback-button", 1, 3);
        });
      }
    } catch (error) {
      appendDebugLog("weda-atcd-worker:close-fallback-render-failed", {
        workerJobId,
        reason,
        error: error && error.message ? error.message : String(error),
      });
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

    if (job.pdfAttachmentBase64 && !job.pdfTextExtractionEmpty) {
      updateHeidiStatus(job.id, "Ajout du PDF original dans Heidi...");
      job.pdfAttachmentInserted = await attachHeidiPdfIfNeeded(job, askEditor);
      abortIfHeidiJobCancelled(job.id);
    } else if (job.pdfAttachmentBase64) {
      appendDebugLog("heidi:pdf-attachment-skipped-empty-extraction", {
        jobId: job.id,
        sourceType: job.sourceType || "",
        pdfTextExtractionEmpty: Boolean(job.pdfTextExtractionEmpty),
        byteLength: job.pdfAttachmentByteLength || 0,
      });
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
    const parsedAnswer = parseHeidiCourrierAtcdOutput(answer);
    const title = parsedAnswer.title;
    const specialtyCode = parsedAnswer.specialtyCode || "";
    appendDebugLog("heidi:answer-received", {
      jobId: job.id,
      answerLength: answer.length,
      titleLength: title.length,
      specialtyCode,
      hasTaggedTitle: Boolean(extractTaggedBlock(answer, "TITRE_COURRIER")),
      hasTaggedSpecialty: Boolean(extractTaggedBlock(answer, "SPECIALITE_COURRIER")),
      hasTaggedAtcd: Boolean(extractTaggedBlock(answer, "ANTECEDENT_CIM10")),
      antecedentStatus: parsedAnswer.antecedent ? parsedAnswer.antecedent.status : "",
      hasAntecedent: Boolean(parsedAnswer.antecedent && parsedAnswer.antecedent.status === "OUI"),
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
      specialtyCode,
      antecedent: parsedAnswer.antecedent,
      rowIndex: job.rowIndex,
      rowStableKey: job.rowStableKey || "",
      rowIdentity: job.rowIdentity || "",
      contentKey: job.contentKey || "",
      urlKey: job.urlKey || "",
      pdfUrl: job.pdfUrl || "",
      sourceText: truncateResultSourceText(job.tableText || ""),
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
    return basePrompt;
  }

  function buildHeidiPromptVerificationMarkers(promptText) {
    const markers = [
      "Tu dois produire trois blocs balisés",
      "PROMPT TITRE COURRIER À APPLIQUER STRICTEMENT",
      "Rôle : médecin généraliste",
      "Objectif : synthétiser le courrier médical",
      "Format de sortie obligatoire",
      "<TITRE_COURRIER>",
      "<SPECIALITE_COURRIER>",
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

  function extractHeidiAnswerFromAskContent(copyButton = null) {
    return extractHeidiAnswerStateFromAskContent(copyButton).answer;
  }

  function extractHeidiAnswerStateFromAskContent(copyButton = null) {
    const textCandidates = collectHeidiAnswerTextCandidates(copyButton);
    const answer = extractBestHeidiAnswerFromTextCandidates(textCandidates);

    return {
      answer,
      profile: buildHeidiAnswerCandidateProfile(textCandidates, copyButton),
    };
  }

  function collectHeidiAnswerTextCandidates(copyButton = null) {
    const textCandidates = [];
    const seenTexts = new Set();
    const addCandidate = (text) => addHeidiAnswerTextCandidate(textCandidates, seenTexts, text);

    collectHeidiAnswerAncestorTextCandidates(copyButton, addCandidate);

    const selectors = [
      '#ask-ai-content',
      '#ask-ai-container',
      '[data-testid="ask-ai-block-editor"] [contenteditable="false"]',
      '[data-testid="ask-ai-block-editor"] .ProseMirror',
      '[data-testid="ask-ai-block-editor"]',
      '#ask-ai-content [contenteditable="false"]',
      '#ask-ai-content .ProseMirror',
      '[data-testid="template-block-editor-content"] [contenteditable="false"]',
      '[data-testid*="ask-ai"]',
      '[data-testid*="message"]',
      '[data-message-author-role="assistant"]',
      '[role="article"]',
      'article',
      '.markdown',
      '.prose',
      '[class*="markdown"]',
      '[class*="assistant"]',
    ];

    selectors.forEach((selector) => {
      Array.from(document.querySelectorAll(selector)).slice(0, 80).forEach((node) => {
        if (!isElementVisibleEnough(node)) {
          return;
        }

        addCandidate(getVisibleText(node));
        addCandidate(extractTaggedHeidiOutputFromDomNode(node));
      });
    });

    return textCandidates;
  }

  function collectHeidiAnswerAncestorTextCandidates(copyButton, addCandidate) {
    let node = copyButton || findHeidiCopyTextButton();

    for (let depth = 0; node && node !== document.body && depth < 12; depth += 1) {
      if (isElementVisibleEnough(node)) {
        addCandidate(getVisibleText(node));
        addCandidate(extractTaggedHeidiOutputFromDomNode(node));
      }
      node = node.parentElement;
    }
  }

  function addHeidiAnswerTextCandidate(textCandidates, seenTexts, text) {
    const normalized = normalizeMultilineText(text);

    if (!normalized || isOnlyHeidiThinkingText(normalized)) {
      return false;
    }

    const structuredAnswer = extractStructuredHeidiAnswerFromText(normalized);
    if (isHeidiPromptOrInputTextCandidate(normalized) && !structuredAnswer) {
      return false;
    }

    const candidate = structuredAnswer || normalized;
    if (seenTexts.has(candidate)) {
      return false;
    }

    seenTexts.add(candidate);
    textCandidates.push(candidate);
    return true;
  }

  function isHeidiPromptOrInputTextCandidate(text) {
    const normalized = normalizeForCompare(text).replace(/['’]/g, " ");

    return (
      normalized.includes("courrier medical a synthetiser ci dessous") ||
      normalized.includes("document fourni par weda") ||
      normalized.includes("texte pdf extrait automatiquement") ||
      normalized.includes("tu dois produire deux blocs balises") ||
      normalized.includes("tu dois produire trois blocs balises") ||
      normalized.includes("prompt titre courrier a appliquer strictement") ||
      normalized.includes("format de sortie obligatoire") ||
      normalized.includes("phrase de titre produite en appliquant strictement") ||
      normalized.includes("specialite_courrier") ||
      normalized.includes("statut: oui ou non") ||
      normalized.includes("libelle: libelle court") ||
      normalized.includes("code: code cim") ||
      normalized.includes("source: fragment tres court")
    );
  }

  function extractTaggedHeidiOutputFromDomNode(node) {
    if (!node || typeof node.querySelector !== "function") {
      return "";
    }

    const titleNode = node.querySelector("titre_courrier");
    const specialtyNode = node.querySelector("specialite_courrier");
    const atcdNode = node.querySelector("antecedent_cim10");

    if (!titleNode || !atcdNode) {
      return "";
    }

    const parts = [
      "<TITRE_COURRIER>",
      getVisibleText(titleNode),
      "</TITRE_COURRIER>",
    ];

    if (specialtyNode) {
      parts.push(
        "<SPECIALITE_COURRIER>",
        getVisibleText(specialtyNode),
        "</SPECIALITE_COURRIER>"
      );
    }

    parts.push(
      "<ANTECEDENT_CIM10>",
      getVisibleText(atcdNode),
      "</ANTECEDENT_CIM10>"
    );

    return parts.join("\n");
  }

  function buildHeidiAnswerCandidateProfile(textCandidates, copyButton = null) {
    const texts = (textCandidates || [])
      .map((text) => normalizeMultilineText(text))
      .filter(Boolean);
    const aggregate = texts.join("\n");

    return {
      candidateCount: texts.length,
      largestCandidateLength: texts.reduce((max, text) => Math.max(max, text.length), 0),
      aggregateLength: aggregate.length,
      aggregateHasTaggedTitle: Boolean(extractTaggedBlock(aggregate, "TITRE_COURRIER")),
      aggregateHasTaggedSpecialty: Boolean(extractTaggedBlock(aggregate, "SPECIALITE_COURRIER")),
      aggregateHasTaggedAtcd: Boolean(extractTaggedBlock(aggregate, "ANTECEDENT_CIM10")),
      aggregateHasUntaggedAtcd: Boolean(extractUntaggedHeidiCourrierAtcdOutput(aggregate)),
      fromCopyButton: Boolean(copyButton),
    };
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
    const textCandidates = [];
    const seenTexts = new Set();

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

        if (!seenTexts.has(text)) {
          seenTexts.add(text);
          textCandidates.push(text);
        }
      }
    }

    return extractBestHeidiAnswerFromTextCandidates(textCandidates);
  }

  function extractBestHeidiAnswerFromTextCandidates(textCandidates) {
    const texts = (textCandidates || [])
      .map((text) => normalizeMultilineText(text))
      .filter(Boolean);

    if (!texts.length) {
      return "";
    }

    const aggregate = texts.join("\n");
    const structuredAnswer = extractStructuredHeidiAnswerFromText(aggregate);
    if (structuredAnswer) {
      return structuredAnswer;
    }

    for (const text of texts.slice().reverse()) {
      if (isHeidiPromptOrInputTextCandidate(text)) {
        continue;
      }

      const answer = extractAnswerFromText(text);
      if (answer) {
        return answer;
      }
    }

    return isHeidiPromptOrInputTextCandidate(aggregate) ? "" : extractAnswerFromText(aggregate);
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

    const maybeRelaunchIfStuck = (now, stillThinking) => {
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
    };

    return waitFor(() => {
      abortIfHeidiJobCancelled(jobId);
      const copyButton = findHeidiCopyTextButton();
      const answerState = extractHeidiAnswerStateFromAskContent(copyButton);
      const answer = answerState.answer;
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
            hasTaggedTitle: Boolean(extractTaggedBlock(answer, "TITRE_COURRIER")),
            hasTaggedSpecialty: Boolean(extractTaggedBlock(answer, "SPECIALITE_COURRIER")),
            hasTaggedAtcd: Boolean(extractTaggedBlock(answer, "ANTECEDENT_CIM10")),
            hasCopyButton: Boolean(copyButton),
            stillThinking,
            candidateProfile: answerState.profile,
          });
          if (stillThinking) {
            maybeRelaunchIfStuck(now, stillThinking);
          }
          return "";
        }

        if (stillThinking) {
          maybeRelaunchIfStuck(now, stillThinking);
          return "";
        }

        firstThinkingAt = 0;
        const stableDelay = copyButton
          ? HEIDI_ANSWER_STABLE_WITH_COPY_MS
          : HEIDI_ANSWER_STABLE_WITHOUT_COPY_MS;

        if (now - stableSince >= stableDelay) {
          return answer;
        }

        return "";
      }

      if (stillThinking || !answer) {
        maybeRelaunchIfStuck(now, stillThinking);
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

    const structuredAnswer = extractStructuredHeidiAnswerFromText(normalized);
    if (structuredAnswer) {
      return structuredAnswer;
    }

    const shortAnswer = extractShortHeidiLine(normalized);
    if (shortAnswer) {
      return shortAnswer;
    }

    return "";
  }

  function extractStructuredHeidiAnswerFromText(text) {
    const normalized = stripHeidiPromptBlocksFromText(text)
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();

    return extractTaggedHeidiCourrierAtcdOutput(normalized) ||
      extractUntaggedHeidiCourrierAtcdOutput(normalized);
  }

  function stripHeidiPromptBlocksFromText(text) {
    const lines = String(text || "").replace(/\r/g, "\n").split("\n");
    const output = [];
    let skippingPrompt = false;

    lines.forEach((line) => {
      const normalized = normalizeForCompare(line).replace(/['’]/g, " ");

      if (!skippingPrompt && (
        normalized.includes("tu dois produire deux blocs balises") ||
        normalized.includes("tu dois produire trois blocs balises") ||
        normalized.includes("pour le bloc <titre_courrier>") ||
        normalized.includes("pour le bloc <specialite_courrier>") ||
        normalized.includes("prompt titre courrier a appliquer strictement") ||
        normalized.includes("role : medecin generaliste") ||
        normalized.includes("objectif : synthetiser le courrier medical") ||
        normalized.includes("objectif : effectuer deux taches distinctes") ||
        normalized.includes("tache 1 - titre du courrier") ||
        normalized === "consignes :"
      )) {
        skippingPrompt = true;
        return;
      }

      if (skippingPrompt) {
        if (
          normalized.includes("</antecedent_cim10>") ||
          normalized.includes("specialite ou examen si utile")
        ) {
          skippingPrompt = false;
        }
        return;
      }

      output.push(line);
    });

    return output.join("\n");
  }

  function extractTaggedHeidiCourrierAtcdOutput(text) {
    const raw = String(text || "").replace(/\r/g, "\n");
    const regex = /<TITRE_COURRIER>[\s\S]*?<\/ANTECEDENT_CIM10>/gi;
    let match = null;
    let lastUsableBlock = "";

    while ((match = regex.exec(raw)) !== null) {
      const block = match[0]
        .replace(/\s*(?:Copier le texte|Copier)\s*$/i, "")
        .trim();

      if (isUsableTaggedHeidiCourrierAtcdBlock(block)) {
        lastUsableBlock = block;
      }
    }

    return lastUsableBlock;
  }

  function extractUntaggedHeidiCourrierAtcdOutput(text) {
    const lines = String(text || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => normalizeMultilineText(line))
      .filter(Boolean);
    const statusLineIndexes = [];

    lines.forEach((line, index) => {
      if (/^\s*STATUT\s*:/i.test(line)) {
        statusLineIndexes.push(index);
      }
    });

    for (let index = statusLineIndexes.length - 1; index >= 0; index -= 1) {
      const statusLineIndex = statusLineIndexes[index];
      const atcdBlock = extractUntaggedAtcdBlockFromLines(lines, statusLineIndex);
      const title = findUntaggedHeidiTitleBeforeAtcd(lines, statusLineIndex);

      if (!atcdBlock || !title) {
        continue;
      }

      const block = [
        "<TITRE_COURRIER>",
        title,
        "</TITRE_COURRIER>",
        "<ANTECEDENT_CIM10>",
        atcdBlock,
        "</ANTECEDENT_CIM10>",
      ].join("\n");

      if (isUsableTaggedHeidiCourrierAtcdBlock(block)) {
        return block;
      }
    }

    return "";
  }

  function extractUntaggedAtcdBlockFromLines(lines, statusLineIndex) {
    const fields = [];
    const fieldNames = "STATUT|SECTION|LIBELLE|CODE|DATE|CERTITUDE|SOURCE";

    for (let index = statusLineIndex; index < lines.length && fields.length < 8; index += 1) {
      const line = normalizeMultilineText(lines[index]);

      if (!line) {
        continue;
      }

      if (new RegExp(`^\\s*(?:${fieldNames})\\s*:`, "i").test(line)) {
        fields.push(line);
        continue;
      }

      if (fields.length && isExpectedTitleLine(line)) {
        break;
      }
    }

    const block = fields.join("\n");
    const parsed = parseSimpleKeyValueBlock(block);
    return parsed.STATUT ? block : "";
  }

  function findUntaggedHeidiTitleBeforeAtcd(lines, statusLineIndex) {
    const start = Math.max(0, statusLineIndex - 14);

    for (let index = statusLineIndex - 1; index >= start; index -= 1) {
      const candidate = sanitizeTitle(
        removeHeidiUiNoise(lines[index])
          .replace(/^<?\/?TITRE_COURRIER>?\s*:?\s*/i, "")
          .replace(/^titre\s*courrier\s*:?\s*/i, "")
      );

      if (isExpectedTitleLine(candidate) && !isStandaloneHeidiSpecialtyCode(candidate)) {
        return candidate;
      }
    }

    return extractShortHeidiLine(lines.slice(0, statusLineIndex).join("\n"));
  }

  function isUsableTaggedHeidiCourrierAtcdBlock(block) {
    const title = sanitizeTitle(extractTaggedBlock(block, "TITRE_COURRIER"));
    const atcdBlock = extractTaggedBlock(block, "ANTECEDENT_CIM10");
    const fields = parseSimpleKeyValueBlock(atcdBlock);
    const rawAtcd = normalizeForCompare(atcdBlock);

    if (!title || !isExpectedTitleLine(title)) {
      return false;
    }

    if (hasForbiddenHeidiLineText(title) || isPromptInstructionLine(title)) {
      return false;
    }

    if (
      /spe abregee|resultat principal|cat\s*\/\s*ttt|suivi si mentionne/.test(normalizeForCompare(title)) ||
      /oui ou non|libelle court|code cim\s*-?\s*10 sans crochets|raison courte|fragment tres court/.test(rawAtcd)
    ) {
      return false;
    }

    if (normalizeHeidiAtcdStatus(fields.STATUT) !== "OUI") {
      return true;
    }

    return Boolean(sanitizeAntecedentLabel(fields.LIBELLE) && isLikelyCim10Code(fields.CODE));
  }

  function parseHeidiCourrierAtcdOutput(rawAnswer) {
    const raw = String(rawAnswer || "").replace(/\r/g, "\n");
    const titleBlock = extractTaggedBlock(raw, "TITRE_COURRIER");
    const specialtyBlock = extractTaggedBlock(raw, "SPECIALITE_COURRIER");
    const atcdBlock = extractTaggedBlock(raw, "ANTECEDENT_CIM10");
    const specialtyCode = parseHeidiSpecialtyCode(specialtyBlock) ||
      extractUntaggedHeidiSpecialtyCode(raw, titleBlock);
    const title = sanitizeHeidiCourrierTitle(titleBlock, specialtyCode) ||
      sanitizeHeidiCourrierTitle(extractShortHeidiLine(raw), specialtyCode);
    const fields = parseSimpleKeyValueBlock(atcdBlock);
    const status = normalizeHeidiAtcdStatus(fields.STATUT);
    const code = normalizeCim10Code(fields.CODE);
    const label = sanitizeAntecedentLabel(fields.LIBELLE);
    const section = normalizeAntecedentSection(fields.SECTION);
    const date = sanitizeAntecedentDate(fields.DATE);
    const certainty = normalizeText(fields.CERTITUDE || "");
    const source = normalizeText(fields.SOURCE || "");

    const antecedent = {
      status: status === "OUI" && isLikelyCim10Code(code) && label ? "OUI" : "NON",
      section,
      label,
      code,
      date,
      certainty,
      source,
      rawBlock: atcdBlock,
    };

    if (status === "OUI" && antecedent.status !== "OUI") {
      antecedent.rejectionReason = !label
        ? "libellé manquant"
        : !isLikelyCim10Code(code)
          ? "code CIM-10 absent ou invalide"
          : "antécédent inexploitable";
    }

    return {
      title,
      specialtyCode,
      antecedent,
      raw,
    };
  }

  function extractUntaggedHeidiSpecialtyCode(rawAnswer, title = "") {
    const cleanTitle = normalizeForCompare(title);
    const lines = String(rawAnswer || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => normalizeText(removeHeidiUiNoise(line)))
      .filter(Boolean);

    for (const line of lines) {
      const normalizedLine = normalizeForCompare(line);
      if (!normalizedLine || normalizedLine === cleanTitle) {
        continue;
      }

      if (
        /^<\/?(?:titre_courrier|antecedent_cim10)>$/i.test(normalizedLine) ||
        /^(?:statut|section|libelle|code|date|certitude|source)\s*:/.test(normalizedLine)
      ) {
        continue;
      }

      const candidate = line
        .replace(/<\/?SPECIALITE_COURRIER>/gi, "")
        .replace(/^\s*(?:sp[eé]cialit[eé]|specialite_courrier)\s*:?\s*/i, "")
        .trim();

      if (isStandaloneHeidiSpecialtyCode(candidate)) {
        return parseHeidiSpecialtyCode(candidate);
      }
    }

    return "";
  }

  function extractTaggedBlock(text, tagName) {
    const tag = escapeRegExp(tagName);
    const match = String(text || "").match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i"));
    return match && match[1] ? match[1].trim() : "";
  }

  function parseSimpleKeyValueBlock(blockText) {
    const fields = {};
    const raw = String(blockText || "").replace(/\r/g, "\n");

    raw.split("\n")
      .forEach((line) => {
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

  function normalizeHeidiAtcdStatus(value) {
    const normalized = normalizeForCompare(value);
    if (/^(oui|yes|o|1|true)\b/.test(normalized)) {
      return "OUI";
    }
    return "NON";
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

  function sanitizeHeidiCourrierTitle(value, specialtyCode = "") {
    const title = sanitizeTitle(value);

    if (!title || !isExpectedTitleLine(title)) {
      return "";
    }

    if (isStandaloneSpecialtyTitle(title, specialtyCode)) {
      return "";
    }

    return title;
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

    if (isStandaloneSpecialtyTitle(text)) {
      return false;
    }

    if (!/[a-zA-ZÀ-ÖØ-öø-ÿ0-9]/.test(text)) {
      return false;
    }

    return true;
  }

  function isStandaloneSpecialtyTitle(value, specialtyCode = "") {
    const text = sanitizeTitle(value);
    const withoutLabel = stripHeidiSpecialtyNoise(text)
      .replace(/^\s*(?:sp[eé]cialit[eé]|specialite_courrier|cat[eé]gorie|classification)\s*:?\s*/i, "")
      .trim();
    const normalized = normalizeSpecialtyLabel(withoutLabel);

    if (!normalized) {
      return false;
    }

    if (isStandaloneHeidiSpecialtyCode(withoutLabel)) {
      return true;
    }

    const labels = getStandaloneSpecialtyTitleLabels(specialtyCode);
    return labels.some((label) => normalizeSpecialtyLabel(label) === normalized);
  }

  function getStandaloneSpecialtyTitleLabels(specialtyCode = "") {
    const codes = [
      "CARDIO/VASC",
      "GYNECO",
      "ORTHO/RHUMATO",
      "ENDOC",
      "HEPATO/GASTRO",
      "PNEUMO",
      "NEURO",
      "GERIA",
      "HEMATO",
      "URO/NEPHRO",
      "ORL/STO",
      "DERMATO/ALLERGO",
      "OPHTALMO",
      "THYMIE",
      "IMAGERIE",
      "BIOLOGIE",
      "Papier Administratif",
    ];
    const labels = [
      ...codes,
      "Cardiologie",
      "Gynécologie",
      "Orthopédie",
      "Rhumatologie",
      "Endocrinologie",
      "Gastro-entérologie",
      "Pneumologie",
      "Neurologie",
      "Gériatrie",
      "Hématologie",
      "Urologie",
      "Néphrologie",
      "ORL",
      "Stomatologie",
      "Dermatologie",
      "Allergologie",
      "Ophtalmologie",
      "Psychiatrie",
      "Psychologie",
      "Imagerie",
      "Biologie",
      "Administratif",
    ];

    codes.forEach((code) => {
      labels.push(...getWedaSpecialtyOptionAliasesForCode(code));
    });

    const parsedCode = parseHeidiSpecialtyCode(specialtyCode || "");
    if (parsedCode) {
      labels.push(parsedCode, ...getWedaSpecialtyOptionAliasesForCode(parsedCode));
    }

    return Array.from(new Set(labels.filter(Boolean)));
  }

  function isRememberableTitleLine(value, options = {}) {
    return options && options.manualOverride
      ? isRememberableManualTitleLine(value)
      : isExpectedTitleLine(value);
  }

  function isRememberableManualTitleLine(value) {
    const text = sanitizeTitle(value);

    if (!text || text.length > 260) {
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
      /^(?:page\s*\d+|copier|copy|envoyer|contexte|demande)$/i.test(normalized) ||
      /^(?:role|objectif|consignes|format attendu|format de sortie)\s*:/.test(normalized) ||
      /(?:tu dois produire (?:deux|trois) blocs|pour le bloc|prompt titre courrier|fin du prompt titre|courrier medical a synthetiser|titre_courrier|specialite_courrier|antecedent_cim10|statut\s*:|libelle\s*:|code\s*:|certitude\s*:|source\s*:|repondre en francais|faire une seule phrase|ne jamais|ne pas faire|extraire uniquement|mentionner de facon concise|utiliser un style|conserver les termes|eviter les details|format attendu|format de sortie obligatoire|une phrase unique du type|copier le texte|bientot termine|l ia est en train|demandez a l ia|nouvelle session|je ne peux pas|impossible d analyser|analyse directement.*piece jointe|pdf original joint|texte.*pdf.*extrait automatiquement|pdf joint est inaccessible|piece jointe non accessible|document inaccessible|aucun document accessible)/i.test(normalized);
  }

  function isPromptInstructionLine(text) {
    const normalized = normalizeForCompare(text)
      .replace(/['’]/g, " ")
      .replace(/^(?:[-–—•:;]\s*)+/, "");

    if (!normalized) {
      return false;
    }

    return /^(?:role|objectif|consignes|format attendu|format de sortie|tu dois|pour le bloc|statut|section|libelle|code|date|certitude|source|repondre|faire|ne jamais|ne pas|extraire|mentionner|si aucune|utiliser|conserver|eviter|une phrase unique|specialite ou examen|spe abregee)\b/.test(normalized) ||
      /\b(?:prompt|consigne|format attendu|format de sortie obligatoire|source unique|titre_courrier|specialite_courrier|antecedent_cim10)\b/.test(normalized);
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
      if (shouldDeduplicateNoisyDebugEvent(eventName, data)) {
        return;
      }

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
        console.warn("[WedaCourrierLmStudio] debug log failed", error);
      } catch (_nestedError) {
        // Rien d'autre à faire si la console est inaccessible.
      }
    }
  }

  function shouldDeduplicateNoisyDebugEvent(eventName, data = {}) {
    if (!/^weda:remembered-(?:title|specialty)-(?:skip-|already-present)/.test(String(eventName || ""))) {
      return false;
    }

    const signature = [
      eventName,
      data.reason || "",
      data.phase || "",
      data.currentIndex == null ? "" : data.currentIndex,
      data.rowIndex == null ? "" : data.rowIndex,
      data.currentJobId || data.jobId || "",
      data.rowStableKey || "",
      data.rememberedRowStableKey || "",
    ].join("|");
    const now = Date.now();
    const previousAt = Number(debugLogNoisyEventLastSeen.get(signature) || 0);

    debugLogNoisyEventLastSeen.set(signature, now);
    if (debugLogNoisyEventLastSeen.size > 200) {
      for (const [key, seenAt] of debugLogNoisyEventLastSeen) {
        if (now - seenAt > DEBUG_LOG_NOISY_EVENT_DEDUP_MS * 4) {
          debugLogNoisyEventLastSeen.delete(key);
        }
      }
    }

    return previousAt > 0 && now - previousAt < DEBUG_LOG_NOISY_EVENT_DEDUP_MS;
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
    return /^(?:patient|patientId|patientUrl|patientLabel|candidateLabel|maidenName|nom|prenom|familyName|givenName|searchLabel|searchQuery|birth|birthDate|dateNaissance|naissance|identity|rowIdentity|title|titre|lastTitle|tableText|tableHtml|prompt|raw|answer|pdfAttachmentBase64|pdfPageImages|pdfPageImageDataUrls|dataUrl|data_url|imageUrl|image_url)$/i.test(String(key || ""));
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
      let settled = false;
      let timerId = null;
      let observer = null;
      let observerCheckQueued = false;

      const cleanup = () => {
        if (timerId != null) {
          cancelBackgroundTask(timerId);
          timerId = null;
        }
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };

      const finishResolve = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };

      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const check = (scheduleNext = true) => {
        if (settled) {
          return;
        }

        let result = null;

        try {
          result = condition();
        } catch (error) {
          finishReject(error);
          return;
        }

        if (result) {
          finishResolve(result);
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          appendDebugLog("wait:timeout", {
            description,
            timeout,
            interval,
            elapsed: Date.now() - startedAt,
          });
          finishReject(new Error(`délai dépassé en attendant ${description}`));
          return;
        }

        if (scheduleNext) {
          timerId = scheduleBackgroundTask(() => check(true), interval);
        }
      };

      const requestObserverCheck = () => {
        if (settled || observerCheckQueued) {
          return;
        }
        observerCheckQueued = true;
        dispatchBackgroundTask(() => {
          observerCheckQueued = false;
          check(false);
        });
      };

      const handleVisibilityChange = () => requestObserverCheck();
      document.addEventListener("visibilitychange", handleVisibilityChange);

      if (typeof MutationObserver === "function" && document.documentElement) {
        observer = new MutationObserver(requestObserverCheck);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      }

      check(true);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => scheduleBackgroundTask(resolve, ms));
  }

  function scheduleBackgroundTask(callback, delay = 0, ...args) {
    const delayMs = Math.max(0, Number(delay) || 0);
    const taskId = `background-timer-${++backgroundTimerTaskSequence}`;
    const nativeTimerId = window.setTimeout(() => completeBackgroundTask(taskId), delayMs);

    backgroundTimerTasks.set(taskId, {
      callback,
      args,
      nativeTimerId,
    });

    const worker = ensureBackgroundTimerWorker();
    if (worker) {
      try {
        worker.postMessage({
          type: "schedule",
          id: taskId,
          delay: delayMs,
        });
      } catch (_error) {
        disableBackgroundTimerWorker("schedule-postmessage-error");
      }
    }

    return taskId;
  }

  function cancelBackgroundTask(taskId) {
    const task = backgroundTimerTasks.get(taskId);
    if (!task) {
      return;
    }

    backgroundTimerTasks.delete(taskId);
    window.clearTimeout(task.nativeTimerId);

    if (backgroundTimerWorker) {
      try {
        backgroundTimerWorker.postMessage({ type: "cancel", id: taskId });
      } catch (_error) {
        disableBackgroundTimerWorker("cancel-postmessage-error");
      }
    }
  }

  function completeBackgroundTask(taskId) {
    const task = backgroundTimerTasks.get(taskId);
    if (!task) {
      return;
    }

    backgroundTimerTasks.delete(taskId);
    window.clearTimeout(task.nativeTimerId);

    if (backgroundTimerWorker) {
      try {
        backgroundTimerWorker.postMessage({ type: "cancel", id: taskId });
      } catch (_error) {
        disableBackgroundTimerWorker("complete-postmessage-error");
      }
    }

    dispatchBackgroundTask(() => task.callback.apply(window, task.args));
  }

  function ensureBackgroundTimerWorker() {
    if (backgroundTimerWorker || backgroundTimerWorkerUnavailable) {
      return backgroundTimerWorker;
    }

    if (typeof Worker !== "function" || typeof Blob !== "function" || !window.URL || typeof window.URL.createObjectURL !== "function") {
      backgroundTimerWorkerUnavailable = true;
      appendDebugLog("weda:background-timer-worker-unavailable", {
        reason: "worker-api-missing",
      });
      return null;
    }

    let workerUrl = "";
    try {
      const workerSource = `
        const timers = new Map();
        self.onmessage = (event) => {
          const data = event.data || {};
          if (data.type === "schedule") {
            const previous = timers.get(data.id);
            if (previous != null) clearTimeout(previous);
            const timerId = setTimeout(() => {
              timers.delete(data.id);
              self.postMessage({ id: data.id });
            }, Math.max(0, Number(data.delay) || 0));
            timers.set(data.id, timerId);
          } else if (data.type === "cancel") {
            const timerId = timers.get(data.id);
            if (timerId != null) clearTimeout(timerId);
            timers.delete(data.id);
          }
        };
      `;
      workerUrl = window.URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      backgroundTimerWorker = new Worker(workerUrl);
      backgroundTimerWorker.onmessage = (event) => completeBackgroundTask(event && event.data && event.data.id);
      backgroundTimerWorker.onerror = () => disableBackgroundTimerWorker("worker-runtime-error");
      appendDebugLog("weda:background-timer-worker-ready", {});
      return backgroundTimerWorker;
    } catch (_error) {
      disableBackgroundTimerWorker("worker-creation-error");
      return null;
    } finally {
      if (workerUrl) {
        try {
          window.URL.revokeObjectURL(workerUrl);
        } catch (_error) {
          // L'URL temporaire sera libérée par le navigateur à la fermeture de la page.
        }
      }
    }
  }

  function disableBackgroundTimerWorker(reason = "worker-disabled") {
    const wasUnavailable = backgroundTimerWorkerUnavailable;
    backgroundTimerWorkerUnavailable = true;
    if (backgroundTimerWorker) {
      try {
        backgroundTimerWorker.terminate();
      } catch (_error) {
        // Le minuteur natif déjà armé reste le filet de sécurité.
      }
      backgroundTimerWorker = null;
    }
    if (!wasUnavailable) {
      appendDebugLog("weda:background-timer-worker-unavailable", { reason });
    }
  }

  function dispatchBackgroundTask(callback) {
    if (typeof MessageChannel !== "function") {
      Promise.resolve().then(callback);
      return;
    }

    if (!backgroundTaskChannel) {
      backgroundTaskChannel = new MessageChannel();
      backgroundTaskChannel.port1.onmessage = () => {
        const task = backgroundTaskQueue.shift();
        if (typeof task === "function") {
          task();
        }
      };
    }

    backgroundTaskQueue.push(callback);
    backgroundTaskChannel.port2.postMessage(0);
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
