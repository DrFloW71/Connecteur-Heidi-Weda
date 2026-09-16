const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../scripts/LM studio/analyse-courriers-weda-LMstudio-avec-ATCD.user.js'), 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  const end = source.indexOf('\n  }', match.index);
  assert.ok(end > match.index);
  return source.slice(match.index, end + 4);
}
function load(names, globals = {}) {
  return vm.runInNewContext(`let cachedLmStudioModelId = 'ancien-modele';\n${['isLmStudioBlockingError', 'createLmStudioServiceError', ...names].map(fn).join('\n')}\n({${names.join(',')}, createLmStudioServiceError, getCache: () => cachedLmStudioModelId})`, {
    LMSTUDIO_MODEL: '', LMSTUDIO_MODELS_URL: 'http://localhost:1234/v1/models',
    LMSTUDIO_REQUEST_TIMEOUT_MS: 300000, appendDebugLog: () => {}, ...globals,
  });
}

test('courriers: revalide le modèle, refuse une liste vide et récupère après rechargement', async () => {
  let models = [{ id: 'modele-actif' }];
  let calls = 0;
  const api = load(['getLmStudioModelId'], { gmJsonRequest: async () => { calls++; return { data: models }; } });
  assert.equal(await api.getLmStudioModelId(), 'modele-actif');
  models = [];
  await assert.rejects(api.getLmStudioModelId(), /aucun modèle disponible/);
  assert.equal(api.getCache(), '');
  models = [{ id: 'modele-recharge' }];
  assert.equal(await api.getLmStudioModelId(), 'modele-recharge');
  assert.equal(calls, 3);
});

test('courriers: ne remplace pas un modèle explicite absent par un autre', async () => {
  const api = load(['getLmStudioModelId'], { LMSTUDIO_MODEL: 'attendu', gmJsonRequest: async () => ({ data: [{ id: 'autre' }] }) });
  await assert.rejects(api.getLmStudioModelId(), /modèle configuré/);
});

test('courriers: HTTP terminated et No models loaded deviennent des erreurs bloquantes', async () => {
  for (const body of ['{"error":"terminated"}', '{"error":{"message":"No models loaded"}}']) {
    const api = load(['gmJsonRequest'], { GM_xmlhttpRequest: options => options.onload({ status: 400, responseText: body }) });
    await assert.rejects(api.gmJsonRequest({}), error => {
      assert.equal(error.code, 'LMSTUDIO_SERVICE_UNAVAILABLE');
      assert.match(error.message, /moteur interrompu ou modèle déchargé/);
      assert.equal(api.getCache(), '');
      return true;
    });
  }
});

test('courriers: panne réseau, délai dépassé et JSON invalide interrompent le traitement', async () => {
  for (const trigger of [o => o.onerror(), o => o.ontimeout(), o => o.onabort(), o => o.onload({ status: 200, responseText: '<html>indisponible</html>' })]) {
    const api = load(['gmJsonRequest'], { GM_xmlhttpRequest: trigger });
    await assert.rejects(api.gmJsonRequest({}), { code: 'LMSTUDIO_SERVICE_UNAVAILABLE' });
  }
});

test('courriers: les erreurs HTTP ne recopient pas une réponse serveur potentiellement sensible', async () => {
  const api = load(['gmJsonRequest'], { GM_xmlhttpRequest: o => o.onload({ status: 500, responseText: 'CONTENU A NE PAS JOURNALISER' }) });
  await assert.rejects(api.gmJsonRequest({}), error => !error.message.includes('CONTENU A NE PAS JOURNALISER'));
});

test('courriers: la recherche ne transforme pas une panne en identité absente', async () => {
  const outage = Object.assign(new Error('moteur interrompu'), { code: 'LMSTUDIO_SERVICE_UNAVAILABLE' });
  const api = load(['resolveWedaFindPatientSearchIdentity'], {
    extractWedaFindPatientIdentityHeuristically: () => ({}), hasUsableWedaFindPatientIdentity: () => false,
    getLmStudioPdfPageImages: () => [{}], requestLmStudioPatientIdentity: async () => { throw outage; },
  });
  await assert.rejects(api.resolveWedaFindPatientSearchIdentity({ sourceText: 'exemple fictif' }), error => error === outage);
});

test('courriers: arrêt sur la même ligne sans marquage traité ni relance automatique', () => {
  for (const mode of ['auto', 'manual']) {
    let state = { mode, running: true, autoEnabled: true, currentIndex: 5, currentStableKey: 'fictif' };
    let failure = '';
    const api = load(['skipOrFailCurrentDocument'], {
      getState: () => state, isWorkflowStopped: () => false,
      setState: patch => { state = { ...state, ...patch }; }, failWeda: message => { failure = message; },
      // Toute tentative de passer au document suivant ou de marquer la ligne fait échouer ce test.
      markRowSeen: () => assert.fail('document marqué'), findNextManualRowIndex: () => assert.fail('ligne suivante'),
      isRetryableWedaDocumentFailure: () => assert.fail('erreur classée comme problème de document'),
    });
    api.skipOrFailCurrentDocument('panne LM Studio', { code: 'LMSTUDIO_SERVICE_UNAVAILABLE' });
    assert.equal(state.currentIndex, 5);
    assert.equal(state.autoEnabled, false);
    assert.equal(state.autoNextCheckAt, null);
    assert.equal(failure, 'panne LM Studio');
  }
});

test('courriers: un plantage en vision ne produit pas un faux résultat PDF illisible', async () => {
  const api = load(['runLmStudioJob'], {
    LMSTUDIO_CHAT_COMPLETIONS_URL: 'http://localhost:1234/v1/chat/completions', JOB_KEY: 'job',
    updateLmStudioStatus: () => {}, countBiologyLinesForLog: () => 1,
    getLmStudioPdfPageImages: () => [{}], getLmStudioModelId: async () => 'modele',
    requestLmStudioChatCompletion: async () => { throw Object.assign(new Error('terminated'), { code: 'LMSTUDIO_SERVICE_UNAVAILABLE' }); },
    buildLmStudioErrorMessage: error => error.message, GM_deleteValue: () => {},
    buildUnusablePdfLocalResultFromLmStudioImageJob: () => assert.fail('faux résultat local'),
  });
  const result = await api.runLmStudioJob({ id: 'fictif', rowIndex: 5, tableText: '', sourceType: 'pdf-image' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'LMSTUDIO_SERVICE_UNAVAILABLE');
  assert.equal(result.rowIndex, 5);
});

test('courriers: lecture réelle d’une image fictive via le transport du script', {
  skip: process.env.WEDA_LMSTUDIO_VISION_LIVE !== '1', timeout: 180000,
}, async t => {
  const api = load(['gmJsonRequest', 'getLmStudioModelId', 'extractLmStudioAnswer'], {
    normalizeMultilineText: value => value.trim(),
    GM_xmlhttpRequest: options => {
      fetch(options.url, { method: options.method, headers: options.headers, body: options.data, signal: AbortSignal.timeout(options.timeout) })
        .then(async response => options.onload({ status: response.status, responseText: await response.text() }))
        .catch(() => options.onerror());
    },
  });
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/lmstudio-vision-synthetic.png')).toString('base64');
  const model = await api.getLmStudioModelId();
  for (const imageCount of [1, 4, 0]) {
    const content = imageCount ? [{ type: 'text', text: 'Recopie uniquement le code de controle commun aux pages.' }, ...Array.from({ length: imageCount }, () => ({ type: 'image_url', image_url: { url: dataUrl } }))] : 'Réponds uniquement OK.';
    const response = await api.gmJsonRequest({ method: 'POST', url: 'http://localhost:1234/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ model, temperature: 0, max_tokens: 8192, stream: false, messages: [{ role: 'user', content }] }) });
    const answer = api.extractLmStudioAnswer(response);
    assert.match(answer, imageCount ? /VISION-742/ : /^OK[.!]?$/);
    assert.equal(response.choices[0].finish_reason, 'stop');
    assert.equal(await api.getLmStudioModelId(), model, 'modèle toujours disponible');
    t.diagnostic(JSON.stringify({ model, imageCount, answer, finishReason: response.choices[0].finish_reason }));
  }
});
