'use strict';

// Identités entièrement synthétiques ; aucune requête ni dossier réel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const scriptPath = process.env.MF_PATIENT_TEST_SCRIPT || path.join(__dirname, '..', 'scripts', 'Connecteur-madeformed-vers-weda.user..js');
const source = fs.readFileSync(scriptPath, 'utf8');

function harness() {
    const storage = new Map(), session = new Map(), notices = [], listeners = new Map();
    const location = {href:'https://secure.weda.fr/FolderMedical/FindPatientForm.aspx?tmJob=100_test',origin:'https://secure.weda.fr',hostname:'secure.weda.fr'};
    const document = {
        readyState:'loading', querySelector:()=>null, querySelectorAll:()=>[], getElementById:()=>null,
        addEventListener(name, callback) { listeners.set(name,callback); },
        body:{append(){},textContent:''}, createElement:()=>({style:{},setAttribute(){}}),
        defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})}
    };
    const sandbox = {
        document,location,URL,Date,Math,Event,
        MouseEvent:class {constructor(type,settings={}) {this.type=type;Object.assign(this,settings);}},
        KeyboardEvent:class {constructor(type,settings={}) {this.type=type;Object.assign(this,settings);}},
        setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame:()=>1,
        window:{setTimeout:()=>1,addEventListener(){},confirm:()=>true}, navigator:{},
        console:{log(){},warn(){},error(){}},
        sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,String(value))},
        GM_getValue:(key,fallback)=>storage.has(key)?storage.get(key):fallback,
        GM_setValue:(key,value)=>storage.set(key,value),GM_deleteValue:key=>storage.delete(key)
    };
    const exposure = `
    globalThis.patientApi = {
        wedaPatientNameKey,wedaPatientBirthDateKey,wedaPatientNativeId,wedaPatientNativeLinks,wedaPatientCandidate,
        wedaPatientMatch,findPatientResultTarget,wedaPatientRequire,wedaPatientRecordSelection,wedaPatientInstallSelection,
        wedaPatientBind,wedaPatientConsultationIdentity,wedaPatientBindConsultation,
        wedaPatientOpenedIdentity,wedaPatientOpenedMatch,wedaPatientConfirmOpened,
        clickWedaPatient,clickNewConsultation,fillConsultationAndSave,saveConsultationOnly,insertMessageInEditor,
        ensureMessageStillPresentBeforeSave,wedaMain,closeWedaTab,realClick,
        checkWedaCloseFromMadeformed,
        setCloseContext(tab,id,seenAt=0) { currentWedaTab=tab;currentWedaJobId=id;currentWedaSavedSeenAt=seenAt; },
        get token(){return WEDA_PATIENT_DOCUMENT_TOKEN;},
        hooks(hooks={}) {
            addLog=()=>{};refreshMadeformedPanel=()=>{};
            wedaPatientNotice=hooks.notice||(()=>{});wedaPatientHideNotice=()=>{};
            waitFor=hooks.wait|| (async predicate=>predicate()); sleep=hooks.sleep|| (async()=>{});
            scheduleWedaMainRetry=()=>{};
            if(hooks.editor) findWedaEditorContext=hooks.editor;
            if(hooks.contains) editorContainsMessage=hooks.contains;
        }
    };
`;
    const anchor = "    if (document.readyState === 'loading')";
    assert.ok(source.includes('/* BEGIN MFM_WEDA_PATIENT_GUARDS */'),'Le module patient doit être intégré.');
    assert.ok(source.includes(anchor));
    vm.runInNewContext(source.replace(anchor,exposure+anchor),sandbox,{filename:scriptPath});
    const api=sandbox.patientApi; api.hooks({notice:message=>notices.push(message)});
    const job={id:'100_test',source:'madeformed',action:'sms_to_consultation',patientName:'ALPHA TEST',message:'Texte synthétique',createdAt:Date.now(),status:'search_submitted',dateOfBirth:'01/02/1990'};
    const setJob=value=>storage.set('TM_MADEFORMED_TO_WEDA_JOB_V31',value);
    const getJob=()=>storage.get('TM_MADEFORMED_TO_WEDA_JOB_V31');
    setJob(job);
    function links(items) {document.querySelectorAll=selector=>selector.includes('PatientsGrid')?items:[];}
    function node(text='',attrs={},rowText=text) {
        const row={textContent:rowText,getAttribute:key=>attrs['row:'+key]||null,querySelectorAll:()=>[]};
        return {textContent:text,isConnected:true,disabled:false,ownerDocument:document,clicked:0,
            getAttribute:key=>attrs[key]??null,closest:selector=>selector==='tr'?row:null,
            getBoundingClientRect:()=>({width:100,height:20}),scrollIntoView(){},querySelector:()=>null,
            dispatchEvent(event){this.events?.push(event.type);this.onEvent?.(event);},
            click(){this.clicked++;this.onClick?.();},focus(){this.onFocus?.();}
        };
    }
    function candidate(name='ALPHA TEST',dob='01/02/1990',patDk='fixture_A',extra={}) {
        return node(name,{href:`/FolderMedical/PatientViewForm.aspx?PatDk=${patDk}`,...extra},`${name} ${dob}`);
    }
    function patientPage(patDk='fixture_A') {location.href=`https://secure.weda.fr/FolderMedical/PatientViewForm.aspx?PatDk=${patDk}`;}
    function consultationPage(doc='11',patDk='fixture_A') {location.href=`https://secure.weda.fr/FolderMedical/ConsultationForm.aspx?PatDk=${patDk}&Doc=${doc}`;}
    function openedIdentity(last='ALPHA',first='TEST',birth='01/02/1990') {
        const previous=document.querySelectorAll;
        const fields={LabelPatientNom:last,LabelPatientPrenom:first,LabelPatientDateNaissance:birth};
        document.querySelectorAll=selector=>{
            const key=selector.replace('#ContentPlaceHolder1_EtatCivilUCForm1_','');
            return Object.hasOwn(fields,key)?(fields[key]?[node(fields[key])]:[]):previous(selector);
        };
    }
    function boundJob() {
        api.wedaPatientRequire(job); patientPage();
        const selected={...job,status:'patient_clicked',wedaSelectedName:'alpha test',wedaSelectedPatDk:'fixture_A',wedaPatientSelectionAt:Date.now(),wedaPatientSelectionDocument:api.token};
        setJob(selected); return api.wedaPatientBind(selected);
    }
    function boundConsultation() {
        const bound=boundJob(), opening={...bound,status:'consultation_clicked',wedaNewConsultationRequestedAt:Date.now(),wedaNewConsultationOrigin:location.href,wedaNewConsultationDocument:api.token};
        setJob(opening);consultationPage();return api.wedaPatientBindConsultation(opening);
    }
    return {api,sandbox,storage,session,notices,listeners,location,document,job,setJob,getJob,links,node,candidate,patientPage,consultationPage,openedIdentity,boundJob,boundConsultation};
}

test('seul un nom natif exact normalisé est sélectionné, jamais des fragments voisins',()=>{
    const h=harness(), matching=h.candidate('Mme ALPHÀ, TEST'),extra=h.candidate('ALPHA TEST DEUX'),partial=h.candidate('ALPHA');
    h.links([matching,extra,partial]);assert.equal(h.api.findPatientResultTarget('ALPHA TEST','01/02/1990'),matching);
    h.links([extra,partial]);assert.equal(h.api.findPatientResultTarget('ALPHA TEST','01/02/1990'),null);
});

test('DOB normalisée strictement, date impossible refusée',()=>{
    const {api}=harness();assert.equal(api.wedaPatientBirthDateKey('1.2.1990'),'1990-02-01');
    assert.equal(api.wedaPatientBirthDateKey('1990-02-01'),'1990-02-01');assert.equal(api.wedaPatientBirthDateKey('31/02/1990'),'');
});

test('homonymes : choix manuel même si une seule DOB correspond',async()=>{
    const h=harness(), first=h.candidate(),other=h.candidate('ALPHA TEST','03/04/1991','fixture_B');h.links([first,other]);
    await h.api.clickWedaPatient(h.job);assert.equal(h.getJob().status,'awaiting_patient_selection');assert.equal(first.clicked+other.clicked,0);
});

test('homonymes de même DOB : aucune sélection au meilleur score',()=>{
    const h=harness();h.links([h.candidate(),h.candidate('ALPHA TEST','01/02/1990','fixture_B')]);
    assert.equal(h.api.wedaPatientMatch('ALPHA TEST','01/02/1990').reason,'ambiguous');
});

test('DOB connue contradictoire bloque automatiquement et ne clique pas',async()=>{
    const h=harness(), link=h.candidate('ALPHA TEST','03/04/1991');h.links([link]);
    await assert.rejects(h.api.clickWedaPatient(h.job),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(h.getJob().status,'error_patient_selection_conflict');assert.equal(link.clicked,0);
});

test('DOB invalide dans la tâche ne devient jamais une recherche par nom seul',()=>{
    const h=harness();h.links([h.candidate()]);assert.equal(h.api.wedaPatientMatch('ALPHA TEST','31/02/1990').reason,'invalid_identity');
});

test('DOB attendue manquante exige choix manuel et confirmation explicite',async()=>{
    const h=harness(), link=h.candidate('ALPHA TEST','');h.links([link]);await h.api.clickWedaPatient(h.job);
    assert.equal(h.getJob().status,'awaiting_patient_selection');assert.equal(link.clicked,0);
    let confirmations=0;h.sandbox.window.confirm=()=>{confirmations++;return false;};
    assert.equal(h.api.wedaPatientRecordSelection(h.getJob(),link,true),false);assert.equal(confirmations,1);
    assert.equal(h.getJob().status,'awaiting_patient_selection');
    h.sandbox.window.confirm=()=>true;assert.equal(h.api.wedaPatientRecordSelection(h.getJob(),link,true).status,'patient_clicked');
});

test('deux dates de naissance natives contradictoires restent bloquantes',()=>{
    const h=harness(),link=h.candidate('ALPHA TEST','01/02/1990 03/04/1991');h.links([link]);
    assert.equal(h.api.wedaPatientMatch('ALPHA TEST','01/02/1990').reason,'birth_conflict');
});

test('DOB dans une cellule adjacente au nom est lue même sans espace HTML',()=>{
    const h=harness(),link=h.candidate(),row=link.closest('tr');
    row.textContent='ALPHA TEST01/02/1990';row.querySelectorAll=selector=>selector==='td,th'?[{textContent:'ALPHA TEST'},{textContent:'01/02/1990'}]:[];
    h.links([link]);assert.equal(h.api.wedaPatientMatch('ALPHA TEST','01/02/1990').reason,'unique');
    row.textContent='ALPHA TEST03/04/1991';row.querySelectorAll=selector=>selector==='td,th'?[{textContent:'ALPHA TEST'},{textContent:'03/04/1991'}]:[];
    assert.equal(h.api.wedaPatientMatch('ALPHA TEST','01/02/1990').reason,'birth_conflict');
});

test('lien étranger et résultat détaché ne peuvent identifier un dossier',()=>{
    const h=harness(),foreign=h.candidate('ALPHA TEST','01/02/1990','fixture_A',{href:'https://example.invalid/FolderMedical/PatientViewForm.aspx?PatDk=fixture_A'}),detached=h.candidate();
    detached.isConnected=false;h.links([foreign,detached]);assert.equal(h.api.findPatientResultTarget('ALPHA TEST','01/02/1990'),null);
});

test('choix manuel natif reprend le bon dossier et refuse DOB contradictoire',()=>{
    const h=harness(), good=h.candidate(),bad=h.candidate('ALPHA TEST','03/04/1991','fixture_B');h.links([good,bad]);
    h.setJob({...h.job,status:'awaiting_patient_selection'});h.api.wedaPatientInstallSelection();
    const event={target:{closest:()=>good},button:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    h.listeners.get('click')(event);assert.equal(h.getJob().status,'patient_clicked');assert.equal(h.getJob().wedaSelectedPatDk,'fixture_A');
    h.setJob({...h.job,status:'awaiting_patient_selection'});event.target.closest=()=>bad;
    h.listeners.get('click')(event);assert.equal(h.getJob().status,'error_patient_selection_conflict');assert.equal(event.prevented,true);
});

test('sélection native directe n’est déclenchée qu’une fois',async()=>{
    const h=harness(),link=h.candidate();h.links([link]);await h.api.clickWedaPatient(h.job);
    assert.equal(link.clicked,1);assert.equal(h.getJob().wedaSelectedPatDk,'fixture_A');
});

test('URL patient nue après recherche ne remplace pas une sélection enregistrée',async()=>{
    const h=harness();h.api.wedaPatientRequire(h.job);h.patientPage();await h.api.wedaMain();
    assert.equal(h.getJob().status,'error_patient_selection_unverified');
});

test('PatDk ouvert contradictoire avec le résultat choisi ne peut être lié',()=>{
    const h=harness();h.api.wedaPatientRequire(h.job);h.patientPage('fixture_B');
    const selected={...h.job,wedaSelectedName:'alpha test',wedaSelectedPatDk:'fixture_A',wedaPatientSelectionAt:Date.now()};h.setJob(selected);
    assert.throws(()=>h.api.wedaPatientBind(selected),{code:'WEDA_PATIENT_GUARD'});assert.equal(h.getJob().status,'error_patient_selection_unverified');
});

test('postback sans PatDk ne peut lier le patient dans le document d’origine',()=>{
    const h=harness();h.api.wedaPatientRequire(h.job);h.patientPage();
    const selected={...h.job,wedaSelectedName:'alpha test',wedaSelectedPatDk:'',wedaPatientSelectionAt:Date.now(),wedaPatientSelectionDocument:h.api.token};h.setJob(selected);
    assert.throws(()=>h.api.wedaPatientBind(selected),{code:'WEDA_PATIENT_GUARD'});
    h.setJob({...selected,wedaPatientSelectionDocument:'previous_document'});
    h.openedIdentity();
    assert.equal(h.api.wedaPatientBind(h.getJob()).wedaPatDk,'fixture_A');
});

test('changer de tâche globale ou d’onglet n’autorise pas d’écriture',()=>{
    const h=harness(),bound=h.boundJob();h.setJob({...bound,id:'101_other'});
    assert.throws(()=>h.api.wedaPatientRequire(bound,true),{code:'WEDA_PATIENT_GUARD'});assert.equal(h.getJob().status,'patient_clicked');
    h.setJob(bound);h.location.href+='&tmJob=101_other';assert.throws(()=>h.api.wedaPatientRequire(bound,true),{code:'WEDA_PATIENT_GUARD'});
});

test('changer de dossier pendant l’attente Nouvelle consultation annule le clic',async()=>{
    const h=harness(),bound=h.boundJob(),button=h.node('Nouvelle consultation');
    h.api.hooks({wait:async()=>{h.patientPage('fixture_B');return button;},notice:message=>h.notices.push(message)});
    await assert.rejects(h.api.clickNewConsultation(bound),{code:'WEDA_PATIENT_GUARD'});assert.equal(button.clicked,0);assert.equal(h.getJob().status,'error_patient_changed');
});

test('la nouvelle consultation doit être liée à un clic demandé pour ce dossier',()=>{
    const h=harness(),bound=h.boundJob();h.consultationPage();
    assert.throws(()=>h.api.wedaPatientBindConsultation(bound),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(h.getJob().status,'error_consultation_unverified');
});

test('une autre consultation du même patient bloque également les écritures',()=>{
    const h=harness(),bound=h.boundConsultation();h.consultationPage('12');
    assert.throws(()=>h.api.wedaPatientRequire(bound,true,true),{code:'WEDA_PATIENT_GUARD'});assert.equal(h.getJob().status,'error_consultation_changed');
});

test('changer de dossier avant ou pendant le focus de l’insertion empêche tout collage',()=>{
    const h=harness(),bound=h.boundConsultation(),el=h.node(),editorDocument={getSelection:()=>({removeAllRanges(){},addRange(){}}),createRange:()=>({selectNodeContents(){},collapse(){}}),execCommand(){this.inserted=true;}};
    h.patientPage('fixture_B');assert.throws(()=>h.api.insertMessageInEditor({doc:editorDocument,el},'Texte'),{code:'WEDA_PATIENT_GUARD'});assert.equal(editorDocument.inserted,undefined);
    h.setJob(bound);h.consultationPage();el.onFocus=()=>h.patientPage('fixture_B');
    assert.throws(()=>h.api.insertMessageInEditor({doc:editorDocument,el},'Texte'),{code:'WEDA_PATIENT_GUARD'});assert.equal(editorDocument.inserted,undefined);
});

test('éditeur détaché ne reçoit aucun collage même avec le même dossier',()=>{
    const h=harness();h.boundConsultation();const el=h.node();el.isConnected=false;
    assert.throws(()=>h.api.insertMessageInEditor({doc:{},el},'Texte'),{code:'WEDA_PATIENT_GUARD'});assert.equal(h.getJob().status,'error_editor_changed');
});

test('changer de dossier pendant la vérification ne déclenche pas la réinsertion',async()=>{
    const h=harness(),bound=h.boundConsultation(),el=h.node();h.api.hooks({sleep:async()=>h.patientPage('fixture_B'),contains:()=>false});
    await assert.rejects(h.api.ensureMessageStillPresentBeforeSave({doc:{},el},'Texte',bound),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(el.innerHTML,undefined);assert.equal(h.getJob().status,'error_patient_changed');
});

test('changer de dossier pendant l’attente du bouton Enregistrer annule tout clic',async()=>{
    const h=harness(),bound=h.boundConsultation(),button=h.node('Enregistrer');h.setJob({...bound,status:'consultation_saving'});
    h.api.hooks({wait:async()=>{h.patientPage('fixture_B');return button;}});
    await assert.rejects(h.api.saveConsultationOnly(),{code:'WEDA_PATIENT_GUARD'});assert.equal(button.clicked,0);assert.equal(h.getJob().status,'error_patient_changed');
});

test('clic WEDA gardé natif unique, annulé si le dossier change au dernier contrôle',()=>{
    const h=harness(),bound=h.boundConsultation(),button=h.node();button.events=[];
    let reads=0;
    assert.throws(()=>h.api.realClick(button,()=>{if(++reads===2) h.patientPage('fixture_B');h.api.wedaPatientRequire(bound,true,true);}),{code:'WEDA_PATIENT_GUARD'});
    assert.deepEqual(button.events,[]);assert.equal(button.clicked,0);
    h.setJob(bound);h.consultationPage();h.api.realClick(button,()=>h.api.wedaPatientRequire(bound,true,true));
    assert.equal(button.clicked,1);assert.deepEqual(button.events,[]);
});

test('fermeture automatique refusée après changement de patient, tâche conservée',()=>{
    const h=harness(),bound=h.boundConsultation();h.patientPage('fixture_B');
    assert.throws(()=>h.api.closeWedaTab(bound),{code:'WEDA_PATIENT_GUARD'});assert.ok(h.getJob());assert.equal(h.storage.has('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31'),false);
});

test('trace périmée opaque n’est jamais relancée et n’affiche plus de bandeau passif',async()=>{
    const h=harness();h.setJob({id:h.job.id,status:'expired_unknown',createdAt:0});await h.api.wedaMain();
    assert.equal(h.getJob().status,'expired_unknown');assert.equal(h.notices.length,0);
    assert.equal(h.storage.has('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31'),false);
});

test('une ouverture périmée migrée ne relance ni recherche, ni consultation, ni fermeture',async()=>{
    const h=harness(),link=h.candidate(),initialUrl=h.location.href;
    h.links([link]);
    h.setJob({...h.job,action:'open_patient',status:'expired_unknown',resultUnknown:true,
        createdAt:Date.now()-21*60*1000,sensitiveDataExpiredAt:Date.now()-1000});
    await h.api.wedaMain();
    assert.equal(h.getJob().status,'error_transfer_expired');assert.equal(h.getJob().resultUnknown,false);
    assert.equal(h.getJob().message,undefined);assert.equal(h.location.href,initialUrl);
    assert.equal(link.clicked,0);assert.equal(h.notices.length,0);
    assert.equal(h.storage.has('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31'),false);
    await assert.rejects(h.api.clickWedaPatient(h.job),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(link.clicked,0);assert.equal(h.getJob().status,'error_transfer_expired');
});

test('un ancien onglet ne peut reprendre la nouvelle tâche après migration de son ouverture périmée',async()=>{
    const h=harness(),link=h.candidate();h.links([link]);h.api.wedaPatientRequire(h.job);
    h.setJob({...h.job,action:'open_patient',createdAt:Date.now()-21*60*1000});await h.api.wedaMain();
    h.setJob({...h.job,id:'200_new',status:'open_search'});
    await assert.rejects(h.api.clickWedaPatient(h.job),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(link.clicked,0);assert.equal(h.getJob().id,'200_new');assert.equal(h.getJob().status,'open_search');
});

test('identité de la tâche modifiée après sélection bloque l’écriture malgré le même PatDk',()=>{
    const h=harness(),link=h.candidate();h.links([link]);h.api.wedaPatientRecordSelection(h.job,link,false);
    h.patientPage();const bound=h.api.wedaPatientBind(h.getJob());h.setJob({...bound,dateOfBirth:'03/04/1991'});
    assert.throws(()=>h.api.wedaPatientRequire(bound,true),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(h.getJob().status,'error_patient_selection_conflict');
});

test('parcours normal conservé : dossier exact, nouvelle consultation, texte, sauvegarde puis fermeture',async()=>{
    const h=harness(),link=h.candidate();h.links([link]);await h.api.clickWedaPatient(h.job);h.patientPage();
    const newButton=h.node('Nouvelle consultation'),saveButton=h.node('Enregistrer'),el=h.node();
    let inserted='';
    const editorDocument={getSelection:()=>({removeAllRanges(){},addRange(){}}),createRange:()=>({selectNodeContents(){},collapse(){}}),execCommand:(command,unused,html)=>{inserted=html;}};
    const ctx={doc:editorDocument,el};
    h.document.querySelector=selector=>selector.includes('submenu')?newButton:selector.includes('ButtonSave')?saveButton:null;
    newButton.onClick=()=>h.consultationPage();
    h.api.hooks({editor:()=>ctx,contains:()=>Boolean(inserted)});
    await h.api.clickNewConsultation(h.getJob());assert.equal(newButton.clicked,1);
    await h.api.fillConsultationAndSave(h.getJob());
    assert.match(inserted,/Texte synthétique/);assert.equal(saveButton.clicked,1);
    assert.equal(h.getJob(),undefined);assert.ok(h.storage.get('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31'));
});

test('postback sans PatDk puis fiche inattendue avec identité native contradictoire : aucune liaison',()=>{
    const h=harness();h.api.wedaPatientRequire(h.job);h.patientPage('fixture_B');h.openedIdentity('BETA','TEST','03/04/1991');
    const selected={...h.job,wedaSelectedName:'alpha test',wedaSelectedPatDk:'',wedaPatientSelectionAt:Date.now(),wedaPatientSelectionDocument:'previous_document'};
    h.setJob(selected);assert.throws(()=>h.api.wedaPatientBind(selected),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(h.getJob().status,'error_patient_selection_conflict');assert.equal(h.getJob().wedaPatDk,undefined);
});

test('postback sans ID ni identité native disponible attend la confirmation de la fiche épinglée',()=>{
    const h=harness();h.api.wedaPatientRequire(h.job);h.patientPage();
    const selected={...h.job,wedaSelectedName:'alpha test',wedaSelectedPatDk:'',wedaPatientSelectionAt:Date.now(),wedaPatientSelectionDocument:'previous_document'};
    h.setJob(selected);assert.equal(h.api.wedaPatientBind(selected),null);
    assert.equal(h.getJob().status,'awaiting_patient_confirmation');assert.equal(h.getJob().wedaPendingPatDk,'fixture_A');
    assert.equal(h.getJob().wedaPatDk,undefined);
    const confirmed=h.api.wedaPatientConfirmOpened(h.getJob());assert.equal(confirmed.wedaPatDk,'fixture_A');assert.ok(confirmed.wedaOpenedPatientConfirmedAt);
});

test('changer de fiche pendant la confirmation manuelle refuse le nouveau PatDk',()=>{
    const h=harness();h.api.wedaPatientRequire(h.job);h.patientPage();
    const selected={...h.job,wedaSelectedName:'alpha test',wedaSelectedPatDk:'',wedaPatientSelectionAt:Date.now(),wedaPatientSelectionDocument:'previous_document'};
    h.setJob(selected);h.api.wedaPatientBind(selected);const pending=h.getJob();h.patientPage('fixture_B');
    assert.throws(()=>h.api.wedaPatientConfirmOpened(pending),{code:'WEDA_PATIENT_GUARD'});assert.equal(h.getJob().wedaPatDk,undefined);
});

test('identité native visible contradictoire bloque même quand l’URL garde le même PatDk',()=>{
    const h=harness(),bound=h.boundConsultation();h.openedIdentity('BETA','TEST','03/04/1991');
    assert.throws(()=>h.api.wedaPatientRequire(bound,true,true),{code:'WEDA_PATIENT_GUARD'});assert.equal(h.getJob().status,'error_patient_selection_conflict');
});

test('expiration pendant l’attente Enregistrer empêche le clic et garde la trace opaque',async()=>{
    const h=harness(),bound=h.boundConsultation(),button=h.node('Enregistrer');h.setJob({...bound,status:'consultation_saving'});
    h.api.hooks({wait:async()=>{h.setJob({...h.getJob(),createdAt:Date.now()-21*60*1000});return button;}});
    await assert.rejects(h.api.saveConsultationOnly(),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(button.clicked,0);assert.equal(h.getJob().status,'expired_unknown');assert.equal(h.getJob().message,undefined);
    assert.equal(h.storage.has('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31'),false);
});

test('expiration après demande de sauvegarde garde le verrou incertain et refuse la fermeture',()=>{
    const h=harness(),bound=h.boundConsultation();h.setJob({...bound,status:'saved_pending_close',createdAt:Date.now()-21*60*1000});
    assert.throws(()=>h.api.closeWedaTab(bound),{code:'WEDA_PATIENT_GUARD'});
    assert.equal(h.getJob().status,'expired_unknown');assert.equal(h.getJob().resultUnknown,true);assert.equal(h.getJob().message,undefined);
    assert.equal(h.storage.has('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31'),false);
});

test('MadeForMed ne ferme pas WEDA sur le seul statut sauvegarde demandée après 1,8 seconde',()=>{
    const h=harness();h.location.hostname='pro.madeformed.com';let closed=0;
    h.api.setCloseContext({close(){closed++;}},h.job.id,Date.now()-10_000);
    h.setJob({...h.job,status:'saved_pending_close',savedAt:Date.now()-10_000});
    h.api.checkWedaCloseFromMadeformed();assert.equal(closed,0);
});

test('MadeForMed ne ferme pas WEDA sur la seule suppression de la tâche',()=>{
    const h=harness();h.location.hostname='pro.madeformed.com';let closed=0;
    h.api.setCloseContext({close(){closed++;}},h.job.id,Date.now()-10_000);
    h.storage.delete('TM_MADEFORMED_TO_WEDA_JOB_V31');
    h.api.checkWedaCloseFromMadeformed();assert.equal(closed,0);
});

test('MadeForMed ferme une fois seulement sur demande explicite du même transfert',()=>{
    const h=harness();h.location.hostname='pro.madeformed.com';let closed=0;
    h.api.setCloseContext({close(){closed++;}},h.job.id,Date.now()-10_000);
    h.storage.set('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31',{jobId:h.job.id,reason:'fixture_guarded',requestedAt:Date.now()});
    h.api.checkWedaCloseFromMadeformed();h.api.checkWedaCloseFromMadeformed();
    assert.equal(closed,1);assert.equal(h.storage.has('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31'),false);
});

test('MadeForMed refuse une demande de fermeture appartenant à un autre transfert',()=>{
    const h=harness();h.location.hostname='pro.madeformed.com';let closed=0;
    h.api.setCloseContext({close(){closed++;}},h.job.id,Date.now()-10_000);
    h.storage.set('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31',{jobId:'101_other',requestedAt:Date.now()});
    h.api.checkWedaCloseFromMadeformed();assert.equal(closed,0);
    assert.equal(h.storage.get('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31').jobId,'101_other');
});
