// ==UserScript==
// @name         WEDA - Coloriseur ATCD CIM-10 patient
// @namespace    http://tampermonkey.net/
// @version      1.4.4
// @description  Colore les antécédents CIM-10 du patient courant selon une priorité médicale, sans supprimer d'antécédents.
// @match        https://secure.weda.fr/*
// @all-frames   true
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.4.4';
    const HOST_WEDA = 'secure.weda.fr';
    const LOG_PREFIX = '[COLOR-ATCD-CIM10]';

    // Compatibilite volontaire avec le batch existant supp_atcd_non_cim10.
    const KEY_COMMAND = 'supp_atcd_non_cim10_patient_command_v1';
    const KEY_RESULT = 'supp_atcd_non_cim10_patient_result_v1';
    const KEY_LAST_REPORT = 'color_atcd_cim10_patient_last_report_v1';
    const KEY_LOG = 'color_atcd_cim10_patient_log_v1';
    const KEY_LAST_COMMAND_ID = 'color_atcd_cim10_patient_last_command_id_v1';

    const SELECTOR_ANTECEDENT_ROOT = '#ContentPlaceHolder1_UpdatePanelAntecedent';
    const SELECTOR_GOTO_ANTECEDENTS = '[onclick*="ButtonGotoAntecedent"], [href*="ButtonGotoAntecedent"], [id*="ButtonGotoAntecedent"], [name*="ButtonGotoAntecedent"]';
    const SELECTOR_WEDA_VALID = '#ContentPlaceHolder1_ButtonValid';
    const SELECTOR_WEDA_ANTECEDENT_PANEL = '#ContentPlaceHolder1_PanelModifyAntecedent';
    const SELECTOR_WEDA_COLOR_BUTTON_EXACT = '#ContentPlaceHolder1_PanelModifyAntecedent > table > tbody > tr:nth-child(2) > td:nth-child(2) > table > tbody > tr:nth-child(3) > td:nth-child(2) > table > tbody > tr > td:nth-child(5) > table > tbody > tr > td:nth-child(2) > img';
    const SELECTOR_WEDA_COLOR_GRID = '#ContentPlaceHolder1_LabelColorGrid';
    const SELECTOR_WEDA_COLOR_FIELD = '#ContentPlaceHolder1_TextBoxGlossaireCouleur';
    const SELECTOR_WEDA_COLOR_PREVIEW = '#ContentPlaceHolder1_divShowSelected';

    const MAX_COLOR_PASSES = 600;
    const CLEANUP_TIMEOUT_MS = 22 * 60 * 1000;
    const COMMAND_MAX_AGE_MS = 30 * 60 * 1000;
    const COMMAND_INIT_GRACE_MS = 15000;
    const MAX_LOG_ENTRIES = 600;
    const MAX_LOG_DETAILS_CHARS = 5000;

    const PANEL_ID = 'color-atcd-cim10-panel';
    const BADGE_ID = 'color-atcd-cim10-badge';
    const LOG_PANEL_ID = 'color-atcd-cim10-log-panel';

    const DEFAULT_CODED_PRIORITY = 'NO_COLOR';
    const STRICT_COLOR_APPLICATION = true;
    const STRICT_SELECTION_CONFIRMATION = true;
    const SCRIPT_STARTED_AT = Date.now();
const AUTO_ATCD_COLOR_KEYWORDS = {
    version: "2026-06-01-v3-mg-premier-recours",

    priorityOrder: [
        "PRIO_ROUGE",
        "PRIO_VIOLET",
        "PRIO_ORANGE",
        "PRIO_JAUNE",
        "NO_COLOR"
    ],

    colorConfig: {
        PRIO_ROUGE: {
            label: "Rouge",
            cssColor: "#D32F2F",
            wedaColorName: "ROUGE"
        },
        PRIO_VIOLET: {
            label: "Violet",
            cssColor: "#CC66FF",
            wedaColorName: "VIOLET"
        },
        PRIO_ORANGE: {
            label: "Orange",
            cssColor: "#F57C00",
            wedaColorName: "ORANGE"
        },
        PRIO_JAUNE: {
            label: "Jaune",
            cssColor: "#FBC02D",
            wedaColorName: "JAUNE"
        },
        NO_COLOR: {
            label: "Blanc / sans priorité",
            cssColor: "#FFFFFF",
            wedaColorName: "BLANC"
        }
    },

    /************************************************************
     * PRIO_ROUGE
     * Antécédents majeurs, graves, à risque vital ou fortement
     * structurants pour le pronostic.
     ************************************************************/
    PRIO_ROUGE: {
        label: "Grave / majeur / risque vital",
        terms: [
            /***********************
             * CANCER / HÉMATOLOGIE MALIGNE
             ***********************/
            "cancer",
            "neoplasie",
            "neoplasme",
            "tumeur maligne",
            "tumeur infiltrante",
            "tumeur invasive",
            "tumeur metastatique",
            "malignite",
            "carcinome",
            "adenocarcinome",
            "carcinome epidermoide",
            "carcinome basocellulaire metastatique",
            "carcinome spinocellulaire metastatique",
            "sarcome",
            "melanome malin",
            "melanome metastatique",
            "lymphome",
            "lymphome hodgkinien",
            "maladie de hodgkin",
            "lymphome non hodgkinien",
            "leucemie",
            "leucemie aigue",
            "leucemie chronique",
            "leucemie myeloide",
            "leucemie lymphoide",
            "myelome",
            "myelome multiple",
            "plasmocytome",
            "macroglobulinemie de waldenstrom",
            "glioblastome",
            "gliome malin",
            "astrocytome malin",
            "metastase",
            "metastases",
            "metastatique",
            "carcinose",
            "carcinose peritoneale",
            "recidive cancer",
            "cancer generalise",
            "chimiotherapie",
            "radiotherapie",
            "curietherapie",
            "immunotherapie anticancereuse",
            "hormonotherapie anticancereuse",
            "soins palliatifs cancer",
            "cancer colorectal",
            "cancer colon",
            "cancer rectum",
            "cancer sein",
            "cancer prostate",
            "cancer poumon",
            "cancer bronchique",
            "cancer pancreas",
            "cancer foie",
            "carcinome hepatocellulaire",
            "cancer estomac",
            "cancer oesophage",
            "cancer rein",
            "cancer vessie",
            "cancer ovaire",
            "cancer uterus",
            "cancer endometre",
            "cancer col uterin",
            "cancer vulve",
            "cancer testicule",
            "cancer thyroide",
            "cancer orl",
            "cancer larynx",
            "cancer pharynx",
            "cancer cavum",
            "cancer langue",
            "cancer peau",
            "tumeur cerebrale",
            "tumeur cerveau",
            "tumeur maligne cerebrale",
            "myelodysplasie",
            "syndrome myelodysplasique",
            "polyglobulie de vaquez",
            "thrombocytemie essentielle",
            "syndrome myeloproliferatif",

            /***********************
             * CARDIOVASCULAIRE GRAVE
             ***********************/
            "infarctus",
            "infarctus du myocarde",
            "syndrome coronarien aigu",
            "angor instable",
            "angine de poitrine instable",
            "crise cardiaque",
            "attaque cardiaque",
            "cardiopathie ischemique severe",
            "coronaropathie severe",
            "tronc commun coronaire",
            "occlusion coronaire",
            "angioplastie coronaire recente",
            "stent coronaire recent",
            "pontage coronarien",
            "pontage aorto coronarien",
            "triple pontage",
            "arret cardiaque",
            "mort subite recuperee",
            "mort subite ressuscitee",
            "reanimation cardiaque",
            "choc cardiogenique",
            "insuffisance cardiaque",
            "insuffisance cardiaque severe",
            "insuffisance cardiaque systolique",
            "insuffisance cardiaque avec fevg alteree",
            "decompensation cardiaque",
            "oap",
            "oedeme aigu pulmonaire",
            "cardiomyopathie",
            "cardiomyopathie dilatee",
            "cardiomyopathie hypertrophique",
            "cardiomyopathie restrictive",
            "cardiomyopathie arythmogene",
            "cardiopathie dilatee",
            "fevg alteree",
            "fevg basse",
            "fevg inferieure a 40",
            "fevg < 40",
            "valvulopathie severe",
            "retrecissement aortique serre",
            "stenose aortique serree",
            "insuffisance mitrale severe",
            "insuffisance aortique severe",
            "insuffisance tricuspide severe",
            "dissection aortique",
            "dissection de l aorte",
            "anevrisme aorte",
            "anevrisme aortique",
            "anevrysme aortique",
            "anevrisme abdominal volumineux",
            "anevrisme thoracique",
            "rupture anevrisme",
            "aorte operee",
            "endocardite",
            "endocardite infectieuse",
            "myocardite severe",
            "pericardite constrictive",
            "tamponnade",
            "hypertension pulmonaire severe",
            "htap severe",
            "arythmie ventriculaire severe",
            "tachycardie ventriculaire",
            "fibrillation ventriculaire",
            "torsade de pointe",
            "qt long symptomatique",

            /***********************
             * AVC / NEUROVASCULAIRE = ROUGE
             ***********************/
            "avc",
            "accident vasculaire cerebral",
            "accident cerebral",
            "accident neurologique vasculaire",
            "ait",
            "accident ischemique transitoire",
            "accident ischemique cerebral transitoire",
            "ischemie cerebrale",
            "ischemie transitoire",
            "infarctus cerebral",
            "infarctus cerebelleux",
            "infarctus lacunaire",
            "lacune cerebrale symptomatique",
            "avc ischemique",
            "avc hemorragique",
            "hemorragie cerebrale",
            "hemorragie intracerebrale",
            "hemorragie intracranienne",
            "hemorragie meningee",
            "hemorragie sous arachnoidienne",
            "anevrisme cerebral rompu",
            "rupture anevrisme cerebral",
            "attaque cerebrale",
            "attaque neurologique",
            "petit avc",
            "mini avc",
            "caillot au cerveau",
            "thrombose arterielle cerebrale",
            "thrombose veineuse cerebrale",
            "thrombose sinus veineux cerebral",
            "dissection carotidienne avec avc",
            "dissection vertebrale avec avc",
            "stenose carotidienne symptomatique",
            "sequelles avc",
            "sequelles d avc",
            "avc sequellaire",
            "hemiplegie post avc",
            "hemiparesie post avc",
            "aphasie post avc",
            "dysarthrie post avc",
            "troubles cognitifs post avc",
            "trouble de deglutition post avc",
            "thrombectomie",
            "trombolyse",
            "trombolyse avc",

            /***********************
             * NEUROLOGIE GRAVE
             ***********************/
            "epilepsie severe",
            "etat de mal epileptique",
            "convulsions severes",
            "sla",
            "sclerose laterale amyotrophique",
            "maladie du motoneurone",
            "myasthenie",
            "myasthenie grave",
            "myopathie severe",
            "dystrophie musculaire",
            "paraplegie",
            "tetraplegie",
            "quadriplegie",
            "traumatisme cranien grave",
            "tc grave",
            "hematome sous dural",
            "hematome extradural",
            "hematome intracranien",
            "demence severe",
            "alzheimer severe",
            "maladie d alzheimer severe",
            "demence a corps de lewy severe",
            "demence frontotemporale severe",
            "hydrocephalie",
            "coma",
            "encephalopathie severe",

            /***********************
             * THROMBOEMBOLIQUE GRAVE
             * TVP/phlébite seules = ORANGE, pas rouge.
             ***********************/
            "embolie pulmonaire",
            "ep massive",
            "ep bilaterale",
            "embolie pulmonaire massive",
            "embolie pulmonaire bilaterale",
            "embolie pulmonaire grave",
            "embolie pulmonaire avec choc",
            "caillot dans le poumon",
            "hypertension pulmonaire post embolique",
            "coeur pulmonaire chronique post embolique",
            "thrombophilie majeure",
            "syndrome des antiphospholipides",
            "sapl",
            "deficit proteine c",
            "deficit proteine s",
            "deficit antithrombine",
            "facteur v leiden homozygote",
            "mutation facteur v leiden homozygote",

            /***********************
             * RESPIRATOIRE GRAVE
             ***********************/
            "insuffisance respiratoire chronique",
            "irc respiratoire",
            "oxygenotherapie",
            "oxygene a domicile",
            "old",
            "vni",
            "ventilation non invasive",
            "tracheotomie",
            "canule tracheale",
            "bpco severe",
            "emphyseme severe",
            "fibrose pulmonaire",
            "fibrose pulmonaire idiopathique",
            "pneumopathie interstitielle diffuse",
            "pid severe",
            "mucoviscidose",
            "asthme severe",
            "asthme aigu grave",
            "pneumonectomie",
            "lobectomie pulmonaire pour cancer",
            "insuffisance respiratoire restrictive severe",
            "silicose severe",
            "asbestose severe",

            /***********************
             * RÉNAL / UROLOGIQUE GRAVE
             ***********************/
            "insuffisance renale chronique severe",
            "irc severe",
            "irc stade 4",
            "irc stade 5",
            "maladie renale chronique stade 4",
            "maladie renale chronique stade 5",
            "dialyse",
            "hemodialyse",
            "dialyse peritoneale",
            "rein artificiel",
            "greffe renale",
            "transplantation renale",
            "greffe du rein",
            "nephrectomie bilaterale",
            "rein unique avec insuffisance renale",
            "syndrome nephrotique severe",
            "glomerulonephrite rapidement progressive",
            "nephropathie severe",
            "polykystose renale severe",
            "cancer rein",
            "cancer vessie infiltrant",
            "cancer vessie invasif",

            /***********************
             * HÉPATO-DIGESTIF GRAVE
             ***********************/
            "cirrhose",
            "cirrhose alcoolique",
            "cirrhose biliaire",
            "cirrhose decompensee",
            "ascite",
            "varices oesophagiennes",
            "rupture de varices oesophagiennes",
            "encephalopathie hepatique",
            "insuffisance hepatique",
            "hepatite fulminante",
            "hypertension portale",
            "greffe foie",
            "greffe du foie",
            "transplantation hepatique",
            "pancreatite chronique severe",
            "pancreatite aigue grave",
            "necrose pancreatique",
            "crohn severe",
            "maladie de crohn severe",
            "rch severe",
            "rectocolite hemorragique severe",
            "colectomie totale",
            "stomie digestive definitive",
            "ileostomie definitive",
            "colostomie definitive",
            "syndrome de grele court",
            "ischemie mesenterique",
            "infarctus mesenterique",

            /***********************
             * INFECTIEUX / IMMUNITAIRE GRAVE
             ***********************/
            "vih",
            "sida",
            "infection vih",
            "tuberculose active",
            "bk actif",
            "septicemie",
            "sepsis severe",
            "choc septique",
            "meningite bacterienne",
            "meningite pneumocoque",
            "meningite meningocoque",
            "encephalite",
            "osteite chronique",
            "osteomyelite chronique",
            "infection osteoarticulaire chronique",
            "prothese infectee",
            "infection prothese",
            "immunodepression severe",
            "deficit immunitaire severe",
            "deficit immunitaire primitif",
            "asplenie",
            "splenectomie",
            "rate enlevee",
            "plus de rate",
            "drepanocytose majeure",
            "drepanocytose homozygote",
            "paludisme grave",

            /***********************
             * ENDOCRINO-MÉTABOLIQUE GRAVE
             ***********************/
            "diabete complique",
            "diabete avec nephropathie",
            "diabete avec retinopathie",
            "diabete avec neuropathie",
            "diabete avec arteriopathie",
            "diabete avec pied diabetique",
            "pied diabetique",
            "mal perforant plantaire",
            "amputation diabetique",
            "acidocetose diabetique",
            "coma diabetique",
            "hypoglycemies severes",
            "diabete type 1 complique",
            "insuffisance surrenalienne",
            "maladie d addison",
            "crise addisonienne",
            "thyrotoxicose",
            "hyperthyroidie severe",
            "pheochromocytome",
            "obesite morbide avec complications",
            "syndrome de cushing severe",

            /***********************
             * PSYCHIATRIE / ADDICTOLOGIE GRAVE
             ***********************/
            "tentative de suicide",
            "atcd ts",
            "antecedent ts",
            "suicide",
            "idees suicidaires severes",
            "hospitalisation psychiatrie",
            "hospitalisation sous contrainte",
            "schizophrenie",
            "trouble schizoaffectif",
            "psychose chronique",
            "bouffee delirante",
            "delire chronique",
            "hallucinations chroniques",
            "trouble bipolaire",
            "melancolie",
            "depression severe",
            "depression melancolique",
            "anorexie mentale severe",
            "trouble alimentaire severe",
            "alcoolisme severe",
            "alcoolodependance severe",
            "delirium tremens",
            "sevrage alcool complique",
            "toxicomanie severe",
            "overdose",

            /***********************
             * OBSTÉTRIQUE GRAVE
             ***********************/
            "preeclampsie severe",
            "eclampsie",
            "hellp syndrome",
            "hemorragie de la delivrance severe",
            "mort foetale in utero",
            "mfiu",
            "embolie amniotique",
            "rupture uterine",
            "grossesse extra uterine rompue",
            "geu rompue"
        ],

        exactWords: [
            "avc",
            "ait",
            "idm",
            "sca",
            "chc",
            "lam",
            "llc",
            "lmc",
            "lnh",
            "oap",
            "htap",
            "sla",
            "sapl"
        ],

        cim10Regex: [
            "\\bC[0-9]{2}(?:\\.[0-9A-Z]+)?\\b",
            "\\bD0[0-9](?:\\.[0-9A-Z]+)?\\b",
            "\\bI21(?:\\.[0-9A-Z]+)?\\b",
            "\\bI22(?:\\.[0-9A-Z]+)?\\b",
            "\\bI26(?:\\.[0-9A-Z]+)?\\b",
            "\\bI46(?:\\.[0-9A-Z]+)?\\b",
            "\\bI50(?:\\.[0-9A-Z]+)?\\b",
            "\\bI6[0-9](?:\\.[0-9A-Z]+)?\\b",
            "\\bG45(?:\\.[0-9A-Z]+)?\\b",
            "\\bI71(?:\\.[0-9A-Z]+)?\\b",
            "\\bN18\\.4\\b",
            "\\bN18\\.5\\b",
            "\\bN18\\.6\\b",
            "\\bB20(?:\\.[0-9A-Z]+)?\\b",
            "\\bB21(?:\\.[0-9A-Z]+)?\\b",
            "\\bB22(?:\\.[0-9A-Z]+)?\\b",
            "\\bB23(?:\\.[0-9A-Z]+)?\\b",
            "\\bB24\\b",
            "\\bK72(?:\\.[0-9A-Z]+)?\\b",
            "\\bK74(?:\\.[0-9A-Z]+)?\\b",
            "\\bF20(?:\\.[0-9A-Z]+)?\\b",
            "\\bF31(?:\\.[0-9A-Z]+)?\\b",
            "\\bX6[0-9](?:\\.[0-9A-Z]+)?\\b",
            "\\bX7[0-9](?:\\.[0-9A-Z]+)?\\b",
            "\\bX80(?:\\.[0-9A-Z]+)?\\b",
            "\\bX81(?:\\.[0-9A-Z]+)?\\b",
            "\\bX82(?:\\.[0-9A-Z]+)?\\b",
            "\\bX83(?:\\.[0-9A-Z]+)?\\b",
            "\\bX84(?:\\.[0-9A-Z]+)?\\b"
        ]
    },

    /************************************************************
     * PRIO_VIOLET
     * Vigilance pratique immédiate : prescription, geste, anesthésie,
     * terrain, matériel, iatrogénie.
     ************************************************************/
    PRIO_VIOLET: {
        label: "Vigilance pratique immédiate",
        terms: [
            /***********************
             * ALLERGIES GRAVES OU UTILES À LA PRESCRIPTION
             ***********************/
            "allergie penicilline",
            "allergie amoxicilline",
            "allergie augmentin",
            "allergie beta lactamine",
            "allergie betalactamine",
            "allergie cephalosporine",
            "allergie ceftriaxone",
            "allergie cefixime",
            "allergie cefpodoxime",
            "allergie cefotaxime",
            "allergie cefuroxime",
            "allergie macrolide",
            "allergie azithromycine",
            "allergie clarithromycine",
            "allergie pristinamycine",
            "allergie quinolone",
            "allergie fluoroquinolone",
            "allergie ciprofloxacine",
            "allergie levofloxacine",
            "allergie ofloxacine",
            "allergie ains",
            "allergie anti inflammatoire",
            "allergie aspirine",
            "allergie ibuprofene",
            "allergie ketoprofene",
            "allergie naproxene",
            "allergie diclofenac",
            "allergie iode",
            "allergie produit de contraste",
            "allergie contraste",
            "allergie gadolinium",
            "allergie morphine",
            "allergie codeine",
            "allergie tramadol",
            "allergie oxycodone",
            "allergie sulfamide",
            "allergie sulfonamide",
            "allergie latex",
            "allergie anesthesique",
            "allergie anesthesie",
            "allergie curare",
            "allergie vaccinale",
            "allergie alimentaire severe",
            "allergie arachide",
            "allergie fruits a coque",
            "allergie medicamenteuse",
            "anaphylaxie",
            "choc anaphylactique",
            "oedeme de quincke",
            "angioedeme",
            "urticaire geante",
            "toxidermie",
            "syndrome de lyell",
            "stevens johnson",
            "syndrome stevens johnson",
            "dress syndrome",
            "allergie grave",
            "a failli mourir avec",
            "gonfle avec",
            "etouffe avec",

            /***********************
             * ANTICOAGULANTS / ANTIAGRÉGANTS / HÉMORRAGIE
             ***********************/
            "anticoagulant",
            "anticoagulation",
            "anticoagulation au long cours",
            "avk",
            "warfarine",
            "coumadine",
            "fluindione",
            "previscan",
            "acenocoumarol",
            "sintrom",
            "aod",
            "naco",
            "rivaroxaban",
            "xarelto",
            "apixaban",
            "eliquis",
            "dabigatran",
            "pradaxa",
            "edoxaban",
            "lixiana",
            "heparine au long cours",
            "fondaparinux",
            "antiagregant",
            "anti agregant",
            "clopidogrel",
            "plavix",
            "prasugrel",
            "efient",
            "ticagrelor",
            "brilique",
            "double antiagregation",
            "double anti agregation",
            "dapt",
            "hemophilie",
            "maladie de willebrand",
            "thrombopenie severe",
            "purpura thrombopenique",
            "trouble coagulation",
            "coagulopathie",
            "saigne facilement",
            "sang trop liquide",
            "fluidifiant du sang",
            "hemorragie sous anticoagulant",
            "hemorragie digestive sous anticoagulant",

            /***********************
             * DISPOSITIFS / MATÉRIEL CRITIQUE
             ***********************/
            "pacemaker",
            "pace maker",
            "stimulateur cardiaque",
            "pile cardiaque",
            "boitier cardiaque",
            "defibrillateur implantable",
            "dai",
            "resynchronisation cardiaque",
            "crt",
            "valve mecanique",
            "valve cardiaque mecanique",
            "valve aortique mecanique",
            "valve mitrale mecanique",
            "prothese valvulaire",
            "valve biologique",
            "stent coronaire",
            "chambre implantable",
            "port a cath",
            "port-a-cath",
            "pac chimiotherapie",
            "picc line",
            "catheter central",
            "cath central",
            "neurostimulateur",
            "pompe intrathecale",
            "pompe a insuline",
            "implant cochleaire",
            "valve de derivation",
            "derivation ventriculo peritoneale",
            "dvp",
            "shunt",
            "materiel osteosynthese infecte",
            "prothese articulaire infectee",
            "sonde double j",
            "sonde jj",
            "filtre cave",

            /***********************
             * GROSSESSE / ALLAITEMENT / PMA
             ***********************/
            "grossesse",
            "enceinte",
            "femme enceinte",
            "attend un bebe",
            "bebe en route",
            "allaitement",
            "allaite",
            "fiv",
            "pma",
            "stimulation ovarienne",
            "grossesse a risque",

            /***********************
             * IMMUNODÉPRESSION / TRAITEMENTS À RISQUE
             ***********************/
            "immunodeprime",
            "immunodepression",
            "immunosuppression",
            "immunosuppresseur",
            "immunodepresseur",
            "corticoides au long cours",
            "corticotherapie prolongee",
            "prednisone au long cours",
            "biotherapie",
            "anti tnf",
            "anti-tnf",
            "adalimumab",
            "humira",
            "infliximab",
            "remicade",
            "etanercept",
            "enbrel",
            "golimumab",
            "simponi",
            "certolizumab",
            "cimzia",
            "tocilizumab",
            "roactemra",
            "rituximab",
            "mabthera",
            "secukinumab",
            "cosentyx",
            "ustekinumab",
            "stelara",
            "ixekizumab",
            "taltz",
            "dupilumab",
            "dupixent",
            "omalizumab",
            "xolair",
            "methotrexate",
            "azathioprine",
            "imurel",
            "mycophenolate",
            "cellcept",
            "ciclosporine",
            "cyclosporine",
            "tacrolimus",
            "everolimus",
            "sirolimus",
            "chimiotherapie en cours",
            "traitement immunosuppresseur",
            "traitement immunodepresseur",
            "jaki",
            "anti jak",
            "baricitinib",
            "tofacitinib",
            "upadacitinib",

            /***********************
             * ADAPTATION POSOLOGIQUE / TERRAIN FRAGILE
             ***********************/
            "dfg inferieur a 30",
            "dfg < 30",
            "clairance inferieure a 30",
            "clairance < 30",
            "clairance basse",
            "insuffisance renale avec adaptation",
            "insuffisance hepatique avec adaptation",
            "cirrhose avec adaptation",
            "personne agee fragile",
            "fragilite geriatrique",
            "denutrition severe",
            "chutes repetees",
            "risque de chute eleve",

            /***********************
             * ANESTHÉSIE / ACTES / TRANSFUSION
             ***********************/
            "intubation difficile",
            "allergie anesthesie",
            "allergie anesthesique",
            "complication anesthesique",
            "hyperthermie maligne",
            "nvpo severe",
            "nausees vomissements post operatoires severes",
            "refus transfusion",
            "temoin de jehovah",
            "risque hemorragique",
            "difficulte intubation",
            "voie aerienne difficile",

            /***********************
             * STOMIES / SOINS TECHNIQUES
             ***********************/
            "stomie",
            "colostomie",
            "ileostomie",
            "urostomie",
            "poche digestive",
            "poche a selles",
            "sonde urinaire a demeure",
            "sad",
            "cystostomie",
            "nephrostomie",
            "gastrostomie",
            "gpe",
            "jejunostomie",
            "tracheotomie",
            "oxygenotherapie",
            "vni",
            "ppc",
            "cpap",
            "dialyse",
            "nutrition enterale",
            "nutrition parenterale",
            "picc line",
            "chambre implantable"
        ],

        exactWords: [
            "avk",
            "aod",
            "naco",
            "dai",
            "crt",
            "dvp",
            "sad",
            "gpe",
            "vni",
            "ppc",
            "cpap",
            "jaki"
        ],

        cim10Regex: [
            "\\bT78\\.2\\b",
            "\\bT78\\.3\\b",
            "\\bZ88(?:\\.[0-9A-Z]+)?\\b",
            "\\bZ91\\.0\\b",
            "\\bZ95(?:\\.[0-9A-Z]+)?\\b",
            "\\bZ93(?:\\.[0-9A-Z]+)?\\b",
            "\\bZ94(?:\\.[0-9A-Z]+)?\\b",
            "\\bZ99(?:\\.[0-9A-Z]+)?\\b"
        ]
    },

    /************************************************************
     * PRIO_ORANGE
     * Pathologies chroniques importantes, structurantes ou qui
     * modifient régulièrement le suivi MG.
     ************************************************************/
    PRIO_ORANGE: {
        label: "Chronique important / structurant",
        terms: [
            /***********************
             * CARDIO-VASCULAIRE COURANT STRUCTURANT
             ***********************/
            "hta",
            "hypertension arterielle",
            "hypertension",
            "tension arterielle",
            "pa elevee",
            "dyslipidemie",
            "hypercholesterolemie",
            "hypertriglyceridemie",
            "cholesterol",
            "triglycerides",
            "cardiopathie",
            "cardiopathie ischemique stable",
            "coronaropathie stable",
            "angor stable",
            "angine de poitrine stable",
            "stent coronaire ancien",
            "angioplastie coronaire ancienne",
            "fibrillation atriale",
            "flutter",
            "trouble du rythme",
            "arythmie",
            "coeur irregulier",
            "tachycardie supraventriculaire",
            "bav",
            "bloc auriculo ventriculaire",
            "bloc de branche",
            "bloc de branche gauche",
            "bloc de branche droit",
            "extrasystoles frequentes",
            "arteriopathie",
            "aomi",
            "arteriopathie obliterante",
            "claudication intermittente",
            "stenose carotidienne",
            "anevrisme non complique",
            "insuffisance veineuse severe",
            "ulcere veineux",
            "maladie variqueuse severe",
            "lymphoedeme chronique",

            /***********************
             * TVP / PHLÉBITE = ORANGE
             ***********************/
            "phlebite",
            "phlebite ancienne",
            "phlebite membre inferieur",
            "phlebite jambe",
            "phlebite mollet",
            "phlebite femorale",
            "phlebite poplitee",
            "phlebite superficielle",
            "thrombose veineuse",
            "thrombose veineuse profonde",
            "tvp",
            "tvp ancienne",
            "tvp membre inferieur",
            "tvp jambe",
            "tvp mollet",
            "tvp femorale",
            "tvp poplitee",
            "maladie thromboembolique veineuse",
            "mtev",
            "caillot dans la jambe",
            "caillot veineux",
            "thrombose surale",
            "thrombose femorale",
            "thrombose poplitee",
            "thrombose iliaque",
            "thrombose porte",
            "thrombose veineuse porte",

            /***********************
             * DIABÈTE / MÉTABOLIQUE
             ***********************/
            "diabete",
            "diabete type 1",
            "diabete type 2",
            "diabete insulinodependant",
            "diabete non insulinodependant",
            "insuline",
            "prediabete",
            "intolerance au glucose",
            "syndrome metabolique",
            "obesite",
            "obesite morbide",
            "surpoids important",
            "goutte",
            "hyperuricemie",
            "acide urique",
            "steatose hepatique metabolique",
            "nash",
            "foie gras",
            "hyperferritinemie metabolique",

            /***********************
             * RESPIRATOIRE CHRONIQUE
             ***********************/
            "asthme",
            "asthme persistant",
            "bpco",
            "bronchopneumopathie chronique obstructive",
            "emphyseme",
            "bronchite chronique",
            "bronches fragiles",
            "ddb",
            "dilatation des bronches",
            "bronchectasies",
            "apnee du sommeil",
            "apnees du sommeil",
            "sas",
            "saos",
            "rhinite allergique severe",
            "pneumopathie interstitielle",
            "fibrose debutante",
            "sarcoidose pulmonaire",

            /***********************
             * RHUMATO / INFLAMMATOIRE / OSTÉO-ARTICULAIRE
             ***********************/
            "polyarthrite rhumatoide",
            "polyarthrite",
            "spondylarthrite",
            "spondyloarthrite",
            "rhumatisme psoriasique",
            "psoriasis articulaire",
            "rhumatisme inflammatoire",
            "lupus",
            "lupus erythemateux dissemine",
            "sclerodermie",
            "connectivite",
            "syndrome de sjogren",
            "gougerot sjogren",
            "vascularite",
            "granulomatose avec polyangeite",
            "maladie de behcet",
            "pseudopolyarthrite rhizomelique",
            "maladie de horton",
            "arterite temporale",
            "fibromyalgie",
            "osteoporose",
            "fracture osteoporotique",
            "tassement vertebral",
            "arthrose severe",
            "coxarthrose",
            "gonarthrose",
            "canal lombaire etroit",
            "hernie discale operee",
            "sciatique chronique invalidante",
            "polyarthrose invalidante",

            /***********************
             * DIGESTIF / HÉPATOLOGIE CHRONIQUE
             ***********************/
            "maladie de crohn",
            "crohn",
            "rectocolite hemorragique",
            "rch",
            "mici",
            "maladie coeliaque",
            "coeliaque",
            "pancreatite chronique",
            "hepatite b chronique",
            "hepatite c chronique",
            "hepatopathie chronique",
            "steatose hepatique",
            "rgo severe",
            "reflux gastro oesophagien severe",
            "oesophagite severe",
            "barrett",
            "endobrachyoesophage",
            "ulcere gastrique recidivant",
            "ulcere duodenal recidivant",
            "diverticulose compliquee",
            "colite chronique",
            "maladie diverticulaire compliquee",

            /***********************
             * ENDOCRINO
             ***********************/
            "hypothyroidie",
            "hyperthyroidie",
            "basedow",
            "hashimoto",
            "thyroidite",
            "nodule thyroidien surveille",
            "goitre",
            "hyperparathyroidie",
            "hypoparathyroidie",
            "adenome hypophysaire",
            "prolactinome",
            "acromegalie",
            "diabete insipide",
            "sopk",
            "syndrome des ovaires polykystiques",

            /***********************
             * NÉPHRO-UROLOGIE CHRONIQUE
             ***********************/
            "insuffisance renale chronique",
            "maladie renale chronique",
            "albuminurie",
            "proteinurie",
            "nephropathie",
            "rein unique",
            "lithiase renale recidivante",
            "colique nephretique recidivante",
            "calculs renaux recidivants",
            "hypertrophie benigne prostate severe",
            "adenome prostate severe",
            "retention urinaire",
            "incontinence urinaire severe",
            "vessie neurologique",
            "infections urinaires recidivantes",
            "cystites recidivantes",
            "pyelonephrite recidivante",
            "reflux vesico ureteral",
            "stenose uretrale",

            /***********************
             * NEUROLOGIE CHRONIQUE
             ***********************/
            "epilepsie",
            "migraine severe",
            "migraine chronique",
            "cephalees chroniques",
            "maladie de parkinson",
            "parkinson",
            "tremblement essentiel",
            "sclerose en plaques",
            "neuropathie peripherique",
            "polynevrite",
            "neuropathie diabetique",
            "nevralgie trijumeau",
            "algie vasculaire de la face",
            "syndrome jambes sans repos severe",
            "trouble cognitif leger",
            "neuropathie alcoolique",
            "nevralgie post zostérienne",
            "nevralgie post zosterienne",

            /***********************
             * PSYCHIATRIE FRÉQUENTE
             ***********************/
            "depression",
            "episode depressif",
            "depression recurrente",
            "syndrome depressif",
            "trouble anxieux",
            "anxiete generalisee",
            "attaque de panique",
            "trouble panique",
            "toc",
            "trouble obsessionnel compulsif",
            "tdah",
            "trouble du spectre autistique",
            "autisme",
            "trouble bipolaire stabilise",
            "burn out",
            "alcoolodependance",
            "addiction alcool",
            "sevrage alcool",
            "tabagisme actif important",
            "cannabis quotidien",
            "toxicomanie ancienne",
            "trouble du comportement alimentaire",
            "boulimie",
            "hyperphagie boulimique",

            /***********************
             * GYNÉCO / OBSTÉTRIQUE STRUCTURANTE
             ***********************/
            "endometriose",
            "adenomyose",
            "fibrome symptomatique",
            "fibrome uterin symptomatique",
            "kyste ovarien recidivant",
            "menopause precoce",
            "antecedent preeclampsie",
            "diabete gestationnel",
            "cesariennes multiples",
            "fausses couches repetees",
            "fcs repetees",
            "infertilite",
            "sterilite",

            /***********************
             * CHIRURGIES MAJEURES / ANATOMIE MODIFIÉE
             ***********************/
            "prothese totale hanche",
            "prothese totale genou",
            "arthrodese",
            "laminectomie",
            "chirurgie rachis",
            "colectomie",
            "gastrectomie",
            "bypass gastrique",
            "sleeve",
            "chirurgie bariatrique",
            "hysterectomie",
            "prostatectomie",
            "nephrectomie",
            "thyroidectomie totale",
            "mastectomie",
            "lobectomie pulmonaire",
            "amputation",
            "splenectomie",
            "pancreatectomie",
            "oesophagectomie"
        ],

        exactWords: [
            "hta",
            "fa",
            "bav",
            "aomi",
            "tvp",
            "mtev",
            "dt1",
            "dt2",
            "bpco",
            "ddb",
            "sas",
            "saos",
            "pr",
            "spa",
            "ppr",
            "rch",
            "mici",
            "nash",
            "irc",
            "mrc",
            "sep",
            "toc",
            "tdah",
            "sopk"
        ],

        cim10Regex: [
            "\\bI10(?:\\.[0-9A-Z]+)?\\b",
            "\\bI11(?:\\.[0-9A-Z]+)?\\b",
            "\\bI12(?:\\.[0-9A-Z]+)?\\b",
            "\\bI13(?:\\.[0-9A-Z]+)?\\b",
            "\\bI15(?:\\.[0-9A-Z]+)?\\b",
            "\\bI48(?:\\.[0-9A-Z]+)?\\b",
            "\\bI80(?:\\.[0-9A-Z]+)?\\b",
            "\\bI82(?:\\.[0-9A-Z]+)?\\b",
            "\\bE1[0-4](?:\\.[0-9A-Z]+)?\\b",
            "\\bE66(?:\\.[0-9A-Z]+)?\\b",
            "\\bE78(?:\\.[0-9A-Z]+)?\\b",
            "\\bJ44(?:\\.[0-9A-Z]+)?\\b",
            "\\bJ45(?:\\.[0-9A-Z]+)?\\b",
            "\\bG20(?:\\.[0-9A-Z]+)?\\b",
            "\\bG35(?:\\.[0-9A-Z]+)?\\b",
            "\\bG40(?:\\.[0-9A-Z]+)?\\b",
            "\\bK50(?:\\.[0-9A-Z]+)?\\b",
            "\\bK51(?:\\.[0-9A-Z]+)?\\b",
            "\\bM05(?:\\.[0-9A-Z]+)?\\b",
            "\\bM06(?:\\.[0-9A-Z]+)?\\b",
            "\\bM45(?:\\.[0-9A-Z]+)?\\b",
            "\\bF32(?:\\.[0-9A-Z]+)?\\b",
            "\\bF33(?:\\.[0-9A-Z]+)?\\b",
            "\\bF41(?:\\.[0-9A-Z]+)?\\b"
        ]
    },

    /************************************************************
     * PRIO_JAUNE
     * Utile au suivi ou à la prise en charge future, sans être
     * un antécédent majeur.
     ************************************************************/
    PRIO_JAUNE: {
        label: "Utile au suivi / contexte médical pertinent",
        terms: [
            /***********************
             * FACTEURS DE RISQUE / PRÉVENTION
             ***********************/
            "tabac ancien",
            "ancien fumeur",
            "sevrage tabagique",
            "tabagisme sevre",
            "alcool sevre",
            "alcool ancien",
            "sedentarite",
            "surpoids",
            "antecedent familial cardiovasculaire",
            "antecedent familial cancer",
            "antecedent familial diabete",
            "antecedent familial hta",
            "terrain familial cardiovasculaire",
            "terrain familial cancer",
            "mort subite familiale",
            "brca",
            "brca1",
            "brca2",
            "syndrome de lynch",
            "lynch",
            "polypose familiale",
            "polypose adenomateuse familiale",
            "hemochromatose familiale",

            /***********************
             * GYNÉCO UTILE AU SUIVI
             ***********************/
            "conisation",
            "dysplasie col uterin",
            "cin 1",
            "cin 2",
            "cin 3",
            "hpv",
            "papillomavirus",
            "frottis anormal",
            "fcv anormal",
            "diu",
            "sterilet",
            "implant contraceptif",
            "menopause precoce",
            "antecedent geu",
            "grossesse extra uterine",
            "fausse couche repetee",
            "fcs repetee",
            "endometriose legere mais symptomatique",

            /***********************
             * UROLOGIE / NÉPHRO UTILE MAIS NON SÉVÈRE
             ***********************/
            "hypertrophie benigne prostate",
            "adenome prostate",
            "hbp simple",
            "calcul renal",
            "calculs renaux",
            "colique nephretique",
            "lithiase renale",
            "rein unique sans insuffisance renale",
            "infection urinaire recidivante simple",
            "cystites a repetition",
            "incontinence urinaire moderee",
            "prostatite chronique",

            /***********************
             * DIGESTIF UTILE
             ***********************/
            "rgo chronique",
            "reflux chronique",
            "hernie hiatale symptomatique",
            "colon irritable severe",
            "intestin irritable severe",
            "constipation chronique",
            "hemorroides recidivantes",
            "fissure anale chronique",
            "lithiase biliaire symptomatique",
            "diverticulose connue",
            "polype colique",
            "adenome colique",
            "antecedent polype colique",

            /***********************
             * OPHTALMO / ORL UTILE
             ***********************/
            "glaucome",
            "dmla",
            "retinopathie",
            "myopie forte",
            "surdite appareillee",
            "surdité appareillee",
            "implant cochleaire",
            "vertiges recidivants",
            "vppb recidivant",
            "acouphenes invalidants",
            "apnee du sommeil non appareillee",
            "polypose nasosinusienne",

            /***********************
             * DERMATO UTILE
             ***********************/
            "psoriasis",
            "eczema chronique",
            "urticaire chronique",
            "rosacee",
            "hidrosadenite",
            "maladie de verneuil",
            "naevus atypique",
            "nevus atypique",
            "keratose actinique",
            "carcinome basocellulaire",
            "carcinome spinocellulaire",
            "melanome in situ",

            /***********************
             * INFECTIEUX UTILE
             ***********************/
            "zona ophtalmique",
            "zona recidivant",
            "herpes recidivant",
            "ist recidivante",
            "chlamydia recidivant",
            "gonocoque recidivant",
            "syphilis traitee",
            "tuberculose ancienne traitee",
            "hepatite a ancienne",
            "hepatite b guerie",
            "hepatite c guerie",
            "infection hpv",
            "condylomes recidivants",

            /***********************
             * TRAUMATOLOGIE UTILE
             ***********************/
            "fracture col femur",
            "fracture vertebrale",
            "fracture tassement vertebral",
            "fracture de fragilite",
            "fracture basse energie",
            "fractures repetees",
            "rupture ligament croise",
            "ligament croise opere",
            "lca opere",
            "meniscectomie",
            "luxation recidivante",
            "entorses recidivantes",
            "rupture coiffe rotateurs",
            "prothese epaule",
            "prothese cheville",

            /***********************
             * CHIRURGIE NON MAJEURE MAIS UTILE
             ***********************/
            "cholecystectomie compliquee",
            "cicatrice cheloide",
            "eventration",
            "hernie recidivante",
            "chirurgie sinus recidivante",
            "chirurgie varices recidivantes",
            "chirurgie endometriose",
            "chirurgie incontinence",
            "bandelette urinaire",
            "sling urinaire",
            "chirurgie bariatrique ancienne sans complication",

            /***********************
             * TROUBLES CHRONIQUES PEU GRAVES MAIS UTILES
             ***********************/
            "migraine",
            "migraine avec aura",
            "lombalgie chronique",
            "cervicalgie chronique",
            "tendinite chronique",
            "epicondylite chronique",
            "syndrome canal carpien non opere",
            "aponevrosite plantaire chronique",
            "nevralgie cervico brachiale",
            "sciatique ancienne",
            "fibromyalgie legere",
            "syndrome douloureux chronique",

            /***********************
             * ENDOCRINO / CARENCE UTILE
             ***********************/
            "carence martiale chronique",
            "anemie ferriprive chronique",
            "carence b12",
            "carence vitamine b12",
            "carence vitamine d recurrente",
            "osteopenie",
            "hyperprolactinemie",
            "nodule thyroidien benin surveille"
        ],

        exactWords: [
            "hpv",
            "diu",
            "vppb",
            "hbp",
            "lca"
        ],

        cim10Regex: [
            "\\bZ80(?:\\.[0-9A-Z]+)?\\b",
            "\\bZ82(?:\\.[0-9A-Z]+)?\\b",
            "\\bZ83(?:\\.[0-9A-Z]+)?\\b",
            "\\bN87(?:\\.[0-9A-Z]+)?\\b",
            "\\bB97\\.7\\b",
            "\\bN40(?:\\.[0-9A-Z]+)?\\b",
            "\\bN20(?:\\.[0-9A-Z]+)?\\b",
            "\\bK21(?:\\.[0-9A-Z]+)?\\b",
            "\\bH40(?:\\.[0-9A-Z]+)?\\b",
            "\\bH35(?:\\.[0-9A-Z]+)?\\b"
        ]
    },

    /************************************************************
     * NO_COLOR
     * Antécédents reconnus mais sans priorité utile.
     * Colorisation blanche.
     ************************************************************/
    NO_COLOR: {
        label: "Blanc / sans priorité",
        cssColor: "#FFFFFF",
        wedaColorName: "BLANC",
        terms: [
            /***********************
             * MENTIONS VIDES / NON INFORMATIVES
             ***********************/
            "ras",
            "aucun antecedent",
            "pas d antecedent",
            "neant",
            "non renseigne",
            "non renseignee",
            "bilan normal",
            "surveillance",
            "controle",
            "antecedent non precise",
            "atcd non precise",

            /***********************
             * INFECTIONS AIGUËS ANCIENNES SIMPLES
             ***********************/
            "varicelle",
            "rougeole",
            "oreillons",
            "rubeole",
            "mononucleose",
            "grippe",
            "angine simple",
            "bronchite simple",
            "pneumonie ancienne simple",
            "gastro enterite",
            "covid ancien simple",
            "infection urinaire ancienne simple",
            "cystite ancienne simple",
            "pyelonephrite ancienne simple",
            "zona ancien simple",

            /***********************
             * CHIRURGIES SIMPLES SANS SUIVI PARTICULIER
             ***********************/
            "appendicectomie",
            "appendice enleve",
            "amygdalectomie",
            "amygdales enlevees",
            "vegetations",
            "adenoidectomie",
            "circoncision",
            "kyste sebace opere",
            "lipome retire",
            "grain de beaute retire",
            "kyste pilonidal opere sans recidive",
            "hernie inguinale operee simple",
            "hernie ombilicale operee simple",
            "canal carpien opere sans sequelle",
            "varices operees sans recidive",
            "stripping sans recidive",
            "cataracte operee simple",
            "ivg",
            "curetage simple",
            "vasectomie",
            "ligature trompes",

            /***********************
             * TRAUMATOLOGIE SIMPLE ANCIENNE
             ***********************/
            "fracture ancienne simple",
            "fracture doigt",
            "fracture orteil",
            "fracture clavicule ancienne simple",
            "fracture poignet ancienne simple",
            "fracture cheville ancienne simple",
            "entorse ancienne simple",
            "plaie suturee ancienne",
            "points de suture ancien",
            "brulure ancienne simple",
            "contusion ancienne",
            "ecchymose",
            "petite plaie",
            "platre ancien sans sequelle",

            /***********************
             * SYMPTÔMES ISOLÉS NON DIAGNOSTIQUES
             ***********************/
            "douleur",
            "fatigue",
            "malaise",
            "cephalee isolee",
            "lombalgie simple",
            "cervicalgie simple",
            "constipation ponctuelle",
            "diarrhee ponctuelle",
            "rhume",

            /***********************
             * DERMATOLOGIE MINEURE
             ***********************/
            "verrue",
            "mycose simple",
            "onychomycose simple",
            "eczema ponctuel",
            "urticaire ponctuelle",
            "acne ancienne simple",

            /***********************
             * ALLERGIE / INTOLÉRANCE NON EXPLOITABLE
             ***********************/
            "allergie inconnue non documentee",
            "intolerance digestive legere",
            "intolerance non precisee"
        ]
    },

    /************************************************************
     * TERMES DE NÉGATION
     * À utiliser dans une fenêtre de quelques mots avant le mot-clé.
     ************************************************************/
    negationTerms: [
        "pas de",
        "pas d",
        "absence de",
        "absence d",
        "sans",
        "aucun",
        "aucune",
        "n a pas",
        "ne presente pas",
        "non retrouve",
        "non retrouvee",
        "non connu",
        "non connue",
        "ecarte",
        "ecartee",
        "exclu",
        "exclue",
        "depistage negatif",
        "test negatif",
        "serologie negative",
        "bilan negatif",
        "recherche negative",
        "vih negatif",
        "hepatite negative",
        "pas d allergie connue",
        "aucune allergie connue",
        "allergies non connues",
        "allergie non connue"
    ],

    /************************************************************
     * TERMES FAMILIAUX
     ************************************************************/
    familyTerms: [
        "pere",
        "mere",
        "frere",
        "soeur",
        "fils",
        "fille",
        "enfant",
        "parent",
        "grand pere",
        "grand mere",
        "grand parent",
        "oncle",
        "tante",
        "cousin",
        "cousine",
        "famille",
        "familial",
        "familiale",
        "antecedent familial",
        "atcd familial",
        "terrain familial"
    ],

    familialHighRiskTerms: [
        "brca",
        "brca1",
        "brca2",
        "lynch",
        "syndrome de lynch",
        "polypose familiale",
        "polypose adenomateuse familiale",
        "mort subite familiale",
        "cardiomyopathie familiale",
        "qt long familial",
        "maladie de marfan",
        "marfan",
        "ehlers danlos vasculaire",
        "drepanocytose familiale",
        "hemochromatose familiale"
    ],

    /************************************************************
     * AMPLIFICATEURS DE GRAVITÉ
     ************************************************************/
    severityAmplifiers: [
        "severe",
        "grave",
        "complique",
        "compliquee",
        "recidivant",
        "recidivante",
        "recurrent",
        "recurrente",
        "chronique severe",
        "decompense",
        "decompensee",
        "hospitalisation",
        "reanimation",
        "soins intensifs",
        "coma",
        "choc",
        "insuffisance",
        "stade 4",
        "stade 5",
        "metastatique",
        "bilateral",
        "bilaterale",
        "multiple",
        "multiples",
        "invalidant",
        "invalidante",
        "definitif",
        "definitive",
        "avec sequelles",
        "sequellaire"
    ],

    /************************************************************
     * RÈGLES DE PLAFONNEMENT CONSEILLÉES
     ************************************************************/
    caps: {
        familyDefaultMax: "PRIO_JAUNE",
        familyCancerMax: "PRIO_ORANGE",
        familyHighRiskMax: "PRIO_ORANGE",
        simpleOldTraumaMax: "NO_COLOR",
        simpleOldSurgeryMax: "NO_COLOR",
        noColorCssColor: "#FFFFFF",
        noColorWedaColorName: "BLANC"
    }
};

    const COLOR_DEFS = {
        PRIO_ROUGE: {
            label: 'Rouge',
            css: '#d32f2f',
            names: ['rouge', 'red', 'ecarlate', 'vermeil'],
            rgbs: [[211, 47, 47], [255, 0, 0], [192, 0, 0], [255, 204, 204]]
        },
        PRIO_VIOLET: {
            label: 'Violet',
            css: '#cc66ff',
            names: ['violet', 'purple', 'mauve', 'pourpre'],
            rgbs: [[204, 102, 255], [102, 51, 204], [123, 31, 162], [128, 0, 128], [102, 0, 153]]
        },
        PRIO_ORANGE: {
            label: 'Orange',
            css: '#f57c00',
            names: ['orange', 'ambre'],
            rgbs: [[245, 124, 0], [255, 128, 0], [255, 165, 0], [255, 224, 178]]
        },
        PRIO_JAUNE: {
            label: 'Jaune',
            css: '#fbc02d',
            names: ['jaune', 'yellow'],
            rgbs: [[251, 192, 45], [255, 255, 0], [255, 230, 0], [255, 255, 153], [255, 255, 204]]
        },
        NO_COLOR: {
            label: 'Blanc',
            css: '#ffffff',
            names: ['blanc', 'white', 'aucune couleur', 'sans couleur', 'no color'],
            rgbs: [[255, 255, 255], [250, 250, 250], [245, 245, 245]]
        },
        PRIO_BLANC: {
            label: 'Blanc',
            css: '#ffffff',
            names: ['blanc', 'white', 'aucune couleur', 'sans couleur'],
            rgbs: [[255, 255, 255], [250, 250, 250], [245, 245, 245]]
        }
    };

    const WEDA_PRIORITY_COLOR_TARGETS = {
        PRIO_ROUGE: {
            label: 'rouge',
            preferredHex: '#ffcccc',
            nameRegex: /\b(red|rouge|rose)\b/
        },
        PRIO_VIOLET: {
            label: 'violet',
            preferredHex: '#cc66ff',
            nameRegex: /\b(violet|purple|mauve|pourpre)\b/
        },
        PRIO_ORANGE: {
            label: 'orange',
            preferredHex: '#ffe0b2',
            nameRegex: /\b(orange|abricot|saumon)\b/
        },
        PRIO_JAUNE: {
            label: 'jaune',
            preferredHex: '#ffff99',
            nameRegex: /\b(yellow|jaune)\b/
        },
        NO_COLOR: {
            label: 'blanc',
            preferredHex: '#ffffff',
            nameRegex: /\b(white|blanc|aucune couleur|sans couleur|no color)\b/
        },
        PRIO_BLANC: {
            label: 'blanc',
            preferredHex: '#ffffff',
            nameRegex: /\b(white|blanc|aucune couleur|sans couleur)\b/
        }
    };

    const PRIORITY_RANK = {
        NO_COLOR: 0,
        PRIO_BLANC: 0,
        PRIO_JAUNE: 1,
        PRIO_ORANGE: 2,
        PRIO_VIOLET: 3,
        PRIO_ROUGE: 4
    };

    const runtime = {
        running: false,
        stopRequested: false,
        lastCommandId: ''
    };

    const compiledColorRules = compileColorRules();
    const negationTerms = normalizeTerms(AUTO_ATCD_COLOR_KEYWORDS.negationTerms);
    const familyTerms = normalizeTerms(AUTO_ATCD_COLOR_KEYWORDS.familyTerms);
    const familialHighRiskTerms = normalizeTerms(AUTO_ATCD_COLOR_KEYWORDS.familialHighRiskTerms);
    const familyCancerTerms = normalizeTerms([
        'cancer',
        'neoplasie',
        'neoplasme',
        'tumeur maligne',
        'carcinome',
        'adenocarcinome',
        'sarcome',
        'melanome',
        'lymphome',
        'leucemie',
        'myelome',
        'brca',
        'brca1',
        'brca2',
        'lynch',
        'polypose familiale'
    ]);
    const severityAmplifiers = normalizeTerms(AUTO_ATCD_COLOR_KEYWORDS.severityAmplifiers);
    const weakOrIgnoreTerms = normalizeTerms(AUTO_ATCD_COLOR_KEYWORDS.weakOrIgnoreTerms);
    const noColorTerms = normalizeTerms(AUTO_ATCD_COLOR_KEYWORDS.noColorTerms || (getColorRuleForPriority('NO_COLOR').terms || []));

    function isTopWindow() {
        try {
            return window.self === window.top;
        } catch (_) {
            return true;
        }
    }

    function isWeda() {
        return window.location.hostname === HOST_WEDA;
    }

    function nowMs() {
        return Date.now();
    }

    function nowIso() {
        try {
            return new Date().toISOString();
        } catch (_) {
            return String(Date.now());
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitFor(fn, timeoutMs = 10000, intervalMs = 250) {
        const start = nowMs();
        while (nowMs() - start < timeoutMs) {
            try {
                const result = fn();
                if (result) return result;
            } catch (_) {}
            await sleep(intervalMs);
        }
        return null;
    }

    function normalizeSpaces(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\s+\n/g, '\n')
            .replace(/\n\s+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function normalizeForMatch(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/œ/g, 'oe')
            .replace(/æ/g, 'ae')
            .replace(/[’']/g, ' ')
            .replace(/[-_/.,;:!?()[\]{}"«»]/g, ' ')
            .replace(/\[[a-z][a-z0-9]{0,3}(?:\.[a-z0-9]+)?\]/ig, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeTerms(terms) {
        return (terms || [])
            .map(term => normalizeForMatch(term))
            .filter(Boolean)
            .sort((a, b) => b.length - a.length);
    }

    function limitText(text, maxLen = 240) {
        const value = normalizeSpaces(text);
        if (value.length <= maxLen) return value;
        return value.slice(0, maxLen - 1) + '...';
    }

    function parseMaybeJson(raw, fallback = null) {
        if (raw === null || raw === undefined || raw === '') return fallback;
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return fallback;
        }
    }

    function gmGetJson(key, fallback = null) {
        try {
            return parseMaybeJson(GM_getValue(key, null), fallback);
        } catch (e) {
            console.warn(LOG_PREFIX, 'Lecture stockage impossible', key, e);
            return fallback;
        }
    }

    function gmSetJson(key, value) {
        try {
            GM_setValue(key, JSON.stringify(value));
        } catch (e) {
            console.warn(LOG_PREFIX, 'Ecriture stockage impossible', key, e);
        }
    }

    function gmDelete(key) {
        try {
            GM_deleteValue(key);
        } catch (_) {}
    }

    function getLogs() {
        const logs = gmGetJson(KEY_LOG, []);
        return Array.isArray(logs) ? logs : [];
    }

    function saveLogs(logs) {
        gmSetJson(KEY_LOG, Array.isArray(logs) ? logs.slice(-MAX_LOG_ENTRIES) : []);
    }

    function clearLogs() {
        saveLogs([]);
        refreshLogPanel();
    }

    function compactForLog(value, maxChars = MAX_LOG_DETAILS_CHARS) {
        if (value === null || value === undefined) return null;
        try {
            const raw = JSON.stringify(value);
            if (!raw || raw.length <= maxChars) return value;
            return {
                truncated: true,
                excerpt: raw.slice(0, maxChars)
            };
        } catch (_) {
            return String(value).slice(0, maxChars);
        }
    }

    function logEvent(level, message, details) {
        const entry = {
            ts: nowMs(),
            iso: nowIso(),
            level: level || 'info',
            message: String(message || ''),
            url: String(window.location.href || ''),
            details: compactForLog(details || null)
        };

        const logs = getLogs();
        logs.push(entry);
        saveLogs(logs);

        try {
            const method = entry.level === 'error' ? 'error' : (entry.level === 'warn' ? 'warn' : 'log');
            console[method](LOG_PREFIX, entry.message, entry.details || '');
        } catch (_) {}

        refreshLogPanel();
        return entry;
    }

    function formatLogsForCopy(logs) {
        const list = Array.isArray(logs) ? logs : [];
        if (!list.length) return 'Aucun log.';
        return list.map(entry => {
            const header = [
                entry.iso || '',
                entry.level || '',
                entry.message || ''
            ].filter(Boolean).join(' ');
            const details = entry.details ? '\n' + JSON.stringify(entry.details, null, 2) : '';
            return header + details;
        }).join('\n\n');
    }

    async function copyTextToClipboard(text) {
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text, 'text');
                return true;
            }
        } catch (_) {}

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '0';
            document.documentElement.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            textarea.remove();
            return !!ok;
        } catch (_) {
            return false;
        }
    }

    async function copyAllLogs() {
        const text = formatLogsForCopy(getLogs());
        const ok = await copyTextToClipboard(text);
        showBadge(ok ? 'Logs copies dans le presse-papiers.' : 'Copie impossible : ouvre la console et appelle AUTO_ATCD_CIM10_COLOR_LOGS().', {
            error: !ok,
            duration: ok ? 5000 : 9000,
            abovePanel: true
        });
        return ok;
    }

    function detectWedaErrorPage() {
        try {
            const text = normalizeSpaces(document.body && (document.body.innerText || document.body.textContent) || '');
            if (!/une erreur est survenue sur cette page/i.test(text)) return null;
            const idMatch = text.match(/Identifiant de l'erreur\s*:\s*([a-f0-9]+)/i);
            const cabinetMatch = text.match(/Cabinet ID\s*:\s*(\d+)/i);
            return {
                errorId: idMatch ? idMatch[1] : '',
                cabinetId: cabinetMatch ? cabinetMatch[1] : '',
                text: limitText(text, 500)
            };
        } catch (_) {
            return null;
        }
    }

    function getAccessibleDocuments() {
        const docs = [];
        const seen = new Set();

        function addDoc(doc) {
            if (!doc || seen.has(doc)) return;
            seen.add(doc);
            docs.push(doc);

            const frames = doc.querySelectorAll ? doc.querySelectorAll('iframe, frame') : [];
            for (const frame of frames) {
                try {
                    addDoc(frame.contentDocument || (frame.contentWindow && frame.contentWindow.document));
                } catch (_) {}
            }
        }

        addDoc(document);
        return docs;
    }

    function queryElementsDeep(selector, initialDoc) {
        const docs = initialDoc ? [initialDoc] : getAccessibleDocuments();
        const out = [];
        for (const doc of docs) {
            try {
                out.push(...doc.querySelectorAll(selector));
            } catch (_) {}
        }
        return out;
    }

    function findElementDeep(selector, initialDoc) {
        for (const doc of initialDoc ? [initialDoc] : getAccessibleDocuments()) {
            try {
                const el = doc.querySelector(selector);
                if (el) return el;
            } catch (_) {}
        }
        return null;
    }

    function ownerWin(el) {
        return (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
    }

    function isVisible(el) {
        if (!el) return false;
        try {
            const style = ownerWin(el).getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (_) {
            return true;
        }
    }

    function getElementText(el) {
        if (!el) return '';
        return normalizeSpaces([
            el.innerText,
            el.textContent,
            el.value,
            el.getAttribute && el.getAttribute('title'),
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('alt')
        ].filter(Boolean).join('\n'));
    }

    function getElementMetadataText(el) {
        if (!el) return '';
        const attrs = ['id', 'name', 'class', 'title', 'aria-label', 'alt', 'value', 'href', 'onclick', 'src', 'style'];
        return normalizeForMatch(attrs.map(attr => el.getAttribute && el.getAttribute(attr) || '').join(' ') + ' ' + getElementText(el));
    }

    function getWedaAntecedentRoot() {
        return findElementDeep(SELECTOR_ANTECEDENT_ROOT);
    }

    function isAntecedentPageWeda() {
        return isWeda() && !!getWedaAntecedentRoot();
    }

    function getDoPostBack() {
        const wins = [];
        try { wins.push(window); } catch (_) {}
        try { if (typeof unsafeWindow !== 'undefined') wins.push(unsafeWindow); } catch (_) {}
        for (const doc of getAccessibleDocuments()) {
            try { wins.push(doc.defaultView); } catch (_) {}
        }

        for (const win of wins) {
            try {
                if (win && typeof win.__doPostBack === 'function') return win.__doPostBack.bind(win);
            } catch (_) {}
        }
        return null;
    }

    function showBadge(message, options = {}) {
        if (!isTopWindow()) return;
        try {
            const old = document.getElementById(BADGE_ID);
            if (old) old.remove();

            const badge = document.createElement('div');
            badge.id = BADGE_ID;
            badge.textContent = message;
            badge.style.position = 'fixed';
            badge.style.right = '14px';
            badge.style.bottom = options.abovePanel ? '92px' : '14px';
            badge.style.zIndex = '2147483647';
            badge.style.maxWidth = '560px';
            badge.style.whiteSpace = 'pre-wrap';
            badge.style.background = options.error ? '#7a1020' : '#193f5c';
            badge.style.color = '#fff';
            badge.style.fontFamily = 'Arial, sans-serif';
            badge.style.fontSize = '13px';
            badge.style.fontWeight = '700';
            badge.style.lineHeight = '1.35';
            badge.style.padding = '10px 12px';
            badge.style.borderRadius = '8px';
            badge.style.boxShadow = '0 6px 20px rgba(0,0,0,.28)';
            badge.style.pointerEvents = 'none';
            document.documentElement.appendChild(badge);

            const duration = options.duration === undefined ? 6000 : Number(options.duration || 0);
            if (duration > 0) {
                setTimeout(() => {
                    try { badge.remove(); } catch (_) {}
                }, duration);
            }
        } catch (_) {}
    }

    function installPanel() {
        if (!isTopWindow() || !isWeda() || !isAntecedentPageWeda()) {
            removePanel();
            return;
        }

        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.position = 'fixed';
        panel.style.right = '14px';
        panel.style.bottom = '14px';
        panel.style.zIndex = '2147483647';
        panel.style.width = '256px';
        panel.style.boxSizing = 'border-box';
        panel.style.background = '#193f5c';
        panel.style.color = '#fff';
        panel.style.border = '1px solid rgba(255,255,255,.22)';
        panel.style.borderRadius = '8px';
        panel.style.padding = '10px';
        panel.style.boxShadow = '0 8px 26px rgba(0,0,0,.28)';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.fontSize = '12px';
        panel.style.lineHeight = '1.35';

        panel.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">',
            '<strong style="font-size:13px;">Coloriseur ATCD CIM10</strong>',
            '<span style="opacity:.78;font-size:10px;">v' + VERSION + '</span>',
            '</div>',
            '<div data-color-field="summary" style="opacity:.9;margin-bottom:8px;">Analyse en cours...</div>',
            '<button type="button" data-color-action="start" style="width:100%;margin:0 0 6px 0;padding:7px 8px;border:0;border-radius:6px;background:#ffffff;color:#193f5c;font-weight:700;cursor:pointer;">Traiter ce patient</button>',
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">',
            '<button type="button" data-color-action="diag" style="padding:6px 8px;border:1px solid rgba(255,255,255,.45);border-radius:6px;background:transparent;color:#fff;cursor:pointer;">Diagnostic</button>',
            '<button type="button" data-color-action="logs" style="padding:6px 8px;border:1px solid rgba(255,255,255,.45);border-radius:6px;background:transparent;color:#fff;cursor:pointer;">Logs</button>',
            '<button type="button" data-color-action="stop" style="padding:6px 8px;border:1px solid rgba(255,255,255,.45);border-radius:6px;background:transparent;color:#fff;cursor:pointer;">Stop</button>',
            '<button type="button" data-color-action="clear" style="padding:6px 8px;border:1px solid rgba(255,255,255,.45);border-radius:6px;background:transparent;color:#fff;cursor:pointer;">Effacer</button>',
            '</div>'
        ].join('');

        panel.addEventListener('click', event => {
            const button = event.target && event.target.closest ? event.target.closest('[data-color-action]') : null;
            if (!button) return;
            const action = button.getAttribute('data-color-action');
            if (action === 'start') {
                startCleanup({ source: 'button' });
            } else if (action === 'diag') {
                const report = buildDiagnostic();
                console.log(LOG_PREFIX, 'DIAG', report);
                showBadge(report.ignoredCandidates.length + ' sans CIM10 ignore(s), ' + report.colorCandidates.length + ' avec CIM10 detecte(s).', {
                    duration: 8000,
                    abovePanel: true
                });
            } else if (action === 'logs') {
                toggleLogPanel();
            } else if (action === 'stop') {
                runtime.stopRequested = true;
                logEvent('warn', 'Arret demande depuis le panneau.');
                showBadge('Arret demande. Le traitement s’arretera apres l’action en cours.', {
                    duration: 7000,
                    abovePanel: true
                });
            } else if (action === 'clear') {
                clearLogs();
                gmDelete(KEY_LAST_REPORT);
                showBadge('Logs et dernier rapport effaces.', {
                    duration: 5000,
                    abovePanel: true
                });
            }
        });

        document.documentElement.appendChild(panel);
        renderPanel();
    }

    function removePanel() {
        try {
            const panel = document.getElementById(PANEL_ID);
            if (panel) panel.remove();
        } catch (_) {}
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function toggleLogPanel() {
        if (!isTopWindow()) return;
        const existing = document.getElementById(LOG_PANEL_ID);
        if (existing) {
            existing.remove();
            return;
        }

        const panel = document.createElement('div');
        panel.id = LOG_PANEL_ID;
        panel.style.position = 'fixed';
        panel.style.right = '286px';
        panel.style.bottom = '14px';
        panel.style.zIndex = '2147483647';
        panel.style.width = '600px';
        panel.style.maxHeight = '460px';
        panel.style.overflow = 'auto';
        panel.style.boxSizing = 'border-box';
        panel.style.background = '#ffffff';
        panel.style.color = '#111827';
        panel.style.border = '1px solid #c7d1dc';
        panel.style.borderRadius = '8px';
        panel.style.padding = '10px';
        panel.style.boxShadow = '0 8px 26px rgba(0,0,0,.24)';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.fontSize = '12px';

        panel.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">',
            '<strong>Logs coloriseur ATCD CIM10</strong>',
            '<div>',
            '<button type="button" data-log-action="copy" style="margin-right:6px;padding:5px 8px;">Copier</button>',
            '<button type="button" data-log-action="clear" style="margin-right:6px;padding:5px 8px;">Effacer</button>',
            '<button type="button" data-log-action="close" style="padding:5px 8px;">Fermer</button>',
            '</div>',
            '</div>',
            '<div data-log-content></div>'
        ].join('');

        panel.addEventListener('click', event => {
            const btn = event.target && event.target.closest ? event.target.closest('[data-log-action]') : null;
            if (!btn) return;
            const action = btn.getAttribute('data-log-action');
            if (action === 'close') panel.remove();
            if (action === 'clear') clearLogs();
            if (action === 'copy') copyAllLogs();
        });

        document.documentElement.appendChild(panel);
        refreshLogPanel();
    }

    function refreshLogPanel() {
        if (!isTopWindow()) return;
        const panel = document.getElementById(LOG_PANEL_ID);
        if (!panel) return;
        const content = panel.querySelector('[data-log-content]');
        if (!content) return;

        const logs = getLogs().slice(-160).reverse();
        content.innerHTML = logs.length
            ? logs.map(entry => {
                const color = entry.level === 'error' ? '#9f1239' : (entry.level === 'warn' ? '#92400e' : (entry.level === 'success' ? '#166534' : '#334155'));
                const details = entry.details ? '<pre style="white-space:pre-wrap;margin:4px 0 0;color:#475569;">' + escapeHtml(JSON.stringify(entry.details, null, 2).slice(0, 2600)) + '</pre>' : '';
                return [
                    '<div style="border-top:1px solid #e5e7eb;padding:6px 0;color:' + color + ';">',
                    '<strong>' + escapeHtml(entry.iso || '') + ' ' + escapeHtml(entry.level || '') + '</strong> ',
                    '<span>' + escapeHtml(entry.message || '') + '</span>',
                    details,
                    '</div>'
                ].join('');
            }).join('')
            : '<div style="color:#64748b;">Aucun log.</div>';
    }

    function renderPanel() {
        if (!isTopWindow()) return;
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        const summary = panel.querySelector('[data-color-field="summary"]');
        if (!summary) return;

        if (runtime.running) {
            summary.textContent = 'Traitement en cours...';
            return;
        }

        const ignoredCount = collectUncodedCandidates({ limit: 1000 }).length;
        const colorCount = collectColorCandidates({ limit: 1000 }).length;
        summary.textContent = ignoredCount + ' sans CIM10 ignore(s). ' + colorCount + ' avec CIM10 a colorer.';
    }

    function isAutoUiElement(el) {
        try {
            return !!(el && el.closest && el.closest('#' + PANEL_ID + ', #' + BADGE_ID));
        } catch (_) {
            return false;
        }
    }

    function getHeaderMainLabel(el) {
        if (!el) return '';
        try {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.smna').forEach(x => x.remove());
            return normalizeSpaces((clone.innerText || clone.textContent || '').replace(/\[[^\]]+\]/g, ''));
        } catch (_) {
            return normalizeSpaces((el.innerText || el.textContent || '').replace(/\[[^\]]+\]/g, ''));
        }
    }

    function isSectionHeader(el) {
        if (!el || !isVisible(el) || isAutoUiElement(el)) return null;

        const className = String(el.className || '').toLowerCase();
        const title = normalizeForMatch(el.getAttribute && el.getAttribute('title') || '');
        if (!/\bsma\b/.test(className) && !title.includes('type de l onglet')) return null;

        const mainLabel = getHeaderMainLabel(el);
        const normalized = normalizeForMatch(mainLabel || getElementText(el));
        if (!normalized) return null;
        if (/^type de l onglet/.test(normalized)) return null;

        return { label: mainLabel || getElementText(el), normalized };
    }

    function extractStructuredCim10Codes(scope) {
        const codes = [];
        if (!scope) return codes;

        function inspect(el) {
            if (!el || !el.getAttribute) return;
            const title = normalizeForMatch(el.getAttribute('title') || '');
            if (title !== 'code cim10') return;

            const text = normalizeSpaces(el.innerText || el.textContent || '');
            const matches = text.match(/\[[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?(?:-[A-Z][A-Z0-9]{0,3}(?:\.[A-Z0-9]+)?)?\]/ig) || [];
            for (const match of matches) {
                const code = normalizeCim10Code(match);
                if (code && !codes.includes(code)) codes.push(code);
            }
        }

        inspect(scope);
        try {
            scope.querySelectorAll('[title]').forEach(inspect);
        } catch (_) {}

        return codes;
    }

    function normalizeCim10Code(value) {
        return String(value || '')
            .replace(/[\[\]\s]/g, '')
            .toUpperCase()
            .trim();
    }

    function looksLikeAntecedentText(text) {
        const cleaned = normalizeSpaces(text);
        if (!cleaned || cleaned.length < 2 || cleaned.length > 2500) return false;

        const n = normalizeForMatch(cleaned);
        if (!n) return false;
        if (/^(supprimer|modifier|valider|annuler|ajouter|fermer|aucun|non|oui|\d+)$/.test(n)) return false;
        if (/^type de l onglet/.test(n)) return false;

        return true;
    }

    function tableNestingDepth(el, stopAt) {
        let depth = 0;
        let node = el && el.parentElement;
        while (node && node !== stopAt && node !== document.body) {
            if (String(node.tagName || '').toLowerCase() === 'table') depth += 1;
            node = node.parentElement;
        }
        return depth;
    }

    function hasNestedTextBlock(el) {
        try {
            const own = normalizeSpaces(el.innerText || el.textContent || '');
            if (!own) return false;
            return Array.from(el.children || []).some(child => {
                const text = normalizeSpaces(child.innerText || child.textContent || '');
                return text && text.length > 1 && text.length >= Math.min(own.length, 80);
            });
        } catch (_) {
            return false;
        }
    }

    function getCellIndex(cell) {
        if (!cell) return -1;
        if (typeof cell.cellIndex === 'number') return cell.cellIndex;
        try {
            return Array.prototype.indexOf.call(cell.parentElement.children, cell);
        } catch (_) {
            return -1;
        }
    }

    function hasAntecedentItemShape(el) {
        if (!el) return false;

        const tag = String(el.tagName || '').toLowerCase();
        const parent = el.parentElement;
        const parentTag = String(parent && parent.tagName || '').toLowerCase();
        const cell = el.closest && el.closest('td');
        const row = el.closest && el.closest('tr');
        const cellIndex = getCellIndex(cell);

        if (tag === 'div' && parentTag === 'td' && getCellIndex(parent) === 1) return true;
        if (tag === 'div' && cellIndex === 1 && row) return true;
        if (tag === 'td' && getCellIndex(el) === 1 && !hasNestedTextBlock(el)) return true;

        try {
            if (tag === 'div' && el.querySelector(':scope > span[title]') && el.querySelector('br')) return true;
        } catch (_) {}

        return false;
    }

    function hasNestedAntecedentItemShape(el) {
        if (!el || !el.querySelectorAll) return false;
        try {
            return Array.from(el.querySelectorAll('div, td')).some(child => child !== el && hasAntecedentItemShape(child));
        } catch (_) {
            return false;
        }
    }

    function isCandidateElement(el, root) {
        if (!el || isAutoUiElement(el) || !isVisible(el)) return false;
        if (isSectionHeader(el)) return false;

        const tag = String(el.tagName || '').toLowerCase();
        if (!['div', 'td'].includes(tag)) return false;
        if (!hasAntecedentItemShape(el)) return false;
        if (hasNestedAntecedentItemShape(el)) return false;

        const text = getElementText(el);
        if (!looksLikeAntecedentText(text)) return false;

        const closestTable = el.closest && el.closest('table');
        if ((tag === 'td' || tag === 'div') && text.length > 1200 && hasNestedTextBlock(el)) return false;
        if (closestTable && tableNestingDepth(el, root) > 8) return false;

        const target = getSelectableTarget(el, root);
        return !!target;
    }

    function isClickableElement(el) {
        if (!el) return false;
        try {
            if (el.matches('a[href], button, input[type="button"], input[type="submit"], input[type="image"], [onclick], [role="button"], [role="link"]')) {
                return true;
            }
        } catch (_) {}

        try {
            return ownerWin(el).getComputedStyle(el).cursor === 'pointer';
        } catch (_) {
            return false;
        }
    }

    function getSelectableTarget(el, root) {
        if (!el) return null;

        let node = el;
        let depth = 0;
        while (node && node !== root && node !== document.body && depth < 8) {
            if (isClickableElement(node)) return node;
            node = node.parentElement;
            depth += 1;
        }

        try {
            const row = el.closest && el.closest('tr, li, [role="row"]');
            if (row && (!root || root.contains(row))) return row;
        } catch (_) {}

        return el;
    }

    function describeElement(el) {
        if (!el) return null;
        return {
            tag: String(el.tagName || '').toLowerCase(),
            id: el.id || '',
            className: String(el.className || '').slice(0, 160),
            text: limitText(getElementText(el), 180)
        };
    }

    function candidateSignatureFromText(section, text) {
        return (section || '') + '|' + normalizeForMatch(text);
    }

    function scoreCandidate(el, root) {
        const tag = String(el.tagName || '').toLowerCase();
        const text = getElementText(el);
        const parent = el.parentElement;
        const row = el.closest && el.closest('tr');
        let score = 0;

        if (tag === 'div') score -= 60;
        if (tag === 'td') score -= 20;
        if (tag === 'tr') score += 35;
        if (tag === 'span') score += 20;

        try {
            if (parent && String(parent.tagName || '').toLowerCase() === 'td' && parent.cellIndex === 1) score -= 45;
        } catch (_) {}

        if (el.querySelector && el.querySelector('br')) score -= 10;
        if (row && isClickableElement(row)) score -= 10;
        if (isClickableElement(el)) score -= 18;
        if (hasNestedTextBlock(el)) score += 45;

        score += Math.min(text.length, 1200) / 8;
        score += tableNestingDepth(el, root) * 2;
        return score;
    }

    function getCodeScope(el) {
        if (!el) return null;
        const row = el.closest && el.closest('tr');
        return row || el;
    }

    function addCandidateContextChunk(chunks, node, maxLen = 1400) {
        if (!node || !isVisible(node) || isSectionHeader(node)) return;
        const text = getElementText(node);
        if (!text || text.length > maxLen) return;
        if (!chunks.includes(text)) chunks.push(text);
    }

    function getCandidateContextText(el, root) {
        const chunks = [];
        if (!el) return '';

        addCandidateContextChunk(chunks, el);
        try { addCandidateContextChunk(chunks, el.closest && el.closest('tr')); } catch (_) {}
        try { addCandidateContextChunk(chunks, el.closest && el.closest('td')); } catch (_) {}

        const parent = el.parentElement;
        if (parent && parent !== root) addCandidateContextChunk(chunks, parent, 900);

        for (const sibling of [el.previousElementSibling, el.nextElementSibling]) {
            if (!sibling || sibling === root) continue;
            addCandidateContextChunk(chunks, sibling, 500);
        }

        return normalizeSpaces(chunks.join('\n'));
    }

    function collectAntecedentItems(options = {}) {
        const root = getWedaAntecedentRoot();
        if (!root) return [];

        const limit = Number(options.limit || 1000);
        const all = Array.from(root.querySelectorAll('*'));
        const raw = [];
        let currentSection = 'antecedents';
        let currentSectionLabel = 'Antécédents';

        for (const el of all) {
            const header = isSectionHeader(el);
            if (header) {
                currentSection = header.normalized || 'antecedents';
                currentSectionLabel = header.label || 'Antécédents';
                continue;
            }

            if (!isCandidateElement(el, root)) continue;

            const text = getElementText(el);
            const codeScope = getCodeScope(el);
            const contextText = getCandidateContextText(el, root);
            const codes = extractStructuredCim10Codes(codeScope);
            const signature = candidateSignatureFromText(currentSection, text);
            raw.push({
                el,
                target: getSelectableTarget(el, root),
                doc: el.ownerDocument || document,
                section: currentSection,
                sectionLabel: currentSectionLabel,
                text,
                contextText,
                codes,
                hasCim10: codes.length > 0,
                signature,
                score: scoreCandidate(el, root),
                element: describeElement(el)
            });
        }

        raw.sort((a, b) => a.score - b.score);

        const selected = [];
        const seenSignatures = new Set();
        for (const candidate of raw) {
            if (selected.length >= limit) break;
            if (!candidate.el || !candidate.target) continue;
            if (seenSignatures.has(candidate.signature)) continue;

            const overlaps = selected.some(existing => {
                try {
                    return existing.el.contains(candidate.el) || candidate.el.contains(existing.el);
                } catch (_) {
                    return false;
                }
            });
            if (overlaps) continue;

            seenSignatures.add(candidate.signature);
            selected.push(candidate);
        }

        return selected;
    }

    function collectUncodedCandidates(options = {}) {
        return collectAntecedentItems(options).filter(candidate => !candidate.hasCim10);
    }

    function collectColorCandidates(options = {}) {
        return collectAntecedentItems(options).filter(candidate => candidate.hasCim10);
    }

    function clickElement(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        const doc = el.ownerDocument || document;
        const view = doc.defaultView || window;
        const eventOptions = { bubbles: true, cancelable: true, view };

        try { el.dispatchEvent(new view.MouseEvent('mouseover', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousemove', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousedown', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mouseup', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('click', eventOptions)); } catch (_) {}
        try { el.click(); } catch (_) {}
        return true;
    }

    function getWedaAsyncPostBackActive() {
        const wins = [];
        try { wins.push(window); } catch (_) {}
        try { if (typeof unsafeWindow !== 'undefined') wins.push(unsafeWindow); } catch (_) {}
        for (const doc of getAccessibleDocuments()) {
            try { wins.push(doc.defaultView); } catch (_) {}
        }

        for (const win of wins) {
            try {
                const prm = win.Sys && win.Sys.WebForms && win.Sys.WebForms.PageRequestManager
                    ? win.Sys.WebForms.PageRequestManager.getInstance()
                    : null;
                if (prm && typeof prm.get_isInAsyncPostBack === 'function' && prm.get_isInAsyncPostBack()) {
                    return true;
                }
            } catch (_) {}
        }
        return false;
    }

    async function waitForWedaIdle(timeoutMs = 15000) {
        await waitFor(() => !getWedaAsyncPostBackActive(), timeoutMs, 250);
        await sleep(350);
        return true;
    }

    function getSelectedControlText(initialDoc) {
        const values = [];
        for (const control of queryElementsDeep('input, textarea, select, [contenteditable="true"]', initialDoc)) {
            if (!control || !isVisible(control)) continue;

            const type = String(control.getAttribute('type') || '').toLowerCase();
            if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;

            if (String(control.tagName || '').toLowerCase() === 'select') {
                const selected = Array.from(control.selectedOptions || [])
                    .map(option => (option.textContent || '') + ' ' + (option.value || ''))
                    .join(' ');
                if (selected) values.push(selected);
                continue;
            }

            const editableText = control.getAttribute && control.getAttribute('contenteditable') === 'true'
                ? getElementText(control)
                : '';
            if (control.value) values.push(control.value);
            if (editableText) values.push(editableText);
        }

        return normalizeSpaces(values.join('\n'));
    }

    function selectedControlsLookRelated(candidate, initialDoc) {
        const selectedText = getSelectedControlText(initialDoc);
        if (!selectedText) return false;

        const selectedNorm = normalizeForMatch(selectedText);
        const candidateNorm = normalizeForMatch(candidate && candidate.text);
        if (!selectedNorm || !candidateNorm) return false;
        if (selectedNorm.includes(candidateNorm) || candidateNorm.includes(selectedNorm)) return true;

        const tokens = candidateNorm.split(/\s+/).filter(token => token.length >= 4);
        if (!tokens.length) return false;
        const matched = tokens.filter(token => selectedNorm.includes(token)).length;
        return matched >= Math.min(3, tokens.length);
    }

    function compileColorRules() {
        const out = {};
        for (const priority of AUTO_ATCD_COLOR_KEYWORDS.priorityOrder || []) {
            const rule = getColorRuleForPriority(priority);
            out[priority] = {
                keywords: normalizeTerms([]
                    .concat(rule.keywords || [])
                    .concat(rule.terms || [])
                    .concat(rule.exactWords || [])),
                cim10Regex: (rule.cim10Regex || []).map(pattern => {
                    try {
                        return new RegExp(pattern, 'i');
                    } catch (e) {
                        console.warn(LOG_PREFIX, 'Regex CIM10 ignoree', pattern, e);
                        return null;
                    }
                }).filter(Boolean)
            };
        }
        return out;
    }

    function getColorRuleForPriority(priority) {
        return (AUTO_ATCD_COLOR_KEYWORDS.colors && AUTO_ATCD_COLOR_KEYWORDS.colors[priority])
            || AUTO_ATCD_COLOR_KEYWORDS[priority]
            || {};
    }

    function paddedContainsTerm(normalizedText, normalizedTerm) {
        if (!normalizedText || !normalizedTerm) return false;
        return (' ' + normalizedText + ' ').includes(' ' + normalizedTerm + ' ');
    }

    function hasAnyTerm(normalizedText, normalizedTerms) {
        return (normalizedTerms || []).some(term => paddedContainsTerm(normalizedText, term));
    }

    function hasNonNegatedTerm(normalizedText, normalizedTerm) {
        if (!normalizedText || !normalizedTerm) return false;
        const padded = ' ' + normalizedText + ' ';
        const needle = ' ' + normalizedTerm + ' ';
        let index = padded.indexOf(needle);
        while (index !== -1) {
            const before = padded.slice(Math.max(0, index - 90), index).trim();
            const negated = negationTerms.some(term => before.endsWith(term) || before.includes(term + ' '));
            if (!negated) return true;
            index = padded.indexOf(needle, index + needle.length);
        }
        return false;
    }

    function collectPriorityMatchesFromCodes(codes) {
        const cleanCodes = (codes || []).map(normalizeCim10Code).filter(Boolean);
        const matches = [];
        for (const priority of AUTO_ATCD_COLOR_KEYWORDS.priorityOrder || []) {
            const rules = compiledColorRules[priority];
            if (!rules) continue;
            for (const code of cleanCodes) {
                if (rules.cim10Regex.some(regex => regex.test(code))) {
                    matches.push({ priority, source: 'cim10', match: code });
                    break;
                }
            }
        }
        return matches;
    }

    function collectPriorityMatchesFromKeywords(normalizedText, priorities) {
        if (!normalizedText) return [];
        const matches = [];
        for (const priority of priorities || []) {
            const rules = compiledColorRules[priority];
            if (!rules) continue;
            for (const keyword of rules.keywords) {
                if (hasNonNegatedTerm(normalizedText, keyword)) {
                    matches.push({ priority, source: 'keyword', match: keyword });
                    break;
                }
            }
        }
        return matches;
    }

    function chooseHighestPriorityMatch(matches) {
        const filtered = (matches || []).filter(match => match && Object.prototype.hasOwnProperty.call(PRIORITY_RANK, match.priority));
        if (!filtered.length) return null;
        filtered.sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0));
        return filtered[0];
    }

    function priorityFromCodes(codes) {
        const match = chooseHighestPriorityMatch(collectPriorityMatchesFromCodes(codes));
        return match ? match.priority : '';
    }

    function priorityFromKeywords(normalizedText) {
        if (!normalizedText) return '';
        const match = chooseHighestPriorityMatch(collectPriorityMatchesFromKeywords(normalizedText, AUTO_ATCD_COLOR_KEYWORDS.priorityOrder || []));
        if (match) return match.priority;
        return textMatchesNoColorRule(normalizedText) ? 'NO_COLOR' : '';
    }

    function upgradePriority(priority) {
        if (priority === 'PRIO_JAUNE') return 'PRIO_ORANGE';
        if (priority === 'PRIO_ORANGE') return 'PRIO_ROUGE';
        return priority;
    }

    function capPriority(priority, maxPriority) {
        if (!priority || !maxPriority) return priority;
        if (!Object.prototype.hasOwnProperty.call(PRIORITY_RANK, priority)
            || !Object.prototype.hasOwnProperty.call(PRIORITY_RANK, maxPriority)) return priority;
        return PRIORITY_RANK[priority] > PRIORITY_RANK[maxPriority] ? maxPriority : priority;
    }

    function textMatchesNoColorRule(normalizedText) {
        if (!normalizedText) return false;
        return hasAnyTerm(normalizedText, noColorTerms) || hasAnyTerm(normalizedText, weakOrIgnoreTerms);
    }

    function textMatchesFamilyCancerContext(normalizedText) {
        return hasAnyTerm(normalizedText, familyCancerTerms);
    }

    function applyContextRules(priority, normalizedText) {
        if (!priority) return priority;

        const hasSeverity = hasAnyTerm(normalizedText, severityAmplifiers);
        const hasFamily = hasAnyTerm(normalizedText, familyTerms);
        const hasFamilialHighRisk = hasAnyTerm(normalizedText, familialHighRiskTerms);
        const caps = AUTO_ATCD_COLOR_KEYWORDS.caps || {};

        let next = priority;
        if (hasSeverity && (next === 'PRIO_JAUNE' || next === 'PRIO_ORANGE')) {
            next = upgradePriority(next);
        }

        if (hasFamilialHighRisk && PRIORITY_RANK[next] < PRIORITY_RANK.PRIO_ORANGE) {
            next = 'PRIO_ORANGE';
        }

        if (hasFamily) {
            if (hasFamilialHighRisk) {
                next = capPriority(next, caps.familyHighRiskMax || 'PRIO_ORANGE');
            } else if (textMatchesFamilyCancerContext(normalizedText)) {
                next = capPriority(next, caps.familyCancerMax || 'PRIO_ORANGE');
            } else {
                next = capPriority(next, caps.familyDefaultMax || 'PRIO_JAUNE');
            }
        }

        return next;
    }

    function getCandidateDecisionText(candidate) {
        if (!candidate) return '';
        return normalizeSpaces([
            candidate.title,
            candidate.comment,
            candidate.text,
            candidate.contextText
        ].filter(Boolean).join('\n'));
    }

    function collectDecisionPriorityMatches(normalizedText, codes) {
        const priorityOrder = AUTO_ATCD_COLOR_KEYWORDS.priorityOrder || [];
        const codeMatches = collectPriorityMatchesFromCodes(codes);
        const keywordMatches = collectPriorityMatchesFromKeywords(normalizedText, priorityOrder);
        const strongest = chooseHighestPriorityMatch(codeMatches.concat(keywordMatches));
        if (strongest) return { match: strongest, noColor: false };

        if (textMatchesNoColorRule(normalizedText)) {
            return {
                match: {
                    priority: 'NO_COLOR',
                    source: 'no_color',
                    match: 'NO_COLOR'
                },
                noColor: false
            };
        }

        if (codes && codes.length && DEFAULT_CODED_PRIORITY) {
            return {
                match: {
                    priority: DEFAULT_CODED_PRIORITY,
                    source: 'default_cim10',
                    match: ''
                },
                noColor: false
            };
        }

        return { match: null, noColor: false };
    }

    function decideColorForCandidate(candidate) {
        const normalizedText = normalizeForMatch(getCandidateDecisionText(candidate));
        const codes = candidate && candidate.codes || [];
        const decision = collectDecisionPriorityMatches(normalizedText, codes);
        if (!decision || decision.noColor || !decision.match) return null;

        let priority = decision.match.priority;
        let source = decision.match.source || '';
        const beforeContext = priority;
        priority = applyContextRules(priority, normalizedText);
        if (priority !== beforeContext) source += '+context';
        const color = COLOR_DEFS[priority];
        if (!priority || !color) return null;

        return {
            priority,
            color,
            colorLabel: color.label,
            css: color.css,
            source,
            codes: codes.slice(),
            matched: decision.match.match || ''
        };
    }

    function parseRgb(value) {
        const text = String(value || '').trim();
        const rgb = text.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

        const hex = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
        if (!hex) return null;
        let raw = hex[1];
        if (raw.length === 3) raw = raw.split('').map(ch => ch + ch).join('');
        return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
    }

    function colorDistance(left, right) {
        if (!left || !right) return Infinity;
        return Math.sqrt(
            Math.pow(left[0] - right[0], 2) +
            Math.pow(left[1] - right[1], 2) +
            Math.pow(left[2] - right[2], 2)
        );
    }

    function rgbLooksLikePriority(rgb, priority) {
        if (!rgb || !priority) return false;
        const r = rgb[0], g = rgb[1], b = rgb[2];
        if (priority === 'PRIO_ROUGE') return r >= 190 && g <= 215 && b <= 215 && r >= g && r >= b;
        if (priority === 'PRIO_VIOLET') return b >= 130 && r >= 120 && g <= 215 && (b >= g + 25 || r >= g + 35);
        if (priority === 'PRIO_ORANGE') return r >= 220 && g >= 90 && g <= 235 && b <= 205 && r >= g + 10;
        if (priority === 'PRIO_JAUNE') return r >= 220 && g >= 200 && b <= 220 && Math.abs(r - g) <= 60;
        if (priority === 'NO_COLOR') return r >= 245 && g >= 245 && b >= 245;
        if (priority === 'PRIO_BLANC') return r >= 245 && g >= 245 && b >= 245;
        return false;
    }

    function getComputedColorValues(el) {
        if (!el) return [];
        try {
            const style = ownerWin(el).getComputedStyle(el);
            return [style.color, style.backgroundColor, style.borderColor]
                .map(parseRgb)
                .filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    function visibleElementLooksColor(el, priority) {
        return getComputedColorValues(el).some(rgb => rgbLooksLikePriority(rgb, priority));
    }

    function lineAlreadyLooksColored(candidate, decision) {
        if (!candidate || !decision) return false;
        if (visibleElementLooksColor(candidate.el, decision.priority)) return true;
        try {
            return Array.from(candidate.el.querySelectorAll('span, font, div')).some(el => {
                const title = normalizeForMatch(el.getAttribute && el.getAttribute('title') || '');
                if (title === 'code cim10') return false;
                return visibleElementLooksColor(el, decision.priority);
            });
        } catch (_) {
            return false;
        }
    }

    function elementColorDistanceToTarget(el, colorDef) {
        if (!el || !colorDef) return Infinity;
        const rgbs = getComputedColorValues(el);
        const targets = colorDef.rgbs || [];
        let best = Infinity;
        for (const rgb of rgbs) {
            for (const target of targets) {
                best = Math.min(best, colorDistance(rgb, target));
            }
        }
        return best;
    }

    function isSmallSwatch(el) {
        if (!el || !isVisible(el)) return false;
        try {
            const rect = el.getBoundingClientRect();
            if (rect.width < 6 || rect.height < 6 || rect.width > 90 || rect.height > 90) return false;
            const text = normalizeForMatch(getElementText(el));
            return text.length <= 24;
        } catch (_) {
            return false;
        }
    }

    function getRectSummary(el) {
        if (!el || !el.getBoundingClientRect) return null;
        try {
            const rect = el.getBoundingClientRect();
            return {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            };
        } catch (_) {
            return null;
        }
    }

    function priorityFromElementColors(el) {
        const rgbs = getComputedColorValues(el);
        for (const priority of Object.keys(COLOR_DEFS)) {
            if (rgbs.some(rgb => rgbLooksLikePriority(rgb, priority))) return priority;
        }
        return '';
    }

    function swatchSearchScope(el) {
        let node = el;
        let best = el && el.parentElement;
        for (let depth = 0; node && depth < 4; depth += 1) {
            if (node.querySelectorAll) {
                const swatches = Array.from(node.querySelectorAll('input, button, a, label, [role="button"], [onclick], span, div, td, img'))
                    .filter(candidate => candidate !== node && isSmallSwatch(candidate) && priorityFromElementColors(candidate));
                if (swatches.length >= 3) return node;
                if (swatches.length > 0) best = node;
            }
            node = node.parentElement;
        }
        return best;
    }

    function getNearbyPaletteInfo(el, colorDef) {
        const scope = swatchSearchScope(el);
        const items = [];
        const priorities = new Set();

        if (scope && scope.querySelectorAll) {
            const candidates = [scope].concat(Array.from(scope.querySelectorAll('input, button, a, label, [role="button"], [onclick], span, div, td, img')));
            for (const candidate of candidates) {
                if (!isSmallSwatch(candidate) || !isVisible(candidate) || isDangerousControl(candidate) || isAutoUiElement(candidate)) continue;
                const priority = priorityFromElementColors(candidate);
                if (!priority) continue;
                priorities.add(priority);
                items.push({
                    el: candidate,
                    priority,
                    distance: elementColorDistanceToTarget(candidate, colorDef),
                    clickable: isClickableElement(candidate)
                });
            }
        }

        const targetMatches = items
            .filter(item => item.distance <= 105)
            .sort((a, b) => (a.clickable === b.clickable ? 0 : (a.clickable ? -1 : 1)) || a.distance - b.distance);

        return {
            distinctCount: priorities.size,
            swatchCount: items.length,
            matchesTarget: targetMatches.length > 0,
            bestTarget: targetMatches[0] || null
        };
    }

    function metadataAroundElement(el) {
        const parts = [];
        let node = el;
        let depth = 0;
        while (node && depth < 3) {
            parts.push(getElementMetadataText(node));
            node = node.parentElement;
            depth += 1;
        }
        return normalizeForMatch(parts.join(' '));
    }

    function matchesColorName(meta, colorDef) {
        if (!meta || !colorDef) return false;
        return colorDef.names.some(name => paddedContainsTerm(meta, normalizeForMatch(name)) || meta.includes(normalizeForMatch(name)));
    }

    function isDangerousControl(el) {
        const meta = getElementMetadataText(el);
        return /\b(supprimer|delete|doublon|annuler|cancel|fermer|close|remove)\b/.test(meta);
    }

    function isLikelyAntecedentLine(el) {
        try {
            const root = getWedaAntecedentRoot();
            return root && root.contains(el) && hasAntecedentItemShape(el) && looksLikeAntecedentText(getElementText(el));
        } catch (_) {
            return false;
        }
    }

    function isLikelyColorControl(el, colorDef) {
        if (!el || !isVisible(el) || isAutoUiElement(el) || isDangerousControl(el) || isLikelyAntecedentLine(el)) return false;
        const meta = metadataAroundElement(el);
        const hasColorContext = /\b(couleur|color|forecolor|fontcolor|textcolor|backcolor|priorite|priority)\b/.test(meta);
        const hasTargetName = matchesColorName(meta, colorDef);
        const swatchDistance = elementColorDistanceToTarget(el, colorDef);
        const swatchMatch = isSmallSwatch(el) && swatchDistance <= 105;
        if (hasColorContext && (hasTargetName || swatchMatch)) return true;

        const palette = getNearbyPaletteInfo(el, colorDef);
        return isClickableElement(el) && swatchMatch && palette.distinctCount >= 3 && palette.swatchCount >= 3;
    }

    function dispatchFormEvents(el) {
        if (!el) return;
        const doc = el.ownerDocument || document;
        const view = doc.defaultView || window;
        for (const type of ['input', 'change', 'blur']) {
            try {
                el.dispatchEvent(new view.Event(type, { bubbles: true, cancelable: true }));
            } catch (_) {}
        }
    }

    function setSelectValue(select, option) {
        try {
            select.value = option.value;
            option.selected = true;
            dispatchFormEvents(select);
            return true;
        } catch (_) {
            return false;
        }
    }

    function normalizeHexColorValue(value) {
        const match = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!match) return '';
        let raw = match[1].toLowerCase();
        if (raw.length === 3) raw = raw.split('').map(ch => ch + ch).join('');
        return '#' + raw;
    }

    function getControlOwnMetadataText(el) {
        if (!el) return '';
        const attrs = ['id', 'name', 'class', 'title', 'aria-label', 'placeholder', 'type', 'style', 'data-color', 'data-couleur'];
        return normalizeForMatch(attrs.map(attr => el.getAttribute && el.getAttribute(attr) || '').join(' '));
    }

    function controlMetaLooksColorField(meta, compactMeta) {
        return /\b(couleur|color|colour|hex|fond|background|backcolor|forecolor|fontcolor|textcolor)\b/.test(meta || '')
            || /(couleur|color|colour|backcolor|forecolor|fontcolor|textcolor|colorpicker|colourpicker)/.test(compactMeta || '');
    }

    function isTextLikeInputControl(el) {
        const tag = String(el && el.tagName || '').toLowerCase();
        if (tag === 'textarea') return true;
        if (tag !== 'input') return false;
        const type = String(el.getAttribute && el.getAttribute('type') || 'text').toLowerCase();
        return !['button', 'submit', 'image', 'reset', 'checkbox', 'radio', 'file', 'range'].includes(type);
    }

    function getCandidateMatchTokens(candidate) {
        const ignored = new Set([
            'antecedent', 'antecedents', 'personnel', 'personnels', 'familial', 'familiaux',
            'medical', 'medicaux', 'chirurgical', 'chirurgicaux', 'cim10', 'code', 'codes',
            'lateralite', 'gauche', 'droite', 'date'
        ]);
        return normalizeForMatch(candidate && candidate.text || '')
            .split(/\s+/)
            .filter(token => token.length >= 5 && !ignored.has(token))
            .slice(0, 18);
    }

    function textLooksRelatedToCandidate(text, candidate) {
        const normalized = normalizeForMatch(text);
        if (!normalized) return false;
        const tokens = getCandidateMatchTokens(candidate);
        if (!tokens.length) return false;
        const matched = tokens.filter(token => normalized.includes(token)).length;
        return matched >= Math.min(2, tokens.length);
    }

    function fieldScopeLooksRelated(control, candidate) {
        if (!control || !candidate) return false;
        let node = control.parentElement;
        for (let depth = 0; node && depth < 7; depth += 1) {
            const text = getElementText(node);
            if (textLooksRelatedToCandidate(text, candidate)) return true;
            if (text.length > 5000) break;
            node = node.parentElement;
        }
        return false;
    }

    function describeColorField(control, scoreInfo) {
        if (!control) return null;
        return {
            tag: String(control.tagName || '').toLowerCase(),
            id: control.id || '',
            name: control.getAttribute && control.getAttribute('name') || '',
            type: control.getAttribute && control.getAttribute('type') || '',
            value: normalizeHexColorValue(control.value || control.getAttribute && control.getAttribute('value') || ''),
            meta: limitText(getControlOwnMetadataText(control), 180),
            visible: isVisible(control),
            disabled: !!control.disabled,
            readOnly: !!control.readOnly,
            score: scoreInfo && typeof scoreInfo.score === 'number' ? Math.round(scoreInfo.score) : undefined,
            related: !!(scoreInfo && scoreInfo.related),
            inAntecedents: !!(scoreInfo && scoreInfo.inAntecedents),
            looksColorField: !!(scoreInfo && scoreInfo.looksColorField)
        };
    }

    function findHexColorFieldCandidates(initialDoc, candidate) {
        const root = getWedaAntecedentRoot();
        const controls = queryElementsDeep('input, textarea', initialDoc)
            .filter(control => control && isTextLikeInputControl(control) && !isAutoUiElement(control));
        const out = [];

        for (const control of controls) {
            const currentHex = normalizeHexColorValue(control.value || control.getAttribute && control.getAttribute('value') || '');
            const type = String(control.getAttribute && control.getAttribute('type') || '').toLowerCase();
            const meta = getControlOwnMetadataText(control);
            const compactMeta = meta.replace(/\s+/g, '');
            const looksColorField = controlMetaLooksColorField(meta, compactMeta);
            if (!currentHex && type !== 'color' && !looksColorField) continue;

            const related = fieldScopeLooksRelated(control, candidate);
            const inAntecedents = !!(root && root.contains(control));
            let score = 0;

            if (looksColorField) score -= 100;
            if (/\b(antecedent|antecedents|atcd)\b/.test(meta) || /(antecedent|atcd)/.test(compactMeta)) score -= 35;
            if (/(onglet|modedevie|numero|editiondossier|entete|header)/.test(compactMeta)) score += 90;
            if (type === 'color') score -= 65;
            if (isVisible(control)) score -= 20;
            else score += 35;
            if (inAntecedents) score -= 30;
            if (related) score -= 70;
            else score += 15;
            if (currentHex === '#ffffff') score -= 10;
            if (!currentHex && looksColorField) score -= 25;
            if (control.disabled) score += 120;
            if (control.readOnly) score += 10;

            out.push({ control, value: currentHex, type, meta, related, inAntecedents, looksColorField, score });
        }

        out.sort((a, b) => a.score - b.score);
        return out;
    }

    function setNativeControlValue(control, value) {
        if (!control) return false;
        try {
            const tag = String(control.tagName || '').toLowerCase();
            const win = ownerWin(control);
            const proto = tag === 'textarea'
                ? win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype
                : win.HTMLInputElement && win.HTMLInputElement.prototype;
            const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
            if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(control, value);
            else control.value = value;
            try { control.setAttribute('value', value); } catch (_) {}
            dispatchFormEvents(control);
            return normalizeHexColorValue(control.value || control.getAttribute && control.getAttribute('value') || '') === value;
        } catch (_) {
            return false;
        }
    }

    function normalizeCssColorText(value) {
        return String(value || '').replace(/\s+/g, '').toLowerCase();
    }

    function cssColorToRgbTuple(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;

        const named = {
            red: '#ff0000',
            rouge: '#ff0000',
            orange: '#ffa500',
            yellow: '#ffff00',
            jaune: '#ffff00',
            violet: '#800080',
            purple: '#800080',
            mauve: '#cc99ff',
            magenta: '#ff00cc',
            fuchsia: '#ff00cc',
            white: '#ffffff',
            blanc: '#ffffff',
            transparent: 'rgba(0,0,0,0)'
        };

        const namedValue = named[normalizeForMatch(raw).replace(/\s+/g, '')];
        if (namedValue && namedValue !== raw) return cssColorToRgbTuple(namedValue);

        return parseRgb(raw);
    }

    function rgbTupleToHex(rgb) {
        if (!rgb) return '';
        return '#' + rgb
            .slice(0, 3)
            .map(value => Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, '0'))
            .join('');
    }

    function extractFirstColorFromText(value) {
        const raw = String(value || '');
        const hex = raw.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i);
        if (hex) return hex[0];
        const rgb = raw.match(/rgba?\s*\([^)]+\)/i);
        if (rgb) return rgb[0];
        return '';
    }

    function colorValueLooksEmpty(value) {
        const raw = normalizeCssColorText(value);
        if (!raw) return true;
        if (/^rgba\([^)]*,0(?:\.0+)?\)$/.test(raw)) return true;
        if (['0', '-1', 'none', 'transparent', 'inherit', 'initial', 'unset', '#fff', '#ffffff', 'ffffff', 'white', 'rgb(255,255,255)', 'rgba(255,255,255,1)', 'rgba(0,0,0,0)'].includes(raw)) return true;

        const rgb = cssColorToRgbTuple(value);
        if (!rgb) return false;
        const hex = rgbTupleToHex(rgb);
        return hex === '#ffffff';
    }

    function getWedaColorState(doc = document) {
        const field = (doc || document).querySelector(SELECTOR_WEDA_COLOR_FIELD) || findElementDeep(SELECTOR_WEDA_COLOR_FIELD, doc);
        const preview = (doc || document).querySelector(SELECTOR_WEDA_COLOR_PREVIEW) || findElementDeep(SELECTOR_WEDA_COLOR_PREVIEW, doc);
        let previewStyle = null;
        try { previewStyle = preview ? ownerWin(preview).getComputedStyle(preview) : null; } catch (_) {}

        return {
            value: field ? String(field.value || '') : '',
            fieldDisabled: !!(field && field.disabled),
            previewBackground: previewStyle ? previewStyle.backgroundColor || '' : '',
            previewInlineBackground: preview && preview.style ? preview.style.backgroundColor || preview.style.background || '' : ''
        };
    }

    function findWedaAntecedentPanel() {
        const panel = findElementDeep(SELECTOR_WEDA_ANTECEDENT_PANEL);
        return panel && isVisible(panel) ? panel : null;
    }

    function findWedaColorButton(panel, doc = document) {
        const selectors = [
            SELECTOR_WEDA_COLOR_BUTTON_EXACT,
            'img[alt="Couleur"][onclick*="colorTable"]',
            'img[onclick*="ContentPlaceHolder1_LabelColorGrid"][onclick*="TextBoxGlossaireCouleur"]',
            'img[src*="cp_button.png"]',
            'input[onclick*="colorTable"]',
            'button[onclick*="colorTable"]'
        ];

        for (const selector of selectors) {
            try {
                const local = panel && panel.querySelector ? panel.querySelector(selector) : null;
                if (local && isVisible(local)) return local;
            } catch (_) {}
        }

        for (const selector of selectors) {
            const found = queryElementsDeep(selector, doc)
                .find(el => isVisible(el) && (!panel || panel.contains(el) || selector === SELECTOR_WEDA_COLOR_BUTTON_EXACT));
            if (found) return found;
        }

        return null;
    }

    function findVisibleWedaColorGrid(doc = document) {
        const grid = (doc || document).querySelector(SELECTOR_WEDA_COLOR_GRID) || findElementDeep(SELECTOR_WEDA_COLOR_GRID, doc);
        if (!grid) return null;
        if (isVisible(grid)) return grid;
        try {
            return Array.from(grid.querySelectorAll('*')).some(el => isVisible(el)) ? grid : null;
        } catch (_) {
            return null;
        }
    }

    function getWedaColorOptionColor(el) {
        if (!el) return { css: '', rgb: null };
        let computed = null;
        try { computed = ownerWin(el).getComputedStyle(el); } catch (_) {}
        const candidates = [
            el.getAttribute && el.getAttribute('bgcolor'),
            el.getAttribute && el.getAttribute('data-color'),
            el.getAttribute && el.getAttribute('data-value'),
            el.getAttribute && el.getAttribute('value'),
            el.style && (el.style.backgroundColor || el.style.background),
            computed && computed.backgroundColor,
            computed && computed.borderColor,
            extractFirstColorFromText(el.getAttribute ? el.getAttribute('onclick') || '' : ''),
            extractFirstColorFromText(el.getAttribute ? el.getAttribute('style') || '' : '')
        ].filter(Boolean);

        for (const candidate of candidates) {
            const rgb = cssColorToRgbTuple(candidate);
            if (rgb) return { css: String(candidate), rgb };
        }

        return { css: '', rgb: null };
    }

    function findClickableWedaColorOption(el, grid) {
        if (!el) return null;
        if (el.matches && el.matches('a, button, input, img, td, span, div, [onclick]')) return el;
        const clickable = el.closest ? el.closest('a, button, input, img, td, span, div, [onclick]') : null;
        if (clickable && clickable !== grid) return clickable;
        return el;
    }

    function collectWedaColorGridOptions(grid) {
        if (!grid) return [];

        const selector = 'a, button, input, img, td, th, span, div, label, [onclick], [style*="background"], [bgcolor]';
        const seen = new Set();
        const options = [];

        try {
            Array.from(grid.querySelectorAll(selector)).forEach(el => {
                if (!el || seen.has(el) || el === grid) return;
                seen.add(el);

                const color = getWedaColorOptionColor(el);
                const text = normalizeSpaces(el.innerText || el.textContent || '');
                const onclick = el.getAttribute ? String(el.getAttribute('onclick') || '') : '';
                const value = el.getAttribute ? String(el.getAttribute('value') || el.getAttribute('data-value') || el.getAttribute('data-color') || '') : '';
                const title = el.getAttribute ? String(el.getAttribute('title') || '') : '';
                const alt = el.getAttribute ? String(el.getAttribute('alt') || '') : '';
                const inlineStyle = el.getAttribute ? String(el.getAttribute('style') || '') : '';

                if (!color.rgb && !onclick && !value && !title && !alt && !text) return;

                options.push({
                    el,
                    clickable: findClickableWedaColorOption(el, grid),
                    tag: String(el.tagName || '').toLowerCase(),
                    text,
                    title,
                    alt,
                    value,
                    onclick,
                    inlineStyle,
                    background: color.css,
                    computedHex: rgbTupleToHex(color.rgb),
                    rgb: color.rgb
                });
            });
        } catch (_) {}

        return options;
    }

    function serializeWedaColorOption(option, index = 0) {
        if (!option) return null;
        return {
            index,
            tag: option.tag || '',
            text: option.text || '',
            title: option.title || '',
            alt: option.alt || '',
            value: option.value || '',
            background: option.background || '',
            computedHex: option.computedHex || '',
            onclick: limitText(option.onclick || '', 180),
            inlineStyle: option.inlineStyle || ''
        };
    }

    function scoreWedaColorOptionForPriority(option, priority) {
        if (!option || !option.rgb) return Number.POSITIVE_INFINITY;
        const target = WEDA_PRIORITY_COLOR_TARGETS[priority];
        if (!target) return Number.POSITIVE_INFINITY;

        const targetRgb = cssColorToRgbTuple(target.preferredHex);
        let score = colorDistance(option.rgb, targetRgb);
        const haystack = normalizeForMatch([
            option.text,
            option.title,
            option.alt,
            option.value,
            option.onclick,
            option.inlineStyle,
            option.background,
            option.computedHex
        ].join(' '));

        if (target.label && haystack.includes(normalizeForMatch(target.label))) score -= 120;
        if (target.nameRegex && target.nameRegex.test(haystack)) score -= 90;
        if (priority !== 'NO_COLOR' && priority !== 'PRIO_BLANC' && colorValueLooksEmpty(option.computedHex || option.background || option.value)) score += 300;

        try {
            const rect = option.el && option.el.getBoundingClientRect ? option.el.getBoundingClientRect() : null;
            if (rect) {
                if (rect.width > 80 || rect.height > 80) score += 180;
                if (rect.width < 6 || rect.height < 6) score += 80;
            }
        } catch (_) {}

        const saturation = Math.max(option.rgb[0], option.rgb[1], option.rgb[2]) - Math.min(option.rgb[0], option.rgb[1], option.rgb[2]);
        const brightness = (option.rgb[0] + option.rgb[1] + option.rgb[2]) / 3;
        if (brightness > 150 && saturation < 170) score -= 18;
        if (brightness < 80) score += 80;

        return score;
    }

    function chooseWedaColorOptionForPriority(options, priority) {
        const scored = (options || [])
            .filter(option => option && option.rgb)
            .map((option, index) => ({
                option,
                index,
                score: scoreWedaColorOptionForPriority(option, priority)
            }))
            .filter(entry => Number.isFinite(entry.score))
            .sort((a, b) => a.score - b.score);

        return scored.length ? scored[0] : null;
    }

    async function setAntecedentWedaColorFromPalette(priority, context = {}) {
        const report = {
            at: nowIso(),
            priority,
            attempted: false,
            applied: false,
            method: '',
            colorTried: '',
            reason: '',
            before: null,
            after: null,
            chosen: null,
            options: []
        };

        if (!WEDA_PRIORITY_COLOR_TARGETS[priority]) {
            report.reason = 'Priorite couleur WEDA inconnue.';
            return report;
        }

        report.attempted = true;

        try {
            const panel = await waitFor(() => findWedaAntecedentPanel(), 15000, 250);
            if (!panel) {
                report.reason = 'Panneau antecedent WEDA non ouvert.';
                return report;
            }

            const doc = panel.ownerDocument || document;
            const button = findWedaColorButton(panel, doc);
            if (!button) {
                report.reason = 'Bouton couleur WEDA introuvable.';
                return report;
            }

            report.before = getWedaColorState(doc);

            let grid = findVisibleWedaColorGrid(doc);
            if (!grid) {
                clickElement(button);
                await sleep(200);
                grid = await waitFor(() => findVisibleWedaColorGrid(doc), 5000, 200);
            }

            if (!grid) {
                report.reason = 'Palette couleur WEDA introuvable apres clic.';
                return report;
            }

            const options = collectWedaColorGridOptions(grid);
            const chosen = chooseWedaColorOptionForPriority(options, priority);
            report.options = options.slice(0, 20).map(serializeWedaColorOption);

            if (!chosen || !chosen.option || !chosen.option.clickable) {
                report.reason = 'Aucune couleur exploitable trouvee dans la palette WEDA.';
                return report;
            }

            report.method = 'palette_weda_heidi';
            report.colorTried = chosen.option.computedHex || chosen.option.background || chosen.option.value || WEDA_PRIORITY_COLOR_TARGETS[priority].label;
            report.chosen = serializeWedaColorOption(chosen.option, chosen.index);

            const clicked = clickElement(chosen.option.clickable);
            await sleep(1200);
            report.after = getWedaColorState(doc);
            report.applied = !!clicked;
            return report;
        } catch (e) {
            report.reason = 'Erreur pendant application couleur WEDA.';
            report.error = e && e.message ? e.message : String(e);
            return report;
        }
    }

    async function trySetHexColorField(initialDoc, candidate, decision) {
        const targetHex = normalizeHexColorValue(decision && decision.css || '');
        if (!targetHex) return { ok: false, error: 'Couleur cible invalide.' };

        const fields = findHexColorFieldCandidates(initialDoc, candidate);
        if (!fields.length) {
            return {
                ok: false,
                error: 'Aucun champ couleur hexadecimal trouve dans la fiche ouverte.',
                fieldCandidates: []
            };
        }

        const bestScore = fields[0].score;
        const selectedFields = fields
            .filter((item, index) => index === 0 || (item.score <= bestScore + 35 && item.related && item.value === fields[0].value))
            .slice(0, 3);
        const changed = [];
        const already = [];

        for (const item of selectedFields) {
            if (item.value === targetHex) {
                already.push(item);
                continue;
            }
            if (setNativeControlValue(item.control, targetHex)) {
                changed.push({
                    before: item.value,
                    after: targetHex,
                    field: describeColorField(item.control, item)
                });
            }
        }

        if (changed.length) {
            await waitForWedaIdle(2500);
            return {
                ok: true,
                method: 'champ_hex_couleur',
                control: describeColorField(selectedFields[0].control, selectedFields[0]),
                changedFields: changed,
                fieldCandidates: fields.slice(0, 5).map(item => describeColorField(item.control, item)),
                needsSave: true
            };
        }

        if (already.length) {
            return {
                ok: true,
                method: 'champ_hex_deja_ok',
                control: describeColorField(already[0].control, already[0]),
                fieldCandidates: fields.slice(0, 5).map(item => describeColorField(item.control, item)),
                needsSave: false
            };
        }

        return {
            ok: false,
            error: 'Champ couleur hexadecimal trouve mais non modifiable.',
            fieldCandidates: fields.slice(0, 5).map(item => describeColorField(item.control, item))
        };
    }

    async function trySetColorSelect(initialDoc, decision) {
        const selects = queryElementsDeep('select', initialDoc).filter(isVisible);
        for (const select of selects) {
            const options = Array.from(select.options || []);
            const selectMeta = metadataAroundElement(select);
            const optionColorMatches = new Set();
            for (const option of options) {
                const optionMeta = normalizeForMatch((option.textContent || '') + ' ' + (option.value || ''));
                for (const key of Object.keys(COLOR_DEFS)) {
                    if (matchesColorName(optionMeta, COLOR_DEFS[key])) optionColorMatches.add(key);
                }
            }
            const colorish = /\b(couleur|color|forecolor|fontcolor|textcolor|backcolor|priorite|priority)\b/.test(selectMeta)
                || optionColorMatches.size >= 2;
            if (!colorish) continue;

            const option = options.find(opt => {
                const meta = normalizeForMatch((opt.textContent || '') + ' ' + (opt.value || '') + ' ' + (opt.label || ''));
                return matchesColorName(meta, decision.color);
            });
            if (!option) continue;

            if (setSelectValue(select, option)) {
                await waitForWedaIdle(6000);
                return { ok: true, method: 'select', control: describeElement(select), needsSave: true };
            }
        }
        return { ok: false, error: 'Aucune liste de couleur compatible trouvee.' };
    }

    async function tryClickColorChoice(initialDoc, decision) {
        const selector = [
            'input[type="radio"]',
            'input[type="checkbox"]',
            'input[type="button"]',
            'input[type="submit"]',
            'input[type="image"]',
            'button',
            'a[href]',
            'a[onclick]',
            '[role="button"]',
            '[onclick]',
            'label'
        ].join(',');

        const controls = queryElementsDeep(selector, initialDoc)
            .filter(el => isLikelyColorControl(el, decision.color));

        controls.sort((a, b) => {
            const ad = elementColorDistanceToTarget(a, decision.color);
            const bd = elementColorDistanceToTarget(b, decision.color);
            const am = metadataAroundElement(a);
            const bm = metadataAroundElement(b);
            const aName = matchesColorName(am, decision.color) ? -60 : 0;
            const bName = matchesColorName(bm, decision.color) ? -60 : 0;
            const aInteractive = isClickableElement(a) ? -25 : 0;
            const bInteractive = isClickableElement(b) ? -25 : 0;
            return (ad + aName + aInteractive) - (bd + bName + bInteractive);
        });

        for (const control of controls.slice(0, 8)) {
            let target = control;
            if (!isClickableElement(target)) {
                const clickable = control.closest && control.closest('a, button, label, [onclick], [role="button"]');
                if (clickable) target = clickable;
            }
            if (!target || isDangerousControl(target)) continue;
            if (clickElement(target)) {
                await waitForWedaIdle(8000);
                return { ok: true, method: 'click', control: describeElement(target), needsSave: false };
            }
        }

        return { ok: false, error: 'Aucun bouton/pastille de couleur compatible trouve.' };
    }

    function describeSaveButtonCandidate(item) {
        if (!item || !item.el) return null;
        return {
            element: describeElement(item.el),
            meta: limitText(getElementMetadataText(item.el), 220),
            score: Math.round(item.score),
            inAntecedents: !!item.inAntecedents
        };
    }

    function collectSaveButtonCandidates(initialDoc, candidate) {
        const root = getWedaAntecedentRoot();
        const selectionRelated = !candidate || selectedControlsLookRelated(candidate, initialDoc);
        const controls = queryElementsDeep('input[type="button"], input[type="submit"], input[type="image"], button, a[href], a[onclick], [role="button"]', initialDoc)
            .filter(el => el && isVisible(el) && !isDangerousControl(el) && !isAutoUiElement(el));

        const scored = [];
        for (const el of controls) {
            const meta = getElementMetadataText(el);
            const compactMeta = meta.replace(/\s+/g, '');
            const tag = String(el.tagName || '').toLowerCase();
            const isFormButton = tag === 'button'
                || tag === 'a'
                || tag === 'input'
                || (el.getAttribute && ['button', 'link'].includes(String(el.getAttribute('role') || '').toLowerCase()));
            if (!isFormButton) continue;
            if (/(modifyonglet|modifierlesproprietesdecetonglet|modifyatcd|cliquezpourmodifier|linkbuttonshoweditor|linkbuttonshowmore)/.test(compactMeta)) continue;
            if (/(buttonexit|enregistreretquitter)/.test(compactMeta)) continue;

            let score = 0;
            let saveish = false;

            if (/(contentplaceholder1buttonvalid|buttonvalid)/.test(compactMeta)) {
                score -= 180;
                saveish = true;
            }
            if (/\b(enregistrer|sauvegarder|save|valider|validate|ok)\b/.test(meta)) {
                score -= 90;
                saveish = true;
            }
            if (/\b(update|modifier|modification|mettre a jour|buttonedit|buttonupdate|buttonsave|buttonvalidate|buttonvalider)\b/.test(meta)
                || /(buttonedit|buttonupdate|buttonsave|buttonvalidate|buttonvalider|buttonvalid|buttonmodifier|buttonmodif)/.test(compactMeta)) {
                score -= 60;
                saveish = true;
            }
            if (selectionRelated && (/\b(ajouter|add|buttonadd|buttonajouter)\b/.test(meta)
                || /(buttonadd|buttonajouter|buttoninsert)/.test(compactMeta))) {
                score -= 35;
                saveish = true;
            }

            const inAntecedents = !!(root && root.contains(el));
            if (inAntecedents) score -= 20;
            else score += 15;
            if (/\b(nouveau|new|creer|create|imprimer|print|apercu|preview)\b/.test(meta)) score += 90;

            if (saveish && score < 35) scored.push({ el, score, inAntecedents });
        }

        scored.sort((a, b) => a.score - b.score);
        return scored;
    }

    function findBestSaveButton(initialDoc, candidate) {
        const scored = collectSaveButtonCandidates(initialDoc, candidate);
        return scored.length ? scored[0].el : null;
    }

    function findVisibleWedaValidButton(initialDoc) {
        const direct = findElementDeep(SELECTOR_WEDA_VALID, initialDoc);
        if (direct && isVisible(direct) && !direct.disabled) return direct;

        return queryElementsDeep('input[type="button"], input[type="submit"], button, a[href], a[onclick], [role="button"]', initialDoc)
            .find(el => {
                if (!el || !isVisible(el) || el.disabled || isDangerousControl(el) || isAutoUiElement(el)) return false;
                const compactMeta = getElementMetadataText(el).replace(/\s+/g, '');
                return /(contentplaceholder1buttonvalid|buttonvalid)/.test(compactMeta);
            }) || null;
    }

    async function waitForWedaAntecedentPanelClosed(timeoutMs = 9000) {
        const closed = await waitFor(() => !findWedaAntecedentPanel(), timeoutMs, 250);
        return !!closed || !findWedaAntecedentPanel();
    }

    async function clickSaveIfPresent(initialDoc, candidate) {
        const saveButton = await waitFor(() => findVisibleWedaValidButton(initialDoc), 6000, 250)
            || findBestSaveButton(initialDoc, candidate);
        if (!saveButton) return false;
        clickElement(saveButton);
        await waitForWedaIdle(15000);
        await sleep(900);

        if (saveButton.id === 'ContentPlaceHolder1_ButtonValid' || /buttonvalid/i.test(getElementMetadataText(saveButton))) {
            return await waitForWedaAntecedentPanelClosed(9000);
        }

        return !findWedaAntecedentPanel();
    }

    function describeDebugElement(el, decision) {
        if (!el) return null;
        let value = '';
        try { value = el.value || ''; } catch (_) {}
        return {
            tag: String(el.tagName || '').toLowerCase(),
            id: el.id || '',
            name: el.getAttribute && el.getAttribute('name') || '',
            type: el.getAttribute && el.getAttribute('type') || '',
            role: el.getAttribute && el.getAttribute('role') || '',
            className: String(el.className || '').slice(0, 120),
            title: el.getAttribute && el.getAttribute('title') || '',
            value: limitText(value, 80),
            text: limitText(getElementText(el), 120),
            meta: limitText(metadataAroundElement(el), 180),
            rect: getRectSummary(el),
            colors: getComputedColorValues(el),
            swatchPriority: priorityFromElementColors(el),
            targetDistance: decision ? elementColorDistanceToTarget(el, decision.color) : null,
            clickable: isClickableElement(el),
            visible: isVisible(el)
        };
    }

    function summarizeWedaColorReport(report) {
        if (!report) return null;
        return {
            priority: report.priority || '',
            attempted: !!report.attempted,
            applied: !!report.applied,
            method: report.method || '',
            colorTried: report.colorTried || '',
            reason: report.reason || '',
            error: report.error || '',
            before: report.before || null,
            after: report.after || null,
            chosen: report.chosen || null,
            options: Array.isArray(report.options) ? report.options.slice(0, 12) : []
        };
    }

    function buildColorControlDebugSnapshot(initialDoc, decision, candidate, colorReport) {
        const doc = initialDoc || document;
        const panel = findWedaAntecedentPanel();
        const colorButton = panel ? findWedaColorButton(panel, doc) : null;
        const grid = findVisibleWedaColorGrid(doc);
        const validButton = findVisibleWedaValidButton(doc);

        return {
            decision: decision ? {
                priority: decision.priority,
                color: decision.colorLabel,
                source: decision.source,
                matched: decision.matched || ''
            } : null,
            selectedText: limitText(getSelectedControlText(doc), 360),
            weda: {
                panelFound: !!panel,
                colorButton: colorButton ? describeElement(colorButton) : null,
                gridFound: !!grid,
                colorState: getWedaColorState(doc),
                validButton: validButton ? describeElement(validButton) : null,
                paletteOptions: grid ? collectWedaColorGridOptions(grid).slice(0, 12).map(serializeWedaColorOption) : [],
                colorReport: summarizeWedaColorReport(colorReport)
            }
        };
    }

    async function applyColorToCurrentSelection(candidate, decision) {
        const initialDoc = candidate && candidate.doc || document;
        const paletteResult = await setAntecedentWedaColorFromPalette(decision && decision.priority, {
            section: candidate && candidate.sectionLabel || '',
            text: candidate && limitText(candidate.text, 220) || '',
            decision: decision ? {
                priority: decision.priority,
                color: decision.colorLabel,
                source: decision.source,
                matched: decision.matched || ''
            } : null
        });

        if (!paletteResult || !paletteResult.applied) {
            return {
                ok: false,
                error: paletteResult && paletteResult.reason ? paletteResult.reason : 'Couleur WEDA non appliquee.',
                debugSnapshot: buildColorControlDebugSnapshot(initialDoc, decision, candidate, paletteResult),
                colorReport: summarizeWedaColorReport(paletteResult)
            };
        }

        const saved = await clickSaveIfPresent(initialDoc, candidate);
        if (!saved) {
            return {
                ok: false,
                error: 'Couleur appliquee dans la palette, mais validation WEDA non confirmee.',
                debugSnapshot: buildColorControlDebugSnapshot(initialDoc, decision, candidate, paletteResult),
                colorReport: summarizeWedaColorReport(paletteResult)
            };
        }

        return {
            ok: true,
            method: paletteResult.method || 'palette_weda_heidi',
            control: paletteResult.chosen || null,
            saved: true,
            colorReport: summarizeWedaColorReport(paletteResult)
        };
    }

    async function colorOneCandidate(candidate, decision, report) {
        const attempt = {
            at: nowIso(),
            action: 'color',
            section: candidate.sectionLabel,
            text: limitText(candidate.text, 320),
            decisionText: limitText(getCandidateDecisionText(candidate), 420),
            codes: candidate.codes.slice(),
            target: describeElement(candidate.target),
            signature: candidate.signature,
            priority: decision.priority,
            color: decision.colorLabel,
            source: decision.source,
            matched: decision.matched || '',
            alreadyColored: false,
            colored: false,
            method: '',
            warning: '',
            error: ''
        };
        report.attempts.push(attempt);

        showBadge('Colorisation ' + decision.colorLabel + '\n' + candidate.sectionLabel + '\n' + limitText(candidate.text, 180), {
            duration: 7000,
            abovePanel: true
        });

        clickElement(candidate.target);
        await waitForWedaIdle(10000);
        await sleep(500);
        const afterSelectError = detectWedaErrorPage();
        if (afterSelectError) {
            attempt.error = 'WEDA affiche une page d’erreur apres selection de la ligne a colorer.';
            attempt.wedaError = afterSelectError;
            report.failedColorCount += 1;
            logEvent('error', attempt.error, afterSelectError);
            return false;
        }

        if (!selectedControlsLookRelated(candidate, candidate.doc)) {
            attempt.warning = 'La fiche selectionnee ne peut pas etre confirmee par les champs visibles.';
            logEvent('warn', attempt.warning, {
                candidate: limitText(candidate.text, 220),
                selectedText: limitText(getSelectedControlText(candidate.doc), 320)
            });
            if (STRICT_SELECTION_CONFIRMATION) {
                attempt.error = 'Colorisation bloquee par securite : selection non confirmee.';
                report.failedColorCount += 1;
                return false;
            }
        }

        const applied = await applyColorToCurrentSelection(candidate, decision);
        if (!applied || !applied.ok) {
            attempt.error = applied && applied.error ? applied.error : 'Controle de couleur introuvable.';
            attempt.debugSnapshot = applied && applied.debugSnapshot ? applied.debugSnapshot : null;
            report.failedColorCount += 1;
            logEvent('error', 'Colorisation impossible.', {
                error: attempt.error,
                section: candidate.sectionLabel,
                text: limitText(candidate.text, 220),
                decisionText: limitText(getCandidateDecisionText(candidate), 360),
                codes: candidate.codes.slice(),
                decision: {
                    priority: decision.priority,
                    color: decision.colorLabel,
                    source: decision.source,
                    matched: decision.matched || ''
                },
                debugSnapshot: attempt.debugSnapshot
            });
            return false;
        }

        const afterColorError = detectWedaErrorPage();
        if (afterColorError) {
            attempt.error = 'WEDA affiche une page d’erreur apres application de la couleur.';
            attempt.wedaError = afterColorError;
            report.failedColorCount += 1;
            logEvent('error', attempt.error, afterColorError);
            return false;
        }

        attempt.colored = true;
        attempt.method = applied.method || '';
        attempt.control = applied.control || null;
        attempt.saved = !!applied.saved;
        report.coloredCount += 1;
        await waitForWedaIdle(12000);
        await sleep(500);
        return true;
    }

    function buildDiagnostic() {
        const root = getWedaAntecedentRoot();
        const items = collectAntecedentItems({ limit: 300 });
        const ignoredCandidates = items.filter(candidate => !candidate.hasCim10).map(candidate => ({
            section: candidate.sectionLabel,
            text: limitText(candidate.text, 260),
            target: describeElement(candidate.target),
            signature: candidate.signature
        }));
        const colorCandidates = items.filter(candidate => candidate.hasCim10).map(candidate => {
            const decision = decideColorForCandidate(candidate);
            return {
                section: candidate.sectionLabel,
                text: limitText(candidate.text, 260),
                decisionText: limitText(getCandidateDecisionText(candidate), 320),
                codes: candidate.codes,
                decision: decision ? {
                    priority: decision.priority,
                    color: decision.colorLabel,
                    source: decision.source,
                    matched: decision.matched || ''
                } : null,
                target: describeElement(candidate.target),
                signature: candidate.signature
            };
        });

        const headers = [];
        if (root) {
            Array.from(root.querySelectorAll('.sma, [title*="Type de l"]')).forEach(el => {
                const header = isSectionHeader(el);
                if (header) {
                    headers.push({
                        label: header.label,
                        normalized: header.normalized,
                        text: limitText(getElementText(el), 220)
                    });
                }
            });
        }

        const colorControls = queryElementsDeep('select, input, button, a, [onclick], [role="button"], span, div, td')
            .filter(el => isVisible(el) && !isAutoUiElement(el))
            .filter(el => /\b(couleur|color|forecolor|fontcolor|textcolor|backcolor|priorite|priority|rouge|violet|orange|jaune|red|purple|yellow)\b/.test(metadataAroundElement(el)) || isSmallSwatch(el))
            .slice(0, 80)
            .map(el => ({
                element: describeElement(el),
                meta: limitText(metadataAroundElement(el), 220),
                colors: getComputedColorValues(el)
            }));

        return {
            version: VERSION,
            keywordVersion: AUTO_ATCD_COLOR_KEYWORDS.version,
            url: window.location.href,
            isAntecedentPage: !!root,
            headers,
            ignoredCandidates,
            colorCandidates,
            colorControls
        };
    }

    async function startCleanup(options = {}) {
        if (!isWeda()) {
            return makeResult('error', 'Ce script ne fonctionne que sur WEDA.', options, { ignoredCount: 0 });
        }

        const initialWedaError = detectWedaErrorPage();
        if (initialWedaError) {
            logEvent('error', 'Traitement bloque : WEDA est deja sur une page d’erreur.', initialWedaError);
            return makeResult('error', 'WEDA affiche deja une page d’erreur.', options, {
                ignoredCount: 0,
                wedaError: initialWedaError
            });
        }

        if (runtime.running) {
            return makeResult('error', 'Un traitement est deja en cours sur cet onglet.', options, { ignoredCount: 0 });
        }

        runtime.running = true;
        runtime.stopRequested = false;
        renderPanel();

        const startedAt = nowMs();
        const report = {
            id: options.commandId || ('color_' + Date.now() + '_' + Math.floor(Math.random() * 1000000)),
            version: VERSION,
            keywordVersion: AUTO_ATCD_COLOR_KEYWORDS.version,
            source: options.source || 'manual',
            batchId: options.batchId || '',
            patientId: options.patientId || '',
            patientName: options.patientName || '',
            status: 'running',
            startedAt,
            startedAtIso: nowIso(),
            finishedAt: null,
            url: window.location.href,
            coloredCount: 0,
            alreadyColoredCount: 0,
            skippedColorCount: 0,
            failedColorCount: 0,
            ignoredCount: 0,
            codedCount: 0,
            attempts: [],
            diagnostics: null,
            message: ''
        };

        try {
            const root = await waitFor(() => getWedaAntecedentRoot(), 20000, 300);
            if (!root) {
                return publishResult(Object.assign(report, {
                    status: 'error',
                    finishedAt: nowMs(),
                    message: 'Page Antecedents introuvable.'
                }));
            }

            await waitForWedaIdle(10000);
            report.ignoredCount = collectUncodedCandidates({ limit: 1000 }).length;

            const processedColorSignatures = new Set();
            showBadge('Colorisation des antecedents CIM10...', {
                duration: 5000,
                abovePanel: true
            });

            for (let pass = 1; pass <= MAX_COLOR_PASSES; pass += 1) {
                if (runtime.stopRequested) {
                    report.message = 'Traitement arrete a la demande.';
                    break;
                }

                if (nowMs() - startedAt > CLEANUP_TIMEOUT_MS) {
                    report.message = 'Timeout du traitement.';
                    break;
                }

                const candidate = collectColorCandidates({ limit: 1000 })
                    .find(item => !processedColorSignatures.has(item.signature));
                if (!candidate) break;

                processedColorSignatures.add(candidate.signature);
                const decision = decideColorForCandidate(candidate);
                if (!decision) {
                    report.skippedColorCount += 1;
                    logEvent('warn', 'Colorisation ignoree : decision couleur impossible.', {
                        section: candidate.sectionLabel,
                        text: limitText(candidate.text, 220),
                        codes: candidate.codes.slice()
                    });
                    report.attempts.push({
                        at: nowIso(),
                        action: 'skip_color',
                        section: candidate.sectionLabel,
                        text: limitText(candidate.text, 320),
                        codes: candidate.codes.slice(),
                        signature: candidate.signature,
                        message: 'Decision couleur impossible.'
                    });
                    continue;
                }

                await colorOneCandidate(candidate, decision, report);
                renderPanel();
                await sleep(650);
            }

            report.ignoredCount = collectUncodedCandidates({ limit: 1000 }).length;
            report.codedCount = collectColorCandidates({ limit: 1000 }).length;
            report.finishedAt = nowMs();
            report.finishedAtIso = nowIso();
            report.diagnostics = buildDiagnostic();

            if (runtime.stopRequested) {
                report.status = report.failedColorCount ? 'stopped' : 'success';
            } else if (report.message && report.failedColorCount > 0) {
                report.status = 'error';
            } else if (STRICT_COLOR_APPLICATION && report.failedColorCount > 0) {
                report.status = 'error';
                report.message = report.failedColorCount + " antecedent(s) CIM10 n'ont pas pu etre colores.";
            } else {
                report.status = 'success';
                report.message = report.coloredCount + ' colore(s), ' + report.skippedColorCount + ' sans decision, ' + report.ignoredCount + ' sans CIM10 ignore(s).';
            }

            logEvent(report.status === 'success' ? 'success' : 'warn', 'Traitement patient termine.', {
                status: report.status,
                message: report.message,
                coloredCount: report.coloredCount,
                skippedColorCount: report.skippedColorCount,
                failedColorCount: report.failedColorCount,
                ignoredCount: report.ignoredCount
            });
            return publishResult(report);
        } catch (e) {
            report.status = 'error';
            report.finishedAt = nowMs();
            report.finishedAtIso = nowIso();
            report.message = e && e.message ? e.message : String(e);
            logEvent('error', 'Exception pendant le traitement patient.', {
                message: report.message,
                stack: e && e.stack ? String(e.stack).slice(0, 2000) : ''
            });
            return publishResult(report);
        } finally {
            runtime.running = false;
            runtime.stopRequested = false;
            renderPanel();
        }
    }

    function makeResult(status, message, options, patch) {
        return publishResult(Object.assign({
            id: options && options.commandId || ('color_' + Date.now() + '_' + Math.floor(Math.random() * 1000000)),
            version: VERSION,
            keywordVersion: AUTO_ATCD_COLOR_KEYWORDS.version,
            source: options && options.source || 'manual',
            batchId: options && options.batchId || '',
            patientId: options && options.patientId || '',
            patientName: options && options.patientName || '',
            status,
            message,
            startedAt: nowMs(),
            finishedAt: nowMs(),
            url: window.location.href,
            attempts: []
        }, patch || {}));
    }

    function publishResult(report) {
        const finalReport = Object.assign({}, report, {
            updatedAt: nowMs(),
            updatedAtIso: nowIso()
        });

        gmSetJson(KEY_RESULT, finalReport);
        gmSetJson(KEY_LAST_REPORT, finalReport);
        if (finalReport.id) {
            gmSetJson(KEY_LAST_COMMAND_ID, finalReport.id);
        }

        const ok = finalReport.status === 'success';
        showBadge(finalReport.message || (ok ? 'Traitement termine.' : 'Traitement interrompu.'), {
            error: !ok,
            duration: ok ? 7000 : 12000,
            abovePanel: true
        });

        try {
            console.log(LOG_PREFIX, 'RESULT', finalReport);
        } catch (_) {}

        return finalReport;
    }

    function clickGotoAntecedents() {
        const direct = queryElementsDeep(SELECTOR_GOTO_ANTECEDENTS).find(isVisible);
        if (direct) {
            clickElement(direct);
            return true;
        }

        const postback = getDoPostBack();
        if (postback) {
            try {
                postback('ctl00$ContentPlaceHolder1$ButtonGotoAntecedent', '');
                return true;
            } catch (_) {}
        }

        return false;
    }

    async function openAntecedentsAndStart(options = {}) {
        const wedaError = detectWedaErrorPage();
        if (wedaError) {
            logEvent('error', 'Ouverture antecedents impossible : WEDA affiche une page d’erreur.', wedaError);
            return makeResult('error', 'WEDA affiche deja une page d’erreur.', options, {
                ignoredCount: 0,
                wedaError
            });
        }

        if (isAntecedentPageWeda()) return startCleanup(options);

        const clicked = clickGotoAntecedents();
        if (!clicked) {
            logEvent('error', 'Bouton Antecedents introuvable.');
            return makeResult('error', 'Impossible d’ouvrir la page Antecedents.', options, { ignoredCount: 0 });
        }

        const ready = await waitFor(() => isAntecedentPageWeda(), 30000, 400);
        if (!ready) {
            const afterNavError = detectWedaErrorPage();
            logEvent('error', 'Page Antecedents non chargee.', afterNavError || { url: window.location.href });
            return makeResult('error', 'Timeout : page Antecedents non chargee.', options, { ignoredCount: 0 });
        }

        return startCleanup(options);
    }

    function handleCommand(rawCommand) {
        const command = parseMaybeJson(rawCommand, null);
        if (!command || command.action !== 'start') return;
        if (!command.id) {
            logEvent('warn', 'Commande ignoree : identifiant manquant.', { command });
            return;
        }
        if (runtime.lastCommandId === command.id || gmGetJson(KEY_LAST_COMMAND_ID, '') === command.id) return;

        const wedaError = detectWedaErrorPage();
        if (wedaError) {
            gmSetJson(KEY_LAST_COMMAND_ID, command.id);
            runtime.lastCommandId = command.id;
            logEvent('error', 'Commande ignoree : WEDA affiche deja une page d’erreur.', wedaError);
            makeResult('error', 'WEDA affiche deja une page d’erreur.', {
                source: command.source || 'command',
                commandId: command.id,
                batchId: command.batchId || '',
                patientId: command.patientId || '',
                patientName: command.patientName || ''
            }, { wedaError, ignoredCount: 0 });
            return;
        }

        const commandTs = Number(command.ts || 0);
        if (commandTs && commandTs < SCRIPT_STARTED_AT - COMMAND_INIT_GRACE_MS) {
            gmSetJson(KEY_LAST_COMMAND_ID, command.id);
            runtime.lastCommandId = command.id;
            logEvent('warn', 'Commande ignoree : commande anterieure au chargement du script.', {
                commandId: command.id,
                source: command.source || '',
                commandTs,
                scriptStartedAt: SCRIPT_STARTED_AT
            });
            return;
        }
        if (commandTs && nowMs() - commandTs > COMMAND_MAX_AGE_MS) {
            gmSetJson(KEY_LAST_COMMAND_ID, command.id);
            runtime.lastCommandId = command.id;
            logEvent('warn', 'Commande ignoree : commande trop ancienne.', {
                commandId: command.id,
                source: command.source || '',
                ageMs: nowMs() - commandTs
            });
            return;
        }

        runtime.lastCommandId = command.id;

        openAntecedentsAndStart({
            source: command.source || 'command',
            commandId: command.id,
            batchId: command.batchId || '',
            patientId: command.patientId || '',
            patientName: command.patientName || ''
        });
    }

    function installCommandWatcher() {
        try {
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(KEY_COMMAND, (_name, _oldValue, newValue) => {
                    handleCommand(newValue);
                });
            }
        } catch (e) {
            logEvent('warn', 'Impossible d’installer l’ecouteur de commande Tampermonkey.', {
                error: e && e.message ? e.message : String(e)
            });
        }

        setInterval(() => {
            try {
                handleCommand(gmGetJson(KEY_COMMAND, null));
            } catch (e) {
                logEvent('error', 'Erreur pendant le polling de commande.', {
                    error: e && e.message ? e.message : String(e),
                    stack: e && e.stack ? String(e.stack).slice(0, 1200) : ''
                });
            }
        }, 1500);
    }

    function exposeConsoleFunctions() {
        const api = {
            AUTO_ATCD_CIM10_COLOR_START: startCleanup,
            AUTO_ATCD_CIM10_COLOR_OPEN_AND_START: openAntecedentsAndStart,
            AUTO_ATCD_CIM10_COLOR_DIAG: () => {
                const report = buildDiagnostic();
                console.log(LOG_PREFIX, 'DIAG', report);
                return report;
            },
            AUTO_ATCD_CIM10_COLOR_STOP: () => {
                runtime.stopRequested = true;
                return true;
            },
            AUTO_ATCD_CIM10_COLOR_LAST: () => {
                const report = gmGetJson(KEY_LAST_REPORT, null);
                console.log(LOG_PREFIX, 'LAST', report);
                return report;
            },
            AUTO_ATCD_CIM10_COLOR_LOGS: () => {
                const logs = getLogs();
                console.log(LOG_PREFIX, 'LOGS', logs);
                return logs;
            },
            AUTO_ATCD_CIM10_COLOR_COPY_LOGS: copyAllLogs,
            AUTO_ATCD_CIM10_COLOR_LOG: (level, message, details) => logEvent(level || 'info', message || 'Log manuel.', details || null),
            AUTO_ATCD_CIM10_COLOR_CLEAR: () => {
                gmDelete(KEY_COMMAND);
                gmDelete(KEY_RESULT);
                gmDelete(KEY_LAST_REPORT);
                gmDelete(KEY_LAST_COMMAND_ID);
                clearLogs();
                return true;
            },

            // Alias conserves pour que le batch existant appelle ce script sans modification.
            AUTO_ATCD_NON_CIM10_CLEAN_START: startCleanup,
            AUTO_ATCD_NON_CIM10_CLEAN_OPEN_AND_START: openAntecedentsAndStart,
            AUTO_ATCD_NON_CIM10_CLEAN_DIAG: () => {
                const report = buildDiagnostic();
                console.log(LOG_PREFIX, 'DIAG', report);
                return report;
            },
            AUTO_ATCD_NON_CIM10_CLEAN_STOP: () => {
                runtime.stopRequested = true;
                return true;
            },
            AUTO_ATCD_NON_CIM10_CLEAN_LAST: () => {
                const report = gmGetJson(KEY_LAST_REPORT, null);
                console.log(LOG_PREFIX, 'LAST', report);
                return report;
            },
            AUTO_ATCD_NON_CIM10_CLEAN_LOGS: () => {
                const logs = getLogs();
                console.log(LOG_PREFIX, 'LOGS', logs);
                return logs;
            },
            AUTO_ATCD_NON_CIM10_CLEAN_COPY_LOGS: copyAllLogs,
            AUTO_ATCD_NON_CIM10_CLEAN_CLEAR: () => {
                gmDelete(KEY_COMMAND);
                gmDelete(KEY_RESULT);
                gmDelete(KEY_LAST_REPORT);
                gmDelete(KEY_LAST_COMMAND_ID);
                clearLogs();
                return true;
            }
        };

        try { Object.assign(window, api); } catch (_) {}
        try { if (typeof unsafeWindow !== 'undefined') Object.assign(unsafeWindow, api); } catch (_) {}
    }

    function init() {
        if (!isWeda()) return;

        const wedaError = detectWedaErrorPage();
        if (wedaError) {
            logEvent('error', 'WEDA affiche une page d’erreur au chargement du script.', wedaError);
        }

        try {
            window.addEventListener('error', event => {
                logEvent('error', 'Erreur JavaScript capturee.', {
                    message: event && event.message ? event.message : '',
                    filename: event && event.filename ? event.filename : '',
                    lineno: event && event.lineno || 0,
                    colno: event && event.colno || 0
                });
            });
            window.addEventListener('unhandledrejection', event => {
                const reason = event && event.reason;
                logEvent('error', 'Promesse JavaScript rejetee.', {
                    reason: reason && reason.message ? reason.message : String(reason || ''),
                    stack: reason && reason.stack ? String(reason.stack).slice(0, 1200) : ''
                });
            });
        } catch (_) {}

        exposeConsoleFunctions();
        installCommandWatcher();

        if (isTopWindow()) {
            setInterval(() => {
                try {
                    if (isAntecedentPageWeda()) installPanel();
                    else removePanel();
                    renderPanel();
                } catch (_) {}
            }, 2000);
            if (isAntecedentPageWeda()) installPanel();
        }
    }

    init();
})();


