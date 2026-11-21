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

  // Counts by key, insertion order = first appearance. Missing → `fallback`.
  function countBy(rows, key, fallback) {
    const m = {};
    for (const r of rows) {
      const v = r[key];
      const k = v === null || v === undefined || v === "" ? fallback : String(v);
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }

  const COVERAGE_KEYS = Object.freeze([
    ["endpoints", "Endpoints"], ["findings", "TotalFindings"], ["verified", "Verified"],
    ["unverified", "Unverified"], ["confidence", "Confidence"], ["reached", "Reached"], ["blocked", "Blocked"],
  ]);

  function coverageOf(cov) {
    const out = {};
    for (const [k, src] of COVERAGE_KEYS) {
      const raw = isObj(cov) ? (src in cov ? cov[src] : cov[k]) : undefined;
      const ok = (typeof raw === "number" && Number.isFinite(raw)) || typeof raw === "boolean" || isLabel(raw);
      out[k] = ok ? raw : null;
    }
    return out;
  }

  function windowOf(run) {
    const a = parseTs(run.started_at);
    const b = parseTs(run.window_end_at);
    return Number.isNaN(a) || Number.isNaN(b) ? null : (b - a) / 1000;
  }

  // analyze(run, llmLabel) → Analysis (§3.3). `run` is a normalized run from validateTimeline.
  function analyze(run, llmLabel) {
    const events = (run && Array.isArray(run.events)) ? run.events : [];
    const byLayer = {};
    for (const l of LAYERS) byLayer[l] = 0;
    let offLayer = 0;
    for (const e of events) {
      if (LAYERS.includes(e.layer)) byLayer[e.layer] += 1;
      else offLayer += 1;
    }
    if (offLayer) byLayer.unknown = offLayer;
    let busiestLayer = null;
    for (const l of LAYERS) if (byLayer[l] > 0 && (busiestLayer === null || byLayer[l] > byLayer[busiestLayer])) busiestLayer = l;
    const ts = events.map((e) => e._t);
    const span_s = events.length < 2 ? 0 : (Math.max(...ts) - Math.min(...ts)) / 1000;
    const warnings = [];
    if (run && typeof run.event_count === "number" && run.event_count !== events.length) {
      warnings.push(`event_count ${run.event_count} does not match ${events.length} events`);
    }
    return {
      frame: run.target_name || "lab",
      run: run.exam || "run",
      stem: run.campaign_stem || "",
      llm: llmLabel || "not in log",
      events: events.length,
      agents: new Set(events.map((e) => e.agent_id)).size,
      span_s,
      window_s: windowOf(run),
      coverage: coverageOf(run.coverage),
      byLayer,
      byAgent: countBy(events, "agent_id", "unknown"),
      byStatus: countBy(events, "status", "unknown"),
      byFindingClass: countBy(events, "finding_class", "none"),
      offLayer,
      busiestLayer,
      warnings,
    };
  }

  const plural = (n, word) => `${n} ${n === 1 ? word : word + "s"}`;
  const dash = (v) => (v === null || v === undefined ? "—" : String(v));
  const pluralOrDash = (n, word) => (n === null || n === undefined ? `— ${word}s` : plural(n, word));

  // brief(analysis) → one paragraph from a fixed template (§3.4). Numbers and run labels only.
  function brief(a) {
    const head = `${a.frame} / ${a.run}`;
    if (!a.events) return `${head}: no events. AGENT LLM ${a.llm}. After-run lab exam.`;
    const stem = a.stem ? ` (${a.stem})` : "";
    const win = a.window_s === null || a.window_s === undefined ? "" : ` in a ${a.window_s.toFixed(1)} s window`;
    const busy = a.busiestLayer ? ` Busiest layer ${a.busiestLayer} (${a.byLayer[a.busiestLayer]}).` : "";
    const c = a.coverage || {};
    return `${head}${stem}: ${plural(a.events, "event")} from ${plural(a.agents, "agent")} over ${a.span_s.toFixed(1)} s${win}.` +
      `${busy} Coverage: ${dash(c.endpoints)} endpoints, ${pluralOrDash(c.findings, "finding")}, ${dash(c.verified)} verified.` +
      ` AGENT LLM ${a.llm}. After-run lab exam; layer plot is not cause-and-effect.`;
  }

  function isGeminiWorker(id) {
    if (typeof id !== "string") return false;
    const s = id.trim();
    if (!s || /^gemini$/i.test(s) || s === "not in log") return false;
    return /^gemini-[a-z0-9][a-z0-9.\-:]*$/i.test(s);
  }

  function runMetrics(run, analysis) {
    const events = (run && Array.isArray(run.events)) ? run.events : [];
    const started = parseTs(run && run.started_at);
    const firstLayer = (name) => {
      const ev = events.find((e) => e.layer === name);
      if (!ev || Number.isNaN(started)) return null;
      return (ev._t - started) / 1000;
    };
    const n = analysis.events;
    const window_s = analysis.window_s;
    const layerShare = {};
    for (const l of LAYERS) layerShare[l] = n ? (analysis.byLayer[l] || 0) / n : 0;
    const c = analysis.coverage || {};
    return {
      window_s,
      t_first_publish: firstLayer("publish"),
      t_first_proven_gate: firstLayer("proven-gate"),
      events: n,
      agents: analysis.agents,
      events_per_min: window_s ? n / (window_s / 60) : null,
      layerShare,
      coverage: {
        endpoints: c.endpoints, findings: c.findings, verified: c.verified,
        unverified: c.unverified, reached: c.reached, blocked: c.blocked,
      },
    };
  }

  function costOf(run, entry, verified) {
    const c = run && isObj(run.cost) ? run.cost : null;
    const tokens_in = c && typeof c.tokens_in === "number" ? c.tokens_in : null;
    const tokens_out = c && typeof c.tokens_out === "number" ? c.tokens_out : null;
    let usd = null;
    let basis = null;
    if (c && typeof c.usd === "number" && Number.isFinite(c.usd)) {
      usd = c.usd;
      basis = "log";
    } else if (entry && entry.billing === "local") {
      usd = 0;
      basis = "local-not-billed";
    }
    const usd_per_verified = usd !== null && typeof verified === "number" && verified > 0 ? usd / verified : null;
    return { tokens_in, tokens_out, usd, usd_per_verified, basis };
  }

  function narrationScript(analysis, metrics) {
    const llmSpoken = analysis.llm === "not in log" ? "not recorded in the log" : analysis.llm;
    if (!analysis.events) {
      return `${analysis.frame}, ${analysis.run}. After-run lab exam with no events. The agent LLM for this run was ${llmSpoken}.`;
    }
    const win = metrics.window_s == null ? "" : ` over a ${metrics.window_s.toFixed(0)}-second window`;
    const first = metrics.t_first_publish == null ? "" : ` The first publish came ${metrics.t_first_publish.toFixed(0)} seconds in.`;
    const c = analysis.coverage || {};
    const speak = (v) => (v === null || v === undefined ? "not recorded" : String(v));
    const findings = (c.findings === null || c.findings === undefined) ? "not recorded findings" : plural(c.findings, "finding");
    const nBusy = analysis.busiestLayer ? analysis.byLayer[analysis.busiestLayer] : 0;
    return `${analysis.frame}, ${analysis.run}. This is an after-run replay of a lab exam, not a live attack. ` +
      `The agent LLM for this run was ${llmSpoken}. ` +
      `${plural(analysis.agents, "agent")} produced ${plural(analysis.events, "event")}${win}. ` +
      `Each row is one agent; each column is a stage, from human on the left to publish on the right. ` +
      `Most activity was in the ${analysis.busiestLayer} stage, with ${nBusy} events.` +
      `${first} Coverage: ${speak(c.endpoints)} endpoints, ${findings}, ${speak(c.verified)} verified. ` +
      `Nearby dots are not proof that the agents coordinated.`;
  }

  return {
    parseTs, validateTimeline, analyze, brief, scanForbidden, isLabel, LAYERS,
    isGeminiWorker, runMetrics, costOf, narrationScript,
  };
});
