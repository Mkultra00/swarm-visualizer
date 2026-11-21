const test = require("node:test"); const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path");
const A = require("../analyzer.js");
const { ROOT, readJson, manifest } = require("./helpers.js");

// Local stub until T17 lands; replaced by the real A.isGeminiWorker afterwards.
const isGeminiWorker = A.isGeminiWorker || ((id) => /^gemini-/i.test(String(id)));

// Run files that the gate rejects today and that must be re-exported on the lab side.
// They are NOT hand-edited here (§2.3 [DECISION], T7). The exact rule/path list is pinned so that
// (a) any new leak fails this test, and (b) a fixed re-export also fails it, prompting removal of the entry.
const KNOWN_REJECTED = {
  "7c2756ff": [{ path: "report_stem", rule: "ipv4" }, { path: "target_host", rule: "ipv4" }],
};

const PINNED = [
  ["7b5ee689", "Vault Notes", "glm-5.3:cloud"],
  ["7c2756ff", "Vault Notes", "glm-5.3:cloud"],
  ["28bdd7b7", "Vault Notes", "glm-5.3:cloud"],
  ["7eaf9541", "Juice Shop", "gpt-oss:20b"],
  ["6bec75ed", "crAPI", "gpt-oss:20b"],
];

test("manifest schema", () => assert.equal(manifest().schema, "swarm-visualizer/manifest/v1"));

test("five ids, frames and llm values pinned (§2.2)", () => {
  assert.deepEqual(manifest().runs.map((r) => [r.id, r.frame, r.llm]), PINNED);
});

for (const entry of manifest().runs) {
  test(`entry ${entry.id}: file path, gate, stem, frame, run`, () => {
    assert.match(entry.id, /^[A-Za-z0-9_-]{1,32}$/);
    assert.match(entry.file, /^data\/runs\/[A-Za-z0-9_-]+\.json$/);
    assert.equal(entry.file.includes(".."), false);
    assert.ok(fs.existsSync(path.join(ROOT, entry.file)));
    const raw = readJson(entry.file);
    const r = A.validateTimeline(raw);
    if (KNOWN_REJECTED[entry.id]) {
      assert.equal(r.ok, false, `${entry.id} now passes the gate: remove it from KNOWN_REJECTED`);
      assert.deepEqual(r.errors, KNOWN_REJECTED[entry.id]);
    } else {
      assert.equal(r.ok, true, JSON.stringify(r.errors));
    }
    // Label fields are compared on the raw file so the rejected entry is still checked.
    assert.equal(entry.id, raw.campaign_stem);
    assert.equal(entry.frame, raw.target_name);
    assert.equal(entry.run, raw.exam);
    if ("billing" in entry) assert.ok(["local", "api"].includes(entry.billing));
  });
}

test("no manifest llm is a Gemini worker", () => {
  for (const e of manifest().runs) assert.equal(isGeminiWorker(e.llm), false, e.llm);
});

test("no orphan run files", () => {
  const listed = new Set(manifest().runs.map((r) => r.file));
  for (const f of fs.readdirSync(path.join(ROOT, "data/runs"))) assert.ok(listed.has(`data/runs/${f}`), f);
});
