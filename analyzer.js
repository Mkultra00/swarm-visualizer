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

  // §2.3 forbidden patterns. Names are what errors report; matched text is never reported.
  const FORBIDDEN = Object.freeze([
    ["ipv4", /\b\d{1,3}(\.\d{1,3}){3}\b/],
    ["ipv6", /\b[0-9a-f]{1,4}(:[0-9a-f]{1,4}){3,7}\b/i],
    ["host-port", /\b[\w.-]+:\d{2,5}\b(?![\w.])/],
    ["url", /\b[a-z][a-z0-9+.-]*:\/\//i],
    ["cve", /\bCVE-\d{4}-\d{3,}\b/i],
    ["bearer", /\bbearer\s+\S+/i],
    ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\./],
    ["cred", /\b(password|passwd|secret|api[_-]?key|token|cookie|session[_-]?id)\b\s*[:=]/i],
    ["google-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
    ["openai-key", /\bsk-[A-Za-z0-9]{20,}\b/],
    ["querystring", /\?[\w.-]+=/],
  ]);
  const LABEL_RE = /^[A-Za-z0-9 ._:+-]{1,48}$/;

  // Returns the names of every forbidden pattern the string hits ([] when clean).
  // [DECISION] A string that is exactly a strict ISO-8601 UTC timestamp (TS_RE) is skipped:
  // it can only hold digits, "-", "T", ":", "." and "Z", and "T13:43" would otherwise be a host:port hit.
  function scanForbidden(str) {
    if (typeof str !== "string" || TS_RE.test(str)) return [];
    return FORBIDDEN.filter(([, re]) => re.test(str)).map(([name]) => name);
  }

  function isLabel(v) {
    return typeof v === "string" && LABEL_RE.test(v) && scanForbidden(v).length === 0;
  }

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

    // Recursive pattern scan over keys and values. Top-level "sanitize" is exempt by key name.
    const scan = (v, path) => {
      if (typeof v === "string") { for (const r of scanForbidden(v)) err(path || "$", r); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${path}[${i}]`)); return; }
      if (isObj(v)) {
        for (const k of Object.keys(v)) {
          if (path === "" && k === "sanitize") continue;
          const p = path ? `${path}.${k}` : k;
          for (const r of scanForbidden(k)) err(p, r);
          scan(v[k], p);
        }
      }
    };
    scan(obj, "");

    for (const k of ["exam", "campaign_stem", "target_name", "agent_llm"]) {
      if (k in obj && obj[k] !== null && obj[k] !== undefined && !isLabel(obj[k])) err(k, "label-string");
    }
    if (!Array.isArray(obj.events)) err("events", "events");
    const events = Array.isArray(obj.events) ? obj.events : [];
    events.forEach((ev, i) => {
      const base = `events[${i}]`;
      if (!isObj(ev)) { err(base, "event-keys"); return; }
      for (const k of Object.keys(ev)) if (!EVENT_KEYS.includes(k)) err(`${base}.${k}`, "event-keys");
      for (const k of EVENT_KEYS) if (!(k in ev)) err(`${base}.${k}`, "event-keys");
      if (Number.isNaN(parseTs(ev.ts))) err(`${base}.ts`, "ts");
      for (const k of ["agent_id", "role", "layer", "status"]) if (k in ev && !isLabel(ev[k])) err(`${base}.${k}`, "label-string");
      if ("finding_class" in ev && ev.finding_class !== null && !isLabel(ev.finding_class)) err(`${base}.finding_class`, "label-string");
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

  return { parseTs, validateTimeline, scanForbidden, isLabel, LAYERS };
});
