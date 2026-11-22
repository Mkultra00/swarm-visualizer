#!/usr/bin/env node
/**
 * Local-only narrator. ELEVENLABS_API_KEY from env. Never prints the key.
 * Renders audio with ElevenLabs TTS so the site has a wav.
 * Usage: ELEVENLABS_API_KEY=… node tools/narrate.mjs <run-id>
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const A = require("../analyzer.js");
const V = require("../viz-model.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, "..");
const HOST = "api.elevenlabs.io";
const MODEL = "eleven_multilingual_v2";
const VOICE = "UgBBYS2sOqTuMpoF3BR0";
const RATE = 24000;

function die(msg) { console.error(msg); process.exit(1); }

function pcmToWav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function wavDurationMs(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return 8000;
  const byteRate = buf.readUInt32LE(28);
  if (!byteRate) return 8000;
  const n = Math.round((1000 * (buf.length - 44)) / byteRate);
  return Math.min(120000, Math.max(1000, n));
}

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) die("ELEVENLABS_API_KEY missing");
  const id = process.argv[2];
  if (!id) die("usage: node tools/narrate.mjs <run-id>");
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "data/manifest.json"), "utf8"));
  const entry = man.runs.find((r) => r.id === id);
  if (!entry) die("unknown run id");
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), "utf8"));
  const v = A.validateTimeline(raw);
  if (!v.ok) die("gate failed");
  const hud = V.hudModel({ manifest: man, entry, run: v.run });
  const analysis = A.analyze(v.run, hud.llm);
  const metrics = A.runMetrics(v.run, analysis);
  const script_text = A.narrationScript(analysis, metrics);
  const url = new URL(`/v1/text-to-speech/${VOICE}`, `https://${HOST}`);
  url.searchParams.set("output_format", "pcm_24000");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/octet-stream",
      "xi-api-key": key,
    },
    body: JSON.stringify({ text: script_text, model_id: MODEL }),
  });
  if (!res.ok) die("elevenlabs voice http " + res.status);
  const pcm = Buffer.from(await res.arrayBuffer());
  if (!pcm.length) die("no audio in response");
  const buf = pcmToWav(pcm);
  const dir = path.join(ROOT, "media/narration");
  fs.mkdirSync(dir, { recursive: true });
  const wavRel = `media/narration/${id}.wav`;
  fs.writeFileSync(path.join(ROOT, wavRel), buf);
  const sidecar = {
    schema: "swarm-visualizer/narration/v1",
    run_id: id,
    voice_model: MODEL,
    script_text,
    script_sha256: crypto.createHash("sha256").update(script_text, "utf8").digest("hex"),
    audio: wavRel,
    duration_ms: wavDurationMs(buf),
    rendered_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify(sidecar, null, 2) + "\n");
  console.log("wrote", wavRel, "bytes", buf.length, "ms", sidecar.duration_ms);
}

main().catch((e) => die(String(e && e.message ? e.message : e)));
