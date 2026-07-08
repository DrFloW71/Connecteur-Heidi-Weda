// ==UserScript==
// @name         Weda - Analyse biologies avec LM Studio local
// @namespace    https://secure.weda.fr/
// @version      0.1.6
// @description  Analyse les résultats HPRIM avec l'API OpenAI-compatible de LM Studio en local. Statut biologique pré-calculé.
// @match        https://secure.weda.fr/FolderMedical/HprimForm.aspx*
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const WEDA_HOST = "secure.weda.fr";
  const WEDA_PATH = "/FolderMedical/HprimForm.aspx";
  const HEIDI_HOST = "scribe.heidihealth.com";
  const HEIDI_URL = "https://scribe.heidihealth.com/";
  const LMSTUDIO_API_BASE_URL = "http://localhost:1234/v1";
  const LMSTUDIO_CHAT_COMPLETIONS_URL = `${LMSTUDIO_API_BASE_URL}/chat/completions`;
  const LMSTUDIO_MODELS_URL = `${LMSTUDIO_API_BASE_URL}/models`;
  const LMSTUDIO_MODEL = "";
  const LMSTUDIO_REQUEST_TIMEOUT_MS = 300000;
  const LMSTUDIO_TEMPERATURE = 0;
  const LMSTUDIO_MAX_TOKENS = 220;
  const BIOLOGY_SIGNAL = "BIOLOGIE À ANALYSER CI-DESSOUS";
  const HPRIM_TABLE_COLUMN_COUNT = 6;
  const SCRIPT_VERSION = "0.1.6";

  const STORAGE_PREFIX = "wedaBioLmStudio.";
  const STATE_KEY_BASE = `${STORAGE_PREFIX}state`;
  const JOB_KEY_BASE = `${STORAGE_PREFIX}job`;
  const RESULT_KEY_BASE = `${STORAGE_PREFIX}result`;
  const STATUS_KEY_BASE = `${STORAGE_PREFIX}status`;
  const AUTO_INTERVAL_KEY = `${STORAGE_PREFIX}autoIntervalMs.v1`;
  const WEDA_TAB_ID_SESSION_KEY = `${STORAGE_PREFIX}wedaTabId.v1`;
  const WEDA_PREVIOUS_WINDOW_NAME_SESSION_KEY = `${STORAGE_PREFIX}previousWindowName.v1`;
  const HEIDI_CHANNEL_PARAM = "wedaBioChannel";
  const WEDA_WINDOW_NAME_PREFIX = "weda_bio_lmstudio_weda_";
  const HEIDI_WORKER_WINDOW_NAME_PREFIX = "weda_bio_heidi_worker_";
  const WEDA_FOCUS_RETRY_DELAYS_MS = [0, 120, 350, 800, 1400];
  const WEDA_CLOSE_HEIDI_AFTER_FOCUS_MS = 450;
  const HEIDI_CLOSE_AFTER_RESULT_MS = 2500;
  let STATE_KEY = STATE_KEY_BASE;
  let JOB_KEY = JOB_KEY_BASE;
  let RESULT_KEY = RESULT_KEY_BASE;
  let STATUS_KEY = STATUS_KEY_BASE;
  let CURRENT_CHANNEL_ID = "";
  const DEBUG_LOG_KEY = `${STORAGE_PREFIX}debugLog.v1`;
  const TITLES_KEY = `${STORAGE_PREFIX}rememberedTitles.v3`;
  const PANEL_POSITION_KEY = `${STORAGE_PREFIX}panelPosition.v1`;
  const AUTO_SEEN_ROWS_KEY_BASE = `${STORAGE_PREFIX}autoSeenRows.v1`;
  let AUTO_SEEN_ROWS_KEY = AUTO_SEEN_ROWS_KEY_BASE;

  const PANEL_ID = "weda-bio-lmstudio-panel";
  const STATUS_ID = "weda-bio-lmstudio-status";
  const DEBUG_LOG_PANEL_ID = "weda-bio-lmstudio-log-panel";
  const DEBUG_LOG_TEXTAREA_ID = "weda-bio-lmstudio-log-textarea";
  const PENDING_FAVICON_LINK_ID = "weda-bio-pending-favicon";
  const PENDING_FAVICON_SHORTCUT_LINK_ID = "weda-bio-pending-favicon-shortcut";
  const AUTO_INTERVAL_DEFAULT_MS = 60 * 1000;
  const AUTO_INTERVAL_MIN_MS = 10 * 1000;
  const AUTO_INTERVAL_MAX_MS = 24 * 60 * 60 * 1000;
  const AUTO_HEARTBEAT_MS = 60 * 1000;
  const AUTO_STALE_RUNNING_MS = 10 * 60 * 1000;
  const AUTO_GRID_WAIT_MS = 45000;
  const WEDA_ROW_OPEN_RETRY_DELAYS_MS = [4500, 11000];
  const NEXT_AFTER_SAVE_MS = 5500;
  const NEXT_AFTER_RELOAD_SAVE_MS = 3200;
  const HEIDI_ANSWER_STABLE_WITH_COPY_MS = 1000;
  const HEIDI_ANSWER_STABLE_WITHOUT_COPY_MS = 2800;
  const HEIDI_ANSWER_STABLE_WITH_STUCK_THINKING_MS = 7000;
  const HEIDI_FOCUS_IF_HIDDEN_AFTER_MS = 5000;
  const HEIDI_BACKGROUND_SEND_GRACE_MS = 1500;
  const HEIDI_BACKGROUND_SEND_CONFIRM_MS = 2500;
  const HEIDI_ANSWER_WAIT_TIMEOUT_MS = 300000;
  const HEIDI_RELAUNCH_IF_STUCK_AFTER_MS = 14000;
  const HEIDI_RELAUNCH_COOLDOWN_MS = 16000;
  const HEIDI_MAX_RELAUNCHES = 0;
  const HEIDI_COPY_BUTTON_RECLICK_MS = 1800;
  const HEIDI_COPY_BUTTON_MAX_CLICKS = 6;
  const HEIDI_DIRECT_ANSWER_STABLE_MS = 900;
  const HEIDI_DIRECT_ANSWER_FALLBACK_AFTER_MS = 7000;
  const HEIDI_EMPTY_OUTPUT_FALLBACK_AFTER_MS = 12000;
  const HEIDI_CLIPBOARD_READ_AFTER_COPY_MS = 350;
  const HEIDI_WORKERS_OPEN_IN_BACKGROUND = false;
  const HEIDI_CONTEXT_MAX_ATTEMPTS = 10;
  const HEIDI_CONTEXT_RETRY_MS = 900;
  const HEIDI_CONTEXT_FOREGROUND_FALLBACK_AFTER_ATTEMPT = 2;
  const HEIDI_CONTEXT_ACTIVATE_TIMEOUT_MS = 4500;
  const HEIDI_STARTUP_WATCHDOG_MS = 14000;
  const HEIDI_STARTUP_MAX_REOPENS = 2;
  const HEIDI_CONTEXT_VISIBLE_SETTLE_MS = 1800;
  const HEIDI_CONTEXT_HIDDEN_SETTLE_MS = 8000;
  const MAX_REMEMBERED_TITLES = 500;
  const MAX_AUTO_SEEN_ROWS = 1000;
  const MAX_DEBUG_LOG_ENTRIES = 300;
  const DEBUG_LOG_VIEW_MAX_ENTRIES = 120;
  const DEBUG_REPORT_MAX_LOG_ENTRIES = 70;
  const DEBUG_REPORT_MAX_CHARS = 30000;
  const MANUAL_TITLE_EDIT_GRACE_MS = 2 * 60 * 1000;

  let titleAutofillInterval = null;
  let autoRefreshTimer = null;
  let autoHeartbeatTimer = null;
  let pendingFaviconObserver = null;
  let pendingFaviconObservedTarget = null;
  let pendingFaviconHeadObserver = null;
  let pendingFaviconUpdateTimer = null;
  let lastPendingFaviconCount = null;
  let pendingFaviconObjectUrl = "";
  let pendingFaviconRenderToken = 0;
  let currentHeidiTab = null;
  let preopenedHeidiWorkerWindow = null;
  let heidiForegroundFallbackUsed = false;
  let debugSequence = 0;
  let cachedLmStudioModelId = "";
  const debugSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let manualTitleEditProtectionReady = false;
  let manualTitleEditState = null;

  const HEIDI_PROMPT = "Tu es médecin généraliste en France.\n\nAnalyse uniquement le compte-rendu de biologie fourni après le signal :\nBIOLOGIE À ANALYSER CI-DESSOUS\n\nOBJECTIF\n\nProduire une seule ligne de synthèse biologique courte, avec :\n- les anomalies biologiques utiles ;\n- les marqueurs obligatoires disponibles, même normaux ;\n- les bilans normaux utiles sous forme abrégée : ECBU RAS, IST RAS ;\n- les anomalies les plus graves en premier ;\n- uniquement des résultats biologiques bruts ;\n- aucun diagnostic ;\n- aucune interprétation médicale ;\n- aucune conduite à tenir ;\n- aucun commentaire long.\n\nRÈGLE ANTI-RECOPIE DU PROMPT\n\nLa sortie finale ne doit jamais contenir une phrase, un seuil, une règle, une consigne, un titre ou une liste provenant du prompt.\nLa sortie finale ne doit jamais commencer par un tiret.\nLa sortie finale ne doit jamais reprendre une phrase du type “si”, “ne jamais”, “toujours”, “commencer la ligne”, “citer”, “écrire”, “vérifier”, “critère”, “règle”, “prompt”.\nSi une consigne du prompt risque d’être recopiée, l’ignorer et produire uniquement les vrais résultats biologiques du patient.\n\nRÈGLE ANTI-FAUX BILAN RAS\n\nAvant de répondre “Bilan RAS”, analyser toute la biologie ligne par ligne.\n\nNe jamais répondre “Bilan RAS” si au moins une valeur est :\n- hors intervalle Minimum / Maximum du laboratoire ;\n- affichée en rouge, gras rouge, couleur d’anomalie ou signalée comme anormale ;\n- accompagnée d’une flèche ou d’un commentaire d’alerte ;\n- manifestement pathologique selon les seuils d’urgence.\n\nSi le tableau contient les colonnes Libellé / Valeur / Unité / Minimum / Maximum :\ncomparer la valeur mesurée au Minimum et au Maximum.\nSi Valeur < Minimum : citer la valeur avec ↓.\nSi Valeur > Maximum : citer la valeur avec ↑.\nNe jamais afficher les Minimum / Maximum dans la sortie finale.\n\nEn cas de doute entre “Bilan RAS” et citer une valeur anormale, citer la valeur anormale.\n“Bilan RAS” est autorisé uniquement si aucune valeur anormale, aucun marqueur obligatoire, aucun ECBU normal et aucun bilan IST normal ne doit être cité.\n\nSOURCE UNIQUE\n\nUtilise uniquement les résultats fournis après le signal :\nBIOLOGIE À ANALYSER CI-DESSOUS\n\nNe jamais inventer une valeur, une unité, une norme, une date ou un contexte clinique.\nLes normes du laboratoire sont prioritaires.\nSi une norme manque, ne pas conclure sauf seuil d’urgence évident.\nTenir compte des unités.\nNe pas interpréter cliniquement au-delà du résultat biologique.\n\nMARQUEURS OBLIGATOIRES\n\nToujours citer ces marqueurs s’ils sont disponibles, même normaux :\nLDL, non-HDL, TROPO, CRP, PCT, BNP, HG, LIPASE, DFG, HCG.\n\nNotation obligatoire :\nLDL : écrire LDL\nnon-HDL : écrire non-HDL sans espace avant la valeur\ntroponine : écrire TROPO\nCRP : écrire CRP\nprocalcitonine : écrire PCT\nNT-proBNP ou BNP : écrire BNP\nHbA1c ou hémoglobine glyquée : écrire HG\nlipase : écrire LIPASE\nDFG : écrire DFG, sans unité\nbêta-HCG : écrire HCG\n\nNe jamais répondre seulement “Bilan RAS”, “ECBU RAS” ou “IST RAS” si un marqueur obligatoire est disponible.\nSi un marqueur obligatoire est présent dans la biologie, il doit être présent dans la sortie finale.\n\nSORTIE FINALE\n\nRépondre uniquement par une seule ligne.\nNe jamais faire de retour à la ligne.\nNe jamais écrire d’explication.\nNe jamais écrire de liste.\nNe jamais commencer par un tiret.\n\nLa sortie finale doit contenir uniquement :\n- des résultats biologiques bruts du patient ;\n- ou Bilan RAS avec marqueurs obligatoires disponibles ;\n- ou ECBU RAS avec marqueurs obligatoires disponibles ;\n- ou IST RAS avec marqueurs obligatoires disponibles ;\n- ou URGENCE : suivi des vrais résultats biologiques urgents du patient.\n\nNe jamais écrire :\nRésumé, Anomalies, Alarme, À RELIRE, IMPORTANT, AUCUNE, Bilans RAS.\n\nÉcrire toujours “Bilan RAS” au singulier, jamais “Bilans RAS”.\n\nLe seul préfixe autorisé est :\nURGENCE :\n\nUtiliser URGENCE : uniquement si un critère d’urgence est présent.\nSinon, ne mettre aucun préfixe.\n\nSi aucune anomalie significative, aucun marqueur obligatoire disponible, aucun ECBU normal et aucun bilan IST normal :\nBilan RAS\n\nSi aucune anomalie significative mais marqueurs obligatoires disponibles :\nBilan RAS, puis les marqueurs obligatoires disponibles.\n\nSi ECBU présent et normal sans anomalie associée :\nECBU RAS\n\nSi ECBU présent et normal avec marqueurs obligatoires disponibles :\nECBU RAS, puis les marqueurs obligatoires disponibles.\n\nSi bilan IST présent et normal sans anomalie associée :\nIST RAS\n\nSi bilan IST présent et normal avec marqueurs obligatoires disponibles :\nIST RAS, puis les marqueurs obligatoires disponibles.\n\nSi anomalie biologique :\nécrire directement les anomalies avec nom du marqueur, flèche si nécessaire, valeur et unité.\n\nNORMES\n\nNe jamais afficher les limites, normes, minimums ou maximums du laboratoire dans la sortie finale.\nLes normes servent uniquement à savoir si une valeur est normale ou anormale.\nLa sortie finale doit contenir uniquement la valeur mesurée et son unité.\nException : pour ASAT, ALAT et GGT élevées, utiliser la norme haute uniquement pour calculer le nombre de fois la norme, mais ne jamais afficher la norme elle-même.\n\nCHOLESTÉROL / LIPIDES\n\nNe jamais afficher le cholestérol total.\nNe jamais afficher CT.\nMême si cholestérol total ou CT est anormal, ne pas le citer dans la sortie finale.\nLDL doit toujours être affiché s’il est disponible.\nnon-HDL doit toujours être affiché s’il est disponible.\nHDL doit être affiché uniquement s’il est anormal ou utile.\nTG doit être affiché uniquement s’il est anormal ou utile.\nNe jamais afficher le rapport CT/HDL.\nNe jamais utiliser le cholestérol total comme anomalie principale.\nPour le bilan lipidique, privilégier : LDL, non-HDL, HDL si anormal, TG si anormal.\n\nABRÉVIATIONS OBLIGATOIRES\n\nTriglycérides : TG\nGlycémie : Gly\nPotassium : K+\nPolynucléaires neutrophiles : PNN\nHémoglobine : Hb\nLeucocytes : Leuco\nMonocytes : Mono\nPlaquettes : Plaq\nFerritine : ferr\nCréatinine : créat\nCréatinine urinaire : Créat U\nRapport protéinurie/créatininurie, Ratio PTU/CU, Rapport ProtU/CrU ou équivalent : RAC\n\nNe jamais écrire dans la sortie finale :\ntriglycérides, glycémie, troponine, créatinine, Créatinine urinaire, Rapport ProtU/CrU, cholestérol total, CT, rapport CT/HDL, non-HDL-cholestérol, Hémoglobine, Leucocytes, Monocytes, Plaquettes, plaquettes, Hématies, hématies, HÉMATIES, Hématocrite, hématocrite, HÉMATOCRITE.\n\nNe jamais afficher les hématies dans la sortie finale, même si elles sont basses ou hautes.\nNe jamais afficher l’hématocrite dans la sortie finale, même s’il est bas ou haut.\nPour une anomalie de l’hémoglobine, afficher uniquement Hb.\nPour une anomalie des leucocytes, afficher uniquement Leuco.\nPour une anomalie des monocytes, afficher uniquement Mono.\nPour une anomalie des plaquettes, afficher uniquement Plaq.\n\nUNITÉS À PRÉFÉRER SI PLUSIEURS SONT DISPONIBLES\n\nLDL : g/L\nnon-HDL : g/L\nHDL : g/L\nTG : g/L\nHG : %\ncréat : µmol/L\nHb : g/dL\nDFG : valeur seule sans unité\nPour les autres marqueurs : garder l’unité fournie.\n\nNe citer qu’une seule fois une même analyse.\nNe pas citer les unités alternatives si l’unité préférée est disponible.\nNe pas citer les valeurs historiques sauf évolution clairement utile.\n\nRÈGLES SPÉCIALES\n\nSi Hb basse selon la norme :\nciter Hb, et ajouter ferr et VGM s’ils sont disponibles.\nNe pas citer les hématies.\nNe pas citer l’hématocrite.\n\nSi TSH anormale :\nciter TSH et ajouter T4L si disponible.\n\nSi B12 ou folates bas :\nciter B12 ou folates, et ajouter VGM si disponible.\n\nSi BNP élevé :\nciter BNP et ajouter DFG si disponible.\n\nSi HCG disponible :\ntoujours citer HCG.\nNe pas écrire grossesse sauf si explicitement écrit dans le compte-rendu.\n\nECBU\n\nSi un ECBU est présent et normal, écrire :\nECBU RAS\n\nConsidérer ECBU normal si le compte-rendu mentionne une culture stérile, des cultures restées stériles, une absence d’infection urinaire, une absence de colonisation, une absence de bactériurie significative, une absence de leucocyturie significative, une absence de germe pathogène ou un examen cytobactériologique normal.\n\nSi ECBU normal et autres marqueurs obligatoires disponibles, écrire ECBU RAS, puis les marqueurs obligatoires disponibles.\n\nSi ECBU anormal, ne pas écrire ECBU RAS.\nCiter uniquement les éléments utiles : germe, leucocyturie, hématurie, nitrites, bactériurie, antibiogramme si pertinent, commentaire à contrôler si présent.\n\nNe jamais confondre ECBU RAS avec IST RAS.\n\nIST\n\nSi bilan IST présent et tous les résultats fournis sont négatifs ou normaux :\najouter IST RAS.\n\nSi un résultat IST est positif, douteux, limite, indéterminé ou à contrôler :\nne pas écrire IST RAS, citer uniquement le résultat concerné.\n\nIST inclut notamment VIH, syphilis, TPHA, VDRL, Chlamydia, gonocoque, Mycoplasma genitalium, VHB, VHC, Ag HBs, Ac anti-HBs, Ac anti-HBc.\n\nASAT / ALAT / GGT\n\nSi ASAT, ALAT ou GGT sont élevées :\n- si la limite supérieure de la norme est disponible et cohérente, afficher uniquement le nombre de fois la norme ;\n- calculer valeur divisée par limite supérieure ;\n- arrondir à une décimale ;\n- écrire directement sous la forme : ASAT ↑ 1.4N, ALAT ↑ 2.8N ou GGT ↑ 3.1N ;\n- ne pas afficher la valeur mesurée ni l’unité si le calcul en N est possible ;\n- ne pas écrire ≈ ;\n- ne pas écrire x ;\n- ne pas écrire U/L si le calcul en N est possible.\n\nSi la norme haute est absente, incohérente ou aberrante :\nciter la valeur mesurée avec son unité.\n\nSi la valeur est normale :\nne pas calculer en N et ne pas citer sauf nécessité particulière.\n\nFAUX POSITIFS À ÉVITER\n\nNe pas citer les pourcentages de formule leucocytaire si la valeur absolue correspondante est normale.\nNe pas citer les hématies.\nNe pas citer l’hématocrite.\nNe pas citer le rapport CT/HDL.\nNe pas citer les ratios sans utilité clinique associée, sauf RAC élevé.\nNe pas citer poids, taille ou IMC comme biologie.\nIgnorer les normes manifestement aberrantes.\nNe pas citer les anomalies minimes isolées sans pertinence évidente.\nNe pas citer une valeur signalée artefactuelle comme anomalie certaine.\nSi hémolyse, prélèvement coagulé, résultat douteux, limite, indéterminé, à contrôler ou non interprétable : le signaler brièvement dans la ligne.\n\nANOMALIES À CITER\n\nCiter les valeurs hors norme utiles, notamment :\nHb basse ou haute, Leuco élevés ou bas, PNN élevés ou bas, Mono élevés ou bas, Plaq anormales, CRP élevée, VS élevée, PCT élevée, DFG bas, créat augmentée, albuminurie/protéinurie, RAC élevé, ASAT/ALAT/GGT/PAL/bilirubine élevées, HG élevée, Gly élevée, LDL élevé, non-HDL élevé, HDL bas ou élevé selon norme, TG élevés, TSH anormale, T4L anormale, ferr basse ou très élevée, B12 basse, folates bas, vitamine D basse, PSA élevé, LIPASE élevée, BNP élevé, TROPO élevée, ECBU positif, bilan IST positif ou douteux.\n\nNe jamais citer cholestérol total ou CT, même si hors norme.\nNe jamais citer hématies ou hématocrite, même si hors norme.\n\nURGENCE\n\nCommencer la ligne par URGENCE : si au moins un critère suivant est présent :\nvaleur critique signalée par le laboratoire ;\nrésultat urgent ou appel prescripteur signalé par le laboratoire ;\nK+ très bas ou très élevé, sauf hémolyse signalée ;\nsodium très bas ou très élevé ;\ncalcium corrigé très bas ou très élevé ;\nGly très basse ou très élevée ;\nHb très basse ;\nPlaq très basses ;\nPNN très bas ;\nLeuco très élevés ;\nINR très élevé ;\nfibrinogène très bas ;\nlactates élevés ;\npH très acide ou très alcalin ;\nASAT ou ALAT très élevées ;\ncréat très élevée ou insuffisance rénale aiguë mentionnée, surtout avec hyperkaliémie ;\nLIPASE très élevée avec douleur abdominale ou contexte évocateur fourni ;\nhémoculture positive, paludisme positif ou LCR évocateur d’infection bactérienne ;\nTROPO élevée avec variation significative si deux dosages sont fournis ;\nTROPO ou D-dimères critiques si le laboratoire le signale ou si le contexte clinique fourni évoque douleur thoracique, dyspnée, embolie pulmonaire, syncope, déficit neurologique ou urgence cardiovasculaire.\n\nSi K+ élevé avec hémolyse signalée :\nciter K+ et hémolyse, mais ne pas mettre URGENCE uniquement pour ce K+.\n\nSTYLE FINAL\n\nUne seule ligne.\nStyle médical télégraphique.\nUniquement résultats bruts.\nForme normale : nom valeur unité.\nForme anormale : nom flèche nombre unité.\nPour ASAT, ALAT et GGT anormales : nom flèche nombreN si calcul possible.\nNe jamais écrire ASAT ↑ 72 U/L 1.4N.\nÉcrire ASAT ↑ 1.4N.\nNe jamais écrire d’interprétation médicale.\nNe jamais écrire de diagnostic.\nNe jamais écrire hypercholestérolémie, hypertriglycéridémie, dyslipidémie, syndrome inflammatoire, cytolyse, cholestase, anémie, diabète déséquilibré, pancréatite, infarctus, SCA, IDM, grossesse, infection, sauf si explicitement écrit dans le compte-rendu.\nNe jamais regrouper les résultats sous un diagnostic.\nNe jamais mettre les résultats entre parenthèses.\nNe jamais écrire une règle du prompt.\nNe jamais écrire un seuil générique du prompt.\nÉcrire uniquement les résultats biologiques bruts utiles.\nNe jamais ajouter les normes, minimums ou maximums après la valeur.\nSéparer par des virgules.\nUtiliser et uniquement avant le dernier élément.\nUtiliser ↑ ou ↓ si hors norme.\nUtiliser ↑↑ ou ↓↓ si très anormal.\n\nAUTO-CONTRÔLE SILENCIEUX\n\nAvant de répondre, contrôler silencieusement que la sortie finale est une seule ligne, qu’elle ne commence pas par un tiret, qu’elle contient uniquement des résultats biologiques du patient ou les formules Bilan RAS, ECBU RAS, IST RAS, qu’elle ne contient aucune règle du prompt, aucun seuil générique, aucune norme de laboratoire, aucun diagnostic, aucune parenthèse, et qu’elle contient tous les marqueurs obligatoires disponibles.\n\nVérifier aussi que la sortie finale ne contient jamais Hématies ni Hématocrite, et qu’elle utilise bien Hb, Leuco, Mono et Plaq.\n\nNe jamais afficher cet auto-contrôle.";

  const LMSTUDIO_PROMPT_ACTIVE = `Tu es médecin généraliste en France.

Analyse le compte-rendu de biologie fourni.

OBJECTIF

Produire une seule ligne de synthèse biologique courte, avec :
- les anomalies biologiques utiles ;
- les marqueurs obligatoires disponibles, même normaux ;
- les bilans normaux utiles sous forme abrégée : ECBU RAS, IST RAS, Hémoccult RAS ;
- les anomalies les plus graves en premier ;
- uniquement des résultats biologiques bruts ;
- aucun diagnostic ;
- aucune interprétation médicale ;
- aucune conduite à tenir ;
- aucun commentaire long.

RÈGLE ANTI-RECOPIE DU PROMPT

La sortie finale ne doit jamais contenir une phrase, un seuil, une règle, une consigne, un titre ou une liste provenant du prompt.
La sortie finale ne doit jamais commencer par un tiret.
La sortie finale ne doit jamais reprendre une phrase du type “si”, “ne jamais”, “toujours”, “commencer la ligne”, “citer”, “écrire”, “vérifier”, “critère”, “règle”, “prompt”.
Si une consigne du prompt risque d’être recopiée, l’ignorer et produire uniquement les vrais résultats biologiques du patient.

RÈGLE ANTI-FAUX BILAN RAS

Avant de répondre “Bilan RAS”, analyser toute la biologie ligne par ligne.

Ne jamais répondre “Bilan RAS” si au moins une valeur à citer est :
- hors intervalle Minimum / Maximum du laboratoire ;
- affichée en rouge, gras rouge, couleur d’anomalie ou signalée comme anormale ;
- accompagnée d’une flèche ou d’un commentaire d’alerte ;
- manifestement pathologique selon les seuils importants du prompt.

Exception : certaines valeurs sont interdites dans la sortie finale, même si elles sont anormales. Ne pas les citer : créatinine sanguine, créat, cholestérol total, CT, saturation, hématies, hématocrite, CCMH, chlore, chlorémie, chlorures.
Ne jamais écrire Hématies, hématies, HÉMATIES, Hématocrite, hématocrite ou HÉMATOCRITE dans la sortie finale, même si la valeur est basse, haute, rouge, critique ou hors norme.
Ne jamais écrire CCMH, Chlore, chlore, Chlorémie, chlorémie, Chlorure, chlorure, Chlorures, chlorures, Cl ou Cl- dans la sortie finale, même si la valeur est basse, haute, rouge, critique ou hors norme.

Si le tableau contient les colonnes Libellé / Valeur / Unité / Minimum / Maximum :
comparer la valeur mesurée au Minimum et au Maximum.
Si Valeur < Minimum : citer la valeur avec ↓, sauf si cette valeur fait partie des valeurs interdites dans la sortie finale.
Si Valeur > Maximum : citer la valeur avec ↑, sauf si cette valeur fait partie des valeurs interdites dans la sortie finale.
Ne jamais afficher les Minimum / Maximum dans la sortie finale.

En cas de doute entre “Bilan RAS” et citer une valeur anormale autorisée, citer la valeur anormale autorisée.
“Bilan RAS” est autorisé uniquement si aucune valeur anormale autorisée, aucun marqueur obligatoire, aucun ECBU normal, aucun bilan IST normal et aucun test Hémoccult négatif ne doit être cité.

SOURCE UNIQUE

Utilise uniquement les résultats fournis.
Ne jamais inventer une valeur, une unité, une norme, une date ou un contexte clinique.
Les normes du laboratoire sont prioritaires.
Si une norme manque, ne pas conclure sauf seuil très pathologique évident.
Tenir compte des unités.
Ne pas interpréter cliniquement au-delà du résultat biologique.

MARQUEURS OBLIGATOIRES

Toujours citer ces marqueurs s’ils sont disponibles, même normaux :
LDL, non-HDL, TROPO, CRP, PCT, BNP, HG, LIPASE, DFG, HCG, INR.

Notation obligatoire :
LDL : écrire LDL
non-HDL : écrire non-HDL sans espace avant la valeur
troponine : écrire TROPO
CRP : écrire CRP
procalcitonine : écrire PCT
NT-proBNP ou BNP : écrire BNP
HbA1c ou hémoglobine glyquée : écrire HG
lipase : écrire LIPASE
DFG : écrire DFG, sans unité
Si plusieurs DFG sont présents, utiliser uniquement la valeur CKD ou CKD-EPI.
Ne jamais citer les DFG MDRD, Cockcroft, Schwartz ou autre méthode si un DFG CKD/CKD-EPI est disponible.
Dans la sortie finale, écrire seulement DFG et la valeur, sans nom de méthode.
bêta-HCG : écrire HCG
INR : écrire INR

Ne jamais répondre seulement “Bilan RAS”, “ECBU RAS”, “IST RAS” ou “Hémoccult RAS” si un marqueur obligatoire est disponible.
Si un marqueur obligatoire est présent dans la biologie, il doit être présent dans la sortie finale.
Si INR est présent dans la biologie, il doit toujours être présent dans la sortie finale, même normal.
Ne jamais répondre uniquement “Bilan RAS” si INR est disponible.
Si DFG est présent dans la biologie, il doit toujours être présent dans la sortie finale, même normal.
Ne jamais afficher la créatinine sanguine ni créat dans la sortie finale, même si elle est anormale.
Si DFG est disponible, afficher DFG et ne jamais afficher créat.
Si DFG est absent, ne pas afficher créat non plus.
Si plusieurs lignes de DFG sont disponibles, garder uniquement le DFG CKD ou CKD-EPI.
Ne jamais afficher plusieurs DFG dans la même sortie.

SORTIE FINALE

Répondre uniquement par une seule ligne.
Ne jamais faire de retour à la ligne.
Ne jamais écrire d’explication.
Ne jamais écrire de liste.
Ne jamais commencer par un tiret.

La sortie finale doit contenir uniquement :
- des résultats biologiques bruts du patient ;
- ou Bilan RAS avec marqueurs obligatoires disponibles ;
- ou ECBU RAS avec marqueurs obligatoires disponibles ;
- ou IST RAS avec marqueurs obligatoires disponibles ;
- ou Hémoccult RAS avec marqueurs obligatoires disponibles ;
- ou IMPORTANT : suivi des vrais résultats biologiques très pathologiques du patient.

Ne jamais écrire :
Résumé, Anomalies, Alarme, À RELIRE, à relire, Relire, IMPORTANT si la biologie n’est pas très pathologique, AUCUNE, Bilans RAS.

Écrire toujours “Bilan RAS” au singulier, jamais “Bilans RAS”.

Le seul préfixe autorisé est :
IMPORTANT :

Utiliser IMPORTANT : uniquement si une valeur est très pathologique, critique, ou correspond à un seuil IMPORTANT défini plus bas.
Sinon, ne mettre aucun préfixe.

Si aucune anomalie significative autorisée, aucun marqueur obligatoire disponible, aucun ECBU normal, aucun bilan IST normal et aucun test Hémoccult négatif :
Bilan RAS

Si aucune anomalie significative autorisée mais marqueurs obligatoires disponibles :
Bilan RAS, puis les marqueurs obligatoires disponibles.

Si ECBU présent et normal sans anomalie associée :
ECBU RAS

Si ECBU présent et normal avec marqueurs obligatoires disponibles :
ECBU RAS, puis les marqueurs obligatoires disponibles.

Si bilan IST présent et normal sans anomalie associée :
IST RAS

Si bilan IST présent et normal avec marqueurs obligatoires disponibles :
IST RAS, puis les marqueurs obligatoires disponibles.

Si recherche de sang dans les selles négative sans anomalie associée :
Hémoccult RAS

Si recherche de sang dans les selles négative avec marqueurs obligatoires disponibles :
Hémoccult RAS, puis les marqueurs obligatoires disponibles.

Si recherche de sang dans les selles positive :
IMPORTANT : Hémoccult positif

Si anomalie biologique autorisée :
écrire directement les anomalies avec nom du marqueur, flèche si nécessaire, valeur et unité.

NORMES

Ne jamais afficher les limites, normes, minimums ou maximums du laboratoire dans la sortie finale.
Les normes servent uniquement à savoir si une valeur est normale ou anormale.
La sortie finale doit contenir uniquement la valeur mesurée et son unité.
Exception : pour ASAT, ALAT et GGT élevées, utiliser la norme haute uniquement pour calculer le nombre de fois la norme, mais ne jamais afficher la norme elle-même.

CHOLESTÉROL / LIPIDES

Ne jamais afficher le cholestérol total.
Ne jamais afficher CT.
Même si cholestérol total ou CT est anormal, ne pas le citer dans la sortie finale.
Pour les fractions de cholestérol, les seuls libellés autorisés dans la sortie finale sont : HDL, LDL, non-HDL.
Écrire exactement HDL, LDL ou non-HDL.
Ne jamais écrire Cholestérol HDL, Cholestérol LDL, Cholestérol L.D.L., Cholestérol H.D.L., LDL-cholestérol, HDL-cholestérol, non-HDL-cholestérol, L.D.L. ou H.D.L.
LDL doit toujours être affiché s’il est disponible.
non-HDL doit toujours être affiché s’il est disponible.
HDL doit être affiché uniquement s’il est anormal ou utile.
TG doit être affiché uniquement s’il est anormal ou utile.
Pour HDL, LDL et non-HDL, l’unité de sortie obligatoire est g/L.
Ne jamais afficher mmol/L pour HDL, LDL ou non-HDL.
Si une valeur en g/L est fournie, utiliser la valeur en g/L.
Si seule une valeur en mmol/L est fournie pour HDL, LDL ou non-HDL, convertir en g/L avec le facteur cholestérol mmol/L × 0,3867, arrondir à 0,01 g/L, et afficher uniquement g/L.
Sorties interdites : CHOLESTÉROL HDL 1.49 mmol/L ; Cholestérol L.D.L. ↑ 4.30 mmol/L.
Formats autorisés : HDL 0,58 g/L ; LDL ↑ 1,66 g/L ; non-HDL 1,90 g/L.
Ne jamais afficher le rapport CT/HDL.
Ne jamais utiliser le cholestérol total comme anomalie principale.
Pour le bilan lipidique, privilégier : LDL, non-HDL, HDL si anormal, TG si anormal.

REIN / DFG / CRÉATININE

DFG doit toujours être affiché s’il est disponible, même normal.
DFG s’écrit sans unité.
Si plusieurs DFG sont fournis, choisir uniquement le DFG CKD ou CKD-EPI.
Ignorer les DFG MDRD, Cockcroft, Schwartz ou toute autre méthode dès qu’un DFG CKD/CKD-EPI existe.
Ne jamais afficher plusieurs DFG.
Ne jamais écrire CKD, CKD-EPI, MDRD, Cockcroft ou Schwartz dans la sortie finale : écrire uniquement DFG suivi de la valeur choisie.
Ne jamais afficher la créatinine sanguine dans la sortie finale.
Ne jamais afficher créat dans la sortie finale.
Même si la créatinine sanguine est basse, haute, rouge, critique ou hors norme, ne pas la citer.
Si DFG et créatinine sanguine sont tous les deux disponibles, garder seulement DFG.
Si DFG est absent, ne pas remplacer par la créatinine sanguine.
Créat U reste autorisé uniquement pour la créatinine urinaire si elle est utile ou anormale.

ABRÉVIATIONS OBLIGATOIRES

Triglycérides : TG
Glycémie : Gly
Potassium : K+
Sodium : Na
Calcium corrigé : Ca corr
Polynucléaires neutrophiles : PNN
Hémoglobine : Hb
Leucocytes : Leuco
Monocytes : Mono
Plaquettes : Plaq
Ferritine : ferr
Créatinine urinaire : Créat U
Rapport protéinurie/créatininurie, Ratio PTU/CU, Rapport ProtU/CrU ou équivalent : RAC
INR : INR
PSA : PSA
Anticorps : Ac

Ne jamais écrire dans la sortie finale :
triglycérides, glycémie, troponine, créatinine, créat, Créatinine urinaire, Rapport ProtU/CrU, cholestérol total, CT, rapport CT/HDL, Cholestérol HDL, Cholestérol LDL, Cholestérol L.D.L., Cholestérol H.D.L., non-HDL-cholestérol, LDL-cholestérol, HDL-cholestérol, L.D.L., H.D.L., mmol/L pour HDL/LDL/non-HDL, Anticorps, anticorps, ANTICORPS, Hémoglobine, Leucocytes, Monocytes, Plaquettes, plaquettes, Hématies, hématies, HÉMATIES, Hématocrite, hématocrite, HÉMATOCRITE, Saturation, saturation, CCMH, ccmh, Chlore, chlore, Chlorémie, chlorémie, Chlorure, chlorure, Chlorures, chlorures, Cl, Cl-.

Ne jamais écrire Anticorps, anticorps ou ANTICORPS dans la sortie finale : écrire Ac.
Ne jamais afficher les hématies dans la sortie finale, même si elles sont basses ou hautes.
Ne jamais afficher l’hématocrite dans la sortie finale, même s’il est bas ou haut.
Ne jamais écrire Hématies ni Hématocrite dans la sortie finale, quelle que soit la casse ou l’accentuation.
Ne jamais afficher la saturation dans la sortie finale, même si elle est basse ou haute.
Ne jamais afficher la créatinine sanguine dans la sortie finale, même si elle est basse ou haute.
Ne jamais afficher le CCMH dans la sortie finale, même s’il est bas ou haut.
Ne jamais afficher le chlore, la chlorémie ou les chlorures dans la sortie finale, même s’ils sont bas ou hauts.
Pour une anomalie de l’hémoglobine, afficher uniquement Hb.
Pour une anomalie des leucocytes, afficher uniquement Leuco.
Pour une anomalie des monocytes, afficher uniquement Mono.
Pour une anomalie des plaquettes, afficher uniquement Plaq.

UNITÉS À PRÉFÉRER SI PLUSIEURS SONT DISPONIBLES

LDL : g/L
non-HDL : g/L
HDL : g/L
Pour HDL, LDL et non-HDL, g/L est obligatoire ; ne jamais afficher mmol/L.
TG : g/L
HG : %
Hb : g/dL
DFG : valeur seule sans unité
INR : valeur seule sans unité
PSA : garder l’unité fournie
Pour les autres marqueurs : garder l’unité fournie.

Ne citer qu’une seule fois une même analyse.
Ne pas citer les unités alternatives si l’unité préférée est disponible.
Ne pas citer les valeurs historiques sauf évolution clairement utile.

RÈGLES SPÉCIALES

Si Hb basse selon la norme :
citer Hb, et ajouter ferr et VGM s’ils sont disponibles.
Ne pas citer les hématies.
Ne pas citer l’hématocrite.
Ne jamais remplacer Hb par Hématies ou Hématocrite.

Si TSH anormale :
citer TSH et ajouter T4L si disponible.

Si B12 ou folates bas :
citer B12 ou folates, et ajouter VGM si disponible.

Si BNP élevé :
citer BNP et ajouter DFG si disponible.

Si HCG disponible :
toujours citer HCG.
Ne pas écrire grossesse sauf si explicitement écrit dans le compte-rendu.

Si INR disponible :
toujours citer INR avec sa valeur, même normal.
Si INR est hors norme, ajouter ↑ ou ↓ selon le résultat.
Si INR est très élevé ou critique selon le compte-rendu, le placer parmi les premières anomalies.

Si PSA est disponible et au-dessus de la norme du laboratoire, positif ou signalé anormal :
toujours citer PSA avec sa valeur.
Si PSA >10 µg/L ou >10 ng/mL :
commencer par IMPORTANT :.

ECBU

Si un ECBU est présent et normal, écrire :
ECBU RAS

Considérer ECBU normal si le compte-rendu mentionne une culture stérile, des cultures restées stériles, une absence d’infection urinaire, une absence de colonisation, une absence de bactériurie significative, une absence de leucocyturie significative, une absence de germe pathogène ou un examen cytobactériologique normal.

Si ECBU normal et autres marqueurs obligatoires disponibles, écrire ECBU RAS, puis les marqueurs obligatoires disponibles.

Si ECBU positif avec un germe cité :
commencer par IMPORTANT : et citer le germe.
Exemples de germes à reconnaître : E. coli, Escherichia coli, Klebsiella, Proteus, Enterococcus, Enterobacter, Staphylococcus, Streptococcus, Pseudomonas, Candida.

Si ECBU anormal sans germe cité, ne pas écrire ECBU RAS.
Citer uniquement les éléments utiles : leucocyturie, hématurie, nitrites, bactériurie, commentaire à contrôler si présent.
Ne pas mettre IMPORTANT : pour un ECBU anormal sans germe cité, sauf commentaire critique ou urgent du laboratoire.

Ne jamais confondre ECBU RAS avec IST RAS.

IST

Si bilan IST présent et tous les résultats fournis sont négatifs ou normaux :
ajouter IST RAS.

Si un résultat IST est positif, douteux, limite, indéterminé ou à contrôler :
commencer par IMPORTANT : et citer uniquement le résultat concerné.
Ne pas écrire IST RAS.

IST inclut notamment VIH, syphilis, TPHA, VDRL, Chlamydia, gonocoque, Neisseria gonorrhoeae, Mycoplasma genitalium, VHB, VHC, Ag HBs, Ac anti-HBs, Ac anti-HBc.

RECHERCHE DE SANG DANS LES SELLES / HÉMOCCULT

Si un test de recherche de sang dans les selles est présent et négatif, écrire :
Hémoccult RAS

Si un test de recherche de sang dans les selles est présent et positif, commencer la sortie par :
IMPORTANT : Hémoccult positif

Termes équivalents à reconnaître :
Hémoccult, Hemoccult, Hémocult, recherche de sang dans les selles, sang occulte dans les selles, RSOS, test immunologique fécal, FIT, dépistage colorectal, test colorectal.

Si le résultat est négatif, normal, absent de sang, non détecté ou inférieur au seuil :
écrire Hémoccult RAS.

Si le résultat est positif, sang détecté, supérieur au seuil, anormal ou à contrôler :
écrire IMPORTANT : Hémoccult positif.

Ne jamais confondre Hémoccult RAS avec ECBU RAS ou IST RAS.

ASAT / ALAT / GGT

Si ASAT, ALAT ou GGT sont élevées :
- si la limite supérieure de la norme est disponible et cohérente, afficher uniquement le nombre de fois la norme ;
- calculer valeur divisée par limite supérieure ;
- arrondir à une décimale ;
- utiliser une virgule décimale ;
- écrire directement sous la forme : ASAT 1,4N, ALAT 2,8N ou GGT 3,1N ;
- ne pas afficher la valeur mesurée ;
- ne pas afficher l’unité ;
- ne pas mettre de flèche ;
- ne pas mettre de parenthèses ;
- ne pas écrire ≈ ;
- ne pas écrire x ;
- ne pas écrire U/L.

Si la norme haute est absente, incohérente ou aberrante :
citer la valeur mesurée avec son unité.

Si la valeur est normale :
ne pas calculer en N et ne pas citer sauf nécessité particulière.

SEUILS INTERNES IMPORTANT

Ces seuils servent uniquement à décider si la ligne doit commencer par IMPORTANT :.
Ne jamais recopier ces seuils dans la sortie finale.
Ne jamais afficher les seuils eux-mêmes.

Commencer la ligne par IMPORTANT : si au moins un des critères suivants est présent :
résultat critique ou urgent signalé par le laboratoire ; appel prescripteur ou résultat à téléphoner ; Hémoccult positif ; hémoculture positive ; LCR évocateur d’infection bactérienne ; paludisme positif ; IST positive, douteuse, indéterminée ou à contrôler ; ECBU positif avec un germe cité ; K+ <3,0 mmol/L ou ≥5,5 mmol/L hors hémolyse ; Na <130 mmol/L ou >150 mmol/L ; Ca corr <2,00 mmol/L ou >2,75 mmol/L ; magnésium <0,50 mmol/L ou >1,20 mmol/L ; phosphore <0,50 mmol/L ou >2,00 mmol/L ; Gly <0,60 g/L ou ≥2,50 g/L ; Gly <3,3 mmol/L ou ≥13,9 mmol/L ; cétones positives avec Gly élevée ; HG ≥9,0 % ; Hb <10,0 g/dL ; Leuco <3,0 G/L ou >20 G/L ; PNN <1,0 G/L ; Plaq <100 G/L ou >700 G/L ; INR >3,0 ; fibrinogène <1,5 g/L ; DFG <30 ; DFG <45 si nouveau ou aggravation nette ; baisse du DFG >25 % si historique disponible ; RAC albuminurie/créatininurie >30 mg/mmol ; ratio protéinurie/créatininurie >50 mg/mmol ; protéinurie ≥0,5 g/L ; ASAT ≥5N ; ALAT ≥5N ; GGT ≥10N ; PAL ≥3N ; bilirubine totale ≥50 µmol/L ; bilirubine conjuguée ≥20 µmol/L ; LIPASE ≥3N ; CRP ≥100 mg/L ; CRP ≥50 mg/L avec Leuco ou PNN élevés ; PCT ≥0,5 µg/L ; lactates ≥3 mmol/L ; pH <7,30 ou >7,55 ; TROPO au-dessus de la norme du laboratoire ; TROPO avec variation significative ; NT-proBNP ≥400 ng/L ou ≥400 pg/mL ; BNP ≥400 ng/L ou ≥400 pg/mL ; TSH <0,1 mUI/L avec T4L élevée ; TSH >20 mUI/L ; T4L très basse ou très élevée selon norme ; PSA >10 µg/L ou >10 ng/mL.

Si K+ élevé avec hémolyse signalée :
citer K+ et hémolyse, mais ne pas mettre IMPORTANT uniquement pour ce K+.

FAUX POSITIFS À ÉVITER

Ne pas citer les pourcentages de formule leucocytaire si la valeur absolue correspondante est normale.
Ne pas citer les hématies.
Ne pas citer l’hématocrite.
Ne jamais écrire Hématies ni Hématocrite dans la sortie finale.
Ne pas citer CCMH.
Ne pas citer chlore, chlorémie ni chlorures.
Ne pas citer la saturation.
Ne pas citer le cholestérol total.
Ne pas citer CT.
Ne pas citer le rapport CT/HDL.
Ne jamais citer la créatinine sanguine ni créat.
Ne pas citer les ratios sans utilité clinique associée, sauf RAC élevé.
Ne pas citer poids, taille ou IMC comme biologie.
Ignorer les normes manifestement aberrantes.
Ne pas citer les anomalies minimes isolées sans pertinence évidente.
Ne pas citer une valeur signalée artefactuelle comme anomalie certaine.
Si hémolyse, prélèvement coagulé, résultat douteux, limite, indéterminé, à contrôler ou non interprétable : le signaler brièvement dans la ligne.

ANOMALIES À CITER

Citer les valeurs hors norme utiles, notamment :
Hb basse ou haute, Leuco élevés ou bas, PNN élevés ou bas, Mono élevés ou bas, Plaq anormales, CRP élevée, VS élevée, PCT élevée, DFG bas, albuminurie/protéinurie, RAC élevé, ASAT/ALAT/GGT/PAL/bilirubine élevées, HG élevée, Gly élevée, LDL élevé, non-HDL élevé, HDL bas ou élevé selon norme, TG élevés, TSH anormale, T4L anormale, ferr basse ou très élevée, B12 basse, folates bas, vitamine D basse, PSA élevé ou positif, LIPASE élevée, BNP élevé, TROPO élevée, INR anormal, ECBU positif, bilan IST positif ou douteux, Hémoccult positif.

Toujours citer INR si disponible, même normal.
Toujours citer DFG si disponible, même normal.
Si plusieurs DFG sont disponibles, toujours citer uniquement la valeur CKD/CKD-EPI sous la forme DFG valeur.
Toujours citer Hémoccult RAS si recherche de sang dans les selles négative.
Toujours citer IMPORTANT : Hémoccult positif si recherche de sang dans les selles positive.
Toujours citer PSA s’il est au-dessus de la norme du laboratoire, positif ou signalé anormal.
Ne jamais citer créatinine sanguine ni créat, même si DFG absent.
Ne jamais citer cholestérol total ou CT, même si hors norme.
Ne jamais citer saturation, même si hors norme.
Ne jamais citer hématies, Hématies, HÉMATIES, hématocrite, Hématocrite ou HÉMATOCRITE, même si hors norme.
Ne jamais citer CCMH, chlore, chlorémie ou chlorures, même si hors norme.

STYLE FINAL

Une seule ligne.
Style médical télégraphique.
Uniquement résultats bruts.
Forme normale : nom valeur unité.
Forme anormale générale : nom flèche nombre unité.
Exception ASAT / ALAT / GGT : si calcul en N possible, écrire seulement nom nombreN.
Ne jamais écrire ASAT ↑72 U/L (≈1.4xN).
Ne jamais écrire ASAT ↑ 72 U/L 1.4N.
Ne jamais écrire ASAT ↑ 1,4N.
Écrire uniquement ASAT 1,4N.
Même règle pour ALAT et GGT.
Ne jamais écrire d’interprétation médicale.
Ne jamais écrire de diagnostic.
Ne jamais écrire à relire.
Ne jamais écrire À RELIRE.
Ne jamais écrire relire.
Ne jamais écrire hypercholestérolémie, hypertriglycéridémie, dyslipidémie, syndrome inflammatoire, cytolyse, cholestase, anémie, diabète déséquilibré, pancréatite, infarctus, SCA, IDM, grossesse, infection, sauf si explicitement écrit dans le compte-rendu.
Ne jamais regrouper les résultats sous un diagnostic.
Ne jamais mettre les résultats entre parenthèses.
Ne jamais écrire une règle du prompt.
Ne jamais écrire un seuil générique du prompt.
Écrire uniquement les résultats biologiques bruts utiles.
Ne jamais ajouter les normes, minimums ou maximums après la valeur.
Séparer par des virgules.
Utiliser et uniquement avant le dernier élément.
Utiliser ↑ ou ↓ si hors norme.
Utiliser ↑↑ ou ↓↓ si très anormal.

AUTO-CONTRÔLE SILENCIEUX

Avant de répondre, contrôler silencieusement que la sortie finale est une seule ligne, qu’elle ne commence pas par un tiret, qu’elle contient uniquement des résultats biologiques du patient ou les formules Bilan RAS, ECBU RAS, IST RAS, Hémoccult RAS, qu’elle ne contient aucune règle du prompt, aucun seuil générique, aucune norme de laboratoire, aucun diagnostic, aucune parenthèse, et qu’elle contient tous les marqueurs obligatoires disponibles.

Vérifier aussi que la sortie finale ne contient jamais Hématies, hématies, HÉMATIES, Hématocrite, hématocrite, HÉMATOCRITE, CCMH, ccmh, Chlore, chlore, Chlorémie, chlorémie, Chlorure, chlorure, Chlorures, chlorures, Cl, Cl-, Saturation, cholestérol total, CT, Cholestérol HDL, Cholestérol LDL, Cholestérol L.D.L., Cholestérol H.D.L., LDL-cholestérol, HDL-cholestérol, non-HDL-cholestérol, L.D.L., H.D.L., mmol/L pour HDL/LDL/non-HDL, créatinine sanguine ou créat, qu’elle utilise bien Hb, Leuco, Mono et Plaq, que HDL, LDL et non-HDL sont écrits uniquement avec ces libellés et en g/L, que ASAT, ALAT et GGT sont écrites sous la forme ASAT 1,4N, ALAT 2,8N ou GGT 3,1N lorsque le calcul est possible, que INR est toujours présent si disponible, que DFG est toujours présent si disponible, qu’un seul DFG est cité, que la valeur du DFG cité est CKD/CKD-EPI si plusieurs DFG sont disponibles, qu’elle ne contient jamais “à relire”, que Hémoccult RAS est présent si recherche de sang dans les selles négative, que IMPORTANT : Hémoccult positif est présent si recherche de sang dans les selles positive, que tout IST positif commence par IMPORTANT :, que tout ECBU positif avec germe cité commence par IMPORTANT :, que NT-proBNP ou BNP ≥400 commence par IMPORTANT :, que HG ≥9 % commence par IMPORTANT :, que Hb <10 g/dL commence par IMPORTANT :, et que PSA >10 commence par IMPORTANT :.

Ne jamais afficher cet auto-contrôle.`;

  const isWedaPage = location.hostname === WEDA_HOST && location.pathname === WEDA_PATH;
  const isHeidiPage = location.hostname === HEIDI_HOST;
  CURRENT_CHANNEL_ID = getCurrentHeidiWedaChannelId();
  STATE_KEY = getChannelStorageKey(STATE_KEY_BASE, CURRENT_CHANNEL_ID);
  JOB_KEY = getChannelStorageKey(JOB_KEY_BASE, CURRENT_CHANNEL_ID);
  RESULT_KEY = getChannelStorageKey(RESULT_KEY_BASE, CURRENT_CHANNEL_ID);
  STATUS_KEY = getChannelStorageKey(STATUS_KEY_BASE, CURRENT_CHANNEL_ID);
  AUTO_SEEN_ROWS_KEY = getChannelStorageKey(AUTO_SEEN_ROWS_KEY_BASE, CURRENT_CHANNEL_ID);

  installDebugConsoleHelpers();

  if (isWedaPage) {
    initWeda();
  }

  if (isHeidiPage) {
    initHeidi();
  }

  function getCurrentHeidiWedaChannelId() {
    if (isWedaPage) {
      return getWedaTabChannelId();
    }

    if (isHeidiPage) {
      return getHeidiWorkerChannelIdFromUrl();
    }

    return "";
  }

  function getWedaTabChannelId() {
    try {
      const existing = sanitizeStorageToken(sessionStorage.getItem(WEDA_TAB_ID_SESSION_KEY) || "");
      if (existing) {
        return existing;
      }

      const created = sanitizeStorageToken(createId("weda-tab"));
      sessionStorage.setItem(WEDA_TAB_ID_SESSION_KEY, created);
      return created;
    } catch (_error) {
      return sanitizeStorageToken(createId("weda-tab-fallback"));
    }
  }

  function getHeidiWorkerChannelIdFromUrl() {
    try {
      const params = new URLSearchParams(location.search || "");
      return sanitizeStorageToken(params.get(HEIDI_CHANNEL_PARAM) || "");
    } catch (_error) {
      return "";
    }
  }

  function getWedaWindowName(channelId = CURRENT_CHANNEL_ID) {
    const cleanChannelId = sanitizeStorageToken(channelId);
    return cleanChannelId ? `${WEDA_WINDOW_NAME_PREFIX}${cleanChannelId}`.slice(0, 120) : "";
  }

  function getHeidiWorkerWindowName(channelId = CURRENT_CHANNEL_ID) {
    const cleanChannelId = sanitizeStorageToken(channelId);
    return cleanChannelId ? `${HEIDI_WORKER_WINDOW_NAME_PREFIX}${cleanChannelId}`.slice(0, 120) : "";
  }

  function registerWedaWindowName() {
    if (!isWedaPage || !CURRENT_CHANNEL_ID) {
      return;
    }

    const expectedName = getWedaWindowName(CURRENT_CHANNEL_ID);
    if (!expectedName) {
      return;
    }

    try {
      const currentName = String(window.name || "");
      if (currentName && currentName !== expectedName && !sessionStorage.getItem(WEDA_PREVIOUS_WINDOW_NAME_SESSION_KEY)) {
        sessionStorage.setItem(WEDA_PREVIOUS_WINDOW_NAME_SESSION_KEY, currentName);
      }

      if (window.name !== expectedName) {
        window.name = expectedName;
      }

      appendDebugLog("weda:window-name-registered", {
        channelId: CURRENT_CHANNEL_ID,
        expectedName,
        previousNameWasEmpty: !currentName,
        changed: currentName !== expectedName,
      });
    } catch (error) {
      appendDebugLog("weda:window-name-register-error", {
        channelId: CURRENT_CHANNEL_ID,
        error: error.message,
      });
    }
  }

  function sanitizeStorageToken(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9_.-]/g, "")
      .slice(0, 80);
  }

  function getChannelStorageKey(baseKey, channelId = CURRENT_CHANNEL_ID) {
    const cleanChannelId = sanitizeStorageToken(channelId);
    return cleanChannelId ? `${baseKey}.${cleanChannelId}` : `${baseKey}.noChannel`;
  }

  function getCurrentChannelDebugInfo() {
    return {
      channelId: CURRENT_CHANNEL_ID || "",
      stateKey: STATE_KEY,
      jobKey: JOB_KEY,
      resultKey: RESULT_KEY,
      statusKey: STATUS_KEY,
      autoSeenRowsKey: AUTO_SEEN_ROWS_KEY,
      isChannelScoped: Boolean(CURRENT_CHANNEL_ID),
    };
  }

  function initWeda() {
    registerWedaWindowName();
    createWedaPanel();
    setupPendingBiologyFaviconBadge();
    syncPanelWithState();
    appendDebugLog("weda:init", {
      version: getScriptVersion(),
      channelId: CURRENT_CHANNEL_ID,
      hasGrid: Boolean(document.querySelector("#ContentPlaceHolder1_HprimsGrid")),
    });

    GM_addValueChangeListener(RESULT_KEY, (_name, _oldValue, result) => {
      if (result) {
        handleLmStudioResult(result);
      }
    });

    GM_addValueChangeListener(STATUS_KEY, (_name, _oldValue, status) => {
      const state = getState();
      if (status && status.channelId && status.channelId !== CURRENT_CHANNEL_ID) {
        appendDebugLog("weda:lmstudio-status-ignored-channel-mismatch", {
          jobId: status.jobId || "",
          statusChannelId: status.channelId,
          expectedChannelId: CURRENT_CHANNEL_ID,
        });
        return;
      }

      if (status && status.jobId === state.currentJobId) {
        appendDebugLog("weda:lmstudio-status-received", {
          jobId: status.jobId,
          channelId: status.channelId || "",
          message: status.message,
          action: status.action || "",
        });
        setPanelStatus(status.message);
        if (status.action === "focusWeda") {
          focusOwnWedaTab(status.focusReason || "status-focusWeda");
        }
      }
    });

    GM_addValueChangeListener(DEBUG_LOG_KEY, () => {
      renderDebugLogs();
    });

    const existingResult = GM_getValue(RESULT_KEY, null);
    if (existingResult) {
      window.setTimeout(() => handleLmStudioResult(existingResult), 250);
    }

    const state = getState();
    if (state.running) {
      window.setTimeout(() => resumeWedaWorkflow(), 700);
    }

    setupRememberedTitleAutofill();
    setupManualTitleEditProtection();
    window.setTimeout(() => applyRememberedTitleForSelectedRow(), 900);
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
      <div class="wbh-header">
        <div class="wbh-title">Analyse biologies LM Studio</div>
        <div id="wbh-version" title="Version du script exécutée">Version ${SCRIPT_VERSION}</div>
        <button type="button" id="wbh-collapse" title="Réduire le module" aria-label="Réduire le module">↘</button>
      </div>
      <div class="wbh-body">
        <button type="button" id="wbh-start">ANALYSE BIOLOGIES LM STUDIO</button>
        <div class="wbh-auto-settings">
          <label for="wbh-auto-duration">Durée auto</label>
          <input type="number" id="wbh-auto-duration" min="10" max="86400" step="10" inputmode="numeric">
          <span>s</span>
        </div>
        <button type="button" id="wbh-auto">${getAutoButtonInactiveLabel()}</button>
        <button type="button" id="wbh-clear-memory">Effacer mémoire</button>
        <button type="button" id="wbh-stop">Arrêter</button>
        <div class="wbh-debug-actions" aria-label="Actions de debug">
          <button type="button" id="wbh-show-logs">Logs</button>
          <button type="button" id="wbh-copy-debug-package">Copier rapport + logs</button>
          <button type="button" id="wbh-clear-logs">Effacer logs</button>
        </div>
        <div id="${STATUS_ID}">Prêt.</div>
        <div id="${DEBUG_LOG_PANEL_ID}" hidden>
          <textarea id="${DEBUG_LOG_TEXTAREA_ID}" readonly></textarea>
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
        touch-action: none;
      }
      #${PANEL_ID} .wbh-title {
        flex: 1;
        font-weight: 700;
      }
      #${PANEL_ID} #wbh-version {
        flex: 0 0 auto;
        min-width: 52px;
        padding: 3px 7px;
        border: 1px solid #6d8bd4;
        border-radius: 999px;
        background: #e8f0ff;
        color: #174ea6;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.2;
        text-align: center;
        white-space: nowrap;
      }
      #${PANEL_ID}.wbh-dragging {
        transition: none;
        opacity: 0.94;
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
      #${PANEL_ID}.wbh-collapsed .wbh-body {
        display: none;
      }
      #${PANEL_ID}.wbh-collapsed #wbh-version {
        min-width: 64px;
        padding: 5px 8px;
        border-color: #fff;
        background: #fff;
        color: #174ea6;
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
      #${PANEL_ID} .wbh-debug-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 2px 0 8px 0;
        padding: 7px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #eef2ff;
      }
      #${PANEL_ID} .wbh-debug-actions button {
        margin: 0;
      }
      #${PANEL_ID} .wbh-auto-settings {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 0 0 8px 0;
      }
      #${PANEL_ID} .wbh-auto-settings label {
        font-size: 12px;
        font-weight: 700;
      }
      #${PANEL_ID} #wbh-auto-duration {
        width: 76px;
        min-width: 0;
        border: 1px solid #6d8bd4;
        border-radius: 6px;
        padding: 5px 7px;
        color: #14264a;
        font-size: 12px;
        font-weight: 700;
        box-sizing: border-box;
      }
      #${PANEL_ID} .wbh-auto-settings span {
        font-size: 12px;
        font-weight: 700;
      }
      #${PANEL_ID} #wbh-show-logs,
      #${PANEL_ID} #wbh-copy-debug-package,
      #${PANEL_ID} #wbh-clear-logs {
        background: #fff;
        border-color: #475569;
        color: #334155;
      }
      #${PANEL_ID} #wbh-clear-logs {
        border-color: #b91c1c;
        color: #b91c1c;
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
    applyStoredWedaPanelPosition(panel);
    setupWedaPanelDrag(panel);

    document.getElementById("wbh-collapse").addEventListener("click", toggleWedaPanelCollapsed);
    document.getElementById("wbh-start").addEventListener("click", startWedaWorkflow);
    document.getElementById("wbh-auto").addEventListener("click", toggleAutoMode);
    document.getElementById("wbh-auto-duration").addEventListener("change", applyAutoDurationFromInput);
    document.getElementById("wbh-auto-duration").addEventListener("blur", applyAutoDurationFromInput);
    document.getElementById("wbh-auto-duration").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      }
    });
    document.getElementById("wbh-clear-memory").addEventListener("click", clearRememberedTitles);
    document.getElementById("wbh-show-logs").addEventListener("click", toggleDebugLogPanel);
    document.getElementById("wbh-copy-debug-package").addEventListener("click", copyDebugPackage);
    document.getElementById("wbh-clear-logs").addEventListener("click", clearDebugLogs);
    document.getElementById("wbh-stop").addEventListener("click", stopWedaWorkflow);
  }

  function applyStoredWedaPanelPosition(panel) {
    const position = GM_getValue(PANEL_POSITION_KEY, null);

    if (!position || !Number.isFinite(Number(position.left)) || !Number.isFinite(Number(position.top))) {
      return;
    }

    setWedaPanelPosition(panel, Number(position.left), Number(position.top), false);
    keepWedaPanelInViewport(panel);
  }

  function setupWedaPanelDrag(panel) {
    const header = panel.querySelector(".wbh-header");

    if (!header || header.dataset.wbhDragReady === "1") {
      return;
    }

    header.dataset.wbhDragReady = "1";
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target && event.target.closest && event.target.closest("button")) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;
      const pointerId = event.pointerId;

      event.preventDefault();
      if (typeof header.setPointerCapture === "function") {
        try {
          header.setPointerCapture(pointerId);
        } catch (error) {
          // Some injected-script contexts can reject pointer capture; dragging still works with window listeners.
        }
      }
      panel.classList.add("wbh-dragging");

      const movePanel = (moveEvent) => {
        const nextLeft = startLeft + moveEvent.clientX - startX;
        const nextTop = startTop + moveEvent.clientY - startY;
        setWedaPanelPosition(panel, nextLeft, nextTop, false);
      };

      const stopDrag = () => {
        window.removeEventListener("pointermove", movePanel);
        window.removeEventListener("pointerup", stopDrag);
        window.removeEventListener("pointercancel", stopDrag);
        if (typeof header.releasePointerCapture === "function") {
          try {
            header.releasePointerCapture(pointerId);
          } catch (error) {
            // Pointer capture may already be released after pointercancel or browser focus changes.
          }
        }
        panel.classList.remove("wbh-dragging");
        keepWedaPanelInViewport(panel, true);
      };

      window.addEventListener("pointermove", movePanel);
      window.addEventListener("pointerup", stopDrag);
      window.addEventListener("pointercancel", stopDrag);
    });

    window.addEventListener("resize", () => keepWedaPanelInViewport(panel, true));
  }

  function setWedaPanelPosition(panel, left, top, persist) {
    const margin = 8;
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const safeLeft = clampNumber(left, margin, maxLeft);
    const safeTop = clampNumber(top, margin, maxTop);

    panel.style.left = `${Math.round(safeLeft)}px`;
    panel.style.top = `${Math.round(safeTop)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    if (persist) {
      GM_setValue(PANEL_POSITION_KEY, {
        left: Math.round(safeLeft),
        top: Math.round(safeTop),
      });
    }
  }

  function keepWedaPanelInViewport(panel, persist = false) {
    const rect = panel.getBoundingClientRect();
    setWedaPanelPosition(panel, rect.left, rect.top, persist);
  }

  function clampNumber(value, min, max) {
    return Math.min(Math.max(Number(value), min), max);
  }

  function normalizeAutoIntervalMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return AUTO_INTERVAL_DEFAULT_MS;
    }

    const clamped = clampNumber(numeric, AUTO_INTERVAL_MIN_MS, AUTO_INTERVAL_MAX_MS);
    return Math.round(clamped / 1000) * 1000;
  }

  function getAutoIntervalMs() {
    return normalizeAutoIntervalMs(GM_getValue(AUTO_INTERVAL_KEY, AUTO_INTERVAL_DEFAULT_MS));
  }

  function setAutoIntervalMs(intervalMs) {
    const normalized = normalizeAutoIntervalMs(intervalMs);
    GM_setValue(AUTO_INTERVAL_KEY, normalized);
    return normalized;
  }

  function getAutoButtonInactiveLabel() {
    return `MODE AUTO ${formatAutoIntervalShort(getAutoIntervalMs())}`;
  }

  function formatAutoIntervalShort(intervalMs) {
    const seconds = Math.round(normalizeAutoIntervalMs(intervalMs) / 1000);
    if (seconds < 60) {
      return `${seconds} S`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (!remainingSeconds) {
      return `${minutes} MIN`;
    }

    return `${minutes} MIN ${remainingSeconds} S`;
  }

  function formatAutoIntervalLong(intervalMs) {
    const seconds = Math.round(normalizeAutoIntervalMs(intervalMs) / 1000);
    if (seconds < 60) {
      return `${seconds} seconde(s)`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds
      ? `${minutes} minute(s) ${remainingSeconds} seconde(s)`
      : `${minutes} minute(s)`;
  }

  function applyAutoDurationFromInput() {
    const input = document.getElementById("wbh-auto-duration");
    if (!input) {
      return getAutoIntervalMs();
    }

    const previousIntervalMs = getAutoIntervalMs();
    const rawValue = String(input.value || "").trim().replace(",", ".");
    const seconds = Number(rawValue);

    if (!rawValue || !Number.isFinite(seconds)) {
      input.value = String(Math.round(previousIntervalMs / 1000));
      return previousIntervalMs;
    }

    const nextIntervalMs = setAutoIntervalMs(seconds * 1000);
    input.value = String(Math.round(nextIntervalMs / 1000));

    if (nextIntervalMs === previousIntervalMs) {
      syncPanelWithState();
      return nextIntervalMs;
    }

    appendDebugLog("weda:auto-interval-updated", {
      previousIntervalMs,
      nextIntervalMs,
    });

    const state = getState();
    if (state.autoEnabled && !state.running) {
      const nextCheckAt = Date.now() + nextIntervalMs;
      setState({
        autoRefreshPending: false,
        autoNextCheckAt: nextCheckAt,
        message: `Mode auto : durée ${formatAutoIntervalLong(nextIntervalMs)}. Prochaine vérification vers ${formatTime(nextCheckAt)}.`,
      });
      scheduleAutoRefresh();
      return nextIntervalMs;
    }

    syncPanelWithState();
    if (!state.running) {
      setPanelStatus(`Durée auto réglée sur ${formatAutoIntervalLong(nextIntervalMs)}.`);
    }
    return nextIntervalMs;
  }

  function syncPanelWithState() {
    const state = getState();
    const startButton = document.getElementById("wbh-start");
    const autoButton = document.getElementById("wbh-auto");
    const autoDurationInput = document.getElementById("wbh-auto-duration");
    const stopButton = document.getElementById("wbh-stop");

    applyWedaPanelCollapsed(Boolean(state.panelCollapsed));

    if (startButton) {
      startButton.disabled = Boolean(state.running);
    }

    if (autoButton) {
      autoButton.textContent = state.autoEnabled ? "DÉSACTIVER AUTO" : getAutoButtonInactiveLabel();
      autoButton.classList.toggle("wbh-auto-on", Boolean(state.autoEnabled));
      autoButton.disabled = false;
    }

    if (autoDurationInput && document.activeElement !== autoDurationInput) {
      autoDurationInput.value = String(Math.round(getAutoIntervalMs() / 1000));
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

    await copyTextToClipboardOrSelect(text, "Logs copiés.", "Copie automatique refusée : les logs sont sélectionnés.");
  }

  async function copyDebugReport() {
    const report = buildDebugReport();
    await copyTextToClipboardOrSelect(report, "Rapport bug copié.", "Copie automatique refusée : le rapport bug est sélectionné.");
  }

  async function copyDebugPackage() {
    const report = buildDebugReport();
    const logs = formatDebugLogs();
    const packageText = limitDebugReportLength([
      "=== RAPPORT BUG COMPACT ===",
      report,
      "",
      "=== LOGS COMPACTS ===",
      logs || "Aucun log disponible.",
    ].join("\n"));

    await copyTextToClipboardOrSelect(
      packageText,
      "Rapport + logs copiés.",
      "Copie automatique refusée : le rapport + logs sont sélectionnés."
    );
  }

  async function copyTextToClipboardOrSelect(text, successMessage, fallbackMessage) {
    try {
      await navigator.clipboard.writeText(text);
      setPanelStatus(successMessage);
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

      setPanelStatus(fallbackMessage);
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

    const visibleLogs = logs.slice(-DEBUG_LOG_VIEW_MAX_ENTRIES).map(compactDebugLogEntry);
    const header = logs.length > visibleLogs.length
      ? `Journal tronqué : ${visibleLogs.length}/${logs.length} derniers événements affichés. Utiliser surtout "Copier rapport + logs".
`
      : "";

    return `${header}${visibleLogs.map((entry) => JSON.stringify(entry)).join("\n")}`;
  }

  function buildDebugReport() {
    const logs = GM_getValue(DEBUG_LOG_KEY, []);
    const allLogs = Array.isArray(logs) ? logs : [];
    const compactLogs = getCompactRecentDebugLogs(allLogs, DEBUG_REPORT_MAX_LOG_ENTRIES);
    const report = {
      reportKind: "WEDA_BIO_LMSTUDIO_DEBUG_REPORT_COMPACT",
      generatedAt: new Date().toISOString(),
      version: getScriptVersion(),
      debugSessionId,
      page: isHeidiPage ? "heidi" : isWedaPage ? "weda" : location.hostname,
      environment: getDebugEnvironment(),
      storage: getStorageDebugSnapshot(),
      pageSnapshot: getTroubleshootingSnapshot(),
      logStats: {
        stored: allLogs.length,
        included: compactLogs.length,
        maxStored: MAX_DEBUG_LOG_ENTRIES,
        maxIncludedInReport: DEBUG_REPORT_MAX_LOG_ENTRIES,
        strategy: "événements importants + fin du journal, sans données biologiques ni prompt",
      },
      recentEvents: compactLogs,
    };

    return limitDebugReportLength(JSON.stringify(report, null, 2));
  }

  function getCompactRecentDebugLogs(logs, maxEntries) {
    const safeLogs = Array.isArray(logs) ? logs : [];
    const importantLogs = safeLogs.filter((entry) => isImportantDebugEvent(entry && entry.event));
    const tailLogs = safeLogs.slice(-Math.ceil(maxEntries / 2));
    const merged = [...importantLogs.slice(-maxEntries), ...tailLogs];
    const byKey = new Map();

    merged.forEach((entry, fallbackIndex) => {
      if (!entry) {
        return;
      }
      const key = entry.seq != null ? `seq:${entry.seq}` : `${entry.at || ""}|${entry.event || ""}|${fallbackIndex}`;
      byKey.set(key, entry);
    });

    return Array.from(byKey.values())
      .sort((left, right) => getDebugEntrySortValue(left) - getDebugEntrySortValue(right))
      .slice(-maxEntries)
      .map(compactDebugLogEntry);
  }

  function isImportantDebugEvent(eventName) {
    return /(?:error|fail|timeout|relaunch|copy|answer|result|title|remember|send|context|startup|claim|job-created|row-open|extract|state:transition|unhandled|browser)/i.test(String(eventName || ""));
  }

  function getDebugEntrySortValue(entry) {
    if (entry && Number.isFinite(Number(entry.seq))) {
      return Number(entry.seq);
    }

    const timestamp = entry && entry.at ? Date.parse(entry.at) : NaN;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function compactDebugLogEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return entry;
    }

    const compact = {
      seq: entry.seq,
      at: entry.at,
      page: entry.page,
      event: entry.event,
    };

    if (entry.workflow) {
      compact.workflow = compactWorkflowForLog(entry.workflow);
    }

    if (entry.data && typeof entry.data === "object") {
      compact.data = compactDebugData(entry.data, 0);
    } else if (entry.data != null) {
      compact.data = sanitizeDebugValue(entry.data);
    }

    return compact;
  }

  function compactWorkflowForLog(workflow) {
    if (!workflow || typeof workflow !== "object") {
      return null;
    }

    return {
      running: Boolean(workflow.running),
      phase: workflow.phase || "",
      mode: workflow.mode || "",
      index: workflow.currentIndex,
      jobId: workflow.currentJobId || "",
      msg: sanitizeDebugString(workflow.message || "", 90),
    };
  }

  function compactDebugData(value, depth) {
    if (value == null || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return sanitizeDebugString(value, depth > 0 ? 120 : 180);
    }

    if (Array.isArray(value)) {
      const limit = depth >= 1 ? 4 : 8;
      const output = value.slice(0, limit).map((item) => compactDebugData(item, depth + 1));
      if (value.length > limit) {
        output.push(`... ${value.length - limit} élément(s) masqué(s)`);
      }
      return output;
    }

    if (typeof value === "object") {
      const entries = Object.entries(value).filter(([key]) => !isSensitiveDebugKey(key));
      const limit = depth >= 1 ? 8 : 14;
      const output = {};
      entries.slice(0, limit).forEach(([key, nested]) => {
        output[key] = compactDebugData(nested, depth + 1);
      });
      if (entries.length > limit) {
        output.__truncatedKeys = entries.length - limit;
      }
      return output;
    }

    return sanitizeDebugString(String(value), 120);
  }

  function limitDebugReportLength(reportText) {
    const text = String(reportText || "");
    if (text.length <= DEBUG_REPORT_MAX_CHARS) {
      return text;
    }

    const compactReport = {
      reportKind: "WEDA_BIO_LMSTUDIO_DEBUG_REPORT_COMPACT_TRUNCATED",
      generatedAt: new Date().toISOString(),
      version: getScriptVersion(),
      warning: `Rapport raccourci car il dépassait ${DEBUG_REPORT_MAX_CHARS} caractères`,
      storage: getStorageDebugSnapshot(),
      pageSnapshot: getTroubleshootingSnapshot(),
      lastEvents: getCompactRecentDebugLogs(GM_getValue(DEBUG_LOG_KEY, []), 35),
    };

    const compactText = JSON.stringify(compactReport, null, 2);
    return compactText.length <= DEBUG_REPORT_MAX_CHARS
      ? compactText
      : `${compactText.slice(0, DEBUG_REPORT_MAX_CHARS)}
... RAPPORT TRONQUÉ ...`;
  }

  function installDebugConsoleHelpers() {
    const target = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    try {
      target.WEDA_BIO_LMSTUDIO_DEBUG_REPORT = () => {
        const report = buildDebugReport();
        try {
          console.log(report);
        } catch (_error) {
          // La console peut être indisponible dans certains contextes.
        }
        return report;
      };
      target.WEDA_BIO_LMSTUDIO_DEBUG_COPY = () => copyDebugPackage();
      target.WEDA_BIO_LMSTUDIO_DEBUG_REPORT_COPY = () => copyDebugReport();
      target.WEDA_BIO_LMSTUDIO_DEBUG_LOGS = () => formatDebugLogs();
      target.WEDA_BIO_LMSTUDIO_DEBUG_SNAPSHOT = () => getTroubleshootingSnapshot();
    } catch (_error) {
      // Les helpers console sont uniquement un confort de debug.
    }

    window.addEventListener("error", (event) => {
      appendDebugLog("browser:error", {
        message: event.message || "",
        filename: event.filename || "",
        lineno: event.lineno || null,
        colno: event.colno || null,
        errorName: event.error && event.error.name ? event.error.name : "",
        stack: sanitizeStack(event.error && event.error.stack),
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason || {};
      appendDebugLog("browser:unhandledrejection", {
        message: reason.message || String(reason || ""),
        name: reason.name || "",
        stack: sanitizeStack(reason.stack),
      });
    });
  }

  function getStorageDebugSnapshot() {
    const state = GM_getValue(STATE_KEY, null);
    const job = GM_getValue(JOB_KEY, null);
    const result = GM_getValue(RESULT_KEY, null);
    const status = GM_getValue(STATUS_KEY, null);
    const rememberedTitles = GM_getValue(TITLES_KEY, {});
    const seenRows = GM_getValue(AUTO_SEEN_ROWS_KEY, {});
    const logs = GM_getValue(DEBUG_LOG_KEY, []);

    return {
      channel: getCurrentChannelDebugInfo(),
      state: summarizeWorkflowState(state),
      job: summarizeJobForDebug(job),
      result: summarizeResultForDebug(result),
      status: summarizeStatusForDebug(status),
      rememberedTitlesCount: rememberedTitles && typeof rememberedTitles === "object" ? Object.keys(rememberedTitles).length : 0,
      autoSeenRowsCount: seenRows && typeof seenRows === "object" ? Object.keys(seenRows).length : 0,
      debugLogsCount: Array.isArray(logs) ? logs.length : 0,
    };
  }

  function getTroubleshootingSnapshot() {
    if (isWedaPage) {
      return getWedaDebugSnapshot();
    }

    if (isHeidiPage) {
      return getHeidiDebugSnapshot();
    }

    return getGenericDebugSnapshot();
  }

  function getGenericDebugSnapshot() {
    return {
      channel: getCurrentChannelDebugInfo(),
      urlPath: location.pathname,
      urlSearch: sanitizeDebugString(location.search || "", 200),
      title: sanitizeDebugString(document.title || "", 120),
      readyState: document.readyState,
      visibility: document.visibilityState,
      hidden: Boolean(document.hidden),
      hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      activeElement: document.activeElement ? describeDebugElement(document.activeElement) : null,
    };
  }

  function getWedaDebugSnapshot() {
    const rows = typeof getBiologyRows === "function" ? getBiologyRows() : [];
    const selectedIndex = typeof getSelectedBiologyIndex === "function" ? getSelectedBiologyIndex() : -1;
    const displayedTable = document.querySelector("#ContentPlaceHolder1_LabelHprimDataStructure table.hprimgrid") ||
      document.querySelector("table.hprimgrid");
    const displayedText = displayedTable ? extractHprimTable(displayedTable) : extractDisplayedRawHprimText();
    const titleInput = document.querySelector("#ContentPlaceHolder1_TextBoxHprimTitre");

    return {
      ...getGenericDebugSnapshot(),
      panelPresent: Boolean(document.getElementById(PANEL_ID)),
      gridPresent: Boolean(document.querySelector("#ContentPlaceHolder1_HprimsGrid")),
      gridBodyPresent: Boolean(document.querySelector("#ContentPlaceHolder1_HprimsGrid > tbody")),
      rowsCount: rows.length,
      selectedIndex,
      selectedRowMatchesDisplayed: selectedIndex >= 0 ? isDisplayedBiologyForRow(rows[selectedIndex]) : false,
      firstRows: rows.slice(0, 8).map((row) => ({
        index: row.index,
        keyHash: hashString(row.key || ""),
        stableKeyHash: hashString(row.stableKey || ""),
        duplicateCount: row.duplicateCount,
        duplicateOccurrence: row.duplicateOccurrence,
        hasLink: Boolean(row.link),
      })),
      hprimPanelPresent: Boolean(document.querySelector("#ContentPlaceHolder1_PanelHprimView")),
      displayedContentKey: typeof getDisplayedBiologyContentKey === "function" ? getDisplayedBiologyContentKey() : "",
      displayedSourceType: displayedTable ? "table" : displayedText ? "text" : "none",
      displayedRowsCount: countBiologyLinesForLog(displayedText, displayedTable ? "table" : "text"),
      displayedStatusSummary: summarizeTableStatuses(displayedText),
      titleInputPresent: Boolean(titleInput),
      titleInputLength: titleInput ? String(titleInput.value || "").length : 0,
      savePostBackAvailable: Boolean(getPageWindow() && typeof getPageWindow().__doPostBack === "function"),
    };
  }

  function getHeidiDebugSnapshot() {
    const answerContainer = document.querySelector("#ask-ai-content") || document.querySelector("#ask-ai-container");
    const answer = extractHeidiAnswerFromAskContent();
    const askInput = document.querySelector(".ask-ai-input");
    const sendButton = findHeidiSendButton();
    const copyButton = findHeidiCopyTextButton();

    return {
      ...getGenericDebugSnapshot(),
      copyButton: findHeidiCopyTextButtonDebugSnapshot(),
      copyButtonChosen: copyButton ? describeDebugElement(copyButton) : null,
      sendButton: sendButton ? describeDebugElement(sendButton) : null,
      stillThinking: isHeidiStillThinking(),
      answerDetected: Boolean(answer),
      answerLength: answer ? answer.length : 0,
      answerContainerPresent: Boolean(answerContainer),
      answerContainerVisible: Boolean(answerContainer && isElementVisibleEnough(answerContainer)),
      answerContainerTextLength: answerContainer ? getVisibleText(answerContainer).length : 0,
      askInputPresent: Boolean(askInput),
      askInputVisible: Boolean(askInput && isElementVisible(askInput)),
      context: getHeidiContextDebugSnapshot(),
      newSession: getHeidiNewSessionDebugSnapshot(),
    };
  }

  function summarizeWorkflowState(state) {
    if (!state || typeof state !== "object") {
      return null;
    }

    return {
      running: Boolean(state.running),
      phase: state.phase || "",
      mode: state.mode || "",
      autoEnabled: Boolean(state.autoEnabled),
      autoRefreshPending: Boolean(state.autoRefreshPending),
      autoNextCheckInMs: state.autoNextCheckAt ? state.autoNextCheckAt - Date.now() : null,
      currentIndex: Number.isFinite(Number(state.currentIndex)) ? Number(state.currentIndex) : null,
      currentJobId: state.currentJobId || "",
      currentStableKeyHash: state.currentStableKey ? hashString(state.currentStableKey) : "",
      currentContentKey: state.currentContentKey || "",
      currentRowKeyHash: state.currentRowKey ? hashString(state.currentRowKey) : "",
      allowUnchangedContentKey: state.allowUnchangedContentKey || "",
      previousContentKey: state.previousContentKey || "",
      autoTargetCount: Array.isArray(state.autoTargetKeys) ? state.autoTargetKeys.length : 0,
      manualTargetCount: Array.isArray(state.manualTargetKeys) ? state.manualTargetKeys.length : 0,
      message: sanitizeDebugString(state.message || "", 240),
      updatedAgeMs: state.updatedAt ? Date.now() - state.updatedAt : null,
    };
  }

  function summarizeJobForDebug(job) {
    if (!job || typeof job !== "object") {
      return null;
    }

    return {
      id: job.id || "",
      channelId: job.channelId || "",
      rowIndex: Number.isFinite(Number(job.rowIndex)) ? Number(job.rowIndex) : null,
      rowKeyHash: job.rowKey ? hashString(job.rowKey) : "",
      rowStableKeyHash: job.rowStableKey ? hashString(job.rowStableKey) : "",
      contentKey: job.contentKey || "",
      sourceType: job.sourceType || "",
      tableLines: countBiologyLinesForLog(job.tableText || "", job.sourceType || "table"),
      statusSummary: summarizeTableStatuses(job.tableText || ""),
      hasTableHtml: Boolean(job.tableHtml),
      tableHtmlLength: job.tableHtml ? String(job.tableHtml).length : 0,
      promptLength: job.prompt ? String(job.prompt).length : 0,
      createdAgeMs: job.createdAt ? Date.now() - job.createdAt : null,
      claimedBy: job.claimedBy ? "yes" : "no",
      claimedAgeMs: job.claimedAt ? Date.now() - job.claimedAt : null,
    };
  }

  function summarizeResultForDebug(result) {
    if (!result || typeof result !== "object") {
      return null;
    }

    return {
      jobId: result.jobId || "",
      channelId: result.channelId || "",
      ok: Boolean(result.ok),
      error: sanitizeDebugString(result.error || "", 300),
      rawLength: result.raw ? String(result.raw).length : 0,
      titleLength: result.title ? String(result.title).length : 0,
      rowIndex: Number.isFinite(Number(result.rowIndex)) ? Number(result.rowIndex) : null,
      rowKeyHash: result.rowKey ? hashString(result.rowKey) : "",
      rowStableKeyHash: result.rowStableKey ? hashString(result.rowStableKey) : "",
      contentKey: result.contentKey || "",
      createdAgeMs: result.createdAt ? Date.now() - result.createdAt : null,
    };
  }

  function summarizeStatusForDebug(status) {
    if (!status || typeof status !== "object") {
      return null;
    }

    return {
      jobId: status.jobId || "",
      channelId: status.channelId || "",
      message: sanitizeDebugString(status.message || "", 240),
      action: status.action || "",
      createdAgeMs: status.createdAt ? Date.now() - status.createdAt : null,
    };
  }

  function sanitizeStack(stack) {
    return String(stack || "")
      .split("\n")
      .slice(0, 8)
      .map((line) => sanitizeDebugString(line, 220))
      .join("\n");
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
      message: "Prêt.",
      updatedAt: Date.now(),
    });
  }

  function setState(patch) {
    const previous = getState();
    const next = {
      ...previous,
      ...patch,
      updatedAt: Date.now(),
    };

    GM_setValue(STATE_KEY, next);
    logStateTransition(previous, next, patch);
    syncPanelWithState();
    return next;
  }

  function logStateTransition(previous, next, patch) {
    const importantKeys = [
      "running",
      "phase",
      "mode",
      "currentIndex",
      "currentJobId",
      "currentStableKey",
      "currentContentKey",
      "message",
      "autoEnabled",
      "autoRefreshPending",
    ];
    const changed = importantKeys.filter((key) => previous[key] !== next[key]);

    if (!changed.length) {
      return;
    }

    appendDebugLog("state:transition", {
      changed,
      patchKeys: Object.keys(patch || {}),
      previous: summarizeWorkflowState(previous),
      next: summarizeWorkflowState(next),
    });
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

    const nextCheckAt = state.autoNextCheckAt || Date.now() + getAutoIntervalMs();
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
    const nextCheckAt = Date.now() + applyAutoDurationFromInput();
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
        message: "Veille auto : recherche de nouvelles lignes...",
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
      hasGrid: Boolean(document.querySelector("#ContentPlaceHolder1_HprimsGrid")),
      hasGridBody: Boolean(document.querySelector("#ContentPlaceHolder1_HprimsGrid > tbody")),
    });

    const gridState = await waitForAutoBiologyGrid();
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

    if (!gridState.ready) {
      const nextCheckAt = Date.now() + AUTO_HEARTBEAT_MS;
      setState({
        autoRefreshPending: false,
        autoNextCheckAt: nextCheckAt,
        autoTargetKeys: [],
        manualTargetKeys: [],
        message: `Veille auto : liste Weda indisponible, nouvel essai vers ${formatTime(nextCheckAt)}.`,
      });
      scheduleAutoRefresh();
      return;
    }

    const rows = gridState.rows;
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
        message: `Veille auto : aucune nouvelle ligne. Prochaine vérification vers ${formatTime(nextCheckAt)}.`,
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
      message: `Veille auto : ${newRows.length} nouvelle(s) biologie(s) à traiter.`,
    });

    clickBiologyRow(newRows[0].index);
  }

  async function waitForAutoBiologyGrid() {
    const readGrid = () => {
      const body = document.querySelector("#ContentPlaceHolder1_HprimsGrid > tbody");

      if (!body) {
        return null;
      }

      return {
        ready: true,
        rows: getBiologyRows(),
      };
    };

    const current = readGrid();

    if (current) {
      return current;
    }

    try {
      return await waitFor(readGrid, {
        timeout: AUTO_GRID_WAIT_MS,
        interval: 600,
        description: "la liste Weda des biologies",
      });
    } catch (error) {
      appendDebugLog("weda:auto-grid-unavailable", {
        error: error.message,
        hasGrid: Boolean(document.querySelector("#ContentPlaceHolder1_HprimsGrid")),
        hasPanel: Boolean(document.querySelector("#ContentPlaceHolder1_PanelHprimView")),
      });

      return {
        ready: false,
        rows: [],
      };
    }
  }

  function setupPendingBiologyFaviconBadge() {
    attachPendingBiologyFaviconObserver();
    attachPendingBiologyFaviconHeadObserver();
    updatePendingBiologyFaviconBadge();
    window.setTimeout(() => {
      attachPendingBiologyFaviconObserver();
      attachPendingBiologyFaviconHeadObserver();
      updatePendingBiologyFaviconBadge();
    }, 1500);
  }

  function attachPendingBiologyFaviconObserver() {
    if (typeof MutationObserver !== "function") {
      return;
    }

    const target = document.querySelector("#ContentPlaceHolder1_HprimsGrid") || document.body;
    if (!target || target === pendingFaviconObservedTarget) {
      return;
    }

    if (pendingFaviconObserver) {
      pendingFaviconObserver.disconnect();
    }

    pendingFaviconObserver = new MutationObserver(schedulePendingBiologyFaviconBadgeUpdate);
    pendingFaviconObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    pendingFaviconObservedTarget = target;
  }

  function attachPendingBiologyFaviconHeadObserver() {
    if (typeof MutationObserver !== "function" || !document.head || pendingFaviconHeadObserver) {
      return;
    }

    pendingFaviconHeadObserver = new MutationObserver(schedulePendingBiologyFaviconBadgeUpdate);
    pendingFaviconHeadObserver.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel"],
    });
  }

  function schedulePendingBiologyFaviconBadgeUpdate() {
    window.clearTimeout(pendingFaviconUpdateTimer);
    pendingFaviconUpdateTimer = window.setTimeout(() => {
      attachPendingBiologyFaviconObserver();
      attachPendingBiologyFaviconHeadObserver();
      updatePendingBiologyFaviconBadge();
    }, 150);
  }

  function countPendingBiologyRows() {
    return getBiologyRows().length;
  }

  function updatePendingBiologyFaviconBadge() {
    const pendingCount = countPendingBiologyRows();
    if (pendingCount === lastPendingFaviconCount && hasPendingBiologyFaviconLinks() && !hasCompetingFaviconLinks()) {
      return;
    }

    lastPendingFaviconCount = pendingCount;
    setPendingBiologyFaviconBadge(pendingCount);
  }

  function setPendingBiologyFaviconBadge(pendingCount) {
    try {
      const canvas = createPendingBiologyFaviconCanvas(pendingCount);
      const renderToken = ++pendingFaviconRenderToken;
      applyPendingBiologyFaviconHref(canvas.toDataURL("image/png"), pendingCount, "data-url");

      if (typeof canvas.toBlob === "function" && window.URL && typeof window.URL.createObjectURL === "function") {
        canvas.toBlob((blob) => {
          if (!blob || renderToken !== pendingFaviconRenderToken) {
            return;
          }

          const previousObjectUrl = pendingFaviconObjectUrl;
          pendingFaviconObjectUrl = window.URL.createObjectURL(blob);
          applyPendingBiologyFaviconHref(pendingFaviconObjectUrl, pendingCount, "blob-url");

          if (previousObjectUrl && previousObjectUrl !== pendingFaviconObjectUrl && typeof window.URL.revokeObjectURL === "function") {
            window.setTimeout(() => window.URL.revokeObjectURL(previousObjectUrl), 60000);
          }
        }, "image/png");
      }
    } catch (error) {
      appendDebugLog("weda:pending-favicon-error", {
        pendingCount,
        error: error.message,
      });
    }
  }

  function hasPendingBiologyFaviconLinks() {
    return Boolean(document.getElementById(PENDING_FAVICON_LINK_ID) && document.getElementById(PENDING_FAVICON_SHORTCUT_LINK_ID));
  }

  function hasCompetingFaviconLinks() {
    return getCompetingFaviconLinks().length > 0;
  }

  function getCompetingFaviconLinks() {
    if (!document.head) {
      return [];
    }

    return Array.from(document.head.querySelectorAll("link[rel]"))
      .filter((link) => isFaviconLink(link) && !isPendingBiologyFaviconLink(link));
  }

  function isFaviconLink(link) {
    return /\bicon\b/i.test(String(link && link.getAttribute("rel") || ""));
  }

  function isPendingBiologyFaviconLink(link) {
    const id = link && link.id || "";
    return id === PENDING_FAVICON_LINK_ID || id === PENDING_FAVICON_SHORTCUT_LINK_ID;
  }

  function applyPendingBiologyFaviconHref(href, pendingCount, source) {
    if (!document.head) {
      return;
    }

    removeCompetingFaviconLinks();
    upsertPendingBiologyFaviconLink(PENDING_FAVICON_LINK_ID, "icon", href);
    upsertPendingBiologyFaviconLink(PENDING_FAVICON_SHORTCUT_LINK_ID, "shortcut icon", href);

    appendDebugLog("weda:pending-favicon-updated", {
      pendingCount,
      source,
      hrefKind: String(href || "").slice(0, 5),
      competingLinks: getCompetingFaviconLinks().length,
    });
  }

  function removeCompetingFaviconLinks() {
    getCompetingFaviconLinks().forEach((link) => {
      try {
        link.parentNode.removeChild(link);
      } catch (_error) {
        link.setAttribute("rel", "weda-original-icon-disabled");
      }
    });
  }

  function upsertPendingBiologyFaviconLink(id, rel, href) {
    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      document.head.appendChild(link);
    } else if (link.parentNode !== document.head) {
      document.head.appendChild(link);
    }

    link.setAttribute("rel", rel);
    link.setAttribute("type", "image/png");
    link.setAttribute("sizes", "64x64");
    link.setAttribute("href", href);
  }

  function createPendingBiologyFaviconCanvas(pendingCount) {
    const canvas = document.createElement("canvas");
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("canvas favicon indisponible");
    }

    const count = Math.max(0, Number(pendingCount) || 0);
    const label = count > 99 ? "99+" : String(count);

    context.clearRect(0, 0, size, size);
    context.beginPath();
    context.arc(size / 2, size / 2, 29, 0, Math.PI * 2);
    context.fillStyle = "#1d4ed8";
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = "rgba(255, 255, 255, 0.92)";
    context.stroke();

    context.fillStyle = "#ffffff";
    context.font = `700 ${label.length > 2 ? 22 : label.length > 1 ? 28 : 34}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, size / 2, size / 2 + 2);

    return canvas;
  }

  function startWedaWorkflow() {
    const rows = getBiologyRows();
    appendDebugLog("weda:start-manual", {
      rows: rows.length,
      hasPanel: Boolean(document.querySelector("#ContentPlaceHolder1_PanelHprimView")),
    });

    if (!rows.length) {
      setState({
        running: false,
        phase: "error",
        message: "Aucune biologie trouvée dans la liste.",
      });
      return;
    }

    GM_deleteValue(RESULT_KEY);
    GM_deleteValue(JOB_KEY);

    setState({
      running: true,
      mode: "manual",
      phase: "readyToClick",
      currentIndex: 0,
      currentRowKey: rows[0] ? rows[0].key : null,
      currentStableKey: rows[0] ? rows[0].stableKey : null,
      currentContentKey: null,
      allowUnchangedContentKey: "",
      autoTargetKeys: [],
      manualTargetKeys: rows.map((row) => row.key).filter(Boolean),
      currentJobId: null,
      message: `Démarrage : ${rows.length} biologie(s) détectée(s).`,
    });

    clickBiologyRow(0);
  }

  function stopWedaWorkflow() {
    GM_deleteValue(JOB_KEY);
    setState({
      running: false,
      mode: "manual",
      phase: "stopped",
      autoTargetKeys: [],
      manualTargetKeys: [],
      currentStableKey: null,
      currentContentKey: null,
      allowUnchangedContentKey: "",
      currentJobId: null,
      message: "Analyse arrêtée.",
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

    if (state.phase === "waitingLmStudio") {
      setPanelStatus(`Analyse LM Studio en cours pour la ligne ${state.currentIndex + 1}...`);
      return;
    }

    if (state.phase === "savingTitle") {
      setPanelStatus("Titre transmis à Weda, préparation de la ligne suivante...");
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
        finishAutoCycle("Veille auto : aucune nouvelle ligne restante.");
        return;
      }

      const row = findBiologyRowByIndexAndStableKey(state.currentIndex, state.currentStableKey) ||
        findBiologyRowByStableKey(state.currentStableKey);
      clickBiologyRow(row ? row.index : (state.currentIndex || 0));
    }
  }

  function getBiologyRows() {
    const body = document.querySelector("#ContentPlaceHolder1_HprimsGrid > tbody");
    if (!body) {
      return [];
    }

    const rows = Array.from(body.querySelectorAll("tr"))
      .filter((row) => !row.classList.contains("grid-header"))
      .map((row, index) => {
        const link =
          row.querySelector('a[id*="HprimsGrid_LinkButtonHprimNom_"]') ||
          row.querySelector('a[id*="HprimsGrid_LinkButtonHprimPrenom_"]') ||
          row.querySelector('a[id*="HprimsGrid_LinkButtonHprimDateNaissance_"]') ||
          row.querySelector('a[id*="HprimsGrid_LinkButtonHprimUserInitial_"]');

        const dateLabel = row.querySelector('label[for*="CheckBoxHprimDateResultat_"]');
        const cells = Array.from(row.cells).map((cell) => normalizeText(cell.textContent));
        const stableKey = buildBiologyStableRowKey(cells);

        return {
          index,
          row,
          link,
          stableKey,
          date: normalizeText(dateLabel ? dateLabel.textContent : ""),
          label: normalizeText(link ? link.textContent : ""),
          identityLabel: buildBiologyIdentityLabel(cells),
          cells,
        };
      })
      .filter((item) => item.link);

    const stableKeyCounts = rows.reduce((counts, row) => {
      counts[row.stableKey] = (counts[row.stableKey] || 0) + 1;
      return counts;
    }, {});
    const stableKeyOccurrences = {};

    return rows.map((row) => {
      const occurrence = (stableKeyOccurrences[row.stableKey] || 0) + 1;
      stableKeyOccurrences[row.stableKey] = occurrence;
      const duplicateCount = stableKeyCounts[row.stableKey] || 0;
      const rowKey = duplicateCount > 1 ? `${row.stableKey}#${occurrence}` : row.stableKey;

      return {
        ...row,
        key: rowKey,
        duplicateCount,
        duplicateOccurrence: occurrence,
      };
    });
  }

  function buildBiologyStableRowKey(cells) {
    return `patient-${hashString(buildBiologyIdentityText(cells))}`;
  }

  function buildBiologyIdentityText(cells) {
    const resultDate = cells[0] || "";
    const type = cells[1] || "";
    const lastName = cells[2] || "";
    const firstName = cells[3] || "";
    const birthDate = cells[4] || "";
    const practitioner = cells[5] || "";

    return [resultDate, type, lastName, firstName, birthDate, practitioner]
      .map((part) => normalizeForCompare(part))
      .join("|");
  }

  function buildBiologyIdentityLabel(cells) {
    const lastName = cells[2] || "";
    const firstName = cells[3] || "";
    const resultDate = cells[0] || "";
    const birthDate = cells[4] || "";
    return normalizeText([lastName, firstName, resultDate, birthDate].filter(Boolean).join(" "));
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

  function getExplicitSelectedBiologyItem(rows = getBiologyRows()) {
    return rows.find((item) => item.row.classList.contains("grid-selecteditem")) || null;
  }

  function getSelectedBiologyItem() {
    const rows = getBiologyRows();
    const selected = getExplicitSelectedBiologyItem(rows);
    const state = getState();

    return selected || findBiologyRowByStableKey(state.currentStableKey, rows) || rows[state.currentIndex] || null;
  }

  function getSelectedBiologyIndex() {
    const rows = getBiologyRows();
    const selected = getExplicitSelectedBiologyItem(rows);
    return selected ? selected.index : -1;
  }

  function getPageWindow() {
    return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  }

  function getLinkScriptSource(link) {
    if (!link) {
      return "";
    }

    return [
      link.getAttribute("href") || "",
      link.getAttribute("onclick") || "",
    ]
      .join("\n")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function extractWedaPostBackOptions(link) {
    const source = getLinkScriptSource(link);
    const optionsMatch =
      source.match(/WebForm_PostBackOptions\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/i) ||
      source.match(/WebForm_PostBackOptions\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/i);

    if (optionsMatch) {
      return {
        target: optionsMatch[1],
        argument: optionsMatch[2],
        causesValidation: optionsMatch[3] === "true",
        validationGroup: optionsMatch[4],
        actionUrl: optionsMatch[5],
        trackFocus: optionsMatch[6] === "true",
        clientSubmit: optionsMatch[7] === "true",
        kind: "WebForm_PostBackOptions",
      };
    }

    const doPostBackMatch =
      source.match(/__doPostBack\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/i) ||
      source.match(/__doPostBack\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/i);

    if (doPostBackMatch) {
      return {
        target: doPostBackMatch[1],
        argument: doPostBackMatch[2],
        causesValidation: false,
        validationGroup: "",
        actionUrl: "",
        trackFocus: false,
        clientSubmit: true,
        kind: "__doPostBack",
      };
    }

    return null;
  }

  function triggerWedaBiologyRowOpen(item, reason = "open") {
    const pageWindow = getPageWindow();
    const link = item && item.link;
    const options = extractWedaPostBackOptions(link);
    const hasWebFormOptions = Boolean(options && typeof pageWindow.WebForm_DoPostBackWithOptions === "function" && typeof pageWindow.WebForm_PostBackOptions === "function");
    const hasDoPostBack = Boolean(options && typeof pageWindow.__doPostBack === "function");

    appendDebugLog("weda:row-open-start", {
      reason,
      rowIndex: item ? item.index : null,
      hasLink: Boolean(link),
      postBackKind: options ? options.kind : "",
      hasWebFormOptions,
      hasDoPostBack,
    });

    if (!link) {
      throw new Error("lien Weda introuvable pour ouvrir la biologie");
    }

    if (options && hasWebFormOptions) {
      try {
        const postBackOptions = new pageWindow.WebForm_PostBackOptions(
          options.target,
          options.argument,
          options.causesValidation,
          options.validationGroup,
          options.actionUrl,
          options.trackFocus,
          options.clientSubmit,
        );
        pageWindow.WebForm_DoPostBackWithOptions(postBackOptions);
        appendDebugLog("weda:row-open-triggered", {
          reason,
          method: "WebForm_DoPostBackWithOptions",
          rowIndex: item.index,
        });
        return "WebForm_DoPostBackWithOptions";
      } catch (error) {
        appendDebugLog("weda:row-open-method-error", {
          reason,
          method: "WebForm_DoPostBackWithOptions",
          rowIndex: item.index,
          error: error.message,
        });
      }
    }

    if (options && hasDoPostBack) {
      try {
        pageWindow.__doPostBack(options.target, options.argument || "");
        appendDebugLog("weda:row-open-triggered", {
          reason,
          method: "__doPostBack",
          rowIndex: item.index,
        });
        return "__doPostBack";
      } catch (error) {
        appendDebugLog("weda:row-open-method-error", {
          reason,
          method: "__doPostBack",
          rowIndex: item.index,
          error: error.message,
        });
      }
    }

    link.click();
    appendDebugLog("weda:row-open-triggered", {
      reason,
      method: "click",
      rowIndex: item.index,
    });
    return "click";
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
          triggerWedaBiologyRowOpen(freshRow, `retry-${retryIndex + 1}`);
        } catch (error) {
          appendDebugLog("weda:row-open-retry-error", {
            retry: retryIndex + 1,
            error: error.message,
          });
        }
      }, delay);
    });
  }

  function getDisplayedBiologyContentKey(tableText) {
    const table = document.querySelector("#ContentPlaceHolder1_LabelHprimDataStructure table.hprimgrid") ||
      document.querySelector("table.hprimgrid");
    const rawText = tableText ? "" : extractDisplayedRawHprimText();

    if (!table && !tableText && !rawText) {
      return "";
    }

    const content = tableText || (table ? extractHprimTable(table) : rawText);
    const header = getDisplayedBiologyHeaderText();

    if (!content || content.split("\n").length < 2) {
      return "";
    }

    return `content-${hashString(`${header}\n${content}`)}`;
  }

  function getDisplayedBiologyHeaderText() {
    const container = document.querySelector("#ContentPlaceHolder1_LabelHprimDataStructure");

    if (container) {
      const headerParts = [];

      Array.from(container.children).some((child) => {
        if (child.matches && child.matches("table.hprimgrid")) {
          return true;
        }

        headerParts.push(normalizeText(child.textContent));
        return false;
      });

      return headerParts.join("|");
    }

    const rawText = getDisplayedRawHprimVisibleText();

    if (!rawText) {
      return "";
    }

    return rawText
      .split(/\n+/)
      .slice(0, 24)
      .map(normalizeText)
      .filter(Boolean)
      .join("|");
  }

  function isDisplayedBiologyForRow(item) {
    if (!item) {
      return false;
    }

    const header = normalizeForCompare(getDisplayedBiologyHeaderText());

    if (!header) {
      return false;
    }

    const resultDate = normalizeForCompare(item.cells[0] || "");
    const lastName = normalizeForCompare(item.cells[2] || "");
    const firstName = normalizeForCompare(item.cells[3] || "");
    const birthDate = normalizeForCompare(item.cells[4] || "");

    const hasResultDate = resultDate && header.includes(resultDate);
    const hasBirthDate = birthDate && header.includes(birthDate);
    const hasLastName = lastName && header.includes(lastName);
    const hasFirstName = firstName && header.includes(firstName);

    return Boolean(hasResultDate && hasBirthDate && (hasLastName || hasFirstName));
  }

  function getDisplayedRawHprimContainer() {
    return (
      document.querySelector("#ContentPlaceHolder1_LabelHprimData") ||
      document.querySelector("#ContentPlaceHolder1_DivDataHprim")
    );
  }

  function getDisplayedRawHprimVisibleText() {
    const container = getDisplayedRawHprimContainer();

    if (!container) {
      return "";
    }

    return normalizeHprimReportText(container.innerText || container.textContent || "");
  }

  function extractDisplayedRawHprimText() {
    return filterRawHprimReportText(getDisplayedRawHprimVisibleText());
  }

  function normalizeHprimReportText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .split(/\n+/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function filterRawHprimReportText(value) {
    const lines = normalizeHprimReportText(value).split(/\n+/).filter(Boolean);

    if (!lines.length) {
      return "";
    }

    const startIndex = lines.findIndex(isLikelyRawBiologyStartLine);
    const usefulLines = startIndex >= 0 ? lines.slice(startIndex) : lines;

    return usefulLines
      .filter((line) => !isAdministrativeRawHprimLine(line))
      .join("\n")
      .trim();
  }

  function isLikelyRawBiologyStartLine(line) {
    const normalized = normalizeForCompare(line);
    return /^(?:valeurs de reference|infectiologie|hematologie|biochimie|immunologie|serologie|bacteriologie|virologie|hormonologie|analyses?|recherche|resultat|ecbu)\b/.test(normalized);
  }

  function isAdministrativeRawHprimLine(line) {
    const normalized = normalizeForCompare(line);

    if (!normalized) {
      return true;
    }

    if (/^(?:date du resultat|date d[’' ]importation|patient hprim|date de naissance|demande n|date de prelevement|dossier|enregistre le|edite le|interlocuteur|madame|monsieur|mademoiselle|dr\s|docteur\s)/.test(normalized)) {
      return true;
    }

    if (/^(?:ide|biologiste|dprlvt|hprlvt|saa|med[0-9]|building|patsex|etat)\|/.test(normalized)) {
      return true;
    }

    if (/^(?:synlab|biomnis\s*-|cc leclerc)\b/.test(normalized)) {
      return true;
    }

    if (/\b(?:avenue|allee|rue|boulevard|cedex|telephone|tel\.?|bp)\b/.test(normalized)) {
      return true;
    }

    if (/^\d{4,5}\s+[a-z]/.test(normalized)) {
      return true;
    }

    if (/^[A-ZÀ-ÖØ-Þ' -]{2,}\s+[A-ZÀ-ÖØ-Þ' -]{2,}$/.test(line) && !isLikelyBiologyUppercaseLine(line)) {
      return true;
    }

    return false;
  }

  function isLikelyBiologyUppercaseLine(line) {
    return /\b(?:ECBU|VIH|VHB|VHC|CRP|VS|PCT|BNP|NT|TROPO|LIPASE|HCG|DFG|ASAT|ALAT|GGT|PAL|TSH|T4L|PSA|INR|LDL|HDL|HBA1C|HELICOBACTER)\b/i.test(line);
  }

  async function waitForDisplayedBiology(item, previousContentKey, options = {}) {
    return waitFor(() => {
      const table =
        document.querySelector("#ContentPlaceHolder1_LabelHprimDataStructure table.hprimgrid") ||
        document.querySelector("table.hprimgrid");

      const rawText = table ? "" : extractDisplayedRawHprimText();
      const tableText = table ? extractHprimTable(table) : rawText;

      if (!tableText || tableText.split("\n").length < 2) {
        return null;
      }

      const contentKey = getDisplayedBiologyContentKey(tableText);
      const identityOk = isDisplayedBiologyForRow(item);
      const changedOk = !previousContentKey || contentKey !== previousContentKey;
      const expectedContentKey = options.expectedContentKey || "";
      const allowContentKey = options.allowContentKey || "";

      if (expectedContentKey) {
        if (contentKey === expectedContentKey) {
          return {
            table,
            tableText,
            contentKey,
            sourceType: table ? "table" : "text",
            identityOk,
          };
        }

        return null;
      }

      if (identityOk && (changedOk || contentKey === allowContentKey)) {
        return {
          table,
          tableText,
          contentKey,
          sourceType: table ? "table" : "text",
        };
      }

      return null;
    }, {
      timeout: 25000,
      interval: 350,
      description: "la biologie correspondant à la ligne cliquée",
    });
  }

  function setupRememberedTitleAutofill() {
    const grid = document.querySelector("#ContentPlaceHolder1_HprimsGrid");
    if (grid) {
      grid.addEventListener("click", () => {
        window.setTimeout(() => applyRememberedTitleForSelectedRow(), 1700);
      }, true);
    }

    if (!titleAutofillInterval) {
      titleAutofillInterval = window.setInterval(() => {
        applyRememberedTitleForSelectedRow({ silent: true });
      }, 1200);
    }

    const panel = document.querySelector("#ContentPlaceHolder1_PanelHprimView");
    if (!panel || typeof MutationObserver === "undefined") {
      return;
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => applyRememberedTitleForSelectedRow(), 500);
    });

    observer.observe(panel, {
      childList: true,
      subtree: true,
    });
  }

  function setupManualTitleEditProtection() {
    if (manualTitleEditProtectionReady) {
      return;
    }

    manualTitleEditProtectionReady = true;

    document.addEventListener("focusin", (event) => {
      if (!isWedaTitleInput(event.target) || getState().running) {
        return;
      }

      markManualTitleEdit(event.target, "focus", false);
    }, true);

    document.addEventListener("keydown", (event) => {
      if (!isWedaTitleInput(event.target) || getState().running || event.isTrusted === false) {
        return;
      }

      if (
        String(event.key || "").length === 1 ||
        /^(?:Backspace|Delete|Enter)$/i.test(event.key || "")
      ) {
        markManualTitleEdit(event.target, "keydown", true);
      }
    }, true);

    document.addEventListener("input", (event) => {
      if (!isWedaTitleInput(event.target) || getState().running || event.isTrusted === false) {
        return;
      }

      markManualTitleEdit(event.target, "input", true);
    }, true);

    document.addEventListener("change", (event) => {
      if (!isWedaTitleInput(event.target) || getState().running || event.isTrusted === false) {
        return;
      }

      markManualTitleEdit(event.target, "change", true);
      rememberManualTitleEdit(event.target, "change");
    }, true);

    document.addEventListener("focusout", (event) => {
      if (!isWedaTitleInput(event.target) || getState().running) {
        return;
      }

      finishManualTitleEdit(event.target, "focusout");
    }, true);
  }

  function isWedaTitleInput(element) {
    return Boolean(element && element.id === "ContentPlaceHolder1_TextBoxHprimTitre");
  }

  function markManualTitleEdit(input, reason, dirty) {
    const contentKey = getDisplayedBiologyContentKey();
    const item = getSelectedBiologyItem();

    if (!contentKey) {
      return;
    }

    const previous = manualTitleEditState;
    const now = Date.now();
    const isSameBiology = previous && previous.contentKey === contentKey;
    const wasInactive = !previous || !previous.active;

    manualTitleEditState = {
      contentKey,
      rowKey: item ? item.key : "",
      rowStableKey: item ? item.stableKey : "",
      rowIndex: item ? item.index : null,
      startedAt: isSameBiology && previous.startedAt ? previous.startedAt : now,
      updatedAt: now,
      lockUntil: (dirty || previous && previous.dirty) ? now + MANUAL_TITLE_EDIT_GRACE_MS : now,
      active: true,
      dirty: Boolean(dirty || previous && previous.dirty),
      value: sanitizeTitle(input.value),
    };

    if (wasInactive || !isSameBiology) {
      appendDebugLog("weda:manual-title-edit-start", {
        reason,
        contentKey,
        rowIndex: item ? item.index : null,
        currentLength: manualTitleEditState.value.length,
        dirty: Boolean(dirty),
      });
    }
  }

  function finishManualTitleEdit(input, reason) {
    const contentKey = getDisplayedBiologyContentKey();

    if (!manualTitleEditState || manualTitleEditState.contentKey !== contentKey) {
      return;
    }

    const wasDirty = Boolean(manualTitleEditState.dirty);
    manualTitleEditState = {
      ...manualTitleEditState,
      active: false,
      updatedAt: Date.now(),
      lockUntil: wasDirty ? Date.now() + MANUAL_TITLE_EDIT_GRACE_MS : Date.now(),
      value: sanitizeTitle(input.value),
    };

    if (wasDirty) {
      rememberManualTitleEdit(input, reason);
    }
  }

  function shouldPreserveManualTitleEdit(input, contentKey) {
    if (!input || !contentKey) {
      return false;
    }

    if (document.activeElement === input) {
      return true;
    }

    return Boolean(
      manualTitleEditState &&
      manualTitleEditState.contentKey === contentKey &&
      (manualTitleEditState.active || Date.now() <= Number(manualTitleEditState.lockUntil || 0))
    );
  }

  function rememberManualTitleEdit(input, reason) {
    const title = sanitizeTitle(input && input.value ? input.value : "");

    if (!title || !isManualUserTitleAllowed(title)) {
      return false;
    }

    const item = getSelectedBiologyItem();
    const contentKey = getDisplayedBiologyContentKey();
    const primaryKey = contentKey || (item && (item.key || item.stableKey)) || "";

    if (!primaryKey) {
      return false;
    }

    if (item && !isDisplayedBiologyForRow(item)) {
      appendDebugLog("weda:manual-title-memory-skip", {
        reason,
        contentKey,
        titleLength: title.length,
        reasonDetail: "selected-row-does-not-match-displayed-biology",
      });
      return false;
    }

    rememberTitle(primaryKey, title, {
      rowKey: item ? item.key : "",
      rowStableKey: item ? item.stableKey : "",
      rowIdentity: item ? item.identityLabel : "",
      rowIndex: item ? item.index : undefined,
      contentKey,
      titleSource: "manual-user-title",
      rememberReason: reason,
    });

    appendDebugLog("weda:manual-title-remembered", {
      reason,
      primaryKey,
      contentKey,
      rowIndex: item ? item.index : null,
      titleLength: title.length,
    });
    return true;
  }

  function isManualUserTitleAllowed(title) {
    const text = sanitizeTitle(title);

    if (!text || text.length > 350 || isOnlyPunctuationText(text)) {
      return false;
    }

    return !(
      hasForbiddenHeidiLineText(text) ||
      hasForbiddenLipidOutput(text) ||
      hasForbiddenBloodOutput(text) ||
      isHeidiUiNoiseLine(text) ||
      isPromptInstructionLine(text)
    );
  }

  function applyRememberedTitleForSelectedRow(options = {}) {
    const state = getState();

    if (state.running) {
      return;
    }

    const item = getSelectedBiologyItem();
    const explicitSelectedItem = getExplicitSelectedBiologyItem();
    const input = document.querySelector("#ContentPlaceHolder1_TextBoxHprimTitre");

    if (!input) {
      return;
    }

    if (explicitSelectedItem && !isDisplayedBiologyForRow(explicitSelectedItem)) {
      return;
    }

    if (item && !isDisplayedBiologyForRow(item)) {
      return;
    }

    const contentKey = getDisplayedBiologyContentKey();

    if (!contentKey) {
      return;
    }

    if (shouldPreserveManualTitleEdit(input, contentKey)) {
      return;
    }

    const rememberedInfo = getRememberedTitleForBiology(contentKey, item);
    const remembered = rememberedInfo.title;
    const currentTitle = sanitizeTitle(input.value);

    if (!remembered || currentTitle === remembered) {
      return;
    }

    if (currentTitle && !isRememberedTitleFromAnotherBiology(currentTitle, rememberedInfo.key || contentKey)) {
      return;
    }

    appendDebugLog("weda:remembered-title-apply", {
      contentKey,
      selectedRowKey: item ? item.key : "",
      selectedStableKey: item ? item.stableKey : "",
      memoryKey: rememberedInfo.key || "",
      titleLength: remembered.length,
      autoSave: false,
      autoSaveRequested: Boolean(options.autoSave),
      saveSuppressed: Boolean(options.autoSave),
    });

    const assignmentGuard = item
      ? buildTitleAssignmentGuard({
        rowIndex: item.index,
        rowKey: item.key,
        rowStableKey: item.stableKey,
        rowIdentity: item.identityLabel,
        contentKey,
      }, item, contentKey, { jobId: "remembered-title" })
      : null;

    if (assignmentGuard) {
      try {
        assertTitleAssignmentTarget(assignmentGuard, "before-remembered-title-write");
      } catch (error) {
        appendDebugLog("weda:remembered-title-apply-aborted", {
          contentKey,
          memoryKey: rememberedInfo.key || "",
          error: error.message,
        });
        return;
      }
    }

    input.value = remembered;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    if (!options.silent) {
      const lineLabel = item ? ` pour la ligne ${item.index + 1}` : "";
      setPanelStatus(`Titre mémorisé réaffiché${lineLabel}, sans sauvegarde automatique.`);
    }
  }

  function normalizeRememberTitleMetadata(metadata = {}) {
    const normalized = metadata && typeof metadata === "object" ? { ...metadata } : {};
    const source = String(normalized.titleSource || normalized.source || normalized.origin || "");

    if (source && !normalized.titleSource) {
      normalized.titleSource = source;
    }

    return normalized;
  }

  function getRememberedTitleIdentityKey(identityLabel) {
    const clean = normalizeForCompare(identityLabel || "");
    return clean ? `identity-${hashString(clean)}` : "";
  }

  function buildRememberedTitleKeys(primaryKey, metadata = {}) {
    const normalized = metadata && typeof metadata === "object" ? metadata : {};
    const keys = [
      primaryKey,
      normalized.contentKey,
      normalized.rowKey,
      normalized.rowStableKey,
      getRememberedTitleIdentityKey(normalized.rowIdentity || normalized.identityLabel),
    ];

    if (normalized.rowIndex !== undefined && normalized.rowStableKey) {
      keys.push(`row-${normalized.rowIndex}-${normalized.rowStableKey}`);
    }

    return Array.from(new Set(keys
      .map((key) => String(key || "").trim())
      .filter(Boolean)));
  }

  function buildRememberedTitleLookupKeys(contentKey, item = null) {
    return buildRememberedTitleKeys(contentKey, {
      contentKey,
      rowKey: item ? item.key : "",
      rowStableKey: item ? item.stableKey : "",
      rowIdentity: item ? item.identityLabel : "",
      rowIndex: item ? item.index : undefined,
    });
  }

  function isRememberedTitleEntryAllowed(entry = {}, title = "") {
    const cleanTitle = sanitizeTitle(title || (entry && entry.title));

    if (!cleanTitle) {
      return false;
    }

    if (entry && entry.titleSource === "manual-user-title") {
      return isManualUserTitleAllowed(cleanTitle);
    }

    return isTitleAllowedForWedaInsertion(cleanTitle, entry) || isExpectedTitleLine(cleanTitle) || isSoftBiologyTitleLine(cleanTitle, entry);
  }

  function rememberTitle(rowKey, title, metadata = {}) {
    if (!rowKey || !title) {
      return;
    }

    const cleanTitle = sanitizeTitle(title);
    const normalizedMetadata = normalizeRememberTitleMetadata(metadata);
    const candidateEntry = {
      title: cleanTitle,
      ...normalizedMetadata,
    };

    if (!isRememberedTitleEntryAllowed(candidateEntry, cleanTitle)) {
      appendDebugLog("weda:remember-title-rejected", {
        rowKey,
        titleLength: cleanTitle.length,
        titleSource: normalizedMetadata.titleSource || "",
      });
      return;
    }

    const titles = GM_getValue(TITLES_KEY, {});
    const memoryKeys = buildRememberedTitleKeys(rowKey, normalizedMetadata);
    const primaryMemoryKey = memoryKeys[0] || rowKey;
    const now = Date.now();

    const entryToStore = {
      ...candidateEntry,
      primaryKey: rowKey,
      memoryKey: primaryMemoryKey,
      aliasKeys: memoryKeys,
      updatedAt: now,
    };

    // On écrit l'entrée sur chaque alias. Cela évite le cas observé où la première biologie
    // était bien traitée mais impossible à retrouver ensuite parce que WEDA changeait de clé
    // entre l'ouverture, le postback de sauvegarde et le retour sur la ligne.
    memoryKeys.forEach((memoryKey) => {
      titles[memoryKey] = {
        ...entryToStore,
        memoryKey,
      };
    });

    const entries = Object.entries(titles)
      .sort((left, right) => (right[1].updatedAt || 0) - (left[1].updatedAt || 0))
      .slice(0, Math.max(MAX_REMEMBERED_TITLES, MAX_REMEMBERED_TITLES * 4));

    GM_setValue(TITLES_KEY, Object.fromEntries(entries));
    appendDebugLog("weda:title-remembered", {
      rowKey,
      memoryKeys,
      titleLength: cleanTitle.length,
      titleSource: normalizedMetadata.titleSource || "",
      rememberedCount: entries.length,
    });
  }

  function getRememberedTitle(rowKey) {
    if (!rowKey) {
      return "";
    }

    const titles = GM_getValue(TITLES_KEY, {});
    const entry = titles[rowKey];
    const title = entry ? sanitizeTitle(entry.title) : "";

    if (title && !isRememberedTitleEntryAllowed(entry, title)) {
      delete titles[rowKey];
      GM_setValue(TITLES_KEY, titles);
      appendDebugLog("weda:remembered-title-dropped", {
        rowKey,
        titleLength: title.length,
        titleSource: entry && (entry.titleSource || entry.source) ? String(entry.titleSource || entry.source) : "",
      });
      return "";
    }

    return title;
  }

  function getRememberedTitleForBiology(contentKey, item = null) {
    if (!contentKey) {
      return { title: "", key: "", triedKeys: [] };
    }

    const keys = buildRememberedTitleLookupKeys(contentKey, item);
    const titles = GM_getValue(TITLES_KEY, {});

    for (const key of keys) {
      const entry = titles[key];
      const title = entry ? sanitizeTitle(entry.title) : "";
      if (title && isRememberedTitleEntryAllowed(entry, title) && isRememberedTitleEntryForContent(entry, key, contentKey)) {
        return { title, key, triedKeys: keys };
      }
    }

    const keySet = new Set(keys);
    const matchingEntry = Object.entries(titles).find(([memoryKey, entry]) => {
      const aliasKeys = Array.isArray(entry && entry.aliasKeys) ? entry.aliasKeys : [];
      return isRememberedTitleEntryForContent(entry, memoryKey, contentKey) &&
        aliasKeys.some((aliasKey) => keySet.has(aliasKey));
    });

    if (matchingEntry) {
      const [memoryKey, entry] = matchingEntry;
      const title = sanitizeTitle(entry && entry.title);
      if (title && isRememberedTitleEntryAllowed(entry, title)) {
        return { title, key: memoryKey, triedKeys: keys };
      }
    }

    return { title: "", key: "", triedKeys: keys };
  }

  function isRememberedTitleEntryForContent(entry = {}, memoryKey = "", contentKey = "") {
    if (!contentKey) {
      return false;
    }

    const entryContentKey = String(entry && entry.contentKey || "");
    if (entryContentKey) {
      return entryContentKey === contentKey;
    }

    return String(memoryKey || "") === contentKey;
  }

  function rememberCurrentDisplayedTitle(reason = "", extraMetadata = {}) {
    const input = document.querySelector("#ContentPlaceHolder1_TextBoxHprimTitre");
    const title = sanitizeTitle(input && input.value ? input.value : "");

    if (!title) {
      return false;
    }

    const item = getSelectedBiologyItem();
    const contentKey = getDisplayedBiologyContentKey();
    const primaryKey = contentKey || (item && (item.key || item.stableKey)) || "";

    if (extraMetadata.contentKey && contentKey && extraMetadata.contentKey !== contentKey) {
      appendDebugLog("weda:current-title-memory-skip", {
        reason,
        expectedContentKey: extraMetadata.contentKey,
        displayedContentKey: contentKey,
        titleLength: title.length,
      });
      return false;
    }

    if (item && !isDisplayedBiologyForRow(item)) {
      appendDebugLog("weda:current-title-memory-skip", {
        reason,
        contentKey,
        titleLength: title.length,
        reasonDetail: "selected-row-does-not-match-displayed-biology",
      });
      return false;
    }

    if (!primaryKey) {
      return false;
    }

    const metadata = {
      rowKey: item ? item.key : "",
      rowStableKey: item ? item.stableKey : "",
      rowIdentity: item ? item.identityLabel : "",
      rowIndex: item ? item.index : undefined,
      contentKey,
      titleSource: extraMetadata.titleSource || "existing-weda-title",
      rememberReason: reason,
      ...extraMetadata,
    };

    if (!isTitleAllowedForWedaInsertion(title, metadata)) {
      appendDebugLog("weda:current-title-memory-skip", {
        reason,
        primaryKey,
        titleLength: title.length,
        titleSource: metadata.titleSource || "",
      });
      return false;
    }

    rememberTitle(primaryKey, title, metadata);
    appendDebugLog("weda:current-title-remembered", {
      reason,
      primaryKey,
      contentKey,
      rowKey: item ? item.key : "",
      rowStableKey: item ? item.stableKey : "",
      titleLength: title.length,
    });
    return true;
  }

  function isRememberedTitleFromAnotherBiology(title, currentKey) {
    const currentTitle = sanitizeTitle(title);
    const titles = GM_getValue(TITLES_KEY, {});

    return Object.entries(titles).some(([key, entry]) => {
      const rememberedTitle = sanitizeTitle(entry && entry.title);
      return key !== currentKey && isRememberedTitleEntryAllowed(entry, rememberedTitle) && rememberedTitle === currentTitle;
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
    const nextCheckAt = Date.now() + getAutoIntervalMs();
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
      message: `${message} Prochaine vérification vers ${formatTime(nextCheckAt)}.`,
    });
    scheduleAutoRefresh();
  }

  function clickBiologyRow(index) {
    const state = getState();
    const rows = getBiologyRows();

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
        message: `Terminé : ${rows.length} biologie(s) parcourue(s).`,
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
      message: `Ouverture de la biologie ${index + 1}/${rows.length}...`,
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
      failWeda(`Impossible d'ouvrir la biologie : ${error.message}`);
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
    }, 1800);
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

    if (!state.running || state.phase !== "clickedRow") {
      return;
    }

    if (!row) {
      failWeda("La ligne Weda en cours est introuvable.");
      return;
    }

    setPanelStatus(`Lecture du tableau ${state.currentIndex + 1}/${rows.length || "?"}...`);

    try {
      if (row.index !== state.currentIndex || row.stableKey !== state.currentStableKey) {
        setState({
          currentIndex: row.index,
          currentRowKey: row.key,
          currentStableKey: row.stableKey,
        });
      }

      const displayedBiology = await waitForDisplayedBiology(row, state.previousContentKey || "", {
        allowContentKey: state.allowUnchangedContentKey || "",
      });
      const tableText = displayedBiology.tableText;
      const tableHtml = displayedBiology.table ? extractHprimTableHtml(displayedBiology.table) : "";
      const contentKey = displayedBiology.contentKey;
      const sourceType = displayedBiology.sourceType || "table";
      appendDebugLog("weda:displayed-biology-ready", {
        rowIndex: row.index,
        contentKey,
        sourceType,
        tableRows: countBiologyLinesForLog(tableText, sourceType),
      });

      if (!tableText || tableText.split("\n").length < 2) {
        throw new Error("Le tableau biologique est vide ou illisible.");
      }

      const jobId = createId("bio");
      const job = {
        id: jobId,
        channelId: CURRENT_CHANNEL_ID,
        ownerTabId: CURRENT_CHANNEL_ID,
        rowIndex: row.index,
        rowKey: row.key,
        rowStableKey: row.stableKey,
        rowIdentity: row.identityLabel,
        contentKey,
        tableText,
        tableHtml,
        sourceType,
        prompt: LMSTUDIO_PROMPT_ACTIVE,
        createdAt: Date.now(),
      };

      GM_deleteValue(RESULT_KEY);
      GM_setValue(JOB_KEY, job);
      appendDebugLog("weda:job-created", {
        jobId,
        channelId: CURRENT_CHANNEL_ID,
        rowIndex: row.index,
        rowKey: row.key,
        contentKey,
        sourceType,
        tableRows: countBiologyLinesForLog(tableText, sourceType),
        statusSummary: summarizeTableStatuses(tableText),
        contextHtmlLength: tableHtml.length,
      });

      setState({
        running: true,
        phase: "waitingLmStudio",
        currentJobId: jobId,
        currentContentKey: contentKey,
        allowUnchangedContentKey: "",
        message: `Analyse LM Studio : ligne ${state.currentIndex + 1}/${rows.length || "?"}.`,
      });

      const result = await runLmStudioJob(job);
      await handleLmStudioResult(result);
    } catch (error) {
      appendDebugLog("weda:extract-error", {
        error: error.message,
      });
      failWeda(`Impossible de lire ou analyser la biologie : ${error.message}`);
    }
  }

  function extractHprimTable(table) {
    return extractHprimTableRows(table)
      .map((row) => row.join("\t"))
      .join("\n");
  }

  function extractHprimTableHtml(table) {
    const rows = extractHprimTableRows(table);

    if (rows.length < 2) {
      return "";
    }

    const head = rows[0]
      .map((cell) => `<th>${escapeHtml(cell)}</th>`)
      .join("");
    const body = rows.slice(1)
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("");

    return [
      '<table>',
      `<thead><tr>${head}</tr></thead>`,
      `<tbody>${body}</tbody>`,
      '</table>',
    ].join("");
  }

  function extractHprimTableRows(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    const output = [["Libellé", "Valeur", "Unité", "Minimum", "Maximum", "Statut Weda"]];

    rows.slice(1).forEach((row) => {
      const cells = Array.from(row.cells).map((cell) => normalizeText(cell.textContent));

      if (cells.length < 3) {
        return;
      }

      const label = cells[1] || "";
      const value = cells[2] || "";
      const unit = cells[3] || "";
      const min = cells[4] || "";
      const max = cells[5] || "";
      const numericStatus = getBiologyValueStatus(value, min, max);
      const visualStatus = getBiologyVisualStatus(row);
      const status = mergeBiologyStatuses(numericStatus, visualStatus);

      if (!label && !value) {
        return;
      }

      output.push([label, value, unit, min, max, status]);
    });

    return output;
  }

  function isStructuredHprimTableText(tableText) {
    const firstLine = String(tableText || "").split(/\n/)[0] || "";
    const cells = firstLine.split("\t").map(normalizeText);
    return cells[0] === "Libellé" && cells[1] === "Valeur";
  }

  function countBiologyLinesForLog(tableText, sourceType = "") {
    const lines = String(tableText || "").split(/\n+/).filter(Boolean).length;
    return sourceType === "text" ? lines : Math.max(0, lines - 1);
  }

  function summarizeTableStatuses(tableText) {
    if (!isStructuredHprimTableText(tableText)) {
      return {
        TEXTE: countBiologyLinesForLog(tableText, "text"),
      };
    }

    const summary = {};

    String(tableText || "")
      .split(/\n+/)
      .slice(1)
      .forEach((line) => {
        const cells = line.split("\t").map(normalizeText);
        const status = cells[5] || "VIDE";
        summary[status] = (summary[status] || 0) + 1;
      });

    return summary;
  }

  function getBiologyValueStatus(value, min, max) {
    const normalized = normalizeForCompare(value);

    if (!normalized) {
      return "";
    }

    if (/(douteux|limite|indetermine|a controler|controle|non interpretable|hemolyse|coagule|critique|urgent|appel prescripteur)/.test(normalized)) {
      return "À RELIRE";
    }

    if (/(positif|positive|detecte|detectee|presence|isole|isolee)/.test(normalized) &&
      !/(negatif|negative|non detecte|non detectee|absence|sterile)/.test(normalized)) {
      return "À RELIRE";
    }

    const valueNumber = parseBiologyNumber(value);
    const minNumber = parseBiologyNumber(min);
    const maxNumber = parseBiologyNumber(max);
    const hasMin = minNumber && isUsableBiologyNorm(minNumber.value);
    const hasMax = maxNumber && isUsableBiologyNorm(maxNumber.value);

    if (!valueNumber) {
      return min || max ? "À VÉRIFIER" : "NORMES ABSENTES";
    }

    if (hasMin && isDefinitelyBelowMinimum(valueNumber, minNumber.value)) {
      return "BAS";
    }

    if (hasMax && isDefinitelyAboveMaximum(valueNumber, maxNumber.value)) {
      return "HAUT";
    }

    if (hasMin || hasMax) {
      return "NORMAL";
    }

    return "NORMES ABSENTES";
  }

  function mergeBiologyStatuses(numericStatus, visualStatus) {
    if (/^(?:HAUT|BAS|À RELIRE|À VÉRIFIER)$/.test(numericStatus || "")) {
      return numericStatus;
    }

    return visualStatus || numericStatus;
  }

  function getBiologyVisualStatus(row) {
    if (!row) {
      return "";
    }

    const cellsToInspect = Array.from(row.cells).slice(1, 4);
    const hasRedMarker = cellsToInspect.some((cell) => elementHasRedAnomalyStyle(cell));

    return hasRedMarker ? "À RELIRE" : "";
  }

  function elementHasRedAnomalyStyle(element) {
    if (!element) {
      return false;
    }

    const nodes = [
      element,
      ...Array.from(element.querySelectorAll ? element.querySelectorAll("*") : []),
    ];

    return nodes.some((node) => {
      const style = window.getComputedStyle(node);
      return isRedCssColor(style.color) || isRedCssColor(style.backgroundColor);
    });
  }

  function isRedCssColor(value) {
    const color = String(value || "").trim().toLowerCase();

    if (!color || color === "transparent" || color === "inherit") {
      return false;
    }

    if (color === "red") {
      return true;
    }

    const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgb) {
      const red = Number(rgb[1]);
      const green = Number(rgb[2]);
      const blue = Number(rgb[3]);
      return red >= 140 && green <= 90 && blue <= 90;
    }

    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hex) {
      return false;
    }

    const valuePart = hex[1].length === 3
      ? hex[1].split("").map((part) => part + part).join("")
      : hex[1];
    const red = parseInt(valuePart.slice(0, 2), 16);
    const green = parseInt(valuePart.slice(2, 4), 16);
    const blue = parseInt(valuePart.slice(4, 6), 16);

    return red >= 140 && green <= 90 && blue <= 90;
  }

  function parseBiologyNumber(value) {
    const text = normalizeText(value)
      .replace(/\s/g, "")
      .replace(/,/g, ".");
    const match = text.match(/^([<>≤≥])?\s*(-?\d+(?:\.\d+)?)/);

    if (!match) {
      return null;
    }

    const numericValue = Number(match[2]);
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    return {
      operator: match[1] || "",
      value: numericValue,
    };
  }

  function isUsableBiologyNorm(value) {
    return Number.isFinite(value) && Math.abs(value) < 99999;
  }

  function isDefinitelyBelowMinimum(valueNumber, minValue) {
    if (valueNumber.operator === ">" || valueNumber.operator === "≥") {
      return false;
    }

    return valueNumber.value < minValue ||
      ((valueNumber.operator === "<" || valueNumber.operator === "≤") && valueNumber.value <= minValue);
  }

  function isDefinitelyAboveMaximum(valueNumber, maxValue) {
    if (valueNumber.operator === "<" || valueNumber.operator === "≤") {
      return false;
    }

    return valueNumber.value > maxValue ||
      ((valueNumber.operator === ">" || valueNumber.operator === "≥") && valueNumber.value >= maxValue);
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
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getDisplayedStructuredOrRawTableTextForFallback() {
    const table = document.querySelector("#ContentPlaceHolder1_LabelHprimDataStructure table.hprimgrid") ||
      document.querySelector("table.hprimgrid");

    if (table) {
      return extractHprimTable(table);
    }

    return extractDisplayedRawHprimText();
  }

  function isWedaGeneratedFallbackTitle(result = {}, title = "") {
    const source = String(result.titleSource || result.source || "");
    const text = sanitizeTitle(title || result.title || result.raw || "");

    if (!text || text.length > 350 || isOnlyPunctuationText(text)) {
      return false;
    }

    if (source !== "weda-status-fallback" && source !== "displayed-weda-fallback") {
      return false;
    }

    if (isPromptInstructionLine(text) || hasForbiddenHeidiLineTextWithoutWedaStatus(text) || hasForbiddenBloodOutput(text)) {
      return false;
    }

    return true;
  }

  function isPermissiveHumanBiologyTitleLine(value, result = {}) {
    const text = sanitizeTitle(value);
    const source = String(result && (result.titleSource || result.source || result.origin) || "");

    if (!text || text.length < 4 || text.length > 350 || isOnlyPunctuationText(text)) {
      return false;
    }

    if (hasForbiddenHeidiLineTextWithoutWedaStatus(text) || hasForbiddenLipidOutput(text) || hasForbiddenBloodOutput(text) || isHeidiUiNoiseLine(text) || isPromptInstructionLine(text)) {
      return false;
    }

    if (/^(?:Copier(?: le texte)?|Bient[ôo]t termin[ée]|L[’']IA est en train de r[ée]fl[ée]chir|Nouvelle session)$/i.test(text)) {
      return false;
    }

    if (/(?:je suis sp[ée]cialis[ée]e?|je ne suis pas en mesure|je serais ravie|désol[ée]e?|i(?:'| a)m sorry|i cannot|i can't)/i.test(text)) {
      return false;
    }

    const sourceLooksAcceptable = !source || /(?:heidi|direct|dom|fallback|weda|existing|manual)/i.test(source);
    if (!sourceLooksAcceptable) {
      return false;
    }

    const hasClinicalOrBiologySignal =
      hasBiologyMarkerText(text) ||
      looksLikeBiologySummaryLine(text) ||
      /(?:Bilan|bio|biologie|RAS|normal|normale|n[ée]gatif|negative|positif|positive|douteux|limite|ind[ée]termin[ée]?|d[ée]tect[ée]?|detecte|anormal|haut|bas|augment[ée]?|abaiss[ée]?|carence|contr[ôo]ler|ECBU|IST|H[ée]mocc?ult|s[ée]ro|s[ée]rologie|Toxo|CMV|rub[ée]ole|IgG|IgM|urines?|selles?|pr[ée]l[èe]vement|culture|germe|bact[ée]rie|h[ée]molyse|coagul[ée]?)/i.test(text);

    return Boolean(hasClinicalOrBiologySignal);
  }

  function isTitleAllowedForWedaInsertion(title, result = {}) {
    if (isWedaGeneratedFallbackTitle(result, title)) {
      return true;
    }

    if (hasForbiddenLipidOutput(title) || hasForbiddenBloodOutput(title)) {
      return false;
    }

    return isExpectedTitleLine(title) ||
      isAcceptableCopiedHeidiAnswer(title) ||
      isSoftBiologyTitleLine(title, result) ||
      isPermissiveHumanBiologyTitleLine(title, result);
  }

  function hasForbiddenHeidiLineTextWithoutWedaStatus(text) {
    return isPromptInstructionLine(text) ||
      /(?:^|\b)(?:ALARME|ANOMALIES|R[ÉE]SUM[ÉE]|FORMAT DE SORTIE|SOURCE UNIQUE|M[ÉE]THODE INTERNE|OBJECTIF|EXEMPLES DE SORTIE|TABLEAU BIOLOGIQUE|BIOLOGIE À ANALYSER|Libell[ée]\s+Valeur|Ne jamais|Toujours citer|Toujours inclure|Répondre uniquement|Construire la ligne|Considérer comme|RÈGLES|REGLES)(?:\b|$)/i.test(text);
  }

  function continueWedaAfterRejectedTitle(result = {}, reason = "titre rejeté") {
    const state = getState();
    const targetIndex = Number.isFinite(Number(result.rowIndex)) ? Number(result.rowIndex) : state.currentIndex;
    const jobId = result.jobId || state.currentJobId || "";

    appendDebugLog("weda:title-rejected-continue-next", {
      jobId,
      reason,
      rowIndex: targetIndex,
      contentKey: result.contentKey || state.currentContentKey || "",
      mode: state.mode,
      nextWillBeSearched: true,
    });

    setState({
      running: true,
      mode: state.mode || "manual",
      phase: "savingTitle",
      currentIndex: targetIndex,
      currentRowKey: result.rowKey || state.currentRowKey || null,
      currentStableKey: result.rowStableKey || state.currentStableKey || null,
      currentContentKey: result.contentKey || state.currentContentKey || null,
      allowUnchangedContentKey: "",
      currentJobId: jobId,
      message: "Titre non écrit dans Weda, passage à la biologie suivante...",
    });

    window.setTimeout(() => goToNextBiology(jobId), 250);
  }

  async function handleLmStudioResult(result) {
    const state = getState();
    appendDebugLog("weda:result-received", {
      jobId: result && result.jobId,
      channelId: result && result.channelId ? result.channelId : "",
      expectedChannelId: CURRENT_CHANNEL_ID,
      ok: Boolean(result && result.ok),
      running: Boolean(state.running),
      statePhase: state.phase,
      expectedJobId: state.currentJobId,
      rawLength: result && result.raw ? String(result.raw).length : 0,
      contentKey: result && result.contentKey,
      rowIndex: result && result.rowIndex,
      rowKey: result && result.rowKey,
      stateCurrentIndex: state.currentIndex,
      stateContentKey: state.currentContentKey,
    });

    if (result.channelId && result.channelId !== CURRENT_CHANNEL_ID) {
      appendDebugLog("weda:result-ignored-channel-mismatch", {
        jobId: result.jobId || "",
        resultChannelId: result.channelId,
        expectedChannelId: CURRENT_CHANNEL_ID,
      });
      return;
    }

    if (!state.running || state.phase !== "waitingLmStudio" || result.jobId !== state.currentJobId) {
      return;
    }

    const resultAssignmentCheck = validateHeidiResultAgainstWaitingState(result, state);
    if (!resultAssignmentCheck.ok) {
      GM_deleteValue(RESULT_KEY);
      appendDebugLog("weda:result-assignment-rejected", {
        jobId: result.jobId || "",
        reason: resultAssignmentCheck.reason,
        resultRowIndex: result.rowIndex,
        stateCurrentIndex: state.currentIndex,
        resultContentKey: result.contentKey || "",
        stateContentKey: state.currentContentKey || "",
        resultRowKeyHash: result.rowKey ? hashString(result.rowKey) : "",
        stateRowKeyHash: state.currentRowKey ? hashString(state.currentRowKey) : "",
        resultStableKeyHash: result.rowStableKey ? hashString(result.rowStableKey) : "",
        stateStableKeyHash: state.currentStableKey ? hashString(state.currentStableKey) : "",
      });
      failWeda(`Sécurité d'affectation : résultat LM Studio refusé (${resultAssignmentCheck.reason}).`);
      return;
    }

    GM_deleteValue(RESULT_KEY);

    if (!result.ok) {
      appendDebugLog("weda:result-error", {
        jobId: result.jobId,
        error: result.error || "erreur inconnue",
      });
      failWeda(`LM Studio n'a pas renvoyé de titre : ${result.error || "erreur inconnue"}`);
      return;
    }

    let title = normalizeLmStudioTitleOutput(result.title || result.raw || "");
    appendDebugLog("weda:title-sanitized", {
      jobId: result.jobId,
      titleLength: title.length,
      rasLike: isRasLikeHeidiTitle(title),
    });

    if (!title) {
      appendDebugLog("weda:title-empty-continue-next", {
        jobId: result.jobId,
        contentKey: result.contentKey || "",
      });
      continueWedaAfterRejectedTitle(result, "titre vide");
      return;
    }

    if (!isTitleAllowedForWedaInsertion(title, result)) {
      const displayedFallbackTitle = buildHeidiFailureFallbackTitle(getDisplayedStructuredOrRawTableTextForFallback());
      appendDebugLog("weda:title-rejected", {
        jobId: result.jobId,
        titleLength: title.length,
        promptInstructionLike: isPromptInstructionLine(title),
        forbiddenLipidOutput: hasForbiddenLipidOutput(title),
        forbiddenBloodOutput: hasForbiddenBloodOutput(title),
        fallbackAvailable: Boolean(displayedFallbackTitle),
        titleSource: result.titleSource || "",
      });

      if (displayedFallbackTitle) {
        appendDebugLog("weda:title-rejected-using-fallback", {
          jobId: result.jobId,
          fallbackLength: displayedFallbackTitle.length,
        });
        result.title = displayedFallbackTitle;
        result.raw = displayedFallbackTitle;
        result.titleSource = "displayed-weda-fallback";
        title = displayedFallbackTitle;
      } else {
        continueWedaAfterRejectedTitle(result, "titre incomplet ou non conforme");
        return;
      }
    }

    if (result.contentKey) {
      rememberTitle(result.contentKey, title, {
        rowKey: result.rowKey || "",
        rowStableKey: result.rowStableKey || "",
        rowIdentity: result.rowIdentity || "",
        rowIndex: result.rowIndex,
        contentKey: result.contentKey,
        titleSource: result.titleSource || result.source || "",
      });
      appendDebugLog("weda:title-remembered-before-fill", {
        jobId: result.jobId,
        contentKey: result.contentKey,
        titleLength: title.length,
      });
    }

    try {
      await fillAndSaveWedaTitle(title, result);
    } catch (error) {
      appendDebugLog("weda:title-fill-error", {
        jobId: result.jobId,
        error: error.message,
        contentKey: result.contentKey || "",
        rowIndex: result.rowIndex,
      });

      if (/titre incomplet ou non conforme/i.test(error.message || "")) {
        continueWedaAfterRejectedTitle(result, error.message);
        return;
      }

      failWeda(`Impossible d'insérer le titre Weda : ${error.message}`);
    }
  }

  function validateHeidiResultAgainstWaitingState(result = {}, state = getState()) {
    if (!result || typeof result !== "object") {
      return { ok: false, reason: "résultat LM Studio absent" };
    }

    if (result.jobId !== state.currentJobId) {
      return { ok: false, reason: "job LM Studio différent" };
    }

    const resultIndex = Number(result.rowIndex);
    const stateIndex = Number(state.currentIndex);
    if (Number.isFinite(resultIndex) && Number.isFinite(stateIndex) && resultIndex !== stateIndex) {
      return { ok: false, reason: "ligne Weda différente" };
    }

    if (result.rowStableKey && state.currentStableKey && result.rowStableKey !== state.currentStableKey) {
      return { ok: false, reason: "identité de ligne différente" };
    }

    if (result.rowKey && state.currentRowKey && result.rowKey !== state.currentRowKey) {
      return { ok: false, reason: "clé de ligne différente" };
    }

    if (result.contentKey && state.currentContentKey && result.contentKey !== state.currentContentKey) {
      return { ok: false, reason: "empreinte de bilan différente" };
    }

    return { ok: true, reason: "" };
  }

  async function ensureCurrentBiologyDisplayed(target = {}) {
    const state = getState();
    const rows = getBiologyRows();
    const targetIndex = Number.isFinite(Number(target.rowIndex)) ? Number(target.rowIndex) : state.currentIndex;
    const targetStableKey = target.rowStableKey || state.currentStableKey;
    const targetContentKey = target.contentKey || state.currentContentKey || "";
    const currentContentKey = getDisplayedBiologyContentKey();
    const matchingRows = findBiologyRowsByStableKey(targetStableKey, rows);
    const indexedTargetRow = findBiologyRowByIndexAndStableKey(targetIndex, targetStableKey, rows);
    const fallbackRow = rows[state.currentIndex];
    const row = indexedTargetRow || matchingRows[0] || fallbackRow;

    appendDebugLog("weda:ensure-target-start", {
      targetIndex,
      hasTargetStableKey: Boolean(targetStableKey),
      targetContentKey,
      currentContentKey,
      rows: rows.length,
      matchingRows: matchingRows.length,
      hasIndexedTargetRow: Boolean(indexedTargetRow),
      fallbackRowIndex: fallbackRow ? fallbackRow.index : null,
      selectedIndex: getSelectedBiologyIndex(),
      hasRow: Boolean(row),
    });

    if (!row) {
      if (targetContentKey && currentContentKey === targetContentKey) {
        appendDebugLog("weda:ensure-target-content-only-ok", {
          reason: "row-missing",
          targetIndex,
          targetContentKey,
        });
        return buildFallbackDisplayedBiologyRow(target, state);
      }

      throw new Error("la ligne Weda cible est introuvable");
    }

    if (targetContentKey && currentContentKey === targetContentKey) {
      appendDebugLog("weda:ensure-target-content-ok", {
        targetIndex: row.index,
        targetContentKey,
        identityOk: isDisplayedBiologyForRow(row),
      });
      return row;
    }

    if (!targetContentKey && isDisplayedBiologyForRow(row)) {
      return row;
    }

    const previousContentKey = getDisplayedBiologyContentKey();
    const candidates = [indexedTargetRow, ...matchingRows, row]
      .filter(Boolean)
      .filter((candidate, index, list) => list.indexOf(candidate) === index);

    for (const candidate of candidates) {
      setPanelStatus(`Retour sur ${candidate.identityLabel || "la biologie cible"} pour enregistrer le titre...`);

      setState({
        running: true,
        phase: "waitingLmStudio",
        currentIndex: candidate.index,
        currentRowKey: candidate.key,
        currentStableKey: candidate.stableKey,
        previousContentKey,
        allowUnchangedContentKey: "",
      });

      triggerWedaBiologyRowOpen(candidate, "return-to-target");

      try {
        const displayedBiology = await waitForDisplayedBiology(candidate, previousContentKey || "", {
          expectedContentKey: targetContentKey,
        });

        setState({
          running: true,
          phase: "waitingLmStudio",
          currentIndex: candidate.index,
          currentRowKey: candidate.key,
          currentStableKey: candidate.stableKey,
          currentContentKey: displayedBiology.contentKey,
          allowUnchangedContentKey: "",
        });

        appendDebugLog("weda:ensure-target-reopen-ok", {
          targetIndex: candidate.index,
          contentKey: displayedBiology.contentKey,
          expectedContentKey: targetContentKey,
        });

        return candidate;
      } catch (error) {
        const afterRetryContentKey = getDisplayedBiologyContentKey();

        appendDebugLog("weda:ensure-target-reopen-failed", {
          targetIndex: candidate.index,
          error: error.message,
          expectedContentKey: targetContentKey,
          displayedContentKey: afterRetryContentKey,
        });

        if (targetContentKey && afterRetryContentKey === targetContentKey) {
          appendDebugLog("weda:ensure-target-content-only-ok", {
            reason: "after-retry",
            targetIndex: candidate.index,
            targetContentKey,
          });
          return candidate;
        }

        if (!targetContentKey) {
          throw error;
        }
      }
    }

    throw new Error("la biologie affichée ne correspond pas au tableau envoyé à LM Studio");
  }

  function buildFallbackDisplayedBiologyRow(target = {}, state = getState()) {
    const index = Number.isFinite(Number(target.rowIndex)) ? Number(target.rowIndex) : Number(state.currentIndex || 0);
    const stableKey = target.rowStableKey || state.currentStableKey || "";
    const key = target.rowKey || state.currentRowKey || stableKey || target.contentKey || `displayed-${index}`;

    return {
      index,
      key,
      stableKey,
      identityLabel: target.rowIdentity || "",
      cells: [],
      link: null,
      row: null,
    };
  }

  function buildTitleAssignmentGuard(target, targetRow, displayedContentKey, result = {}) {
    return {
      jobId: result.jobId || "",
      contentKey: target.contentKey || displayedContentKey || "",
      rowIndex: Number.isFinite(Number(targetRow && targetRow.index)) ? Number(targetRow.index) : Number(target.rowIndex),
      rowKey: targetRow && targetRow.key ? targetRow.key : target.rowKey || "",
      rowStableKey: targetRow && targetRow.stableKey ? targetRow.stableKey : target.rowStableKey || "",
      rowIdentity: targetRow && targetRow.identityLabel ? targetRow.identityLabel : target.rowIdentity || "",
    };
  }

  function assertTitleAssignmentTarget(guard = {}, stage = "") {
    const check = validateTitleAssignmentTarget(guard);
    if (check.ok) {
      return true;
    }

    appendDebugLog("weda:title-assignment-guard-failed", {
      stage,
      reason: check.reason,
      jobId: guard.jobId || "",
      expectedContentKey: guard.contentKey || "",
      displayedContentKey: check.displayedContentKey || "",
      expectedRowIndex: guard.rowIndex,
      selectedRowIndex: check.selectedRowIndex,
      expectedRowKeyHash: guard.rowKey ? hashString(guard.rowKey) : "",
      selectedRowKeyHash: check.selectedRowKey ? hashString(check.selectedRowKey) : "",
      expectedStableKeyHash: guard.rowStableKey ? hashString(guard.rowStableKey) : "",
      selectedStableKeyHash: check.selectedStableKey ? hashString(check.selectedStableKey) : "",
      displayedMatchesTargetRow: check.displayedMatchesTargetRow,
    });
    throw new Error(`sécurité d'affectation : ${check.reason}`);
  }

  function validateTitleAssignmentTarget(guard = {}) {
    const displayedContentKey = getDisplayedBiologyContentKey();
    const rows = getBiologyRows();
    const targetRow = findBiologyRowByIndexAndStableKey(guard.rowIndex, guard.rowStableKey, rows) ||
      findBiologyRowByStableKey(guard.rowStableKey, rows);
    const selectedRow = getExplicitSelectedBiologyItem(rows);
    const displayedMatchesTargetRow = targetRow ? isDisplayedBiologyForRow(targetRow) : Boolean(guard.contentKey && displayedContentKey === guard.contentKey);

    if (guard.contentKey && displayedContentKey !== guard.contentKey) {
      return {
        ok: false,
        reason: "l'empreinte du bilan affiché a changé avant la sauvegarde",
        displayedContentKey,
        selectedRowIndex: selectedRow ? selectedRow.index : null,
        selectedRowKey: selectedRow ? selectedRow.key : "",
        selectedStableKey: selectedRow ? selectedRow.stableKey : "",
        displayedMatchesTargetRow,
      };
    }

    if (!displayedMatchesTargetRow) {
      return {
        ok: false,
        reason: "la ligne affichée ne correspond plus à la ligne cible",
        displayedContentKey,
        selectedRowIndex: selectedRow ? selectedRow.index : null,
        selectedRowKey: selectedRow ? selectedRow.key : "",
        selectedStableKey: selectedRow ? selectedRow.stableKey : "",
        displayedMatchesTargetRow,
      };
    }

    if (selectedRow && guard.rowStableKey && selectedRow.stableKey !== guard.rowStableKey) {
      return {
        ok: false,
        reason: "la ligne sélectionnée a changé avant la sauvegarde",
        displayedContentKey,
        selectedRowIndex: selectedRow.index,
        selectedRowKey: selectedRow.key,
        selectedStableKey: selectedRow.stableKey,
        displayedMatchesTargetRow,
      };
    }

    if (selectedRow && Number.isFinite(Number(guard.rowIndex)) && selectedRow.index !== Number(guard.rowIndex)) {
      return {
        ok: false,
        reason: "l'index de ligne sélectionnée a changé avant la sauvegarde",
        displayedContentKey,
        selectedRowIndex: selectedRow.index,
        selectedRowKey: selectedRow.key,
        selectedStableKey: selectedRow.stableKey,
        displayedMatchesTargetRow,
      };
    }

    return {
      ok: true,
      reason: "",
      displayedContentKey,
      selectedRowIndex: selectedRow ? selectedRow.index : null,
      selectedRowKey: selectedRow ? selectedRow.key : "",
      selectedStableKey: selectedRow ? selectedRow.stableKey : "",
      displayedMatchesTargetRow,
    };
  }

  async function fillAndSaveWedaTitle(title, result) {
    const target = {
      rowIndex: result.rowIndex,
      rowKey: result.rowKey || "",
      rowStableKey: result.rowStableKey || "",
      rowIdentity: result.rowIdentity || "",
      contentKey: result.contentKey || "",
    };

    appendDebugLog("weda:title-fill-start", {
      jobId: result.jobId,
      rowIndex: target.rowIndex,
      contentKey: target.contentKey,
      currentContentKey: getDisplayedBiologyContentKey(),
    });

    const targetRow = await ensureCurrentBiologyDisplayed(target);

    const input = document.querySelector("#ContentPlaceHolder1_TextBoxHprimTitre");
    const displayedContentKey = getDisplayedBiologyContentKey();

    if (!input) {
      throw new Error("le champ titre Weda est introuvable");
    }

    if (target.contentKey && displayedContentKey !== target.contentKey) {
      throw new Error("sécurité d'affectation : le tableau affiché ne correspond pas au résultat LM Studio");
    }

    const assignmentGuard = buildTitleAssignmentGuard(target, targetRow, displayedContentKey, result);
    assertTitleAssignmentTarget(assignmentGuard, "before-title-memory");

    rememberTitle(target.contentKey || displayedContentKey, title, {
      rowKey: targetRow.key,
      rowStableKey: targetRow.stableKey,
      rowIdentity: targetRow.identityLabel,
      rowIndex: targetRow.index,
      contentKey: target.contentKey || displayedContentKey,
      titleSource: result.titleSource || result.source || "",
    });
    appendDebugLog("weda:title-fill", {
      jobId: result.jobId,
      contentKey: target.contentKey || displayedContentKey,
      titleLength: title.length,
      targetRowIndex: targetRow.index,
    });

    setState({
      running: true,
      phase: "savingTitle",
      currentIndex: targetRow.index,
      currentRowKey: targetRow.key,
      currentStableKey: targetRow.stableKey,
      currentContentKey: target.contentKey || displayedContentKey,
      allowUnchangedContentKey: "",
      currentJobId: result.jobId,
      message: "Titre reçu, insertion dans Weda...",
      lastTitle: title,
      lastTitleKey: target.contentKey || displayedContentKey,
    });

    if (!isTitleAllowedForWedaInsertion(title, result)) {
      throw new Error("sécurité d'insertion : titre incomplet ou non conforme");
    }

    assertTitleAssignmentTarget(assignmentGuard, "before-title-write");
    input.focus();
    input.value = title;
    assertTitleAssignmentTarget(assignmentGuard, "after-title-write-before-save");
    rememberCurrentDisplayedTitle("after-title-input-fill", {
      jobId: result.jobId || "",
      rowKey: targetRow.key,
      rowStableKey: targetRow.stableKey,
      rowIdentity: targetRow.identityLabel,
      rowIndex: targetRow.index,
      contentKey: target.contentKey || displayedContentKey,
      titleSource: result.titleSource || result.source || "lmstudio-local",
    });
    triggerWedaTitleSave(input, assignmentGuard, "lmstudio-title");

    window.setTimeout(() => goToNextBiology(result.jobId), NEXT_AFTER_SAVE_MS);
  }

  function triggerWedaTitleSave(input, assignmentGuard = null, source = "") {
    if (assignmentGuard) {
      try {
        assertTitleAssignmentTarget(assignmentGuard, "before-save-events");
      } catch (error) {
        failWeda(error.message);
        return;
      }
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    appendDebugLog("weda:title-save-trigger", {
      source,
      jobId: assignmentGuard && assignmentGuard.jobId || "",
      contentKey: assignmentGuard && assignmentGuard.contentKey || getDisplayedBiologyContentKey(),
      rowIndex: assignmentGuard ? assignmentGuard.rowIndex : null,
      titleLength: input ? sanitizeTitle(input.value).length : 0,
      hasDoPostBack: Boolean(pageWindow && typeof pageWindow.__doPostBack === "function"),
    });

    try {
      if (typeof pageWindow.IllegalCaracterFilter === "function") {
        pageWindow.IllegalCaracterFilter("ContentPlaceHolder1_TextBoxHprimTitre");
      }
    } catch (_error) {
      // Si le filtre Weda n'est pas accessible, le postback reste tenté juste après.
    }

    try {
      if (typeof pageWindow.__doPostBack === "function") {
        pageWindow.setTimeout(() => {
          if (assignmentGuard) {
            try {
              assertTitleAssignmentTarget(assignmentGuard, "before-title-postback");
            } catch (error) {
              failWeda(error.message);
              return;
            }
          }

          appendDebugLog("weda:title-save-postback", {
            source,
            jobId: assignmentGuard && assignmentGuard.jobId || "",
            contentKey: assignmentGuard && assignmentGuard.contentKey || getDisplayedBiologyContentKey(),
            rowIndex: assignmentGuard ? assignmentGuard.rowIndex : null,
          });
          pageWindow.__doPostBack("ctl00$ContentPlaceHolder1$TextBoxHprimTitre", "");
        }, 250);
      }
    } catch (_error) {
      // On bascule sur les événements Weda classiques ci-dessous.
    }

    if (assignmentGuard) {
      try {
        assertTitleAssignmentTarget(assignmentGuard, "before-enter-save-events");
      } catch (error) {
        failWeda(error.message);
        return;
      }
    }

    input.dispatchEvent(new KeyboardEvent("keydown", enterKeyOptions()));
    input.dispatchEvent(new KeyboardEvent("keypress", enterKeyOptions()));
    input.dispatchEvent(new KeyboardEvent("keyup", enterKeyOptions()));
  }

  function goToNextBiology(jobId) {
    const state = getState();

    if (!state.running || state.phase !== "savingTitle" || state.currentJobId !== jobId) {
      return;
    }

    const displayedContentKey = getDisplayedBiologyContentKey();
    if (state.currentContentKey && displayedContentKey !== state.currentContentKey) {
      appendDebugLog("weda:next-after-save-aborted", {
        jobId,
        reason: "displayed-content-changed",
        expectedContentKey: state.currentContentKey,
        displayedContentKey,
      });
      failWeda("Sécurité d'affectation : le bilan affiché a changé après la sauvegarde du titre.");
      return;
    }

    const currentRow = findBiologyRowByIndexAndStableKey(state.currentIndex, state.currentStableKey) ||
      findBiologyRowByStableKey(state.currentStableKey);
    if (currentRow && !isDisplayedBiologyForRow(currentRow)) {
      appendDebugLog("weda:next-after-save-aborted", {
        jobId,
        reason: "displayed-row-changed",
        currentIndex: state.currentIndex,
        currentStableKeyHash: state.currentStableKey ? hashString(state.currentStableKey) : "",
        displayedContentKey,
      });
      failWeda("Sécurité d'affectation : la ligne affichée ne correspond plus au titre sauvegardé.");
      return;
    }

    rememberCurrentDisplayedTitle("before-next-biology", {
      jobId,
      rowKey: state.currentRowKey || "",
      rowStableKey: state.currentStableKey || "",
      contentKey: state.currentContentKey || getDisplayedBiologyContentKey(),
      rowIndex: state.currentIndex,
      titleSource: "existing-weda-title",
    });

    markRowSeen(state.currentRowKey || state.currentStableKey);

    if (state.mode === "auto") {
      const nextAutoIndex = findNextAutoRowIndex(state);

      if (nextAutoIndex < 0) {
        finishAutoCycle("Veille auto : nouvelles biologies traitées.");
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
        message: "Veille auto : passage à la nouvelle biologie suivante...",
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
        message: `Terminé : ${rows.length} biologie(s) parcourue(s).`,
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
      allowUnchangedContentKey: "",
      previousContentKey: null,
      currentJobId: null,
      message: "Passage à la biologie suivante...",
    });

    clickBiologyRow(nextIndex);
  }

  async function runLmStudioJob(job) {
    appendDebugLog("lmstudio:run-start", {
      jobId: job.id,
      channelId: CURRENT_CHANNEL_ID,
      contentKey: job.contentKey,
      sourceType: job.sourceType || "table",
      tableRows: countBiologyLinesForLog(job.tableText, job.sourceType || "table"),
      statusSummary: summarizeTableStatuses(job.tableText),
      apiUrl: LMSTUDIO_CHAT_COMPLETIONS_URL,
    });

    try {
      updateLmStudioStatus(job.id, "Connexion à LM Studio local...");
      const model = await getLmStudioModelId();

      updateLmStudioStatus(job.id, "Analyse LM Studio en cours...");
      const response = await requestLmStudioChatCompletion(job, model);
      const answer = extractLmStudioAnswer(response);
      let title = normalizeLmStudioTitleOutput(answer);
      let titleSource = "lmstudio-local";

      appendDebugLog("lmstudio:answer-received", {
        jobId: job.id,
        model,
        answerLength: answer.length,
        titleLength: title.length,
        rasLike: isRasLikeHeidiTitle(title),
        abnormalStatus: tableHasWedaAbnormalStatus(job.tableText),
      });

      if (!title) {
        throw new Error("réponse LM Studio vide ou non reconnue");
      }

      if (!isExpectedTitleLine(title) && !isAcceptableCopiedHeidiAnswer(title)) {
        const forbiddenLipidOutput = hasForbiddenLipidOutput(title);
        const forbiddenBloodOutput = hasForbiddenBloodOutput(title);
        const fallbackTitle = tableHasWedaAbnormalStatus(job.tableText) ? buildWedaStatusFallbackTitle(job.tableText) : "";

        appendDebugLog("lmstudio:answer-rejected", {
          jobId: job.id,
          titleLength: title.length,
          promptInstructionLike: isPromptInstructionLine(title),
          forbiddenLipidOutput,
          forbiddenBloodOutput,
          fallbackAvailable: Boolean(fallbackTitle),
        });

        if (fallbackTitle) {
          updateLmStudioStatus(job.id, "Réponse LM Studio incomplète : titre de secours Weda utilisé.");
          appendDebugLog("lmstudio:fallback-title-used", {
            jobId: job.id,
            reason: "invalid-or-incomplete-answer",
            fallbackLength: fallbackTitle.length,
            statusSummary: summarizeTableStatuses(job.tableText),
          });
          title = fallbackTitle;
          titleSource = "weda-status-fallback";
        } else {
          throw new Error(forbiddenLipidOutput
            ? "réponse LM Studio rejetée car elle contient un libellé ou une unité de cholestérol interdits"
            : forbiddenBloodOutput
              ? "réponse LM Studio rejetée car elle contient un marqueur interdit"
              : "réponse LM Studio rejetée car elle est vide, incomplète ou ressemble à une consigne du prompt");
        }
      }

      if (isRasLikeHeidiTitle(title) && tableHasWedaAbnormalStatus(job.tableText)) {
        const fallbackTitle = buildWedaStatusFallbackTitle(job.tableText);

        if (fallbackTitle) {
          updateLmStudioStatus(job.id, "LM Studio a répondu RAS malgré un statut Weda anormal : titre de secours utilisé.");
          appendDebugLog("lmstudio:fallback-title-used", {
            jobId: job.id,
            reason: "ras-with-abnormal-weda-status",
            fallbackLength: fallbackTitle.length,
            statusSummary: summarizeTableStatuses(job.tableText),
          });
          title = fallbackTitle;
          titleSource = "weda-status-fallback";
        } else {
          throw new Error("LM Studio a répondu Bilan RAS alors que Weda signale au moins une valeur hors norme");
        }
      }

      updateLmStudioStatus(job.id, "Réponse LM Studio reçue, insertion dans Weda...");
      GM_deleteValue(JOB_KEY);

      return {
        jobId: job.id,
        channelId: CURRENT_CHANNEL_ID,
        ok: true,
        raw: answer,
        title,
        titleSource,
        model,
        rowIndex: job.rowIndex,
        rowKey: job.rowKey || "",
        rowStableKey: job.rowStableKey || "",
        rowIdentity: job.rowIdentity || "",
        contentKey: job.contentKey || "",
        createdAt: Date.now(),
      };
    } catch (error) {
      appendDebugLog("lmstudio:run-error", {
        jobId: job.id,
        error: error.message,
      });

      GM_deleteValue(JOB_KEY);

      return {
        jobId: job.id,
        channelId: CURRENT_CHANNEL_ID,
        ok: false,
        error: error.message || "erreur LM Studio inconnue",
        rowIndex: job.rowIndex,
        rowKey: job.rowKey || "",
        rowStableKey: job.rowStableKey || "",
        rowIdentity: job.rowIdentity || "",
        contentKey: job.contentKey || "",
        createdAt: Date.now(),
      };
    }
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
    const payload = {
      model,
      temperature: LMSTUDIO_TEMPERATURE,
      max_tokens: LMSTUDIO_MAX_TOKENS,
      stream: false,
      messages: [
        {
          role: "system",
          content: "Tu suis strictement les consignes médicales fournies par l'utilisateur. Réponds uniquement avec la ligne finale demandée.",
        },
        {
          role: "user",
          content: buildLmStudioUserPrompt(job),
        },
      ],
    };

    appendDebugLog("lmstudio:request", {
      jobId: job.id,
      model,
      promptLength: payload.messages[1].content.length,
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
    return `${prompt}\n\n${buildHeidiContextText(job.tableText)}`;
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

  function preopenHeidiWorkerWindow(reason = "") {
    if (!isWedaPage || !CURRENT_CHANNEL_ID || preopenedHeidiWorkerWindow && !preopenedHeidiWorkerWindow.closed) {
      return;
    }

    try {
      const workerWindowName = getHeidiWorkerWindowName(CURRENT_CHANNEL_ID);
      if (!workerWindowName) {
        return;
      }

      const openedWindow = getPageWindow().open("about:blank", workerWindowName);
      if (openedWindow) {
        preopenedHeidiWorkerWindow = openedWindow;
        appendDebugLog("weda:heidi-worker-preopened", {
          reason,
          channelId: CURRENT_CHANNEL_ID,
          workerWindowName,
          openerPreservedExpected: true,
        });
        try {
          window.focus();
        } catch (_error) {
          // On évite de laisser l'onglet blanc au premier plan.
        }
      }
    } catch (error) {
      appendDebugLog("weda:heidi-worker-preopen-error", {
        reason,
        channelId: CURRENT_CHANNEL_ID,
        error: error.message,
      });
    }
  }

  function openHeidiJobTab(jobId, options = {}) {
    const forceForeground = Boolean(options.forceForeground);
    const background = HEIDI_WORKERS_OPEN_IN_BACKGROUND && !forceForeground;
    const channelId = CURRENT_CHANNEL_ID || getWedaTabChannelId();
    const url = `${HEIDI_URL}?wedaBioJob=${encodeURIComponent(jobId)}&${HEIDI_CHANNEL_PARAM}=${encodeURIComponent(channelId)}`;
    const workerWindowName = getHeidiWorkerWindowName(channelId) || `_weda_bio_heidi_${jobId}`;
    let openMethod = "GM_openInTab";
    let openedByWindowOpen = false;

    if (!background && preopenedHeidiWorkerWindow && !preopenedHeidiWorkerWindow.closed) {
      try {
        currentHeidiTab = preopenedHeidiWorkerWindow;
        preopenedHeidiWorkerWindow = null;
        currentHeidiTab.location.href = url;
        openedByWindowOpen = true;
        openMethod = "preopened-window";
        try {
          currentHeidiTab.focus();
        } catch (_error) {
          // Le focus peut être refusé, mais l'opener est conservé.
        }
      } catch (error) {
        appendDebugLog("weda:heidi-preopened-navigation-error", {
          jobId,
          channelId,
          workerWindowName,
          error: error.message,
        });
        currentHeidiTab = null;
        preopenedHeidiWorkerWindow = null;
      }
    }

    if (!background && !currentHeidiTab) {
      try {
        const pageWindow = getPageWindow();
        const openedWindow = pageWindow.open(url, workerWindowName);

        if (openedWindow) {
          currentHeidiTab = openedWindow;
          openedByWindowOpen = true;
          openMethod = "window.open";
          try {
            openedWindow.focus();
          } catch (_error) {
            // Le focus direct peut être refusé, mais l'opener reste conservé.
          }
        }
      } catch (error) {
        appendDebugLog("weda:heidi-window-open-error", {
          jobId,
          channelId,
          workerWindowName,
          error: error.message,
        });
      }
    }

    if (!currentHeidiTab || currentHeidiTab.closed) {
      currentHeidiTab = GM_openInTab(url, {
        active: !background,
        insert: !background,
        setParent: true,
      });
    }

    appendDebugLog("weda:heidi-tab-opened", {
      jobId,
      channelId,
      reason: options.reason || "",
      background,
      active: !background,
      insert: !background,
      method: openMethod,
      openedByWindowOpen,
      workerWindowName,
      openerPreservedExpected: openedByWindowOpen,
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
        failWeda("Heidi ne démarre pas pour cette biologie. Ouvrez Heidi au premier plan puis relancez l'analyse.");
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

  function closeCurrentHeidiTab(options = {}) {
    const reason = options.reason || "";
    const delayMs = Number(options.delayMs || 0);
    const focusBeforeClose = options.focusBeforeClose !== false;

    if (focusBeforeClose) {
      focusOwnWedaTab(reason ? `before-close-${reason}` : "before-close-heidi");
    }

    if (delayMs > 0) {
      appendDebugLog("weda:heidi-tab-close-delayed", {
        reason,
        delayMs,
        hasTab: Boolean(currentHeidiTab),
      });
      window.setTimeout(() => closeCurrentHeidiTab({
        ...options,
        delayMs: 0,
        focusBeforeClose: false,
      }), delayMs);
      return;
    }

    if (!currentHeidiTab || typeof currentHeidiTab.close !== "function") {
      appendDebugLog("weda:heidi-tab-close-skip", {
        reason,
        hasTab: Boolean(currentHeidiTab),
      });
      currentHeidiTab = null;
      return;
    }

    try {
      appendDebugLog("weda:heidi-tab-close", {
        reason,
      });
      currentHeidiTab.close();
      if (focusBeforeClose) {
        focusOwnWedaTab(reason ? `after-close-${reason}` : "after-close-heidi");
      }
    } catch (error) {
      appendDebugLog("weda:heidi-tab-close-error", {
        reason,
        error: error.message,
      });
      // L'onglet Heidi tente aussi de se fermer lui-même après avoir transmis le résultat.
    } finally {
      currentHeidiTab = null;
    }
  }

  async function initHeidi() {
    const params = new URLSearchParams(location.search || "");
    const jobId = params.get("wedaBioJob");
    const channelId = CURRENT_CHANNEL_ID;

    if (!jobId) {
      return;
    }

    if (!channelId) {
      appendDebugLog("heidi:init-ignored-no-channel", {
        jobId,
        search: sanitizeDebugString(location.search || "", 180),
      });
      return;
    }

    appendDebugLog("heidi:init", {
      jobId,
      channelId,
      version: getScriptVersion(),
      contextTabs: document.querySelectorAll('[data-testid="session-tab-context"], button[id="context/"], [role="tab"][id="context/"]').length,
      askInputs: document.querySelectorAll(".ask-ai-input [contenteditable='true'], .ask-ai-input textarea").length,
    });
    setupHeidiDebugLifecycleLogs(jobId);

    try {
      const job = await waitForJob(jobId);
      appendDebugLog("heidi:job-loaded", {
        jobId,
        contentKey: job.contentKey,
        sourceType: job.sourceType || "table",
        tableRows: countBiologyLinesForLog(job.tableText, job.sourceType || "table"),
        statusSummary: summarizeTableStatuses(job.tableText),
        hasTableHtml: Boolean(job.tableHtml),
      });
      updateHeidiStatus(jobId, "Heidi chargé, prise en charge du travail...");
      await claimJob(jobId);
      await runHeidiJob(job);
    } catch (error) {
      appendDebugLog("heidi:error", {
        jobId,
        error: error.message,
      });
      GM_setValue(RESULT_KEY, {
        jobId,
        channelId: CURRENT_CHANNEL_ID,
        ok: false,
        error: error.message,
        createdAt: Date.now(),
      });
      updateHeidiStatus(jobId, `Erreur Heidi : ${error.message}`);
    }
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

  function isHeidiForeground() {
    return !document.hidden;
  }

  async function waitForHeidiForegroundForAnalysis(jobId = "") {
    if (isHeidiForeground()) {
      appendDebugLog("heidi:foreground-before-send-ok", {
        jobId,
      });
      return true;
    }

    appendDebugLog("heidi:background-before-send", {
      jobId,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    });

    updateHeidiStatus(jobId, "Heidi est en arrière-plan : lancement tenté sans attendre le premier plan...");
    focusCurrentHeidiWindow();

    try {
      await waitFor(() => {
        if (isHeidiForeground()) {
          appendDebugLog("heidi:foreground-before-send-ok", {
            jobId,
            reason: "focus-restored-during-grace",
          });
          return true;
        }

        return false;
      }, {
        timeout: HEIDI_BACKGROUND_SEND_GRACE_MS,
        interval: 250,
        description: "le retour éventuel de Heidi au premier plan",
      });
      return true;
    } catch (error) {
      appendDebugLog("heidi:background-send-allowed", {
        jobId,
        error: error.message,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      });
      return false;
    }
  }

  async function waitForJob(jobId) {
    return waitFor(() => {
      const job = GM_getValue(JOB_KEY, null);
      if (!job || job.id !== jobId) {
        return null;
      }

      if (job.channelId && job.channelId !== CURRENT_CHANNEL_ID) {
        appendDebugLog("heidi:job-channel-mismatch", {
          jobId,
          expectedChannelId: CURRENT_CHANNEL_ID,
          jobChannelId: job.channelId,
        });
        return null;
      }

      return job;
    }, {
      timeout: 30000,
      interval: 250,
      description: "le travail envoyé par Weda",
    });
  }

  async function claimJob(jobId) {
    const workerId = createId("heidi");
    const job = GM_getValue(JOB_KEY, null);
    appendDebugLog("heidi:claim-start", {
      jobId,
      workerId,
      channelId: CURRENT_CHANNEL_ID,
      jobChannelId: job && job.channelId ? job.channelId : "",
      hasJob: Boolean(job),
      claimedBy: job && job.claimedBy ? "yes" : "no",
      claimedAgeMs: job && job.claimedAt ? Date.now() - job.claimedAt : null,
    });

    if (!job || job.id !== jobId) {
      throw new Error("travail Heidi introuvable");
    }

    if (job.channelId && job.channelId !== CURRENT_CHANNEL_ID) {
      throw new Error("travail Heidi destiné à un autre onglet Weda");
    }

    if (job.claimedBy && Date.now() - (job.claimedAt || 0) < 120000) {
      throw new Error("ce travail est déjà pris en charge par un autre onglet Heidi");
    }

    GM_setValue(JOB_KEY, {
      ...job,
      channelId: job.channelId || CURRENT_CHANNEL_ID,
      claimedBy: workerId,
      claimedAt: Date.now(),
    });

    await sleep(250);

    const verified = GM_getValue(JOB_KEY, null);
    if (!verified || verified.claimedBy !== workerId || (verified.channelId && verified.channelId !== CURRENT_CHANNEL_ID)) {
      throw new Error("impossible de réserver l'onglet Heidi");
    }

    appendDebugLog("heidi:claim-ok", {
      jobId,
      workerId,
      channelId: CURRENT_CHANNEL_ID,
    });
  }

  async function runHeidiJob(job) {
    appendDebugLog("heidi:run-start", {
      jobId: job.id,
      channelId: CURRENT_CHANNEL_ID,
      contentKey: job.contentKey,
      sourceType: job.sourceType || "table",
      tableRows: countBiologyLinesForLog(job.tableText, job.sourceType || "table"),
      statusSummary: summarizeTableStatuses(job.tableText),
    });
    updateHeidiStatus(job.id, "Préparation de la session Heidi...");

    const sessionDecision = await decideHeidiSessionPreparation(job.id);

    // V1.0.51 : toujours créer une nouvelle session Heidi pour chaque biologie.
    // Les versions précédentes pouvaient réutiliser à tort une session ancienne qui paraissait vide
    // au moment du snapshot, puis coller la biologie dans cette ancienne session.
    updateHeidiStatus(job.id, "Ouverture obligatoire d'une nouvelle session Heidi...");
    const newSessionButton = await findHeidiNewSessionButtonWithRetry(job.id);

    if (newSessionButton) {
      appendDebugLog("heidi:new-session-required-button-found", {
        jobId: job.id,
        button: newSessionButton,
        clickStrategy: "single-click-only",
        previousSessionSnapshot: sessionDecision.snapshot,
        decisionReason: sessionDecision.reason,
      });
      const beforeSessionFingerprint = getHeidiCurrentSessionFingerprint();
      clickButtonOnceLikeUser(newSessionButton);
      appendDebugLog("heidi:new-session-clicked-once", {
        jobId: job.id,
        beforeSessionFingerprint,
      });
      await waitForHeidiSessionAfterNewSessionClick(job.id, beforeSessionFingerprint);
    } else {
      updateHeidiStatus(job.id, "Bouton Nouvelle session introuvable, utilisation de la session Heidi affichée...");
      appendDebugLog("heidi:new-session-required-fallback-current-session", {
        jobId: job.id,
        decision: sessionDecision,
        debug: getHeidiNewSessionDebugSnapshot(),
      });
    }

    updateHeidiStatus(job.id, "Préparation du contexte Heidi...");
    await sleep(1200);

    const contextEditor = await openHeidiContextAndGetEditor(job.id);
    const contextText = buildHeidiContextText(job.tableText);
    const contextHtml = buildHeidiContextHtml(job.tableHtml || "");
    const contextMarkers = buildHeidiContextVerificationMarkers(job.tableText);
    appendDebugLog("heidi:context-insert-start", {
      jobId: job.id,
      editor: contextEditor,
      sourceType: job.sourceType || "table",
      markersCount: contextMarkers.length,
      markerLengths: contextMarkers.map((marker) => marker.length),
      textLength: contextText.length,
      htmlLength: contextHtml.length,
    });
    await insertTextIntoHeidiEditor(contextEditor, contextText, contextHtml, contextMarkers);
    appendDebugLog("heidi:context-insert-ok", {
      jobId: job.id,
      markersCount: contextMarkers.length,
      storedLength: getHeidiEditorStoredText(contextEditor).length,
    });
    await waitForHeidiContextSettled(job.id, contextEditor, contextMarkers);

    updateHeidiStatus(job.id, "Préparation de la demande Heidi...");
    const askEditor = await waitForHeidiAskEditor();
    const promptText = buildHeidiPromptText(job.prompt, job.tableText);
    const promptMarkers = buildHeidiPromptVerificationMarkers(promptText);
    appendDebugLog("heidi:ask-insert-start", {
      jobId: job.id,
      editor: askEditor,
      promptLength: promptText.length,
      markersCount: promptMarkers.length,
      markerLengths: promptMarkers.map((marker) => marker.length),
    });
    await insertTextIntoHeidiEditor(askEditor, promptText, "", promptMarkers);
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

    updateHeidiStatus(job.id, "Lancement de l'analyse Heidi...");
    const heidiForegroundAtSend = await waitForHeidiForegroundForAnalysis(job.id);
    const sendButton = await waitFor(() => findHeidiSendButton(), {
      timeout: 20000,
      interval: 250,
      description: "le bouton d'envoi Heidi",
    });
    appendDebugLog("heidi:send-button-found", {
      jobId: job.id,
      button: sendButton,
    });
    await clickHeidiSendButtonForAnalysis(job.id, sendButton, askEditor, heidiForegroundAtSend);

    if (heidiForegroundFallbackUsed) {
      updateHeidiStatus(job.id, "Analyse Heidi lancée, retour vers Weda...", {
        action: "focusWeda",
      });
      tryReturnFocusToParent();
    }

    updateHeidiStatus(job.id, "Heidi analyse la biologie...");
    const answer = await waitForStableHeidiAnswer(job.id, job.tableText);
    let title = sanitizeTitle(answer);
    let titleSource = "heidi-direct";
    appendDebugLog("heidi:answer-received", {
      jobId: job.id,
      answerLength: answer.length,
      titleLength: title.length,
      rasLike: isRasLikeHeidiTitle(title),
      abnormalStatus: tableHasWedaAbnormalStatus(job.tableText),
    });

    if (!title) {
      throw new Error("réponse Heidi vide ou non reconnue");
    }

    if (!isExpectedTitleLine(title) && !isAcceptableCopiedHeidiAnswer(title)) {
      const forbiddenLipidOutput = hasForbiddenLipidOutput(title);
      const forbiddenBloodOutput = hasForbiddenBloodOutput(title);
      const fallbackTitle = tableHasWedaAbnormalStatus(job.tableText) ? buildWedaStatusFallbackTitle(job.tableText) : "";

      appendDebugLog("heidi:answer-rejected", {
        jobId: job.id,
        titleLength: title.length,
        promptInstructionLike: isPromptInstructionLine(title),
        forbiddenLipidOutput,
        forbiddenBloodOutput,
        fallbackAvailable: Boolean(fallbackTitle),
      });

      if (fallbackTitle) {
        updateHeidiStatus(job.id, "Réponse Heidi incomplète : titre de secours Weda utilisé.");
        appendDebugLog("heidi:fallback-title-used", {
          jobId: job.id,
          reason: "invalid-or-incomplete-answer",
          fallbackLength: fallbackTitle.length,
          statusSummary: summarizeTableStatuses(job.tableText),
        });
        title = fallbackTitle;
        titleSource = "weda-status-fallback";
      } else {
        throw new Error(forbiddenLipidOutput
          ? "réponse Heidi rejetée car elle contient un libellé ou une unité de cholestérol interdits"
          : forbiddenBloodOutput
            ? "réponse Heidi rejetée car elle contient un marqueur interdit"
          : "réponse Heidi rejetée car elle est vide, incomplète ou ressemble à une consigne du prompt");
      }
    }

    if (isRasLikeHeidiTitle(title) && tableHasWedaAbnormalStatus(job.tableText)) {
      const fallbackTitle = buildWedaStatusFallbackTitle(job.tableText);

      if (fallbackTitle) {
        updateHeidiStatus(job.id, "Heidi a répondu RAS malgré un statut Weda anormal : titre de secours utilisé.");
        appendDebugLog("heidi:fallback-title-used", {
          jobId: job.id,
          reason: "ras-with-abnormal-weda-status",
          fallbackLength: fallbackTitle.length,
          statusSummary: summarizeTableStatuses(job.tableText),
        });
        title = fallbackTitle;
        titleSource = "weda-status-fallback";
      } else {
        throw new Error("Heidi a répondu Bilan RAS alors que Weda signale au moins une valeur hors norme");
      }
    }

    updateHeidiStatus(job.id, "Réponse Heidi reçue, retour vers Weda...", {
      action: "focusWeda",
      focusReason: "heidi-result-ready",
    });
    tryReturnFocusToParent("heidi-result-ready");
    GM_setValue(RESULT_KEY, {
      jobId: job.id,
      channelId: CURRENT_CHANNEL_ID,
      ok: true,
      raw: answer,
      title,
      titleSource,
      rowIndex: job.rowIndex,
      rowKey: job.rowKey || "",
      rowStableKey: job.rowStableKey || "",
      rowIdentity: job.rowIdentity || "",
      contentKey: job.contentKey || "",
      createdAt: Date.now(),
    });

    GM_deleteValue(JOB_KEY);

    window.setTimeout(() => {
      tryReturnFocusToParent("heidi-before-window-close");
      window.setTimeout(() => {
        try {
          window.close();
        } catch (error) {
          appendDebugLog("heidi:window-close-error", {
            jobId: job.id,
            error: error.message,
          });
        }
      }, 250);
    }, HEIDI_CLOSE_AFTER_RESULT_MS);
  }

  async function openHeidiContextAndGetEditor(jobId = "") {
    let foregroundFallbackRequested = false;
    appendDebugLog("heidi:context-open-start", {
      jobId,
      maxAttempts: HEIDI_CONTEXT_MAX_ATTEMPTS,
      foregroundFallbackAfter: HEIDI_CONTEXT_FOREGROUND_FALLBACK_AFTER_ATTEMPT,
      backgroundWorkers: HEIDI_WORKERS_OPEN_IN_BACKGROUND,
    });

    for (let attempt = 1; attempt <= HEIDI_CONTEXT_MAX_ATTEMPTS; attempt += 1) {
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
        clickHeidiTab(tab);
        appendDebugLog("heidi:context-tab-clicked", {
          jobId,
          attempt,
          tab: describeDebugElement(tab),
          debug: getHeidiContextDebugSnapshot(),
        });

        try {
          const editor = await waitFor(() => findHeidiContextEditor(), {
            timeout: HEIDI_CONTEXT_ACTIVATE_TIMEOUT_MS,
            interval: 250,
            description: "l'éditeur Contexte Heidi après clic",
          });
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

  function focusOwnWedaTab(reason = "") {
    if (!isWedaPage) {
      return;
    }

    WEDA_FOCUS_RETRY_DELAYS_MS.forEach((delay, attemptIndex) => {
      window.setTimeout(() => {
        let focused = false;

        try {
          window.focus();
          focused = true;
        } catch (_error) {
          // Le navigateur peut refuser le focus programmatique.
        }

        try {
          const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
          if (pageWindow && typeof pageWindow.focus === "function") {
            pageWindow.focus();
            focused = true;
          }
        } catch (_error) {
          // Le focus standard a déjà été tenté.
        }

        try {
          if (document.body && typeof document.body.focus === "function") {
            document.body.focus({ preventScroll: true });
          }
        } catch (_error) {
          // Sans importance : le focus de l'onglet est l'objectif principal.
        }

        appendDebugLog("weda:focus-attempt", {
          reason,
          attempt: attemptIndex + 1,
          focused,
          hidden: document.hidden,
          hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
          windowName: String(window.name || ""),
        });
      }, delay);
    });
  }

  function tryReturnFocusToParent(reason = "") {
    WEDA_FOCUS_RETRY_DELAYS_MS.forEach((delay, attemptIndex) => {
      window.setTimeout(() => {
        let openerFocused = false;
        let namedWindowFocused = false;
        let blurred = false;
        const targetName = getWedaWindowName(CURRENT_CHANNEL_ID);

        try {
          if (window.opener && !window.opener.closed && typeof window.opener.focus === "function") {
            window.opener.focus();
            openerFocused = true;
          }
        } catch (_error) {
          // Si l'opener n'est pas disponible, on tente le nom d'onglet WEDA ci-dessous.
        }

        if (!openerFocused && targetName) {
          try {
            const namedWindow = window.open("", targetName);
            if (namedWindow && !namedWindow.closed && typeof namedWindow.focus === "function") {
              namedWindow.focus();
              namedWindowFocused = true;
            }
          } catch (_error) {
            // Certains navigateurs bloquent window.open hors geste utilisateur.
          }
        }

        try {
          window.blur();
          blurred = true;
        } catch (_error) {
          // Le navigateur garde parfois l'onglet actif.
        }

        appendDebugLog("heidi:focus-weda-attempt", {
          reason,
          attempt: attemptIndex + 1,
          openerFocused,
          namedWindowFocused,
          targetName,
          blurred,
          hidden: document.hidden,
          hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
        });
      }, delay);
    });
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

  async function waitForHeidiAskEditor() {
    const editor = await waitFor(() => {
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

  function stripTrailingBiologySignal(prompt) {
    const pattern = new RegExp(`\\n*${escapeRegExp(BIOLOGY_SIGNAL)}\\s*$`, "i");
    return String(prompt || "").replace(pattern, "").trim();
  }

  function buildHeidiPromptText(prompt, _tableText = "") {
    return stripTrailingBiologySignal(prompt);
  }

  function buildHeidiPromptVerificationMarkers(promptText) {
    const markers = [
      "Tu es médecin généraliste",
      "RÈGLE ANTI-RECOPIE DU PROMPT",
      "SORTIE FINALE",
      "AUTO-CONTRÔLE SILENCIEUX",
    ].filter((marker) => String(promptText || "").includes(marker));

    return markers.length ? markers : ["SORTIE FINALE"];
  }

  function tableHasWedaAbnormalStatus(tableText) {
    if (!isStructuredHprimTableText(tableText)) {
      return false;
    }

    return /(?:^|\t)(?:HAUT|BAS|À RELIRE|À VÉRIFIER)(?:\t|\n|$)/.test(String(tableText || ""));
  }

  function isRasLikeHeidiTitle(title) {
    return /^(?:Bilan RAS|ECBU RAS|IST RAS)(?:$|[,.]\s*)/i.test(sanitizeTitle(title));
  }

  function buildWedaStatusFallbackTitle(tableText) {
    const parts = selectPreferredWedaFallbackRows(extractWedaAbnormalRows(tableText))
      .map(formatWedaAbnormalRowForTitle)
      .filter(Boolean)
      .slice(0, 8);

    if (!parts.length) {
      return "";
    }

    return joinBiologyTitleParts(parts);
  }

  function buildHeidiFailureFallbackTitle(tableText) {
    const abnormalFallback = buildWedaStatusFallbackTitle(tableText);
    if (abnormalFallback) {
      return abnormalFallback;
    }

    if (tableLooksNormalOrUnflaggedForFallback(tableText)) {
      return "Bilan RAS";
    }

    return "";
  }

  function tableLooksNormalOrUnflaggedForFallback(tableText) {
    if (!isStructuredHprimTableText(tableText)) {
      return false;
    }

    const rows = String(tableText || "")
      .split(/\n+/)
      .slice(1)
      .map((line) => line.split("\t").map(normalizeText))
      .filter((cells) => cells.length >= HPRIM_TABLE_COLUMN_COUNT && (cells[0] || cells[1]));

    if (!rows.length) {
      return false;
    }

    const statuses = rows.map((cells) => normalizeText(cells[5] || "").toUpperCase());
    if (statuses.some((status) => /^(?:HAUT|BAS|À RELIRE|A RELIRE|À VÉRIFIER|A VERIFIER)$/.test(status))) {
      return false;
    }

    return true;
  }

  function extractWedaAbnormalRows(tableText) {
    if (!isStructuredHprimTableText(tableText)) {
      return [];
    }

    const rows = String(tableText || "")
      .split(/\n+/)
      .slice(1)
      .map((line) => line.split("\t").map(normalizeText))
      .filter((cells) => cells.length >= HPRIM_TABLE_COLUMN_COUNT && (cells[0] || cells[1]));
    const hasCkdDfg = rows.some((cells) => isCkdDfgLabel(cells[0]));

    return rows
      .filter((cells) => /^(?:HAUT|BAS|À RELIRE|À VÉRIFIER)$/.test(cells[5] || ""))
      .filter((cells) => !hasForbiddenBloodOutput(cells[0]))
      .filter((cells) => !hasCkdDfg || !isDfgLabel(cells[0]) || isCkdDfgLabel(cells[0]));
  }

  function selectPreferredWedaFallbackRows(rows) {
    const byMarker = new Map();

    rows.forEach((cells, order) => {
      const markerKey = getWedaFallbackMarkerKey(cells);
      if (!markerKey) {
        return;
      }

      const rank = getWedaFallbackUnitRank(cells);
      const existing = byMarker.get(markerKey);

      if (!existing || rank < existing.rank) {
        byMarker.set(markerKey, {
          cells,
          rank,
          order: existing ? existing.order : order,
        });
      }
    });

    return Array.from(byMarker.values())
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.cells);
  }

  function getWedaFallbackMarkerKey(cells) {
    const label = normalizeWedaFallbackBiologyLabel(cells && cells[0]);
    return label ? normalizeForCompare(label) : "";
  }

  function getWedaFallbackUnitRank(cells) {
    const unit = normalizeForCompare(cells && cells[2]);

    if (/^g\s*\/\s*l$/.test(unit)) {
      return 0;
    }

    if (!unit) {
      return 1;
    }

    if (/^mmol\s*\/\s*l$/.test(unit)) {
      return 2;
    }

    return 1;
  }

  function formatWedaAbnormalRowForTitle(cells) {
    const label = normalizeWedaFallbackBiologyLabel(cells[0]);
    const value = cells[1] || "";
    const unit = cells[2] || "";
    const status = cells[5] || "";

    if (!label || !value || hasForbiddenBloodOutput(label)) {
      return "";
    }

    const arrow = status === "HAUT" ? " ↑" : status === "BAS" ? " ↓" : "";

    if (isDfgLabel(label)) {
      return normalizeText(`DFG${arrow} ${value}`);
    }

    return normalizeText(`${label}${arrow} ${value}${unit ? ` ${unit}` : ""}`);
  }

  function normalizeWedaFallbackBiologyLabel(label) {
    const compact = compactBiologyLabel(label);
    const normalized = normalizeForCompare(compact);

    if (!compact) {
      return "";
    }

    if (/(?:^|[^\w])non\s*[- ]?\s*hdl(?:\s*[- ]?\s*cholesterol|\s+cholesterol)?(?=$|[^\w])/.test(normalized) ||
      /(?:^|[^\w])cholesterol\s+non\s*[- ]?\s*hdl(?=$|[^\w])/.test(normalized)) {
      return "non-HDL";
    }

    if (/(?:^|[^\w])(?:cholesterol\s+)?h\s*\.?\s*d\s*\.?\s*l(?:\s*[- ]?\s*cholesterol)?(?=$|[^\w])/.test(normalized)) {
      return "HDL";
    }

    if (/(?:^|[^\w])(?:cholesterol\s+)?l\s*\.?\s*d\s*\.?\s*l(?:\s*[- ]?\s*cholesterol)?(?=$|[^\w])/.test(normalized)) {
      return "LDL";
    }

    if (/\btriglycerides?\b/.test(normalized)) {
      return "TG";
    }

    return compact;
  }

  function isDfgLabel(label) {
    const normalized = normalizeForCompare(label);
    return /\b(?:dfg|debit\s+de\s+filtration\s+glomerulaire|filtration\s+glomerulaire)\b/.test(normalized);
  }

  function isCkdDfgLabel(label) {
    const normalized = normalizeForCompare(label);
    return isDfgLabel(label) && /\bckd(?:\s*[- ]?\s*epi)?\b/.test(normalized);
  }

  function compactBiologyLabel(label) {
    return normalizeText(label)
      .replace(/\s*:\s*$/g, "")
      .replace(/\s+/g, " ");
  }

  function joinBiologyTitleParts(parts) {
    if (parts.length <= 1) {
      return parts[0] || "";
    }

    if (parts.length === 2) {
      return `${parts[0]} et ${parts[1]}`;
    }

    return `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
  }

  function buildHeidiContextVerificationMarkers(tableText) {
    const rows = String(tableText || "")
      .split(/\n+/)
      .map((line) => line.split("\t").map(normalizeText))
      .filter((cells) => cells.length >= 2 && (cells[0] || cells[1]));

    if (!isStructuredHprimTableText(tableText)) {
      const rawMarkers = String(tableText || "")
        .split(/\n+/)
        .map(normalizeText)
        .filter((line) => line.length >= 4 && line.length <= 120)
        .slice(0, 4);

      return [BIOLOGY_SIGNAL, ...rawMarkers].filter(Boolean);
    }

    const firstResult = rows.slice(1).find((cells) => cells[0] && cells[1]);
    const markers = [BIOLOGY_SIGNAL, "Libellé", "Valeur"];

    if (firstResult) {
      markers.push(firstResult[0], firstResult[1]);
    }

    return markers.filter(Boolean);
  }

  function buildHeidiContextText(tableText) {
    return `${BIOLOGY_SIGNAL}\n\n${tableText}`;
  }

  function buildHeidiContextHtml(tableHtml) {
    return tableHtml ? addSignalRowToTableHtml(tableHtml) : "";
  }

  function addSignalRowToTableHtml(tableHtml) {
    const signalRow = `<tr><th colspan="${HPRIM_TABLE_COLUMN_COUNT}">${escapeHtml(BIOLOGY_SIGNAL)}</th></tr>`;
    return String(tableHtml || "").replace("<thead>", `<thead>${signalRow}`);
  }

  async function waitForHeidiContextSettled(jobId, editor, markers) {
    const editable = resolveHeidiEditableElement(editor);
    const delay = document.hidden ? HEIDI_CONTEXT_HIDDEN_SETTLE_MS : HEIDI_CONTEXT_VISIBLE_SETTLE_MS;

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

  async function clickHeidiSendButtonForAnalysis(jobId, sendButton, askEditor, foregroundAtSend = false) {
    const hiddenAtClick = document.hidden || !document.hasFocus();

    clickButtonOnceLikeUser(sendButton);
    appendDebugLog("heidi:send-clicked-once", {
      jobId,
      clickStrategy: "single-native-click",
      foregroundAtSend: Boolean(foregroundAtSend),
      hiddenAtClick,
      askStoredLength: askEditor ? getHeidiEditorStoredText(askEditor).length : 0,
    });

    if (!hiddenAtClick) {
      return;
    }

    await sleep(HEIDI_BACKGROUND_SEND_CONFIRM_MS);

    if (hasHeidiGenerationStarted()) {
      appendDebugLog("heidi:background-send-confirmed", {
        jobId,
        hidden: document.hidden,
        hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      });
      return;
    }

    appendDebugLog("heidi:background-send-retry", {
      jobId,
      reason: "aucun signe de génération détecté après clic en arrière-plan",
      hidden: document.hidden,
      hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      askStoredLength: askEditor ? getHeidiEditorStoredText(askEditor).length : 0,
      sendButtonUsable: Boolean(sendButton && isUsableButton(sendButton)),
    });

    if (sendButton && isUsableButton(sendButton)) {
      clickButtonOnceLikeUser(sendButton);
    }
  }

  function hasHeidiGenerationStarted() {
    return Boolean(
      isHeidiStillThinking() ||
      extractHeidiAnswerFromAskContent() ||
      extractHeidiDirectAnswerRawText() ||
      findHeidiCopyTextButton()
    );
  }

  async function decideHeidiSessionPreparation(jobId = "") {
    await waitForHeidiUiReadyBeforeSessionDecision(jobId);
    await sleep(900);

    const firstSnapshot = getHeidiCurrentSessionContentSnapshot();

    // On patiente brièvement : certaines anciennes sessions Heidi chargent leur contenu avec retard.
    // Si un ancien contenu apparaît, on créera une vraie nouvelle session.
    await sleep(900);
    const secondSnapshot = getHeidiCurrentSessionContentSnapshot();
    const snapshot = mergeHeidiSessionDecisionSnapshots(firstSnapshot, secondSnapshot);

    const hasOldOutput = snapshot.askContentTextLength > 0 || snapshot.directAnswerTextLength > 0 || snapshot.copyButtonPresent;
    const hasOldInput = snapshot.askInputTextLength > 0;
    const hasUsableEmptyAskInput = snapshot.askInputPresent && !hasOldInput;

    if (hasUsableEmptyAskInput && !hasOldOutput) {
      return {
        reuseCurrentSession: true,
        reason: "session courante vide ou fraîche ; évite une double création de session Heidi",
        snapshot,
      };
    }

    return {
      reuseCurrentSession: false,
      reason: hasOldOutput || hasOldInput
        ? "session courante non vide ; création d'une nouvelle session nécessaire"
        : "session courante non clairement réutilisable",
      snapshot,
    };
  }

  async function waitForHeidiUiReadyBeforeSessionDecision(jobId = "") {
    try {
      await waitFor(() => (
        document.querySelector(".ask-ai-input") ||
        document.querySelector("#ask-ai-content") ||
        document.querySelector("[data-testid='ask-ai-input-block-editor']") ||
        findHeidiNewSessionButton()
      ), {
        timeout: 12000,
        interval: 250,
        description: "l'interface Heidi avant décision de session",
      });
    } catch (error) {
      appendDebugLog("heidi:session-decision-ui-timeout", {
        jobId,
        error: error.message,
        debug: getHeidiNewSessionDebugSnapshot(),
      });
    }
  }

  function mergeHeidiSessionDecisionSnapshots(firstSnapshot, secondSnapshot) {
    return {
      askInputPresent: Boolean(firstSnapshot.askInputPresent || secondSnapshot.askInputPresent),
      askInputTextLength: Math.max(firstSnapshot.askInputTextLength || 0, secondSnapshot.askInputTextLength || 0),
      askContentPresent: Boolean(firstSnapshot.askContentPresent || secondSnapshot.askContentPresent),
      askContentTextLength: Math.max(firstSnapshot.askContentTextLength || 0, secondSnapshot.askContentTextLength || 0),
      directAnswerTextLength: Math.max(firstSnapshot.directAnswerTextLength || 0, secondSnapshot.directAnswerTextLength || 0),
      copyButtonPresent: Boolean(firstSnapshot.copyButtonPresent || secondSnapshot.copyButtonPresent),
      stillThinking: Boolean(firstSnapshot.stillThinking || secondSnapshot.stillThinking),
      urlPath: secondSnapshot.urlPath || firstSnapshot.urlPath || "",
      first: firstSnapshot,
      second: secondSnapshot,
    };
  }

  function getHeidiCurrentSessionContentSnapshot() {
    const askInput = findHeidiAskInputEditorForSnapshot();
    const askContent = document.querySelector("#ask-ai-content");
    const askInputText = normalizeHeidiAskInputSnapshotText(askInput ? extractRawTextFromElement(askInput) : "");
    const askContentText = normalizeHeidiDirectAnswerText(askContent ? extractRawTextFromElement(askContent) : "");
    const directAnswerText = extractHeidiDirectAnswerRawText();

    return {
      urlPath: location.pathname || "",
      askInputPresent: Boolean(askInput),
      askInputTextLength: askInputText.length,
      askContentPresent: Boolean(askContent),
      askContentTextLength: askContentText.length,
      directAnswerTextLength: directAnswerText.length,
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

    if (!normalized || /^(?:poser|posez|demander|demandez|ask|message)/.test(normalized)) {
      return "";
    }

    return text;
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

    // V1.0.51 : un seul click natif, sans pointerdown/mousedown manuels.
    // Sur Heidi, la séquence pointerdown + button.click() pouvait être interprétée comme deux gestes.
    try {
      button.click();
    } catch (_error) {
      try {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch (_nestedError) {
        // Abandon silencieux : le log appelant documentera l'échec éventuel.
      }
    }
  }

  function getHeidiCurrentSessionFingerprint() {
    try {
      const urlPath = location.pathname || "";
      const urlSearch = location.search || "";
      const activeTab = document.querySelector('[role="tab"][aria-selected="true"], [data-state="active"][role="tab"]');
      const activeTabText = activeTab ? normalizeText(activeTab.textContent || "") : "";
      const contentText = normalizeText(extractRawTextFromElement(document.querySelector("#ask-ai-content") || null)).slice(0, 160);
      const inputText = normalizeText(extractRawTextFromElement(findHeidiAskInputEditorForSnapshot() || null)).slice(0, 160);

      // V1.0.51 : utiliser la fonction de hash existante.
      // V1.0.50 appelait stableHash(), non définie, ce qui interrompait le worker
      // juste avant le clic sur "Nouvelle session".
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
        const snapshot = getHeidiCurrentSessionContentSnapshot();
        const afterFingerprint = getHeidiCurrentSessionFingerprint();
        const askInputReady = snapshot.askInputPresent && snapshot.askInputTextLength === 0;
        const noOldOutput = snapshot.askContentTextLength === 0 && snapshot.directAnswerTextLength === 0 && !snapshot.copyButtonPresent && !snapshot.stillThinking;
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

  async function findHeidiNewSessionButtonWithRetry(jobId = "") {
    try {
      return await waitFor(() => findHeidiNewSessionButton(), {
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
      return await waitFor(() => findHeidiNewSessionButton(), {
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
      const raw = extractRawTextFromElement(content);
      const answer = extractCopiedHeidiAnswerFromText(raw) || extractAnswerFromText(raw);
      if (answer) {
        return answer;
      }
    }

    const fallbackContainer = document.querySelector("#ask-ai-container");
    if (fallbackContainer) {
      const raw = extractRawTextFromElement(fallbackContainer);
      const answer = extractCopiedHeidiAnswerFromText(raw) || extractAnswerFromText(raw);
      if (answer) {
        return answer;
      }
    }

    return "";
  }

  function extractHeidiAnswerFromDirectBlock() {
    const rawDirectText = extractHeidiDirectAnswerRawText();

    if (!rawDirectText) {
      return "";
    }

    return extractCopiedHeidiAnswerFromText(rawDirectText) || extractAnswerFromText(rawDirectText);
  }

  function extractHeidiDirectAnswerRawText() {
    const askContent = document.querySelector("#ask-ai-content");
    const askContentText = extractHeidiDirectAnswerRawTextFromContainer(askContent);
    if (askContentText) {
      return askContentText;
    }

    const askContainer = document.querySelector("#ask-ai-container");
    const askContainerText = extractHeidiDirectAnswerRawTextFromContainer(askContainer);
    if (askContainerText) {
      return askContainerText;
    }

    return extractHeidiDirectAnswerRawTextFromContainer(document.body);
  }

  function extractHeidiDirectAnswerRawTextFromContainer(container) {
    if (!container) {
      return "";
    }

    const selectors = [
      '[data-testid="ask-ai-block-editor"] [contenteditable="false"]',
      '[data-testid="ask-ai-block-editor"] .tiptap.ProseMirror',
      '[data-testid="ask-ai-block-editor"] .ProseMirror',
      '[data-testid="ask-ai-block-editor"]',
      '[contenteditable="false"]',
      '.tiptap.ProseMirror',
      '.ProseMirror',
    ];

    const nodes = [];
    const seen = new Set();

    selectors.forEach((selector) => {
      Array.from(container.querySelectorAll ? container.querySelectorAll(selector) : []).forEach((node) => {
        if (!node || seen.has(node)) {
          return;
        }
        seen.add(node);
        nodes.push(node);
      });
    });

    if (!nodes.length && container.id === "ask-ai-content") {
      nodes.push(container);
    }

    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];

      if (node.closest && node.closest(".ask-ai-input")) {
        continue;
      }

      const rawText = normalizeHeidiDirectAnswerText(extractRawTextFromElement(node));

      if (!rawText || isOnlyHeidiThinkingText(rawText)) {
        continue;
      }

      return rawText;
    }

    const containerRawText = normalizeHeidiDirectAnswerText(extractRawTextFromElement(container));
    if (containerRawText && !isOnlyHeidiThinkingText(containerRawText)) {
      return containerRawText;
    }

    return "";
  }

  function normalizeHeidiDirectAnswerText(value) {
    return deduplicateContiguousHeidiAnswerText(
      normalizeHeidiAnswerTextForExtraction(stripHeidiPromptBlocksFromText(value))
        .replace(/L[’']IA est en train de réfléchir\.{0,3}/gi, "")
        .replace(/\bBientôt terminé\b/gi, "")
        .replace(/\s*(?:Copier le texte|Copier)$/i, "")
        .trim()
    );
  }

  function extractRawTextFromElement(element) {
    if (!element) {
      return "";
    }

    const innerText = typeof element.innerText === "string" ? element.innerText : "";
    const textContent = typeof element.textContent === "string" ? element.textContent : "";
    const raw = textContent.length >= innerText.length ? textContent : innerText;
    return normalizeMultilineText(raw);
  }

  function deduplicateContiguousHeidiAnswerText(value) {
    const text = normalizeMultilineText(value);
    if (!text) {
      return "";
    }

    const lines = text.split("\n").map((line) => normalizeText(line)).filter(Boolean);
    if (lines.length > 1) {
      const deduped = [];
      lines.forEach((line) => {
        if (!deduped.length || normalizeForCompare(deduped[deduped.length - 1]) !== normalizeForCompare(line)) {
          deduped.push(line);
        }
      });
      return deduped.join("\n").trim();
    }

    const normalized = normalizeForCompare(text);
    const half = Math.floor(text.length / 2);
    for (let cut = Math.max(12, half - 12); cut <= Math.min(text.length - 12, half + 12); cut += 1) {
      const left = text.slice(0, cut).trim();
      const right = text.slice(cut).trim();
      if (left && right && normalizeForCompare(left) === normalizeForCompare(right)) {
        return left;
      }
    }

    // Cas fréquent Heidi : même conclusion répétée sans saut de ligne avec une micro-variation d'espacement.
    const firstSentenceMatch = text.match(/^(.{20,180}?\))\s*(.+)$/);
    if (firstSentenceMatch) {
      const first = normalizeForCompare(firstSentenceMatch[1]);
      const second = normalizeForCompare(firstSentenceMatch[2]);
      if (second && (first.includes(second) || second.includes(first))) {
        return firstSentenceMatch[1].trim();
      }
    }

    return text;
  }

  function isElementVisibleEnough(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
      return false;
    }

    const text = normalizeText(extractRawTextFromElement(element));
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

  async function waitForStableHeidiAnswer(jobId = "", tableText = "") {
    let lastAnswer = "";
    let stableSince = 0;
    let firstThinkingAt = 0;
    let hiddenSince = 0;
    let lastFocusAttemptAt = 0;
    let lastRelaunchAt = 0;
    let relaunchCount = 0;
    let lastProgressLogAt = 0;
    let invalidDirectSince = 0;
    let emptyOutputSince = 0;
    let lastInvalidDirectSignature = "";
    let copyButtonNotClickedLogged = false;
    let noRelaunchLogged = false;
    let lastVisibleOutputBlockLogAt = 0;
    let fallbackReturnedAfterDirectFailure = false;
    const fallbackAnswer = buildHeidiFailureFallbackTitle(tableText);

    return waitFor(() => {
      const rawDirectText = extractHeidiDirectAnswerRawText();
      const copyButton = findHeidiCopyTextButton();
      const stillThinking = isHeidiStillThinking();
      const domAnswer = extractHeidiAnswerFromAskContent();
      const answer = stillThinking ? "" : domAnswer;
      const waitingCandidate = stillThinking && domAnswer ? domAnswer : "";
      const now = Date.now();
      const hiddenOrBlurred = document.hidden || !document.hasFocus();
      const hiddenTab = document.hidden;

      if (!lastProgressLogAt || now - lastProgressLogAt >= 5000) {
        lastProgressLogAt = now;
        appendDebugLog("heidi:answer-wait-progress", {
          jobId,
          answerLength: answer ? answer.length : 0,
          domAnswerLength: domAnswer ? domAnswer.length : 0,
          directRawLength: rawDirectText ? rawDirectText.length : 0,
          directRawLooksUsable: Boolean(rawDirectText && (extractCopiedHeidiAnswerFromText(rawDirectText) || extractAnswerFromText(rawDirectText))),
          hasCopyButton: Boolean(copyButton),
          copyButtonIsExact: Boolean(copyButton && isHeidiExactCopyTextButton(copyButton)),
          copyButtonIgnored: Boolean(copyButton),
          stillThinking,
          hidden: document.hidden,
          hasFocus: document.hasFocus(),
          relaunchCount,
          thinkingElapsedMs: firstThinkingAt ? now - firstThinkingAt : 0,
          hiddenElapsedMs: hiddenSince ? now - hiddenSince : 0,
          invalidDirectElapsedMs: invalidDirectSince ? now - invalidDirectSince : 0,
          fallbackAvailable: Boolean(fallbackAnswer),
          copyButtonSnapshot: findHeidiCopyTextButtonDebugSnapshot(),
        });
      }

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
        updateHeidiStatus(jobId, "Heidi est en arrière-plan : analyse poursuivie, tentative de réveil...");
        focusCurrentHeidiWindow();
      }

      if (copyButton && !copyButtonNotClickedLogged) {
        copyButtonNotClickedLogged = true;
        appendDebugLog("heidi:copy-button-detected-not-clicked", {
          jobId,
          reason: "lecture directe du bloc de réponse pour éviter les erreurs fail to copy",
          button: describeDebugElement(copyButton),
          directRawLength: rawDirectText ? rawDirectText.length : 0,
          answerLength: answer ? answer.length : 0,
        });
        updateHeidiStatus(jobId, "Réponse Heidi détectée : lecture directe du texte, sans clic sur Copier...");
      }

      if (waitingCandidate) {
        if (!lastVisibleOutputBlockLogAt || now - lastVisibleOutputBlockLogAt >= 5000) {
          lastVisibleOutputBlockLogAt = now;
          appendDebugLog("heidi:answer-candidate-ignored-while-thinking", {
            jobId,
            candidateLength: waitingCandidate.length,
            directRawLength: rawDirectText ? rawDirectText.length : 0,
            reason: "le message L’IA est en train de réfléchir est encore présent",
            askContentSnapshot: describeAskAiContentSnapshot(),
          });
        }
        return "";
      }

      if (answer) {
        invalidDirectSince = 0;
        if (answer !== lastAnswer) {
          lastAnswer = answer;
          stableSince = now;
          appendDebugLog("heidi:answer-candidate", {
            jobId,
            answerLength: answer.length,
            directRawLength: rawDirectText ? rawDirectText.length : 0,
            hasCopyButton: Boolean(copyButton),
            stillThinking,
            source: "direct-dom",
          });
          return "";
        }

        const stableDelay = stillThinking
          ? HEIDI_ANSWER_STABLE_WITH_STUCK_THINKING_MS
          : HEIDI_DIRECT_ANSWER_STABLE_MS;

        if (now - stableSince >= stableDelay) {
          appendDebugLog("heidi:answer-from-direct-dom", {
            jobId,
            answerLength: answer.length,
            stableMs: now - stableSince,
            hasCopyButton: Boolean(copyButton),
            stillThinking,
          });
          return answer;
        }

        return "";
      }

      if (!stillThinking && rawDirectText) {
        const signature = hashString(rawDirectText);

        if (!invalidDirectSince || signature !== lastInvalidDirectSignature) {
          invalidDirectSince = now;
          lastInvalidDirectSignature = signature;
          appendDebugLog("heidi:direct-answer-unusable", {
            jobId,
            directRawLength: rawDirectText.length,
            signature,
            fallbackAvailable: Boolean(fallbackAnswer),
            reason: "texte présent dans le bloc Heidi mais non compatible avec un titre biologique WEDA",
          });
        }

        if (
          !fallbackReturnedAfterDirectFailure &&
          fallbackAnswer &&
          now - invalidDirectSince >= HEIDI_DIRECT_ANSWER_FALLBACK_AFTER_MS
        ) {
          fallbackReturnedAfterDirectFailure = true;
          appendDebugLog("heidi:fallback-after-direct-answer-unusable", {
            jobId,
            fallbackLength: fallbackAnswer.length,
            directRawLength: rawDirectText.length,
            statusSummary: summarizeTableStatuses(tableText),
          });
          return fallbackAnswer;
        }

        return "";
      }

      if (stillThinking || !answer) {
        if (!firstThinkingAt) {
          firstThinkingAt = now;
        }

        if (!stillThinking && copyButton && !rawDirectText) {
          emptyOutputSince = emptyOutputSince || now;
          if (!lastVisibleOutputBlockLogAt || now - lastVisibleOutputBlockLogAt >= 5000) {
            lastVisibleOutputBlockLogAt = now;
            appendDebugLog("heidi:output-visible-but-ask-content-empty", {
              jobId,
              stillThinking,
              hasCopyButton: Boolean(copyButton),
              directRawLength: rawDirectText ? rawDirectText.length : 0,
              emptyOutputElapsedMs: now - emptyOutputSince,
              fallbackAvailable: Boolean(fallbackAnswer),
              askContentSnapshot: describeAskAiContentSnapshot(),
            });
          }

          if (
            !fallbackReturnedAfterDirectFailure &&
            fallbackAnswer &&
            now - emptyOutputSince >= HEIDI_EMPTY_OUTPUT_FALLBACK_AFTER_MS
          ) {
            fallbackReturnedAfterDirectFailure = true;
            appendDebugLog("heidi:fallback-after-empty-ask-content", {
              jobId,
              fallbackLength: fallbackAnswer.length,
              statusSummary: summarizeTableStatuses(tableText),
            });
            return fallbackAnswer;
          }

          return "";
        }

        if (copyButton || rawDirectText) {
          if (!lastVisibleOutputBlockLogAt || now - lastVisibleOutputBlockLogAt >= 5000) {
            lastVisibleOutputBlockLogAt = now;
            appendDebugLog("heidi:answer-wait-visible-output-no-copy", {
              jobId,
              stillThinking,
              hasCopyButton: Boolean(copyButton),
              directRawLength: rawDirectText ? rawDirectText.length : 0,
              relaunchDisabled: true,
              askContentSnapshot: describeAskAiContentSnapshot(),
            });
          }
          return "";
        }

        if (!noRelaunchLogged) {
          noRelaunchLogged = true;
          appendDebugLog("heidi:answer-relaunch-disabled", {
            jobId,
            reason: "le bouton de validation Heidi est lancé une seule fois ; lecture directe dans #ask-ai-content",
            maxRelaunches: HEIDI_MAX_RELAUNCHES,
          });
        }

        return "";
      }

      firstThinkingAt = 0;
      return "";
    }, {
      timeout: HEIDI_ANSWER_WAIT_TIMEOUT_MS,
      interval: 350,
      description: "la fin de génération Heidi",
    });
  }

  function describeAskAiContentSnapshot() {
    const content = document.querySelector("#ask-ai-content");
    if (!content) {
      return { present: false };
    }

    const directBlocks = Array.from(content.querySelectorAll('[data-testid="ask-ai-block-editor"], [contenteditable="false"], .ProseMirror'));
    return {
      present: true,
      textContentLength: normalizeMultilineText(content.textContent || "").length,
      innerTextLength: normalizeMultilineText(content.innerText || "").length,
      directBlocksCount: directBlocks.length,
      lastDirectBlock: directBlocks.length ? describeDebugElement(directBlocks[directBlocks.length - 1]) : null,
    };
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
    const exactLabelButton = findHeidiCopyTextButtonFromExactLabel();
    if (exactLabelButton) {
      return exactLabelButton;
    }

    return Array.from(document.querySelectorAll("button, [role='button']"))
      .find((button) => isHeidiExactCopyTextButton(button)) || null;
  }

  function isHeidiExactCopyTextButton(button) {
    if (!button || !isElementVisible(button) || !isUsableButton(button)) {
      return false;
    }

    const text = normalizeText(button.innerText || button.textContent || "");
    const ariaLabel = normalizeText(button.getAttribute("aria-label") || "");
    const title = normalizeText(button.getAttribute("title") || "");
    const testId = normalizeText(button.getAttribute("data-testid") || "");
    const combined = `${text} ${ariaLabel} ${title} ${testId}`;

    if (/copier\s+le\s+texte/i.test(combined) || /copy\s+text/i.test(combined)) {
      return true;
    }

    return Array.from(button.querySelectorAll("p, span, div"))
      .some((element) => /^copier\s+le\s+texte$/i.test(normalizeText(element.textContent)) && isElementVisibleEnough(element));
  }

  function getHeidiCopyButtonSignature(button) {
    if (!button) {
      return "";
    }

    const rect = typeof button.getBoundingClientRect === "function" ? button.getBoundingClientRect() : null;
    const text = normalizeText(button.innerText || button.textContent || "");
    const ariaLabel = normalizeText(button.getAttribute("aria-label") || "");
    const title = normalizeText(button.getAttribute("title") || "");
    const position = rect ? `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}` : "";

    return hashString(`${text}|${ariaLabel}|${title}|${position}`);
  }

  async function readClipboardTextBestEffort() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      return "";
    }

    return navigator.clipboard.readText();
  }

  function findHeidiCopyTextButtonFromExactLabel() {
    const candidates = Array.from(document.querySelectorAll("p, span, div"));

    for (const element of candidates) {
      const text = normalizeText(element.textContent);
      if (!/^copier\s+le\s+texte$/i.test(text)) {
        continue;
      }

      const clickable = element.closest("button, [role='button']") || element;
      const visibleTarget = isElementVisible(clickable) ? clickable : element;
      const targetIsVisible = isElementVisible(visibleTarget) || isElementVisibleEnough(element);

      if (!targetIsVisible || !isUsableButton(clickable)) {
        continue;
      }

      return clickable;
    }

    return null;
  }

  function findHeidiCopyTextButtonDebugSnapshot() {
    const exactTextNodes = Array.from(document.querySelectorAll("p, span, div"))
      .filter((element) => /^copier\s+le\s+texte$/i.test(normalizeText(element.textContent)))
      .slice(0, 8)
      .map((element) => ({
        label: describeDebugElement(element),
        clickable: describeDebugElement(element.closest("button, [role='button']") || element),
        labelVisible: isElementVisibleEnough(element),
        clickableVisible: isElementVisible(element.closest("button, [role='button']") || element),
        usable: isUsableButton(element.closest("button, [role='button']") || element),
      }));

    const copyLikeButtons = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((button) => /copier|copy/i.test(getElementSearchText(button)))
      .slice(0, 12)
      .map((button) => ({
        button: describeDebugElement(button),
        visible: isElementVisible(button),
        usable: isUsableButton(button),
        searchText: sanitizeDebugString(getElementSearchText(button), 180),
      }));

    return {
      exactTextNodesCount: exactTextNodes.length,
      exactTextNodes,
      copyLikeButtonsCount: copyLikeButtons.length,
      copyLikeButtons,
    };
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
    if (!button) {
      return "";
    }

    const localCandidates = [
      button.closest('[data-testid="ask-ai-block-editor"]'),
      button.closest("#ask-ai-content"),
      button.closest("#ask-ai-container"),
      button.closest("article"),
      button.closest("section"),
    ].filter(Boolean);

    for (const candidate of localCandidates) {
      const answer = extractAnswerFromText(getVisibleText(candidate));
      if (answer) {
        return answer;
      }
    }

    let node = button;

    for (let depth = 0; node && node !== document.body && depth < 14; depth += 1) {
      const siblingAnswer = extractAnswerFromNeighborNodes(node);
      if (siblingAnswer) {
        return siblingAnswer;
      }

      const text = getVisibleText(node);
      const answer = extractAnswerFromText(text);
      if (answer) {
        return answer;
      }
      node = node.parentElement;
    }

    return "";
  }

  function extractCopiedHeidiAnswerNear(button) {
    if (!button) {
      return "";
    }

    const localCandidates = [
      button.closest('[data-testid="ask-ai-block-editor"]'),
      button.closest("#ask-ai-content"),
      button.closest("#ask-ai-container"),
      button.closest("article"),
      button.closest("section"),
    ].filter(Boolean);

    for (const candidate of localCandidates) {
      const answer = extractCopiedHeidiAnswerFromText(getVisibleText(candidate));
      if (answer) {
        return answer;
      }
    }

    let node = button;
    for (let depth = 0; node && node !== document.body && depth < 14; depth += 1) {
      const answer = extractCopiedHeidiAnswerFromText(getVisibleText(node));
      if (answer) {
        return answer;
      }
      node = node.parentElement;
    }

    return "";
  }

  function extractCopiedHeidiAnswerFromText(text) {
    const prepared = normalizeHeidiAnswerTextForExtraction(stripHeidiPromptBlocksFromText(text));
    const lines = prepared
      .split(/\n+/)
      .map(cleanHeidiAnswerLine)
      .filter((line) => line && !isHeidiUiNoiseLine(line));

    if (!lines.length) {
      return "";
    }

    const importantCandidate = extractImportantLineFromHeidiLines(lines);
    if (importantCandidate) {
      return importantCandidate;
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = cleanHeidiExtractedAnswerCandidate(lines[index]);
      if (isAcceptableCopiedHeidiAnswer(candidate)) {
        return candidate;
      }
    }

    const collapsed = cleanHeidiExtractedAnswerCandidate(lines.join(", "));
    return isAcceptableCopiedHeidiAnswer(collapsed) ? collapsed : "";
  }

  function isAcceptableCopiedHeidiAnswer(value) {
    const text = cleanHeidiExtractedAnswerCandidate(value);

    if (!text || text.length > 350 || isOnlyPunctuationText(text)) {
      return false;
    }

    if (/^(?:IMPORTANT|URGENCE)\s*:\s*[.,;:!?-]*$/i.test(text)) {
      return false;
    }

    if (hasForbiddenHeidiLineText(text) || hasForbiddenLipidOutput(text) || hasForbiddenBloodOutput(text) || isHeidiUiNoiseLine(text) || isPromptInstructionLine(text)) {
      return false;
    }

    if (isExpectedTitleLine(text)) {
      return true;
    }

    if (/^(?:Bilan RAS|ECBU RAS|IST RAS|H[ée]mocc?ult RAS)(?:$|[,.]\s*\S| et\s+\S)/i.test(text)) {
      return true;
    }

    if (hasBiologyMarkerText(text) && /(?:\d|↑|↓|↗|↘|positif|positive|n[ée]gatif|negative|d[ée]tect|detect|absence|pr[ée]sence|h[ée]molyse|hemolyse|st[ée]rile|contr[ôo]ler|douteux|limite|ind[ée]termin[ée]?)/i.test(text)) {
      return true;
    }

    if (/\b(?:ECBU|IST|VIH|VHB|VHC|TPHA|VDRL|Chlamydia|gonocoque|Neisseria|Mycoplasma|H[ée]licobacter|pylori|h[ée]moculture|paludisme|LCR|H[ée]mocc?ult|test immunologique f[ée]cal|sang dans les selles)\b/i.test(text) &&
      /\b(?:positif|positive|n[ée]gatif|negative|d[ée]tect[ée]?|detecte|absence|pr[ée]sence|st[ée]rile|douteux|limite|ind[ée]termin[ée]?|contr[ôo]ler|anormal|germe|E\.\s*coli|Escherichia|Klebsiella|Proteus|Enterococcus|Pseudomonas|Staphylococcus|Streptococcus)\b/i.test(text)) {
      return true;
    }

    return false;
  }

  function extractAnswerFromNeighborNodes(node) {
    if (!node || !node.parentElement) {
      return "";
    }

    const candidates = [];
    let previous = node.previousElementSibling;
    let guard = 0;

    while (previous && guard < 8) {
      candidates.push(previous);
      previous = previous.previousElementSibling;
      guard += 1;
    }

    candidates.push(...Array.from(node.parentElement.querySelectorAll('[data-testid="ask-ai-block-editor"], [contenteditable="false"], .ProseMirror, p, div, span')).slice(-40));

    for (const candidate of candidates) {
      if (!isElementVisibleEnough(candidate)) {
        continue;
      }

      const answer = extractAnswerFromText(getVisibleText(candidate));
      if (answer) {
        return answer;
      }
    }

    return "";
  }

  function extractAnswerFromText(text) {
    const normalized = stripHeidiPromptBlocksFromText(text)
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();

    const prepared = normalizeHeidiAnswerTextForExtraction(normalized);
    const shortAnswer = extractShortHeidiLine(prepared);
    if (shortAnswer) {
      return shortAnswer;
    }

    return "";
  }

  function normalizeHeidiAnswerTextForExtraction(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .map(cleanHeidiAnswerLine)
      .filter((line) => line && !isHeidiUiNoiseLine(line))
      .join("\n")
      .trim();
  }

  function cleanHeidiAnswerLine(value) {
    return normalizeText(value)
      .replace(/^(?:[-–—•]\s*)+/, "")
      .replace(/\s*(?:Copier le texte|Copier)$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isHeidiUiNoiseLine(value) {
    const text = normalizeText(value);
    const normalized = normalizeForCompare(text).replace(/[’']/g, " ");

    if (!normalized) {
      return true;
    }

    return (
      /^(?:copier|copier le texte|copy|copy text)$/.test(normalized) ||
      /^(?:bientot termine|generation en cours|transcrire)$/.test(normalized) ||
      /^l\s*ia\s+est\s+en\s+train\s+de\s+reflechir/.test(normalized) ||
      /^demandez\b/.test(normalized) ||
      /^ask\b/.test(normalized)
    );
  }

  function stripHeidiPromptBlocksFromText(text) {
    const lines = String(text || "").replace(/\r/g, "\n").split("\n");
    const output = [];
    let skippingPrompt = false;

    lines.forEach((line) => {
      const normalized = normalizeForCompare(line).replace(/[’']/g, " ");

      if (!skippingPrompt && normalized.includes("tu es medecin generaliste")) {
        skippingPrompt = true;
        return;
      }

      if (skippingPrompt) {
        if (normalized.includes("ne jamais afficher cet auto-controle")) {
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
      .map(cleanHeidiAnswerLine)
      .filter(Boolean);

    const importantCandidate = extractImportantLineFromHeidiLines(lines);
    if (importantCandidate) {
      return importantCandidate;
    }

    const lineCandidate = findLastExpectedTitleLine(lines);
    if (lineCandidate) {
      return lineCandidate;
    }

    const collapsed = sanitizeTitle(text);
    const starts = [
      "IMPORTANT :",
      "URGENCE :",
      "Bilan RAS",
      "ECBU RAS",
      "IST RAS",
      "Hémoccult RAS",
      "Hemoccult RAS",
      "Hémocult RAS",
      "Hemocult RAS",
    ];
    let lastIndex = -1;

    starts.forEach((start) => {
      const index = collapsed.lastIndexOf(start);
      if (index > lastIndex) {
        lastIndex = index;
      }
    });

    if (lastIndex < 0) {
      return "";
    }

    let candidate = collapsed.slice(lastIndex);
    const stopMarkers = [
      " Copier le texte",
      " Copier",
      " Bientôt terminé",
      " L'IA est en train",
      " L’IA est en train",
      " Transcrire",
      " TABLEAU BIOLOGIQUE",
      " BIOLOGIE À ANALYSER",
    ];

    stopMarkers.forEach((marker) => {
      const index = candidate.indexOf(marker);
      if (index > 0) {
        candidate = candidate.slice(0, index);
      }
    });

    candidate = cleanHeidiExtractedAnswerCandidate(candidate);
    return isExpectedTitleLine(candidate) ? sanitizeTitle(candidate) : "";
  }

  function extractImportantLineFromHeidiLines(lines) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const prefix = getImportantPrefix(line);

      if (!prefix) {
        continue;
      }

      const rest = cleanImportantContent(line.replace(/^\s*(?:IMPORTANT|URGENCE)\s*:\s*/i, ""));
      if (isMeaningfulImportantContent(rest)) {
        return sanitizeTitle(`${prefix} ${rest}`);
      }

      const following = [];
      for (let nextIndex = index + 1; nextIndex < lines.length && following.length < 4; nextIndex += 1) {
        const nextLine = cleanImportantContent(lines[nextIndex]);

        if (!nextLine || isOnlyPunctuationText(nextLine) || isHeidiUiNoiseLine(nextLine)) {
          continue;
        }

        if (/^(?:IMPORTANT|URGENCE)\s*:/i.test(nextLine)) {
          break;
        }

        if (hasForbiddenHeidiLineText(nextLine)) {
          continue;
        }

        following.push(nextLine);

        const joined = cleanImportantContent(following.join(", "));
        if (isMeaningfulImportantContent(joined)) {
          return sanitizeTitle(`${prefix} ${joined}`);
        }
      }
    }

    return "";
  }

  function getImportantPrefix(line) {
    const match = sanitizeTitle(line).match(/^\s*(IMPORTANT|URGENCE)\s*:/i);
    if (!match) {
      return "";
    }

    return `${match[1].toUpperCase()} :`;
  }

  function cleanImportantContent(value) {
    return cleanHeidiExtractedAnswerCandidate(value)
      .replace(/^\s*(?:IMPORTANT|URGENCE)\s*:\s*/i, "")
      .trim();
  }

  function cleanHeidiExtractedAnswerCandidate(value) {
    return sanitizeTitle(value)
      .replace(/\s*(?:Copier le texte|Copier)$/i, "")
      .replace(/\s*(?:Bientôt terminé|L[’']IA est en train de réfléchir.*)$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function isMeaningfulImportantContent(content) {
    const text = cleanImportantContent(content);

    if (!text || isOnlyPunctuationText(text)) {
      return false;
    }

    if (hasForbiddenHeidiLineText(text) || hasForbiddenLipidOutput(text) || hasForbiddenBloodOutput(text)) {
      return false;
    }

    if (looksLikeBiologySummaryLine(text)) {
      return true;
    }

    if (hasBiologyMarkerText(text) && /(?:\d|↑|↓|↗|↘|positif|positive|détect|detect|douteux|indéterminé|indetermine|critique|urgent|hémolyse|hemolyse)/i.test(text)) {
      return true;
    }

    if (/\b(?:H[ée]mocc?ult|Hemocc?ult|ECBU|IST|VIH|VHB|VHC|TPHA|VDRL|Chlamydia|gonocoque|Neisseria|Mycoplasma|h[ée]moculture|paludisme|LCR)\b/i.test(text) && /\b(?:positif|positive|détect[ée]?|detecte|douteux|limite|ind[ée]termin[ée]?|contr[ôo]ler|anormal|germe|E\.\s*coli|Escherichia|Klebsiella|Proteus|Enterococcus|Pseudomonas|Staphylococcus|Streptococcus)\b/i.test(text)) {
      return true;
    }

    return false;
  }

  function isOnlyPunctuationText(value) {
    return !String(value || "").replace(/[\s.,;:!/?\\|()[\]{}\-–—_*]+/g, "").trim();
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

    if (text.length > 350) {
      return false;
    }

    const importantPrefix = getImportantPrefix(text);
    if (importantPrefix) {
      const content = cleanImportantContent(text);
      return isMeaningfulImportantContent(content);
    }

    if (hasForbiddenHeidiLineText(text) || hasForbiddenLipidOutput(text) || hasForbiddenBloodOutput(text)) {
      return false;
    }

    if (/^Bilan RAS(?:$|[,.]\s*\S)/i.test(text)) {
      return true;
    }

    if (/^ECBU RAS(?:\.?$|[,.]\s*\S| et\s+\S)/i.test(text)) {
      return true;
    }

    if (/^IST RAS(?:\.?$|[,.]\s*\S| et\s+\S)/i.test(text)) {
      return true;
    }

    if (/^H[ée]mocc?ult RAS(?:\.?$|[,.]\s*\S| et\s+\S)/i.test(text)) {
      return true;
    }

    return looksLikeBiologySummaryLine(text);
  }

  function isSoftBiologyTitleLine(value, result = {}) {
    const text = sanitizeTitle(value);
    const source = String(result.titleSource || result.source || "");

    if (!text || text.length < 6 || text.length > 350 || isOnlyPunctuationText(text)) {
      return false;
    }

    if (hasForbiddenHeidiLineTextWithoutWedaStatus(text) || hasForbiddenLipidOutput(text) || hasForbiddenBloodOutput(text)) {
      return false;
    }

    if (/^(?:Copier le texte|Copier|Bient[ôo]t termin[ée]|L[’']IA est en train de r[ée]fl[ée]chir)$/i.test(text)) {
      return false;
    }

    const sourceLooksGenerated = !source || /(?:heidi|lmstudio|lm-studio|local|direct|dom|fallback|weda-status|displayed-weda)/i.test(source);
    if (!sourceLooksGenerated) {
      return false;
    }

    const hasStatusWord = /\b(?:RAS|normal|normale|n[ée]gatif|negative|positif|positive|douteux|limite|ind[ée]termin[ée]?|d[ée]tect[ée]?|detecte|contr[ôo]ler|anormal|h[ée]molyse|hemolyse|coagul[ée]?|coagule|important)\b/i.test(text);
    const hasNumberOrSignal = /(?:[<>]?\s*\d+(?:[,.]\d+)?|↑|↓|\b\d+(?:[,.]\d+)?\s*N\b)/i.test(text);

    return Boolean(
      looksLikeBiologySummaryLine(text) ||
      (hasBiologyMarkerText(text) && (hasStatusWord || hasNumberOrSignal)) ||
      (/^IMPORTANT\s*:/i.test(text) && cleanImportantContent(text).length >= 6 && !isOnlyPunctuationText(cleanImportantContent(text)))
    );
  }

  function hasForbiddenHeidiLineText(text) {
    return isPromptInstructionLine(text) ||
      /(?:^|\b)(?:À RELIRE|A RELIRE|ALARME|ANOMALIES|R[ÉE]SUM[ÉE]|FORMAT DE SORTIE|SOURCE UNIQUE|M[ÉE]THODE INTERNE|OBJECTIF|EXEMPLES DE SORTIE|TABLEAU BIOLOGIQUE|BIOLOGIE À ANALYSER|Libell[ée]\s+Valeur|Ne jamais|Toujours citer|Toujours inclure|Répondre uniquement|Construire la ligne|Considérer comme|RÈGLES|REGLES)(?:\b|$)/i.test(text);
  }

  function hasForbiddenLipidOutput(text) {
    const normalized = normalizeForCompare(text);
    const cholesterolLipidLabel = /(?:^|[^\w])(?:cholesterol\s+(?:non\s*[- ]?\s*)?(?:h\s*\.?\s*d\s*\.?\s*l|l\s*\.?\s*d\s*\.?\s*l)|(?:non\s*[- ]?\s*)?(?:h\s*\.?\s*d\s*\.?\s*l|l\s*\.?\s*d\s*\.?\s*l)\s*[- ]?\s*cholesterol)(?=$|[^\w])/i;
    const dottedLipidLabel = /(?:^|[^\w])(?:h\s*\.\s*d\s*\.\s*l|l\s*\.\s*d\s*\.\s*l)\.?(?=$|[^\w])/i;
    const lipidMmolUnit = /(?:^|[^\w])(?:non\s*[- ]?\s*hdl|hdl|ldl|h\s*\.?\s*d\s*\.?\s*l|l\s*\.?\s*d\s*\.?\s*l)(?:[^\d,;]{0,12})[<>]?\s*\d+(?:[,.]\d+)?\s*mmol\s*\/\s*l\b/i;

    return cholesterolLipidLabel.test(normalized) ||
      dottedLipidLabel.test(normalized) ||
      lipidMmolUnit.test(normalized);
  }

  function hasForbiddenBloodOutput(text) {
    const normalized = normalizeForCompare(text);
    return /(?:^|[^\w])(?:hematies?|hematocrite|ccmh|chlore|chloremie|chlorures?|cl\s*-?)(?=$|[^\w])/i.test(normalized);
  }

  function isPromptInstructionLine(text) {
    const normalized = normalizeForCompare(text)
      .replace(/[’']/g, " ")
      .replace(/^(?:[-–—•:;]\s*)+/, "");

    if (!normalized) {
      return false;
    }

    return /^(?:ecrire|citer|afficher|calculer|arrondir|utiliser|separer|repondre|verifier|commencer|ne jamais|ne pas|si\s|pour\s|forme normale|forme anormale|style final|sortie finale|auto-controle|auto controle|exception|la sortie finale|le seul prefixe|les normes|source unique|objectif|regle)\b/.test(normalized) ||
      /\b(?:regle|prompt|consigne|critere|seuil generique|norme haute|valeur mesuree|sortie finale)\b/.test(normalized);
  }

  function hasBiologyMarkerText(text) {
    return /\b(?:LDL|non-HDL|TROPO|CRP|PCT|BNP|NT-proBNP|HG|Hb|ferr|VGM|TSH|T4L|B12|folates|LIPASE|DFG|HCG|K\+|Na|Ca\s*corr|PNN|Plaq|plaquettes|Leuco|leucocytes|Mono|INR|RAC|ASAT|ALAT|GGT|PAL|bilirubine|cr[ée]at(?:\s*U)?|HDL|TG|Gly|vitamine D|PSA|ECBU|sodium|calcium|magn[ée]sium|Mg|phosphore|phosphate|c[ée]tones?|glyc[ée]mie|fibrinog[èe]ne|lactates?|pH|D-?dim[èe]res?|h[ée]moculture|paludisme|LCR|albuminurie|prot[ée]inurie|Helicobacter|pylori|H\.?\s*pylori|Toxo(?:plasmose)?|S[ée]ro\s*Toxo|S[ée]roToxo|CMV|rub[ée]ole|Rubella|EBV|HSV|VZV|Parvovirus|IgG|IgM)\b/i.test(text);
  }

  function looksLikeBiologySummaryLine(text) {
    const markerPattern = /\b(?:LDL|non-HDL|TROPO|CRP|PCT|BNP|NT-proBNP|HG|Hb|ferr|VGM|TSH|T4L|B12|folates|LIPASE|DFG|HCG|K\+|Na|Ca\s*corr|PNN|Plaq|plaquettes|Leuco|leucocytes|Mono|INR|RAC|ASAT|ALAT|GGT|PAL|bilirubine|cr[ée]at(?:\s*U)?|HDL|TG|Gly|vitamine D|PSA|ECBU|sodium|calcium|magn[ée]sium|Mg|phosphore|phosphate|c[ée]tones?|glyc[ée]mie|fibrinog[èe]ne|lactates?|pH|D-?dim[èe]res?|h[ée]moculture|paludisme|LCR|albuminurie|prot[ée]inurie|Helicobacter|pylori|H\.?\s*pylori|Toxo(?:plasmose)?|S[ée]ro\s*Toxo|S[ée]roToxo|CMV|rub[ée]ole|Rubella|EBV|HSV|VZV|Parvovirus|IgG|IgM)\b/i;
    const istPattern = /\b(?:IST|VIH|syphilis|TPHA|VDRL|Chlamydia|gonocoque|Neisseria|Mycoplasma|hépatite|hepatite|Ag HBs|anti-HBs|anti-HBc|VHC)\b/i;
    const stoolBloodPattern = /\b(?:H[ée]mocc?ult|sang occulte|sang dans les selles|RSOS|FIT|test immunologique f[ée]cal|d[ée]pistage colorectal|test colorectal)\b/i;
    const microbiologyPattern = /\b(?:Helicobacter|pylori|H\.?\s*pylori|Toxo(?:plasmose)?|S[ée]ro\s*Toxo|S[ée]roToxo|CMV|rub[ée]ole|Rubella|EBV|HSV|VZV|Parvovirus|IgG|IgM|germe|culture|bact[ée]riurie|leucocyturie|h[ée]maturie|E\.\s*coli|Escherichia|Klebsiella|Proteus|Enterococcus|Pseudomonas|Staphylococcus|Streptococcus)\b/i;
    const hasValue = /(?:[<>]?\s*\d+(?:[,.]\d+)?|\bpositif\b|\bpositive\b|\bnégatif\b|\bnegative\b|\bdouteux\b|\blimite\b|\bindéterminé\b|\bnon interprétable\b|\babsence\b|\bprésence\b|\bpresence\b|\bdétect[ée]\b|\bdetecte\b|\bnon détect[ée]\b|\bnon detecte\b)/i.test(text);
    const hasUnitOrSignal = /(?:↑|↓|↗|↘|%|g\/L|mg\/L|mmol\/L|µmol\/L|umol\/L|U\/L|UI\/L|ng\/L|ng\/mL|µg\/L|ug\/L|mUI\/L|pmol\/L|G\/L|g\/dL|fL|UI\/L|mg\/mmol|\d+(?:[,.]\d+)?\s*N\b|hémolyse|hemolyse|coagulé|coagule|critique|urgent|à contrôler|a controler)/i.test(text);

    return Boolean(
      (markerPattern.test(text) && hasValue && hasUnitOrSignal) ||
      (istPattern.test(text) && hasValue) ||
      (stoolBloodPattern.test(text) && hasValue) ||
      (microbiologyPattern.test(text) && hasValue)
    );
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

  function normalizeLmStudioTitleOutput(value) {
    return sanitizeTitle(value)
      .replace(/\banticorps\b/gi, "Ac");
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
      debugSequence += 1;
      const entry = {
        seq: debugSequence,
        at: new Date().toISOString(),
        elapsedMs: typeof performance !== "undefined" && performance.now ? Math.round(performance.now()) : null,
        session: debugSessionId,
        page: isHeidiPage ? "heidi" : isWedaPage ? "weda" : location.hostname,
        event: eventName,
        env: getDebugEnvironment(),
        workflow: summarizeWorkflowState(GM_getValue(STATE_KEY, null)),
        data: sanitizeDebugData(data),
      };

      nextLogs.push(entry);
      GM_setValue(DEBUG_LOG_KEY, nextLogs.slice(-MAX_DEBUG_LOG_ENTRIES));
      renderDebugLogs();
    } catch (error) {
      try {
        console.warn("[WedaBioLmStudio] debug log failed", error);
      } catch (_nestedError) {
        // Rien d'autre à faire si la console est inaccessible.
      }
    }
  }

  function getDebugEnvironment() {
    return {
      version: getScriptVersion(),
      channelId: CURRENT_CHANNEL_ID || "",
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
    return /^(?:patient|nom|prenom|birth|naissance|identity|rowIdentity|title|titre|lastTitle|tableText|tableHtml|prompt|raw|answer)$/i.test(String(key || ""));
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

  function updateLmStudioStatus(jobId, message, extra = {}) {
    appendDebugLog("lmstudio:status", {
      jobId,
      channelId: CURRENT_CHANNEL_ID,
      message,
      ...extra,
    });

    setPanelStatus(message);
    GM_setValue(STATUS_KEY, {
      jobId,
      channelId: CURRENT_CHANNEL_ID,
      message,
      ...extra,
      createdAt: Date.now(),
    });
  }

  function updateHeidiStatus(jobId, message, extra = {}) {
    appendDebugLog("heidi:status", {
      jobId,
      channelId: CURRENT_CHANNEL_ID,
      message,
      ...extra,
    });

    GM_setValue(STATUS_KEY, {
      jobId,
      channelId: CURRENT_CHANNEL_ID,
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
        const result = condition();

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
            snapshot: getTroubleshootingSnapshot(),
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
