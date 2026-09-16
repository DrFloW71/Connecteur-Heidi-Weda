const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const directory = path.join(__dirname, '..', 'scripts', 'LM studio');
const files = fs.readdirSync(directory).filter(name => name.endsWith('.user.js'));

function functionSource(source, name) {
  const pattern = new RegExp(`^([ ]+)(?:async )?function ${name}\\(`, 'm');
  const match = pattern.exec(source);
  assert.ok(match, name);
  const start = match.index;
  const end = source.indexOf(`\n${match[1]}}`, start);
  assert.ok(end > start, `fin de ${name}`);
  return source.slice(start, end + match[1].length + 2);
}

function loadExtractor(source) {
  return vm.runInNewContext(`${functionSource(source, 'extractLmStudioAnswer')}; extractLmStudioAnswer`, {
    normalizeMultilineText: value => value.trim(),
    normalizeSpaces: value => value.trim(),
  });
}

function completion(content, finish_reason = 'stop', reasoning_content = 'RAISONNEMENT A NE PAS IMPORTER') {
  return {
    choices: [{ message: { content, reasoning_content }, finish_reason }],
    usage: { completion_tokens: 220, completion_tokens_details: { reasoning_tokens: 217 } },
  };
}

for (const file of files) {
  const source = fs.readFileSync(path.join(directory, file), 'utf8').replace(/\r\n/g, '\n');
  const extract = loadExtractor(source);

  test(`${file}: extrait seulement la réponse finale`, () => {
    assert.equal(extract(completion(' Bilan RAS ')), 'Bilan RAS');
  });
  test(`${file}: refuse la limite atteinte, même avec un titre partiel plausible`, () => {
    for (const text of ['', 'Bilan RAS, CRP']) {
      assert.throws(() => extract(completion(text, 'length')), error => {
        assert.equal(error.code, 'LMSTUDIO_INCOMPLETE_RESPONSE');
        assert.match(error.message, /finish_reason=length.*completion_tokens=220.*reasoning_tokens=217/);
        assert.ok(!error.message.includes('RAISONNEMENT A NE PAS IMPORTER'));
        assert.ok(!error.message.includes('Bilan RAS'));
        return true;
      });
    }
  });
  test(`${file}: refuse un raisonnement sans réponse finale`, () => {
    assert.throws(() => extract(completion('  ')), /raisonnement reçu sans réponse finale/);
  });
  test(`${file}: prend en charge les blocs texte sans les blocs de raisonnement`, () => {
    assert.equal(extract(completion([
      { type: 'reasoning', text: 'NE PAS IMPORTER' },
      { type: 'text', text: 'CRP 2 mg/L' },
      { type: 'output_text', text: 'DFG 95' },
    ])), 'CRP 2 mg/L\nDFG 95');
  });
  test(`${file}: conserve les réponses legacy`, () => {
    assert.equal(extract({ choices: [{ text: 'OK' }] }), 'OK');
  });
  test(`${file}: refuse les réponses absentes ou interrompues`, () => {
    for (const response of [null, {}, { choices: [] }, completion({}, 'stop'), completion('partiel', 'content_filter'), completion('partiel', 'tool_calls')]) {
      assert.throws(() => extract(response), { code: 'LMSTUDIO_INCOMPLETE_RESPONSE' });
    }
  });
  test(`${file}: versions interne et Tampermonkey alignées`, () => {
    const version = source.match(/@version\s+(\S+)/)[1];
    const internal = source.match(/const (?:SCRIPT_VERSION|VERSION_AUTO_ATCD_CIM10_LMSTUDIO) = ["']([^"']+)/)[1];
    assert.equal(internal.split('-')[0], version);
  });
}

test('Copilote: conserve le format output_text', () => {
  const source = fs.readFileSync(path.join(directory, 'Copilote-Weda-LMstudio.user.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(loadExtractor(source)({ output_text: 'OK' }), 'OK');
});

test('CIM10: une sortie tronquée ne déclenche pas une réduction du budget de génération', () => {
  const source = fs.readFileSync(path.join(directory, 'antecedents-cim10-weda-LMstudio-avec-colorisation.user.js'), 'utf8').replace(/\r\n/g, '\n');
  const isContextError = vm.runInNewContext(`${functionSource(source, 'isLmStudioContextLimitError')}; isLmStudioContextLimitError`);
  let error;
  try { loadExtractor(source)(completion('', 'length')); } catch (caught) { error = caught; }
  assert.equal(isContextError(error), false);
  assert.equal(isContextError(new Error('maximum context length exceeded')), true);
});

// Appel réel volontaire, uniquement avec un exemple fictif, sans navigateur ni écriture WEDA.
test('LM Studio local: prompt complet de biologie et transport du script', {
  skip: process.env.WEDA_LMSTUDIO_LIVE !== '1', timeout: 300000,
}, async t => {
  const source = fs.readFileSync(path.join(directory, 'analyse-biologies-weda-LMstudio.user.js'), 'utf8').replace(/\r\n/g, '\n');
  const promptStart = source.indexOf('  const LMSTUDIO_PROMPT_ACTIVE = ');
  const promptEnd = source.indexOf('`;', promptStart) + 2;
  const constants = ['LMSTUDIO_API_BASE_URL', 'LMSTUDIO_CHAT_COMPLETIONS_URL', 'LMSTUDIO_REQUEST_TIMEOUT_MS', 'LMSTUDIO_TEMPERATURE', 'LMSTUDIO_MAX_TOKENS', 'BIOLOGY_SIGNAL']
    .map(name => source.match(new RegExp(`  const ${name} = [^\\n]+`))[0]).join('\n');
  const functions = ['requestLmStudioChatCompletion', 'buildLmStudioUserPrompt', 'stripTrailingBiologySignal', 'buildHeidiContextText', 'gmJsonRequest'];
  const api = vm.runInNewContext(`${constants}\n${source.slice(promptStart, promptEnd)}\n${functions.map(name => functionSource(source, name)).join('\n')}\n({ requestLmStudioChatCompletion, prompt: LMSTUDIO_PROMPT_ACTIVE })`, {
    isAnapathJob: () => false,
    escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    appendDebugLog: () => {},
    GM_xmlhttpRequest: options => {
      fetch(options.url, { method: options.method, headers: options.headers, body: options.data, signal: AbortSignal.timeout(options.timeout) })
        .then(async response => options.onload({ status: response.status, responseText: await response.text() }))
        .catch(() => options.onerror());
    },
  });
  const models = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(12000) }).then(r => r.json());
  assert.ok(models.data?.[0]?.id, 'modèle chargé');
  const response = await api.requestLmStudioChatCompletion({
    id: 'synthetic-connection-test', prompt: api.prompt,
    tableText: 'Cas de test fictif sans identité. CRP : 2 mg/L, normes 0 à 5 mg/L, NORMAL. DFG : 95 mL/min/1,73m², NORMAL.',
  }, models.data[0].id);
  const answer = loadExtractor(source)(response);
  assert.equal(response.choices[0].finish_reason, 'stop');
  assert.match(answer, /CRP.*2/);
  assert.match(answer, /DFG.*95/);
  t.diagnostic(JSON.stringify({ model: models.data[0].id, finishReason: response.choices[0].finish_reason, answer, usage: response.usage }));
});
