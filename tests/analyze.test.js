const test = require("node:test"); const assert = require("node:assert/strict");
const A = require("../analyzer.js");
const { readJson } = require("./helpers.js");

const runOf = (rel) => { const r = A.validateTimeline(readJson(rel)); assert.equal(r.ok, true); return r.run; };
const close = (a, b, eps, m) => assert.ok(Math.abs(a - b) < eps, `${m}: ${a} vs ${b}`);

test("crAPI golden (§3.3), read from the real data file", () => {
  const a = A.analyze(runOf("data/runs/6bec75ed.json"), "gpt-oss:20b");
  assert.equal(a.frame, "crAPI"); assert.equal(a.run, "crapi-1"); assert.equal(a.stem, "6bec75ed");
  assert.equal(a.llm, "gpt-oss:20b");
  assert.equal(a.events, 33); assert.equal(a.agents, 8);
  close(a.span_s, 780.049, 1e-9, "span_s"); close(a.window_s, 838.943, 1e-9, "window_s");
  assert.deepEqual(a.byLayer, { human: 1, recon: 7, scope: 4, "proven-gate": 17, publish: 4 });
  assert.deepEqual(Object.keys(a.byLayer), ["human", "recon", "scope", "proven-gate", "publish"]);
  assert.deepEqual(a.byAgent, { engine: 2, memory: 1, classifier: 3, orchestrator: 1, recon: 7, exploit: 17, scheduler: 1, report: 1 });
  assert.deepEqual(Object.keys(a.byAgent), ["engine", "memory", "classifier", "orchestrator", "recon", "exploit", "scheduler", "report"]);
  assert.deepEqual(a.byStatus, { event: 1, state: 2, milestone: 2, thought: 1, call: 4, tool_call: 9, tool_result: 9, publish: 4, started: 1 });
  assert.deepEqual(a.byFindingClass, { none: 30, nuclei: 3 });
  assert.equal(a.offLayer, 0); assert.equal("unknown" in a.byLayer, false);
  assert.equal(a.busiestLayer, "proven-gate");
  assert.deepEqual(a.coverage, { endpoints: 7, findings: 1, verified: 0, unverified: 1, confidence: "medium", reached: true, blocked: false });
  assert.deepEqual(a.warnings, []);
});

test("tiny: off-layer counted under unknown", () => {
  const a = A.analyze(runOf("tests/fixtures/tiny.json"));
  assert.equal(a.offLayer, 1); assert.equal(a.byLayer.unknown, 1);
  assert.deepEqual(Object.keys(a.byLayer), ["human", "recon", "scope", "proven-gate", "publish", "unknown"]);
  assert.equal(a.byLayer["proven-gate"], 0);
  assert.equal(a.byFindingClass.misc, 1);
  assert.equal(a.llm, "not in log");
  assert.equal(a.span_s, 30.5);
  assert.equal(a.window_s, 60);
});

test("empty events", () => {
  const a = A.analyze({ events: [] });
  assert.equal(a.events, 0); assert.equal(a.agents, 0); assert.equal(a.span_s, 0); assert.equal(a.busiestLayer, null);
  assert.equal(a.frame, "lab"); assert.equal(a.run, "run"); assert.equal(a.stem, "");
  assert.equal(a.window_s, null);
});

test("busiest-layer tie goes to the earlier layer", () => {
  const ev = (layer, i) => ({ ts: "", agent_id: "a", role: "r", layer, status: "s", finding_class: null, _t: i });
  const a = A.analyze({ events: [ev("publish", 1), ev("recon", 2), ev("publish", 3), ev("recon", 4)] });
  assert.equal(a.busiestLayer, "recon");
});

test("missing coverage → all null", () => {
  const r = runOf("tests/fixtures/tiny.json"); delete r.coverage;
  assert.deepEqual(A.analyze(r).coverage, { endpoints: null, findings: null, verified: null, unverified: null, confidence: null, reached: null, blocked: null });
});

test("invalid window timestamps → window_s null", () => {
  const r = runOf("tests/fixtures/tiny.json"); r.started_at = "yesterday";
  assert.equal(A.analyze(r).window_s, null);
});
