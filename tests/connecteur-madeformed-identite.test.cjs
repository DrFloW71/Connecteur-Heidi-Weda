'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const full=fs.readFileSync(process.env.MF_NATIVE_TEST_FRAGMENT||path.join(__dirname,'..','scripts','Connecteur-madeformed-vers-weda.user..js'),'utf8');
const begin=full.indexOf('/* BEGIN MFM_NATIVE_TOOLS_V214 */');
const end=full.indexOf('/* END MFM_NATIVE_TOOLS_V214 */',begin);
assert.ok(begin>=0&&end>begin);
const source=full.slice(begin,end);

class FixtureNode {
 constructor(tag='div',attrs={},text='') {
  this.tagName=tag.toUpperCase();this.attrs={...attrs};this.textContent=text;this.children=[];this.isConnected=true;
  this.selectors=new Map();this.listeners=new Map();this.dataset={};this.className=attrs.class||'';
  const style=new Map();this.style={setProperty:(key,value)=>style.set(key,value),getPropertyValue:key=>style.get(key)||'',removeProperty:key=>style.delete(key)};
  this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');}};
 }
 getAttribute(name){return name==='class'?this.className:(this.attrs[name]??null);}
 setAttribute(name,value){this.attrs[name]=String(value);}
 querySelector(selector){return this.selectors.get(selector)||null;}
 querySelectorAll(selector){return this.selectors.get(selector)||[];}
 matches(selector){if(selector==='tr.user-message[data-id]')return this.tagName==='TR'&&this.attrs['data-id']!==undefined;if(selector==='#agenda .rdv[data-user-id]')return false;if(selector==='a.search')return this.tagName==='A'&&this.classList.contains('search');if(selector===':hover')return Boolean(this.hovered);return false;}
 closest(selector){return this.parentActions&&selector==='.tm-mf-native-actions'?this.parentActions:null;}
 getBoundingClientRect(){return {width:200,height:50,bottom:150,top:100,right:250,left:50};}
 append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
 remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
 addEventListener(name,callback){this.listeners.set(name,callback);}
}
function caller(id='9001',phone='0102030405',name='PATIENT DEMO',uid='') {
 const row=new FixtureNode('tr',{'data-id':id,'data-user_id':uid,'data-name':name,'data-phone':phone});
 row.selectors.set('.action a.search[href]',new FixtureNode('a',{href:uid?'/agenda?target=user-detail&uid='+uid:'/agenda?target=user-search&field=tel&value='+phone}));
 row.selectors.set('.content .msg-canal[data-canal="svi"]',new FixtureNode('span',{'data-canal':'svi'}));
 const cell=new FixtureNode('td');cell.selectors.set('.date',new FixtureNode('span',{},'08/10/2026'));cell.selectors.set('.hour',new FixtureNode('span',{},'14:03'));
 row.cells=[new FixtureNode('td'),new FixtureNode('td'),cell];return row;
}
function candidate(uid='101',name='PATIENT DEMO',phone='0102030405') {
 const row=new FixtureNode('div',{'data-user-id':uid,'data-user-name':name});
 row.selectors.set('.identite-contacts [title], .identite-contacts [data-original-title], a[data-tel], a[href^="tel:"]',[new FixtureNode('a',{'data-tel':phone})]);return row;
}
function searchDocument(rows=[candidate()],context='42|Cabinet fictif') {
 const result=new FixtureNode('div',{},'Résultats fictifs');result.selectors.set('.user.preview[data-user-id]',rows);
 const doc={context,querySelector:()=>null,querySelectorAll:selector=>selector==='.user-search.active #users-result'?[result]:selector==='#users-result .user.preview[data-user-id]'?rows:[]};return doc;
}
function harness(options={}) {
 const clock={now:Date.parse('2026-10-08T12:00:00Z')};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
 const storage=options.storage||new Map();const logs=[];const frames=[];const timers=new Map();let timerId=0;let scans=0;
 const document={context:'42|Cabinet fictif',hidden:false,body:new FixtureNode('body'),createElement:tag=>{const node=new FixtureNode(tag);if(tag==='iframe')frames.push(node);return node;},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
 const documents=new Map();const requests=[];
 const sandbox={document,location:{origin:'https://pro.madeformed.com'},window:{innerHeight:900,innerWidth:1280},Date:FixedDate,Intl,URL,TextEncoder,Uint8Array,crypto:webcrypto,AbortController,
  isMadeformed:()=>true,secretariatContextOf:doc=>doc?.context||null,mfmGroupCallsEnabled:()=>true,mfmGroupCallsQueue:()=>{scans++;},addLog:(level,label,data)=>logs.push({level,label,data}),
  GM_getValue:(key,fallback)=>storage.has(key)?storage.get(key):fallback,GM_setValue:(key,value)=>{if(options.storageBlocked)throw Error('Stockage indisponible');storage.set(key,value);},GM_deleteValue:key=>storage.delete(key),
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});if(delay===800)queueMicrotask(()=>{if(timers.has(id)){clock.now+=800;timers.delete(id);callback();}});return id;},clearTimeout:id=>timers.delete(id),
  setInterval:callback=>{const id=++timerId;timers.set(id,{callback});return id;},clearInterval:id=>timers.delete(id),
  getComputedStyle:node=>({backgroundColor:node.backgroundColor||'rgb(1, 2, 3)',color:node.color||'rgb(4, 5, 6)'}),
  DOMParser:class{parseFromString(text){assert.equal(documents.has(text),true,'HTML fictif connu');return documents.get(text);}},
  fetch:async(url,settings)=>{requests.push({url,settings});const response=options.fetchResponses?.shift();if(!response)throw Error('Aucune réponse fictive');return response;}
 };
 const expose=`\nglobalThis.api={
  states:mfmNativeStates,elements:mfmNativeElements,cache:mfmNativeCache,queue:mfmNativeQueue,storageKey:MFM_GROUP_MEMORY_KEY,memoryTTL:MFM_GROUP_MEMORY_TTL,
  jobs:mfmNativeIdentityJobs,active:mfmNativeIdentityActive,quickRead:mfmNativeIdentityQuickRead,
  identityQueue:mfmNativeIdentityQueue,identityPump:mfmNativeIdentityPump,identityReset:mfmNativeIdentityReset,identityScan:mfmNativeIdentityScan,
  memoryBinding:mfmNativeGroupBinding,memoryRemember:mfmNativeGroupMemoryRemember,memoryRestore:mfmNativeGroupMemoryRestore,memoryRead:mfmNativeGroupMemoryRead,memoryClear:mfmNativeClearGroupMemory,
  groupPatientId:mfmNativeGroupPatientId,patientId:mfmNativePatientId,loadProfile:mfmNativeLoadProfile,priority:mfmNativePriorityCallIndex,
  match:mfmNativeMatchCandidate,snapshot:mfmNativeSearchSnapshot,palette:mfmNativeSyncPalette,
  state(element){const state={element,info:mfmNativeSource(element),resolvedUid:'',badge:document.createElement('button'),actions:document.createElement('span'),pending:false};mfmNativeStates.set(element,state);mfmNativeElements.add(element);return state;},
  install(){mfmNativeInstalled=true;},
  hooks(hooks){if(hooks.search)mfmNativeSearchResult=hooks.search;if(hooks.quick)mfmNativeIdentityQuickRead=hooks.quick;if(hooks.wait)mfmNativeWait=hooks.wait;if(hooks.queue)mfmNativeRunQueue=hooks.queue;},
  enqueue:mfmNativeEnqueue
 };`;
 vm.runInNewContext(source+expose,sandbox);
 return {api:sandbox.api,document,clock,storage,logs,frames,timers,documents,requests,sandbox,get scans(){return scans;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function response(text='first',settings={}){return {ok:true,redirected:false,url:'https://pro.madeformed.com/agenda?target=user-search&field=tel&value=0102030405',headers:{get:()=> 'text/html'},text:async()=>text,...settings};}

test('mémoire persistante: UID, SHA256 et date uniquement, durée de 7 jours et 300 entrées',async()=>{
 const f=harness();const state=f.api.state(caller());state.resolvedUid='101';
 await f.api.memoryRemember(state,'101');
 const record=f.storage.get(f.api.storageKey);
 assert.equal(record.entries.length,1);assert.match(record.entries[0].digest,/^[a-f0-9]{64}$/);
 assert.equal(record.entries[0].uid,'101');assert.deepEqual(Object.keys(record.entries[0]).sort(),['digest','uid','verifiedAt']);
 assert.doesNotMatch(JSON.stringify(record),/PATIENT|0102030405|9001|Cabinet/);
 assert.equal(f.api.memoryTTL,7*24*60*60*1000);
 const entries=Array.from({length:320},(_,index)=>({digest:index.toString(16).padStart(64,'0'),uid:String(index+1),verifiedAt:f.clock.now-index}));
 f.storage.set(f.api.storageKey,{version:1,origin:'https://pro.madeformed.com',entries});
 assert.equal(f.api.memoryRead().length,300);
});

test('restauration exclusivement visuelle: actions Documents/RDV ne reçoivent aucun UID résolu',async()=>{
 const storage=new Map();let f=harness({storage});const first=f.api.state(caller());first.resolvedUid='101';await f.api.memoryRemember(first,'101');
 f=harness({storage});const next=f.api.state(caller());await f.api.memoryRestore(next);
 assert.equal(f.api.groupPatientId(next.element),'101');assert.equal(f.api.patientId(next.element),'');assert.equal(next.resolvedUid,'');
 assert.equal(f.api.cache.size,0);
});

test('mémoire invalide après changement message, date, médecin, identité native ou expiration',async()=>{
 const storage=new Map();const f=harness({storage});const state=f.api.state(caller());state.resolvedUid='101';await f.api.memoryRemember(state,'101');
 for(const kind of ['id','date','context','uid','expired']){
  const g=harness({storage});const row=caller();if(kind==='id')row.setAttribute('data-id','9002');if(kind==='date')row.cells[2].querySelector('.date').textContent='09/10/2026';if(kind==='context')g.document.context='43|Autre cabinet';if(kind==='uid')row.setAttribute('data-user_id','202');if(kind==='expired')g.clock.now+=g.api.memoryTTL;
  const current=g.api.state(row);await g.api.memoryRestore(current);assert.equal(g.api.groupPatientId(row),'',kind);
 }
});

test('vider la mémoire invalide également les restaurations SHA256 en cours',async()=>{
 const f=harness();const state=f.api.state(caller());state.resolvedUid='101';await f.api.memoryRemember(state,'101');state.resolvedUid='';
 const pending=f.api.memoryRestore(state);f.api.memoryClear();await pending;
 assert.equal(f.storage.has(f.api.storageKey),false);assert.equal(f.api.groupPatientId(state.element),'');
});

test('stockage bloqué ne bloque pas une identité native certifiée',async()=>{
 const f=harness({storageBlocked:true});const state=f.api.state(caller('1','0102030405','PATIENT DEMO','101'));
 await f.api.memoryRemember(state,'101');assert.equal(f.api.patientId(state.element),'101');assert.equal(f.api.memoryRead().length,0);
});

test('deux lecteurs indépendants : démarrent deux recherches, puis lancent la troisième',async()=>{
 const f=harness();f.api.install();const reads=[];
 f.api.hooks({search:(_frame,info)=>new Promise(resolve=>reads.push({info,resolve})),quick:async()=>null});
 const states=[f.api.state(caller('1','0102030405')),f.api.state(caller('2','0102030406')),f.api.state(caller('3','0102030407'))];
 states.forEach(state=>f.api.identityQueue([state]));f.api.identityPump();assert.equal(f.api.active.size,2);assert.equal(reads.length,2);
 reads[0].resolve({uid:'101'});await settle();assert.equal(f.api.patientId(states[0].element),'101');assert.equal(reads.length,3);assert.equal(f.api.active.size,2);
 reads[1].resolve({uid:'102'});reads[2].resolve({uid:'103'});await settle();assert.equal(f.api.active.size,0);
 assert.equal(f.api.patientId(states[1].element),'102');assert.equal(f.api.patientId(states[2].element),'103');
 assert.equal(f.frames.every(frame=>!frame.isConnected),true);
});

test('réutilise la même recherche pour deux appels et un rerender dans le cache de 60 s',async()=>{
 const f=harness();f.api.install();let count=0;let finish;
 f.api.hooks({search:()=>{count++;return new Promise(resolve=>{finish=resolve;});},quick:async()=>null});
 const first=f.api.state(caller('1'));const second=f.api.state(caller('2'));f.api.identityQueue([first,second]);f.api.identityPump();assert.equal(count,1);
 finish({uid:'101'});await settle();assert.equal(f.api.patientId(first.element),'101');assert.equal(f.api.patientId(second.element),'101');
 const replacement=f.api.state(caller('1'));f.api.identityQueue([replacement]);assert.equal(f.api.patientId(replacement.element),'101');assert.equal(count,1);
});

test('une annulation ou changement de contexte empêche de publier un résultat retardataire',async()=>{
 const f=harness();f.api.install();let finish;
 f.api.hooks({search:()=>new Promise(resolve=>{finish=resolve;}),quick:async()=>null});
 const state=f.api.state(caller());f.api.identityQueue([state]);f.api.identityPump();f.api.identityReset('context-changed');
 finish({uid:'101'});await settle();assert.equal(f.api.patientId(state.element),'');assert.equal(f.api.active.size,0);assert.equal(f.api.jobs.size,0);
});

test('un résultat ambigu exige de choisir le patient, sans mémoriser une identité',async()=>{
 const f=harness();f.api.install();f.api.hooks({search:async()=>({uid:''}),quick:async()=>null});const state=f.api.state(caller());f.api.identityQueue([state]);f.api.identityPump();await settle();
 assert.equal(f.api.patientId(state.element),'');assert.equal(f.api.groupPatientId(state.element),'');assert.equal(f.api.memoryRead().length,0);
});

test('publie une identité certifiée avant attente de la fiche et de tout historique',async()=>{
 const f=harness();const state=f.api.state(caller());let finish;
 f.api.hooks({search:async()=>({uid:'101'}),wait:()=>new Promise(resolve=>{finish=resolve;})});
 const frame=new FixtureNode('iframe');const load=f.api.loadProfile(frame,state,()=>true);await settle();
 assert.equal(f.api.patientId(state.element),'101');assert.equal(frame.src,'https://pro.madeformed.com/agenda?target=user-detail&uid=101');assert.equal(f.api.cache.size,0);
 finish({});assert.equal(await load,'101');
});

test('un clic réutilise la recherche déjà en cours et vérifie ensuite la fiche native',async()=>{
 const f=harness();f.api.install();let finish;let searches=0;let waitCount=0;
 f.api.hooks({search:()=>{searches++;return new Promise(resolve=>{finish=resolve;});},quick:async()=>null,wait:async()=>{waitCount++;return {};}});
 const state=f.api.state(caller());f.api.identityQueue([state]);f.api.identityPump();const frame=new FixtureNode('iframe');const load=f.api.loadProfile(frame,state,()=>true);
 assert.equal(searches,1);finish({uid:'101'});assert.equal(await load,'101');assert.equal(searches,1);assert.equal(waitCount,1);
});

test('GET natif: deux lectures stables, contrôles contexte/URL/type, pas de POST',async()=>{
 const f=harness({fetchResponses:[response('first'),response('second')]});const doc=searchDocument();f.documents.set('first',doc);f.documents.set('second',doc);
 const state=f.api.state(caller());const job={info:state.info,context:state.info.context,queuedAt:f.clock.now,sequence:1,epoch:0};
 const result=await f.api.quickRead(job,()=>true);assert.equal(result.uid,'101');assert.equal(f.requests.length,2);
 for(const req of f.requests){assert.equal(req.settings.method,'GET');assert.equal(req.settings.credentials,'same-origin');assert.equal(req.settings.redirect,'error');}
});

test('GET incomplet ou instable revient à l’iframe, sans choisir un résultat douteux',async()=>{
 for(const kind of ['changed','external','redirect','type','context','ambiguous']){
  const bad=kind==='external'?{url:'https://invalid.example/agenda'}:kind==='redirect'?{redirected:true}:kind==='type'?{headers:{get:()=> 'application/json'}}:{};
  const f=harness({fetchResponses:[response('first',bad),response('second')]});
  f.documents.set('first',searchDocument(kind==='ambiguous'?[candidate('101'),candidate('102')]:[candidate()],kind==='context'?'43|Autre cabinet':'42|Cabinet fictif'));
  f.documents.set('second',searchDocument([candidate(kind==='changed'?'202':'101')]));
  const state=f.api.state(caller());const result=await f.api.quickRead({info:state.info,context:state.info.context,queuedAt:f.clock.now},()=>true);assert.equal(result,null,kind);
 }
});

test('HTML rapide indisponible laisse réussir le lecteur iframe',async()=>{
 const f=harness();f.api.install();const state=f.api.state(caller());
 f.api.hooks({search:async()=>({uid:'101'})});f.api.identityQueue([state]);f.api.identityPump();await settle();
 assert.equal(f.api.patientId(state.element),'101');assert.equal(f.api.active.size,0);
});

test('priorité des paires SVI devant FIFO sans choisir une ligne Web ou un autre patient',()=>{
 const f=harness();const first=f.api.state(caller('1','0102030406','AUTRE DEMO'));const second=f.api.state(caller('2'));const third=f.api.state(caller('3'));second.element.nextElementSibling=third.element;
 f.api.queue.push(first,second,third);assert.equal(f.api.priority(),1);
 third.element.selectors.delete('.content .msg-canal[data-canal="svi"]');assert.equal(f.api.priority(),-1);
});

test('palette: reprend le bouton natif non survolé et ignore ses propres boutons',()=>{
 const f=harness();const state=f.api.state(caller());const native=new FixtureNode('a',{class:'search ds-btn'});native.backgroundColor='rgb(11, 22, 33)';native.color='rgb(44, 55, 66)';
 const custom=new FixtureNode('button',{class:'ds-btn tm-mf-native-action'});custom.parentActions=state.actions;
 state.element.selectors.set('.action .ds-btn',[custom,native]);f.api.palette(state);
 assert.equal(state.actions.style.getPropertyValue('--tm-mf-native-bg'),'rgb(11, 22, 33)');assert.equal(state.actions.style.getPropertyValue('--tm-mf-native-color'),'rgb(44, 55, 66)');
 native.hovered=true;f.api.palette(state);assert.equal(state.actions.style.getPropertyValue('--tm-mf-native-bg'),'');
});

test('le cache d’identité expire à 60 s et une nouvelle recherche peut reprendre', async () => {
 const f=harness();f.api.install();let searches=0;
 f.api.hooks({search:async()=>{searches++;return {uid:'101'};},quick:async()=>null});
 const first=f.api.state(caller('1'));f.api.identityQueue([first]);f.api.identityPump();await settle();
 f.clock.now+=60000;
 const next=f.api.state(caller('2'));f.api.identityQueue([next]);f.api.identityPump();await settle();
 assert.equal(searches,2);assert.equal(f.api.patientId(next.element),'101');
});

test('masquer l’onglet ou remplacer le message interdit de publier une identité tardive', async () => {
 for(const kind of ['hidden','replaced']) {
  const f=harness();f.api.install();let finish;
  f.api.hooks({search:()=>new Promise(resolve=>{finish=resolve;}),quick:async()=>null});
  const state=f.api.state(caller());f.api.identityQueue([state]);f.api.identityPump();
  if(kind==='hidden')f.document.hidden=true;
  else state.element.setAttribute('data-name','AUTRE DEMO');
  finish({uid:'101'});await settle();assert.equal(f.api.patientId(state.element),'');assert.equal(f.api.active.size,0);
 }
});

test('vider la mémoire annule les lecteurs déjà lancés et empêche leur publication retardataire', async () => {
 const f=harness();f.api.install();let finish;
 f.api.hooks({search:()=>new Promise(resolve=>{finish=resolve;}),quick:async()=>null});
 const state=f.api.state(caller());f.api.identityQueue([state]);f.api.identityPump();
 f.api.memoryClear();finish({uid:'101'});await settle();
 assert.equal(f.api.patientId(state.element),'');assert.equal(f.api.active.size,0);assert.equal(f.api.jobs.size,0);
});

test('un lecteur de fiche commencé avant Reset peut vérifier la fiche sans recréer sa mémoire visuelle', async () => {
 const f=harness();const state=f.api.state(caller());let finish;
 f.api.hooks({search:()=>new Promise(resolve=>{finish=resolve;}),wait:async()=>({})});
 const load=f.api.loadProfile(new FixtureNode('iframe'),state,()=>true);
 f.api.memoryClear();finish({uid:'101'});assert.equal(await load,'101');await settle();
 assert.equal(f.api.patientId(state.element),'101');assert.equal(f.api.memoryRead().length,0);
});

test('mémoire : refuse dates futures excessives, entrées expirées, UID invalides et doublons anciens', () => {
 const f=harness();const digest='a'.repeat(64);
 const entries=[
  {digest,uid:'101',verifiedAt:f.clock.now-1000},
  {digest,uid:'102',verifiedAt:f.clock.now},
  {digest:'b'.repeat(64),uid:'103',verifiedAt:f.clock.now+5001},
  {digest:'c'.repeat(64),uid:'104',verifiedAt:f.clock.now-f.api.memoryTTL},
  {digest:'d'.repeat(64),uid:'0',verifiedAt:f.clock.now},
  {digest:'not-a-digest',uid:'105',verifiedAt:f.clock.now}
 ];
 f.storage.set(f.api.storageKey,{version:1,origin:'https://pro.madeformed.com',entries});
 const records=f.api.memoryRead();assert.equal(records.length,1);assert.equal(records[0].uid,'102');
 f.storage.set(f.api.storageKey,{version:1,origin:'https://invalid.example',entries});assert.equal(f.api.memoryRead().length,0);
});

test('GET natif ne publie rien si la signature devient invalide pendant les lectures', async () => {
 const f=harness({fetchResponses:[response('first'),response('second')]});
 f.documents.set('first',searchDocument());f.documents.set('second',searchDocument());
 const state=f.api.state(caller());let checks=0;
 const result=await f.api.quickRead({info:state.info,context:state.info.context,queuedAt:f.clock.now},()=>++checks<3);
 assert.equal(result,null);assert.equal(f.requests.length,1);
});
