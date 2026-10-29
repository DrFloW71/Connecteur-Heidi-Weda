'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {execFileSync} = require('node:child_process');
const {createWedaBiologyEnhancements} = require('../scripts/lib/biologie-weda');
const root = path.join(__dirname, '..');
const api = createWedaBiologyEnhancements();
const header = 'Libellé\tValeur\tUnité\tMinimum\tMaximum\tStatut Weda\n';
const report = rows => header + rows.map(row => row.join('\t')).join('\n');
const row = (label, value, unit, status = 'HAUT', min = '', max = '') => [label, value, unit, min, max, status];

test('convertit glycémie et normes, conserve le statut initial près des bornes', () => {
  assert.deepEqual(api.normalizeRow(row('Glycémie', '7', 'mmol/L', 'HAUT', '3,9', '6,1')),
    row('Glycémie', '1,26', 'g/L', 'HAUT', '0,7', '1,1'));
  assert.equal(api.normalizeRow(row('Glycémie', '6,101', 'mmol/L', 'HAUT'))[5], 'HAUT');
  for (const [value, unit] of [['126', 'mg/dL'], ['1260', 'mg/L'], ['1,26', 'g/L']]) {
    assert.equal(api.normalizeRow(row('Glycémie', value, unit))[1], '1,26');
  }
});
test('aucune conversion d’urines/LCR, unité absente, intervalle ou norme narrative', () => {
  for (const input of [
    row('Glucose urinaire', '7', 'mmol/L'), row('Glucose LCR', '7', 'mmol/L'),
    row('Glycémie', '7', ''), row('Glycémie', '5-7', 'mmol/L'),
    row('Glycémie', '7', 'mmol/L', 'HAUT', '3 à 4', '6'),
  ]) assert.deepEqual(api.normalizeRow(input), input);
});
test('convertit LDL, HDL, non-HDL par le code et conserve les trois fractions', () => {
  const output = api.enrichTitle('LDL 2 mmol/L, HDL 1 mmol/L, non-HDL2,5 mmol/L',
    report([row('LDL', '2', 'mmol/L'), row('HDL', '1', 'mmol/L'), row('non-HDL', '2,5', 'mmol/L')]));
  assert.match(output, /LDL ↑ 0,77 g\/L/); assert.match(output, /HDL ↑ 0,39 g\/L/); assert.match(output, /non-HDL ↑ 0,97 g\/L/);
});
test('répare les omissions et valeurs inventées de CRP/TSH à partir de la source', () => {
  const source = report([row('CRP', '3,2', 'mg/L', 'NORMAL'), row('TSHus', '0,117', 'mUI/L', 'BAS')]);
  assert.equal(api.enrichTitle('Bilan RAS', source), 'CRP N 3,2 mg/L, TSH ↓ 0,117 mUI/L');
  assert.equal(api.enrichTitle('CRP 999 et TSH 99', source), 'CRP N 3,2 mg/L, TSH ↓ 0,117 mUI/L');
});
test('CRP/TSH brutes : norme explicite ou statut inconnu, sans toucher aux autres résultats', () => {
  assert.match(api.enrichTitle('LDL 1,2 g/L, CRP 99', 'CRP : 3,2 mg/L\nTSH : 2 mUI/L'), /LDL 1,2 g\/L, CRP \? 3,2 mg\/L, TSH \? 2 mUI\/L/);
});
test('n’invente pas de marqueur absent et ne transforme pas une réponse vide en RAS', () => {
  const source = report([row('CRP', '2', 'mg/L', 'NORMAL')]);
  assert.equal(api.enrichTitle('', source), '');
  assert.equal(api.enrichTitle('CRP 2 mg/L, INR 1,1, BNP 45', source), 'CRP N 2 mg/L');
});
test('déduplique les décimales françaises et conserve le préfixe IMPORTANT', () => {
  const source = report([row('HbA1c', '9,5', '%'), row('CRP', '2,3', 'mg/L', 'NORMAL')]);
  const output = api.enrichTitle('IMPORTANT : HG 9,5 %, CRP 2,3, CRP 2,3', source);
  assert.equal(output, 'IMPORTANT : HbA1c ↑ 9,5 %, CRP N 2,3 mg/L');
});
test('ne mélange pas BNP et NT-proBNP, et conserve le DFG normal CKD-EPI', () => {
  const source = report([row('BNP', '50', 'pg/mL', 'NORMAL'), row('NT-proBNP', '200', 'pg/mL', 'NORMAL'),
    row('DFG MDRD', '88', 'mL/min/1,73m²', 'NORMAL'), row('DFG CKD-EPI', '97', 'mL/min/1,73m²', 'NORMAL')]);
  const output = api.enrichTitle('BNP 50', source);
  assert.match(output, /BNP N 50/); assert.match(output, /NT-proBNP N 200/); assert.match(output, /DFG N 97/);
  assert.equal((output.match(/\bDFG\b/g) || []).length, 1);
});
test('formule Soit : utilise le type immédiatement précédent et les valeurs absolues', () => {
  const source = report([row('Monocytes', '12', '%'), row('Soit', '0,8', 'G/L', 'NORMAL'),
    row('Eosinophiles', '8', '%'), row('Soit', '0,9', 'G/L')]);
  assert.equal(api.enrichTitle('Mono ↑ 12 %, Eos ↑ 8 %', source), 'Eos ↑ 0,9 G/L');
});
test('une ligne Soit anormale non rattachée bloque au lieu de deviner', () => {
  assert.throws(() => api.enrichTitle('Bilan RAS', report([row('Soit', '2', 'G/L')])), /non rattachée/);
});
test('les résultats discordants et les titres trop longs bloquent sans troncature', () => {
  assert.throws(() => api.enrichTitle('CRP 2', report([row('CRP', '2', 'mg/L'), row('CRP', '20', 'mg/L')])), /discordants/);
  assert.throws(() => api.enrichTitle('Commentaire ' + 'a'.repeat(345), report([row('CRP', '2', 'mg/L')])), /trop longue/);
});
test('enzymes : valeur source, unité et multiple de la norme', () => {
  assert.equal(api.enrichTitle('ALAT 2N', report([row('ALAT', '80', 'U/L', 'HAUT', '0', '40')])), 'ALAT ↑ 80 U/L [2N]');
});
test('sélectionne la dernière antériorité strictement précédente avec conversion', () => {
  const current = api.reportRows(report([row('LDL', '4', 'mmol/L')]));
  const entries = [
    {id: 'ldl', date: '28/10/2026', value: '3', unit: 'mmol/L'},
    {id: 'ldl', date: '29/10/2026', value: '2', unit: 'mmol/L'},
    {id: 'ldl', date: '30/10/2026', value: '1', unit: 'mmol/L'},
  ];
  assert.deepEqual(api.compareHistory(current, entries, '29/10/2026'), [{id:'ldl', date:'28/10/2026', display:'1,16 g/L'}]);
});
test('dates invalides, unités absentes/incompatibles et doublons discordants : pas d’antériorité', () => {
  const current = [row('CRP', '12', 'mg/L')];
  for (const date of ['', '31/02/2026', '29/10/26']) assert.deepEqual(api.compareHistory(current, [], date), []);
  for (const unit of ['', 'mg/dL', 'valeur inconnue']) {
    assert.deepEqual(api.compareHistory(current, [{id:'crp', date:'28/10/2026', value:'2', unit}], '29/10/2026'), []);
  }
  assert.deepEqual(api.compareHistory(current, [
    {id:'crp',date:'28/10/2026',value:'2',unit:'mg/L'}, {id:'crp',date:'28/10/2026',value:'3',unit:'mg/L'},
  ], '29/10/2026'), []);
});
test('ne compare ni BNP avec NT-proBNP ni CKD-EPI avec MDRD', () => {
  assert.deepEqual(api.compareHistory([row('NT-proBNP','500','pg/mL')], [{id:'bnp',date:'28/10/2026',value:'100',unit:'pg/mL'}], '29/10/2026'), []);
  assert.deepEqual(api.compareHistory([row('DFG CKD-EPI','40','mL/min')], [{id:'dfg',kind:'mdrd',date:'28/10/2026',value:'60',unit:'mL/min'}], '29/10/2026'), []);
});
test('antériorités ajoutées une seule fois, sans perte du calcul en N', () => {
  const source = report([row('CRP','12','mg/L')]);
  const previous = [{id:'crp',date:'28/10/2026',display:'2 mg/L'}];
  const once = api.enrichTitle('CRP 12',source,previous);
  assert.equal(api.enrichTitle(once,source,previous),once);
});
test('parser historique : dates collées, ligne inconnue et absence d’unité', () => {
  const grid = {querySelectorAll: () => [
    {cells:[{textContent:'Hb : 10'},{textContent:'01/10/2026 : 11g/dL02/10/2026 :12g/dL'}]},
    {cells:[{textContent:'Inconnu'},{textContent:'03/10/2026 :4g/dL'}]},
  ]};
  assert.equal(api.historyEntries(grid).length,2);
  assert.deepEqual(api.historyEntries(grid).map(entry => entry.value),['11','12']);
});
test('modèle de carte : décimales, catégories, antériorités, conclusion narrative entière', () => {
  const model=api.summaryModel('LDL ↑ 1,62 g/L [1,34 g/L le 12/02/2025], CRP N 3,2 mg/L');
  assert.equal(model.groups.length,2); assert.equal(model.groups[0].items[0].history.length,1);
  assert.equal(api.summaryModel('Anapath : métaplasie, sans dysplasie').groups[0].items.length,1);
});
test('variation seulement avec valeurs exactes et unités identiques, sans avis clinique', () => {
  assert.equal(api.historyDelta('CRP ↑ 12 mg/L','2 mg/L le 12/02/2025'),'Variation : +10 mg/L');
  assert.equal(api.historyDelta('CRP ↑ <12 mg/L','2 mg/L le 12/02/2025'),'');
  assert.equal(api.historyDelta('CRP ↑ 12 mg/L','2 mg/dL le 12/02/2025'),'');
});
test('anapath : garde la conclusion explicite EBO et ses négations', () => {
  const source='Anatomopathologie\nConclusion : Absence de métaplasie et absence d’EBO.\nSignature : Laboratoire fictif';
  assert.equal(api.protectAnapath('Anapath : absence de métaplasie',source), 'Anapath : Absence de métaplasie et absence d’EBO.');
  assert.equal(api.protectAnapath('Bilan RAS','Indication : recherche EBO'), 'Bilan RAS');
});
test('le contexte source reste local et son empreinte est exigée', () => {
  const values=new Map();
  const local=createWedaBiologyEnhancements({getValue:(key,fallback)=>values.get(key)||fallback,setValue:(key,value)=>values.set(key,value),sourceKey:()=> 'local/tab-A'});
  local.setSource('job-A','content-A',report([row('CRP','2','mg/L','NORMAL')]),[]);
  assert.throws(()=>local.prepareResultTitle('CRP 2',{jobId:'job-B',contentKey:'content-A'}),/non confirmée/);
  assert.throws(()=>local.prepareResultTitle('CRP 2',{jobId:'job-A',contentKey:'content-B'}),/non confirmée/);
  assert.equal(local.prepareResultTitle('CRP 2',{jobId:'job-A',contentKey:'content-A'}),'CRP N 2 mg/L');
});
test('module embarqué et supplément de prompt synchronisés', () => {
  execFileSync(process.execPath,['scripts/sync-biologie.cjs'],{cwd:root});
  assert.equal(api.promptRules(),fs.readFileSync(path.join(root,'prompts/analyse-biologies-regles-partagees.prompt.txt'),'utf8').trim());
});

function functionSource(source,name) {
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);
  assert.ok(match,name);const end=source.indexOf('\n  }',match.index)+4;
  return source.slice(match.index,end);
}
const lm=fs.readFileSync(path.join(root,'scripts/LM studio/analyse-biologies-weda-LMstudio.user.js'),'utf8').replace(/\r\n/g,'\n');
test('LM Studio : arrêt annule réellement le transport et ignore la réponse tardive', async () => {
  let request,aborts=0;
  const local=vm.runInNewContext('let activeBiologyRequest=null; const LMSTUDIO_REQUEST_TIMEOUT_MS=5000;\n'+
    functionSource(lm,'gmJsonRequest')+'\n'+functionSource(lm,'abortBiologyRequest')+'\n({gmJsonRequest,abortBiologyRequest})',
    {GM_xmlhttpRequest:options=>{request=options;return {abort:()=>{aborts++;options.onabort();}};}});
  const pending=local.gmJsonRequest({url:'http://localhost:1234/v1/chat/completions'});
  const rejected=assert.rejects(pending,/annulé/);
  local.abortBiologyRequest(); request.onload({status:200,responseText:'{"content":"late"}'});
  await rejected;assert.equal(aborts,1);
});
test('les deux scripts conservent les gardes d’affectation et de saisie manuelle', () => {
  for(const name of ['LM studio/analyse-biologies-weda-LMstudio.user.js','Heidi/analyse-biologies-weda-heidi.user.js']) {
    const source=fs.readFileSync(path.join(root,'scripts',name),'utf8');
    for(const fn of ['validateHeidiResultAgainstWaitingState','assertTitleAssignmentTarget','shouldPreserveManualTitleEdit']) assert.match(source,new RegExp('function '+fn+'\\('));
    const job=source.slice(source.indexOf('const job = {'),source.indexOf('GM_deleteValue(RESULT_KEY)',source.indexOf('const job = {')));
    assert.doesNotMatch(job,/patientId|displayTitles|historyComparisons/);
    assert.match(source,/const STATE_KEY_BASE/);
  }
  assert.match(lm,/LMSTUDIO_MAX_TOKENS = 8192/);
  assert.match(functionSource(lm,'triggerWedaTitleSave'),/__doPostBack-single/);
  assert.doesNotMatch(functionSource(lm,'triggerWedaTitleSave'),/KeyboardEvent/);
});
