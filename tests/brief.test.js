const test = require("node:test"); const assert = require("node:assert/strict");
const A = require("../analyzer.js");
const { readJson } = require("./helpers.js");
const crapi = (llm) => A.analyze(A.validateTimeline(readJson("data/runs/6bec75ed.json")).run, llm);

const GOLDEN = "crAPI / crapi-1 (6bec75ed): 33 events from 8 agents over 780.0 s in a 838.9 s window. Busiest layer proven-gate (17). Coverage: 7 endpoints, 1 finding, 0 verified. AGENT LLM gpt-oss:20b. After-run lab exam; layer plot is not cause-and-effect.";

test("crAPI golden", () => assert.equal(A.brief(crapi("gpt-oss:20b")), GOLDEN));

test("no window clause when window_s is null", () => {
  const a = { ...crapi("gpt-oss:20b"), window_s: null };
  assert.equal(A.brief(a).includes("window"), false);
  assert.ok(A.brief(a).includes("over 780.0 s. Busiest"));
});

test("plurals", () => {
  const base = crapi("gpt-oss:20b");
  for (const [n, w] of [[0, "0 findings"], [1, "1 finding,"], [2, "2 findings"]]) {
    assert.ok(A.brief({ ...base, coverage: { ...base.coverage, findings: n } }).includes(w), w);
  }
  const one = A.brief({ ...base, events: 1, agents: 1 });
  assert.ok(one.includes("1 event from 1 agent over"));
});

test("missing coverage renders —", () => {
  const base = crapi("gpt-oss:20b");
  const b = A.brief({ ...base, coverage: { ...base.coverage, endpoints: null, findings: null, verified: null } });
  assert.ok(b.includes("Coverage: — endpoints, — findings, — verified."), b);
});

test("stem dropped when empty", () => {
  assert.ok(A.brief({ ...crapi("x"), stem: "" }).startsWith("crAPI / crapi-1: 33 events"));
});

test("0 events exact string", () => {
  assert.equal(A.brief(A.analyze({ events: [], target_name: "crAPI", exam: "crapi-1" }, "gpt-oss:20b")),
    "crAPI / crapi-1: no events. AGENT LLM gpt-oss:20b. After-run lab exam.");
});

test("agent ids are never interpolated", () => {
  const a = { ...crapi("gpt-oss:20b"), byAgent: { "<img src=x>": 99 }, byStatus: { "<img src=x>": 1 }, byFindingClass: { "<img src=x>": 1 } };
  assert.equal(A.brief(a).includes("<img"), false);
});

test("no Gemini unless llm says so", () => {
  assert.doesNotMatch(A.brief(crapi("glm-5.3:cloud")), /gemini/i);
  assert.doesNotMatch(A.brief(crapi(undefined)), /gemini/i);
});
