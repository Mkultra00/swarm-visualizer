const test = require("node:test"); const assert = require("node:assert/strict");
const V = require("../viz-model.js");
const { readJson, manifest } = require("./helpers.js");

const man = manifest();
const raw = (id) => readJson(`data/runs/${id}.json`); // hudModel only reads label fields
const unknownRun = { schema: "chan-sim-timeline/v1", exam: "drop-1", campaign_stem: "zzzz9999", target_name: "Tiny Lab", events: [] };

test("every manifest run: HUD llm is the manifest llm, never Gemini", () => {
  for (const entry of man.runs) {
    const h = V.hudModel({ manifest: man, entry, run: raw(entry.id) });
    assert.equal(h.llm, entry.llm); assert.doesNotMatch(JSON.stringify(h), /gemini/i);
  }
});

test("crAPI HUD", () => {
  const entry = man.runs.find((r) => r.id === "6bec75ed");
  assert.deepEqual(V.hudModel({ manifest: man, entry, run: raw("6bec75ed") }), { frame: "crAPI", run: "crapi-1 · 6bec75ed", llm: "gpt-oss:20b" });
});

test("dropped crAPI keeps its llm via stem lookup", () => {
  assert.equal(V.hudModel({ manifest: man, entry: null, run: raw("6bec75ed") }).llm, "gpt-oss:20b");
});

test("dropped unknown stem → not in log", () => {
  assert.equal(V.hudModel({ manifest: man, entry: null, run: unknownRun }).llm, "not in log");
});

test("dropped run with agent_llm label", () => {
  assert.equal(V.hudModel({ manifest: man, entry: null, run: { ...unknownRun, agent_llm: "glm-5.3:cloud" } }).llm, "glm-5.3:cloud");
});

test("agent_llm failing the label rule is ignored", () => {
  assert.equal(V.hudModel({ manifest: man, entry: null, run: { ...unknownRun, agent_llm: "http://x" } }).llm, "not in log");
});

test("RUN without stem is just exam; FRAME falls back", () => {
  assert.equal(V.hudModel({ manifest: null, entry: null, run: { exam: "solo" } }).run, "solo");
  assert.equal(V.hudModel({ manifest: null, entry: null, run: {} }).frame, "lab");
  assert.equal(V.hudModel({ manifest: man, entry: man.runs[0], run: { exam: "vaultnotes-7" } }).frame, "Vault Notes");
});

test("brute force: no gemini out without gemini in", () => {
  const mans = [man, null, { runs: [] }];
  const entries = [null, ...man.runs];
  const runs = [raw("6bec75ed"), unknownRun, { ...unknownRun, agent_llm: "glm-5.3:cloud" }, { ...unknownRun, agent_llm: "http://x" }, {}, null];
  for (const m of mans) for (const e of entries) for (const r of runs) {
    const out = JSON.stringify(V.hudModel({ manifest: m, entry: e, run: r }));
    assert.doesNotMatch(out, /gemini/i);
  }
});

test("hudModel ignores any narration sidecar passed alongside", () => {
  const entry = man.runs[4];
  const h = V.hudModel({ manifest: man, entry, run: raw(entry.id), sidecar: { voice_model: "gemini-3.8-live" }, voice_model: "gemini-3.8-live" });
  assert.equal(h.llm, "gpt-oss:20b"); assert.doesNotMatch(JSON.stringify(h), /gemini/i);
});
