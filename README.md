# swarm-visualizer

After-run **analyzer + visualizer** for sanitized swarm timelines.

Live: [https://mkultra00.github.io/swarm-visualizer/](https://mkultra00.github.io/swarm-visualizer/)

Built for **Gemini 4 NYC** (2026-11-21). Attack engines stay on the lab Mac. This repo is the public website only.

## What this repo does NOT do

This project does **not** perform a pentest, and it does **not** run the agentic swarm pentest simulation.

- The simulation runs are built on **two other open-source repos, forked privately** — e.g. **ARTEX** ([BaaRai/ARTEX](https://github.com/BaaRai/ARTEX), AI autonomous pentest system) and **Pentest-Swarm-AI** ([Armur-Ai/Pentest-Swarm-AI](https://github.com/Armur-Ai/Pentest-Swarm-AI), swarm orchestrator). Those forked repos are **private**, so they are not hosted here.
- A full simulation run takes **hours**. Nothing in this repo launches or replays live attacks — the engines stay on the offline lab machine.
- The **front-end visualizer and analyzer** (this entire repo) were **built during the hackathon**.
- Gemini models were used **inside the simulation, offline, only to get the data** that is fed to the analyzer — sanitized timelines exported to `data/runs/*.json`. No model calls happen in the browser.
- Narration on the demo and tutorial videos also uses the **Gemini voice model** (Gemini TTS, `gemini-3.8-flash-tts`, voice Puck) — again generated at build time, spoken audio only.

## What it is

Pick a sample (or drop a `chan-sim-timeline/v1` JSON). The page:

1. **Visualizes** the run as a Gource tree clip (FRAME / RUN / AGENT LLM HUD)
2. **Tables** one row per sample (events, window, coverage, class, cost)
3. **Briefs** one paragraph from the numbers — no payloads, no how-to
4. **Narrates** with a Gemini TTS sidecar when present (`gemini-3.8-flash-tts`)
5. **Classifies** the numbers with Gemini Decisions (`gemini-decision-1`)

No server. No API keys in the browser. Offline after load.

## Samples

| FRAME | RUN | stem | AGENT LLM |
| --- | --- | --- | --- |
| Vault Notes | vaultnotes-7 | `7b5ee689` | `glm-5.3:cloud` |
| Vault Notes | vaultnotes-8 | `7c2756ff` | `glm-5.3:cloud` (rejected — dirty log) |
| Vault Notes | vaultnotes-9 | `28bdd7b7` | `glm-5.3:cloud` |
| Juice Shop | juiceshop | `7eaf9541` | `gpt-oss:20b` |
| crAPI | crapi-1 | `6bec75ed` | `gpt-oss:20b` |

HUD LLM is the worker **from that run's log**. Do not stamp Gemini on these baselines. Gemini vs past-LLM columns stay empty until a Carbon / Hydrogen after-run lands.

## Honest limits

- Visualization only. **Never** exploit steps, payloads, or live target details.
- Layer plot is not cause-and-effect between agents.
- `usd` is empty unless the log carries tokens/cost. We do not invent prices.
- Narrator voice ≠ agent LLM. Credit sits outside the HUD.
- `gemini-3.8-live` is websocket-only. Site wavs are **flash-tts**.
- Attack stack does **not** live here.

## Run locally

```bash
python3 -m http.server 8767
# then open localhost port 8767 in a browser
```

```bash
node --test tests/*.test.js
```

Optional (operator machine, env key only — never commit `.env`):

```bash
GEMINI_API_KEY=… node tools/classify.mjs 6bec75ed
GEMINI_API_KEY=… node tools/narrate.mjs 6bec75ed
```

## Layout

- `index.html` / `styles.css` / `app.js` — static site
- `analyzer.js` / `viz-model.js` — numbers + canvas model
- `data/manifest.json` + `data/runs/*.json` — sanitized samples
- `media/class/` / `media/narration/` — Gemini class + wav sidecars
- `tools/` — local-only Gemini render
- `docs/TDD-swarm-visualizer.md` — tests T0–T29

## License

MIT
