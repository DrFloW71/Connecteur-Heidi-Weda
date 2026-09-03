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

test("utilise le onchange WEDA avant le postback direct de secours", () => {
  const body = getFunctionSource(
    "triggerWedaFindPatientModePostBack",
    "waitForWedaFindPatientPostBackIdle"
  );

  assert.ok(body.indexOf('new Event("change"') < body.indexOf("callWedaPostBack"));
  assert.match(body, /return "change-event"/);
  assert.match(body, /return "direct-postback-fallback"/);
});

test("attend un tableau patient rafraîchi avant de scorer les résultats", () => {
  const body = getFunctionSource(
    "waitForWedaFindPatientSearchSelection",
    "pruneWedaFindPatientRescueAttemptKeys"
  );

  assert.match(body, /previousGrid/);
  assert.match(body, /grid !== previousGrid/);
  assert.match(body, /WEDA_FIND_PATIENT_STALE_RESULT_GUARD_MS/);
});

test("reconnaît l'identifiant actuel du lien patient WEDA", () => {
  const body = getFunctionSource(
    "buildWedaFindPatientGridCandidate",
    "resolveWedaFindPatientGridSelection"
  );

  assert.match(body, /LinkButtonPatientGetNomPrenom/);
});

test("accepte un prénom composé raccourci seulement avec nom et naissance concordants", () => {
  const body = getFunctionSource(
    "scoreWedaFindPatientGridCandidate",
    "buildWedaFindPatientIssue"
  );

  const scoreCandidate = new Function(`
    const normalizePatientCompareText = (value) => {
      const text = String(value || "")
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
      return text ? \` \${text} \` : " ";
    };
    const parsePatientImportName = () => ({ familyName: "", givenName: "" });
    ${body}
    return scoreWedaFindPatientGridCandidate;
  `)();

  const result = scoreCandidate({
    patientLabel: "DUPONT JEAN",
    birthDate: "01/02/1950",
    nameParts: { familyName: "DUPONT JEAN", givenName: "" },
  }, {
    familyName: "DUPONT",
    givenName: "JEAN-LUC",
    searchLabel: "DUPONT JEAN-LUC",
    birthDate: "01/02/1950",
  });

  assert.equal(result.birthDateMatch, true);
  assert.equal(result.strongNameMatch, true);
  assert.ok(result.value >= 1820);
});

test("n'émet qu'un seul clic sur les contrôles WEDA", () => {
  const body = getFunctionSource(
    "clickButtonLikeUser",
    "extractHeidiAnswerFromAskContent"
  );

  assert.doesNotMatch(body, /\["mousedown", "mouseup", "click"\]/);
  assert.equal((body.match(/button\.click\(\)/g) || []).length, 1);
});

test("remet les échecs de recherche patient en attente automatique", () => {
  const body = getFunctionSource(
    "skipOrFailCurrentDocument",
    "isStructuredHprimTableText"
  );

  assert.match(body, /isRetryableWedaDocumentFailure\(message\)/);
  assert.match(body, /unmarkRowSeen\(currentRowKey\)/);
  assert.match(body, /Courrier conservé pour un nouvel essai au prochain cycle/);
  assert.match(body, /remainingAutoTargetKeys/);
});

test("retente aussi une sélection patient sans apparition du titre", () => {
  const body = getFunctionSource(
    "isRetryableWedaDocumentFailure",
    "releaseRetryablePatientFailuresFromSeenRows"
  );

  assert.match(body, /champ titre indisponible apres ouverture un patient/);
});

test("libère aussi les anciens échecs encore présents dans le journal", () => {
  const body = getFunctionSource(
    "releaseRetryablePatientFailuresFromSeenRows",
    "saveSeenRowMap"
  );

  assert.match(body, /DEBUG_LOG_KEY/);
  assert.match(body, /weda:skip-\(\?:auto\|manual\)-document/);
  assert.match(body, /unmarkRowSeen\(rowKey\)/);
});
