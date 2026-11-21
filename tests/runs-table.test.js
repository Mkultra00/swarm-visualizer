const test = require("node:test"); const assert = require("node:assert/strict");
const A = require("../analyzer.js");
const V = require("../viz-model.js");
const { readJson, manifest } = require("./helpers.js");

test("crAPI runRow golden", () => {
  const man = manifest();
  const entry = man.runs.find((r) => r.id === "6bec75ed");
  const v = A.validateTimeline(readJson(entry.file));
  const hud = V.hudModel({ manifest: man, entry, run: v.run });
  const analysis = A.analyze(v.run, hud.llm);
  const metrics = A.runMetrics(v.run, analysis);
  const cost = A.costOf(v.run, entry, analysis.coverage.verified);
  const row = V.runRow({ entry, run: v.run, analysis, metrics, cost });
  assert.equal(row.frame, "crAPI");
  assert.equal(row.run, "crapi-1");
  assert.equal(row.stem, "6bec75ed");
  assert.equal(row.events, 33);
  assert.equal(row.agents, 8);
  assert.ok(Math.abs(row.window_s - 838.943) < 1e-3);
  assert.ok(Math.abs(row.t_first_publish - 132.849) < 1e-3);
  assert.equal(row.endpoints, 7);
  assert.equal(row.verified, 0);
  assert.equal(row.llm, "gpt-oss:20b");
  assert.equal(row.usd, null);
  assert.equal(row.href, "#run=6bec75ed");
  assert.equal(V.formatCell("window_s", row.window_s), "838.9");
  assert.equal(V.formatCell("t_first_publish", row.t_first_publish), "132.8");
  assert.equal(V.formatCell("usd", row.usd), "");
  assert.doesNotMatch(JSON.stringify(row), /gemini/i);
});

test("parseRunHash", () => {
  const man = manifest();
  assert.equal(V.parseRunHash("#run=6bec75ed", man).id, "6bec75ed");
  assert.equal(V.parseRunHash("#run=nope", man), null);
  assert.equal(V.parseRunHash("run=6bec75ed", man), null);
});

test("EXPLAINER and LAYER_EXPLAIN are frozen, after-run, no technique words", () => {
  assert.ok(Object.isFrozen(V.EXPLAINER));
  assert.ok(Object.isFrozen(V.LAYER_EXPLAIN));
  const blob = V.EXPLAINER.join(" ") + " " + Object.values(V.LAYER_EXPLAIN).join(" ");
  assert.match(blob, /after-run/);
  assert.doesNotMatch(blob, /\b(payload|inject\w*|sqli|xss|rce|shell|bypass|exploit\w*|cve)\b/i);
  for (const s of [...V.EXPLAINER, ...Object.values(V.LAYER_EXPLAIN)]) {
    assert.deepEqual(A.scanForbidden(s), []);
  }
});
