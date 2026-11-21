/* viz-model.js — pure, no DOM. Geometry and view models for the layered swarm.
   Runs as a classic <script> (self.SwarmViz, after analyzer.js) and via require(). */
(function (root, factory) {
  const A = typeof module === "object" && module.exports ? require("./analyzer.js") : root.SwarmAnalyzer;
  const api = factory(A);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SwarmViz = api;
})(typeof self !== "undefined" ? self : this, function (A) {
  "use strict";

  const LAYERS = A.LAYERS;
  // M5 look: same colors as the original stub.
  const LAYER_COLOR = Object.freeze({
    human: "#4FC3F7",
    recon: "#6ee7ff",
    scope: "#FFB300",
    "proven-gate": "#E53935",
    publish: "#43A047",
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // c ∈ [0,1000] → absolute ms between t0 and t1.
  function cursorToTime(c, t0, t1) {
    const cc = clamp(Number(c) || 0, 0, 1000);
    if (t1 <= t0) return cc > 0 ? t1 : t0;
    return t0 + ((t1 - t0) * cc) / 1000;
  }

  // Events with _t <= cutoff (inclusive), original (sorted) order.
  function visibleAt(events, cutoffMs) {
    return events.filter((e) => e._t <= cutoffMs);
  }

  // Distinct agent ids in first-appearance order over the FULL run, so lanes never jump during play.
  function laneOrder(events) {
    const seen = [];
    const set = new Set();
    for (const e of events) if (!set.has(e.agent_id)) { set.add(e.agent_id); seen.push(e.agent_id); }
    return seen;
  }

  // Lane i of n on a canvas of height h: centred when n === 1, else evenly from 60 to h−40.
  function laneY(i, n, h) {
    if (n <= 1) return h / 2;
    return 60 + (i * (h - 100)) / (n - 1);
  }

  return { LAYERS, LAYER_COLOR, cursorToTime, visibleAt, laneOrder, laneY };
});
