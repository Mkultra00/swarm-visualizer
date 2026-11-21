/* DOM/canvas glue only. textContent, no markup injection. Pure logic lives in analyzer.js / viz-model.js. */
(function () {
  "use strict";
  const A = window.SwarmAnalyzer;
  const V = window.SwarmViz;
  const $ = (id) => document.getElementById(id);

  const state = {
    manifest: null,
    entry: null,
    run: null,
    analysis: null,
    metrics: null,
    events: [],
    t0: 0,
    t1: 1,
    cursor: 0,
    playing: false,
    playMs: 8000,
    lastTs: 0,
    sidecar: null,
    dropped: false,
    rows: [],
  };

  function el(tag, props, kids) {
    const n = document.createElement(tag);
    if (props) Object.assign(n, props);
    if (kids) for (const k of kids) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    return n;
  }

  function fillBars(root, map) {
    while (root.firstChild) root.removeChild(root.firstChild);
    const max = Math.max(1, ...Object.values(map));
    Object.entries(map)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 12)
      .forEach(([k, v]) => {
        const i = el("i");
        i.style.width = Math.round((v / max) * 100) + "%";
        root.appendChild(el("div", null, [el("span", { textContent: k }), i, el("b", { textContent: String(v) })]));
      });
  }

  function fillDl(root, rows) {
    while (root.firstChild) root.removeChild(root.firstChild);
    for (const [k, v] of rows) {
      root.appendChild(el("dt", { textContent: k }));
      root.appendChild(el("dd", { textContent: String(v) }));
    }
  }

  function draw() {
    const canvas = $("viz");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);
    const events = state.events;
    if (!events.length) return;
    const cutoff = V.cursorToTime(state.cursor, state.t0, state.t1);
    const visible = V.visibleAt(events, cutoff);
    const lanes = V.laneOrder(events);
    V.LAYERS.forEach((layer) => {
      const x = V.layerX(layer, w);
      ctx.strokeStyle = "#243044";
      ctx.beginPath();
      ctx.moveTo(x, 40);
      ctx.lineTo(x, h - 40);
      ctx.stroke();
      ctx.fillStyle = V.LAYER_COLOR[layer];
      ctx.font = "12px ui-sans-serif";
      ctx.fillText(layer, x - 28, 28);
    });
    lanes.forEach((agent, ai) => {
      const y = V.laneY(ai, lanes.length, h);
      ctx.fillStyle = "#8b97a8";
      ctx.font = "11px ui-sans-serif";
      ctx.fillText(agent, 8, y + 4);
      const mine = visible.filter((e) => e.agent_id === agent);
      let lastX = 80;
      let has = false;
      mine.forEach((e) => {
        const x = V.layerX(e.layer, w);
        if (x == null) return;
        if (has) {
          ctx.strokeStyle = V.LAYER_COLOR[e.layer] || "#6ee7ff";
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          ctx.moveTo(lastX, y);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(x, y, V.markRadius(e), 0, Math.PI * 2);
        ctx.fillStyle = V.LAYER_COLOR[e.layer] || "#6ee7ff";
        ctx.fill();
        lastX = x;
        has = true;
      });
    });
    const hud = V.hudModel({ manifest: state.manifest, entry: state.entry, run: state.run });
    ctx.fillStyle = "#e8eef7";
    ctx.font = "12px ui-sans-serif";
    ctx.fillText(`FRAME ${hud.frame}  RUN ${hud.run}  AGENT LLM ${hud.llm}`, 16, h - 16);
    ctx.fillText(`${visible.length} / ${events.length}`, w - 110, h - 16);
  }

  function renderHud(hud, analysis) {
    $("hud-frame").textContent = hud.frame;
    $("hud-run").textContent = hud.run;
    $("hud-llm").textContent = hud.llm;
    $("brief-text").textContent = A.brief(analysis);
    fillDl($("stats"), [
      ["events", analysis.events],
      ["agents", analysis.agents],
      ["span s", analysis.span_s.toFixed(1)],
      ["window s", analysis.window_s == null ? "—" : analysis.window_s.toFixed(1)],
      ["endpoints", analysis.coverage.endpoints ?? "—"],
      ["findings", analysis.coverage.findings ?? "—"],
      ["verified", analysis.coverage.verified ?? "—"],
      ["off-layer", analysis.offLayer],
    ]);
    fillBars($("by-layer"), analysis.byLayer);
    fillBars($("by-agent"), analysis.byAgent);
  }

  function stopAudio() {
    const a = $("narration-audio");
    a.pause();
    a.removeAttribute("src");
    a.load();
  }

  function setSidecar(sc) {
    state.sidecar = sc;
    const has = !!(sc && sc.audio);
    $("play-narration").hidden = !has;
    $("voice-credit").hidden = !has;
    if (has) {
      $("voice-credit").textContent = "Narrator voice: " + (sc.voice_model || "unset") +
        ", reading the numbers above after the run. The narrator did not run this exam.";
    }
    $("transcript").hidden = !has;
    $("transcript").textContent = has ? sc.script_text : "";
    state.playMs = V.narrationPlayMs(sc);
  }

  function setRun(run, entry, dropped) {
    state.run = run;
    state.entry = entry;
    state.dropped = !!dropped;
    state.events = run.events || [];
    state.t0 = state.events.length ? state.events[0]._t : 0;
    state.t1 = state.events.length ? state.events[state.events.length - 1]._t : 1;
    if (state.t1 <= state.t0) state.t1 = state.t0 + 1;
    state.cursor = 1000;
    $("scrub").value = "1000";
    const hud = V.hudModel({ manifest: state.manifest, entry, run });
    const analysis = A.analyze(run, hud.llm);
    state.analysis = analysis;
    state.metrics = A.runMetrics(run, analysis);
    renderHud(hud, analysis);
    draw();
    if (dropped) setSidecar(null);
  }

  async function loadEntry(entry) {
    const res = await fetch(entry.file);
    const raw = await res.json();
    const v = A.validateTimeline(raw);
    if (!v.ok) {
      $("brief-text").textContent = "Rejected: " + v.errors.slice(0, 5).map((e) => `${e.rule} at ${e.path}`).join("; ");
      state.events = [];
      draw();
      return;
    }
    setRun(v.run, entry, false);
    let sc = null;
    try {
      const r = await fetch("media/narration/" + entry.id + ".json");
      if (r.ok) sc = await r.json();
    } catch (_) { /* no sidecar */ }
    setSidecar(sc && sc.schema === "swarm-visualizer/narration/v1" ? sc : null);
    if (location.hash !== "#run=" + entry.id) history.replaceState(null, "", "#run=" + entry.id);
    $("viz-wrap").scrollIntoView({ block: "start" });
  }

  function tick(now) {
    if (!state.playing) return;
    const dt = state.lastTs ? now - state.lastTs : 0;
    state.lastTs = now;
    state.cursor = V.nextCursor(state.cursor, dt, state.playMs);
    $("scrub").value = String(state.cursor);
    draw();
    if (state.cursor >= 1000) {
      state.playing = false;
      $("play").textContent = "Play";
      stopAudio();
      return;
    }
    requestAnimationFrame(tick);
  }

  function startPlay(withVoice) {
    if (state.cursor >= 1000) state.cursor = 0;
    state.playing = true;
    state.lastTs = 0;
    $("play").textContent = "Pause";
    if (withVoice && state.sidecar && !state.dropped) {
      state.playMs = V.narrationPlayMs(state.sidecar);
      const a = $("narration-audio");
      a.src = state.sidecar.audio;
      a.currentTime = 0;
      a.play().catch(() => {});
    } else {
      state.playMs = 8000;
      stopAudio();
    }
    requestAnimationFrame(tick);
  }

  function pausePlay() {
    state.playing = false;
    $("play").textContent = "Play";
    $("narration-audio").pause();
  }

  function fillExplainer() {
    const ul = $("explainer");
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    V.EXPLAINER.forEach((t) => ul.appendChild(el("li", { textContent: t })));
    const dl = $("layer-legend");
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    V.LAYERS.forEach((l) => {
      dl.appendChild(el("dt", { textContent: l }));
      dl.appendChild(el("dd", { textContent: V.LAYER_EXPLAIN[l] }));
    });
  }

  function fillTable() {
    const body = $("runs-body");
    while (body.firstChild) body.removeChild(body.firstChild);
    const cols = ["frame", "run", "stem", "events", "agents", "window_s", "t_first_publish", "endpoints", "verified", "llm", "klass", "usd", "usd_per_verified"];
    for (const row of state.rows) {
      const tr = el("tr");
      for (const k of cols) {
        const td = el("td");
        if (k === "klass") td.textContent = row.klass || "";
        else td.textContent = k === "usd" || k === "usd_per_verified" || k === "window_s" || k === "t_first_publish"
          ? V.formatCell(k, row[k])
          : (row[k] == null ? (row.rejected ? "" : V.formatCell(k, row[k])) : String(row[k] ?? ""));
        if (row.rejected && k !== "frame" && k !== "run" && k !== "stem" && k !== "events") td.textContent = k === "events" ? "rejected" : "";
        tr.appendChild(td);
      }
      const viz = el("td");
      if (!row.rejected && row.href) {
        const a = el("a", { href: row.href, textContent: "view" });
        viz.appendChild(a);
      }
      tr.appendChild(viz);
      body.appendChild(tr);
    }
  }

  async function loadClass(id) {
    try {
      const r = await fetch("media/class/" + id + ".json");
      if (!r.ok) return "";
      const j = await r.json();
      if (j && j.schema === "swarm-visualizer/class/v1" && typeof j.label === "string") return j.label;
    } catch (_) {}
    return "";
  }

  async function boot() {
    fillExplainer();
    let man;
    try {
      man = await fetch("data/manifest.json").then((r) => r.json());
    } catch (_) {
      $("brief-text").textContent = "Manifest fetch failed. Serve over http (python3 -m http.server 8767), not file://.";
      return;
    }
    state.manifest = man;
    const sel = $("run-select");
    man.runs.forEach((r, i) => {
      const hud = V.hudModel({ manifest: man, entry: r, run: { exam: r.run, campaign_stem: r.id, target_name: r.frame } });
      sel.appendChild(el("option", { value: String(i), textContent: `${hud.frame} · ${hud.run} · ${hud.llm}` }));
    });
    const rows = [];
    for (const entry of man.runs) {
      try {
        const raw = await fetch(entry.file).then((r) => r.json());
        const v = A.validateTimeline(raw);
        if (!v.ok) {
          rows.push({ frame: entry.frame, run: entry.run, stem: entry.id, events: "rejected", rejected: true });
          continue;
        }
        const hud = V.hudModel({ manifest: man, entry, run: v.run });
        const analysis = A.analyze(v.run, hud.llm);
        const metrics = A.runMetrics(v.run, analysis);
        const cost = A.costOf(v.run, entry, analysis.coverage.verified);
        const row = V.runRow({ entry, run: v.run, analysis, metrics, cost });
        row.klass = await loadClass(entry.id);
        rows.push(row);
      } catch (_) {
        rows.push({ frame: entry.frame, run: entry.run, stem: entry.id, events: "rejected", rejected: true });
      }
    }
    state.rows = rows;
    fillTable();

    const hashed = V.parseRunHash(location.hash, man);
    const first = hashed || man.runs[0];
    if (first) {
      sel.value = String(man.runs.indexOf(first));
      await loadEntry(first);
    }

    sel.addEventListener("change", () => loadEntry(man.runs[Number(sel.value)]));
    sel.addEventListener("input", () => loadEntry(man.runs[Number(sel.value)]));
    $("play").addEventListener("click", () => {
      if (state.playing) pausePlay();
      else startPlay(false);
    });
    $("play-narration").addEventListener("click", () => startPlay(true));
    $("scrub").addEventListener("input", (e) => {
      state.cursor = Number(e.target.value);
      stopAudio();
      draw();
    });
    $("file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) {
        $("brief-text").textContent = "Rejected: too-large at file";
        return;
      }
      let raw;
      try { raw = JSON.parse(await f.text()); } catch (_) {
        $("brief-text").textContent = "Rejected: json at file";
        state.events = [];
        draw();
        return;
      }
      const v = A.validateTimeline(raw);
      if (!v.ok) {
        $("brief-text").textContent = "Rejected: " + v.errors.slice(0, 5).map((err) => `${err.rule} at ${err.path}`).join("; ");
        state.events = [];
        draw();
        return;
      }
      setRun(v.run, null, true);
    });
    window.addEventListener("hashchange", () => {
      const e = V.parseRunHash(location.hash, man);
      if (e) loadEntry(e);
    });
  }

  boot();
})();
