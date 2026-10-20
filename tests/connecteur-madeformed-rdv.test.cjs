'use strict';

// Fixtures synthétiques : aucun dossier, numéro, nom ou identifiant patient réel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');

const principal = path.join(__dirname, '..', 'scripts', 'Connecteur-madeformed-vers-weda.user..js');
const inputPath = process.env.MF_NATIVE_TEST_FRAGMENT || principal;
const fullSource = fs.readFileSync(inputPath, 'utf8');
const begin = fullSource.indexOf('/* BEGIN MFM_NATIVE_TOOLS_V214 */');
const end = fullSource.indexOf('/* END MFM_NATIVE_TOOLS_V214 */', begin);
assert.ok(begin >= 0 && end > begin, 'Le module natif doit être intégré au connecteur.');
const source = fullSource.slice(begin, end);
const defaultNow = Date.parse('2026-10-07T12:00:00Z');

class NodeFixture {
    constructor(tag = 'div', attrs = {}, text = '') {
        this.tagName = tag.toUpperCase();
        this.attrs = {...attrs};
        this.textContent = text;
        this.className = '';
        this.hidden = false;
        this.isConnected = true;
        this.children = [];
        this.selectors = new Map();
        this.listeners = new Map();
        this.style = {cssText:'', setProperty() {}};
        this.dataset = {};
        this.clicked = 0;
        this.focused = 0;
        this.classList = {
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(x => !names.includes(x)).join(' '); },
            contains: name => this.className.split(/\s+/).includes(name)
        };
    }
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    querySelector(selector) { return this.selectors.get(selector) || null; }
    querySelectorAll(selector) { return this.selectors.get(selector) || []; }
    matches(selector) {
        if (selector === 'tr.user-message[data-id]') return this.tagName === 'TR' && this.attrs['data-id'] !== undefined;
        if (selector === '#agenda .rdv[data-user-id]') return this.tagName === 'DIV' && this.attrs['data-user-id'] !== undefined;
        return selector.split(',').some(x => x.startsWith('.') && this.classList.contains(x.slice(1)));
    }
    closest(selector) { return this.groupHidden && selector === '.tm-mf-call-group-hidden' ? this : null; }
    getBoundingClientRect() { return {width:200,height:50,bottom:150,top:100,right:250,left:50}; }
    append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') node.parentNode = this; this.children.push(node); } }
    prepend(...nodes) { for (const node of nodes) if (node && typeof node === 'object') node.parentNode = this; this.children.unshift(...nodes); }
    insertBefore(node) { this.append(node); }
    replaceChildren(...nodes) { this.children = []; this.textContent = ''; this.append(...nodes); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    focus() { this.focused++; }
    click() { this.clicked++; }
    remove() {
        this.isConnected = false;
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this);
    }
    cloneNode() { return new NodeFixture(this.tagName, this.attrs, this.textContent); }
    get firstElementChild() { return this.children.find(x => x && typeof x === 'object') || null; }
}

function message(attrs = {}, link = '/agenda?target=user-detail&uid=101') {
    const row = new NodeFixture('tr', {
        'data-id':'9001', 'data-user_id':'101', 'data-name':'PATIENT DEMO', 'data-phone':'0102030405', ...attrs
    });
    if (link) row.selectors.set('.action a.search[href]', new NodeFixture('a', {href:link}));
    return row;
}

function agenda(attrs = {}) {
    const row = new NodeFixture('div', {'data-id':'8001','data-user-id':'101', ...attrs});
    row.selectors.set('.user-infos .nom', new NodeFixture('span', {}, 'PATIENT DEMO'));
    return row;
}

function candidate(uid, name = 'PATIENT DEMO', phone = '0102030405') {
    const row = new NodeFixture('div', {'data-user-id':uid,'data-user-name':name});
    row.selectors.set('.identite-contacts [title], .identite-contacts [data-original-title], a[data-tel], a[href^="tel:"]', [
        new NodeFixture('a', {'data-tel':phone})
    ]);
    return row;
}

function historyDocument(rows, uid = '101', loading = false, futurePresent = true) {
    const profile = new NodeFixture('div', {'data-user-id':uid});
    const future = new NodeFixture();
    future.selectors.set('.rdv.preview[data-rdv-id][data-debut]', rows);
    profile.selectors.set('#user-history .history-group.futur', futurePresent ? future : null);
    profile.selectors.set('#user-history.loading, #user-history .loading, #user-history .error, #user-history[aria-busy="true"], #user-history [aria-busy="true"]', loading ? new NodeFixture() : null);
    return {querySelector: selector => selector === '.user-detail.active[data-user-id]' ? profile : null};
}

function historyRow(id, date, attrs = {}) {
    const row = new NodeFixture('div', {'data-rdv-id':id,'data-debut':date, ...attrs});
    row.selectors.set('.planning .effecteur', new NodeFixture('span', {}, 'Praticien Démo'));
    row.selectors.set('.planning .acte', new NodeFixture('span', {}, 'Consultation'));
    return row;
}

function harness(now = defaultNow) {
    const clock = {now};
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    }
    const document = {
        context:'demo-pro|Cabinet Démo', hidden:false, body:new NodeFixture('body'), head:new NodeFixture('head'),
        createElement: tag => new NodeFixture(tag),
        createTextNode: text => ({textContent:String(text)}),
        getElementById: () => null, querySelector: () => null
    };
    const intervals = new Map();
    let timerId = 0;
    const sandbox = {
        document, Date:FixedDate, Intl, URL,
        location:{origin:'https://pro.madeformed.com'},
        window:{innerHeight:900,innerWidth:1280},
        isMadeformed: () => true,
        secretariatContextOf: doc => doc?.context || null,
        addLog() {}, mfmGroupCallsQueue() {},
        setInterval: fn => { const id = ++timerId; intervals.set(id,fn); return id; },
        clearInterval: id => intervals.delete(id),
        setTimeout: fn => { const id = ++timerId; intervals.set(id,fn); return id; },
        clearTimeout: id => intervals.delete(id)
    };
    const expose = String.raw`
globalThis.api = {
    ttl:MFM_NATIVE_TTL, timeZone:MFM_NATIVE_TIME_ZONE, cache:mfmNativeCache, queue:mfmNativeQueue,
    date:mfmNativeDate, parisParts:mfmNativeParisParts, safeLink:mfmNativeSafeLink,
    phone:mfmNativePhone, name:mfmNativeName, source:mfmNativeSource,
    match:mfmNativeMatchCandidate, patientId:mfmNativePatientId, key:mfmNativeKey,
    read:mfmNativeReadAppointments, next:mfmNativeNextAppointment, paint:mfmNativePaint,
    remember:mfmNativeRemember, rememberIdentity:mfmNativeRememberIdentity,
    enqueue:mfmNativeEnqueue, open:mfmNativeOpen, keys:mfmNativeOverlayKeys,
    loadProfile:mfmNativeLoadProfile,
    state(element) {
        const info = mfmNativeSource(element);
        const state = {element,info,badge:document.createElement('button'),actions:document.createElement('span'),resolvedUid:'',pending:false};
        mfmNativeStates.set(element,state); mfmNativeElements.add(element);
        return state;
    },
    setOverlay(value) { mfmNativeOverlay = value; },
    getOverlay() { return mfmNativeOverlay; },
    configurePreparation(config) {
        mfmNativeLoadProfile = async frame => { frame.contentDocument = config.doc; return config.uid; };
        mfmNativeWait = async (frame,predicate,context,alive) => {
            if (!alive()) throw new Error('Opération interrompue');
            const result = predicate(frame.contentDocument);
            if (!result) throw new Error('Patient ou formulaire non confirmé');
            return result;
        };
    },
    configureProfileWait(doc) {
        mfmNativeWait = async (frame,predicate,context,alive) => {
            frame.contentDocument = doc;
            if (!alive()) throw new Error('Opération interrompue');
            const result = predicate(doc);
            if (!result) throw new Error('Fiche incorrecte');
            return result;
        };
    }
};`;
    vm.runInNewContext(source + expose, sandbox);
    return {api:sandbox.api, document, clock, intervals};
}

test('les dates civiles du cabinet sont interprétées en Europe/Paris en été et en hiver', () => {
    const {api} = harness();
    assert.equal(api.timeZone, 'Europe/Paris');
    assert.equal(api.date('2026-10-15 14:30'), Date.parse('2026-10-15T12:30:00Z'));
    assert.equal(api.date('2026-12-15T14:30:25'), Date.parse('2026-12-15T13:30:25Z'));
});

test('les dates impossibles et les dates avec fuseau non prévu sont refusées', () => {
    const {api} = harness();
    for (const text of ['2026-02-30 12:00','2026-01-01 24:00','2026-01-01 12:60','2026-01-01 12:00:60','2026-01-01T12:00Z','15/10/2026 14:30']) {
        assert.ok(Number.isNaN(api.date(text)), text);
    }
});

test('une heure inexistante ou répétée au changement d’heure ne peut pas être associée arbitrairement', () => {
    const {api} = harness();
    assert.ok(Number.isNaN(api.date('2026-03-29 02:30')));
    assert.ok(Number.isNaN(api.date('2026-10-25 02:30')));
    assert.equal(api.date('2026-03-29 03:30'), Date.parse('2026-03-29T01:30:00Z'));
    assert.equal(api.date('2026-10-25 03:30'), Date.parse('2026-10-25T02:30:00Z'));
});

test('le prochain RDV exclut le RDV courant, les RDV annulés et les RDV passés, puis trie les autres', () => {
    const {api} = harness();
    const items = [
        {id:'1',startAt:defaultNow - 1000},
        {id:'2',startAt:defaultNow + 1000,cancelled:true},
        {id:'8001',startAt:defaultNow + 2000},
        {id:'4',startAt:defaultNow + 8000},
        {id:'5',startAt:defaultNow + 5000},
        {id:'6',startAt:NaN}
    ];
    assert.equal(api.next(items, '8001', defaultNow).id, '5');
    assert.equal(api.next([], '', defaultNow), null);
});

test('l’historique confirme le patient et reconnaît les différents statuts d’annulation', () => {
    const {api} = harness();
    const rows = [
        historyRow('1','2026-10-15 14:30', {'data-status':' Annulée '}),
        historyRow('2','2026-10-16 14:30', {'data-cancelled':' true '}),
        historyRow('3','2026-10-17 14:30')
    ];
    const items = api.read(historyDocument(rows), '101');
    assert.deepEqual(Array.from(items, x => x.cancelled), [true,true,false]);
    assert.equal(api.next(items, '', defaultNow).id, '3');
    assert.equal(api.read(historyDocument(rows,'202'), '101'), null);
});

test('historique absent, en cours de chargement ou date invalide ne signifient pas aucun RDV', () => {
    const {api} = harness();
    assert.equal(api.read(historyDocument([], '101', true), '101'), null);
    assert.equal(api.read(historyDocument([], '101', false, false), '101'), null);
    assert.equal(api.read(historyDocument([historyRow('1','2026-02-30 12:00')]), '101'), null);
    assert.deepEqual(Array.from(api.read(historyDocument([]), '101')), []);
});

test('un identifiant natif direct relie le message au dossier attendu', () => {
    const {api} = harness();
    const info = api.source(message());
    assert.equal(info.uid, '101');
    assert.equal(info.conflict, false);
    assert.equal(info.href, 'https://pro.madeformed.com/agenda?target=user-detail&uid=101');
});

test('deux identifiants natifs contradictoires imposent choisir le patient', () => {
    const {api} = harness();
    const state = api.state(message({}, '/agenda?target=user-detail&uid=202'));
    assert.equal(state.info.uid, '');
    assert.equal(state.info.conflict, true);
    assert.equal(state.info.href, '');
    assert.equal(api.patientId(state.element), '');
    api.paint(state);
    assert.equal(state.badge.textContent, 'Prochain RDV : choisir le patient');
    api.enqueue(state);
    assert.equal(api.queue.length, 0);
});

test('un lien externe, un identifiant non numérique ou une route inconnue sont refusés', () => {
    const {api} = harness();
    for (const href of ['https://exemple.invalid/agenda?target=user-detail&uid=101',
        '/agenda?target=user-detail&uid=0','/agenda?target=user-detail&uid=abc',
        '/messages?target=user-detail&uid=101','javascript:alert(1)']) {
        assert.equal(api.safeLink(href), null, href);
    }
});

test('la recherche exige un candidat unique ayant le nom complet et le téléphone', () => {
    const {api} = harness();
    const info = {name:'Mme PATIENT DEMO',phone:'+33 1 02 03 04 05'};
    const doc = rows => ({querySelectorAll: selector => selector === '.user-search.active #users-result' ? [] : rows});
    assert.equal(api.match(doc([candidate('101')]), info), '101');
    assert.equal(api.match(doc([candidate('101'),candidate('202')]), info), '');
    assert.equal(api.match(doc([candidate('101','PATIENT DEMO','0102030499')]), info), '');
    assert.equal(api.match(doc([candidate('101','AUTRE DEMO')]), info), '');
    assert.equal(api.match(doc([candidate('101')]), {...info,name:'DEMO'}), '');
    assert.equal(api.match(doc([candidate('101')]), {...info,phone:''}), '');
});

test('une modification du message invalide l’identité résolue précédemment', () => {
    const {api} = harness();
    const row = message({'data-user_id':''}, '/agenda?target=user-search&field=tel&value=0102030405');
    const state = api.state(row);
    api.rememberIdentity(state, '101');
    assert.equal(api.patientId(row), '101');
    row.setAttribute('data-name','AUTRE DEMO');
    assert.equal(api.patientId(row), '');
});

test('le choix manuel du patient n’est pas partagé entre deux messages sans UID', () => {
    const {api} = harness();
    const search = '/agenda?target=user-search&field=tel&value=0102030405';
    const one = api.state(message({'data-user_id':'','data-id':'9001'}, search));
    const two = api.state(message({'data-user_id':'','data-id':'9002'}, search));
    api.remember(one, '101', []);
    assert.equal(api.patientId(one.element), '101');
    assert.equal(api.patientId(two.element), '');
    assert.notEqual(api.key(one.info), api.key(two.info));
});

test('le cache évite les lectures jusqu’à 60 secondes puis remet la lecture en file', () => {
    const {api,clock} = harness();
    const state = api.state(message());
    api.remember(state, '101', []);
    assert.equal(api.ttl, 60000);
    api.setOverlay({root:{hidden:false}});
    clock.now += 59999;
    api.enqueue(state);
    assert.equal(api.queue.length, 0);
    assert.equal(state.pending, false);
    clock.now++;
    api.enqueue(state);
    assert.equal(api.queue.length, 1);
    assert.equal(state.pending, true);
});

test('le cache est isolé par patient et par médecin/cabinet', () => {
    const {api,document} = harness();
    const one = api.state(message());
    api.remember(one, '101', []);
    assert.ok(api.cache.has(api.key(one.info)));
    const otherPatient = api.state(message({'data-user_id':'202'}, '/agenda?target=user-detail&uid=202'));
    assert.equal(api.cache.has(api.key(otherPatient.info)), false);
    document.context = 'autre-pro|Autre cabinet Démo';
    const otherContext = api.state(message());
    assert.equal(api.cache.has(api.key(otherContext.info)), false);
});

test('l’indicateur affiche les horaires Europe/Paris dans les messages et une forme compacte dans l’agenda', () => {
    const {api} = harness();
    const item = {id:'88',startAt:Date.parse('2026-10-15T12:30:00Z')};
    const msg = api.state(message());
    api.remember(msg, '101', [item]);
    assert.equal(msg.badge.textContent, 'Prochain RDV : 15/10 à 14:30');
    const slot = api.state(agenda());
    api.paint(slot);
    assert.equal(slot.badge.textContent, '→ 15/10 14:30');
});

test('l’agenda exclut son propre rendez-vous et affiche le suivant', () => {
    const {api} = harness();
    const slot = api.state(agenda());
    api.remember(slot, '101', [
        {id:'8001',startAt:Date.parse('2026-10-15T12:30:00Z')},
        {id:'88',startAt:Date.parse('2026-10-16T13:00:00Z')}
    ]);
    assert.equal(slot.badge.textContent, '→ 16/10 15:00');
});

test('une erreur de relecture garde la date précédente explicitement à vérifier', () => {
    const {api} = harness();
    const state = api.state(message());
    api.remember(state,'101',[{id:'88',startAt:Date.parse('2026-10-15T12:30:00Z')}]);
    api.remember(state,'101',null,'error');
    assert.equal(state.badge.textContent, 'Prochain RDV : 15/10 à 14:30 · à vérifier');
    assert.equal(state.badge.dataset.state, 'error');
});

test('le changement d’année est décidé dans le fuseau du cabinet', () => {
    const {api} = harness(Date.parse('2026-12-31T23:30:00Z'));
    const state = api.state(message());
    api.remember(state,'101',[{id:'88',startAt:Date.parse('2027-01-01T01:00:00Z')}]);
    assert.equal(state.badge.textContent, 'Prochain RDV : 01/01 à 02:00');
});

test('les lecteurs n’enfilent pas les lignes invisibles ou repliées', () => {
    const {api,document} = harness();
    const state = api.state(message());
    state.element.groupHidden = true;
    api.enqueue(state);
    assert.equal(api.queue.length, 0);
    state.element.groupHidden = false;
    document.hidden = true;
    api.enqueue(state);
    assert.equal(api.queue.length, 0);
});

function preparationFixture(context, uid = '101', selectedUid = uid) {
    const doc = {
        context, head:new NodeFixture('head'), createElement: tag => new NodeFixture(tag), getElementById: () => null
    };
    const profile = new NodeFixture('div', {'data-user-id':uid});
    const button = new NodeFixture('a', {'data-user-id':uid});
    profile.selectors.set('a.new-rdv[data-user-id="' + uid + '"]', button);
    const panel = new NodeFixture();
    const selected = new NodeFixture('input'); selected.value = selectedUid;
    const dateInput = new NodeFixture('input'); dateInput.disabled = false;
    panel.selectors.set('#newRdvUsers input.patient-input', selected);
    panel.selectors.set('form[action="/rdvs"] input[name="data[Rdv][date]"]', dateInput);
    const submitted = {count:0};
    doc.querySelector = selector => selector === '.user-detail.active[data-user-id]' ? profile
        : selector === '.new-rdv.panel.active' ? panel : null;
    doc.submit = () => submitted.count++;
    return {doc,profile,button,panel,dateInput,submitted};
}

test('Ajouter un RDV prépare le formulaire natif pour le bon patient, sans soumission automatique', async () => {
    const {api,document} = harness();
    const state = api.state(message());
    const fixture = preparationFixture(document.context);
    api.configurePreparation({doc:fixture.doc,uid:'101'});
    await api.open(state,'rdv');
    const overlay = api.getOverlay();
    assert.ok(overlay);
    assert.equal(overlay.root.hidden, false);
    assert.ok(overlay.root.classList.contains('tm-mf-native-rdv-only'));
    assert.equal(fixture.button.clicked, 1);
    assert.equal(fixture.dateInput.clicked, 1);
    assert.equal(fixture.dateInput.focused, 1);
    assert.match(overlay.status.textContent, /Choisissez le créneau puis enregistrez/);
    assert.equal(fixture.submitted.count, 0);
});

test('Ajouter un RDV refuse un patient différent dans le formulaire natif', async () => {
    const {api,document} = harness();
    const state = api.state(message());
    const fixture = preparationFixture(document.context, '101', '202');
    api.configurePreparation({doc:fixture.doc,uid:'101'});
    await api.open(state,'rdv');
    assert.equal(api.getOverlay(), null);
    assert.equal(fixture.dateInput.clicked, 0);
    assert.equal(fixture.submitted.count, 0);
    assert.equal(state.actionStatus.dataset.state, '');
});

test('Ajouter un RDV refuse la fiche d’un autre médecin', async () => {
    const {api} = harness();
    const state = api.state(message());
    const fixture = preparationFixture('autre-pro|Autre cabinet Démo');
    api.configurePreparation({doc:fixture.doc,uid:'101'});
    await api.open(state,'rdv');
    assert.equal(api.getOverlay(), null);
    assert.equal(fixture.button.clicked, 0);
    assert.equal(fixture.submitted.count, 0);
});

test('PageDown est arrêté dans la page parente quand le formulaire natif est ouvert', () => {
    const {api} = harness();
    let prevented = 0, stopped = 0;
    const event = {key:'PageDown',code:'PageDown',preventDefault:() => prevented++,stopImmediatePropagation:() => stopped++};
    api.setOverlay({root:{hidden:false}});
    api.keys(event);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    api.setOverlay(null);
    api.keys(event);
    assert.equal(prevented, 1);
});

test('les dates et libellés restent identiques avec des ordinateurs dans trois fuseaux', () => {
    const displayedProbe = [
        "mfmNativePatientId=()=> '101';",
        "const info={context:'demo',kind:'message',uid:'101',signature:'demo',excludeRdv:''};",
        "const badge={textContent:'',title:'',dataset:{}};",
        "const timestamp=mfmNativeDate('2026-10-15 14:30');",
        "mfmNativeCache.set(mfmNativeKey(info,'101'),{at:Date.now(),status:'ok',items:[{id:'88',startAt:timestamp}]});",
        "mfmNativePaint({info,badge,element:{},pending:false});",
        "globalThis.result={timestamp,label:badge.textContent};"
    ].join('\n');
    const probe = [
        "const fs=require('node:fs'),vm=require('node:vm');",
        "const input=fs.readFileSync(process.argv[1],'utf8');",
        "const begin=input.indexOf('/* BEGIN MFM_NATIVE_TOOLS_V214 */'),end=input.indexOf('/* END MFM_NATIVE_TOOLS_V214 */',begin);",
        "class FixedDate extends Date { constructor(...args){super(...(args.length?args:[Date.parse('2026-10-07T12:00:00Z')]))}static now(){return Date.parse('2026-10-07T12:00:00Z')} }",
        "const sandbox={Intl,Date:FixedDate,URL,location:{origin:'https://pro.madeformed.com'}};",
        "vm.runInNewContext(input.slice(begin,end)+" + JSON.stringify(displayedProbe) + ",sandbox);",
        "process.stdout.write(JSON.stringify(sandbox.result));"
    ].join('\n');
    for (const tz of ['UTC','America/Los_Angeles','Asia/Tokyo']) {
        const run = spawnSync(process.execPath,['-e',probe,inputPath],{env:{...process.env,TZ:tz},encoding:'utf8'});
        assert.equal(run.status,0,run.stderr);
        assert.deepEqual(JSON.parse(run.stdout), {
            timestamp:Date.parse('2026-10-15T12:30:00Z'),label:'Prochain RDV : 15/10 à 14:30'
        },tz);
    }
});
