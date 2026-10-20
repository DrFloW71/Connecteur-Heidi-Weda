'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'Connecteur-madeformed-vers-weda.user..js'), 'utf8');

function choice(href, proId, active = false, label = 'Dr Ronez', cabinet = '') {
    return {
        classList: { contains: name => name === 'active' && active },
        querySelector(selector) {
            if (selector === 'a[href]') return { getAttribute: () => href };
            if (selector === '[pro-id]') return { getAttribute: () => proId };
            if (selector === '.pro') return { textContent: label };
            if (selector === '.cab') return { textContent: cabinet };
            return null;
        }
    };
}

function harness() {
    const state = { choices: [], native: null, badge: null, active: null, navigations: [], alerts: [], storage: new Map() };
    const document = {
        readyState: 'loading', addEventListener() {}, getElementById: () => null,
        querySelectorAll: () => state.choices,
        querySelector(selector) {
            if (selector === '.tm-mf-shared-messaging-link .tm-mf-message-counter') return state.badge;
            if (selector.includes('.serv-msg:not(')) return state.native;
            if (selector === '#envNav .choice.active') return state.active
                ? state.choices.find(el => el.querySelector('[pro-id]').getAttribute() === state.active) || choice('#', state.active, true)
                : state.choices.find(el => el.classList.contains('active')) || null;
            return null;
        }
    };
    const location = {
        hostname: 'pro.madeformed.com', origin: 'https://pro.madeformed.com',
        hash: '', search: '', pathname: '/agenda', href: 'https://pro.madeformed.com/agenda',
        assign: url => state.navigations.push(url)
    };
    const sandbox = {
        document, location, URL, AbortController,
        setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout,
        history: {state:{native:true}, replaceState(stateValue, title, href) {
            state.historyState = stateValue;
            const url = new URL(href);
            Object.assign(location, {href:url.href, hash:url.hash, pathname:url.pathname, search:url.search});
        }},
        console: {log() {}, warn() {}, error() {}},
        GM_getValue: (key, fallback) => state.storage.get(key) ?? fallback,
        GM_setValue: (key, value) => state.storage.set(key, value),
        window: { addEventListener() {} },
        alert: text => state.alerts.push(text),
        sessionStorage: {
            getItem: key => state.storage.get(key) ?? null,
            setItem: (key, value) => state.storage.set(key, value),
            removeItem: key => state.storage.delete(key)
        }
    };
    const anchor = "    if (document.readyState === 'loading')";
    assert.ok(source.includes(anchor));
    const expose = '    globalThis.navigation = { getMadeformedPrimaryMessagingTarget, getMadeformedNativeMessagingLink, getMadeformedMessagingNavigationHref, getMadeformedMessagingNavigationIntent, clearMadeformedMessagingNavigation, resumeMadeformedMessagingNavigation, parseMadeformedNativeMessageCount, refreshMadeformedMessagingCount, getLogs, getMadeformedSharedMessageCount, countKey: MADEFORMED_MESSAGING_COUNT_KEY, key: MADEFORMED_MESSAGING_NAV_KEY };\n';
    vm.runInNewContext(source.replace(anchor, expose + anchor), sandbox);
    return {
        state, sandbox, api: sandbox.navigation,
        pending(proId = '42', at = Date.now()) {
            state.storage.set(sandbox.navigation.key, JSON.stringify({ proId, at }));
        },
        native(href = '/messages', count = '7') {
            state.nativeCounter = {textContent:count};
            state.native = { getAttribute: () => href, badge: '7', querySelector: () => state.nativeCounter };
        }
    };
}

test('la messagerie ajoutée reprend le lien natif de l’environnement principal', () => {
    const h = harness();
    h.state.choices = [choice('/pros?cabspro=0', '42'), choice('#', '43', true, 'Collaboratrice Exemple')];
    const route = h.api.getMadeformedPrimaryMessagingTarget();
    assert.equal(route.href, 'https://pro.madeformed.com/pros?cabspro=0');
    assert.equal(route.proId, '42');
    assert.equal(route.needsSwitch, true);
    assert.equal(h.state.navigations.length, 0);
});

test('le lien principal reste prioritaire même si les onglets changent d’ordre', () => {
    const h = harness();
    h.state.choices = [choice('#', '43', true, 'Collaboratrice Exemple'), choice('/pros?cabspro=0', '42')];
    assert.equal(h.api.getMadeformedPrimaryMessagingTarget().proId, '42');
});

test('un environnement principal déjà actif ouvre directement /messages', () => {
    const h = harness();
    h.state.choices = [choice('#', '42', true)];
    const route = h.api.getMadeformedPrimaryMessagingTarget();
    assert.equal(route.href, 'https://pro.madeformed.com/messages');
    assert.equal(route.needsSwitch, false);
});

test('les liens étrangers et les identités manquantes ne déclenchent pas de bascule', () => {
    const h = harness();
    for (const link of ['/agenda', '/pros?cabspro=abc', 'https://example.invalid/pros?cabspro=0', 'javascript:void(0)']) {
        h.state.choices = [choice(link, '42')];
        assert.equal(h.api.getMadeformedPrimaryMessagingTarget(), null);
    }
    h.state.choices = [choice('/pros?cabspro=0', '')];
    assert.equal(h.api.getMadeformedPrimaryMessagingTarget(), null);
});

test('le bouton natif et son compteur ne sont pas modifiés pendant leur lecture', () => {
    const h = harness();
    h.native();
    assert.equal(h.api.getMadeformedNativeMessagingLink(), h.state.native);
    assert.equal(h.state.native.badge, '7');
    h.native('https://example.invalid/messages');
    assert.equal(h.api.getMadeformedNativeMessagingLink(), null);
});

test('la messagerie ne s’ouvre qu’après l’arrivée dans le bon environnement', () => {
    const h = harness();
    h.pending();
    h.native();
    h.state.active = '42';
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), true);
    assert.deepEqual(h.state.navigations, ['https://pro.madeformed.com/messages']);
    assert.equal(h.state.storage.size, 0);
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.navigations.length, 1);
});

test('un utilisateur encore différent ne consomme pas la demande, une demande périmée est rejetée', () => {
    const h = harness();
    h.native();
    h.state.active = '43';
    h.pending();
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.storage.size, 1);
    h.state.active = '42';
    h.pending('42', Date.now() - 121000);
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.storage.size, 0);
    assert.equal(h.state.navigations.length, 0);
});

test('une barre encore absente conserve la demande jusqu’à son affichage', () => {
    const h = harness();
    h.pending();
    h.native();
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.storage.size, 1);
    h.state.active = '42';
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), true);
    assert.equal(h.state.storage.size, 0);
});

test('un bouton natif tardif termine la navigation lorsque son affichage est prêt', () => {
    const h = harness();
    h.pending();
    h.state.active = '42';
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.navigations.length, 0);
    assert.equal(h.state.storage.size, 1);
    assert.equal(h.state.alerts.length, 0);
    h.native();
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), true);
    assert.equal(h.state.storage.size, 0);
    assert.equal(h.state.navigations.length, 1);
});

function countHarness(value = '9') {
    const h = harness();
    h.state.badge = {textContent:value, title:''};
    h.state.choices = [choice('/pros?cabspro=0', '42'), choice('#', '43', true, 'Collaborateur Exemple')];
    h.cached = (count, at = Date.now(), context = '42|') => h.state.storage.set(h.api.countKey, {context, count, at});
    h.sandbox.fetch = () => {throw new Error('La lecture réseau du compteur est interdite dans ce test');};
    return h;
}

test('le compteur natif accepte zéro et les entiers, et refuse les réponses invalides', () => {
    const h = harness();
    for (const value of [0, 1, '0', '12']) assert.equal(h.api.parseMadeformedNativeMessageCount({result:value}), Number(value));
    for (const value of [null, undefined, '', 'erreur', -1, 1.5, Infinity, true]) assert.equal(h.api.parseMadeformedNativeMessageCount({result:value}), null);
});

test('le compteur natif principal est partagé avec son contexte, sans contenu de message', async () => {
    const h = harness();
    h.state.choices = [choice('#', '42', true)];
    h.native('/messages', '3');
    assert.equal(await h.api.refreshMadeformedMessagingCount(true), true);
    const record = h.state.storage.get(h.api.countKey);
    assert.equal(record.count, 3);
    assert.equal(record.context, '42|');
    assert.deepEqual(Object.keys(record).sort(), ['at','context','count']);
});

test('un utilisateur secondaire affiche le nombre principal sans appeler /messages/count', async () => {
    const h = countHarness();
    h.cached(3);
    assert.equal(await h.api.refreshMadeformedMessagingCount(), true);
    assert.equal(h.state.badge.textContent, '3');
    assert.equal(h.state.navigations.length, 0);
});

test('un zéro réellement observé dans le compteur principal masque la pastille secondaire', async () => {
    const h = countHarness();
    h.cached(0);
    assert.equal(await h.api.refreshMadeformedMessagingCount(), true);
    assert.equal(h.state.badge.textContent, '');
});

test('une valeur absente, périmée ou étrangère indique un nombre inconnu, sans inventer zéro', async () => {
    const h = countHarness();
    assert.equal(await h.api.refreshMadeformedMessagingCount(), false);
    assert.equal(h.state.badge.textContent, '…');
    h.cached(4, Date.now() - 25 * 60 * 60 * 1000);
    assert.equal(await h.api.refreshMadeformedMessagingCount(), false);
    h.cached(4, Date.now(), '99|');
    assert.equal(await h.api.refreshMadeformedMessagingCount(), false);
    assert.equal(h.state.badge.textContent, '…');
    assert.match(h.state.badge.title, /actualiser le compteur/);
});

test('un changement natif met à jour le partage, un nombre inchangé ne prétend pas être nouvellement lu', async () => {
    const h = harness();
    h.state.choices = [choice('#', '42', true)];
    h.native('/messages', '3');
    await h.api.refreshMadeformedMessagingCount(true);
    const first = h.state.storage.get(h.api.countKey);
    await h.api.refreshMadeformedMessagingCount();
    assert.equal(h.state.storage.get(h.api.countKey), first);
    h.state.nativeCounter.textContent = '2';
    await h.api.refreshMadeformedMessagingCount();
    assert.equal(h.state.storage.get(h.api.countKey).count, 2);
});

test('la messagerie native d’un autre médecin ne remplace pas le nombre principal', async () => {
    const h = countHarness();
    h.cached(3);
    h.native('/messages', '18');
    await h.api.refreshMadeformedMessagingCount();
    assert.equal(h.state.storage.get(h.api.countKey).count, 3);
    assert.equal(h.state.badge.textContent, '3');
});

test('le même médecin dans un autre cabinet n’utilise pas un compteur étranger', async () => {
    const h = countHarness();
    h.cached(3);
    h.state.choices[0].title = 'Autre cabinet';
    assert.equal(await h.api.refreshMadeformedMessagingCount(), false);
    assert.equal(h.state.badge.textContent, '…');
});

function hashPending(h, contextKey = '42|', proId = '42') {
    const href = h.api.getMadeformedMessagingNavigationHref({
        href:'https://pro.madeformed.com/pros?cabspro=4', needsSwitch:true, proId, contextKey
    });
    const marker = new URL(href).hash;
    h.sandbox.location.hash = marker;
    h.sandbox.location.href = 'https://pro.madeformed.com/agenda' + marker;
    return href;
}

test('un autre ordinateur peut placer Dr Ronez après un utilisateur ayant le rang zéro', () => {
    const h = harness();
    h.state.choices = [choice('/pros?cabspro=0', '43', false, 'Collaborateur Exemple'),
        choice('#', '44', true, 'Autre utilisateur'), choice('/pros?cabspro=4', '42')];
    const target = h.api.getMadeformedPrimaryMessagingTarget();
    assert.equal(target.proId, '42');
    assert.equal(target.href, 'https://pro.madeformed.com/pros?cabspro=4');
});

test('Dr Ronez actif à une autre position garde sa messagerie et son compteur natifs', async () => {
    const h = harness();
    h.state.choices = [choice('/pros?cabspro=0', '43', false, 'Collaborateur Exemple'), choice('#', '42', true)];
    h.native('/messages', '5');
    assert.equal(h.api.getMadeformedPrimaryMessagingTarget().needsSwitch, false);
    await h.api.refreshMadeformedMessagingCount(true);
    assert.equal(h.state.storage.get(h.api.countKey).count, 5);
});

test('aucune substitution par le premier utilisateur si Dr Ronez est absent ou ambigu', () => {
    const h = harness();
    h.state.choices = [choice('#', '43', true, 'Collaborateur Exemple')];
    assert.equal(h.api.getMadeformedPrimaryMessagingTarget(), null);
    h.state.choices = [choice('/pros?cabspro=1', '42'), choice('/pros?cabspro=2', '44')];
    assert.equal(h.api.getMadeformedPrimaryMessagingTarget(), null);
});

test('plusieurs cabinets du même médecin sont distingués par le cabinet actif', () => {
    const h = harness();
    h.state.choices = [choice('#', '43', true, 'Collaborateur Exemple', 'Cabinet A'),
        choice('/pros?cabspro=1', '42', false, 'Dr Ronez', 'Cabinet B'),
        choice('/pros?cabspro=4', '42', false, 'Dr Ronez', 'Cabinet A')];
    assert.equal(h.api.getMadeformedPrimaryMessagingTarget().href, 'https://pro.madeformed.com/pros?cabspro=4');
});

test('le libellé du médecin tolère la casse, les espaces et le point après Dr', () => {
    const h = harness();
    h.state.choices = [choice('/pros?cabspro=4', '42', false, '  DR.  RONEZ  ')];
    assert.equal(h.api.getMadeformedPrimaryMessagingTarget().proId, '42');
});

test('le lien porte sa demande même dans un nouvel onglet sans stockage préalable', () => {
    const h = harness();
    const href = hashPending(h);
    assert.equal(new URL(href).searchParams.get('cabspro'), '4');
    const pending = h.api.getMadeformedMessagingNavigationIntent();
    assert.equal(pending.proId, '42');
    assert.equal(pending.contextKey, '42|');
    assert.equal(h.state.storage.size, 0);
    h.api.clearMadeformedMessagingNavigation();
    assert.equal(h.sandbox.location.hash, '');
    assert.equal(h.state.historyState.native, true);
});

test('la demande portée par le lien fonctionne quand tout sessionStorage est bloqué', () => {
    const h = harness();
    h.sandbox.sessionStorage = {
        getItem() {throw new Error('Stockage bloqué');},
        setItem() {throw new Error('Stockage bloqué');},
        removeItem() {throw new Error('Stockage bloqué');}
    };
    hashPending(h);
    h.native();
    h.state.active = '42';
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), true);
    assert.deepEqual(h.state.navigations, ['https://pro.madeformed.com/messages']);
    assert.equal(h.sandbox.location.hash, '');
    assert.equal(h.state.alerts.length, 0);
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
});

test('la demande du lien attend la barre, le bon utilisateur puis le bouton natif', () => {
    const h = harness();
    hashPending(h);
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    h.state.active = '43';
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    h.state.active = '42';
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    h.native();
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), true);
    assert.equal(h.state.navigations.length, 1);
});

test('un chargement après trente secondes reste pris en charge puis expire après deux minutes', () => {
    const h = harness();
    const initial = Date.now();
    let now = initial;
    h.sandbox.Date = class extends Date { static now() {return now;} };
    hashPending(h);
    assert.ok(h.api.getMadeformedMessagingNavigationIntent());
    now += 31000;
    assert.ok(h.api.getMadeformedMessagingNavigationIntent());
    now = initial + 121000;
    assert.equal(h.api.getMadeformedMessagingNavigationIntent(), null);
    assert.equal(h.sandbox.location.hash, '');
});

test('un cabinet différent arrête la demande sans ouvrir sa messagerie', () => {
    const h = harness();
    hashPending(h, '42|cabinet b');
    h.state.choices = [choice('#', '42', true, 'Dr Ronez', 'Cabinet A')];
    h.state.active = '42';
    h.native();
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.navigations.length, 0);
    assert.equal(h.sandbox.location.hash, '');
});

test('une demande invalide est retirée et ne déclenche aucune navigation', () => {
    const h = harness();
    h.sandbox.location.hash = '#tm-mf-open-messages=%invalid';
    h.sandbox.location.href += h.sandbox.location.hash;
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.navigations.length, 0);
    assert.equal(h.sandbox.location.hash, '');
});

test('une messagerie déjà ouverte consomme la demande sans rechargement', () => {
    const h = harness();
    hashPending(h);
    h.sandbox.location.pathname = '/messages';
    h.sandbox.location.href = 'https://pro.madeformed.com/messages' + h.sandbox.location.hash;
    h.state.active = '42';
    h.native();
    assert.equal(h.api.resumeMadeformedMessagingNavigation(), false);
    assert.equal(h.state.navigations.length, 0);
    assert.equal(h.sandbox.location.hash, '');
});
