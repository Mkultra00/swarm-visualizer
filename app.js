const LAYERS = ["human", "recon", "scope", "proven-gate", "publish"];
const LAYER_COLOR = {
  human: "#4FC3F7",
  recon: "#6ee7ff",
  scope: "#FFB300",
  "proven-gate": "#E53935",
  publish: "#43A047",
};

const state = {
  run: null,
  events: [],
  t0: 0,
  t1: 1,
  cursor: 0,
  playing: false,
  llm: "not in log",
};

const $ = (id) => document.getElementById(id);

function parseTs(ts) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

function countBy(rows, key) {
  const m = {};
  for (const r of rows) {
    const k = r[key] || "unknown";
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function analyze(data, llm) {
  const events = data.events || [];
  const t0 = events.length ? parseTs(events[0].ts) : 0;
  const t1 = events.length ? parseTs(events[events.length - 1].ts) : t0;
  const dur = Math.max(0, (t1 - t0) / 1000);
  const agents = new Set(events.map((e) => e.agent_id)).size;
  const cov = data.coverage || {};
  return {
    frame: data.target_name || "lab",
    run: `${data.exam || "run"} · ${data.campaign_stem || ""}`.trim(),
    llm: llm || "not in log",
    events: events.length,
    agents,
    duration_s: dur,
    endpoints: cov.Endpoints ?? "—",
    findings: cov.TotalFindings ?? "—",
    verified: cov.Verified ?? "—",
    byLayer: countBy(events, "layer"),
    byAgent: countBy(events, "agent_id"),
    byStatus: countBy(events, "status"),
  };
}

function briefFrom(a) {
  return `${a.frame} / ${a.run}: ${a.events} events, ${a.agents} agents, ${a.duration_s.toFixed(1)}s window. Coverage endpoints ${a.endpoints}, findings ${a.findings} (verified ${a.verified}). AGENT LLM ${a.llm}. After-run only.`;
}

function bars(el, map) {
  const max = Math.max(1, ...Object.values(map));
  el.innerHTML = Object.entries(map)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 12)
    .map(([k, v]) => {
      const w = Math.round((v / max) * 100);
      return `<div><span>${k}</span><i style="width:${w}%"></i><b>${v}</b></div>`;
    })
    .join("");
}

function renderStats(a) {
  $("hud-frame").textContent = a.frame;
  $("hud-run").textContent = a.run;
  $("hud-llm").textContent = a.llm;
  $("brief-text").textContent = briefFrom(a);
  $("stats").innerHTML = [
    ["events", a.events],
    ["agents", a.agents],
    ["window s", a.duration_s.toFixed(1)],
    ["endpoints", a.endpoints],
    ["findings", a.findings],
    ["verified", a.verified],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("");
  bars($("by-layer"), a.byLayer);
  bars($("by-agent"), a.byAgent);
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
  const frac = state.cursor / 1000;
  const cutoff = state.t0 + (state.t1 - state.t0) * frac;
  const visible = events.filter((e) => parseTs(e.ts) <= cutoff);
  const agents = [...new Set(visible.map((e) => e.agent_id))];
  const cols = LAYERS.length;
  LAYERS.forEach((layer, i) => {
    const x = 80 + (i * (w - 120)) / (cols - 1);
    ctx.strokeStyle = "#243044";
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x, h - 40);
    ctx.stroke();
    ctx.fillStyle = LAYER_COLOR[layer] || "#8b97a8";
    ctx.font = "12px ui-sans-serif";
    ctx.fillText(layer, x - 28, 28);
  });
  agents.forEach((agent, ai) => {
    const y = 60 + (ai * (h - 100)) / Math.max(1, agents.length - 1 || 1);
    ctx.fillStyle = "#8b97a8";
    ctx.font = "11px ui-sans-serif";
    ctx.fillText(agent, 8, y + 4);
    const mine = visible.filter((e) => e.agent_id === agent);
    let lastX = 80;
    mine.forEach((e) => {
      const li = Math.max(0, LAYERS.indexOf(e.layer));
      const x = 80 + (li * (w - 120)) / (cols - 1);
      ctx.strokeStyle = LAYER_COLOR[e.layer] || "#6ee7ff";
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(lastX, y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, e.status === "publish" ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = LAYER_COLOR[e.layer] || "#6ee7ff";
      ctx.fill();
      lastX = x;
    });
  });
  ctx.fillStyle = "#e8eef7";
  ctx.fillText(`${visible.length} / ${events.length}`, w - 110, h - 16);
}

function setRun(data, llm) {
  state.run = data;
  state.events = data.events || [];
  state.t0 = state.events.length ? parseTs(state.events[0].ts) : 0;
  state.t1 = state.events.length ? parseTs(state.events[state.events.length - 1].ts) : 1;
  if (state.t1 <= state.t0) state.t1 = state.t0 + 1;
  state.cursor = 1000;
  $("scrub").value = "1000";
  const a = analyze(data, llm);
  state.llm = a.llm;
  renderStats(a);
  draw();
}

async function loadSample(item) {
  const res = await fetch(item.file);
  const data = await res.json();
  setRun(data, item.llm || "not in log");
}

function tick() {
  if (!state.playing) return;
  state.cursor = Math.min(1000, state.cursor + 4);
  $("scrub").value = String(state.cursor);
  draw();
  if (state.cursor >= 1000) {
    state.playing = false;
    $("play").textContent = "Play";
    return;
  }
  requestAnimationFrame(tick);
}

async function boot() {
  const man = await fetch("data/manifest.json").then((r) => r.json());
  const sel = $("run-select");
  man.runs.forEach((r, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${r.frame} · ${r.run} · ${r.llm}`;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => loadSample(man.runs[Number(sel.value)]));
  $("play").addEventListener("click", () => {
    state.playing = !state.playing;
    $("play").textContent = state.playing ? "Pause" : "Play";
    if (state.playing) {
      if (state.cursor >= 1000) state.cursor = 0;
      tick();
    }
  });
  $("scrub").addEventListener("input", (e) => {
    state.cursor = Number(e.target.value);
    draw();
  });
  $("file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const data = JSON.parse(await f.text());
    setRun(data, "not in log");
  });
  if (man.runs[0]) await loadSample(man.runs[0]);
}

boot();
