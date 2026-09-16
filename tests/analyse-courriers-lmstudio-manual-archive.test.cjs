const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "LM studio", "analyse-courriers-weda-LMstudio-avec-ATCD.user.js"), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("la surveillance d'archivage réagit aux mutations et expire en trois secondes", async () => {
  const body = functionSource("waitForManualArchiveListChange", "findManualArchiveSnapshotRow");
  let onMutation;
  let disconnected = false;
  let rows = [{ index: 0, key: "a", row: { classList: { contains: () => true } } }];
  const context = {
    Promise,
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    document: { body: {} },
    MANUAL_ARCHIVE_NEXT_MAX_WAIT_MS: 3000,
    manualArchivePendingSequence: 1,
    getBiologyRows: () => rows,
    findManualArchiveSnapshotRow: (_snapshot, current) => current.find((row) => row.key === "a"),
    scheduleBackgroundTask: (callback, delay) => setTimeout(callback, delay),
    cancelBackgroundTask: clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(`${body}\nthis.waitForChange = waitForManualArchiveListChange`, context);
  const start = Date.now();
  const pending = context.waitForChange({ sequence: 1, index: 0, rowCount: 1 });
  rows = [];
  onMutation();
  const result = await pending;
  assert.equal(result.changed, true);
  assert.ok(Date.now() - start < 1000);
  assert.equal(disconnected, true);
  assert.match(source, /const MANUAL_ARCHIVE_NEXT_MAX_WAIT_MS = 3000;/);
  assert.doesNotMatch(body, /await sleep\(250\)/);
});

test("l'autoremplissage patient ne démarre pas pendant l'archivage", () => {
  const patient = functionSource("applyRememberedPatientForSelectedRow", "buildWedaRememberedPatientIdentityHintText");
  const fields = functionSource("applyRememberedDocumentFieldsForSelectedRow", "stabilizeRememberedDocumentFieldsAfterPatientSelection");
  assert.match(patient, /rememberedPatientAutofillInProgress \|\| manualArchivePendingSequence/);
  assert.match(fields, /if \(manualArchivePendingSequence\) \{\s*return false;/);
  assert.match(source, /reason === "remembered-patient-autofill" && manualArchivePendingSequence/);
});
