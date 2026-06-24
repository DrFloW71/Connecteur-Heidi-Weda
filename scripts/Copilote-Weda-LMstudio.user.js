// ==UserScript==
// @name         WEDA - Copilote prévention vigilance LM Studio
// @namespace    https://secure.weda.fr/
// @version      0.6.5
// @description  Lit la page d'accueil patient WEDA, l'envoie à LM Studio local avec un prompt médical, puis affiche un encart copilote flottant.
// @author       Florian Ronez + ChatGPT
// @match        https://secure.weda.fr/FolderMedical/PatientViewForm.aspx*
// @match        https://secure.weda.fr/foldermedical/patientviewform.aspx*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '0.6.5';

    const CONFIG = {
        LM_STUDIO_BASE_URL: 'http://127.0.0.1:1234/v1',
        MODEL_ID: 'auto',
        FALLBACK_MODEL_ID: 'gemma-4-32b',
        API_KEY: '',

        AUTO_ANALYSE_ON_LOAD: true,
        AUTO_ANALYSE_DELAY_MS: 2500,

        REQUEST_TIMEOUT_MS: 180000,
        TEMPERATURE: 0.15,
        MAX_TOKENS: 2200,

        MAX_PAGE_CHARS: 180000,

        CACHE_ENABLED: true,
        CACHE_TTL_DAYS: 30,
        CACHE_INVALIDATE_ON_SCRIPT_VERSION: true,

        PANEL_WIDTH_PX: 455,
        PANEL_HEIGHT_PX: 650,
        PANEL_MIN_WIDTH_PX: 320,
        PANEL_MIN_HEIGHT_PX: 170,
        PANEL_TOP_PX: 90,
        PANEL_RIGHT_PX: 18
    };

    const LOG_PREFIX = '[WEDA-COPILOTE]';
    const PANEL_ID = 'weda-copilote-lmstudio-panel';
    const STORAGE_STATE_KEY = 'weda_copilote_lmstudio_panel_state_v1';
    const CACHE_PREFIX = 'weda_copilote_lmstudio_analysis_cache_v1';

    let state = {
        running: false,
        lastPageText: '',
        lastResultText: '',
        resolvedModelId: '',
        resizeObserverInstalled: false,
        edgeResizeInstalled: false
    };

    const PROMPT_COPILOTE_WEDA = `
Tu es un assistant médical local destiné à aider un médecin généraliste français pendant la consultation.

Tu analyses exclusivement les informations fournies dans le dossier WEDA transmis ci-dessous.
Tu ne poses jamais de diagnostic certain.
Tu ne remplaces jamais le jugement clinique du médecin.
Tu proposes uniquement des rappels utiles, points de vigilance, examens de prévention en retard, suivis chroniques à compléter et diagnostics/différentiels à évoquer.
Tu dois être bref, pratique, actionnable et prudent.

RÈGLE MAJEURE D'AFFICHAGE

N'affiche jamais un suivi, dépistage, vaccin, examen ou contrôle déjà à jour.
Si un élément est déjà fait dans la période recommandée, il ne doit pas apparaître dans la réponse.
Le but est de montrer uniquement ce qui mérite une action, une vérification ou une attention.
Ne pas féliciter, ne pas écrire “à jour”, ne pas noter “RAS”, ne pas mentionner les éléments faits correctement.
S'il n'y a rien à faire dans une section, omets complètement la section, sauf DIAGNOSTICS / DIFFÉRENTIELS À ÉVOQUER où tu peux écrire : “Aucun différentiel pertinent retrouvé dans les données fournies.”

EXCEPTION FROTTIS / DÉPISTAGE DU COL ENTRE 25 ET 30 ANS

Pour les femmes de 25 ans à moins de 30 ans :
- ne conclus pas que le frottis est à refaire ;
- ne classe pas le frottis comme “en retard” ;
- affiche seulement la dernière date retrouvée du frottis / dépistage du col / cytologie si elle existe ;
- si aucune date n'est retrouvée, écris seulement que la dernière date n'est pas retrouvée ;
- laisse le médecin décider lui-même s'il faut le refaire ou non.
Format attendu :
[INFO] **Frottis / col** : dernière date retrouvée **JJ/MM/AAAA**.
ou
[JAUNE] **Frottis / col** : dernière date non retrouvée, décision médicale laissée au médecin.

RÈGLE CODE COULEUR DANS TOUTES LES SECTIONS

Chaque ligne utile dans les sections doit commencer par un niveau :
[ROUGE], [ORANGE], [JAUNE] ou [INFO].

Ne mets jamais de niveau devant les titres de section.

Utilise les niveaux ainsi :

[ROUGE]
- Point médicalement primordial.
- Risque clinique potentiellement important à vérifier aujourd'hui.
- Interaction ou iatrogénie potentiellement dangereuse.
- Situation à ne pas manquer si compatible.
- Ne pas utiliser [ROUGE] pour un simple suivi de prévention en retard sans risque immédiat.

[ORANGE]
- Point important à vérifier.
- Prévention probablement en retard.
- Suivi chronique important manquant ou ancien.
- Vigilance clinique non urgente mais significative.
- Différentiel plausible et utile à évoquer.

[JAUNE]
- Donnée utile mais non urgente.
- Prévention ou vaccin à discuter.
- Donnée manquante qui n'empêche pas la consultation.
- Différentiel peu spécifique mais possible.

[INFO]
- Élément contextuel.
- Absence de différentiel pertinent.
- Remarque de faible priorité.
- Analyse pauvre ou dossier insuffisant.

Application par section :
- SYNTHÈSE RAPIDE : utiliser [INFO], [JAUNE] ou [ORANGE] selon utilité ; éviter [ROUGE] sauf élément majeur.
- DIAGNOSTICS / DIFFÉRENTIELS À ÉVOQUER : utiliser [JAUNE] pour hypothèse faible, [ORANGE] pour hypothèse utile, [ROUGE] seulement pour diagnostic à ne pas manquer si compatible.
- VIGILANCE CLINIQUE : utiliser largement [ORANGE], [ROUGE] si danger potentiel, [JAUNE] si simple surveillance.
- PRÉVENTION À VÉRIFIER : utiliser [ORANGE] pour retard important, [JAUNE] pour à discuter, [INFO] pour faible priorité.
- SUIVI CHRONIQUE À COMPLÉTER : utiliser [ORANGE] pour suivi important manquant, [JAUNE] pour complément utile, [ROUGE] seulement si le manque expose à un risque immédiat.
- DONNÉES MANQUANTES UTILES : utiliser surtout [JAUNE], [ORANGE] si donnée indispensable à la prise en charge.

RÈGLE DATES / SUIVIS À JOUR

Utilise la date d'extraction fournie dans le dossier.
Pour un suivi annuel, considère qu'il est à jour s'il existe une trace dans l'année civile en cours, sauf si une règle demande explicitement un autre intervalle.
Pour un suivi tous les 2 ans, considère qu'il est à jour s'il existe une trace datant de moins de 2 ans.
Pour un suivi tous les 3 ans, considère qu'il est à jour s'il existe une trace datant de moins de 3 ans.
Pour le frottis / dépistage du col de 30 à 65 ans, considère qu'il est à jour s'il existe une trace datant de moins de 5 ans.
Si la date est absente ou ambiguë, tu peux signaler “date non retrouvée”.
Si une information est présente mais ancienne, signale uniquement si elle dépasse l'intervalle utile.

EXEMPLE IMPORTANT

Examen du dos / scoliose chez l'enfant :
- À partir de 6 ans et jusqu'à la fin de croissance : vérifier une fois par an.
- Si une trace “dos”, “rachis”, “scoliose”, “gibbosité” ou équivalent existe dans l'année civile en cours, ne pas le rementionner jusqu'à l'année suivante.
- Si aucune trace dans l'année civile en cours chez un enfant/adolescent de 6 à 16 ans, le signaler.

RÈGLE MAJEURE SUR LES VACCINS

Les vaccins ne doivent être proposés que si l'âge, le sexe, la période, la grossesse, l'immunodépression, la pathologie chronique ou le facteur de risque retrouvé dans le dossier rend réellement la vaccination indiquée selon le calendrier vaccinal français 2026.
Ne jamais proposer un vaccin uniquement parce qu'il existe dans le calendrier.
Si l'âge n'est pas retrouvé, ne propose aucun vaccin dépendant de l'âge.
Si le facteur de risque n'est pas retrouvé, ne propose aucun vaccin dépendant d'un facteur de risque.
Si une vaccination est seulement possible mais non prioritaire, écrire “à discuter” ou classer [INFO]/[JAUNE], jamais [ROUGE].
Ne pas signaler comme “en retard” une vaccination qui n'est pas indiquée pour ce patient.
Ne pas signaler une vaccination déjà réalisée ou encore valide.

RÈGLES GÉNÉRALES

1. Ne jamais inventer une donnée absente.
2. Si une information manque, écrire “non retrouvé” plutôt que supposer.
3. Ne pas répéter les éléments déjà clairement à jour.
4. Ne pas produire de long raisonnement.
5. Ne pas donner de consigne impérative au patient.
6. Ne pas proposer de traitement détaillé sauf vigilance simple.
7. Toujours formuler les hypothèses diagnostiques comme “à évoquer si compatible”.
8. Chaque suggestion clinique doit être justifiée en quelques mots.
9. Prioriser ce qui est utile aujourd'hui en consultation.
10. Si le dossier est trop pauvre, le dire clairement.
11. Ne jamais créer de rubrique “MOTIF ACTUEL”.
12. Ne pas résumer le motif actuel de consultation.
13. Ignorer le motif actuel si cette information apparaît dans les données WEDA.
14. Ne pas mettre de section vide.
15. Ne pas afficher la section SUIVI CHRONIQUE À COMPLÉTER si aucune maladie chronique ou facteur de suivi chronique n'est identifié.

MISE EN VALEUR VISUELLE

1. Écris les titres de section sans gras, sans astérisques, sans Markdown :
   SYNTHÈSE RAPIDE
   DIAGNOSTICS / DIFFÉRENTIELS À ÉVOQUER
   VIGILANCE CLINIQUE
   PRÉVENTION À VÉRIFIER
   SUIVI CHRONIQUE À COMPLÉTER
   DONNÉES MANQUANTES UTILES
2. Mets en **gras** seulement les éléments intéressants, utiles ou actionnables dans les lignes :
   - nom d'un examen ;
   - vaccin ;
   - pathologie ;
   - donnée manquante importante ;
   - intervalle de suivi ;
   - facteur de risque.
3. Pour les éléments médicalement primordiaux, utilise exactement le format :
   {{ROUGE:texte primordial}}
4. N'utilise pas de HTML.
5. N'utilise pas de couleur autrement que par le marqueur {{ROUGE:...}}.
6. Ne mets pas toute la ligne en gras : seulement les mots importants.
7. Ne mets jamais les titres de section en gras.

SORTIE ATTENDUE

Réponds uniquement avec les sections suivantes, dans cet ordre exact.
Les titres doivent être écrits sans gras.
La section SUIVI CHRONIQUE À COMPLÉTER est optionnelle et doit être omise si elle n'est pas pertinente.
Les sections PRÉVENTION À VÉRIFIER, VIGILANCE CLINIQUE et DONNÉES MANQUANTES UTILES doivent aussi être omises si elles ne contiennent rien d'actionnable.

SYNTHÈSE RAPIDE
- 1 à 3 lignes maximum sur les points utiles du dossier.
- Ne pas mentionner le motif actuel.
- Ne pas mentionner les suivis à jour.
- Chaque ligne utile doit commencer par [INFO], [JAUNE], [ORANGE] ou [ROUGE].

DIAGNOSTICS / DIFFÉRENTIELS À ÉVOQUER
- Uniquement si le dossier contient des symptômes, antécédents ou éléments compatibles, en dehors du simple motif actuel.
- Format obligatoire : “[NIVEAU] À évoquer si compatible : **[hypothèse]** — justification : [éléments du dossier].”
- Ne pas dépasser 5 hypothèses.
- Si aucune hypothèse utile : “[INFO] Aucun différentiel pertinent retrouvé dans les données fournies.”

VIGILANCE CLINIQUE
- Interactions, iatrogénie, situations à risque, incohérences ou signaux faibles.
- Rester bref et prudent.
- Utiliser {{ROUGE:...}} pour les vigilances médicalement primordiales.
- Ne pas mentionner une vigilance déjà traitée ou explicitement surveillée correctement.
- Chaque ligne doit commencer par [ROUGE], [ORANGE], [JAUNE] ou [INFO].

PRÉVENTION À VÉRIFIER
- Liste courte des examens, vaccins ou dépistages probablement en retard.
- Ne cite que les éléments pertinents selon âge, sexe, antécédents et facteurs de risque.
- N'affiche aucun dépistage ou vaccin déjà à jour.
- Exception : pour les femmes de 25 ans à moins de 30 ans, afficher seulement la dernière date du frottis / dépistage du col retrouvée, sans conclure que c'est à refaire.
- Pour les vaccins, applique strictement les règles vaccinales françaises 2026 ci-dessous.
- Chaque ligne doit commencer par [ROUGE], [ORANGE], [JAUNE] ou [INFO].

SUIVI CHRONIQUE À COMPLÉTER
- Section à afficher seulement si une maladie chronique ou un facteur de suivi chronique est identifié.
- Liste courte des suivis manquants ou en retard en cas de diabète, HTA, insuffisance cardiaque, BPCO, dépression, obésité, maladie rénale chronique ou autre pathologie chronique retrouvée.
- Omettre complètement cette section si aucun suivi chronique n'est pertinent.
- Ne jamais mentionner un suivi chronique déjà à jour.
- Chaque ligne doit commencer par [ROUGE], [ORANGE], [JAUNE] ou [INFO].

DONNÉES MANQUANTES UTILES
- Informations utiles à rechercher ou mettre à jour dans WEDA.
- Ne pas dépasser 8 items.
- Ne pas lister les informations déjà clairement disponibles ou à jour.
- Chaque ligne doit commencer par [ORANGE], [JAUNE] ou [INFO].

RÈGLES VACCINALES FRANÇAISES 2026 À APPLIQUER STRICTEMENT

DTP / dTcaP adulte :
- Les rappels adultes se font aux âges fixes : **25 ans**, **45 ans**, **65 ans**, puis **75 ans**, **85 ans**, etc. tous les 10 ans après 65 ans.
- Ne pas proposer un rappel DTP/dTcaP à 30, 35, 50 ou 60 ans si le rappel d'âge fixe précédent est retrouvé.
- Entre 25 et 44 ans : alerte seulement si aucun rappel à 25 ans ou après 25 ans n'est retrouvé.
- Entre 45 et 64 ans : alerte seulement si aucun rappel à 45 ans ou après 45 ans n'est retrouvé.
- Entre 65 et 74 ans : alerte seulement si aucun rappel à 65 ans ou après 65 ans n'est retrouvé.
- À partir de 75 ans : alerte si aucun rappel dans les 10 dernières années.
- Coqueluche : rappel à 25 ans, stratégie cocooning si nourrisson attendu, et vaccination à chaque grossesse si grossesse retrouvée.

Grippe :
- Vaccination annuelle à proposer en priorité uniquement si âge ≥65 ans, grossesse, diabète, obésité importante, maladie respiratoire chronique, maladie cardiaque chronique, insuffisance rénale, immunodépression, EHPAD/collectivité, contact étroit avec personne fragile ou nourrisson à risque.
- Chez l'enfant/adolescent de 2 à 17 ans sans comorbidité, vaccination possible mais non prioritaire : mention [INFO] ou [JAUNE] seulement si contexte pertinent.
- Ne pas alerter grippe hors patient ciblé.
- Si vaccination retrouvée pour la saison en cours, ne pas mentionner.

Covid-19 :
- Vaccination annuelle à l'automne uniquement si âge ≥65 ans, grossesse, immunodépression, diabète, maladie cardio-respiratoire chronique, insuffisance rénale, obésité, EHPAD/USLD, contact régulier avec personnes vulnérables.
- Dose de printemps uniquement pour âge ≥80 ans, immunodépression ou résident EHPAD/USLD.
- Ne pas alerter Covid chez un adulte jeune sans facteur de risque retrouvé.
- Si rappel récent adapté au contexte retrouvé, ne pas mentionner.

Pneumocoque :
- Nourrisson : vaccination obligatoire selon calendrier du nourrisson.
- Adulte ≥65 ans : proposer vaccination pneumocoque si non retrouvée, même sans facteur de risque.
- Adulte 18-64 ans : proposer uniquement si facteur de risque retrouvé : diabète, insuffisance cardiaque, BPCO/asthme sévère ou maladie respiratoire chronique, immunodépression, insuffisance rénale chronique, syndrome néphrotique, asplénie, drépanocytose, cirrhose, brèche ostéo-méningée, implant cochléaire, etc.
- Ne pas proposer pneumocoque à un adulte <65 ans sans facteur de risque.
- Si vaccination pneumocoque adaptée retrouvée, ne pas mentionner.

Zona / Shingrix :
- Proposer **Shingrix** uniquement si âge ≥65 ans ou immunodépression à partir de 18 ans.
- Ne pas proposer zona à un adulte immunocompétent de moins de 65 ans.
- Si Shingrix complet retrouvé, ne pas mentionner.

VRS :
- Proposer vaccination VRS uniquement si âge ≥75 ans, ou âge ≥65 ans avec pathologie respiratoire chronique surtout BPCO, ou âge ≥65 ans avec pathologie cardiaque chronique surtout insuffisance cardiaque.
- Ne pas proposer VRS chez 65-74 ans sans pathologie respiratoire/cardiaque retrouvée.
- Ne pas proposer VRS chez adulte <65 ans sauf consigne spécifique non retrouvée.
- Si vaccination VRS retrouvée et valide, ne pas mentionner.

HPV / Gardasil 9 :
- Filles et garçons 11 à 14 ans révolus : proposer si non commencé ou incomplet.
- Rattrapage 15 à 26 ans révolus : proposer si non vacciné ou incomplet.
- Après 26 ans : ne pas proposer systématiquement HPV, sauf contexte spécifique explicitement retrouvé.
- Ne jamais proposer HPV à un patient >26 ans sans indication particulière.
- Si schéma complet retrouvé, ne pas mentionner.

Méningocoque ACWY :
- Nourrisson : obligatoire selon calendrier actuel.
- Adolescents 11 à 14 ans : proposer une dose ACWY, quel que soit l'historique méningocoque antérieur.
- Rattrapage 15 à 24 ans révolus : proposer une dose si non retrouvée.
- Après 24 ans : ne pas proposer systématiquement ACWY sauf facteur de risque, voyage ou contexte particulier retrouvé.
- Ne pas proposer ACWY à 25 ans ou plus sans indication spécifique.
- Si dose adaptée à l'âge retrouvée, ne pas mentionner.

Méningocoque B :
- Nourrisson né depuis le 1er janvier 2023 : obligatoire selon calendrier.
- Schéma nourrisson usuel : 3 mois, 5 mois, rappel 12 mois.
- Rattrapage 12-24 mois si non fait.
- Rattrapage transitoire 2 à 4 ans révolus si non vacciné contre méningocoque B, surtout enfants nés depuis 2023.
- Entre 15 et 24 ans : vaccination possible / à discuter selon calendrier 2026 ; classer [JAUNE] ou [INFO], sauf facteur de risque ou contexte épidémique.
- Après 24 ans : ne pas proposer systématiquement méningocoque B sauf facteur de risque ou contexte particulier retrouvé.
- Si schéma adapté retrouvé, ne pas mentionner.

ROR :
- Enfant : vérifier 2 doses, 12 mois puis 16-18 mois.
- Rattrapage : pour les personnes nées depuis 1980, vérifier total de 2 doses si vaccination absente ou incomplète.
- Ne pas proposer ROR systématiquement chez les personnes nées avant 1980 sauf contexte particulier retrouvé.
- Attention vaccin vivant : prudence si immunodépression ou grossesse.
- Si 2 doses retrouvées, ne pas mentionner.

Rotavirus :
- Uniquement nourrisson.
- Vaccination recommandée entre 2 et 4 mois.
- Première dose possible seulement jusqu'à 4 mois.
- Dernière dose avant 6 mois pour Rotarix ou avant 8 mois pour RotaTeq.
- Ne jamais proposer rotavirus si l'âge dépasse la fenêtre vaccinale.

BCG :
- Ne pas proposer systématiquement.
- Proposer seulement si enfant à risque tuberculose retrouvé : naissance ou séjour prolongé dans pays de forte endémie, antécédent familial de tuberculose, résidence en Île-de-France/Guyane/Mayotte ou situation sociale/exposition à risque selon contexte.
- Si aucun facteur de risque tuberculose n'est retrouvé, ne pas mentionner BCG.

Hépatite B :
- Nourrisson : incluse dans vaccination obligatoire.
- Adulte/adolescent : ne pas proposer systématiquement sauf rattrapage incomplet, risque professionnel, exposition sexuelle, entourage porteur VHB, maladie chronique du foie, dialyse, immunodépression ou autre facteur de risque retrouvé.

Varicelle :
- Ne pas proposer systématiquement.
- À évoquer seulement si adolescent 12-18 ans sans antécédent de varicelle ou adulte à risque séronégatif, femme en âge de procréer séronégative, professionnel exposé, ou contexte spécifique retrouvé.
- Attention vaccin vivant : prudence grossesse/immunodépression.

RÈGLES DE PRÉVENTION ADULTE NON VACCINALE

Cancer colorectal :
- De 50 à 74 ans inclus : vérifier test immunologique fécal / Hémoccult tous les 2 ans.
- Alerte si aucun test retrouvé depuis plus de 2 ans ou si date absente.
- Si test retrouvé depuis moins de 2 ans, ne pas mentionner.

Cancer du sein :
- Femmes de 50 à 74 ans inclus : vérifier mammographie tous les 2 ans.
- Alerte si aucune mammographie retrouvée depuis plus de 2 ans ou si date absente.
- Si mammographie retrouvée depuis moins de 2 ans, ne pas mentionner.

Cancer du col de l'utérus / frottis :
- Femmes de 30 à 65 ans inclus : vérifier frottis / dépistage du col / test HPV-HR tous les 5 ans.
- Alerte si aucun frottis / dépistage du col / test HPV-HR retrouvé depuis plus de 5 ans ou si aucune date n'est retrouvée.
- Si frottis / dépistage du col / test HPV-HR retrouvé depuis moins de 5 ans, ne pas mentionner.
- Femmes de 25 ans à moins de 30 ans : afficher seulement la dernière date retrouvée du frottis / dépistage du col / cytologie, sans dire que c'est en retard et sans proposer de le refaire.
- Si aucune date n'est retrouvée entre 25 et moins de 30 ans : signaler seulement que la dernière date n'est pas retrouvée, en laissant la décision au médecin.
- Ne jamais utiliser [ROUGE] pour le frottis / dépistage du col.

Dentiste :
- Chez l'adulte : alerte pratique si aucun dentiste retrouvé depuis 3 ans.
- Chez l'enfant/adolescent de 3 à 24 ans : suivi dentaire annuel si possible ; si un EBD/dentiste est retrouvé dans l'année civile en cours, ne pas mentionner.
- Chez les diabétiques, personnes âgées ou patients à risque bucco-dentaire : prioriser l'alerte seulement si non à jour.

Tabac / alcool / cannabis :
- Alerte si statut absent ou ancien.
- Tabac : distinguer actif, ancien fumeur, non-fumeur.
- Alcool : signaler si consommation >4 verres/semaine ou problème alcool évoqué.
- Cannabis : vérifier surtout adolescents/jeunes adultes ou si trouble anxieux, psychiatrique, scolaire, professionnel ou respiratoire.
- Si statut récent clairement renseigné et non problématique, ne pas mentionner.

Poids / IMC :
- Alerte si poids/IMC absent depuis plus d'un an chez adulte suivi, diabète, HTA, obésité, insuffisance cardiaque, personne âgée ou pathologie chronique.
- Chez enfant/adolescent : alerte si aucune donnée récente dans l'année civile en cours.
- Si poids/IMC récent retrouvé, ne pas mentionner.

Bilan lipidique / LDL :
- Vérifier LDL si diabète, HTA, antécédent cardio-neurovasculaire, statine, maladie rénale chronique, obésité ou risque cardiovasculaire élevé.
- Alerte si aucun LDL récent retrouvé.
- Si LDL récent retrouvé, ne pas mentionner.

Ostéoporose / risque fracturaire :
- À évoquer chez femme ménopausée, fracture après traumatisme faible, corticothérapie prolongée, IMC bas, chutes répétées, antécédent familial, âge avancé.
- Formuler comme vigilance, pas comme obligation systématique.
- Ne pas mentionner si bilan ou suivi récent déjà retrouvé.

Chutes :
- Chez les patients âgés, surtout ≥75 ans : vérifier notion de chute, équilibre, marche, hypotension orthostatique, psychotropes, benzodiazépines, aides techniques.
- Alerte si chute réelle retrouvée ou risque élevé.
- Ne pas mentionner si repérage récent déjà documenté et absence de chute récente.

Directives anticipées / personne de confiance :
- À évoquer chez patient âgé, polypathologique, soins palliatifs, EHPAD, insuffisance cardiaque ou pathologie évolutive sévère.
- Formuler comme “à discuter si contexte adapté”.
- Ne pas mentionner si déjà tracé récemment.

RÈGLES DE SUIVI CHRONIQUE

Diabète :
- Signaler uniquement les éléments non retrouvés ou en retard : HbA1c, fond d'œil/ophtalmologie, pieds/podologue, RAC, DFG, LDL, poids/IMC, tabac, vaccinations indiquées selon âge/facteur de risque.
- Ne pas mentionner les éléments déjà réalisés récemment ou dans l'année civile en cours si suivi annuel.

HTA :
- Signaler uniquement les éléments non retrouvés ou en retard : PA récente, automesure/AMT, DFG/créatininémie, kaliémie si IEC/ARA2/diurétique, RAC annuel si risque rénal, LDL.
- Ne pas mentionner les éléments déjà à jour.

Maladie rénale chronique ou risque rénal :
- Signaler DFG et RAC seulement s'ils ne sont pas retrouvés ou anciens.
- Vigilance AINS, IEC/ARA2/diurétiques, metformine, anticoagulants selon contexte.
- Ne pas faire d'adaptation posologique détaillée.

Insuffisance cardiaque :
- Signaler uniquement si poids, PA, fréquence cardiaque, dyspnée/œdèmes, DFG, kaliémie ou vaccinations indiquées ne sont pas retrouvés ou sont anciens.
- Si dyspnée ou prise de poids récente : vigilance décompensation à évoquer si compatible.

BPCO / asthme :
- Signaler uniquement si tabac, EFR/spirométrie, exacerbations ou vaccinations indiquées ne sont pas retrouvés ou sont anciens.
- Ne pas mentionner les éléments déjà à jour.

Dépression / syndrome dépressif / antidépresseur :
- Vérifier MADRS au moins une fois par année civile.
- Alerte si aucun MADRS retrouvé dans l'année civile.
- Si MADRS déjà fait cette année, ne pas mentionner.
- Vérifier idées suicidaires si humeur basse, syndrome dépressif, anxiété sévère ou changement récent.

Iatrogénie :
- Signaler seulement les risques actifs ou non réévalués :
  - benzodiazépine chronique, surtout sujet âgé ;
  - AINS avec anticoagulant, antiagrégant, IEC/ARA2, diurétique ou insuffisance rénale ;
  - IPP au long cours sans indication retrouvée ;
  - anticholinergiques chez sujet âgé ;
  - polymédication importante ;
  - anticoagulant avec chutes répétées ou insuffisance rénale.
- Ne pas recommander d'arrêt direct, seulement “à réévaluer”.

RÈGLES PÉDIATRIE / ADOLESCENTS

Suivi général enfant :
- Jusqu'à 16 ans : vérifier présence d'examens de suivi aux âges clés.
- Points clés : croissance, poids, taille, IMC/courbe, développement psychomoteur, langage, vision, audition, sommeil, comportement, scolarité, vaccinations.
- Ne pas mentionner les examens déjà faits dans l'année civile en cours.

Croissance / IMC :
- Chez enfant/adolescent : vérifier poids, taille, IMC ou courbe de corpulence récents.
- Alerte si aucune donnée récente dans l'année civile en cours.
- Si poids/taille/IMC retrouvés dans l'année civile en cours, ne pas mentionner.

Dentiste / M'T dents :
- De 3 à 24 ans : suivi dentaire annuel.
- Alerte si aucun dentiste/EBD retrouvé dans l'année civile en cours.
- Si retrouvé cette année, ne pas mentionner.

Examen du dos / scoliose :
- À partir de 6 ans et jusqu'à la fin de croissance : examen du dos annuel.
- Mots-clés : dos, rachis, scoliose, gibbosité, cyphose, lordose, bassin.
- Alerte si aucun examen du dos retrouvé dans l'année civile en cours chez enfant/adolescent de 6 à 16 ans.
- Si examen du dos retrouvé dans l'année civile en cours, ne pas mentionner.

Vision :
- Enfant/adolescent : vérifier acuité visuelle ou suivi ophtalmo.
- Alerte si aucune vision/ophtalmo retrouvée depuis 2 à 3 ans, ou plus tôt si difficultés scolaires, céphalées, lunettes, strabisme, myopie familiale.
- Si contrôle récent adapté retrouvé, ne pas mentionner.

Audition :
- Vérifier audition surtout si retard de langage, difficultés scolaires, troubles du comportement, exposition sonore, otites répétées.
- Alerte si élément évocateur et aucun contrôle retrouvé.
- Si contrôle récent adapté retrouvé, ne pas mentionner.

Troubles du neurodéveloppement / TND :
- Avant 6 ans : vérifier qu'un repérage du développement ou des TND a été réalisé et tracé.
- Rechercher : développement psychomoteur, langage, motricité, interactions sociales, contact visuel, pointage, attention conjointe, comportement, autonomie, M-CHAT, ERTL4, orthophonie, psychomotricité, CAMSP, CMP, PCO, TSA, TDAH, troubles des apprentissages.
- Alerte si enfant de moins de 6 ans sans aucune trace de repérage développemental/TND.
- Alerte renforcée entre 4 et 6 ans si rien n'est retrouvé avant l'entrée au CP.
- Après 6 ans : si aucune trace antérieure n'est retrouvée, formuler en jaune : “Aucun repérage TND tracé avant 6 ans — à vérifier si doute scolaire, langage, comportement ou attention.”
- Si repérage déjà tracé et aucun signe d'alerte retrouvé, ne pas mentionner.

Troubles des apprentissages :
- Chez enfant scolarisé : vérifier difficultés scolaires, PAP/PAI/AESH, orthophonie, dyslexie, dyspraxie, dyscalculie, baisse des résultats.
- Alerte si difficultés évoquées sans bilan ou suivi retrouvé.
- Ne pas mentionner si aucun signal d'appel et suivi déjà documenté.

TDAH / attention :
- Ne jamais diagnostiquer.
- Si inattention, impulsivité, hyperactivité, troubles scolaires ou comportementaux sont retrouvés : “À évoquer si compatible : TDAH — justification : …”
- Mentionner seulement si signes concordants.

Puberté :
- À l'adolescence : vérifier développement pubertaire si données disponibles.
- Vigilance si puberté très précoce ou retard pubertaire évoqué.
- Ne pas alerter si aucune donnée et âge non pertinent.

Santé mentale adolescent :
- À partir du collège : vérifier sommeil, anxiété, humeur, idées noires, harcèlement, conduites à risque.
- Alerte si symptômes ou contexte retrouvés.
- Si rien n'est tracé, mentionner seulement comme donnée manquante utile, sans dramatiser.
- Si dépistage récent déjà tracé et sans alerte, ne pas mentionner.

Tabac / alcool / cannabis adolescent :
- À partir du collège : vérifier consommation tabac, alcool, cannabis.
- Alerte si consommation retrouvée ou statut absent.
- Si statut récent renseigné et non problématique, ne pas mentionner.

Sexualité / contraception / IST / consentement :
- Chez adolescent : vérifier si contraception, sexualité, IST, consentement ou violences ont été abordés lorsque contexte pertinent.
- Formuler discrètement, dans données manquantes utiles.
- Ne pas mentionner si déjà abordé récemment et sans alerte.

STYLE

- Réponse courte.
- Pas de paragraphes longs.
- Une ligne par item.
- Titres de section sans gras.
- Chaque item utile doit commencer par un niveau [ROUGE], [ORANGE], [JAUNE] ou [INFO].
- Pas de jargon inutile.
- Pas de recommandations floues.
- Pas de conclusion générale.
- Pas de mention médico-légale.
- Pas de phrase du type “consultez votre médecin”, car l'utilisateur est le médecin.
`.trim();

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function isPatientHomePage() {
        const path = String(location.pathname || '').toLowerCase();
        const params = new URLSearchParams(location.search || '');
        return path.includes('/foldermedical/patientviewform.aspx') && !!params.get('PatDk');
    }

    function isWorkerPage() {
        const hash = String(location.hash || '').toUpperCase();
        return hash.includes('AUTO_HH_WEDA_WORKER') ||
               hash.includes('AUTO_ATCD_CIM10_WORKER') ||
               hash.includes('AUTO_HH_CONTEXT_WORKER') ||
               hash.includes('AUTO_HH_WEDA_CONTEXT');
    }

    function getPatDk() {
        try {
            return new URLSearchParams(location.search || '').get('PatDk') || '';
        } catch (_) {
            return '';
        }
    }

    function getLocalDateKey(date = new Date()) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getTodayCacheKey() {
        const patDk = getPatDk() || 'unknown';
        const dateKey = getLocalDateKey();
        return `${CACHE_PREFIX}::${patDk}::${dateKey}`;
    }

    function nowFr() {
        try {
            return new Intl.DateTimeFormat('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'medium'
            }).format(new Date());
        } catch (_) {
            return new Date().toLocaleString();
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function cleanText(text) {
        return String(text || '')
            .replace(/\u00A0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{4,}/g, '\n\n\n')
            .trim();
    }

    function filterCurrentReasonText(text) {
        let value = String(text || '');

        const sectionStopPattern = [
            'ANTÉCÉDENTS',
            'ANTECEDENTS',
            'PATHOLOGIE',
            'PROBLÈMES',
            'PROBLEMES',
            'TRAITEMENTS',
            'ALLERGIES',
            'HISTORIQUE',
            'VACCINS',
            'BIOLOGIE',
            'DOCUMENTS',
            'COURRIERS',
            'CONSTANTES',
            'SUIVIS',
            'NOTES',
            'RENDEZ-VOUS',
            'RDV'
        ].join('|');

        value = value.replace(
            new RegExp(
                String.raw`(^|\n)\s*(MOTIF\s+ACTUEL|MOTIF\s+DE\s+CONSULTATION|MOTIF\s+DU\s+JOUR|PLAINTE\s+ACTUELLE)\s*:?\s*[\s\S]*?(?=\n\s*(?:${sectionStopPattern})\b|\n{3,}|$)`,
                'gim'
            ),
            '\n[SECTION MOTIF ACTUEL MASQUÉE PAR LE SCRIPT]\n'
        );

        value = value
            .split(/\r?\n/)
            .filter(line => {
                const l = line.trim();
                if (!l) return true;
                if (/^(motif\s+actuel|motif\s+de\s+consultation|motif\s+du\s+jour|plainte\s+actuelle)\s*:?/i.test(l)) return false;
                return true;
            })
            .join('\n');

        return cleanText(value);
    }

    function isProbablyVisible(el) {
        if (!el || !(el instanceof Element)) return false;
        const style = window.getComputedStyle(el);
        if (!style) return false;
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (el.closest(`#${PANEL_ID}`)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getFieldLabel(el) {
        if (!el) return '';

        const id = el.id;
        if (id) {
            const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (label && cleanText(label.innerText)) return cleanText(label.innerText);
        }

        const aria = el.getAttribute('aria-label');
        if (aria) return cleanText(aria);

        const title = el.getAttribute('title');
        if (title) return cleanText(title);

        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return cleanText(placeholder);

        const name = el.getAttribute('name');
        if (name) return cleanText(name);

        if (id) return cleanText(id);

        return el.tagName.toLowerCase();
    }

    function collectVisibleFormValues() {
        const lines = [];
        const fields = Array.from(document.querySelectorAll('input, textarea, select'));

        for (const el of fields) {
            if (!isProbablyVisible(el)) continue;

            const tag = el.tagName.toLowerCase();
            const type = String(el.getAttribute('type') || '').toLowerCase();

            if (['hidden', 'password', 'submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
            if (el.disabled) continue;

            const label = getFieldLabel(el);
            if (/motif\s+(actuel|de\s+consultation|du\s+jour)|plainte\s+actuelle/i.test(label)) continue;

            let value = '';

            if (tag === 'select') {
                const selected = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
                value = selected ? cleanText(selected.textContent || selected.value || '') : '';
            } else if (type === 'checkbox' || type === 'radio') {
                value = el.checked ? 'coché' : '';
            } else {
                value = cleanText(el.value || '');
            }

            if (!value) continue;

            lines.push(`- ${label} : ${value}`);
        }

        return filterCurrentReasonText(lines.join('\n'));
    }

    function collectVisiblePageText() {
        const clone = document.body.cloneNode(true);

        const toRemove = clone.querySelectorAll([
            `#${PANEL_ID}`,
            'script',
            'style',
            'noscript',
            'iframe',
            'svg',
            'canvas'
        ].join(','));

        toRemove.forEach(el => el.remove());

        let visibleText = cleanText(clone.innerText || document.body.innerText || '');
        visibleText = filterCurrentReasonText(visibleText);

        const formValues = collectVisibleFormValues();

        const header = [
            'SOURCE',
            `- Application : WEDA`,
            `- Page : PatientViewForm.aspx / accueil patient`,
            `- URL : ${location.href}`,
            `- PatDk : ${getPatDk()}`,
            `- Date/heure extraction : ${nowFr()}`,
            '',
            'TEXTE VISIBLE COMPLET DE LA PAGE WEDA',
            visibleText || '[Aucun texte visible extrait]'
        ].join('\n');

        let fullText = header;

        if (formValues) {
            fullText += '\n\nVALEURS DE CHAMPS VISIBLES\n' + formValues;
        }

        fullText = filterCurrentReasonText(cleanText(fullText));

        if (fullText.length > CONFIG.MAX_PAGE_CHARS) {
            fullText = fullText.slice(0, CONFIG.MAX_PAGE_CHARS) +
                '\n\n[NOTE SCRIPT : le texte WEDA dépassait la limite configurée MAX_PAGE_CHARS et a été tronqué. Augmenter CONFIG.MAX_PAGE_CHARS si nécessaire.]';
        }

        return fullText;
    }

    function getCachedAnalysisToday() {
        if (!CONFIG.CACHE_ENABLED) return null;

        try {
            const raw = localStorage.getItem(getTodayCacheKey());
            if (!raw) return null;

            const data = JSON.parse(raw);
            if (!data || !data.resultText) return null;
            if (data.dateKey !== getLocalDateKey()) return null;
            if (String(data.patDk || '') !== String(getPatDk() || '')) return null;

            if (CONFIG.CACHE_INVALIDATE_ON_SCRIPT_VERSION && data.version && data.version !== SCRIPT_VERSION) {
                return null;
            }

            return data;
        } catch (error) {
            warn('Cache du jour illisible', error);
            return null;
        }
    }

    function saveCachedAnalysisToday(resultText, metadata = {}) {
        if (!CONFIG.CACHE_ENABLED) return;

        try {
            const payload = {
                version: SCRIPT_VERSION,
                patDk: getPatDk(),
                dateKey: getLocalDateKey(),
                resultText: String(resultText || ''),
                model: state.resolvedModelId || '',
                createdAt: new Date().toISOString(),
                createdAtFr: nowFr(),
                pageChars: metadata.pageChars || 0,
                source: metadata.source || 'auto'
            };

            localStorage.setItem(getTodayCacheKey(), JSON.stringify(payload));
        } catch (error) {
            warn('Impossible de mémoriser l’analyse du jour', error);
        }
    }

    function purgeOldCaches() {
        if (!CONFIG.CACHE_ENABLED) return;

        try {
            const now = Date.now();
            const ttlMs = CONFIG.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(CACHE_PREFIX + '::')) continue;

                try {
                    const raw = localStorage.getItem(key);
                    const data = JSON.parse(raw || '{}');
                    const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;

                    if (!createdAt || now - createdAt > ttlMs) {
                        localStorage.removeItem(key);
                    }
                } catch (_) {
                    localStorage.removeItem(key);
                }
            }
        } catch (error) {
            warn('Erreur nettoyage cache', error);
        }
    }

    function displayCachedAnalysis(cache, origin) {
        if (!cache || !cache.resultText) return false;

        state.lastResultText = cache.resultText;
        setResult(cache.resultText, false);
        setStatus('Analyse du jour déjà faite : résultat mémorisé affiché.', 'success');

        const metaParts = [
            `Cache du jour`,
            cache.createdAtFr ? `analyse : ${cache.createdAtFr}` : '',
            cache.model ? `modèle : ${cache.model}` : '',
            cache.version ? `script : v${cache.version}` : '',
            cache.source ? `source : ${cache.source}` : '',
            cache.pageChars ? `${Number(cache.pageChars).toLocaleString('fr-FR')} caractères analysés` : ''
        ].filter(Boolean);

        setMeta(metaParts.join(' · '));

        log('Résultat cache affiché', {
            origin,
            patDk: cache.patDk,
            dateKey: cache.dateKey,
            model: cache.model,
            version: cache.version,
            source: cache.source
        });

        return true;
    }

    function gmRequest(method, url, payload) {
        return new Promise((resolve, reject) => {
            const headers = {
                'Content-Type': 'application/json'
            };

            if (CONFIG.API_KEY) {
                headers.Authorization = `Bearer ${CONFIG.API_KEY}`;
            }

            GM_xmlhttpRequest({
                method,
                url,
                headers,
                data: payload ? JSON.stringify(payload) : undefined,
                timeout: CONFIG.REQUEST_TIMEOUT_MS,
                onload: response => resolve(response),
                onerror: error => reject(error),
                ontimeout: () => reject(new Error('Timeout LM Studio'))
            });
        });
    }

    async function resolveModelId() {
        if (CONFIG.MODEL_ID && CONFIG.MODEL_ID !== 'auto') {
            state.resolvedModelId = CONFIG.MODEL_ID;
            return CONFIG.MODEL_ID;
        }

        const modelsUrl = `${CONFIG.LM_STUDIO_BASE_URL.replace(/\/+$/, '')}/models`;

        try {
            const response = await gmRequest('GET', modelsUrl, null);

            if (response.status < 200 || response.status >= 300) {
                warn('Erreur /models LM Studio', response.status, response.responseText);
                state.resolvedModelId = CONFIG.FALLBACK_MODEL_ID;
                return CONFIG.FALLBACK_MODEL_ID;
            }

            const json = JSON.parse(response.responseText || '{}');
            const list = Array.isArray(json.data) ? json.data : [];

            const firstModel = list.find(m => m && m.id);
            if (firstModel && firstModel.id) {
                state.resolvedModelId = firstModel.id;
                return firstModel.id;
            }

            state.resolvedModelId = CONFIG.FALLBACK_MODEL_ID;
            return CONFIG.FALLBACK_MODEL_ID;

        } catch (error) {
            warn('Impossible de récupérer /v1/models, fallback utilisé', error);
            state.resolvedModelId = CONFIG.FALLBACK_MODEL_ID;
            return CONFIG.FALLBACK_MODEL_ID;
        }
    }

    async function askLmStudio(pageText) {
        const modelId = await resolveModelId();
        const chatUrl = `${CONFIG.LM_STUDIO_BASE_URL.replace(/\/+$/, '')}/chat/completions`;

        const payload = {
            model: modelId,
            messages: [
                {
                    role: 'system',
                    content: PROMPT_COPILOTE_WEDA
                },
                {
                    role: 'user',
                    content: [
                        'DOSSIER WEDA À ANALYSER',
                        '',
                        pageText
                    ].join('\n')
                }
            ],
            temperature: CONFIG.TEMPERATURE,
            max_tokens: CONFIG.MAX_TOKENS,
            stream: false
        };

        const response = await gmRequest('POST', chatUrl, payload);

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Erreur LM Studio HTTP ${response.status} : ${response.responseText || 'réponse vide'}`);
        }

        let json;
        try {
            json = JSON.parse(response.responseText || '{}');
        } catch (_) {
            throw new Error('Réponse LM Studio non JSON : ' + String(response.responseText || '').slice(0, 1000));
        }

        const content =
            json?.choices?.[0]?.message?.content ||
            json?.choices?.[0]?.text ||
            json?.output_text ||
            '';

        if (!content) {
            throw new Error('Réponse LM Studio vide ou format inattendu : ' + JSON.stringify(json).slice(0, 1200));
        }

        return String(content).trim();
    }

    function loadPanelState() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_STATE_KEY) || '{}') || {};
        } catch (_) {
            return {};
        }
    }

    function savePanelState(nextState) {
        try {
            const previous = loadPanelState();
            localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify({
                ...previous,
                ...nextState
            }));
        } catch (_) {
            // Rien.
        }
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function applyBoldMarkupToEscapedText(escapedText) {
        return String(escapedText || '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    function renderInlineMarkup(rawText) {
        const text = String(rawText || '');
        let html = '';
        let lastIndex = 0;

        const criticalRegex = /\{\{ROUGE:([^}]+)\}\}/g;
        let match;

        while ((match = criticalRegex.exec(text)) !== null) {
            const before = text.slice(lastIndex, match.index);
            const critical = match[1] || '';

            html += applyBoldMarkupToEscapedText(escapeHtml(before));
            html += `<span class="weda-copilote-critical">${applyBoldMarkupToEscapedText(escapeHtml(critical))}</span>`;

            lastIndex = match.index + match[0].length;
        }

        html += applyBoldMarkupToEscapedText(escapeHtml(text.slice(lastIndex)));

        return html;
    }

    function stripHeadingBoldMarkers(text) {
        return String(text || '')
            .trim()
            .replace(/^\*\*(.*?)\*\*$/g, '$1')
            .trim();
    }

    function normalizeTextForSection(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .trim();
    }

    function defaultLevelForSection(sectionHeading, lineText) {
        const section = normalizeTextForSection(sectionHeading);
        const line = normalizeTextForSection(lineText);

        if (/AUCUN DIFFERENTIEL PERTINENT|AUCUNE HYPOTHESE|RIEN D.?ACTIONNABLE|DOSSIER INSUFFISANT|NON RETROUVE DANS LES DONNEES/.test(line)) {
            return 'info';
        }

        if (section.includes('SYNTHESE RAPIDE')) {
            return 'info';
        }

        if (section.includes('DIAGNOSTICS') || section.includes('DIFFERENTIELS')) {
            return 'jaune';
        }

        if (section.includes('VIGILANCE CLINIQUE')) {
            return 'orange';
        }

        if (section.includes('PREVENTION')) {
            return 'orange';
        }

        if (section.includes('SUIVI CHRONIQUE')) {
            return 'orange';
        }

        if (section.includes('DONNEES MANQUANTES')) {
            return 'jaune';
        }

        return '';
    }

    function extractExplicitLevel(cleanLine) {
        if (/\[ROUGE\]/i.test(cleanLine)) return 'rouge';
        if (/\[ORANGE\]/i.test(cleanLine)) return 'orange';
        if (/\[JAUNE\]/i.test(cleanLine)) return 'jaune';
        if (/\[INFO\]/i.test(cleanLine)) return 'info';
        return '';
    }

    function removeLevelMarkers(cleanLine) {
        return String(cleanLine || '')
            .replace(/\[ROUGE\]\s*/gi, '')
            .replace(/\[ORANGE\]\s*/gi, '')
            .replace(/\[JAUNE\]\s*/gi, '')
            .replace(/\[INFO\]\s*/gi, '')
            .trim();
    }

    function formatResultHtml(text) {
        const lines = String(text || '').split(/\r?\n/);
        const html = [];
        let currentHeading = '';

        for (const rawLine of lines) {
            const line = rawLine.trimEnd();

            if (!line.trim()) {
                html.push('<div class="weda-copilote-spacer"></div>');
                continue;
            }

            const clean = line.trim();
            const headingCandidate = stripHeadingBoldMarkers(clean);

            const isHeading =
                headingCandidate.length <= 75 &&
                /^[A-ZÉÈÊËÀÂÎÏÔÙÛÇ0-9 /’'()-]+$/.test(headingCandidate) &&
                !headingCandidate.startsWith('-') &&
                !/\[(ROUGE|ORANGE|JAUNE|INFO)\]/i.test(headingCandidate);

            if (isHeading) {
                currentHeading = headingCandidate;
                html.push(`<div class="weda-copilote-heading">${escapeHtml(headingCandidate)}</div>`);
                continue;
            }

            const explicitLevel = extractExplicitLevel(clean);
            const automaticLevel = explicitLevel || defaultLevelForSection(currentHeading, clean);

            let cls = 'weda-copilote-line';
            if (automaticLevel) cls += ` level-${automaticLevel}`;

            const displayLine = removeLevelMarkers(clean);

            html.push(`<div class="${cls}">${renderInlineMarkup(displayLine)}</div>`);
        }

        return html.join('');
    }

    function setStatus(message, kind) {
        const status = document.querySelector(`#${PANEL_ID} .weda-copilote-status`);
        if (!status) return;

        status.className = 'weda-copilote-status';
        if (kind) status.classList.add(kind);
        status.textContent = message;
    }

    function setResult(text, raw) {
        const result = document.querySelector(`#${PANEL_ID} .weda-copilote-result`);
        if (!result) return;

        if (raw) {
            result.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
        } else {
            result.innerHTML = formatResultHtml(text);
        }
    }

    function setMeta(text) {
        const meta = document.querySelector(`#${PANEL_ID} .weda-copilote-meta`);
        if (!meta) return;
        meta.textContent = text || '';
    }

    async function copyText(text, successMessage) {
        const value = String(text || '');
        if (!value) {
            setStatus('Rien à copier.', 'error');
            return;
        }

        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(value, 'text');
            } else if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                throw new Error('Clipboard indisponible');
            }

            setStatus(successMessage || 'Copié.', 'success');

        } catch (error) {
            warn('Erreur copie presse-papiers', error);
            setStatus('Erreur copie presse-papiers.', 'error');
        }
    }

    function isManualForce(origin, options) {
        if (options && options.force === true) return true;
        return String(origin || '').toLowerCase().includes('manuel');
    }

    async function runAnalysis(origin, options = {}) {
        if (state.running) return;

        const force = isManualForce(origin, options);

        if (!force) {
            const cached = getCachedAnalysisToday();
            if (cached) {
                displayCachedAnalysis(cached, origin || 'cache');
                return;
            }
        }

        state.running = true;

        const runButton = document.querySelector(`#${PANEL_ID} .btn-run`);
        if (runButton) runButton.disabled = true;

        try {
            setStatus(force ? 'Analyse manuelle forcée : relance LM Studio…' : 'Extraction de la page WEDA…', 'running');
            setMeta(force ? 'Le cache du jour sera remplacé par cette nouvelle analyse.' : '');
            setResult(force ? 'Relance manuelle de l’analyse en cours…' : 'Lecture de la page patient en cours…', true);

            await sleep(150);

            const pageText = collectVisiblePageText();
            state.lastPageText = pageText;

            setStatus('Analyse LM Studio en cours…', 'running');
            setMeta(`Modèle : ${state.resolvedModelId || 'détection…'} · ${pageText.length.toLocaleString('fr-FR')} caractères envoyés${force ? ' · relance manuelle' : ''}`);
            setResult('Analyse en cours par le modèle local…', true);

            const resultText = await askLmStudio(pageText);
            state.lastResultText = resultText;

            saveCachedAnalysisToday(resultText, {
                pageChars: pageText.length,
                source: force ? 'manuel' : 'auto'
            });

            setResult(resultText, false);
            setStatus(force ? 'Analyse manuelle terminée et cache du jour remplacé.' : 'Analyse terminée et mémorisée pour aujourd’hui.', 'success');
            setMeta(`Modèle : ${state.resolvedModelId || 'non précisé'} · ${pageText.length.toLocaleString('fr-FR')} caractères envoyés · ${nowFr()} · script v${SCRIPT_VERSION}${force ? ' · source : manuel' : ' · source : auto'}`);

            log('Analyse terminée et cache enregistré', {
                origin,
                force,
                model: state.resolvedModelId,
                chars: pageText.length,
                cacheKey: getTodayCacheKey(),
                version: SCRIPT_VERSION
            });

        } catch (error) {
            warn('Erreur analyse', error);

            const message = [
                'Erreur pendant l’analyse.',
                '',
                String(error && error.message ? error.message : error),
                '',
                'À vérifier :',
                '- LM Studio est ouvert.',
                '- Le serveur local LM Studio est démarré.',
                '- Un modèle Gemma est chargé.',
                '- L’URL configurée est correcte : ' + CONFIG.LM_STUDIO_BASE_URL,
                '- Si le modèle auto ne fonctionne pas, renseigner CONFIG.MODEL_ID avec l’identifiant exact du modèle.'
            ].join('\n');

            setResult(message, true);
            setStatus('Erreur analyse LM Studio.', 'error');

        } finally {
            state.running = false;
            if (runButton) runButton.disabled = false;
        }
    }

    function toggleCollapsed() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        const body = panel.querySelector('.weda-copilote-body');
        const btn = panel.querySelector('.btn-collapse');
        const collapsed = !panel.classList.contains('collapsed');

        panel.classList.toggle('collapsed', collapsed);
        if (body) body.style.display = collapsed ? 'none' : '';
        if (btn) btn.textContent = collapsed ? '▣' : '—';

        savePanelState({ collapsed });
    }

    function placePanel(panel) {
        const saved = loadPanelState();

        const defaultWidth = CONFIG.PANEL_WIDTH_PX;
        const defaultHeight = CONFIG.PANEL_HEIGHT_PX;
        const defaultLeft = Math.max(10, window.innerWidth - defaultWidth - CONFIG.PANEL_RIGHT_PX);
        const defaultTop = CONFIG.PANEL_TOP_PX;

        const width = Number.isFinite(saved.width) ? saved.width : defaultWidth;
        const height = Number.isFinite(saved.height) ? saved.height : defaultHeight;
        const left = Number.isFinite(saved.left) ? saved.left : defaultLeft;
        const top = Number.isFinite(saved.top) ? saved.top : defaultTop;

        const safeWidth = Math.min(Math.max(CONFIG.PANEL_MIN_WIDTH_PX, width), Math.max(CONFIG.PANEL_MIN_WIDTH_PX, window.innerWidth - 18));
        const safeHeight = Math.min(Math.max(CONFIG.PANEL_MIN_HEIGHT_PX, height), Math.max(CONFIG.PANEL_MIN_HEIGHT_PX, window.innerHeight - 18));

        panel.style.width = `${safeWidth}px`;
        panel.style.height = `${safeHeight}px`;
        panel.style.left = `${Math.min(Math.max(8, left), Math.max(8, window.innerWidth - 80))}px`;
        panel.style.top = `${Math.min(Math.max(8, top), Math.max(8, window.innerHeight - 50))}px`;

        if (saved.collapsed) {
            panel.classList.add('collapsed');
            const body = panel.querySelector('.weda-copilote-body');
            const btn = panel.querySelector('.btn-collapse');
            if (body) body.style.display = 'none';
            if (btn) btn.textContent = '▣';
        }
    }

    function enableDrag(panel) {
        const header = panel.querySelector('.weda-copilote-header');
        if (!header) return;

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        header.addEventListener('mousedown', event => {
            if (event.target.closest('button')) return;
            if (event.target.closest('.weda-copilote-resize-handle')) return;

            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            startLeft = panel.offsetLeft;
            startTop = panel.offsetTop;

            document.body.classList.add('weda-copilote-dragging');
            event.preventDefault();
        });

        document.addEventListener('mousemove', event => {
            if (!dragging) return;

            const dx = event.clientX - startX;
            const dy = event.clientY - startY;

            const nextLeft = Math.min(
                Math.max(4, startLeft + dx),
                Math.max(4, window.innerWidth - 80)
            );

            const nextTop = Math.min(
                Math.max(4, startTop + dy),
                Math.max(4, window.innerHeight - 40)
            );

            panel.style.left = `${nextLeft}px`;
            panel.style.top = `${nextTop}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('weda-copilote-dragging');

            savePanelState({
                left: panel.offsetLeft,
                top: panel.offsetTop
            });
        });
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function enableEdgeResize(panel) {
        if (state.edgeResizeInstalled) return;
        state.edgeResizeInstalled = true;

        let resizing = false;
        let dir = '';
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let startWidth = 0;
        let startHeight = 0;

        const handles = panel.querySelectorAll('.weda-copilote-resize-handle');

        handles.forEach(handle => {
            handle.addEventListener('mousedown', event => {
                if (panel.classList.contains('collapsed')) return;

                resizing = true;
                dir = handle.getAttribute('data-resize-dir') || '';
                startX = event.clientX;
                startY = event.clientY;
                startLeft = panel.offsetLeft;
                startTop = panel.offsetTop;
                startWidth = panel.offsetWidth;
                startHeight = panel.offsetHeight;

                document.body.classList.add('weda-copilote-resizing');
                event.preventDefault();
                event.stopPropagation();
            });
        });

        document.addEventListener('mousemove', event => {
            if (!resizing) return;

            const dx = event.clientX - startX;
            const dy = event.clientY - startY;

            let nextLeft = startLeft;
            let nextTop = startTop;
            let nextWidth = startWidth;
            let nextHeight = startHeight;

            const minW = CONFIG.PANEL_MIN_WIDTH_PX;
            const minH = CONFIG.PANEL_MIN_HEIGHT_PX;
            const margin = 4;

            if (dir.includes('e')) {
                const maxWidth = Math.max(minW, window.innerWidth - startLeft - margin);
                nextWidth = clamp(startWidth + dx, minW, maxWidth);
            }

            if (dir.includes('s')) {
                const maxHeight = Math.max(minH, window.innerHeight - startTop - margin);
                nextHeight = clamp(startHeight + dy, minH, maxHeight);
            }

            if (dir.includes('w')) {
                const maxLeft = startLeft + startWidth - minW;
                nextLeft = clamp(startLeft + dx, margin, maxLeft);
                nextWidth = startWidth + (startLeft - nextLeft);
            }

            if (dir.includes('n')) {
                const maxTop = startTop + startHeight - minH;
                nextTop = clamp(startTop + dy, margin, maxTop);
                nextHeight = startHeight + (startTop - nextTop);
            }

            panel.style.left = `${Math.round(nextLeft)}px`;
            panel.style.top = `${Math.round(nextTop)}px`;
            panel.style.width = `${Math.round(nextWidth)}px`;
            panel.style.height = `${Math.round(nextHeight)}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!resizing) return;

            resizing = false;
            document.body.classList.remove('weda-copilote-resizing');

            savePanelState({
                left: panel.offsetLeft,
                top: panel.offsetTop,
                width: panel.offsetWidth,
                height: panel.offsetHeight
            });
        });
    }

    function enableResizeMemory(panel) {
        if (state.resizeObserverInstalled) return;
        state.resizeObserverInstalled = true;

        let timer = null;

        const observer = new ResizeObserver(() => {
            if (panel.classList.contains('collapsed')) return;

            clearTimeout(timer);
            timer = setTimeout(() => {
                const rect = panel.getBoundingClientRect();
                savePanelState({
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
            }, 350);
        });

        observer.observe(panel);
    }

    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;

        panel.innerHTML = `
            <div class="weda-copilote-resize-handle resize-n" data-resize-dir="n"></div>
            <div class="weda-copilote-resize-handle resize-e" data-resize-dir="e"></div>
            <div class="weda-copilote-resize-handle resize-s" data-resize-dir="s"></div>
            <div class="weda-copilote-resize-handle resize-w" data-resize-dir="w"></div>
            <div class="weda-copilote-resize-handle resize-ne" data-resize-dir="ne"></div>
            <div class="weda-copilote-resize-handle resize-nw" data-resize-dir="nw"></div>
            <div class="weda-copilote-resize-handle resize-se" data-resize-dir="se"></div>
            <div class="weda-copilote-resize-handle resize-sw" data-resize-dir="sw"></div>

            <div class="weda-copilote-header" title="Cliquer-glisser pour déplacer">
                <div class="weda-copilote-title">Copilote WEDA <span class="weda-copilote-version">v${SCRIPT_VERSION}</span></div>
                <div class="weda-copilote-header-buttons">
                    <button type="button" class="btn-collapse" title="Réduire / afficher">—</button>
                </div>
            </div>
            <div class="weda-copilote-body">
                <div class="weda-copilote-actions">
                    <button type="button" class="btn-run" title="Relance manuelle même si une analyse automatique existe déjà aujourd’hui">Analyser</button>
                    <button type="button" class="btn-copy-page">Copier page</button>
                    <button type="button" class="btn-copy-result">Copier résultat</button>
                </div>
                <div class="weda-copilote-result">
                    En attente de l’analyse.
                </div>
                <div class="weda-copilote-footer">
                    <div class="weda-copilote-status">Initialisation…</div>
                    <div class="weda-copilote-meta"></div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        placePanel(panel);
        enableDrag(panel);
        enableEdgeResize(panel);
        enableResizeMemory(panel);

        panel.querySelector('.btn-collapse')?.addEventListener('click', toggleCollapsed);
        panel.querySelector('.btn-run')?.addEventListener('click', () => runAnalysis('manuel', { force: true }));
        panel.querySelector('.btn-copy-page')?.addEventListener('click', async () => {
            if (!state.lastPageText) state.lastPageText = collectVisiblePageText();
            await copyText(state.lastPageText, 'Page WEDA copiée.');
        });
        panel.querySelector('.btn-copy-result')?.addEventListener('click', async () => {
            await copyText(state.lastResultText, 'Résultat copié.');
        });

        setStatus('Prêt.', 'success');
    }

    function installStyles() {
        GM_addStyle(`
            #${PANEL_ID} {
                position: fixed;
                z-index: 2147483647;
                width: ${CONFIG.PANEL_WIDTH_PX}px;
                height: ${CONFIG.PANEL_HEIGHT_PX}px;
                min-width: ${CONFIG.PANEL_MIN_WIDTH_PX}px;
                min-height: ${CONFIG.PANEL_MIN_HEIGHT_PX}px;
                max-width: calc(100vw - 18px);
                max-height: calc(100vh - 18px);
                background: #ffffff;
                border: 1px solid rgba(0, 40, 80, 0.35);
                border-radius: 10px;
                box-shadow: 0 10px 34px rgba(0, 0, 0, 0.28);
                font-family: Arial, Helvetica, sans-serif;
                color: #102033;
                overflow: visible;
                resize: none;
                box-sizing: border-box;
            }

            #${PANEL_ID}.collapsed {
                width: 265px !important;
                height: 38px !important;
                min-height: 38px;
            }

            #${PANEL_ID}.collapsed .weda-copilote-resize-handle {
                display: none;
            }

            #${PANEL_ID} .weda-copilote-resize-handle {
                position: absolute;
                z-index: 2147483647;
                background: transparent;
            }

            #${PANEL_ID} .resize-n {
                top: -5px;
                left: 12px;
                right: 12px;
                height: 10px;
                cursor: ns-resize;
            }

            #${PANEL_ID} .resize-s {
                bottom: -5px;
                left: 12px;
                right: 12px;
                height: 10px;
                cursor: ns-resize;
            }

            #${PANEL_ID} .resize-e {
                top: 12px;
                right: -5px;
                bottom: 12px;
                width: 10px;
                cursor: ew-resize;
            }

            #${PANEL_ID} .resize-w {
                top: 12px;
                left: -5px;
                bottom: 12px;
                width: 10px;
                cursor: ew-resize;
            }

            #${PANEL_ID} .resize-ne {
                top: -6px;
                right: -6px;
                width: 16px;
                height: 16px;
                cursor: nesw-resize;
            }

            #${PANEL_ID} .resize-nw {
                top: -6px;
                left: -6px;
                width: 16px;
                height: 16px;
                cursor: nwse-resize;
            }

            #${PANEL_ID} .resize-se {
                bottom: -6px;
                right: -6px;
                width: 16px;
                height: 16px;
                cursor: nwse-resize;
            }

            #${PANEL_ID} .resize-sw {
                bottom: -6px;
                left: -6px;
                width: 16px;
                height: 16px;
                cursor: nesw-resize;
            }

            #${PANEL_ID} .weda-copilote-header {
                height: 38px;
                background: #073b63;
                color: white;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 8px 0 12px;
                cursor: move;
                user-select: none;
                box-sizing: border-box;
                border-radius: 9px 9px 0 0;
                overflow: hidden;
            }

            #${PANEL_ID}.collapsed .weda-copilote-header {
                border-radius: 9px;
            }

            #${PANEL_ID} .weda-copilote-title {
                font-weight: 700;
                font-size: 15px;
                letter-spacing: 0.2px;
                display: flex;
                align-items: center;
                gap: 7px;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            #${PANEL_ID} .weda-copilote-version {
                font-size: 11px;
                font-weight: 800;
                color: #ffffff;
                background: rgba(255, 255, 255, 0.18);
                border: 1px solid rgba(255, 255, 255, 0.28);
                border-radius: 999px;
                padding: 2px 7px;
                line-height: 1.2;
            }

            #${PANEL_ID} .weda-copilote-header-buttons {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }

            #${PANEL_ID} button {
                font-family: Arial, Helvetica, sans-serif;
                cursor: pointer;
            }

            #${PANEL_ID} .btn-collapse {
                border: 1px solid rgba(255,255,255,0.45);
                background: rgba(255,255,255,0.13);
                color: #fff;
                border-radius: 6px;
                width: 29px;
                height: 25px;
                font-size: 16px;
                font-weight: 700;
                line-height: 18px;
            }

            #${PANEL_ID} .btn-collapse:hover {
                background: rgba(255,255,255,0.25);
            }

            #${PANEL_ID} .weda-copilote-body {
                padding: 8px;
                height: calc(100% - 38px);
                overflow: auto;
                background: #f7fafc;
                box-sizing: border-box;
                border-radius: 0 0 9px 9px;
            }

            #${PANEL_ID} .weda-copilote-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin-bottom: 6px;
            }

            #${PANEL_ID} .weda-copilote-actions button {
                border: 1px solid #bfd2e5;
                background: #ffffff;
                color: #073b63;
                border-radius: 7px;
                padding: 5px 8px;
                font-size: 12px;
                font-weight: 700;
            }

            #${PANEL_ID} .weda-copilote-actions button:hover {
                background: #edf6ff;
            }

            #${PANEL_ID} .weda-copilote-actions button:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }

            #${PANEL_ID} .weda-copilote-result {
                background: #ffffff;
                border: 1px solid #d7e2ef;
                border-radius: 8px;
                padding: 7px;
                font-size: 13px;
                line-height: 1.26;
                white-space: normal;
            }

            #${PANEL_ID} .weda-copilote-footer {
                margin-top: 6px;
            }

            #${PANEL_ID} .weda-copilote-status {
                font-size: 11px;
                font-weight: 700;
                border-radius: 7px;
                padding: 5px 7px;
                margin-top: 6px;
                margin-bottom: 4px;
                background: #e8eef5;
                color: #17324d;
                border: 1px solid #d3deea;
            }

            #${PANEL_ID} .weda-copilote-status.running {
                background: #fff8dc;
                color: #6b4b00;
                border-color: #e6d28b;
            }

            #${PANEL_ID} .weda-copilote-status.success {
                background: #e9f7ef;
                color: #126c36;
                border-color: #bde4ca;
            }

            #${PANEL_ID} .weda-copilote-status.error {
                background: #fdeaea;
                color: #8a1e1e;
                border-color: #f0b5b5;
            }

            #${PANEL_ID} .weda-copilote-meta {
                font-size: 10px;
                color: #5d6b78;
                margin: 0 2px 2px 2px;
                line-height: 1.25;
            }

            #${PANEL_ID} .weda-copilote-result pre {
                white-space: pre-wrap;
                margin: 0;
                font-family: Consolas, Monaco, monospace;
                font-size: 12px;
                line-height: 1.3;
            }

            #${PANEL_ID} .weda-copilote-result strong {
                font-weight: 800;
            }

            #${PANEL_ID} .weda-copilote-critical {
                color: #b00020;
                font-weight: 900;
            }

            #${PANEL_ID} .weda-copilote-heading {
                margin: 6px 0 3px 0;
                padding: 3px 6px;
                background: #073b63;
                color: #ffffff;
                border-radius: 5px;
                font-weight: 500;
                font-size: 10.5px;
                line-height: 1.15;
                letter-spacing: 0.1px;
            }

            #${PANEL_ID} .weda-copilote-heading:first-child {
                margin-top: 0;
            }

            #${PANEL_ID} .weda-copilote-line {
                padding: 5px 7px;
                border-radius: 6px;
                margin: 3px 0;
                background: #f7f9fb;
                border-left: 4px solid #d1dbe6;
            }

            #${PANEL_ID} .weda-copilote-line.level-rouge {
                background: #fff0f0;
                border-left-color: #d62424;
            }

            #${PANEL_ID} .weda-copilote-line.level-orange {
                background: #fff3df;
                border-left-color: #e9851a;
            }

            #${PANEL_ID} .weda-copilote-line.level-jaune {
                background: #fffbe0;
                border-left-color: #d7b600;
            }

            #${PANEL_ID} .weda-copilote-line.level-info {
                background: #eef6ff;
                border-left-color: #3a84c5;
            }

            #${PANEL_ID} .weda-copilote-spacer {
                height: 2px;
            }

            body.weda-copilote-dragging,
            body.weda-copilote-resizing {
                user-select: none !important;
            }

            body.weda-copilote-resizing * {
                cursor: inherit !important;
            }
        `);
    }

    async function init() {
        if (!isPatientHomePage()) return;

        if (isWorkerPage()) {
            log('Page worker détectée : copilote désactivé.');
            return;
        }

        purgeOldCaches();
        installStyles();
        createPanel();

        setMeta(`PatDk : ${getPatDk()} · ${nowFr()} · script v${SCRIPT_VERSION}`);

        const cached = getCachedAnalysisToday();
        if (cached) {
            displayCachedAnalysis(cached, 'init');
            return;
        }

        if (CONFIG.AUTO_ANALYSE_ON_LOAD) {
            setStatus('Analyse automatique imminente…', 'running');
            await sleep(CONFIG.AUTO_ANALYSE_DELAY_MS);

            const cachedAfterDelay = getCachedAnalysisToday();
            if (cachedAfterDelay) {
                displayCachedAnalysis(cachedAfterDelay, 'init-après-délai');
                return;
            }

            runAnalysis('auto', { force: false });
        }
    }

    init();

    window.WEDA_COPILOTE_LMSTUDIO_RUN = () => runAnalysis('console', { force: false });
    window.WEDA_COPILOTE_LMSTUDIO_FORCE_RUN = () => runAnalysis('manuel-console', { force: true });
    window.WEDA_COPILOTE_LMSTUDIO_COLLECT = collectVisiblePageText;
    window.WEDA_COPILOTE_LMSTUDIO_LAST_PAGE = () => state.lastPageText;
    window.WEDA_COPILOTE_LMSTUDIO_LAST_RESULT = () => state.lastResultText;
    window.WEDA_COPILOTE_LMSTUDIO_CACHE_TODAY = getCachedAnalysisToday;
    window.WEDA_COPILOTE_LMSTUDIO_VERSION = () => SCRIPT_VERSION;

})();