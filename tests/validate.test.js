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
