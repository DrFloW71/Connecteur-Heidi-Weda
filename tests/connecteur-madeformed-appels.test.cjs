'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = process.env.MFM_GROUP_FRAGMENT || path.join(__dirname, '..', 'scripts', 'Connecteur-madeformed-vers-weda.user..js');
const complete = fs.readFileSync(scriptPath, 'utf8');
const start = complete.indexOf('/* BEGIN MFM_CALL_GROUPING */');
const end = complete.indexOf('/* END MFM_CALL_GROUPING */', start);
assert.ok(start >= 0 && end > start, 'Le module regroupement des appels doit être présent.');
const source = complete.slice(start, end);

// DOM minimal : fixtures anonymisées conservant la structure native du tableau.
// Les algorithmes, états de groupe et mutations exécutés restent ceux du script.
class Element {
    constructor(tagName, attributes = {}, text = '') {
        this.nodeType = 1;
        this.tagName = tagName.toUpperCase();
        this.attributes = { ...attributes };
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.hidden = false;
        this.listeners = new Map();
        this.value = '';
        this.type = 'text';
        this.checked = false;
        this.files = [];
        this.colSpan = 1;
        this._text = text;
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
            toggle: (name, force) => {
                const next = force === undefined ? !this.classList.contains(name) : force;
                if (next) this.classList.add(name); else this.classList.remove(name);
                return next;
            }
        };
    }
    get className() { return this.attributes.class || ''; }
    set className(value) { this.attributes.class = value; }
    get id() { return this.attributes.id || ''; }
    set id(value) { this.attributes.id = value; }
    get title() { return this.attributes.title || ''; }
    set title(value) { this.attributes.title = value; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = value; this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
    get cells() { return this.children.filter(child => child.tagName === 'TD' || child.tagName === 'TH'); }
    get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    get parentElement() { return this.parentNode; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...children) { children.forEach(child => { child.remove(); child.parentNode = this; this.children.push(child); }); }
    insertBefore(child, reference) {
        if (!reference) return this.append(child);
        child.remove();
        const at = this.children.indexOf(reference);
        assert.ok(at >= 0);
        child.parentNode = this;
        this.children.splice(at, 0, child);
    }
    before(child) { this.parentNode.insertBefore(child, this); }
    remove() {
        if (!this.parentNode) return;
        this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
        this.parentNode = null;
    }
    contains(node) { for (; node; node = node.parentNode) if (node === this) return true; return false; }
    matches(selector) {
        return selector.split(',').some(alternative => {
            const parts = alternative.trim().split(/\s+/);
            const single = (node, compound) => {
                const tag = compound.match(/^[a-zA-Z][\w-]*/)?.[0];
                if (tag && node.tagName !== tag.toUpperCase()) return false;
                for (const [, id] of compound.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
                for (const [, name] of compound.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(name)) return false;
                for (const [, name, value] of compound.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
                    if (node.getAttribute(name) === null || (value !== undefined && node.getAttribute(name) !== value)) return false;
                }
                return true;
            };
            let node = this;
            if (!single(node, parts.pop())) return false;
            while (parts.length) {
                const ancestor = parts.pop();
                node = node.parentNode;
                while (node && !single(node, ancestor)) node = node.parentNode;
                if (!node) return false;
            }
            return true;
        });
    }
    closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
        const result = [];
        const scan = root => root.children.forEach(child => { if (child.matches(selector)) result.push(child); scan(child); });
        scan(this);
        return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback)); }
    dispatch(type) { for (const callback of this.listeners.get(type) || []) callback({ preventDefault() {}, stopPropagation() {}, target: this }); }
}

function fixture(options = {}) {
    const html = new Element('html');
    const document = new Element('document');
    document.head = new Element('head');
    document.body = new Element('body');
    html.append(document.head, document.body);
    document.append(html);
    document.getElementById = id => document.querySelector('#' + id);
    document.createElement = tag => new Element(tag);
    document.activeElement = null;
    document.hidden = false;
    const table = new Element('table', { id: 'messages' });
    const section = new Element('tbody');
    table.append(section);
    document.body.append(table);
    const panel = new Element('div', { id: 'tm-mf-weda-body' });
    document.body.append(panel);
    const storage = new Map();
    const logs = [];
    const frames = new Map();
    let nextFrame = 0;
    let currentContext = '42|Cabinet fictif';
    let selection = null;
    const observers = [];
    const menus = [];
    const location = { hash: '', hostname: 'pro.madeformed.com', pathname: '/messages' };
    const window = new Element('window');
    window.getSelection = () => selection;
    const sandbox = {
        document, location, window, console,
        isMadeformed: () => options.madeformed !== false,
        secretariatContextOf: () => currentContext,
        mfmNativePatientId: row => row.getAttribute('data-user_id') || '',
        GM_getValue: (key, fallback) => storage.has(key) ? storage.get(key) : fallback,
        GM_setValue: (key, value) => storage.set(key, value),
        GM_registerMenuCommand: (label, callback) => menus.push({ label, callback }),
        addLog: (level, label, data) => logs.push({ level, label, data }),
        queueMicrotask: callback => { frames.set(++nextFrame, callback); },
        requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target, config) { this.target = target; this.config = config; }
            disconnect() { this.disconnected = true; }
        }
    };
    vm.runInNewContext(source + `\nglobalThis.api = {
        mfmGroupCallInfo, mfmGroupBuildCalls, mfmGroupRowProtectionReason,
        mfmGroupCallsScan, mfmGroupCallsSetup, mfmGroupCallsStop,
        mfmGroupCallsToggle, mfmGroupCallsEnabled, mfmGroupCallsDiagnostics,
        mfmGroupMutationRelevant, mfmGroupCallsQueue,
        get groups() { return mfmCallGroups; }
    };`, sandbox, { filename: scriptPath });
    return {
        api: sandbox.api, document, table, section, panel, storage, logs, frames, observers, menus, location, window,
        setContext: value => { currentContext = value; },
        setSelection: value => { selection = value; },
        flushFrame() { const next = [...frames.values()]; frames.clear(); next.forEach(callback => callback()); }
    };
}

function call(id, uid = '71', time = '14:03', options = {}) {
    const row = new Element('tr', { class: 'user-message native-row', 'data-id': id, 'data-user_id': uid });
    const cell = new Element('td');
    const content = new Element('div', { class: 'content' });
    content.append(new Element('span', { class: 'msg-canal', 'data-canal': options.canal || 'svi' }));
    cell.append(content);
    const dateCell = new Element('td');
    dateCell.append(new Element('span', { class: 'date' }, options.date || '07/10/2026'), new Element('span', { class: 'hour' }, time));
    row.append(new Element('td'), cell, dateCell);
    return row;
}
function hidden(row) { return row.classList.contains('tm-mf-call-group-hidden'); }
function addProtection(row, kind) {
    let child;
    if (kind === 'saved-task') child = new Element('div', { class: 'tm-mf-consignes-saved-card' });
    if (kind === 'open-editor') child = new Element('div', { class: 'tm-mf-consignes-editor' });
    if (kind === 'draft') { child = new Element('textarea'); child.value = 'Exemple anonymisé'; }
    if (kind === 'editable-draft') child = new Element('div', { contenteditable: 'true' }, 'Brouillon fictif');
    if (kind === 'error') child = new Element('small', { 'data-error': 'true' }, 'Échec technique');
    if (kind === 'native-error') child = new Element('div', { class: 'alert-danger' }, 'Échec technique');
    if (kind === 'invalid-input') child = new Element('input', { 'aria-invalid': 'true' });
    if (kind === 'selected-input') { child = new Element('input'); child.type = 'checkbox'; child.checked = true; }
    if (kind === 'selected-file') { child = new Element('input'); child.type = 'file'; child.files = [{ name: 'exemple.pdf' }]; }
    if (kind === 'selected-row') row.setAttribute('aria-selected', 'true');
    if (kind === 'native-selected-row') row.classList.add('selected');
    if (child) row.cells[1].append(child);
    return child;
}

test('ne regroupe que des appels SVI avec UID patient certifié et date valide', () => {
    const f = fixture();
    const valid = call('1');
    assert.equal(f.api.mfmGroupCallInfo(valid).patientId, '71');
    for (const row of [call('2', '', '14:05'), call('3', '0', '14:05'), call('x'), call('4', '71', '25:03'), call('5', '71', '14:05', { date: '31/02/2026' }), call('6', '71', '14:05', { canal: 'web' }), call('7', '71', '14:05', { canal: 'sms' })]) {
        assert.equal(f.api.mfmGroupCallInfo(row), null);
    }
});

test('fenêtre totale inclusive de 30 minutes, sans chaîner indéfiniment les intervalles', () => {
    const f = fixture();
    f.section.append(call('1', '71', '14:03'), call('2', '71', '14:18'), call('3', '71', '14:33'), call('4', '71', '14:48'));
    const groups = f.api.mfmGroupBuildCalls(f.table, 'cabinet');
    assert.equal(groups.length, 1);
    assert.deepEqual(Array.from(groups[0].calls, value => value.id), ['1', '2', '3']);
});

test('autre patient, Web/SMS, ligne native ou section intermédiaire interrompent une séquence', () => {
    const separators = [call('4', '72', '14:10'), call('4', '71', '14:10', { canal: 'web' }), call('4', '71', '14:10', { canal: 'sms' }), new Element('tr')];
    for (const separator of separators) {
        const f = fixture();
        f.section.append(call('1'), separator, call('2', '71', '14:15'));
        assert.equal(f.api.mfmGroupBuildCalls(f.table, 'cabinet').length, 0);
    }
    const f = fixture();
    f.section.append(call('1'));
    const nextSection = new Element('tbody');
    nextSection.append(call('2', '71', '14:15'));
    f.table.append(nextSection);
    assert.equal(f.api.mfmGroupBuildCalls(f.table, 'cabinet').length, 0);
});

test('ordre ascendant ou descendant accepté, ordre non monotone coupé', () => {
    for (const times of [['14:03', '14:05', '14:18'], ['14:18', '14:05', '14:03']]) {
        const f = fixture();
        times.forEach((time, index) => f.section.append(call(String(index + 1), '71', time)));
        assert.equal(f.api.mfmGroupBuildCalls(f.table, 'cabinet')[0].calls.length, 3);
    }
    const f = fixture();
    ['14:03', '14:18', '14:05'].forEach((time, index) => f.section.append(call(String(index + 1), '71', time)));
    assert.equal(f.api.mfmGroupBuildCalls(f.table, 'cabinet')[0].calls.length, 2);
});

test('passage de minuit dans la même fenêtre et libellé indiquant les deux dates', () => {
    const f = fixture();
    f.section.append(call('1', '71', '23:55'), call('2', '71', '00:05', { date: '08/10/2026' }));
    f.api.mfmGroupCallsScan();
    assert.equal(f.api.groups.size, 1);
    assert.match([...f.api.groups.values()][0].caption.textContent, /07\/10\/2026 23:55 – 08\/10\/2026 00:05/);
});

test('première ligne native conservée et ouverture/repli ne modifient aucun message', () => {
    const f = fixture();
    const rows = [call('1'), call('2', '71', '14:08'), call('3', '71', '14:18')];
    const originalCells = rows.map(row => row.cells);
    f.section.append(...rows);
    f.api.mfmGroupCallsScan();
    assert.deepEqual(rows.map(hidden), [false, true, true]);
    assert.equal([...f.api.groups.values()][0].caption.textContent, '3 appels successifs · 14:03–14:18');
    const record = [...f.api.groups.values()][0];
    record.toggle.dispatch('click');
    assert.deepEqual(rows.map(hidden), [false, false, false]);
    assert.equal(record.toggle.getAttribute('aria-expanded'), 'true');
    record.toggle.dispatch('click');
    assert.deepEqual(rows.map(hidden), [false, true, true]);
    rows.forEach((row, index) => assert.deepEqual(row.cells, originalCells[index]));
    assert.equal(f.section.children.filter(row => row.matches('tr.user-message')).length, 3);
});

for (const kind of ['saved-task', 'open-editor', 'draft', 'editable-draft', 'error', 'native-error', 'invalid-input', 'selected-input', 'selected-file', 'selected-row', 'native-selected-row']) {
    test(`une ligne contenant ${kind} reste visible et empêche le repli`, () => {
        const f = fixture();
        const first = call('1'), second = call('2', '71', '14:08');
        addProtection(second, kind);
        f.section.append(first, second);
        f.api.mfmGroupCallsScan();
        assert.equal(hidden(second), false);
        assert.equal([...f.api.groups.values()][0].toggle.disabled, true);
    });
}

test('focus, sélection de texte et message ciblé par un lien révèlent les autres appels', () => {
    for (const kind of ['focus', 'text-selection', 'linked-message']) {
        const f = fixture();
        const first = call('1'), second = call('2', '71', '14:08');
        f.section.append(first, second);
        f.api.mfmGroupCallsScan();
        assert.equal(hidden(second), true);
        if (kind === 'focus') f.document.activeElement = second.cells[1];
        if (kind === 'text-selection') f.setSelection({ isCollapsed: false, anchorNode: second.cells[1], focusNode: second.cells[1] });
        if (kind === 'linked-message') f.location.hash = '#tm-mf-message=2';
        f.api.mfmGroupCallsScan();
        assert.equal(hidden(second), false);
        assert.equal(f.api.mfmGroupRowProtectionReason(second), kind);
    }
});

test('une consigne sur la première ligne ne force pas les autres appels à rester ouverts', () => {
    const f = fixture();
    const first = call('1'), second = call('2', '71', '14:08');
    addProtection(first, 'saved-task');
    f.section.append(first, second);
    f.api.mfmGroupCallsScan();
    assert.equal(hidden(first), false);
    assert.equal(hidden(second), true);
});

test('consigne fermée vide et case non cochée ne sont pas des saisies actives', () => {
    const f = fixture();
    const first = call('1'), second = call('2', '71', '14:08');
    const editor = addProtection(second, 'open-editor');
    editor.hidden = true;
    const checkbox = new Element('input');
    checkbox.type = 'checkbox'; checkbox.value = 'on';
    second.cells[1].append(checkbox, new Element('textarea'), new Element('small', { 'data-error': 'true' }));
    f.section.append(first, second);
    f.api.mfmGroupCallsScan();
    assert.equal(hidden(second), true);
});

test('désactivation restaure toutes les lignes et leur style natif, puis ON fonctionne', () => {
    const f = fixture();
    const first = call('1'), second = call('2', '71', '14:08');
    second.style.background = 'native';
    f.section.append(first, second);
    f.api.mfmGroupCallsScan();
    assert.equal(hidden(second), true);
    f.api.mfmGroupCallsToggle();
    assert.equal(f.api.groups.size, 0);
    assert.equal(hidden(second), false);
    assert.equal(second.className, 'user-message native-row');
    assert.equal(second.style.background, 'native');
    assert.equal(f.panel.querySelector('button').textContent, 'Regrouper les appels OFF');
    f.api.mfmGroupCallsToggle();
    assert.equal(hidden(second), true);
});

test('rerender AJAX conserve ouverture manuelle, rattache le groupe aux nouveaux nœuds et nettoie les anciens', () => {
    const f = fixture();
    const oldRows = [call('1'), call('2', '71', '14:08')];
    f.section.append(...oldRows);
    f.api.mfmGroupCallsScan();
    const oldRecord = [...f.api.groups.values()][0];
    oldRecord.toggle.dispatch('click');
    const replacement = new Element('tbody');
    const newRows = [call('1'), call('2', '71', '14:08')];
    replacement.append(...newRows);
    f.section.remove();
    f.table.append(replacement);
    f.api.mfmGroupCallsScan();
    const record = [...f.api.groups.values()][0];
    assert.notEqual(record.header, oldRecord.header);
    assert.equal(record.header.parentNode, replacement);
    assert.equal(record.opened, true);
    assert.deepEqual(newRows.map(hidden), [false, false]);
    oldRows.forEach(row => assert.equal(row.className, 'user-message native-row'));
    assert.equal(f.api.mfmGroupCallsDiagnostics().nodesReplaced, 1);
});

test('pagination et changement de cabinet libèrent les groupes absents', () => {
    const f = fixture();
    const oldRows = [call('1'), call('2', '71', '14:08')];
    f.section.append(...oldRows);
    f.api.mfmGroupCallsScan();
    const nextSection = new Element('tbody');
    nextSection.append(call('9', '71', '15:03'));
    f.section.remove(); f.table.append(nextSection);
    f.api.mfmGroupCallsScan();
    assert.equal(f.api.groups.size, 0);
    oldRows.forEach(row => assert.equal(hidden(row), false));
    nextSection.append(call('10', '71', '15:08'));
    f.api.mfmGroupCallsScan();
    const oldKey = [...f.api.groups.keys()][0];
    f.setContext('43|Autre cabinet fictif');
    f.api.mfmGroupCallsScan();
    assert.equal(f.api.groups.size, 1);
    assert.notEqual([...f.api.groups.keys()][0], oldKey);
    f.setContext(null);
    f.api.mfmGroupCallsScan();
    assert.equal(f.api.groups.size, 0);
});

test('lignes masquées nativement ou filtrées interrompent le regroupement et gardent leur état', () => {
    for (const kind of ['hidden', 'display', 'class', 'aria']) {
        const f = fixture();
        const first = call('1'), second = call('2', '71', '14:08'), third = call('3', '71', '14:10');
        if (kind === 'hidden') second.hidden = true;
        if (kind === 'display') second.style.display = 'none';
        if (kind === 'class') second.classList.add('hidden');
        if (kind === 'aria') second.setAttribute('aria-hidden', 'true');
        f.section.append(first, second, third);
        f.api.mfmGroupCallsScan();
        assert.equal(f.api.groups.size, 0);
        assert.equal(hidden(second), false);
        if (kind === 'display') assert.equal(second.style.display, 'none');
    }
});

test('observateur écoute protections et identités, ignore ses propres classes et résumés', () => {
    const f = fixture();
    const rows = [call('1'), call('2', '71', '14:08')];
    f.section.append(...rows);
    f.api.mfmGroupCallsSetup();
    assert.equal(f.observers[0].config.attributes, true);
    assert.equal(f.observers[0].config.characterData, true);
    assert.equal(f.observers[0].config.attributeOldValue, true);
    assert.equal(f.api.mfmGroupMutationRelevant({ type: 'attributes', target: rows[1], attributeName: 'class', oldValue: 'user-message native-row' }), false);
    rows[1].classList.add('selected');
    assert.equal(f.api.mfmGroupMutationRelevant({ type: 'attributes', target: rows[1], attributeName: 'class', oldValue: 'user-message native-row tm-mf-call-group-hidden tm-mf-call-group-member' }), true);
    assert.equal(f.api.mfmGroupMutationRelevant({ type: 'childList', target: [...f.api.groups.values()][0].cell }), false);
    f.observers[0].callback([{ type: 'attributes', target: rows[1], attributeName: 'aria-selected' }]);
    assert.equal(f.frames.size, 1);
    f.api.mfmGroupCallsQueue();
    assert.equal(f.frames.size, 1);
    f.flushFrame();
    assert.equal(hidden(rows[1]), false);
});

test('installation idempotente, Stop restaure les lignes et retire écouteurs/bouton', () => {
    const f = fixture();
    const rows = [call('1'), call('2', '71', '14:08')];
    f.section.append(...rows);
    f.api.mfmGroupCallsSetup(); f.api.mfmGroupCallsSetup();
    assert.equal(f.observers.length, 1);
    assert.equal(f.menus.length, 1);
    assert.equal(f.document.listeners.get('input').length, 1);
    f.api.mfmGroupCallsStop();
    assert.equal(f.observers[0].disconnected, true);
    assert.equal(f.api.groups.size, 0);
    assert.equal(hidden(rows[1]), false);
    assert.equal(f.document.getElementById('tm-mf-weda-group-calls'), null);
    assert.equal(f.document.listeners.get('input').length, 0);
    f.api.mfmGroupCallsSetup();
    assert.equal(f.menus.length, 1);
});

test('aucune action sur WEDA et diagnostics ne contiennent pas les identités/messages', () => {
    const weda = fixture({ madeformed: false });
    weda.section.append(call('1'), call('2', '71', '14:08'));
    weda.api.mfmGroupCallsSetup();
    assert.equal(weda.observers.length, 0);
    assert.equal(weda.api.groups.size, 0);
    const f = fixture();
    f.section.append(call('999901', '888801'), call('999902', '888801', '14:08'));
    f.api.mfmGroupCallsScan();
    const json = JSON.stringify(f.logs);
    assert.doesNotMatch(json, /999901|999902|888801|14:03|14:08|Cabinet fictif/);
    assert.equal(f.logs[0].data.callCount, 2);
});

test('une sélection de texte traversant une ligne intermédiaire la garde visible', () => {
    const f = fixture();
    const rows = [call('1'), call('2', '71', '14:08'), call('3', '71', '14:18')];
    f.section.append(...rows);
    const outside = new Element('div');
    f.setSelection({
        isCollapsed: false, anchorNode: outside, focusNode: outside, rangeCount: 1,
        getRangeAt: () => ({ intersectsNode: row => row === rows[1] })
    });
    f.api.mfmGroupCallsScan();
    assert.equal(f.api.mfmGroupRowProtectionReason(rows[1]), 'text-selection');
    assert.deepEqual(rows.map(hidden), [false, false, false]);
});

test('un groupe ouvert reste ouvert après arrivée d’un appel, sans partager avec un autre patient', () => {
    const f = fixture();
    const rows = [call('1'), call('2','71','14:08')];
    f.section.append(...rows);
    f.api.mfmGroupCallsScan();
    [...f.api.groups.values()][0].toggle.dispatch('click');
    const next = call('3','71','14:18');
    f.section.append(next);
    f.api.mfmGroupCallsScan();
    assert.equal([...f.api.groups.values()][0].opened, true);
    assert.deepEqual([...rows,next].map(hidden), [false,false,false]);
    f.section.append(call('4','72','14:19'),call('5','72','14:20'));
    f.api.mfmGroupCallsScan();
    assert.equal(f.api.groups.size,2);
    assert.equal([...f.api.groups.values()][1].opened,false);
});

test('les demandes de scan sont regroupées et un scan direct annule la demande devenue inutile', () => {
    const f = fixture();
    f.section.append(call('1'),call('2','71','14:08'));
    f.api.mfmGroupCallsQueue(); f.api.mfmGroupCallsQueue(); f.api.mfmGroupCallsQueue();
    assert.equal(f.frames.size,1);
    assert.equal(f.api.mfmGroupCallsDiagnostics().coalesced,2);
    f.api.mfmGroupCallsScan();
    const before=f.api.mfmGroupCallsDiagnostics().scans;
    f.flushFrame();
    assert.equal(f.api.mfmGroupCallsDiagnostics().scans,before);
});

test('filtre les mutations sans rapport mais conserve toutes les protections V4', () => {
    const f = fixture();
    const row=call('1');f.section.append(row);
    const unrelated=new Element('div');f.document.body.append(unrelated);
    assert.equal(f.api.mfmGroupMutationRelevant({type:'childList',target:unrelated,addedNodes:[],removedNodes:[]}),false);
    const textParent=new Element('div',{class:'content-text'});row.cells[1].append(textParent);
    assert.equal(f.api.mfmGroupMutationRelevant({type:'characterData',target:textParent}),false);
    const error=new Element('div',{class:'alert-danger'});row.cells[1].append(error);
    assert.equal(f.api.mfmGroupMutationRelevant({type:'characterData',target:error}),true);
    const draft=new Element('div',{contenteditable:'true'});row.cells[1].append(draft);
    assert.equal(f.api.mfmGroupMutationRelevant({type:'characterData',target:draft}),true);
    assert.equal(f.api.mfmGroupMutationRelevant({type:'childList',target:f.document.body,addedNodes:[f.table],removedNodes:[]}),true);
    const head=new Element('tr',{class:'tm-mf-call-group-head'});
    assert.equal(f.api.mfmGroupMutationRelevant({type:'childList',target:f.section,addedNodes:[head],removedNodes:[]}),false);
});
