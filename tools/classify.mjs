#!/usr/bin/env node
/**
 * Local-only classifier via Grok (xAI).
 * XAI_API_KEY from env. Sends numbers only.
 * Usage: XAI_API_KEY=… node tools/classify.mjs <run-id>
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const A = require("../analyzer.js");
const V = require("../viz-model.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, "..");
const HOST = "api.x.ai";
const MODEL = "grok-4.6";
const LABELS = new Set(["thin", "blocked", "reached", "verified"]);

function die(msg) { console.error(msg); process.exit(1); }

function parseReply(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/\{[\s\S]*\}/);
  const src = fenced ? fenced[0] : raw;
  try { return JSON.parse(src); } catch { die("bad json"); }
}

async function main() {
  const key = process.env.XAI_API_KEY;
  if (!key) die("XAI_API_KEY missing");
  const id = process.argv[2];
  if (!id) die("usage: node tools/classify.mjs <run-id>");
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "data/manifest.json"), "utf8"));
  const entry = man.runs.find((r) => r.id === id);
  if (!entry) die("unknown run id");
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), "utf8"));
  const v = A.validateTimeline(raw);
  if (!v.ok) die("gate failed");
  const hud = V.hudModel({ manifest: man, entry, run: v.run });
  const analysis = A.analyze(v.run, hud.llm);
  const metrics = A.runMetrics(v.run, analysis);
  const numbers = {
    events: metrics.events,
    agents: metrics.agents,
    window_s: metrics.window_s,
    t_first_publish: metrics.t_first_publish,
    endpoints: metrics.coverage.endpoints,
    verified: metrics.coverage.verified,
    reached: metrics.coverage.reached,
    blocked: metrics.coverage.blocked,
    layerShare: metrics.layerShare,
  };
  const url = new URL("/v1/chat/completions", `https://${HOST}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: "Classify this after-run lab exam using only these numbers. Reply JSON only: {\"label\":\"thin|blocked|reached|verified\",\"reason\":\"up to 12 words\"}. thin: very few events or almost no coverage. blocked: activity happened but nothing was verified. reached: endpoints were reached without verified findings. verified: at least one finding was verified." },
        { role: "user", content: JSON.stringify(numbers) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) die("grok http " + res.status);
  const body = await res.json();
  const parsed = parseReply(body?.choices?.[0]?.message?.content || "");
  const label = LABELS.has(parsed.label) ? parsed.label : "thin";
  const reason = String(parsed.reason || "").split(/\s+/).slice(0, 12).join(" ");
  const dir = path.join(ROOT, "media/class");
  fs.mkdirSync(dir, { recursive: true });
  const out = { schema: "swarm-visualizer/class/v1", run_id: id, model: MODEL, label, reason };
  fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify(out, null, 2) + "\n");
  console.log("class", id, label);
}

main().catch((e) => die(String(e && e.message ? e.message : e)));
