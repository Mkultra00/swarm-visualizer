const test = require("node:test"); const assert = require("node:assert/strict");
const A = require("../analyzer.js");
const { readJson, clone } = require("./helpers.js");

const has = (errs, path, rule) => errs.some((e) => e.path === path && e.rule === rule);

test("crAPI validates, 33 events, numeric _t", () => {
  const r = A.validateTimeline(readJson("data/runs/6bec75ed.json"));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.run.events.length, 33);
  for (const e of r.run.events) assert.equal(typeof e._t, "number");
});

test("tiny: sorted by _t, stable on equal ts", () => {
  const r = A.validateTimeline(readJson("tests/fixtures/tiny.json"));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const ts = r.run.events.map((e) => e._t);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  assert.deepEqual(r.run.events.map((e) => e.agent_id), ["alpha", "beta", "alpha", "beta"]);
  assert.equal(r.run.events[1].layer, "recon"); // original index 0 stays before original index 2
  assert.equal(r.run.events[3]._t, Date.UTC(2026, 0, 1, 0, 0, 40, 500));
});

test("input object is not mutated", () => {
  const src = readJson("tests/fixtures/tiny.json"); const before = JSON.stringify(src);
  A.validateTimeline(src);
  assert.equal(JSON.stringify(src), before);
});

test("wrong schema rejected", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.schema = "chan-sim-timeline/v2";
  const r = A.validateTimeline(o);
  assert.equal(r.ok, false); assert.ok(has(r.errors, "schema", "schema")); assert.equal(r.run, undefined);
});

test("extra event key rejected", () => {
  const r = A.validateTimeline(readJson("tests/fixtures/extra-field.json"));
  assert.equal(r.ok, false); assert.ok(has(r.errors, "events[0].payload", "event-keys"), JSON.stringify(r.errors));
});

test("missing event key rejected", () => {
  const o = readJson("tests/fixtures/tiny.json"); delete o.events[1].role;
  const r = A.validateTimeline(o);
  assert.equal(r.ok, false); assert.ok(has(r.errors, "events[1].role", "event-keys"), JSON.stringify(r.errors));
});

test("bad ts rejected", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.events[2].ts = "2026-01-01 00:00:30";
  const r = A.validateTimeline(o);
  assert.equal(r.ok, false); assert.ok(has(r.errors, "events[2].ts", "ts"));
});

test("events not an array rejected", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.events = {};
  assert.ok(has(A.validateTimeline(o).errors, "events", "events"));
  assert.equal(A.validateTimeline(null).ok, false);
});

test("event_count mismatch is a warning only", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.event_count = 99;
  const r = A.validateTimeline(o);
  assert.equal(r.ok, true); assert.ok(r.warnings.length >= 1);
});

test("unused top-level fields are dropped from the normalized run", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.pheromone_board_dump = { a: 1 };
  const r = A.validateTimeline(o);
  assert.equal("pheromone_board_dump" in r.run, false);
  assert.equal("sanitize" in r.run, false);
});

// ---- T3: sanitize gate ----
// Dirty strings are assembled at runtime so this file itself passes the repo-hygiene scan.
const J = (...p) => p.join("");
const CASES = [
  // [rule, dirty, near-miss]
  ["ipv4", J("seen 192.0.2", ".10 today"), "version 1.2.3 today"],
  ["ipv6", J("addr 2001:db8", ":0:0:1"), "ratio ab:cd"],
  ["host-port", "lab-box:7799", "gpt-oss:20b"],
  ["host-port", "lab-box.local:7799", "glm-5.3:cloud"],
  ["url", J("see https", "://example.invalid"), "http is a protocol"],
  ["cve", J("CVE", "-2021-44228"), "CVE list"],
  ["bearer", J("Bear", "er abc123"), "the bearer"],
  ["jwt", J("ey", "JhbGciOiJIUzI1NiJ9.x"), "eyJ short"],
  ["cred", "password: hunter2", "password policy"],
  ["cred", "api_key=abc", "token budget"],
  ["google-key", J("AI", "za", "A".repeat(35)), "AIza short"],
  ["openai-key", J("s", "k-", "a".repeat(24)), "sk-short"],
  ["querystring", "a?q=1", "what?"],
];

for (const [rule, dirty, near] of CASES) {
  test(`gate ${rule}: rejects dirty, error has no matched text`, () => {
    const o = readJson("tests/fixtures/tiny.json"); o.note = dirty;
    const r = A.validateTimeline(o);
    assert.equal(r.ok, false);
    assert.ok(has(r.errors, "note", rule), JSON.stringify(r.errors));
    assert.equal(JSON.stringify(r).includes(dirty), false);
  });
  test(`gate ${rule}: near-miss "${near}" passes`, () => {
    const o = readJson("tests/fixtures/tiny.json"); o.note = near;
    const r = A.validateTimeline(o);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });
}

test("gate scans keys too, recursively", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.rollup = { deep: { [J("192.0.2", ".7")]: 1 } };
  const r = A.validateTimeline(o);
  assert.equal(r.ok, false); assert.ok(r.errors.some((e) => e.rule === "ipv4" && e.path.startsWith("rollup.deep")));
});

test("dirty-ip fixture rejected at the event path, IP never echoed", () => {
  const r = A.validateTimeline(readJson("tests/fixtures/dirty-ip.json"));
  assert.equal(r.ok, false);
  assert.ok(has(r.errors, "events[2].status", "ipv4"), JSON.stringify(r.errors));
  assert.equal(JSON.stringify(r).includes("192.0.2"), false);
});

test("top-level sanitize description is exempt by key name", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.sanitize = "no tokens, no host:port, no password: values";
  assert.equal(A.validateTimeline(o).ok, true);
});

test("ISO timestamps are not host:port hits (decision: strict-ts strings skip the pattern scan)", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.window_end_at = "2026-01-01T00:01:00.123456Z";
  assert.equal(A.validateTimeline(o).ok, true);
  o.note = "at 13:43 local"; // a loose clock string is still a host:port hit
  assert.equal(A.validateTimeline(o).ok, false);
});

test("label-string rule on event label fields", () => {
  for (const bad of ["a/b", 'say "hi"', "<img src=x>", "", "x".repeat(49)]) {
    const o = readJson("tests/fixtures/tiny.json"); o.events[0].status = bad;
    const r = A.validateTimeline(o);
    assert.equal(r.ok, false, bad); assert.ok(has(r.errors, "events[0].status", "label-string"), bad);
  }
  for (const good of ["Vault Notes", "crAPI", "glm-5.3:cloud", "gpt-oss:20b", "proven-gate", "nuclei", "tool_call"]) {
    const o = readJson("tests/fixtures/tiny.json"); o.events[0].status = good;
    assert.equal(A.validateTimeline(o).ok, true, good);
  }
});

test("finding_class may be null but otherwise is a label", () => {
  const o = readJson("tests/fixtures/tiny.json"); o.events[0].finding_class = "a/b";
  assert.ok(has(A.validateTimeline(o).errors, "events[0].finding_class", "label-string"));
});

test("top-level labels checked (exam, campaign_stem, target_name, agent_llm)", () => {
  for (const k of ["exam", "campaign_stem", "target_name", "agent_llm"]) {
    const o = readJson("tests/fixtures/tiny.json"); o[k] = "bad/label";
    assert.ok(has(A.validateTimeline(o).errors, k, "label-string"), k);
  }
});

test("isLabel and scanForbidden are exported for reuse", () => {
  assert.equal(A.isLabel("glm-5.3:cloud"), true);
  assert.equal(A.isLabel("lab-box:7799"), false);
  assert.deepEqual(A.scanForbidden("plain words"), []);
  assert.deepEqual(A.scanForbidden("lab-box:7799"), ["host-port"]);
});
