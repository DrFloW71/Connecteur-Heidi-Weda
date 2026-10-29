'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const scriptPath = path.join(__dirname,'..','scripts','Connecteur-madeformed-vers-weda.user..js');
const source = fs.readFileSync(scriptPath,'utf8');

function harness() {
    const storage = new Map(), consoleCalls = [], alerts = [], openedTabs = [];
    let now = Date.parse('2026-10-08T16:00:00Z');
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    const document = {readyState:'loading', addEventListener(){}, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[]};
    const sandbox = {document, Date:ClockDate, URL, Event, TextEncoder, crypto:webcrypto,
        location:{hostname:'pro.madeformed.com',origin:'https://pro.madeformed.com',pathname:'/messages',href:'https://pro.madeformed.com/messages?patient=DEMO&token=TEST',hash:''},
        window:{addEventListener(){},setInterval,clearInterval,setTimeout,clearTimeout},
        setTimeout,clearTimeout,setInterval,clearInterval,
        console:{log:(...a)=>consoleCalls.push(a),warn:(...a)=>consoleCalls.push(a),error:(...a)=>consoleCalls.push(a)},
        alert:message=>alerts.push(message),
        GM_openInTab:(url,options)=>{openedTabs.push({url,options});return {};},
        GM_getValue:(key,fallback)=>storage.has(key)?storage.get(key):fallback,
        GM_setValue:(key,value)=>storage.set(key,value),GM_deleteValue:key=>storage.delete(key)};
    const exposed = `
    globalThis.privacy = {VERSION, JOB_KEY, LOG_KEY, TRANSFER_AUDIT_KEY, PANEL_COLLAPSED_KEY,
        JOB_SENSITIVE_TTL_MS, TRANSFER_AUDIT_TTL_MS, TRANSFER_AUDIT_LIMIT,
        sanitizeLogData,sanitizeLogMessage,safeJobForLog,getLogs,setLogs,addLog,buildLogText,
        getJob,saveJob,updateJob,clearJob,getTransferAudit,recordTransferAudit,resetAll,madeformedJobStatusLabel,
        openWedaPatientJobFromMadeformed,
        hooks(hooks){if(hooks.clearMemory)mfmNativeClearGroupMemory=hooks.clearMemory;}};
`;
    const anchor = "    if (document.readyState === 'loading')";
    assert.ok(source.includes(anchor));
    vm.runInNewContext(source.replace(anchor,()=>exposed+anchor),sandbox,{filename:scriptPath});
    return {api:sandbox.privacy, storage, sandbox, consoleCalls, alerts, openedTabs, now:()=>now, advance:ms=>{now+=ms;}};
}

function job(h, overrides={}) {
    return {id:`${h.now()}_fixture`,action:'sms_to_consultation',source:'madeformed',status:'open_search',createdAt:h.now(),
        patientName:'PATIENT FICTIF',patientNameRaw:'Patient Fictif',dateOfBirth:'01/01/1980',message:'Texte fictif confidentiel',
        wedaPatDk:'patient_fixture',href:'https://secure.weda.fr/?PatDk=patient_fixture',...overrides};
}

test('les journaux masquent aussi les identités, contacts, URL et erreurs imbriquées',()=>{
    const h=harness();
    const safe=h.api.sanitizeLogData({patientName:'PATIENT FICTIF',dateOfBirth:'01/01/1980',phone:'0102030405',
        nested:{url:'https://example.test/private',message:'Texte fictif confidentiel',stack:'identité test'},
        phase:'checking',fileCount:2,reason:'PATIENT FICTIF'});
    const text=JSON.stringify(safe);
    for(const secret of ['PATIENT FICTIF','01/01/1980','0102030405','example.test','Texte fictif confidentiel','identité test']) assert.ok(!text.includes(secret));
    assert.equal(safe.phase,'checking');assert.equal(safe.fileCount,2);
});

test('les anciens logs sont nettoyés à la lecture et à leur sauvegarde',()=>{
    const h=harness();h.storage.set(h.api.LOG_KEY,[{at:'2026-10-08T16:00:00Z',page:'WEDA',level:'INFO',url:'https://example.test/private',
        message:'Lecture https://example.test/private',data:{patientName:'PATIENT FICTIF'}}]);
    h.api.setLogs(h.api.getLogs());
    const text=JSON.stringify(h.storage.get(h.api.LOG_KEY));
    assert.ok(!text.includes('example.test'));assert.ok(!text.includes('PATIENT FICTIF'));assert.ok(!text.includes('"url"'));
});

test('les numéros français sont masqués aussi avec le préfixe +33',()=>{
    const h=harness();
    for(const phone of ['+33 1 02 03 04 05','0033 1 02 03 04 05','01 02 03 04 05','+33102030405']) {
        assert.equal(h.api.sanitizeLogMessage(`Appel ${phone}`),'Appel [numéro masqué]');
        assert.equal(h.api.sanitizeLogMessage(phone),'[numéro masqué]');
    }
});

test('la console et le stockage reçoivent les mêmes données masquées',()=>{
    const h=harness();h.api.addLog('ERROR','Échec de lecture',{patientName:'PATIENT FICTIF',stack:'Texte fictif confidentiel',errorCode:'patient_changed'});
    const text=JSON.stringify([h.consoleCalls,h.storage.get(h.api.LOG_KEY)]);
    assert.ok(!text.includes('PATIENT FICTIF'));assert.ok(!text.includes('Texte fictif confidentiel'));assert.ok(text.includes('patient_changed'));
});

test('les logs copiés excluent aussi la requête URL et les données du job courant',()=>{
    const h=harness();h.storage.set(h.api.JOB_KEY,job(h));
    const text=h.api.buildLogText();
    for(const secret of ['PATIENT FICTIF','Patient Fictif','Texte fictif confidentiel','patient_fixture','token=TEST','patient=DEMO']) assert.ok(!text.includes(secret));
    assert.ok(text.includes('https://pro.madeformed.com/messages'));
});

test('une trace du transfert conserve seulement six champs techniques',()=>{
    const h=harness();h.api.saveJob(job(h));
    const records=h.storage.get(h.api.TRANSFER_AUDIT_KEY);
    assert.equal(records.length,1);
    assert.deepEqual(Object.keys(records[0]).sort(),['action','createdAt','id','resultUnknown','status','updatedAt']);
    assert.ok(!JSON.stringify(records).includes('PATIENT FICTIF'));
});

test('le journal technique est borné à cent transferts et vingt-quatre heures',()=>{
    const h=harness();
    for(let i=0;i<105;i++)h.api.recordTransferAudit(job(h,{id:`${h.now()+i}_fixture`}));
    assert.equal(h.api.getTransferAudit().length,100);
    h.advance(h.api.TRANSFER_AUDIT_TTL_MS+1);
    assert.equal(h.api.getTransferAudit().length,0);
});

test('une trace future ou malformée est ignorée',()=>{
    const h=harness();h.storage.set(h.api.TRANSFER_AUDIT_KEY,[{id:'not_valid',updatedAt:h.now()},
        {id:`${h.now()}_fixture`,updatedAt:h.now()+1}]);
    assert.equal(h.api.getTransferAudit().length,0);
});

test('les dates du journal technique doivent être numériques et cohérentes',()=>{
    const h=harness();h.storage.set(h.api.TRANSFER_AUDIT_KEY,[
        {id:`${h.now()}_one`,createdAt:'PATIENT FICTIF',updatedAt:h.now()},
        {id:`${h.now()}_two`,createdAt:h.now()+1,updatedAt:h.now()},
        {id:`${h.now()}_three`,createdAt:h.now()-1,updatedAt:h.now(),action:'sms_to_consultation',status:'open_search'}]);
    const records=h.api.getTransferAudit();
    assert.equal(records.length,1);assert.equal(records[0].id,`${h.now()}_three`);
    assert.ok(!h.api.buildLogText().includes('PATIENT FICTIF'));
});

test('expiration après vingt minutes : contenu effacé, résultat inconnu préservé',()=>{
    const h=harness();h.api.saveJob(job(h));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    const expired=h.api.getJob();
    assert.equal(expired.status,'expired_unknown');assert.equal(expired.resultUnknown,true);
    for(const field of ['patientName','patientNameRaw','dateOfBirth','message','wedaPatDk','href'])assert.ok(!Object.hasOwn(expired,field));
    assert.ok(!JSON.stringify([...h.storage]).includes('Texte fictif confidentiel'));
});

test('une date de transfert future ou non valide ne prolonge pas la conservation du contenu',()=>{
    for(const createdAt of [NaN,Infinity,'invalide',0,Date.parse('2026-10-08T17:00:00Z')]) {
        const h=harness();h.storage.set(h.api.JOB_KEY,job(h,{createdAt}));
        const expired=h.api.getJob();assert.equal(expired.status,'expired_unknown');
        assert.ok(!Object.hasOwn(expired,'message'));assert.equal(h.api.clearJob(),false);
        assert.ok(!JSON.stringify([...h.storage]).includes('Texte fictif confidentiel'));
        assert.equal(h.api.getTransferAudit().length,1);
    }
});

test('un transfert périmé inconnu ne peut être effacé ni remplacé par un ancien callback',()=>{
    const h=harness();h.api.saveJob(job(h));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    h.api.getJob();assert.equal(h.api.clearJob(),false);
    assert.equal(h.api.updateJob({status:'patient_clicked',patientName:'PATIENT FICTIF'}),null);
    assert.throws(()=>h.api.saveJob(job(h,{id:`${h.now()}_other`})),/Vérifiez/);
    assert.equal(h.api.getJob().status,'expired_unknown');
});

test('une ouverture de dossier périmée libère les actions sans reprendre l’ancienne ouverture',()=>{
    const h=harness();h.api.saveJob(job(h,{action:'open_patient',message:''}));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    const expired=h.api.getJob();
    assert.equal(expired.status,'error_transfer_expired');assert.equal(expired.resultUnknown,false);
    assert.ok(!Object.hasOwn(expired,'patientName'));assert.ok(!Object.hasOwn(expired,'message'));
    assert.match(h.api.madeformedJobStatusLabel(expired),/vous pouvez ouvrir/);
    assert.equal(h.api.updateJob({status:'patient_clicked',patientName:'PATIENT FICTIF'}),null);
    assert.equal(h.openedTabs.length,0);assert.equal(h.alerts.length,0);
    assert.equal(h.api.openWedaPatientJobFromMadeformed({patientNameRaw:'AUTRE DEMO',dateOfBirth:'02/02/1980'},'madeformed_messages','Ouverture fictive'),true);
    assert.equal(h.openedTabs.length,1);assert.notEqual(h.api.getJob().id,expired.id);
    assert.equal(h.api.getJob().status,'open_search');
    assert.equal(h.api.getTransferAudit().find(item=>item.id===expired.id).resultUnknown,false);
});

test('le verrou open_patient déjà conservé par la V4.3 est migré une seule fois',()=>{
    const h=harness(),expiredAt=h.now()-2*24*60*60*1000;
    h.storage.set(h.api.JOB_KEY,{id:`${expiredAt}_legacy`,action:'open_patient',source:'madeformed_messages',
        createdAt:expiredAt-h.api.JOB_SENSITIVE_TTL_MS,updatedAt:expiredAt,
        status:'expired_unknown',resultUnknown:true,sensitiveDataExpiredAt:expiredAt});
    const migrated=h.api.getJob();
    assert.equal(migrated.status,'error_transfer_expired');assert.equal(migrated.resultUnknown,false);
    assert.equal(migrated.sensitiveDataExpiredAt,expiredAt);
    h.advance(1000);assert.equal(h.api.getJob().updatedAt,migrated.updatedAt);
    assert.equal(h.api.getTransferAudit().length,1);assert.equal(h.openedTabs.length,0);
    h.api.saveJob(job(h));assert.equal(h.api.getJob().action,'sms_to_consultation');
});

test('Reset peut effacer une ouverture seule expirée',()=>{
    const h=harness();h.api.saveJob(job(h,{action:'open_patient',message:''}));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    h.api.resetAll();assert.equal(h.api.getJob(),null);assert.equal(h.openedTabs.length,0);
});

test('les anciens transferts de réponse ou d’action inconnue gardent leur vérification manuelle',()=>{
    for(const action of ['sms_to_consultation','send_message',undefined]) {
        const h=harness(),old=job(h,{action,status:'expired_unknown',resultUnknown:true,sensitiveDataExpiredAt:h.now()-1});
        h.storage.set(h.api.JOB_KEY,old);
        assert.equal(h.api.openWedaPatientJobFromMadeformed({patientNameRaw:'AUTRE DEMO'},'madeformed_messages','Ouverture fictive'),false);
        assert.equal(h.api.getJob().status,'expired_unknown');assert.equal(h.api.getJob().resultUnknown,true);
        assert.equal(h.openedTabs.length,0);assert.equal(h.alerts.length,1);
        assert.equal(h.api.clearJob(),false);assert.throws(()=>h.api.saveJob(job(h)),/Vérifiez/);
    }
});

test('l’archivage manuel libère le transfert sans écriture clinique',()=>{
    const h=harness();h.api.saveJob(job(h));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    h.api.getJob();h.api.updateJob({status:'archived_manually_verified',resultUnknown:false});h.api.clearJob();
    assert.equal(h.api.getJob(),null);
    assert.equal(h.api.getTransferAudit()[0].status,'archived_manually_verified');
});

test('un transfert terminé périmé est nettoyé sans demander une nouvelle écriture',()=>{
    const h=harness();h.api.saveJob(job(h,{status:'open_patient_done'}));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    assert.equal(h.api.getJob().status,'error_transfer_expired');assert.equal(h.api.getJob().resultUnknown,false);
    h.api.clearJob();assert.equal(h.api.getJob(),null);
});

test('une sauvegarde demandée reste à vérifier si son résultat expire',()=>{
    const h=harness();h.api.saveJob(job(h,{status:'saved_pending_close'}));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    const expired=h.api.getJob();assert.equal(expired.status,'expired_unknown');assert.equal(expired.resultUnknown,true);
    assert.equal(h.api.clearJob(),false);
    assert.throws(()=>h.api.saveJob(job(h,{id:`${h.now()}_new`})),/Vérifiez/);
});

test('Reset refuse d’effacer un résultat expiré inconnu',()=>{
    const h=harness();h.api.saveJob(job(h));h.advance(h.api.JOB_SENSITIVE_TTL_MS+1);
    h.api.resetAll();assert.equal(h.api.getJob().status,'expired_unknown');assert.equal(h.alerts.length,1);
});

test('les libellés du panneau expriment les étapes sans exposer les codes d’erreur',()=>{
    const h=harness();assert.equal(h.api.madeformedJobStatusLabel(null),'Aucun');
    assert.match(h.api.madeformedJobStatusLabel({status:'search_submitted'}),/Résultats/);
    assert.match(h.api.madeformedJobStatusLabel({status:'awaiting_patient_selection'}),/Choisissez/);
    assert.match(h.api.madeformedJobStatusLabel({status:'error_patient_changed'}),/Interrompu/);
    assert.match(h.api.madeformedJobStatusLabel({status:'expired_unknown'}),/contenu effacé/);
});
