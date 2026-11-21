/* analyzer.js — pure, no DOM. Runs as a classic <script> (self.SwarmAnalyzer) and via require(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SwarmAnalyzer = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

  // Engine-independent ISO-8601 UTC parser. Fraction truncated to ms. NaN on anything else.
  function parseTs(ts) {
    if (typeof ts !== "string") return NaN;
    const m = TS_RE.exec(ts);
    if (!m) return NaN;
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
    const ms = m[7] ? Number((m[7] + "00").slice(0, 3)) : 0;
    const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d ||
        dt.getUTCHours() !== h || dt.getUTCMinutes() !== mi || dt.getUTCSeconds() !== s) return NaN;
    return t;
  }

  const SCHEMA = "chan-sim-timeline/v1";
  const LAYERS = Object.freeze(["human", "recon", "scope", "proven-gate", "publish"]);
  const EVENT_KEYS = Object.freeze(["ts", "agent_id", "role", "layer", "status", "finding_class"]);
  const KEPT_TOP = Object.freeze(["schema", "exam", "campaign_stem", "target_name", "started_at",
    "window_end_at", "coverage", "event_count", "agent_llm"]);

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // validateTimeline(obj) → { ok, errors[{path, rule}], warnings[], run? }
  // Rejects, never cleans. Errors carry rule names and JSON paths only, never values.
  function validateTimeline(obj) {
    const errors = [];
    const warnings = [];
    const seen = new Set();
    const err = (path, rule) => {
      const k = path + "\u0000" + rule;
      if (!seen.has(k)) { seen.add(k); errors.push({ path, rule }); }
    };
    if (!isObj(obj)) {
      err("$", "schema");
      return { ok: false, errors, warnings };
    }
    if (obj.schema !== SCHEMA) err("schema", "schema");
    if (!Array.isArray(obj.events)) err("events", "events");
    const events = Array.isArray(obj.events) ? obj.events : [];
    events.forEach((ev, i) => {
      const base = `events[${i}]`;
      if (!isObj(ev)) { err(base, "event-keys"); return; }
      for (const k of Object.keys(ev)) if (!EVENT_KEYS.includes(k)) err(`${base}.${k}`, "event-keys");
      for (const k of EVENT_KEYS) if (!(k in ev)) err(`${base}.${k}`, "event-keys");
      if (Number.isNaN(parseTs(ev.ts))) err(`${base}.ts`, "ts");
    });
    if (typeof obj.event_count === "number" && obj.event_count !== events.length) {
      warnings.push(`event_count ${obj.event_count} does not match ${events.length} events`);
    }
    if (errors.length) return { ok: false, errors, warnings };

    const run = {};
    for (const k of KEPT_TOP) if (k in obj) run[k] = clone(obj[k]);
    run.events = events
      .map((ev, i) => ({ i, e: { ts: ev.ts, agent_id: ev.agent_id, role: ev.role, layer: ev.layer,
        status: ev.status, finding_class: ev.finding_class, _t: parseTs(ev.ts) } }))
      .sort((a, b) => a.e._t - b.e._t || a.i - b.i)
      .map((x) => x.e);
    return { ok: true, errors, warnings, run };
  }

  return { parseTs, validateTimeline, LAYERS };
});
