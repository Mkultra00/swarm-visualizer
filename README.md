# swarm-visualizer

After-run **analyzer + visualizer** for sanitized swarm timelines.

Built **today** (Gemini 4 NYC, 2026-11-21). Attack engines stay on the lab Mac. This repo is the public website only.

## What it is

Drop or pick a `chan-sim-timeline/v1` JSON. The page:

- **analyzes** counts (agents, layers, status, duration, coverage)
- **visualizes** the run as a layered swarm (FRAME / RUN / AGENT LLM HUD)
- **briefs** one paragraph from the numbers — no payloads, no how-to

No server. No API keys. Offline after load.

## Honest limits

- Visualization only. **Never** exploit steps, payloads, or live target details.
- Sample runs are **lab exams** (Vault Notes, Juice Shop, crAPI). LLM stamps are the worker that actually ran (`glm-5.3:cloud` / `gpt-oss:20b`). Do not label these Gemini.
- Tree / layer plot is not cause-and-effect between agents.
- Attack stack does **not** live here.

## Run

Open `index.html` or GitHub Pages. Pick a sample, or drop a sanitized timeline JSON.

```bash
python3 -m http.server 8767
# http://localhost:8767/
```

## Layout

- `index.html` / `styles.css` / `app.js` — website
- `data/manifest.json` — sample index
- `data/runs/*.json` — sanitized `chan-sim-timeline/v1` copies

## License

MIT
