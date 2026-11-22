#!/usr/bin/env node
// Builds media/demo-1min.mp4: live headless-Chromium capture of the real app + ElevenLabs narration.
// Usage: node tools/build-demo-video.mjs tts|capture|assemble|all   (app must be served on localhost:8768)
// The ElevenLabs key is read at runtime from env / ~/.hermes/.env and never written anywhere.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = "/Users/franky/.hermes/cache/scratch/claude-demo-build";
const FFMPEG = "/Users/franky/.hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg";
const CHROME = "/Users/franky/.hermes/tools/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL_BASE = "http://localhost:8768/";
const OUT = path.join(ROOT, "media/demo-1min.mp4");
fs.mkdirSync(TMP, { recursive: true });

export const SCENES = [
  { id: "s1", text: "This is swarm-visualizer: an after-run analyzer and visualizer for sanitized swarm timelines. Pick a sample run. Here, crAPI." },
  { id: "s2", text: "Press Play, and the run replays as a Gource-style tree. The header shows the frame, the run, and the agent LLM, read from that run's own log." },
  { id: "s3", text: "The Brief on the right turns the numbers into one plain-English paragraph. Below, agents move through five stages: human, recon, scope, proven gate, and publish. And the table gives one row per sample: events, window, coverage, and class." },
  { id: "s4", text: "Narration is voiced by ElevenLabs, and Grok labels each run's class. You can also drop in your own timeline JSON. No server, and no API keys in the browser." },
  { id: "s5", text: "swarm-visualizer. Try it live on GitHub Pages." },
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
    const wav = path.join(TMP, `${s.id}.wav`);
    engines[s.id] = await synthVoice(s.text, wav, key);
    console.log(`${s.id}: ${engines[s.id]} ${wavSec(wav).toFixed(2)}s`);
  }
  fs.writeFileSync(path.join(TMP, "tts.json"), JSON.stringify(engines, null, 1));
}

// Scene lengths = narration + breathing room. s5 is the end card (not captured live).
function sceneLens() {
  const pad = { s1: 0.9, s2: 0.8, s3: 0.8, s4: 0.9, s5: 2.6 };
  return Object.fromEntries(SCENES.map((s) => [s.id, +(wavSec(path.join(TMP, `${s.id}.wav`)) + pad[s.id]).toFixed(2)]));
}

async function capture() {
  const require = createRequire(path.join(TMP, "package.json"));
  const puppeteer = require("puppeteer-core");
  const L = sceneLens();
  const FR = path.join(TMP, "frames");
  fs.rmSync(FR, { recursive: true, force: true });
  fs.mkdirSync(FR);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await page.goto(URL_BASE, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 2000));

  const cdp = await page.target().createCDPSession();
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const n = frames.length;
    frames.push({ file: `f${String(n).padStart(5, "0")}.jpg`, t: f.metadata.timestamp });
    fs.writeFileSync(path.join(FR, frames[n].file), Buffer.from(f.data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  // Keep frames flowing even when the page is static: a 1px invisible repaint is not needed if video plays,
  // but the assembler holds the last frame anyway.
  const marks = {};
  const rects = {};
  const T0 = Date.now() / 1000;
  marks.start = T0;
  const at = async (sec) => { const w = T0 + sec - Date.now() / 1000; if (w > 0) await new Promise((r) => setTimeout(r, w * 1000)); };
  const rect = (sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }, sel);
  const smooth = (y, ms) => page.evaluate((y, ms) => new Promise((done) => {
    const y0 = scrollY, t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); k < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }), y, ms);

  const s2 = L.s1, s3 = s2 + L.s2, s4 = s3 + L.s3, end = s4 + L.s4;
  // s1 hook: dashboard top, Vault Notes default; pick crAPI from the Sample dropdown.
  rects.select = await rect("#run-select");
  await at(5.6);
  await page.select("#run-select", "4");
  await new Promise((r) => setTimeout(r, 60));
  await page.evaluate(() => window.scrollTo(0, 0));
  // s2: press Play; Gource clip + HUD.
  await at(s2 + 0.3);
  rects.play = await rect("#play");
  rects.hud = await rect("#hud");
  await page.click("#play");
  // s3: Brief rail, then the five-stage legend, then the table.
  await at(s3);
  rects.brief = await rect("#brief-text");
  await at(s3 + 4.4);
  await smooth(905, 1300);
  rects.legend = await rect("#layer-legend");
  await at(s3 + 10.2);
  const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await smooth(maxY, 1300);
  rects.table = await rect("#runs .table-wrap");
  // s4: voice credit + Play with narration, CLASS column, Drop JSON.
  await at(s4);
  await smooth(330, 900);
  rects.narr = await rect("#play-narration");
  rects.credit = await rect("#voice-credit");
  await page.click("#play-narration");
  await at(s4 + 3.6);
  await smooth(maxY, 900);
  rects.klass = await page.evaluate(() => {
    const th = [...document.querySelectorAll("#runs th")].find((x) => x.textContent === "CLASS").getBoundingClientRect();
    const tb = document.querySelector("#runs-body").getBoundingClientRect();
    return [th.x, th.y, th.width, tb.bottom - th.y];
  });
  await at(s4 + 6.6);
  await smooth(330, 900);
  rects.drop = await rect(".drop");
  await at(end + 0.5);
  await cdp.send("Page.stopScreencast");
  // End-card background: real app top view.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(TMP, "endbg.png") });
  await browser.close();
  fs.writeFileSync(path.join(TMP, "capture.json"), JSON.stringify({ T0, frames, rects, L }, null, 1));
  console.log(`captured ${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)}s`);
}

const ff = (args) => execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });

async function endCard(len) {
  const require = createRequire(path.join(TMP, "package.json"));
  const puppeteer = require("puppeteer-core");
  const bg = "data:image/png;base64," + fs.readFileSync(path.join(TMP, "endbg.png")).toString("base64");
  const html = `<!doctype html><html><body style="margin:0;width:1280px;height:720px;overflow:hidden;background:#05060a;font-family:-apple-system,Helvetica,sans-serif;color:#e8eef7">
  <div style="position:absolute;inset:0;background:url(${bg}) center/cover;filter:blur(6px) brightness(.28)"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="letter-spacing:.28em;font-size:15px;color:#6ee7ff;text-transform:uppercase">after-run analyzer + visualizer</div>
    <div style="font-size:76px;font-weight:700;margin:14px 0 10px">swarm-visualizer</div>
    <div style="font-size:22px;color:#b8c4d6">Sanitized swarm timelines · Gource tree · table · Brief</div>
    <div style="margin-top:38px;font-size:30px;font-weight:600;color:#6ee7ff;border:2px solid #6ee7ff55;border-radius:12px;padding:14px 26px;background:#0b1220cc">https://mkultra00.github.io/swarm-visualizer/</div>
    <div style="margin-top:34px;font-size:15px;color:#8b97a8">Narration: eleven_multilingual_v2 (Mark) · Class labels: grok-4.6 · Gemini 4 NYC</div>
  </div></body></html>`;
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await p.setContent(html, { waitUntil: "load" });
  await p.screenshot({ path: path.join(TMP, "endcard.png") });
  await b.close();
  ff(["-loop", "1", "-t", String(len), "-i", path.join(TMP, "endcard.png"), "-vf", "scale=1920:1080:out_range=tv,format=yuv420p,fps=30", "-c:v", "libx264", "-crf", "18", path.join(TMP, "endcard.mp4")]);
}

async function assemble() {
  const { T0, frames, rects, L } = JSON.parse(fs.readFileSync(path.join(TMP, "capture.json"), "utf8"));
  const s2 = L.s1, s3 = s2 + L.s2, s4 = s3 + L.s3, liveLen = s4 + L.s4;
  // 1. Real-time frame list (each frame held until the next one arrived).
  const lines = [];
  const pts = frames.map((f) => f.t - T0);
  for (let i = 0; i < frames.length; i++) {
    const startT = i === 0 ? 0 : pts[i];
    const nextT = i + 1 < frames.length ? pts[i + 1] : liveLen + 1;
    lines.push(`file '${path.join(TMP, "frames", frames[i].file)}'`, `duration ${Math.max(0.001, nextT - startT).toFixed(4)}`);
  }
  lines.push(`file '${path.join(TMP, "frames", frames.at(-1).file)}'`);
  fs.writeFileSync(path.join(TMP, "frames.txt"), lines.join("\n"));
  // 2. Highlight boxes over the real UI (annotation only).
  const S = 1.5, P = 6;
  const box = (r, a, b) => {
    const [x, y, w, h] = r.map((v) => Math.round(v * S));
    return `drawbox=x=${x - P}:y=${y - P}:w=${w + 2 * P}:h=${h + 2 * P}:color=0x6ee7ff@0.95:t=5:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`;
  };
  const boxes = [
    box(rects.select, 4.6, s2 - 0.2),
    box(rects.play, s2 + 0.0, s2 + 1.8),
    box(rects.hud, s2 + 4.2, s3 - 0.2),
    box(rects.brief, s3 + 0.3, s3 + 4.3),
    box(rects.legend, s3 + 6.0, s3 + 10.1),
    box(rects.table, s3 + 11.7, s4 - 0.1),
    box(rects.credit, s4 + 1.0, s4 + 3.5),
    box(rects.narr, s4 + 1.0, s4 + 3.5),
    box(rects.klass, s4 + 4.7, s4 + 6.5),
    box(rects.drop, s4 + 7.7, liveLen),
  ].join(",");
  ff(["-f", "concat", "-safe", "0", "-i", path.join(TMP, "frames.txt"),
    "-vf", `fps=30,scale=1920:1080:flags=lanczos:out_range=tv,${boxes},trim=0:${liveLen.toFixed(3)},setpts=PTS-STARTPTS,fade=in:st=0:d=0.4,format=yuv420p`,
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", path.join(TMP, "live.mp4")]);
  // 3. End card + crossfade.
  const X = 0.5;
  await endCard(L.s5 + X);
  const total = liveLen + L.s5;
  // 4. Narration: each scene's wav placed at its scene start.
  const starts = { s1: 0.3, s2: s2 + 0.25, s3: s3 + 0.25, s4: s4 + 0.25, s5: liveLen + 0.3 };
  const aIn = SCENES.flatMap((s) => ["-i", path.join(TMP, `${s.id}.wav`)]);
  const delays = SCENES.map((s, i) => `[${i + 2}:a]aresample=48000,adelay=${Math.round(starts[s.id] * 1000)}:all=1[a${i}]`).join(";");
  const mix = SCENES.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${SCENES.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;
  const vf = `[0:v][1:v]xfade=transition=fade:duration=${X}:offset=${(liveLen - X).toFixed(3)},fade=out:st=${(total - 0.6).toFixed(3)}:d=0.6,format=yuv420p[vout]`;
  ff(["-i", path.join(TMP, "live.mp4"), "-i", path.join(TMP, "endcard.mp4"), ...aIn,
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
