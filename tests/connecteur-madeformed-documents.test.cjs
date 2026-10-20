'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const scriptPath = path.join(__dirname, '..', 'scripts', 'Connecteur-madeformed-vers-weda.user..js');
const source = fs.readFileSync(scriptPath, 'utf8');

function contextDocument(proId = '42') {
    return {
        proId,
        querySelector(selector) {
            if (selector !== '#envNav .choice.active') return null;
            return {
                title: 'Cabinet de test',
                querySelector: () => ({ getAttribute: () => this.proId })
            };
        },
        querySelectorAll: () => []
    };
}

function node() {
    return {
        isConnected: true, style: {}, dataset: {}, children: [],
        classList: { add() {}, remove() {}, contains: () => false },
        setAttribute() {}, removeAttribute() {},
        append(...children) { this.children.push(...children); },
        prepend(...children) { this.children.unshift(...children); },
        replaceChildren(...children) { this.children = children; }, after() {},
        remove() { this.isConnected = false; },
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, focus() {},
        closest: () => null
    };
}

function harness() {
    const document = Object.assign(contextDocument(), {
        readyState: 'loading', addEventListener() {},
        getElementById: () => null,
        body: node(), createElement: () => node(), createTextNode: text => ({ textContent: text })
    });
    const storage = new Map();
    const sandbox = {
        document, URL, Event, AbortController, crypto: webcrypto,
        location: {
            hostname: 'pro.madeformed.com', origin: 'https://pro.madeformed.com',
            pathname: '/messages', href: 'https://pro.madeformed.com/messages', hash: ''
        },
        setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; },
        clearTimeout,
        setInterval: (...args) => { const timer = setInterval(...args); timer.unref(); return timer; },
        clearInterval,
        requestAnimationFrame: () => 1, cancelAnimationFrame() {},
        window: { addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval },
        console: { log() {}, warn() {}, error() {} },
        GM_getValue: (key, fallback) => storage.has(key) ? storage.get(key) : fallback,
        GM_setValue: (key, value) => storage.set(key, value)
    };
    const anchor = "    if (document.readyState === 'loading')";
    assert.ok(source.includes(anchor));
    const exposed = `
    globalThis.documentsApi = {
        maxSize: MFM_DOCUMENT_MAX_SIZE, accept: MFM_DOCUMENT_ACCEPT,
        mfmNativeDocumentReadResult, mfmNativeDocumentSnapshot, mfmNativeDocumentReady,
        mfmNativeDocumentConfirmed, mfmNativeDocumentWatch, mfmNativeDocumentCancel,
        mfmNativeDocumentSend, mfmNativeDocumentVerify, mfmNativeDocumentFinish,
        mfmNativeDocumentLock, mfmNativeDocumentPendingFor, mfmNativeDocumentDispose,
        mfmNativeDocumentValidateFiles, mfmNativeDocumentReadOnly, mfmNativeCloseOverlay,
        get overlay() { return mfmNativeOverlay; },
        set overlay(value) { mfmNativeOverlay = value; },
        hooks(hooks) {
            mfmNativeScheduleScan = () => {};
            mfmNativeLog = () => {};
            mfmNativeActionStatus = hooks.status || (() => {});
            if (hooks.source) mfmNativeSource = hooks.source;
            if (hooks.finish) mfmNativeDocumentFinish = hooks.finish;
            if (hooks.confirmed) mfmNativeDocumentConfirmed = hooks.confirmed;
            if (hooks.frame) mfmNativeFrame = hooks.frame;
            if (hooks.profile) mfmNativeLoadProfile = hooks.profile;
            if (hooks.choose) mfmNativeDocumentChoose = hooks.choose;
            if (hooks.wait) mfmNativeWait = hooks.wait;
            if (hooks.checkContext) secretariatCheckServerContext = hooks.checkContext;
            if (hooks.isolate) mfmNativeIsolatePanel = hooks.isolate;
        }
    };
`;
    vm.runInNewContext(source.replace(anchor, exposed + anchor), sandbox, { filename: scriptPath });
    return { api: sandbox.documentsApi, document, sandbox, storage };
}

function documentCard(id, name, uid = '17', overrides = {}) {
    const attributes = {
        'data-id': String(id), 'data-url': `https://pro.madeformed.com/users/${uid}/docs/${id}`,
        title: name, ...overrides
    };
    const card = node();
    Object.assign(card, {
        getAttribute: key => attributes[key] ?? null,
        hasAttribute: key => Object.hasOwn(attributes, key),
        matches: selector => selector === '.file[data-id][data-url]',
        querySelector: selector => selector === '.file-name' ? { textContent: name } : null,
        closest: () => card,
        textContent: name
    });
    return card;
}

function profileDocument({ uid = '17', cards = [], proId = '42', ready = true, action, method = 'post', multiple = true, disabled = false } = {}) {
    const container = {
        dataset: {}, addEventListener() {},
        classList: { contains: name => name === 'is-loaded' && ready },
        querySelectorAll: selector => selector.includes('button[type="submit"]') ? [input] : cards,
        querySelector: () => null
    };
    const area = { getAttribute: () => 'waiting' };
    const profile = {
        getAttribute: () => uid,
        querySelector(selector) {
            if (selector.includes('input[type="file"]')) return input;
            if (selector.includes('a.sc-btn')) return { click() {} };
            if (selector.includes('#user-docs')) return container;
            return null;
        },
        querySelectorAll: () => cards
    };
    const form = {
        isConnected: true,
        method,
        getAttribute: attribute => attribute === 'action' ? (action ?? `/users/${uid}/docs`) : attribute === 'method' ? method : null
    };
    const input = {
        isConnected: true, type: 'file', disabled, multiple, dispatches: [], files: [],
        getAttribute: attribute => attribute === 'max-size' ? String(52428800) : null,
        closest(selector) {
            if (selector === 'form') return form;
            if (selector === '.files-container') return container;
            if (selector === '.file-drop-area') return area;
            if (selector.includes('.user-detail.active')) return profile;
            return null;
        },
        dispatchEvent(event) { this.dispatches.push(event.type); },
        setAttribute() {}
    };
    const doc = contextDocument(proId);
    const baseQuery = doc.querySelector.bind(doc);
    doc.querySelector = selector => selector.includes('.user-detail.active') ? profile
        : selector.includes('#user-docs') ? container : baseQuery(selector);
    doc.querySelectorAll = () => cards;
    return { doc, input, form, container, profile, cards };
}

function operation(h, fixture = profileDocument(), names = ['analyse.pdf']) {
    const info = { context: '42|Cabinet de test', signature: 'source-exemple', sourceId: '123', uid: '17', href: 'https://pro.madeformed.com/agenda?target=user-detail&uid=17' };
    const state = { info, element: node(), actions: node(), badge: node() };
    const op = {
        state, uid: '17', frame: Object.assign(node(), { contentDocument: fixture.doc, contentWindow: {} }),
        before: new Map(), names, files: [], fileList: null,
        dispatched: true, closed: false, phase: 'uploading', timer: null,
        watch: { active: () => 0, dispose() {} }
    };
    h.api.hooks({ source: () => info });
    return { op, state, info, fixture };
}

test('le sélecteur accepte les familles demandées et la limite est de 50 Mo par fichier', () => {
    const { api } = harness();
    assert.equal(api.maxSize, 50 * 1024 * 1024);
    for (const format of ['text/*', 'image/*', 'video/*', 'audio/*', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp']) {
        assert.ok(api.accept.split(',').includes(format), format);
    }
});

test('la lecture réseau distingue les succès, erreurs et réponses incertaines', () => {
    const { api } = harness();
    assert.equal(api.mfmNativeDocumentReadResult(200, '{"success":true}'), true);
    assert.equal(api.mfmNativeDocumentReadResult(201, '{"status":"success"}'), true);
    assert.equal(api.mfmNativeDocumentReadResult(200, '{"success":false}'), false);
    assert.equal(api.mfmNativeDocumentReadResult(200, '{"errors":{"file":"refusé"}}'), false);
    assert.equal(api.mfmNativeDocumentReadResult(403, '{"success":true}'), false);
    assert.equal(api.mfmNativeDocumentReadResult(200, '<html>connexion</html>'), null);
    assert.equal(api.mfmNativeDocumentReadResult(200, '{}'), null);
});

test('le formulaire doit viser le patient prévu, utiliser POST et être chargé', () => {
    const { api } = harness();
    const valid = profileDocument();
    assert.equal(api.mfmNativeDocumentReady(valid.doc, '17'), valid.input);
    for (const options of [{ uid: '18' }, { action: '/users/18/docs' }, { action: 'https://autre.invalid/users/17/docs' }, { method: 'get' }, { ready: false }, { disabled: true }]) {
        assert.equal(api.mfmNativeDocumentReady(profileDocument(options).doc, '17'), null, JSON.stringify(options));
    }
});

test('une carte dont l’URL vise un autre patient ne valide jamais le document', () => {
    const { api } = harness();
    const fixture = profileDocument({ cards: [documentCard('200', 'analyse.pdf', '18'), documentCard('201', 'analyse.pdf', '17')] });
    const found = api.mfmNativeDocumentSnapshot(fixture.doc, '17');
    assert.equal(found.has('200'), false);
    assert.equal(found.has('201'), true);
});

test('la confirmation exige des nouveaux IDs pour chaque fichier et les noms exacts', () => {
    const h = harness();
    const cards = [documentCard('100', 'analyse.pdf')];
    const { op } = operation(h, profileDocument({ cards }), ['analyse.pdf', 'analyse.pdf']);
    op.before.set('100', 'analyse.pdf');
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), false);
    cards.push(documentCard('200', 'analyse.pdf'));
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), false);
    cards.push(documentCard('201', 'analyse.pdf'));
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), true);
    op.names = ['lyse.pdf'];
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), false);
});

test('un nom de fichier complet différent ne confirme pas un envoi malgré une sous-chaîne identique', () => {
    const h = harness();
    const { op } = operation(h, profileDocument({ cards: [documentCard('200', 'ancienne note.pdf')] }), ['note.pdf']);
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), false);
});

test('un UID ou cabinet modifié interdit la confirmation même si le nom du fichier apparaît', () => {
    const h = harness();
    const { op } = operation(h, profileDocument({ cards: [documentCard('200', 'analyse.pdf')] }));
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), true);
    op.frame.contentDocument.proId = '43';
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), false);
    op.frame.contentDocument = profileDocument({ uid: '18', cards: [documentCard('200', 'analyse.pdf', '18')] }).doc;
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), false);
});

test('une carte d’un panneau patient inactif ne confirme pas un document dans le profil actif', () => {
    const h = harness();
    const fixture = profileDocument();
    const unrelated = Object.assign(node(), {
        textContent: 'analyse.pdf',
        getAttribute: attribute => attribute === 'data-doc-id' ? '299' : null,
        hasAttribute: attribute => attribute === 'data-doc-id',
        matches: () => false,
        closest() { return this; }
    });
    fixture.doc.querySelectorAll = () => [unrelated];
    const { op } = operation(h, fixture);
    assert.equal(h.api.mfmNativeDocumentConfirmed(op), false);
});

test('un acquittement réseau sans apparition réelle ne déclenche aucun succès', () => {
    const h = harness();
    const { op } = operation(h);
    op.files = [{ name: 'analyse.pdf', size: 12, lastModified: 0 }];
    const outcomes = [];
    h.api.hooks({ confirmed: () => false, finish: (_, confirmed) => outcomes.push(confirmed) });
    class FakeXHR {
        constructor() { this.events = new Map(); }
        open() {}
        send() {}
        addEventListener(name, listener) { this.events.set(name, listener); }
    }
    const originalOpen = FakeXHR.prototype.open;
    const originalSend = FakeXHR.prototype.send;
    op.frame.contentWindow.XMLHttpRequest = FakeXHR;
    const watch = h.api.mfmNativeDocumentWatch(op, { getAttribute: () => '/users/17/docs' });
    const xhr = new FakeXHR();
    xhr.open('POST', '/users/17/docs');
    xhr.send({ values: () => op.files.values() });
    xhr.status = 200;
    xhr.responseType = '';
    xhr.responseText = '{"success":true}';
    xhr.events.get('loadend')();
    assert.equal(watch.attempted(), true);
    assert.equal(watch.active(), 0);
    assert.ok(!outcomes.includes(true), 'le réseau ne constitue pas une apparition dans le dossier');
    watch.dispose();
    assert.equal(FakeXHR.prototype.open, originalOpen);
    assert.equal(FakeXHR.prototype.send, originalSend);
});

test('un fichier dépassant 50 Mo est refusé avant tout chargement ou envoi', async () => {
    const h = harness();
    const { op } = operation(h);
    op.dispatched = false;
    let loaded = 0;
    h.api.hooks({ frame: () => { loaded++; return node(); } });
    await h.api.mfmNativeDocumentSend(op, [{ name: 'volumineux.pdf', size: h.api.maxSize + 1 }]);
    assert.equal(loaded, 0);
    assert.equal(op.dispatched, false);
    assert.equal(op.closed, true);
});

test('l’annulation après change conserve un résultat incertain sans nouvel envoi', () => {
    const h = harness();
    const { op } = operation(h);
    const outcomes = [];
    h.api.hooks({ finish: (_, confirmed) => outcomes.push(confirmed) });
    h.api.mfmNativeDocumentCancel(op);
    assert.deepEqual(outcomes, [false]);
    assert.equal(op.dispatched, true);
});

function preparation(h) {
    const fixture = profileDocument();
    const { op } = operation(h, fixture);
    op.dispatched = false;
    op.files = [];
    const frame = Object.assign(node(), { contentDocument: fixture.doc, contentWindow: { Event } });
    class FakeXHR {
        open() {}
        send() {}
        addEventListener() {}
    }
    frame.contentWindow.XMLHttpRequest = FakeXHR;
    frame.contentWindow.DataTransfer = class {
        constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
    };
    h.api.hooks({
        frame: () => frame, profile: async () => '17',
        wait: async (_, predicate) => {
            const result = predicate(fixture.doc);
            if (!result) throw new Error('Formulaire devenu incompatible.');
            return result;
        }
    });
    return { fixture, op, frame };
}

test('un autre cabinet actif côté serveur bloque le change natif', async () => {
    const h = harness();
    const { fixture, op } = preparation(h);
    let checked = 0;
    h.api.hooks({ checkContext: async () => { checked++; throw new Error('Cabinet serveur différent.'); } });
    await h.api.mfmNativeDocumentSend(op, [{ name: 'analyse.pdf', size: 12, type: 'application/pdf', lastModified: 0 }]);
    assert.ok(checked >= 1);
    assert.equal(op.dispatched, false);
    assert.deepEqual(fixture.input.dispatches, []);
});

test('une ligne de message retirée pendant la préparation interdit toute écriture', async () => {
    const h = harness();
    const { fixture, op } = preparation(h);
    op.state.element.isConnected = false;
    h.api.hooks({ checkContext: async () => {} });
    await h.api.mfmNativeDocumentSend(op, [{ name: 'analyse.pdf', size: 12, type: 'application/pdf', lastModified: 0 }]);
    assert.equal(op.dispatched, false);
    assert.deepEqual(fixture.input.dispatches, []);
});

test('une action de formulaire modifiée pendant le contrôle serveur bloque le dernier change', async () => {
    const h = harness();
    const { fixture, op } = preparation(h);
    h.api.hooks({ checkContext: async () => {
        fixture.form.getAttribute = attribute => attribute === 'action' ? '/users/18/docs' : attribute === 'method' ? 'post' : null;
    } });
    await h.api.mfmNativeDocumentSend(op, [{ name: 'analyse.pdf', size: 12, type: 'application/pdf', lastModified: 0 }]);
    assert.equal(op.dispatched, false);
    assert.deepEqual(fixture.input.dispatches, []);
});

test('le verrou incertain suit la même ligne après reconstruction du DOM et reste isolé par cabinet', () => {
    const h = harness();
    const { op, info } = operation(h);
    h.api.mfmNativeDocumentLock(op);
    const replacement = { info: { ...info }, element: node() };
    assert.equal(h.api.mfmNativeDocumentPendingFor(replacement), op);
    const otherCabinet = { info: { ...info, context: '43|Cabinet de test' }, element: node() };
    assert.equal(h.api.mfmNativeDocumentPendingFor(otherCabinet), null);
    const otherMessage = { info: { ...info, sourceId: '124' }, element: node() };
    assert.equal(h.api.mfmNativeDocumentPendingFor(otherMessage), null);
});

test('les formats et limites du formulaire natif restent prioritaires', () => {
    const { api } = harness();
    for (const name of ['document.pdf', 'note.docx', 'tableau.xlsx', 'diaporama.pptx', 'texte.odt', 'donnees.ods', 'expose.odp', 'note.txt', 'photo.jpg', 'son.mp3', 'video.mp4']) {
        assert.doesNotThrow(() => api.mfmNativeDocumentValidateFiles([{ name, type: '', size: 1 }]));
    }
    assert.doesNotThrow(() => api.mfmNativeDocumentValidateFiles([{ name: 'limite.pdf', size: api.maxSize }]));
    assert.throws(() => api.mfmNativeDocumentValidateFiles([{ name: 'programme.exe', type: '', size: 1 }]), /Format/);
    assert.throws(() => api.mfmNativeDocumentValidateFiles([{ name: 'note.pdf', size: 12 }], {
        multiple: true, getAttribute: attribute => attribute === 'max-size' ? '10' : null
    }), /volumineux/);
    assert.throws(() => api.mfmNativeDocumentValidateFiles([{ name: 'note.docx', size: 1, type: '' }], {
        multiple: true, getAttribute: attribute => attribute === 'accept' ? '.pdf' : null
    }), /refusé/);
    assert.throws(() => api.mfmNativeDocumentValidateFiles([{ name: 'a.pdf', size: 1 }, { name: 'b.pdf', size: 1 }], {
        multiple: false, getAttribute: () => null
    }), /un seul/);
});

test('le nettoyage du cadre conserve le verrou de toute tentative déjà déclenchée', () => {
    const h = harness();
    const { op, info } = operation(h);
    h.api.mfmNativeDocumentLock(op);
    h.api.mfmNativeDocumentDispose(op);
    assert.equal(op.closed, false);
    assert.equal(op.phase, 'uncertain');
    assert.equal(op.frame, null);
    assert.equal(h.api.mfmNativeDocumentPendingFor({ info: { ...info }, element: node() }), op);
});

test('le journal reprend uniquement une vérification après rechargement, sans fichiers ni noms en stockage', () => {
    const initial = harness();
    const { op, info } = operation(initial);
    op.names = ['nom-fichier-fictif.pdf'];
    op.before.set('100', 'ancien document');
    initial.api.mfmNativeDocumentLock(op);
    const journalText = JSON.stringify([...initial.storage]);
    assert.doesNotMatch(journalText, /nom-fichier-fictif|ancien document|phone|patientName/);
    const reloaded = harness();
    for (const [key, value] of initial.storage) reloaded.storage.set(key, value);
    reloaded.api.hooks({ source: () => info });
    const pending = reloaded.api.mfmNativeDocumentPendingFor({ info: { ...info }, element: node() });
    assert.equal(pending.restored, true);
    assert.equal(pending.dispatched, true);
    assert.equal(pending.phase, 'uncertain');
    assert.equal(pending.uid, '17');
    assert.equal(pending.before.has('100'), true);
    assert.equal(pending.names.length, 0);
    assert.equal(pending.files.length, 0);
    assert.equal(reloaded.api.mfmNativeDocumentConfirmed(pending), false);
});

test('un UID contraire au journal après rechargement conserve le verrou et exige une vérification native', () => {
    const initial = harness();
    const { op, info } = operation(initial);
    initial.api.mfmNativeDocumentLock(op);
    const reloaded = harness();
    for (const [key, value] of initial.storage) reloaded.storage.set(key, value);
    const changed = { info: { ...info, uid: '18', signature: 'autre-identite' }, element: node() };
    const pending = reloaded.api.mfmNativeDocumentPendingFor(changed);
    assert.ok(pending, 'le journal ne doit pas disparaître');
    assert.equal(pending.identityMismatch, true);
});

test('deux lectures successives ne réhabilitent pas une identité modifiée sans UID natif', () => {
    const h = harness();
    const { op, info } = operation(h);
    info.uid = '';
    info.signature = 'identite-dorigine-sans-uid';
    h.api.mfmNativeDocumentLock(op);
    const changed = { info: { ...info, signature: 'identite-modifiee-sans-uid' }, element: node() };
    const first = h.api.mfmNativeDocumentPendingFor(changed);
    assert.equal(first, op);
    assert.equal(first.identityMismatch, true);
    const second = h.api.mfmNativeDocumentPendingFor(changed);
    assert.equal(second, op);
    assert.equal(second.identityMismatch, true);
    assert.equal(second.sourceSignature, 'identite-dorigine-sans-uid');
    assert.equal(second.uid, '17');
});

test('la reprise sans UID natif exige un choix explicite du patient verrouillé avant de rouvrir sa fiche', async () => {
    for (const selectedUid of ['17', '18']) {
        const initial = harness();
        const { op, info } = operation(initial);
        info.uid = '';
        info.href = 'https://pro.madeformed.com/agenda?target=user-search&field=tel&value=0100000000';
        initial.api.mfmNativeDocumentLock(op);
        const reloaded = harness();
        for (const [key, value] of initial.storage) reloaded.storage.set(key, value);
        const state = { info: { ...info }, element: node(), badge: node() };
        const pending = reloaded.api.mfmNativeDocumentPendingFor(state);
        assert.equal(pending.requiresIdentityChoice, true);
        let choices = 0;
        const directProfileLoads = [];
        const fixture = profileDocument();
        const frame = Object.assign(node(), { contentDocument: fixture.doc, contentWindow: { Event } });
        reloaded.api.hooks({ source: () => info,
            checkContext: async () => {}, frame: () => frame,
            choose: async () => { choices++; return selectedUid; },
            profile: async (_, __, ___, uid) => {
                if (!uid) return '';
                assert.ok(choices > 0, 'aucune fiche verrouillée avant le choix explicite');
                directProfileLoads.push(uid);
                return uid;
            },
            wait: async (_, predicate) => predicate(fixture.doc), isolate: () => {}
        });
        await reloaded.api.mfmNativeDocumentVerify(pending);
        assert.equal(choices, 1);
        assert.deepEqual(fixture.input.dispatches, []);
        assert.equal(reloaded.api.mfmNativeDocumentPendingFor(state), pending);
        if (selectedUid === '17') {
            assert.deepEqual(directProfileLoads, ['17']);
            assert.equal(pending.requiresIdentityChoice, false);
            assert.equal(pending.identityMismatch, false);
            assert.equal(fixture.input.disabled, true);
            assert.ok(reloaded.api.overlay);
            reloaded.api.mfmNativeCloseOverlay();
        } else {
            assert.deepEqual(directProfileLoads, []);
            assert.equal(pending.requiresIdentityChoice, true);
            assert.equal(Boolean(pending.identityMismatch || pending.requiresIdentityChoice), true);
            assert.equal(reloaded.api.overlay, null);
        }
    }
});

test('un changement de signature pendant le choix du patient interdit toute ouverture de fiche', async () => {
    const initial = harness();
    const { op, info } = operation(initial);
    info.uid = '';
    info.href = 'https://pro.madeformed.com/agenda?target=user-search&field=tel&value=0100000000';
    initial.api.mfmNativeDocumentLock(op);
    const reloaded = harness();
    for (const [key, value] of initial.storage) reloaded.storage.set(key, value);
    const state = { info: { ...info }, element: node(), badge: node() };
    const pending = reloaded.api.mfmNativeDocumentPendingFor(state);
    const fixture = profileDocument();
    const frame = Object.assign(node(), { contentDocument: fixture.doc, contentWindow: { Event } });
    let profileLoads = 0;
    reloaded.api.hooks({ source: () => info,
        checkContext: async () => {}, frame: () => frame,
        choose: async () => {
            info.signature = 'nouvelle-identite-pendant-le-choix';
            state.info = { ...info };
            reloaded.api.mfmNativeDocumentPendingFor(state);
            return '17';
        },
        profile: async () => { profileLoads++; return '17'; },
        wait: async (_, predicate) => predicate(fixture.doc), isolate: () => {}
    });
    await reloaded.api.mfmNativeDocumentVerify(pending);
    assert.equal(profileLoads, 0);
    assert.equal(pending.requiresIdentityChoice, true);
    assert.equal(pending.identityMismatch, true);
    assert.equal(reloaded.api.overlay, null);
    assert.deepEqual(fixture.input.dispatches, []);
});

test('un changement de signature pendant le chargement du profil annule la vérification', async () => {
    const initial = harness();
    const { op, info } = operation(initial);
    info.uid = '';
    info.href = 'https://pro.madeformed.com/agenda?target=user-search&field=tel&value=0100000000';
    initial.api.mfmNativeDocumentLock(op);
    const reloaded = harness();
    for (const [key, value] of initial.storage) reloaded.storage.set(key, value);
    const state = { info: { ...info }, element: node(), badge: node() };
    const pending = reloaded.api.mfmNativeDocumentPendingFor(state);
    const fixture = profileDocument();
    const frame = Object.assign(node(), { contentDocument: fixture.doc, contentWindow: { Event } });
    let aliveAfterMutation = null;
    reloaded.api.hooks({ source: () => info,
        checkContext: async () => {}, frame: () => frame,
        choose: async () => '17',
        profile: async (_, __, alive) => {
            info.signature = 'nouvelle-identite-pendant-le-chargement';
            state.info = { ...info };
            reloaded.api.mfmNativeDocumentPendingFor(state);
            aliveAfterMutation = alive();
            return '17';
        },
        wait: async (_, predicate, __, alive) => {
            if (!alive()) throw new Error('Identité changée pendant le chargement.');
            return predicate(fixture.doc);
        }, isolate: () => {}
    });
    await reloaded.api.mfmNativeDocumentVerify(pending);
    assert.equal(aliveAfterMutation, false);
    assert.equal(pending.requiresIdentityChoice, true);
    assert.equal(pending.identityMismatch, true);
    assert.equal(reloaded.api.overlay, null);
    assert.deepEqual(fixture.input.dispatches, []);
});

test('la vérification après rechargement ouvre une nouvelle fiche sans transmettre ni renvoyer les fichiers', async () => {
    const initial = harness();
    const { op, info } = operation(initial);
    initial.api.mfmNativeDocumentLock(op);
    const reloaded = harness();
    for (const [key, value] of initial.storage) reloaded.storage.set(key, value);
    const fixture = profileDocument();
    const frame = Object.assign(node(), { contentDocument: fixture.doc, contentWindow: { Event } });
    let transmissions = 0;
    Object.defineProperty(fixture.input, 'files', {
        get: () => [], set: () => { transmissions++; throw new Error('La vérification a tenté de transmettre un fichier.'); }
    });
    reloaded.api.hooks({ source: () => info,
        checkContext: async () => {}, frame: () => frame,
        profile: async (_, __, ___, uid) => { assert.equal(uid, '17'); return uid; },
        wait: async (_, predicate) => predicate(fixture.doc), isolate: () => {}
    });
    const state = { info: { ...info }, element: node(), badge: node() };
    const pending = reloaded.api.mfmNativeDocumentPendingFor(state);
    await reloaded.api.mfmNativeDocumentVerify(pending);
    assert.equal(pending.frame, frame);
    assert.equal(fixture.input.disabled, true);
    assert.equal(transmissions, 0);
    assert.deepEqual(fixture.input.dispatches, []);
    assert.ok(reloaded.api.overlay);
    reloaded.api.mfmNativeCloseOverlay();
    assert.equal(reloaded.api.mfmNativeDocumentPendingFor(state), pending);
});

test('fermer la vérification garde le verrou et nettoie aussi le timer du formulaire RDV', () => {
    const h = harness();
    const { op, info } = operation(h);
    h.api.mfmNativeDocumentLock(op);
    const root = node();
    const contextTimer = setInterval(() => {}, 10000);
    const formTimer = setInterval(() => {}, 10000);
    contextTimer.unref(); formTimer.unref();
    h.api.overlay = { root, documentOperation: op, contextTimer, formTimer };
    h.api.mfmNativeCloseOverlay();
    assert.equal(h.api.overlay, null);
    assert.equal(root.hidden, true);
    assert.equal(h.api.mfmNativeDocumentPendingFor({ info: { ...info }, element: node() }), op);
    assert.equal(contextTimer._destroyed, true);
    assert.equal(formTimer._destroyed, true);
});

test('la vérification désactive les téléversements et bloque change, drop et submit', () => {
    const { api } = harness();
    const fileInput = { type: 'file', disabled: false, value: 'ancien-fichier.pdf' };
    const submit = { type: 'submit', disabled: false };
    const events = new Map();
    const area = {
        dataset: {}, querySelectorAll: () => [fileInput, submit],
        addEventListener: (type, listener, capture) => { assert.equal(capture, true); events.set(type, listener); }
    };
    const doc = { querySelector: () => ({ querySelector: () => area }) };
    api.mfmNativeDocumentReadOnly(doc);
    assert.equal(fileInput.disabled, true);
    assert.equal(fileInput.value, '');
    assert.equal(submit.disabled, true);
    for (const type of ['change', 'drop', 'dragover', 'submit']) {
        let prevented = false, stopped = false;
        events.get(type)({ type, target: { type: 'file' },
            preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
        assert.equal(prevented, true, type);
        assert.equal(stopped, true, type);
    }
});
