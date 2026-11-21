#!/usr/bin/env node
/**
 * Local-only narrator. GEMINI_API_KEY from env. Never prints the key.
 * gemini-3.8-live is websocket-only (bidiGenerateContent). This tool renders
 * audio with gemini-3.8-flash-tts generateContent so the site has a wav.
 * Usage: GEMINI_API_KEY=… node tools/narrate.mjs <run-id>
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
const HOST = "generativelanguage.googleapis.com";
const MODEL = "gemini-3.8-flash-tts";

function die(msg) { console.error(msg); process.exit(1); }

function wavDurationMs(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return 8000;
  const byteRate = buf.readUInt32LE(28);
  if (!byteRate) return 8000;
  const n = Math.round((1000 * (buf.length - 44)) / byteRate);
  return Math.min(120000, Math.max(1000, n));
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) die("GEMINI_API_KEY missing");
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
  const url = new URL(`/v1beta/models/${MODEL}:generateContent`, `https://${HOST}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Read this text verbatim. Add nothing.\n" + script_text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    }),
  });
  if (!res.ok) die("gemini voice http " + res.status);
  const body = await res.json();
  const inline = body?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!inline || !inline.inlineData.data) die("no audio in response");
  const buf = Buffer.from(inline.inlineData.data, "base64");
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
