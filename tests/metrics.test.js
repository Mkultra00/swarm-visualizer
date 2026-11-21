const test = require("node:test"); const assert = require("node:assert/strict");
const A = require("../analyzer.js");
const { readJson } = require("./helpers.js");

test("isGeminiWorker true/false table", () => {
  assert.equal(A.isGeminiWorker("gemini-4-carbon"), true);
  assert.equal(A.isGeminiWorker("gemini-3.8-live"), true);
  assert.equal(A.isGeminiWorker("gemini-decision-1"), true);
  for (const x of ["glm-5.3:cloud", "gpt-oss:20b", "Gemini", "gemini", "not in log", "my-gemini-run", "gemini-", "", null]) {
    assert.equal(A.isGeminiWorker(x), false, String(x));
  }
});

test("crAPI runMetrics golden", () => {
  const v = A.validateTimeline(readJson("data/runs/6bec75ed.json"));
  const a = A.analyze(v.run, "gpt-oss:20b");
  const m = A.runMetrics(v.run, a);
  assert.ok(Math.abs(m.t_first_publish - 132.849) < 1e-3);
  assert.ok(Math.abs(m.t_first_proven_gate - 132.849) < 1e-3);
  assert.ok(Math.abs(m.events_per_min - 33 / (838.943 / 60)) < 1e-3);
  assert.equal(m.layerShare.human, 1 / 33);
  assert.equal(m.layerShare["proven-gate"], 17 / 33);
});

test("costOf five current runs all null usd", () => {
  const man = readJson("data/manifest.json");
  for (const e of man.runs) {
    const v = A.validateTimeline(readJson(e.file));
    if (!v.ok) continue;
    const a = A.analyze(v.run, e.llm);
    const c = A.costOf(v.run, e, a.coverage.verified);
    assert.equal(c.usd, null);
    assert.equal(c.tokens_in, null);
    assert.equal(c.tokens_out, null);
    assert.equal(c.usd_per_verified, null);
  }
});

test("costOf local billing is zero API dollars", () => {
  const c = A.costOf({}, { billing: "local" }, 0);
  assert.equal(c.usd, 0);
  assert.equal(c.basis, "local-not-billed");
  assert.equal(c.usd_per_verified, null);
});

test("analyzer.js has no price constant", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../analyzer.js"), "utf8");
  assert.doesNotMatch(src, /price|per_?1[km]|per_?million/i);
});

test("crAPI narrationScript golden", () => {
  const v = A.validateTimeline(readJson("data/runs/6bec75ed.json"));
  const a = A.analyze(v.run, "gpt-oss:20b");
  const m = A.runMetrics(v.run, a);
  const s = A.narrationScript(a, m);
  assert.equal(s, "crAPI, crapi-1. This is an after-run replay of a lab exam, not a live attack. The agent LLM for this run was gpt-oss:20b. 8 agents produced 33 events over a 839-second window. Each row is one agent; each column is a stage, from human on the left to publish on the right. Most activity was in the proven-gate stage, with 17 events. The first publish came 133 seconds in. Coverage: 7 endpoints, 1 finding, 0 verified. Nearby dots are not proof that the agents coordinated.");
  assert.doesNotMatch(s, /gemini/i);
});
