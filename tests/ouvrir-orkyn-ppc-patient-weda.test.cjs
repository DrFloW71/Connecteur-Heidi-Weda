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
    'ouvrir-orkyn-ppc-patient-weda.user.js'
);
const source = fs.readFileSync(scriptPath, 'utf8');
const windowObject = {
    location: {
        hostname: 'tests.invalid',
        href: 'https://tests.invalid/'
    }
};
const context = vm.createContext({
    console,
    Date,
    Math,
    URL,
    window: windowObject
});
vm.runInContext(source, context, { filename: scriptPath });

const api = windowObject.WedaOrkynPpc;

test('expose la version et les fonctions de test', () => {
    assert.equal(api.version, '1.0.1');
    assert.equal(typeof api.parseAddressText, 'function');
});

test('normalise le NIR et les téléphones français', () => {
    assert.equal(api.normalizeNir('1 84 12 71 123 456 78'), '184127112345678');
    assert.equal(api.normalizePhone('06 12 34 56 78'), '0612345678');
    assert.equal(api.normalizePhone('+33 6 12 34 56 78'), '0612345678');
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

test('accepte une adresse WEDA réduite à la localité', () => {
    const parsed = api.parseAddressText('Adresse patient\n71118 ST MARTIN B R');
    assert.equal(parsed.address, '');
    assert.equal(parsed.postalCode, '71118');
    assert.equal(parsed.city, 'ST MARTIN B R');
});

test('ne fabrique pas de localité quand WEDA ne la fournit pas', () => {
    const parsed = api.parseAddressText('Adresse patient\n4 IMPASSE DES TESTS');
    assert.equal(parsed.address, '4 IMPASSE DES TESTS');
    assert.equal(parsed.postalCode, '');
    assert.equal(parsed.city, '');
});
