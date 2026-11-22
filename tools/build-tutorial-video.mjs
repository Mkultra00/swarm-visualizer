#!/usr/bin/env node
// Builds media/tutorial-explainer.mp4: the REAL app is the screen — live headless-Chromium capture
// of swarm-visualizer with the run playing, plus the five stage-color chips flashing in sync with
// ElevenLabs narration. No text slides, no blurred gource backdrop.
// Usage: node tools/build-tutorial-video.mjs tts|capture|assemble|all   (app served on localhost:8768)
// The ElevenLabs key is read at runtime from env / ~/.hermes/.env and never written anywhere.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = "/Users/franky/.hermes/cache/scratch/tutorial-video-build";
const PUP_DIR = "/Users/franky/.hermes/cache/scratch/claude-demo-build";
const FFMPEG = "/Users/franky/.hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg";
const CHROME = "/Users/franky/.hermes/tools/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL_BASE = "http://localhost:8768/";
const OUT = path.join(ROOT, "media/tutorial-explainer.mp4");
const MAX_TOTAL = 60.0;
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Stage order must match narration order exactly.
const STAGES = [
  { name: "HUMAN", color: "#4FC3F7" },        // blue
  { name: "RECON", color: "#6ee7ff" },        // cyan
  { name: "SCOPE", color: "#FFB300" },        // amber
  { name: "PROVEN-GATE", color: "#E53935" },  // red
  { name: "PUBLISH", color: "#43A047" },      // green
];

export const SCENES = [
  { id: "s1", text: "This is swarm-visualizer — the game tape of an AI security test, replayed after the run. Nothing touches the wire; every frame is sanitized." },
  { id: "s2", text: "Now read the colors. Blue: HUMAN — the starting order. Cyan: RECON — agents map the front doors. Amber: SCOPE — what's in the rules. Red: PROVEN GATE — every hunch is verified before it scores. Green: PUBLISH — only gate survivors post." },
  { id: "s3", text: "Drive it yourself. Pick a sample run, scrub the timeline, or drop in your own sanitized JSON. The Brief on the right turns the numbers into one plain-English paragraph." },
  { id: "s4", text: "Play with narration reads the Brief to you. The narrator didn't run the exam — it only reads the log." },
  { id: "s5", text: "Five colors. One rule. A finding publishes only after it survives the proof gate." },
];

function loadElevenKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  try {
    for (const line of fs.readFileSync("/Users/franky/.hermes/.env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^ELEVENLABS_API_KEY=["']?([^"'\s#]+)["']?/);
      if (m) return m[1];
    }
  } catch {}
  return "";
}

function writeWav(pcm, out, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(out, Buffer.concat([h, pcm]));
}

async function synthVoice(text, wav, key) {
  if (key) {
    try {
      const url = new URL("/v1/text-to-speech/UgBBYS2sOqTuMpoF3BR0", "https://api.elevenlabs.io");
      url.searchParams.set("output_format", "pcm_24000");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/octet-stream", "xi-api-key": key },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      });
      if (res.ok) {
        const pcm = Buffer.from(await res.arrayBuffer());
        if (pcm.length) { writeWav(pcm, wav); return "eleven_multilingual_v2"; }
      } else console.log("TTS elevenlabs HTTP " + res.status);
    } catch (e) { console.log("TTS elevenlabs error " + e.message); }
  }
  const aiff = wav.replace(/\.wav$/, ".aiff");
  execFileSync("say", ["-r", "178", "-o", aiff, text]);
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", aiff, "-ar", "24000", "-ac", "1", wav]);
  return "macOS say";
}

const wavSec = (f) => { const b = fs.readFileSync(f); return (b.length - 44) / b.readUInt32LE(28); };

async function tts() {
  const key = loadElevenKey();
  const engines = {};
  for (const s of SCENES) {
    const wav = path.join(TMP_DIR, `${s.id}.wav`);
    engines[s.id] = await synthVoice(s.text, wav, key);
    console.log(`${s.id}: ${engines[s.id]} ${wavSec(wav).toFixed(2)}s`);
  }
  fs.writeFileSync(path.join(TMP_DIR, "tts.json"), JSON.stringify(engines, null, 1));
}

function sceneLens() {
  // ElevenLabs Mark runs longer than Gemini TTS; keep total ≤ 60s.
  const pad = { s1: 0.7, s2: 0.4, s3: 0.7, s4: 0.5, s5: 0.9 };
  return Object.fromEntries(SCENES.map((s) => [s.id, +(wavSec(path.join(TMP_DIR, `${s.id}.wav`)) + pad[s.id]).toFixed(2)]));
}

async function capture() {
  const require = createRequire(path.join(PUP_DIR, "package.json"));
  const puppeteer = require("puppeteer-core");
  const L = sceneLens();
  const FR = path.join(TMP_DIR, "frames");
  fs.rmSync(FR, { recursive: true, force: true });
  fs.mkdirSync(FR);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(URL_BASE, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 2000));
  // HERO MODE (s1+s2): the visualizer IS the screen — the LIVE canvas swarm (not the
  // 1280x720 gource clip) full-bleed 1920x980 at 1:1 pixels; every competing element hidden.
  await page.evaluate(() => {
    const viz = document.getElementById("viz");
    viz.setAttribute("width", "1920"); viz.setAttribute("height", "980");
    const st = document.createElement("style");
    st.id = "tut-hero";
    st.textContent = ".topbar,#brief,#explain,#runs,#voice-credit,#transcript,video#gource,.player{display:none!important}" +
      "body{margin:0!important;background:#05060a;overflow:hidden!important}" +
      "#viz-wrap{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1}" +
      "canvas#viz{display:block!important;width:1920px!important;height:980px!important;max-height:none!important;max-width:none!important}";
    document.head.appendChild(st);
    return true;
  });
  await new Promise((r) => setTimeout(r, 400));

  const cdp = await page.target().createCDPSession();
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const n = frames.length;
    frames.push({ file: `f${String(n).padStart(5, "0")}.jpg`, t: f.metadata.timestamp });
    fs.writeFileSync(path.join(FR, frames[n].file), Buffer.from(f.data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

  const rects = {};
  const T0 = Date.now() / 1000;
  const at = async (sec) => { const w = T0 + sec - Date.now() / 1000; if (w > 0) await new Promise((r) => setTimeout(r, w * 1000)); };
  const rect = (sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }, sel);
  const smooth = (y, ms) => page.evaluate((y, ms) => new Promise((done) => {
    const y0 = scrollY, t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); k < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }), y, ms);

  const s2 = L.s1, s3 = s2 + L.s2, s4 = s3 + L.s3, end = s4 + L.s4;
  // s1: pick the crAPI run, press Play — the run replays as a tree while we talk.
  rects.select = await rect("#run-select");
  await at(0.8);
  const crapiIdx = await page.evaluate(() => {
    const opts = [...document.querySelectorAll("#run-select option")];
    const i = opts.findIndex((o) => /crapi/i.test(o.textContent));
    return i >= 0 ? String(i) : "0";
  });
  await page.select("#run-select", crapiIdx);
  await new Promise((r) => setTimeout(r, 150));
  const chipsInjectFired = await page.evaluate((names, colors) => {
    const d = document.createElement("div");
    d.id = "tut-chips";
    d.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);display:flex;gap:26px;z-index:99;background:rgba(5,6,10,.62);padding:12px 26px;border-radius:12px;border:1px solid rgba(110,231,255,.3)";
    names.forEach((n, i) => {
      const c = document.createElement("span");
      c.style.cssText = `display:flex;align-items:center;gap:9px;color:${colors[i]};font:700 21px ui-sans-serif,Helvetica;letter-spacing:.09em`;
      const dot = document.createElement("i");
      dot.style.cssText = `width:13px;height:13px;border-radius:50%;background:${colors[i]};display:inline-block`;
      c.appendChild(dot);
      c.appendChild(document.createTextNode(n));
      d.appendChild(c);
    });
    document.body.appendChild(d);
    return true;
  }, STAGES.map((s) => s.name), STAGES.map((s) => s.color));
  rects.chips = await page.evaluate(() => [...document.querySelectorAll("#tut-chips span")].map((c) => { const b = c.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }));
  await at(1.9);
  rects.play = await rect("#play");
  await page.evaluate(() => document.getElementById("play").click()); // .player is hero-hidden; JS click still fires
  // s2: five-color tour — chips flash one by one over the still-playing run.
  const slots = (L.s2 - 1.5) / 5;
  rects.chipWins = STAGES.map((_, i) => [s2 + 1.5 + i * slots, s2 + 1.5 + (i + 1) * slots - 0.06]);
  await at(s3);
  // Layout restore: back to the real app grid for the controls tour; re-measure the select box.
  await page.evaluate(() => {
    document.getElementById("tut-hero")?.remove();
    document.getElementById("tut-chips")?.remove(); // stop the tour legend from doubling the native topbar legend
    const viz = document.getElementById("viz");
    viz.setAttribute("width", "1440"); viz.setAttribute("height", "780");
    return true;
  });
  await new Promise((r) => setTimeout(r, 300));
  rects.select = await rect("#run-select");
  rects.scrub = await rect("#scrub");
  await at(s3 + 0.5);
  rects.drop = await rect(".drop");
  rects.brief = await rect("#brief-text");
  await at(s3 + 9.0);
  rects.runsel = rects.select;
  // s4: narration mode.
  await smooth(330, 900);
  rects.narr = await rect("#play-narration");
  rects.credit = await rect("#voice-credit");
  await at(s4 + 0.25);
  await page.click("#play-narration");
  await at(end + 0.5);
  await cdp.send("Page.stopScreencast");
  await browser.close();
  fs.writeFileSync(path.join(TMP_DIR, "capture.json"), JSON.stringify({ T0, frames, rects, L, crapiIdx, chipsInjectFired }, null, 1));
  console.log(`captured ${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)}s` + ` (scenes: ${JSON.stringify(L)})`);
}

const ff = (args) => execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const hexFF = (c, a) => `0x${c.slice(1)}@${a}`;

async function buildEndCard(len) {
  const require = createRequire(path.join(PUP_DIR, "package.json"));
  const puppeteer = require("puppeteer-core");
  const chips = STAGES.map((s) => `<span style="display:inline-flex;align-items:center;gap:9px;margin:0 10px;color:${s.color};font:700 21px -apple-system,Helvetica;letter-spacing:.10em"><i style="width:13px;height:13px;border-radius:50%;background:${s.color};display:inline-block"></i>${s.name}</span>`).join("");
  const html = `<!doctype html><html><body style="margin:0;width:1280px;height:720px;overflow:hidden;background:#05060a;font-family:-apple-system,Helvetica,sans-serif;color:#e8eef7;display:flex;align-items:center;justify-content:center">
  <div style="text-align:center">
    <div style="letter-spacing:.28em;font-size:15px;color:#6ee7ff;text-transform:uppercase">how to read it</div>
    <div style="margin-top:30px">${chips}</div>
    <div style="margin-top:30px;font-size:27px;font-weight:600">A finding publishes only after it survives the <span style="color:#E53935">proof gate</span>.</div>
    <div style="margin-top:36px;font-size:22px;color:#6ee7ff;border:2px solid #6ee7ff55;border-radius:12px;padding:12px 24px;display:inline-block;background:#0b1220cc">https://mkultra00.github.io/swarm-visualizer/tutorial.html</div>
    <div style="margin-top:26px;font-size:14px;color:#8b97a8">Sanitized logs · no live attacks · narration: ElevenLabs Mark · Gemini 4 NYC</div>
  </div></body></html>`;
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await p.setContent(html, { waitUntil: "load" });
  await p.screenshot({ path: path.join(TMP_DIR, "endcard.png") });
  await b.close();
  ff(["-loop", "1", "-t", String(len), "-i", path.join(TMP_DIR, "endcard.png"), "-vf", "scale=1920:1080:out_range=tv,format=yuv420p,fps=30", "-c:v", "libx264", "-crf", "18", path.join(TMP_DIR, "endcard.mp4")]);
}

async function assemble() {
  const { T0, frames, rects, L } = JSON.parse(fs.readFileSync(path.join(TMP_DIR, "capture.json"), "utf8"));
  const s2 = L.s1, s3 = s2 + L.s2, s4 = s3 + L.s3, liveLen = s4 + L.s4;
  // 1. Real-time frame list.
  const lines = [];
  const pts = frames.map((f) => f.t - T0);
  for (let i = 0; i < frames.length; i++) {
    const startT = i === 0 ? 0 : pts[i];
    const nextT = i + 1 < frames.length ? pts[i + 1] : liveLen + 1;
    lines.push(`file '${path.join(TMP_DIR, "frames", frames[i].file)}'`, `duration ${Math.max(0.001, nextT - startT).toFixed(4)}`);
  }
  lines.push(`file '${path.join(TMP_DIR, "frames", frames.at(-1).file)}'`);
  fs.writeFileSync(path.join(TMP_DIR, "frames.txt"), lines.join("\n"));
  // 2. Time-gated highlights: colored chips (the color tour) + cyan UI markers.
  const S = 1.0; // screencast output is 1:1 with CSS pixels at dpr 2 / 1920 width
  const box = (r, a, b, color, t = 5) => {
    if (!r) return "";
    const [x, y, w, h] = r.map((v) => Math.round(v * S));
    return `drawbox=x=${x - 6}:y=${y - 6}:w=${w + 12}:h=${h + 12}:color=${hexFF(color, 0.95)}:t=${t}:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`;
  };
  const chipBoxes = STAGES.map((s, i) => box(rects.chips[i], rects.chipWins[i][0], rects.chipWins[i][1], s.color, 6));
  const ui = [
    box(rects.select, s3 + 0.25, s3 + 2.25, "#6ee7ff"),
    box(rects.scrub, s3 + 2.4, s3 + 4.85, "#6ee7ff"),
    box(rects.drop, s3 + 4.95, s3 + 7.0, "#6ee7ff"),
    box(rects.brief, s3 + 7.1, s3 + 9.9, "#6ee7ff"),
  ];
  const s4ui = [
    box(rects.narr, s4 + 0.6, s4 + 3.4, "#43A047"),
    box(rects.credit, s4 + 3.6, Math.min(s4 + 6.6, liveLen - 0.1), "#6ee7ff"),
  ];
  const boxes = [...chipBoxes, ...ui, ...s4ui].filter(Boolean).join(",");
  ff(["-f", "concat", "-safe", "0", "-i", path.join(TMP_DIR, "frames.txt"),
    "-vf", `fps=30,scale=1920:1080:flags=lanczos:out_range=tv,${boxes},trim=0:${liveLen.toFixed(3)},setpts=PTS-STARTPTS,fade=in:st=0:d=0.4,format=yuv420p`,
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", path.join(TMP_DIR, "live.mp4")]);
  // 3. End card + crossfade.
  const X = 0.5;
  await buildEndCard(L.s5 + X);
  const total = liveLen + L.s5;
  if (total > MAX_TOTAL) {
    console.error(`TOO LONG: planned ${total.toFixed(2)}s > ${MAX_TOTAL}s ceiling`);
    process.exit(2);
  }
  // 4. Narration at scene starts.
  const starts = { s1: 0.25, s2: s2 + 0.3, s3: s3 + 0.25, s4: s4 + 0.25, s5: liveLen + 0.3 };
  const aIn = SCENES.flatMap((s) => ["-i", path.join(TMP_DIR, `${s.id}.wav`)]);
  const delays = SCENES.map((s, i) => `[${i + 2}:a]aresample=48000,adelay=${Math.round(starts[s.id] * 1000)}:all=1[a${i}]`).join(";");
  const mix = SCENES.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${SCENES.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;
  const vf = `[0:v][1:v]xfade=transition=fade:duration=${X}:offset=${(liveLen - X).toFixed(3)},fade=out:st=${(total - 0.6).toFixed(3)}:d=0.6,format=yuv420p[vout]`;
  ff(["-i", path.join(TMP_DIR, "live.mp4"), "-i", path.join(TMP_DIR, "endcard.mp4"), ...aIn,
    "-filter_complex", `${vf};${delays};${mix}`, "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-r", "30",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-t", total.toFixed(3), "-movflags", "+faststart", OUT]);
  console.log(`wrote ${OUT} (planned ${total.toFixed(2)}s)`);
  console.log("scenes:", JSON.stringify({ s1: [0, s2], s2: [s2, s3], s3: [s3, s4], s4: [s4, liveLen], s5: [liveLen, total] }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const mode = isMain ? process.argv[2] || "all" : "none";
if (mode === "tts" || mode === "all") await tts();
if (mode === "capture" || mode === "all") await capture();
if (mode === "assemble" || mode === "all") await assemble();
