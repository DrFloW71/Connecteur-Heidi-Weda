const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(
  __dirname,
  "../scripts/LM studio/analyse-courriers-weda-LMstudio-avec-ATCD.user.js"
), "utf8").replace(/\r\n/g, "\n");

function fn(name) {
  const match = new RegExp("^  (?:async )?function " + name + "\\(", "m").exec(source);
  assert.ok(match, name);
  const end = source.indexOf("\n  }", match.index);
  assert.ok(end > match.index, name);
  return source.slice(match.index, end + 4);
}

test("un NON avec courrier lisible déclenche une seconde lecture, pas un OUI valide", () => {
  const api = vm.runInNewContext(
    fn("shouldRecheckLmStudioAntecedent") + "\nshouldRecheckLmStudioAntecedent",
    {
      getLmStudioPdfPageImages: job => job.pdfPageImages || [],
      normalizePdfText: value => String(value || "").trim(),
    }
  );
  assert.equal(api({ tableText: "Compte rendu médical" }, { status: "NON" }), true);
  assert.equal(api({ pdfPageImages: [{ dataUrl: "data:image/png;base64,AA" }] }, { status: "NON" }), true);
  assert.equal(api({ tableText: "Compte rendu médical" }, { status: "OUI" }), false);
  assert.equal(api({}, { status: "NON" }), false);
});

test("la seconde lecture n'accepte un OUI qu'avec diagnostic codé et justification", async () => {
  const requests = [];
  let candidate = { declaredStatus: "OUI", status: "OUI", label: "Lésion confirmée", code: "M00", certainty: "confirmée", source: "lésion confirmée" };
  const api = vm.runInNewContext(
    fn("recheckLmStudioAntecedent") + "\nrecheckLmStudioAntecedent",
    {
      LMSTUDIO_ANTECEDENT_RECHECK_PROMPT: "Cherche un diagnostic certain.",
      LMSTUDIO_CHAT_COMPLETIONS_URL: "http://localhost:1234/v1/chat/completions",
      LMSTUDIO_REQUEST_TIMEOUT_MS: 300000,
      LMSTUDIO_TEMPERATURE: 0,
      LMSTUDIO_MAX_TOKENS: 8192,
      getLmStudioPdfPageImages: job => job.pdfPageImages || [],
      truncateLmStudioDocumentText: value => value,
      gmJsonRequest: async request => { requests.push(JSON.parse(request.data)); return {}; },
      extractLmStudioAnswer: () => "<ANTECEDENT_CIM10>STATUT: OUI</ANTECEDENT_CIM10>",
      extractTaggedBlock: () => "STATUT: OUI",
      parseLmStudioAntecedentBlock: () => candidate,
      appendDebugLog: () => {},
      isLikelyCim10Code: () => true,
    }
  );
  const previous = { status: "NON" };
  assert.equal(await api({ id: "fictif", tableText: "Courrier fictif" }, "modele", previous), candidate);
  assert.match(requests[0].messages[1].content, /Courrier fictif/);
  assert.match(requests[0].messages[0].content, /uniquement avec le bloc/);
  candidate = { ...candidate, source: "" };
  assert.equal(await api({ id: "fictif", tableText: "Courrier fictif" }, "modele", previous), previous);
  candidate = { declaredStatus: "NON", status: "NON" };
  assert.equal(await api({ id: "fictif", tableText: "Courrier fictif" }, "modele", previous), previous);
});

test("une réponse de contrôle inutilisable arrête le courrier pour éviter une perte silencieuse", async () => {
  const api = vm.runInNewContext(
    fn("recheckLmStudioAntecedent") + "\nrecheckLmStudioAntecedent",
    {
      LMSTUDIO_ANTECEDENT_RECHECK_PROMPT: "Vérifie.",
      LMSTUDIO_CHAT_COMPLETIONS_URL: "http://localhost:1234/v1/chat/completions",
      LMSTUDIO_REQUEST_TIMEOUT_MS: 300000,
      LMSTUDIO_TEMPERATURE: 0,
      LMSTUDIO_MAX_TOKENS: 8192,
      getLmStudioPdfPageImages: () => [],
      truncateLmStudioDocumentText: value => value,
      gmJsonRequest: async () => ({}),
      extractLmStudioAnswer: () => "Réponse sans bloc",
      extractTaggedBlock: () => "",
      parseLmStudioAntecedentBlock: () => ({ declaredStatus: "" }),
      appendDebugLog: () => {},
    }
  );
  await assert.rejects(api({ id: "fictif", tableText: "Courrier fictif" }, "modele"), {
    code: "LMSTUDIO_ATCD_RECHECK_UNAVAILABLE",
  });
});

test("l'ouverture dédiée doit renvoyer un onglet Tampermonkey", () => {
  const api = vm.runInNewContext(
    fn("openDedicatedWedaAtcdWorkerTab") + "\nopenDedicatedWedaAtcdWorkerTab",
    { GM_openInTab: () => null, appendDebugLog: () => {}, hashString: () => "x" }
  );
  assert.throws(() => api("job", "https://secure.weda.fr/FolderMedical/FindPatient", "test"), /n'a pas confirmé/);
});

test("sans contexte patient, une proposition OUI passe par la recherche dédiée", async () => {
  let dedicatedCalls = 0;
  const api = vm.runInNewContext(
    fn("openWedaAntecedentWorkerIfNeeded") + "\nopenWedaAntecedentWorkerIfNeeded",
    {
      normalizeHeidiAntecedentForWeda: () => ({ label: "Lésion confirmée", code: "M00" }),
      findWedaPatientContextForCurrentMessage: () => ({ source: "not-found" }),
      findWedaHelperPatientNameLauncher: () => null,
      resolveWedaAntecedentWorkerPatientIdentity: async () => ({ familyName: "TEST", givenName: "Alice", searchLabel: "TEST Alice" }),
      hasUsableWedaFindPatientIdentity: () => true,
      openWedaAntecedentWorkerViaDedicatedPatientSearch: () => { dedicatedCalls++; return true; },
      appendDebugLog: () => {},
    }
  );
  const opened = await api({ jobId: "fictif", antecedent: { status: "OUI" } }, "Titre");
  assert.equal(opened, true);
  assert.equal(dedicatedCalls, 1);
});
