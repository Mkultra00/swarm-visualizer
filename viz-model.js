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

  // Column x for a layer; null for off-layer events (never drawn in the human column).
  function layerX(layer, w) {
    const i = LAYERS.indexOf(layer);
    if (i < 0) return null;
    return 80 + (i * (w - 120)) / (LAYERS.length - 1);
  }

  function markRadius(ev) {
    return ev && ev.status === "publish" ? 6 : 4;
  }

  // Advance the 0..1000 cursor by elapsed wall time; a full play lasts playMs on any refresh rate.
  function nextCursor(c, dtMs, playMs) {
    const pm = Number.isFinite(playMs) && playMs > 0 ? playMs : 8000;
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    return Math.min(1000, c + (1000 * dt) / pm);
  }

  function hudModel({ manifest, entry, run }) {
    const r = run || {};
    const frame = r.target_name || (entry && entry.frame) || "lab";
    const exam = r.exam || "";
    const stem = r.campaign_stem || "";
    const runLabel = stem ? `${exam} · ${stem}` : exam;
    let llm = "not in log";
    if (entry && typeof entry.llm === "string" && entry.llm) llm = entry.llm;
    else if (manifest && Array.isArray(manifest.runs)) {
      const hit = manifest.runs.find((x) => x.id === r.campaign_stem);
      if (hit && hit.llm) llm = hit.llm;
    }
    if (llm === "not in log" && r.agent_llm && A.isLabel(r.agent_llm)) llm = r.agent_llm;
    return { frame, run: runLabel, llm };
  }

  const LAYER_EXPLAIN = Object.freeze({
    human: "Start: the operator kicks off the lab run.",
    recon: "Mapping: agents list what the practice app exposes.",
    scope: "Scope: agents decide what is in bounds and what to look at next.",
    "proven-gate": "Proof check: agents try to confirm a finding under the lab's own gate.",
    publish: "Report: candidate or confirmed results get written up.",
  });

  const EXPLAINER = Object.freeze([
    "Each row is one agent in the swarm. Each column is a stage, left to right: start, mapping, scope, proof check, report.",
    "A dot appears when an agent logged an event in that stage. Bigger dots are report events.",
    "A faint line joins one agent's own dots in time order, so you can follow that agent between stages. Lines never join two different agents.",
    "Press Play to replay the whole run in 8 seconds, or in step with the narration. The counter shows how many events have happened so far.",
    "Dots that are close in time don't mean agents were coordinating, and more dots don't mean a better run.",
    "This is an after-run replay of a lab exam against a practice app on a lab machine. It shows no requests, payloads, findings or targets.",
  ]);

  function formatCell(key, value) {
    if (key === "usd") {
      if (value === null || value === undefined) return "";
      if (value === 0) return "$0 API (compute not billed)";
      return "$" + Number(value).toFixed(4);
    }
    if (key === "usd_per_verified") {
      if (value === null || value === undefined) return "";
      return "$" + Number(value).toFixed(4);
    }
    if (value === null || value === undefined) return "—";
    if (key === "window_s" || key === "t_first_publish") return Number(value).toFixed(1);
    return String(value);
  }

  function runRow({ entry, run, analysis, metrics, cost }) {
    const hud = hudModel({ manifest: null, entry, run });
    const href = "#run=" + encodeURIComponent(entry.id);
    return {
      frame: hud.frame,
      run: analysis.run,
      stem: analysis.stem,
      events: analysis.events,
      agents: analysis.agents,
      window_s: metrics.window_s,
      t_first_publish: metrics.t_first_publish,
      endpoints: analysis.coverage.endpoints,
      verified: analysis.coverage.verified,
      llm: hud.llm,
      usd: cost.usd,
      usd_per_verified: cost.usd_per_verified,
      href,
    };
  }

  function parseRunHash(hash, manifest) {
    if (typeof hash !== "string") return null;
    const m = /^#run=([A-Za-z0-9_-]{1,32})$/.exec(hash);
    if (!m || !manifest || !Array.isArray(manifest.runs)) return null;
    return manifest.runs.find((r) => r.id === m[1]) || null;
  }

  function narrationPlayMs(sidecar) {
    const n = sidecar && sidecar.duration_ms;
    return Number.isInteger(n) && n >= 1000 && n <= 120000 ? n : 8000;
  }

  return {
    LAYERS, LAYER_COLOR, cursorToTime, visibleAt, laneOrder, laneY, layerX, markRadius, nextCursor,
    hudModel, runRow, formatCell, parseRunHash, LAYER_EXPLAIN, EXPLAINER, narrationPlayMs,
  };
});
