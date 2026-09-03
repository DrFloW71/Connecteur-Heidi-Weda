const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "LM studio",
  "analyse-courriers-weda-LMstudio-avec-ATCD.user.js"
);
const source = fs.readFileSync(scriptPath, "utf8");

function getFunctionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `fonction ${name} introuvable`);
  assert.notEqual(end, -1, `borne ${nextName} introuvable`);
  return source.slice(start, end);
}

test("aligne les versions Tampermonkey et interne", () => {
  const metadataVersion = source.match(/\/\/ @version\s+([^\s]+)/)?.[1];
  const internalVersion = source.match(/const SCRIPT_VERSION = "([^"]+)"/)?.[1];

  assert.equal(metadataVersion, internalVersion);
  assert.equal(metadataVersion, "0.1.59");
});

test("ouvre les antécédents depuis le raccourci patient de la page source", () => {
  const body = getFunctionSource(
    "openWedaAntecedentWorkerViaWedaHelperPatientName",
    "openWedaAntecedentWorkerViaDedicatedPatientSearch"
  );

  assert.match(body, /openMode: "ctrl-click-antecedents"/);
  assert.match(body, /clickWedaHelperPatientNameForAntecedents\(patientLauncher\)/);
  assert.doesNotMatch(body, /buildWedaAtcdWorkerUrl\(location\.href/);
  assert.doesNotMatch(body, /openDedicatedWedaAtcdWorkerTab/);
});

test("le raccourci Weda-Helper reçoit bien un Ctrl+clic", () => {
  const body = getFunctionSource(
    "clickWedaHelperPatientNameForAntecedents",
    "dispatchModifiedMouseEvent"
  );

  assert.match(body, /ctrlKey: true/);
  assert.match(body, /"pointerdown", "mousedown", "pointerup", "mouseup", "click"/);
});

test("seul l'onglet fraîchement ouvert par Weda-Helper peut adopter le job", () => {
  const body = getFunctionSource(
    "adoptPendingWedaAtcdWorkerJobForThisTab",
    "doesWedaAtcdPendingOpenSourceMatchThisTab"
  );

  assert.match(body, /pending\.source !== "pdf-parser-patient-name"/);
  assert.match(body, /WEDA_ATCD_PENDING_ADOPTION_MAX_AGE_MS/);
  assert.match(body, /inheritedClaimMatches/);
  assert.match(body, /sourceReferrerMatches/);
  assert.match(body, /extractWedaPatDkFromUrl\(location\.href\)/);
});

test("ne contient plus le worker Échanges qui attendait un raccourci absent", () => {
  assert.doesNotMatch(source, /openWedaPatientFromDedicatedWedaExchanges/);
  assert.doesNotMatch(source, /le raccourci patient Weda-Helper dans le worker dédié/);
  assert.doesNotMatch(source, /OPENING_PATIENT_IN_DEDICATED_WORKER/);
});
