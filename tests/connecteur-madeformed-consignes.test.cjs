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
        }
    };
}

function harness() {
    const document = Object.assign(contextDocument(), {
        readyState: 'loading',
        addEventListener() {},
        getElementById: () => null,
        querySelectorAll: () => [],
        body: { append() {} }
    });
    const frames = [];
    document.createElement = tag => {
        assert.equal(tag, 'iframe');
        const frame = {
            style: {},
            contentDocument: contextDocument(),
            setAttribute() {},
            remove() { this.removed = true; }
        };
        frames.push(frame);
        return frame;
    };
    const storage = new Map();
    const sandbox = {
        document,
        location: {
            hostname: 'pro.madeformed.com', origin: 'https://pro.madeformed.com',
            pathname: '/messages', href: 'https://pro.madeformed.com/messages', hash: ''
        },
        window: { addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval },
        console: { log() {}, warn() {}, error() {} },
        URL, Event, crypto: webcrypto,
        GM_getValue: (key, fallback) => storage.has(key) ? storage.get(key) : fallback,
        GM_setValue: (key, value) => storage.set(key, value)
    };
    const exposed = `
    globalThis.connector = {
        VERSION, isLaunchShortcut, getVisibleTextarea, secretariatPayloadOf,
        secretariatParseTaskList, secretariatCreateTask, secretariatContextOf,
        secretariatPrepareTask, secretariatDestinationStatus, secretariatCreationFailureDetail,
        getLogs,
        get busy() { return Boolean(secretariatCreating); },
        get shared() { return secretariatShared; },
        hooks(hooks) {
            if (hooks.checkContext) secretariatCheckServerContext = hooks.checkContext;
            if (hooks.prepare) secretariatPrepareTask = hooks.prepare;
            if (hooks.verify) secretariatVerifyCreated = hooks.verify;
            if (hooks.refresh) secretariatRefreshShared = hooks.refresh;
        }
    };
`;
    const anchor = "    if (document.readyState === 'loading')";
    assert.ok(source.includes(anchor));
    vm.runInNewContext(source.replace(anchor, exposed + anchor), sandbox, { filename: scriptPath });
    return { api: sandbox.connector, document, frames, sandbox };
}

function messageRow(id = '123') {
    const attributes = { 'data-id': id, 'data-name': 'Patient Exemple', 'data-phone': '0000000000' };
    return {
        getAttribute: key => attributes[key],
        cells: [{}, {}, { innerText: '06/10/2026 10:30' }]
    };
}

function taskDocument(payload, overrides = {}) {
    const detail = overrides.detail ?? payload.detail;
    const card = {
        getAttribute: key => ({ 'data-task-id': '456', 'task-type': '0', ...overrides.attributes })[key],
        querySelector(selector) {
            if (selector === '.task-header .title') return { textContent: overrides.title ?? payload.title };
            if (selector === '.task-footer .users .avatar-sec') return overrides.secretary === false ? null : {};
            if (selector === '.task-detail') return {
                cloneNode: () => ({ textContent: detail, querySelectorAll: () => [] })
            };
            return null;
        }
    };
    return {
        querySelector: selector => selector === '.task-list' ? {} : null,
        querySelectorAll: () => [card]
    };
}

function creationScenario(h, verify) {
    const payload = h.api.secretariatPayloadOf(messageRow(), 'Consigne fictive pour le test');
    const task = { ...payload, taskId: '456', state: 'late', label: 'À faire' };
    let clicks = 0;
    const form = {
        isConnected: true,
        querySelector(selector) {
            if (selector === '[name="data[Task][id]"]') return { value: '' };
            if (selector === '[name="data[Task][type]"]') return { value: '0' };
            return null;
        },
        querySelectorAll: () => []
    };
    const save = { click() { clicks += 1; } };
    h.api.shared.context = payload.context;
    h.api.hooks({
        checkContext: async () => {},
        prepare: async () => ({ form, save }),
        verify: verify || (async () => task),
        refresh: async () => {}
    });
    return { payload, task, form, save, clicks: () => clicks };
}

test('les versions Tampermonkey et interne correspondent', () => {
    const { api } = harness();
    const metadata = source.match(/\/\/ @version\s+(\S+)/)[1];
    assert.equal(api.VERSION, metadata);
});

test('PageDown reste actif hors des consignes et laisse leur saisie tranquille', () => {
    const { api } = harness();
    assert.equal(api.isLaunchShortcut({ key: 'PageDown', target: { closest: () => null } }), true);
    assert.equal(api.isLaunchShortcut({ code: 'PageDown', target: { closest: () => ({}) } }), false);
    assert.equal(api.isLaunchShortcut({ key: 'Enter' }), false);
});

test('la détection SMS ignore les éditeurs de consignes visibles', () => {
    const { api, document } = harness();
    const nativeDocument = {
        defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) }
    };
    const textarea = consigne => ({
        closest: () => consigne ? {} : null,
        ownerDocument: nativeDocument,
        getBoundingClientRect: () => ({ width: 200, height: 80 }),
        value: 'Texte fictif'
    });
    const note = textarea(true);
    const sms = textarea(false);
    document.querySelectorAll = () => [note];
    assert.equal(api.getVisibleTextarea(), null);
    document.querySelectorAll = () => [note, sms];
    assert.equal(api.getVisibleTextarea(), sms);
});

test('une consigne retrouve son message et son cabinet sans contenu sensible dans les logs', () => {
    const { api } = harness();
    const payload = api.secretariatPayloadOf(messageRow(), '  Texte de consigne fictive  ');
    assert.equal(payload.note, 'Texte de consigne fictive');
    assert.equal(payload.context, '42|Cabinet de test');
    assert.match(payload.detail, /\n\nMessage MadeForMed #123\n/);
    assert.match(payload.detail, /https:\/\/pro\.madeformed\.com\/messages#tm-mf-message=123$/);
    assert.match(payload.reference, /^tm-mf-[a-f0-9-]+$/);
    const logs = JSON.stringify(api.getLogs());
    assert.doesNotMatch(logs, /Texte de consigne fictive|Patient Exemple|0000000000/);
    assert.throws(() => api.secretariatPayloadOf(messageRow('123-invalide'), 'Texte'), /identifiant/);
});

test('la lecture retrouve une tâche du secrétariat et conserve le lien avec le message', () => {
    const { api } = harness();
    const payload = api.secretariatPayloadOf(messageRow(), 'Consigne fictive');
    const tasks = api.secretariatParseTaskList(taskDocument(payload), { filter: 'late', label: 'À faire' });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].messageId, '123');
    assert.equal(tasks[0].note, payload.note);
    assert.equal(tasks[0].reference, payload.reference);
    assert.equal(tasks[0].state, 'late');
});

test('la lecture écarte les autres tâches et les références étrangères ou incohérentes', () => {
    const { api } = harness();
    const payload = api.secretariatPayloadOf(messageRow(), 'Consigne fictive');
    const invalid = [
        { attributes: { 'task-type': '1' } },
        { attributes: { 'data-task-id': 'x' } },
        { title: 'Une tâche ordinaire' },
        { detail: payload.detail.replace('Message MadeForMed #123', 'Message MadeForMed #999') },
        { detail: payload.detail.replace('https://pro.madeformed.com/messages', 'https://autre.invalid/messages') },
        { detail: payload.detail.replace('#tm-mf-message=123', '#tm-mf-message=999') }
    ];
    for (const overrides of invalid) {
        assert.equal(api.secretariatParseTaskList(taskDocument(payload, overrides), { filter: 'late' }).length, 0);
    }
    assert.throws(() => api.secretariatParseTaskList({ querySelector: () => null }, {}), /liste des tâches/);
});

test('la création clique une fois et publie la tâche après confirmation', async () => {
    const h = harness();
    const s = creationScenario(h);
    const created = await h.api.secretariatCreateTask(s.payload, () => {});
    assert.equal(created.taskId, '456');
    assert.equal(s.clicks(), 1);
    assert.equal(h.api.shared.tasks.length, 1);
    assert.equal(h.api.busy, false);
    assert.equal(h.frames[0].removed, true);
});

test('un changement de cabinet avant l’enregistrement bloque le clic natif', async () => {
    const h = harness();
    const s = creationScenario(h);
    h.api.hooks({ prepare: async () => {
        h.document.proId = '99';
        return { form: s.form, save: s.save };
    } });
    await assert.rejects(h.api.secretariatCreateTask(s.payload, () => {}), error => error.submitted === false);
    assert.equal(s.clicks(), 0);
    assert.equal(h.api.shared.tasks.length, 0);
    assert.equal(h.api.busy, false);
});

test('un enregistrement incertain se vérifie sans envoyer une deuxième tâche', async () => {
    const h = harness();
    const s = creationScenario(h, async () => { throw new Error('Confirmation indisponible'); });
    await assert.rejects(h.api.secretariatCreateTask(s.payload, () => {}), error => error.submitted === true);
    assert.equal(s.clicks(), 1);
    assert.equal(h.api.shared.tasks.length, 0);
    h.api.hooks({ verify: async () => s.task });
    await h.api.secretariatCreateTask(s.payload, () => {}, true);
    assert.equal(s.clicks(), 1);
    assert.equal(h.frames.length, 1);
    assert.equal(h.api.shared.tasks.length, 1);
});

test('deux créations simultanées ne provoquent pas deux envois', async () => {
    const h = harness();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const s = creationScenario(h, () => pending);
    const first = h.api.secretariatCreateTask(s.payload, () => {});
    await assert.rejects(h.api.secretariatCreateTask(s.payload, () => {}), /déjà en cours/);
    release(s.task);
    await first;
    assert.equal(s.clicks(), 1);
    assert.equal(h.api.busy, false);
});


test('les tâches natives sans avatar de secrétaire restent affichées sous leur message', () => {
    const { api } = harness();
    const payload = api.secretariatPayloadOf(messageRow(), 'Consigne fictive');
    const tasks = api.secretariatParseTaskList(taskDocument(payload, { secretary: false }), { filter: 'late' });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].messageId, payload.messageId);
});

test('un formulaire sans attribution est accepté, un sélecteur incomplet est refusé', () => {
    const { api } = harness();
    const native = { querySelector: () => null, querySelectorAll: () => [] };
    assert.equal(api.secretariatDestinationStatus(native).mode, 'agenda');
    assert.equal(api.secretariatDestinationStatus(native).valid, true);
    const incomplete = {
        querySelector: selector => selector.includes('data[Task][dest]') ? { value: '77' } : null,
        querySelectorAll: () => []
    };
    assert.equal(api.secretariatDestinationStatus(incomplete).valid, false);
    const destination = { value: '77' };
    const selected = { getAttribute: () => '77', querySelector: () => ({ textContent: 'Secrétaire' }) };
    const explicit = {
        querySelector: selector => selector === '.dest-selected' ? selected : selector.includes('data[Task][dest]') ? destination : null,
        querySelectorAll: () => [{}]
    };
    assert.equal(api.secretariatDestinationStatus(explicit).valid, true);
    destination.value = '99';
    assert.equal(api.secretariatDestinationStatus(explicit).valid, false);
});

test('la préparation du formulaire réel sans destinataire ne clique pas sur Enregistrer', async () => {
    const h = harness();
    const payload = h.api.secretariatPayloadOf(messageRow(), 'Consigne native fictive');
    const fields = {
        '[name="data[Task][id]"]': { value: '' },
        '[name="data[Task][type]"]': { value: '0' },
        '[name="data[Task][titre]"]': { value: '', dispatchEvent() {} },
        '[name="data[Task][detail]"]': { value: '', dispatchEvent() {} }
    };
    let clicks = 0;
    const save = { disabled: false, classList: { contains: () => false }, click: () => { clicks++; } };
    const form = {
        getClientRects: () => [{}],
        getAttribute: name => name === 'action' ? '/tasks' : 'post',
        querySelector: selector => fields[selector] || (selector.includes('input.save') ? save : null),
        querySelectorAll: () => []
    };
    const menu = { click() {}, getClientRects: () => [{}] };
    const newTask = { click() {}, getClientRects: () => [{}] };
    const doc = contextDocument();
    const baseQuery = doc.querySelector.bind(doc);
    doc.readyState = 'complete';
    doc.querySelector = selector => ({
        '#shortcuts .menu-task-btn': menu,
        '#tasks .new-task-btn': newTask,
        '.new-task #TaskView': form
    })[selector] || baseQuery(selector);
    doc.querySelectorAll = selector => selector === '#shortcuts .menu-task-btn' ? [menu] : [];
    const frame = { isConnected: true, contentDocument: doc, contentWindow: { Event } };
    const prepared = await h.api.secretariatPrepareTask(frame, payload);
    assert.equal(prepared.form, form);
    assert.equal(prepared.save, save);
    assert.equal(fields['[name="data[Task][titre]"]'].value, payload.title);
    assert.equal(fields['[name="data[Task][detail]"]'].value, payload.detail);
    assert.equal(clicks, 0);
    assert.equal(Object.keys(fields).some(name => name.includes('[dest]')), false);
});

test('un changement d’attribution juste avant l’enregistrement empêche l’envoi', async () => {
    const h = harness();
    const s = creationScenario(h);
    h.api.hooks({ prepare: async () => {
        const nativeQuery = s.form.querySelector.bind(s.form);
        s.form.querySelector = selector => selector.includes('data[Task][dest]') ? { value: '99' } : nativeQuery(selector);
        return { form: s.form, save: s.save };
    } });
    await assert.rejects(h.api.secretariatCreateTask(s.payload, () => {}), error => error.submitted === false);
    assert.equal(s.clicks(), 0);
});

test('les erreurs détaillées affichent une cause fixe sans révéler une réponse réseau', async () => {
    const h = harness();
    const s = creationScenario(h);
    h.api.hooks({ prepare: async () => { throw new Error('Le destinataire Secrétaire est absent de cet agenda.'); } });
    await assert.rejects(h.api.secretariatCreateTask(s.payload, () => {}), /destinataire Secrétaire/);
    assert.equal(s.clicks(), 0);
    const privateText = 'Texte réseau privé et identité fictive';
    const detail = h.api.secretariatCreationFailureDetail(new Error(privateText), 'la préparation du formulaire');
    assert.doesNotMatch(detail, /Texte réseau privé/);
    assert.match(detail, /préparation du formulaire/);
    assert.doesNotMatch(JSON.stringify(h.api.getLogs()), /Texte réseau privé/);
});
