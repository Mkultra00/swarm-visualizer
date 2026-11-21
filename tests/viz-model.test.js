const test = require("node:test"); const assert = require("node:assert/strict");
const A = require("../analyzer.js");
const V = require("../viz-model.js");
const { readJson } = require("./helpers.js");
const crapi = () => A.validateTimeline(readJson("data/runs/6bec75ed.json")).run;

test("LAYERS frozen and ordered; LAYER_COLOR keeps the M5 palette", () => {
  assert.deepEqual([...V.LAYERS], ["human", "recon", "scope", "proven-gate", "publish"]);
  assert.ok(Object.isFrozen(V.LAYERS));
  assert.deepEqual({ ...V.LAYER_COLOR }, { human: "#4FC3F7", recon: "#6ee7ff", scope: "#FFB300", "proven-gate": "#E53935", publish: "#43A047" });
});

test("cursorToTime endpoints, midpoint, clamping", () => {
  assert.equal(V.cursorToTime(0, 100, 1100), 100);
  assert.equal(V.cursorToTime(1000, 100, 1100), 1100);
  assert.equal(V.cursorToTime(500, 100, 1100), 600);
  assert.equal(V.cursorToTime(-5, 100, 1100), 100);
  assert.equal(V.cursorToTime(2000, 100, 1100), 1100);
});

test("cursorToTime degenerate range", () => {
  assert.equal(V.cursorToTime(500, 100, 100), 100);
  assert.equal(V.cursorToTime(0, 100, 100), 100);
  assert.equal(V.cursorToTime(500, 200, 100), 100);
  assert.equal(V.cursorToTime(0, 200, 100), 200);
});

test("visibleAt on crAPI", () => {
  const ev = crapi().events;
  const t0 = ev[0]._t, t1 = ev[ev.length - 1]._t;
  assert.equal(V.visibleAt(ev, t1).length, 33);
  assert.equal(V.visibleAt(ev, t0).length, 1);
  assert.equal(V.visibleAt(ev, t0 - 1).length, 0);
});

test("visibleAt inclusive cutoff with shared ts, keeps order", () => {
  const ev = [{ _t: 1, id: "a" }, { _t: 5, id: "b" }, { _t: 5, id: "c" }, { _t: 9, id: "d" }];
  assert.deepEqual(V.visibleAt(ev, 5).map((e) => e.id), ["a", "b", "c"]);
});

// ---- T10 stable lanes ----
test("laneOrder: first appearance over the full run", () => {
  assert.deepEqual(V.laneOrder(crapi().events), ["engine", "memory", "classifier", "orchestrator", "recon", "exploit", "scheduler", "report"]);
  assert.equal(V.laneOrder.length, 1); // takes the full event list only, no cursor
});
test("laneY", () => {
  assert.equal(V.laneY(0, 1, 720), 360);
  assert.equal(V.laneY(0, 8, 720), 60);
  assert.equal(V.laneY(7, 8, 720), 680);
  assert.ok(Math.abs(V.laneY(1, 8, 720) - (60 + 620 / 7)) < 1e-9);
});

// ---- T11 layerX / off-layer ----
test("layerX columns; unknown layers are not drawn", () => {
  assert.equal(V.layerX("human", 1200), 80);
  assert.equal(V.layerX("publish", 1200), 1160);
  assert.equal(V.layerX("scope", 1200), 620);
  assert.equal(V.layerX("bogus", 1200), null);
  assert.equal(V.layerX(undefined, 1200), null);
});
test("markRadius", () => {
  assert.equal(V.markRadius({ status: "publish" }), 6);
  assert.equal(V.markRadius({ status: "call", layer: "publish" }), 4);
});
