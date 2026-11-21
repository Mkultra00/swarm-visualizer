#!/usr/bin/env node
/**
 * Local-only classifier via Gemini Decisions API.
 * GEMINI_API_KEY from env. Sends numbers only.
 * Usage: GEMINI_API_KEY=… node tools/classify.mjs <run-id>
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
const HOST = "generativelanguage.googleapis.com";
const MODEL = "gemini-decision-1";

function die(msg) { console.error(msg); process.exit(1); }

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) die("GEMINI_API_KEY missing");
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
  const url = new URL("/v1beta/decisions", `https://${HOST}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: MODEL,
      input: JSON.stringify(numbers),
      questions: {
        label: {
          type: "choice",
          instructions: "Classify this after-run lab exam using only these numbers.",
          criteria: {
            thin: "Very few events or almost no coverage.",
            blocked: "Activity happened but nothing was verified.",
            reached: "Endpoints were reached without verified findings.",
            verified: "At least one finding was verified.",
          },
        },
      },
    }),
  });
  if (!res.ok) die("gemini decision http " + res.status);
  const body = await res.json();
  const ans = body && body.answers && body.answers.label;
  const label = ans && ans.choice ? ans.choice : "thin";
  const p = ans && ans.probabilities && typeof ans.probabilities[label] === "number"
    ? ans.probabilities[label].toFixed(2)
    : "";
  const reason = ["choice", label, p].filter(Boolean).join(" ").split(/\s+/).slice(0, 12).join(" ");
  const dir = path.join(ROOT, "media/class");
  fs.mkdirSync(dir, { recursive: true });
  const out = { schema: "swarm-visualizer/class/v1", run_id: id, model: MODEL, label, reason };
  fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify(out, null, 2) + "\n");
  console.log("class", id, label);
}

main().catch((e) => die(String(e && e.message ? e.message : e)));
