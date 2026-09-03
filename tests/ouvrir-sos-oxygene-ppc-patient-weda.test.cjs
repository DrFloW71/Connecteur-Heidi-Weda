'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(
    __dirname,
    '..',
    'scripts',
    'ouvrir-sos-oxygene-ppc-patient-weda.user.js'
);
const source = fs.readFileSync(scriptPath, 'utf8');
const windowObject = {
    location: {
        hostname: 'tests.invalid',
        href: 'https://tests.invalid/'
    },
    getComputedStyle: element => element.computedStyle
};
const context = vm.createContext({
    console,
    Date,
    Math,
    URL,
    window: windowObject
});
vm.runInContext(source, context, { filename: scriptPath });

const api = windowObject.WedaSosOxygenePpc;

test('aligne les versions du bandeau et du script', () => {
    assert.equal(api.version, '1.0.9');
    assert.match(source, /@version\s+1\.0\.9/);
    assert.match(
        source,
        /@match\s+https:\/\/oxyweb\.pro\/oxyweb-medecin\/auth-callback\*/
    );
});

test('normalise le NIR et les téléphones français', () => {
    assert.equal(api.normalizeNir('1 84 12 71 123 456 78'), '184127112345678');
    assert.equal(api.normalizePhone('06 12 34 56 78'), '0612345678');
    assert.equal(api.normalizePhone('+33 6 12 34 56 78'), '0612345678');
});

test('normalise la date WEDA sans conserver un âge éventuel', () => {
    assert.equal(api.normalizeBirthDate('5/8/1974 (52 ans)'), '05/08/1974');
    assert.equal(api.normalizeBirthDate('Date inconnue'), '');
});

test('déduit le sexe uniquement depuis une civilité non ambiguë', () => {
    assert.equal(api.getGenderFromCivilite('M.'), 'male');
    assert.equal(api.getGenderFromCivilite('Mme'), 'female');
    assert.equal(api.getGenderFromCivilite('Dr'), '');
});

test('sépare adresse, code postal et ville WEDA', () => {
    const parsed = api.parseAddressText(
        'Adresse patient\n12 RUE DES TESTS\n71118 ST MARTIN B R'
    );
    assert.equal(parsed.address, '12 RUE DES TESTS');
    assert.equal(parsed.postalCode, '71118');
    assert.equal(parsed.city, 'ST MARTIN B R');
});

test('ignore les icônes O et S injectées à côté du titre de l’adresse', () => {
    for (const title of ['Adresse patient O S', 'Adresse patient OS']) {
        const parsed = api.parseAddressText(
            `${title}\n12 RUE DES TESTS\n71118 ST MARTIN B R`
        );
        assert.equal(parsed.address, '12 RUE DES TESTS');
        assert.equal(parsed.postalCode, '71118');
        assert.equal(parsed.city, 'ST MARTIN B R');
    }
});

test('choisit la seconde cellule WEDA quand la première ne contient que O et S', () => {
    const parsed = api.selectBestAddressCandidate([
        'Adresse patient OS',
        'Adresse patient\n62 rue de slilas\n71260 FLEURVILLE'
    ]);
    assert.equal(parsed.address, '62 rue de slilas');
    assert.equal(parsed.postalCode, '71260');
    assert.equal(parsed.city, 'FLEURVILLE');
});

test('ne fabrique aucune partie absente de l’adresse', () => {
    assert.deepEqual(
        JSON.parse(JSON.stringify(api.parseAddressText('Adresse patient\n71118 TESTVILLE'))),
        { address: '', postalCode: '71118', city: 'TESTVILLE' }
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(api.parseAddressText('Adresse patient'))),
        { address: '', postalCode: '', city: '' }
    );
});

test('borne chaque transfert à un identifiant de requête SOS Oxygène', () => {
    assert.equal(api.isValidRequestId('sosoxy_1754380800000_abc123'), true);
    assert.equal(api.isValidRequestId('sosoxy_1754380800000_abc12'), false);
    assert.equal(api.isValidRequestId('orkyn_1754380800000_abc123'), false);
});

test('récupère la demande après auth-callback uniquement via son onglet WEDA récent', () => {
    const now = 1_754_380_800_000;
    const pending = {
        id: 'sosoxy_1754380800000_abc123',
        createdAt: now - 30_000,
        patient: { sourcePatientId: '123456' }
    };

    assert.equal(api.canUseOpenerFallback(pending, true, now), true);
    assert.equal(api.canUseOpenerFallback(pending, false, now), false);
    assert.equal(
        api.canUseOpenerFallback({ ...pending, createdAt: now - 91_000 }, true, now),
        false
    );
    assert.equal(
        api.canUseOpenerFallback({ ...pending, createdAt: now + 1 }, true, now),
        false
    );
    assert.equal(
        api.canUseOpenerFallback({ ...pending, patient: {} }, true, now),
        false
    );
});

test('accepte le véritable input Oxyweb masqué avec une opacité nulle', () => {
    const maskedInput = {
        isConnected: true,
        computedStyle: {
            display: 'block',
            visibility: 'visible',
            opacity: '0'
        },
        getBoundingClientRect: () => ({ width: 242, height: 17 })
    };
    assert.equal(api.isRendered(maskedInput), true);

    maskedInput.computedStyle.display = 'none';
    assert.equal(api.isRendered(maskedInput), false);
});

test('cible les choix SOS exacts et ne contient aucune action de signature', () => {
    for (const marker of [
        'ppcPressionMin',
        'ppcPressionMax',
        'new-dap-treatment-select-type-interface',
        'dap-pathology-checkbox-hasDrowsiness',
        'dap-pathology-checkbox-hasSnoring',
        'dap-pathology-checkbox-hasHeadache',
        'dap-pathology-checkbox-hasFatigue'
    ]) {
        assert.ok(source.includes(marker), `sélecteur manquant : ${marker}`);
    }
    assert.ok(source.includes('window.opener !== null'));
    assert.ok(source.includes('data-weda-sos-oxygene-version'));
    assert.ok(source.includes('findUniqueRenderedElement'));
    assert.ok(!source.includes('dap-button-sign'));
});

test('déclenche l’autocomplétion de ville après le code postal', () => {
    assert.match(source, /new KeyboardEvent\(type/);
    assert.match(
        source,
        /SELECTORS\.sosPostalCode[\s\S]*?\{ emitKeyboardEvents: true \}/
    );
});
