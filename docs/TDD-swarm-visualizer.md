# TDD — swarm-visualizer

Status: spec only. Nothing here is implemented yet. Every task below starts with a failing test.
Repo: `Mkultra00/swarm-visualizer` (public). Event: Gemini 4 NYC, 2026-11-21.
Sources I read before writing this: `README.md`, `index.html`, `app.js`, `data/manifest.json`, `data/runs/6bec75ed.json`.
Revision 2 (2026-11-21) also folds in `inputs/brief-addendum.md` (runs table, per-run viz as primary artifact, Gemini voice) and `inputs/brief-addendum-analysis.md` (fair Gemini vs past-LLM compare, cost). Additions are marked **(rev 2)**. Contracts and tasks T0–T17 are unchanged. The old T18 (Compare UI) is now **T27** and the old T19 (CI) is now **T28**. Their content is the same, extended where noted.

Labels used in this doc:

| Label | Meaning |
|---|---|
| `[CONTRACT]` | Behavior a test pins down. Breaking it is a bug. |
| `[DECISION]` | A choice made here. Change it on purpose, and update the tests when you do. |
| `[LIVE]` | Depends on something that doesn't exist yet (for example a real Gemini run). |
| `[GAP]` | A defect or missing piece in the current stub that a task below fixes. |
| `[VERIFY]` | A human checks this by hand or against the lab. No automated test covers it. |

---

## 1. Goal, architecture, stack

### Goal

A public static website that loads **sanitized, after-run** swarm timelines (`chan-sim-timeline/v1`) from the M4 lab and:

1. **visualizes each attack run** as a layered swarm with play/scrub and a FRAME / RUN / AGENT LLM HUD. **(rev 2)** This is the primary artifact. Every run in the manifest has its own deep-linkable view, and the page explains in plain language what the motion means (§4.8).
2. **tabulates** every run in a first-class **table of outputs**, one row per run, with a link to that run's visualization (§4.7). **(rev 2)**
3. **analyzes** each run: counts, duration, coverage, by-layer, by-agent, by-status, time-to-first-publish
4. **briefs** each run in one paragraph built only from those numbers
5. **narrates** each run after the fact in a **Gemini voice** (`gemini-3.8-live`). The audio is rendered locally from a numbers-only script and served as a static file. The voice explains the clip. It never claims to be the agent (§4.9). **(rev 2)**
6. **compares** a new Gemini run with past-LLM baselines on the same frame, including cost only when the run log carries it (§5.3–§5.5). **(rev 2, `[LIVE]`)**

The attack engines stay on the lab Mac. This repo does not run, trigger or describe attacks.

### Architecture

```
data/manifest.json ──┐
data/runs/*.json  ───┼─ fetch (same-origin GET) ─┐
dropped file  ───────┘  or FileReader            │
                                                 ▼
                                  analyzer.js  (pure, no DOM)
                                  validateTimeline → analyze → brief
                                  runMetrics, costOf, fairCompare,      (rev 2)
                                  narrationScript                       (rev 2)
                                                 │
                                  viz-model.js (pure, no DOM)
                                  hudModel, cursorToTime, visibleAt,
                                  laneOrder, layerX, nextCursor,
                                  runRow, formatCell, parseRunHash,     (rev 2)
                                  LAYER_EXPLAIN, EXPLAINER              (rev 2)
                                                 │
                                  app.js (DOM + canvas glue only)
                                  textContent only, no innerHTML
                                  runs table, per-run viz, voice overlay (rev 2)
                                                 ▲
media/narration/<id>.json + .wav ── same-origin GET (rev 2)
        ▲
        └── tools/narrate.mjs  (LOCAL ONLY, reads GEMINI_API_KEY from env,
                                sends only the narration script text, writes
                                the sidecar + audio; never runs in the browser)
```

- `[DECISION]` Split the stub's `app.js` into two pure modules (`analyzer.js`, `viz-model.js`) plus a thin DOM layer (`app.js`). The pure modules are tested in Node. The canvas drawing isn't unit-tested; its geometry comes from `viz-model.js`, which is.
- `[DECISION]` The pure modules use a UMD-style footer so the same file runs as a classic `<script>` on GitHub Pages and as `require()` in Node:
  ```js
  (function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.SwarmAnalyzer = api;            // viz-model.js → root.SwarmViz
  })(typeof self !== "undefined" ? self : this, function () { /* ... */ return { ... }; });
  ```
  No bundler and no ES-module import maps, because classic scripts work the same in every browser and in Node.
- `[DECISION]` **(rev 2)** The Gemini API is called **only** from `tools/narrate.mjs` on the operator's machine. The browser never calls any model, holds any key, or opens a socket. "Optional Live API only when a key is local" from the addendum is met by running the Live API in that local tool, not in the page.
- `[DECISION]` **(rev 2)** The default visualization stays the **canvas** layered swarm. Gource or WebGL rendering stays optional and needs an explicit go-ahead (T29). Narration and caption contracts apply to whichever clip is shown.

### Stack

| Piece | Choice |
|---|---|
| Site | Static HTML, CSS and vanilla JS. GitHub Pages serves the repo root. |
| Tests | `node:test` + `node:assert/strict` (Node ≥ 20). **No npm dependencies.** |
| DOM tests | None in v1. `[DECISION]` DOM behavior is limited to glue code. It's covered by a static check (no `innerHTML` in `app.js`) and a `[VERIFY]` manual checklist (§6.3). |
| Runtime network | Same-origin GETs of `data/manifest.json`, `data/runs/*.json` and **(rev 2)** `media/narration/*.json` / `*.wav` only. No CDNs, fonts, analytics or API calls. |
| Secrets | None in the repo. No `.env`, no API keys, nothing in `localStorage`. **(rev 2)** `GEMINI_API_KEY` exists only in the operator's shell environment when they run `tools/narrate.mjs`. It is never written to disk by the tool, never committed and never shipped to the browser. |
| Narration voice **(rev 2)** | `gemini-3.8-live` via the Gemini Live API, called from `tools/narrate.mjs` (Node ≥ 20, built-in `fetch`/`WebSocket`, no npm deps). `[VERIFY]` the exact model id string and that it returns audio for a text-only turn. `[LIVE]` until then. |

- `[GAP]` The README says "Open `index.html`". Under `file://`, `fetch("data/manifest.json")` fails in Chrome and Firefox. Supported paths are `python3 -m http.server` or GitHub Pages. Drop-JSON still works under `file://` because it uses `FileReader`. Task T15 adds a visible message when the manifest fetch fails.

---

## 2. Data contracts

### 2.1 Timeline `chan-sim-timeline/v1` `[CONTRACT]`

The top-level fields the analyzer reads are below. All others are ignored and never rendered.

| Field | Type | Used for |
|---|---|---|
| `schema` | `"chan-sim-timeline/v1"` exactly | validation |
| `exam` | label string | RUN |
| `campaign_stem` | label string | RUN, manifest lookup |
| `target_name` | label string | FRAME |
| `started_at`, `window_end_at` | ISO-8601 UTC | `window_s`, **(rev 2)** `t_first_publish` |
| `coverage` | object (see below) | coverage block |
| `event_count` | int | consistency check (warning only) |
| `events` | array | everything else |
| `agent_llm` | optional label string | HUD fallback `[DECISION]` (not in v1 files today) |
| `cost` **(rev 2)** | optional object, §2.4 | cost columns. Not in any v1 file today. |

Each event has **exactly** these keys: `ts, agent_id, role, layer, status, finding_class`.

- `ts`: ISO-8601 UTC with 0–9 fractional digits and a trailing `Z`
- `agent_id`, `role`, `status`: label strings
- `layer`: one of `human | recon | scope | proven-gate | publish`. Any other value is an **off-layer** event: counted under `"unknown"` and not plotted.
- `finding_class`: label string or `null`

**Label string** `[DECISION]`: matches `^[A-Za-z0-9 ._:+-]{1,48}$`. It must **not** match any forbidden pattern in §2.3. This allows `Vault Notes`, `crAPI`, `glm-5.3:cloud`, `gpt-oss:20b`, `gemini-3.8-live`, `proven-gate` and `nuclei`, and rejects URLs, slashes, quotes and markup.

### 2.2 Manifest `swarm-visualizer/manifest/v1` `[CONTRACT]`

```json
{ "schema": "swarm-visualizer/manifest/v1",
  "runs": [ { "id": "6bec75ed", "file": "data/runs/6bec75ed.json",
              "frame": "crAPI", "run": "crapi-1", "llm": "gpt-oss:20b" } ] }
```

- `id` equals the run file's `campaign_stem`.
- `file` is a relative path under `data/runs/` with no `..`.
- `llm` is the worker that **actually ran** that run, as recorded on the lab side. It is never a guess and never a default.
- **(rev 2)** `id` also matches `^[A-Za-z0-9_-]{1,32}$`, because it's used in the `#run=<id>` viz link (§4.7).
- **(rev 2)** Optional `billing`: `"local"` or `"api"`. It records how the worker was paid for, as the lab recorded it. `"local"` means the model ran on lab hardware and has **$0 API cost** (compute, not billed). `"api"` means billed. If it's absent, billing is unknown. `[DECISION]` The site never infers `billing` from the model name (for example from `:cloud` or `oss`). `[VERIFY]` The lab confirms that `gpt-oss:20b` ran locally before `"billing":"local"` is added to those two entries. The billing for `glm-5.3:cloud` stays absent unless the lab has a bill for it.
- **(rev 2)** `[CONTRACT]` No manifest `llm` equals the narrator model id (`gemini-3.8-live`) unless the lab record says that model ran the swarm. The narrator is not a worker. T7 is extended in T24 to enforce this.

Current manifest, pinned by test T7:

| id | frame | run | llm |
|---|---|---|---|
| 7b5ee689 | Vault Notes | exam 7 | glm-5.3:cloud |
| 7c2756ff | Vault Notes | exam 8 | glm-5.3:cloud |
| 28bdd7b7 | Vault Notes | exam 9 | glm-5.3:cloud |
| 7eaf9541 | Juice Shop | juiceshop | gpt-oss:20b |
| 6bec75ed | crAPI | crapi-1 | gpt-oss:20b |

- `[VERIFY]` For the three Vault Notes runs and Juice Shop, confirm that `target_name` and `exam` in each run file match the manifest's `frame` and `run`. I only read the crAPI file. T7 asserts `frame === target_name` for every entry. If a Vault Notes file uses a different `exam` string, fix the manifest, not the test.

### 2.3 Sanitize gate `[CONTRACT]`

`validateTimeline` rejects the whole file (`ok: false`) if **any** string anywhere in the file (keys and values, recursively, top-level included) matches one of these patterns:

| Name | Pattern (JS, case-insensitive where it says `/i`) |
|---|---|
| ipv4 | `/\b\d{1,3}(\.\d{1,3}){3}\b/` |
| ipv6-ish | `/\b[0-9a-f]{1,4}(:[0-9a-f]{1,4}){3,7}\b/i` |
| host:port | `/\b[\w.-]+:\d{2,5}\b(?![\w.])/` (does not hit `gpt-oss:20b`, because `20b` isn't all digits) |
| url | `/\b[a-z][a-z0-9+.-]*:\/\//i` |
| cve-id | `/\bCVE-\d{4}-\d{3,}\b/i` |
| bearer/jwt | `/\bbearer\s+\S+/i`, `/\beyJ[A-Za-z0-9_-]{10,}\./` |
| cred words | `/\b(password|passwd|secret|api[_-]?key|token|cookie|session[_-]?id)\b\s*[:=]/i` |
| google key | `/\bAIza[0-9A-Za-z_-]{35}\b/` |
| openai-style key | `/\bsk-[A-Za-z0-9]{20,}\b/` |
| querystring | `/\?[\w.-]+=/` |

It also rejects when:

- an event has a key outside the six allowed fields
- `ts` doesn't parse
- a label field fails the label-string rule
- **(rev 2)** `cost` is present and fails §2.4 (rule `cost`)

The run file's own `sanitize` description string is exempt from the pattern check. The exemption is by key name only, and that string is never rendered.

- `[DECISION]` The site **rejects**. It never "cleans". A file that fails the gate isn't shown at all, and the error lists only rule names and JSON paths, never the matched text. Example: `events[12].status: label-string`.
- `[DECISION]` A mismatch between `event_count` and `events.length` is a **warning** (shown in the analyzer panel), not a rejection.
- **(rev 2)** Note for T19: the key `tokens_in` does not trip `cred words`, because `\btoken\b` needs a word boundary after `token`, and keys are scanned as standalone strings without a following `:`/`=`. T19 pins this with a near-miss case.

### 2.4 Cost block (optional) **(rev 2)** `[CONTRACT]`

Sanitized v1 files carry **no** cost, token, model or latency fields. A **new** lab export may add:

```json
"cost": { "tokens_in": 123456, "tokens_out": 7890, "usd": 0.4213 }
```

| Key | Type | Rule |
|---|---|---|
| `tokens_in` | integer ≥ 0 | optional |
| `tokens_out` | integer ≥ 0 | optional |
| `usd` | finite number ≥ 0 | optional; what the provider billed for this run |
| `usd_micros` | integer ≥ 0 | optional; billed micro-dollars. If both `usd` and `usd_micros` are present they must agree to within 1 micro, otherwise reject (rule `cost`). |

- Any other key inside `cost`, a negative value, `NaN`, a string or a non-integer token count → `ok: false`, `{path:"cost.<key>", rule:"cost"}`.
- `[DECISION]` `usd` is only ever **what the log says was billed**. The site never computes it from tokens × a price, never ships a price table, and never shows a list price as "this run cost". With tokens but no `usd`/`usd_micros`, the usd cell is empty.
- `[LIVE]` No file in `data/runs/` has `cost` today. Until the lab exporter writes it, every token cell is empty, and usd cells are empty except for `billing:"local"` entries (§3.6).

---

## 3. Analyzer contracts (`analyzer.js`)

All functions are pure and deterministic. None of them touches the DOM, the clock or the network.

### 3.1 `parseTs(ts) → number | NaN` `[CONTRACT]`

- Own regex parser, `[DECISION]`, so results don't vary by engine: `^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$` → `Date.UTC(...)`, with fractional digits **truncated** to milliseconds.
- Invalid input → `NaN`.
- `[GAP]` The stub returns `0` for invalid timestamps. That silently sets `t0` to 1970 and makes the duration about 56 years.

| input | output |
|---|---|
| `"2026-11-19T17:39:27Z"` | `Date.UTC(2026,10,19,17,39,27,0)` |
| `"2026-11-19T17:39:27.429413Z"` | `… ,429` |
| `"2026-11-19T17:39:27.4Z"` | `… ,400` |
| `"2026-11-19 17:39:27"` | `NaN` |
| `""`, `null`, `42` | `NaN` |

### 3.2 `validateTimeline(obj) → { ok, errors[], warnings[], run }` `[CONTRACT]`

- `run` is a normalized copy, present only when `ok` is true. Events are **stably sorted by `parseTs(ts)`**, and each one gets a `_t` (ms) field.
- `[GAP]` The stub takes `t0`/`t1` from the first and last array elements and assumes the array is already sorted.
- `errors` entries look like `{ path, rule }`. They never include the offending value.
- **(rev 2)** When `cost` is valid, `run.cost` is a normalized copy `{tokens_in, tokens_out, usd}` with missing keys set to `null`, and `usd` derived from `usd_micros / 1e6` when only micros are present.

### 3.3 `analyze(run, llmLabel) → Analysis` `[CONTRACT]`

```ts
Analysis = {
  frame: string,            // run.target_name || "lab"
  run: string,              // run.exam || "run"
  stem: string,             // run.campaign_stem || ""
  llm: string,              // llmLabel || "not in log"
  events: number,
  agents: number,           // distinct agent_id
  span_s: number,           // (last _t − first _t)/1000, 0 if < 2 events
  window_s: number | null,  // (window_end_at − started_at)/1000, null if either is missing or invalid
  coverage: { endpoints, findings, verified, unverified, confidence, reached, blocked }
            // each one is a number, boolean or label, or null when missing (rendered as "—")
  byLayer:  Record<string, number>,   // keys in LAYERS order, then "unknown"; zero counts kept for the 5 layers
  byAgent:  Record<string, number>,   // insertion order = first appearance
  byStatus: Record<string, number>,
  byFindingClass: Record<string, number>, // null → "none"
  offLayer: number,
  busiestLayer: string | null,        // max count; ties go to the earlier layer in LAYERS order
  warnings: string[],
}
```

- `[GAP]` The stub labels the event span as the "window". From now on `span_s` and `window_s` are separate, and both are shown.
- `[DECISION]` `run` and `stem` are separate fields. The stub's `"crapi-1 · 6bec75ed"` string is only composed in the HUD.
- **(rev 2)** `[DECISION]` `Analysis` keeps exactly this shape. The new rev-2 numbers live in `runMetrics` (§3.5) so the T4 golden is untouched.

**Golden values for `data/runs/6bec75ed.json` (crAPI / crapi-1)** `[CONTRACT]`. I counted these by hand from the file. T4 pins them.

| metric | value |
|---|---|
| events | 33 |
| agents | 8 |
| span_s | 780.049 (17:39:27.429 → 17:52:27.478) |
| window_s | 838.943 (17:39:27.000 → 17:53:25.943) |
| byLayer | `{human:1, recon:7, scope:4, "proven-gate":17, publish:4}` (no `unknown` key, offLayer 0) |
| byAgent | `{engine:2, memory:1, classifier:3, orchestrator:1, recon:7, exploit:17, scheduler:1, report:1}` |
| byStatus | `{event:1, state:2, milestone:2, thought:1, call:4, tool_call:9, tool_result:9, publish:4, started:1}` |
| byFindingClass | `{none:30, nuclei:3}` |
| busiestLayer | `proven-gate` |
| coverage | `endpoints 7, findings 1, verified 0, unverified 1, confidence "medium", reached true, blocked false` |

- `[DECISION]` T4 reads the real `data/runs/6bec75ed.json`, not a copy. If that file is ever regenerated, the golden test fails, and failing there is the point.

### 3.4 `brief(analysis) → string` `[CONTRACT]`

One paragraph, built from a fixed template. It interpolates **only** numbers, `frame`, `run`, `stem`, `llm` and `busiestLayer`. It never interpolates agent ids, statuses or finding classes, which keeps file-supplied strings out of the prose. It isn't generated by an LLM.

Template:

```
{frame} / {run} ({stem}): {events} events from {agents} agents over {span_s|1dp} s
[ in a {window_s|1dp} s window]. Busiest layer {busiestLayer} ({n}).
Coverage: {endpoints} endpoints, {findings} finding(s), {verified} verified.
AGENT LLM {llm}. After-run lab exam; layer plot is not cause-and-effect.
```

Rules:

- The bracketed `[ in a … window]` part appears only when `window_s` isn't null.
- Write `1 finding` but `0 findings` and `2 findings`. The same rule applies to `event`/`events` and `agent`/`agents`.
- Missing coverage values render as `—`.
- `({stem})` is dropped when `stem` is empty.
- With 0 events the output is exactly `"{frame} / {run}: no events. AGENT LLM {llm}. After-run lab exam."`

Golden for crAPI with `llm = "gpt-oss:20b"`:

```
crAPI / crapi-1 (6bec75ed): 33 events from 8 agents over 780.0 s in a 838.9 s window. Busiest layer proven-gate (17). Coverage: 7 endpoints, 1 finding, 0 verified. AGENT LLM gpt-oss:20b. After-run lab exam; layer plot is not cause-and-effect.
```

Negative contract: the output never contains `"Gemini"` unless `llm` does.

### 3.5 `runMetrics(run, analysis) → Metrics` **(rev 2)** `[CONTRACT]`

These are the fair-compare numbers from the analysis addendum. They're all derived from sanitized v1 fields.

```ts
Metrics = {
  window_s: number | null,             // = analysis.window_s
  t_first_publish: number | null,      // (first event with layer "publish")._t − started_at, in s
  t_first_proven_gate: number | null,  // same for layer "proven-gate"
  events: number, agents: number,      // = analysis
  events_per_min: number | null,       // events / (window_s / 60); null if window_s is null or 0
  layerShare: Record<layer, number>,   // byLayer[k] / events for the 5 LAYERS, 0 when events is 0
  coverage: { endpoints, findings, verified, unverified, reached, blocked }, // = analysis.coverage subset
}
```

- `[DECISION]` The `t_first_*` values are measured from `started_at`, not from the first event, so they include start-up time and are comparable across runs. If `started_at` is missing or invalid, or there's no event on that layer, the value is `null`.
- `[DECISION]` "first publish" means the first event whose **layer** is `publish`, not whose status is `publish`.
- `[DECISION]` `events_per_min` uses `window_s`, not `span_s`.

Golden for crAPI (hand-computed from the file; T18 pins it):

| metric | value |
|---|---|
| t_first_publish | 132.849 (17:39:27.000 → 17:41:39.849, ms-truncated) |
| t_first_proven_gate | 132.849 (17:41:39.849295 → .849) |
| events_per_min | 33 / (838.943 / 60) ≈ 2.3601 (assert within 1e-3) |
| layerShare | `{human:1/33, recon:7/33, scope:4/33, "proven-gate":17/33, publish:4/33}` |

### 3.6 `costOf(run, entry, verified) → Cost` **(rev 2)** `[CONTRACT]`

```ts
Cost = { tokens_in: number|null, tokens_out: number|null, usd: number|null,
         usd_per_verified: number|null, basis: "log" | "local-not-billed" | null }
```

Rules, in order:

1. If `run.cost` is present and has `usd` → `basis "log"`, with `usd` and the token values taken from the log.
2. Else if `entry && entry.billing === "local"` → `usd 0`, `basis "local-not-billed"`. Token values come from `run.cost` if it's present, otherwise `null`.
3. Else → `usd null`, `basis null`, token values from `run.cost` if present. **Tokens alone never produce a usd value.**

- `usd_per_verified` = `usd / verified` when `usd !== null` and `verified > 0`, otherwise `null`. This covers local runs with 0 verified, which give `null`, not `0`.
- `[CONTRACT]` For every one of the five current runs, with today's manifest (no `billing` yet): `usd`, `tokens_in`, `tokens_out` and `usd_per_verified` are all `null`.
- `[CONTRACT]` `analyzer.js` has no price constant. T19 checks this statically: no identifier matching `/price|per_?1[km]|per_?million/i`.

### 3.7 `narrationScript(analysis, metrics) → string` **(rev 2)** `[CONTRACT]`

This is the text the Gemini voice reads. It's a fixed template, like `brief`. It isn't generated by an LLM. It interpolates **only** numbers, `frame`, `run`, `llm` and `busiestLayer`. It never interpolates agent ids, roles, statuses or finding classes.

Template (sentences in brackets are dropped when their value is null):

```
{frame}, {run}. This is an after-run replay of a lab exam, not a live attack.
The agent LLM for this run was {llmSpoken}.
{agents} agents produced {events} events[ over a {window_s|0dp}-second window].
Each row is one agent; each column is a stage, from human on the left to publish on the right.
Most activity was in the {busiestLayer} stage, with {n} events.
[The first publish came {t_first_publish|0dp} seconds in.]
Coverage: {endpoints} endpoints, {findings} finding(s), {verified} verified.
Nearby dots are not proof that the agents coordinated.
```

- `llmSpoken` = `llm` verbatim (the real worker id, for example `gpt-oss:20b`). The one exception is `"not in log"`, which becomes `not recorded in the log`.
- `[CONTRACT]` The script matches `/gemini/i` **only** when `isGeminiWorker(analysis.llm)` is true. The narrator never names itself in the script. Its credit is UI text (§4.9), not spoken.
- Same plural rules as §3.4. Missing coverage values are spoken as `not recorded`.
- With 0 events the output is exactly `"{frame}, {run}. After-run lab exam with no events. The agent LLM for this run was {llmSpoken}."`

Golden for crAPI with `llm = "gpt-oss:20b"` (one line):

```
crAPI, crapi-1. This is an after-run replay of a lab exam, not a live attack. The agent LLM for this run was gpt-oss:20b. 8 agents produced 33 events over a 839-second window. Each row is one agent; each column is a stage, from human on the left to publish on the right. Most activity was in the proven-gate stage, with 17 events. The first publish came 133 seconds in. Coverage: 7 endpoints, 1 finding, 0 verified. Nearby dots are not proof that the agents coordinated.
```

`[DECISION]` "a 839-second" is kept on purpose. The template doesn't do a/an agreement, so the golden stays stable.

---

## 4. Visualizer contracts (`viz-model.js` + `app.js`)

### 4.1 Pure model (`viz-model.js`) `[CONTRACT]`

| Function | Contract |
|---|---|
| `LAYERS` | `["human","recon","scope","proven-gate","publish"]`, frozen |
| `cursorToTime(c, t0, t1)` | `c` ∈ [0,1000] is clamped. Returns `t0 + (t1−t0)·c/1000`. If `t1 <= t0`, returns `t1` for any `c > 0` and `t0` for `c = 0`. |
| `visibleAt(events, cutoffMs)` | Events with `_t <= cutoffMs`, in sorted order (inclusive cutoff). |
| `laneOrder(events)` | Distinct `agent_id`s in **first-appearance order over the full run**. `[GAP]` The stub recomputes lanes from the visible events, so lanes jump during play. |
| `laneY(i, n, h)` | `n === 1` → `h/2`. Otherwise evenly spaced from 60 to `h−40`. |
| `layerX(layer, w)` | Index in `LAYERS` → `80 + i·(w−120)/4`. Unknown layer → `null` (not drawn). `[GAP]` The stub's `Math.max(0, indexOf)` draws unknown layers in the `human` column. |
| `nextCursor(c, dtMs, playMs = 8000)` | `min(1000, c + 1000·dtMs/playMs)`, so a full play lasts 8 s on any refresh rate. `[GAP]` The stub adds `+4` per animation frame, so playback speed depends on the frame rate. |
| `hudModel({ manifest, entry, run })` | Returns `{frame, run, llm}`, see §4.2. |
| `markRadius(ev)` | `status === "publish"` → 6, otherwise 4. |
| `runRow(...)` **(rev 2)** | §4.7 |
| `formatCell(key, value)` **(rev 2)** | §4.7 |
| `parseRunHash(hash, manifest)` **(rev 2)** | §4.7 |
| `LAYER_EXPLAIN`, `EXPLAINER` **(rev 2)** | §4.8, frozen |
| `narrationPlayMs(sidecar)` **(rev 2)** | §4.9 |

### 4.2 HUD `[CONTRACT]`

- **FRAME** = `run.target_name`, otherwise `entry.frame`, otherwise `"lab"`.
- **RUN** = `` `${run.exam} · ${run.campaign_stem}` ``. When there's no stem, it's just `exam`.
- **AGENT LLM** is resolved in this order:
  1. `entry.llm`, when the run was picked from the manifest
  2. the manifest entry whose `id === run.campaign_stem`. This covers someone dropping a file that's also a sample, so the label isn't lost. `[GAP]` The stub forces `"not in log"` on every dropped file.
  3. `run.agent_llm`, if present and a valid label string
  4. `"not in log"`
- `[CONTRACT]` No code path produces `"gemini"` (case-insensitive) unless it was literally in step 1, 2 or 3. T13 tests all five manifest runs and asserts the HUD llm equals the manifest `llm` and doesn't match `/gemini/i`.
- `[DECISION]` The `<option>` text in the sample picker uses the same `hudModel` output (`frame · run · llm`).
- **(rev 2)** `[CONTRACT]` `hudModel` never takes the narration sidecar as input. The narrator's model id can't reach the HUD.

### 4.3 Play / scrub `[CONTRACT]`

- The scrub range is `0..1000`. Loading a run sets the cursor to 1000 (the full run is shown).
- Play from 1000 restarts at 0. Pause keeps the cursor where it is. Reaching 1000 stops playback and sets the button back to "Play".
- The counter `visible / total` reflects `visibleAt(...).length`.
- The `requestAnimationFrame` loop uses the timestamp passed in for `dtMs`.
- **(rev 2)** While narration is playing, `playMs` = `narrationPlayMs(sidecar)` instead of 8000, so the clip and the voice end together (§4.9).

### 4.4 Layered swarm drawing `[VERIFY]`

- There's one vertical guide per layer, labelled and colored with `LAYER_COLOR` (same colors as the stub).
- There's one horizontal lane per agent, ordered by `laneOrder` and labelled on the left.
- Each visible event is a dot at `(layerX, laneY)`. A faint segment joins each agent's consecutive dots, which shows that agent's **own** layer path. Nothing connects different agents.
- Off-layer events aren't drawn. The analyzer panel shows an `off-layer: n` line when n > 0.
- **(rev 2)** The canvas carries a caption strip drawn from `hudModel` only (`FRAME / RUN / AGENT LLM`). Nothing in the canvas reads the narration sidecar.

### 4.5 Drop JSON `[CONTRACT]`

- A dropped file goes through `JSON.parse` → `validateTimeline`. On failure, the panel shows `Rejected: <rule> at <path>` for at most 5 errors, as text. Nothing is drawn and the previous run is cleared.
- `[DECISION]` A file larger than 5 MB is rejected before it's parsed.
- `[GAP]` In the stub, a JSON parse error throws an uncaught exception and the UI is left stale.
- **(rev 2)** A dropped run never gets narration audio, even if its stem matches a manifest id. `[DECISION]` Audio is tied to the manifest entry, and a dropped file might differ from the file the audio was made from.

### 4.6 Rendering safety `[CONTRACT]`

- `app.js` never uses `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. It builds bars and stats with `createElement` + `textContent`.
- `[GAP]` The stub's `bars()` and `renderStats()` interpolate file-supplied `agent_id` and `layer` values into `innerHTML`. That's an XSS path through Drop JSON.
- T14 enforces this with a static scan of `app.js`.
- **(rev 2)** The same applies to the runs table, the explainer and the voice overlay. Table `href`s are built only by `runRow` (§4.7), never from file strings.

### 4.7 Table of outputs **(rev 2)** `[CONTRACT]`

This is a first-class section of `index.html` (`<section id="runs">`), with one row per manifest entry, in manifest order.

`runRow({ entry, run, analysis, metrics, cost }) → Row`:

| Column (header text) | Row key | Source | Display via `formatCell` |
|---|---|---|---|
| FRAME | `frame` | `hudModel(...).frame` | text |
| RUN | `run` | `analysis.run` | text |
| stem | `stem` | `analysis.stem` | text |
| events | `events` | `analysis.events` | integer |
| agents | `agents` | `analysis.agents` | integer |
| window_s | `window_s` | `metrics.window_s` | 1 dp, `—` if null |
| t_first_publish | `t_first_publish` | `metrics.t_first_publish` | 1 dp, `—` if null |
| endpoints | `endpoints` | `analysis.coverage.endpoints` | integer, `—` if null |
| verified | `verified` | `analysis.coverage.verified` | integer, `—` if null |
| AGENT LLM | `llm` | `hudModel(...).llm` | text |
| usd | `usd` | `cost.usd` | **empty string if null**; `basis "local-not-billed"` → `$0 API (compute not billed)`; `basis "log"` → `$` + 4 dp |
| usd / verified | `usd_per_verified` | `cost.usd_per_verified` | empty string if null, otherwise `$` + 4 dp |
| viz | `href` | `"#run=" + encodeURIComponent(entry.id)` | link text `view` |

- `[DECISION]` Cost cells use an **empty** cell when missing, as the addendum asks. Other missing cells use `—`, the same as §3.3. The `usd / verified` column comes from the analysis addendum. The token columns are not in the main table. They appear in the compare cost block (§5.5).
- `[CONTRACT]` A row never contains `/gemini/i` unless `isGeminiWorker(row.llm)` is true. `runRow` doesn't accept the narration sidecar.
- `[CONTRACT]` Every row's `href` matches `^#run=[A-Za-z0-9_-]{1,32}$`.
- `parseRunHash(hash, manifest)` → the manifest entry for `#run=<id>`, or `null` for anything else (unknown id, a missing `#`, extra params, or a URL-encoded slash). Loading the page with a valid hash opens that run's viz. Clicking a row's link sets the hash, loads that run and scrolls to the viz.
- `[DECISION]` On load, `app.js` fetches **all** manifest run files (5 small files) so the table can be filled. If a run file fails the gate, its row shows `rejected` in the events cell, every other cell is empty, and it has no viz link.

Golden row for crAPI with today's manifest (T20):

```js
{ frame:"crAPI", run:"crapi-1", stem:"6bec75ed", events:33, agents:8,
  window_s:838.943, t_first_publish:132.849, endpoints:7, verified:0,
  llm:"gpt-oss:20b", usd:null, usd_per_verified:null, href:"#run=6bec75ed" }
// formatCell: window_s "838.9", t_first_publish "132.8", usd "", usd_per_verified ""
```

After the lab adds `"billing":"local"` to the crAPI entry (`[VERIFY]`), the expected value is `usd:0` with display `$0 API (compute not billed)`, while `usd_per_verified` stays `null` because verified is 0.

### 4.8 Per-run visualization and plain-language explainer **(rev 2)** `[CONTRACT]`

The visualization of each run is the primary artifact.

- `[DECISION]` Page order: (1) HUD + canvas + play/scrub (+ voice overlay), (2) "What you're seeing" explainer, (3) table of outputs, (4) analyzer stats + brief, (5) compare (later). The first screen is always a viz.
- Every manifest run is reachable by its own `#run=<id>` link. Without a hash, the first manifest entry loads, as before.
- `LAYER_EXPLAIN` is a frozen map with one plain-language line per layer, shown as the column legend. `[VERIFY]` Frank confirms these meanings match the lab's layer semantics.

  | layer | line |
  |---|---|
  | human | Start: the operator kicks off the lab run. |
  | recon | Mapping: agents list what the practice app exposes. |
  | scope | Scope: agents decide what is in bounds and what to look at next. |
  | proven-gate | Proof check: agents try to confirm a finding under the lab's own gate. |
  | publish | Report: candidate or confirmed results get written up. |

- `EXPLAINER` is a frozen array of short paragraphs, shown as text:
  1. Each row is one agent in the swarm. Each column is a stage, left to right: start, mapping, scope, proof check, report.
  2. A dot appears when an agent logged an event in that stage. Bigger dots are report events.
  3. A faint line joins one agent's own dots in time order, so you can follow that agent between stages. Lines never join two different agents.
  4. Press Play to replay the whole run in 8 seconds, or in step with the narration. The counter shows how many events have happened so far.
  5. Dots that are close in time don't mean agents were coordinating, and more dots don't mean a better run.
  6. This is an after-run replay of a lab exam against a practice app on a lab machine. It shows no requests, payloads, findings or targets.
- `[CONTRACT]` Every string in `LAYER_EXPLAIN` and `EXPLAINER`:
  - passes the §2.3 forbidden-pattern scan
  - does not match `/\b(payload|inject\w*|sqli|xss|rce|shell|bypass|exploit\w*|cve)\b/i`. The `exploit` agent id still appears as a lane label from the data, but the copy never explains a technique.
  - mentions "after-run" at least once across the set (T21)

### 4.9 Gemini voice overlay **(rev 2)** `[CONTRACT]`

The narration is an after-run explanation of the clip. It is not a live hunt and not a model call from the page.

**Sidecar** `media/narration/<id>.json`, schema `swarm-visualizer/narration/v1`:

```json
{ "schema": "swarm-visualizer/narration/v1",
  "run_id": "6bec75ed",
  "voice_model": "gemini-3.8-live",
  "script_text": "<exact narrationScript output>",
  "script_sha256": "<hex of script_text, UTF-8>",
  "audio": "media/narration/6bec75ed.wav",
  "duration_ms": 31000,
  "rendered_at": "2026-11-21T00:00:00Z" }
```

- `run_id` is a manifest id. `audio` sits under `media/narration/` with no `..`. `duration_ms` is an integer from 1000 to 120000. The audio file is at most 3 MB.
- `[CONTRACT]` `script_text === narrationScript(analyze(run, entry.llm), runMetrics(run, ...))` for the current run file, and `script_sha256` matches. If the run file is regenerated, the stale sidecar fails T24. Re-render it rather than editing the text.
- `[CONTRACT]` The sidecar and audio contain no key. `voice_model` is a label string. The sidecar passes the §2.3 scan.
- `narrationPlayMs(sidecar)` → `sidecar.duration_ms` when valid, otherwise `8000`.

**Overlay UI** (`app.js`):

- A "Play with narration" button appears only when the selected **manifest** entry has a sidecar (fetched with a same-origin GET; a 404 means no button). It starts the audio and the scrub from 0 with `playMs = duration_ms`. Pause pauses both. Scrubbing by hand stops the audio.
- A transcript panel shows `script_text` via `textContent`.
- The credit line, outside the canvas and outside the HUD, is exactly: `Narrator voice: gemini-3.8-live, reading the numbers above after the run. The narrator did not run this exam.`
- `[DECISION]` My reading of "do not stamp Gemini on glm/oss clips": the HUD, the canvas caption, the table row, the brief and the spoken script never say Gemini for a baseline run. The narrator credit is allowed because it names the narrator, and it sits in the narration control, clearly separate from AGENT LLM. If Frank reads it more strictly, move the credit to the README/about text only. That's a one-line change, and T25 keeps the other checks.
- `[CONTRACT]` The script names the **real worker id** (`glm-5.3:cloud`, `gpt-oss:20b`), never the narrator.

**Local render tool** `tools/narrate.mjs` (operator machine only):

- Usage: `GEMINI_API_KEY=… node tools/narrate.mjs <run-id>` (the key comes from the shell or a gitignored `.env` that the operator sources; the tool never reads files for keys).
- It loads the manifest entry and run file, runs `validateTimeline` and computes `narrationScript`. It sends **only** `script_text` to `gemini-3.8-live`, with a fixed instruction to read the text verbatim and add nothing. It writes the audio as WAV plus the sidecar.
- `[CONTRACT]` The tool reads the key only from `process.env.GEMINI_API_KEY`. It never logs, prints or writes the key and never puts it in a URL that gets logged. It refuses to run if the run fails the gate.
- `[VERIFY]` Listen to each clip and check it reads the transcript verbatim with no added words. A model can drift. If it adds words, re-render or drop the clip.
- `[LIVE]` No sidecar exists until someone with a local key runs the tool. Until then, the overlay button doesn't appear, and the page works as before.
- `[GAP]` T8's "no `fetch(` to an absolute http URL in `*.js`" rule must not be weakened. `tools/narrate.mjs` uses the `.mjs` extension, and T24 adds a separate rule: only `tools/narrate.mjs` may reference the Gemini API host or `GEMINI_API_KEY`, and no browser-loaded file may.

---

## 5. Compare view (later)

Not in the first cut. T17 and T26–T27 come after T0–T16 and T18–T25 are green.

### 5.1 `isGeminiWorker(id) → boolean` `[CONTRACT]`

- `true` only when `id` matches `^gemini-[a-z0-9][a-z0-9.\-:]*$` (case-insensitive) **and** isn't one of `"not in log"`, `""` or `"gemini"` (a bare word isn't a worker id).
- `false` for `glm-5.3:cloud`, `gpt-oss:20b`, `"Gemini"`, `"gemini"`, `"not in log"`, `"my-gemini-run"` and `"gemini-"`.
- `[VERIFY]` Record the exact Gemini worker id string the lab used for the run (whatever the lab exporter's `--llm` flag was set to). It goes into the manifest verbatim. This repo never invents or normalizes it.
- **(rev 2)** Note: `isGeminiWorker("gemini-3.8-live")` is `true`. That's why §2.2 forbids the narrator id as a manifest `llm` without a lab record, and why nothing reads `voice_model` into worker logic.

### 5.2 `compareRuns(a, b) → Compare` `[CONTRACT]`

`a` and `b` are `{ analysis, llm }`. The result is:

```ts
{ label: "Gemini vs baseline" | "baseline vs baseline" | "Gemini vs Gemini",
  left, right,                 // the Gemini side is placed left when the label is "Gemini vs baseline"
  delta: { events, agents, span_s, endpoints, findings, verified,
           byLayer: Record<layer, number> },   // right − left; null if either side is null
  sameFrame: boolean }         // left.frame === right.frame
```

- The label comes **only** from `isGeminiWorker(llm)` on each side.
- `[DECISION]` When `sameFrame` is false, the view shows "different lab surface — counts not comparable" above the deltas. The deltas are still shown.
- `[LIVE]` No Gemini run exists in `data/` today. "Gemini vs baseline" can only be demonstrated after a **new** lab run with a real Gemini worker is sanitized, added to `data/runs/` and given a manifest entry. The five existing runs **must not** be relabelled.
- `[DECISION]` The Compare UI uses two `<select>`s from the manifest and two side-by-side canvases sharing one scrub (normalized 0..1000 per run, not absolute time). The brief is a two-sentence template built from `delta`.

### 5.3 `fairCompare(baseline, gemini) → Fair` **(rev 2)** `[CONTRACT]`

Each side is `{ entry, analysis, metrics, cost }` or `null`.

```ts
Fair = { frame: string, comparable: boolean, reason: string | null,
         rows: Array<{ metric, baseline: number|boolean|null, gemini: number|boolean|null }>,
         insight: string }
```

- Metric rows, in this order: `window_s`, `t_first_publish`, `t_first_proven_gate`, `events`, `agents`, `events_per_min`, `endpoints`, `findings`, `verified`, `unverified`, `reached`, `blocked`, `share_recon`, `share_proven_gate`, `share_publish`. The AGENT LLM for each side comes from `hudModel`, never from a guess.
- `comparable` is true only when both sides are present, `baseline.analysis.frame === gemini.analysis.frame`, `!isGeminiWorker(baseline llm)` and `isGeminiWorker(gemini llm)`. Otherwise `reason` is one of `"no Gemini run on this frame yet"`, `"different lab surface"` or `"gemini side is not a Gemini worker"`.
- `[CONTRACT]` When `gemini` is `null`, every `gemini` cell is `null` and renders **empty**. Those cells are never `0` or `—` and never copied from the baseline. With today's data, `fairCompare` for each of Vault Notes, Juice Shop and crAPI returns `comparable:false`, `reason:"no Gemini run on this frame yet"` and all-null Gemini cells.
- `insight` is one sentence from a fixed template, with numbers only:
  - comparable: `On {frame}, {geminiLlm} reached first publish at {g|0dp} s vs {b|0dp} s for {baseLlm}, with {gv} vs {bv} verified.` (a clause is dropped when one of its values is null)
  - not comparable: `{reason}.` with the first letter capitalised and `{frame}` added: `No Gemini run on {frame} yet.`
- `[CONTRACT]` `insight` never matches `/\b(better|best|worse|wins?|beats?|outperform\w*|superior)\b/i`. The numbers speak for themselves. It never contains `/gemini/i` unless the gemini side is a real Gemini worker.
- `[DECISION]` Baseline choice per frame: the user picks the baseline from that frame's non-Gemini runs. The default is the most recent baseline in manifest order. Vault Notes has three baselines, and they are not averaged. `[DECISION]` One run against one run, as in §6.1.
- `[LIVE]` `[VERIFY]` The first real Gemini runs are the planned lab runs referred to as **Carbon** and **Hydrogen**. Confirm whether those are frame names or run names before T26 pins a fixture. Until they exist, T26 uses only a synthetic `gemini-x-test` fixture under `tests/fixtures/` and never writes into `data/`.

### 5.4 Fair-compare rules (from the analysis addendum) **(rev 2)** `[DECISION]`

- Only same-frame pairs are "fair". A cross-frame pair can be shown via §5.2, but never in the fair table.
- A Gemini result is never inferred from, or drawn on, a glm/oss clip.
- The lab's own gate supplies `verified`. The site can't re-check it (§6.1).

### 5.5 Cost compare **(rev 2)** `[CONTRACT]`

This block sits under the fair-compare table and has one column per side:

| row | source |
|---|---|
| tokens_in | `cost.tokens_in` |
| tokens_out | `cost.tokens_out` |
| usd ($/run) | `cost.usd` |
| usd / verified | `cost.usd_per_verified` |
| basis | `log` → "billed (from run log)"; `local-not-billed` → "$0 API, compute not billed"; `null` → empty |

- Empty cells when null, as in §4.7.
- If the two sides have different `basis` values, a note reads `Billing bases differ; dollar figures are not like-for-like.`
- `[CONTRACT]` No row is computed from a price list. A Gemini side with tokens but no billed usd shows tokens and an empty usd.
- `[LIVE]` All cells are empty until a run log carries `cost` (§2.4) or a manifest entry carries `billing`.

---

## 6. Honest limits, layout, commands

### 6.1 Honest limits (shown in the README and in the footer of the brief panel)

- This is **visualization only**. It has no exploit steps, payloads, CVE ids, live IPs or host:port values, credentials, tokens, finding titles or proof. The sanitize gate (§2.3) rejects files that contain them.
- **Lab exams only**: Vault Notes, Juice Shop and crAPI, run against lab targets on the M4 Mac.
- The **layer plot is not cause-and-effect.** Two agents near each other in time weren't necessarily coordinating. A lane path is one agent's own sequence, not a dependency graph. `attackgraph_counts` in the run files isn't visualized.
- **Counts are not quality.** More events or findings doesn't mean a better run. `Verified` comes from the lab's own gate, and this site can't re-check it.
- **The LLM label is only as good as the lab record.** "not in log" means exactly that.
- **One run isn't a benchmark.** Compare shows deltas between two runs, not statistical claims.
- This repo has no attack stack, and there's nothing to point at a target.
- **(rev 2)** **The narrator is not the agent.** The Gemini voice reads a numbers-only script after the run. It didn't run, steer or judge the exam. Baseline clips keep their real worker id.
- **(rev 2)** **Cost is only what the log says.** Empty means not logged. `$0 API` for local models means no API bill, not zero compute. No list prices are used.
- **(rev 2)** **Gemini cells are empty until a real Gemini run exists.** No Gemini number on this site comes from a glm or oss run.

### 6.2 File layout (target)

```
index.html              # + <script src="analyzer.js">, <script src="viz-model.js"> before app.js
                        # (rev 2) sections: #viz (first), #explain, #runs, #stats, #compare
styles.css
app.js                  # DOM/canvas glue only
analyzer.js             # NEW — pure: parseTs, validateTimeline, analyze, brief, isGeminiWorker, compareRuns
                        # (rev 2) + runMetrics, costOf, narrationScript, fairCompare
viz-model.js            # NEW — pure: LAYERS, LAYER_COLOR, cursorToTime, visibleAt, laneOrder, laneY, layerX, nextCursor, hudModel, markRadius
                        # (rev 2) + runRow, formatCell, parseRunHash, LAYER_EXPLAIN, EXPLAINER, narrationPlayMs
data/manifest.json      # (rev 2) optional per-entry "billing", only from the lab record
data/runs/*.json
media/narration/        # (rev 2) <id>.json sidecar + <id>.wav, rendered locally; may be empty
tools/narrate.mjs       # (rev 2) LOCAL ONLY Gemini Live render tool; key from env
package.json            # NEW — {"private":true,"scripts":{"test":"node --test tests/"}}, no dependencies
tests/
  smoke.test.js
  parse-ts.test.js
  validate.test.js
  analyze.test.js
  brief.test.js
  data-gate.test.js
  repo-hygiene.test.js
  viz-model.test.js
  hud.test.js
  render-safety.test.js
  compare.test.js
  metrics.test.js       # (rev 2) T18
  cost.test.js          # (rev 2) T19
  runs-table.test.js    # (rev 2) T20, T22
  explainer.test.js     # (rev 2) T21
  narration.test.js     # (rev 2) T23–T25
  fair-compare.test.js  # (rev 2) T26
  fixtures/
    tiny.json           # 4 events, hand-built, includes an off-layer event and unsorted ts
    dirty-ip.json       # one event status contains an IPv4 → must be rejected
    extra-field.json    # event has "payload" key → must be rejected
    cost-ok.json        # (rev 2) tiny + valid cost block
    cost-bad.json       # (rev 2) tiny + cost with a negative usd and an extra key
    gemini-synth.json   # (rev 2) synthetic same-frame run, llm via test manifest "gemini-x-test"; never in data/
docs/TDD-swarm-visualizer.md
```

- `[GAP]` `inputs/` is untracked in the working tree. The hygiene test (T8) scans every file outside `.git/` and `node_modules/`, so `inputs/` either passes the gate or goes into `.gitignore` before the first commit. Decide in T8. If it holds raw (unsanitized) lab output, it must be gitignored **and** moved off the repo path.
- `[DECISION]` Fixture strings that must trip the gate use RFC 5737 documentation addresses (`192.0.2.x`), never real lab addresses. `repo-hygiene` allowlists only `tests/fixtures/dirty-*.json`.
- **(rev 2)** `[DECISION]` The hygiene content scan (T8) covers text files only. `media/narration/*.wav` is skipped as binary, and its safety comes from the sidecar check (T24) and the fact that the audio is rendered from the checked script.

### 6.3 Commands

| What | Command |
|---|---|
| All tests | `node --test tests/` (equivalent: `npm test`) |
| One file | `node --test tests/analyze.test.js` |
| Serve locally | `python3 -m http.server 8767`, then open `http://127.0.0.1:8767/` |
| Node version | `node --version` → ≥ v20 |
| Render narration **(rev 2, local only)** | `GEMINI_API_KEY=… node tools/narrate.mjs 6bec75ed` |

Manual checklist `[VERIFY]`, run after T15, T16, T22, T25 and T27:

1. Serve locally and load the page. crAPI isn't first in the manifest, so the first sample, Vault Notes exam 7, loads. The HUD reads `Vault Notes / exam 7 · 7b5ee689 / glm-5.3:cloud`.
2. Pick crAPI. The brief matches the §3.4 golden text exactly.
3. Press Play. Playback lasts about 8 s, agent lanes don't reorder, and the counter ends at `33 / 33`.
4. Scrub to 0. The counter reads `0 / 33` or `1 / 33` (inclusive cutoff at t0 → `1 / 33`).
5. Drop `tests/fixtures/dirty-ip.json`. You see a "Rejected" message, the canvas is cleared, and no part of the IP appears anywhere on the page.
6. Drop `data/runs/6bec75ed.json`. The HUD llm reads `gpt-oss:20b` (manifest lookup), not "not in log".
7. In DevTools → Network, the only requests are same-origin `.html`, `.css`, `.js`, `.json` and **(rev 2)** `.wav` files.
8. Repeat 1–3 in Safari and Firefox.
9. **(rev 2)** The viz is the first thing on screen. The "What you're seeing" text sits right below it and reads as plain language.
10. **(rev 2)** The runs table has 5 rows in manifest order. The crAPI row reads `crAPI · crapi-1 · 6bec75ed · 33 · 8 · 838.9 · 132.8 · 7 · 0 · gpt-oss:20b`, and its usd cells are empty (or `$0 API (compute not billed)` once `billing:"local"` is in the manifest). Clicking `view` opens `#run=6bec75ed` and shows the crAPI viz. Reloading with that hash opens crAPI directly.
11. **(rev 2)** With a rendered sidecar for crAPI: "Play with narration" appears. Voice and clip end together. The transcript matches the §3.7 golden. The spoken worker id is `gpt-oss:20b`. The HUD, caption and table row show no "Gemini". The credit line is outside the canvas. Without a sidecar, there's no button and no console error beyond the 404.
12. **(rev 2)** `git grep -n GEMINI_API_KEY` lists only `tools/narrate.mjs`, the README run note and this doc. `git grep -nE 'AIza[0-9A-Za-z_-]{35}'` finds nothing.
13. **(rev 2)** Compare (after T27): each frame's fair table shows empty Gemini cells and "No Gemini run on <frame> yet." No usd figure appears that isn't in a log or a `billing:"local"` entry.

---

## 7. Task list

Every task follows the same loop:

1. Write the failing test at the exact path given.
2. Run it and see it **fail** for the stated reason.
3. Implement the change in the stated files.
4. Run it and see it **pass**. Then run `node --test tests/` to make sure nothing else broke.
5. Commit with the given message.

"Fail" here means the stated failure. A test that fails for some other reason (a typo or a bad path) doesn't count.

Numbering note: there is no T6. Numbers are kept stable so commit messages and reviews still line up. Rev 2 inserts T18–T26, moves the old T18 to T27 and the old T19 to T28, and adds an optional T29.

### Phase A — analyzer (pure)

**T0. Scaffold the test runner**
- Test: `tests/smoke.test.js`
  ```js
  const test = require("node:test"); const assert = require("node:assert/strict");
  test("analyzer loads in node", () => {
    const A = require("../analyzer.js");
    assert.equal(typeof A, "object");
    assert.deepEqual(Object.keys(A).sort(), []); // grows as tasks land; see note
  });
  ```
  Note: drop the `keys` assertion in T1. It only proves the export shape exists.
- Fail: `node --test tests/smoke.test.js` → `Cannot find module '../analyzer.js'`
- Implement: `package.json` (test script only, no deps) and `analyzer.js` (UMD footer exporting `{}`).
- Pass: same command → 1 pass.
- Commit: `test+feat: node:test scaffold and empty analyzer module`

**T1. `parseTs`**
- Test: `tests/parse-ts.test.js`, covering the five rows of the §3.1 table plus 9-digit fractions (`.123456789Z` → 123 ms).
- Fail: `node --test tests/parse-ts.test.js` → `A.parseTs is not a function`
- Implement: `analyzer.js` `parseTs` (regex + `Date.UTC`, truncated ms, `NaN` otherwise).
- Pass: same command.
- Commit: `feat(analyzer): engine-independent parseTs with NaN on invalid`

**T2. `validateTimeline` — schema and fields**
- Test: `tests/validate.test.js`
  - `data/runs/6bec75ed.json` → `ok: true`, `run.events.length === 33`, every event has a numeric `_t`
  - `tests/fixtures/tiny.json` → `ok: true`, events come out sorted by `_t`, and equal timestamps keep their original order
  - wrong `schema` → `ok: false`, errors include `{path:"schema", rule:"schema"}`
  - `tests/fixtures/extra-field.json` → `{path:"events[0].payload", rule:"event-keys"}`
  - bad `ts` → `{path:"events[N].ts", rule:"ts"}`
  - `event_count` ≠ length → `ok: true`, with a warning
- Fail: `validateTimeline is not a function`
- Implement: `analyzer.js` `validateTimeline`, plus the three fixtures under `tests/fixtures/`.
- Pass: `node --test tests/validate.test.js`
- Commit: `feat(analyzer): validateTimeline schema, key whitelist, stable ts sort`

**T3. Sanitize gate patterns**
- Test: append to `tests/validate.test.js`. Write one table-driven case per §2.3 row: a positive string that must be rejected and a near-miss that must pass. Near-misses: `gpt-oss:20b` and `glm-5.3:cloud` pass host:port; `proven-gate` passes; the `sanitize` description key is exempt. Also assert that `JSON.stringify(result.errors)` **does not contain** the offending substring.
- Fail: the dirty cases return `ok: true`.
- Implement: `analyzer.js` forbidden-pattern scan (recursive over keys and values) and the label-string rule.
- Pass: `node --test tests/validate.test.js`
- Commit: `feat(analyzer): sanitize gate rejects ip/host:port/url/cve/creds/keys`

**T4. `analyze` — counts, duration, coverage, by-layer, by-agent**
- Test: `tests/analyze.test.js`
  - crAPI golden: every row of the §3.3 table (use `assert.deepEqual` for the maps and check the key order of `byLayer` and `byAgent` with `Object.keys`)
  - `span_s` within 1e-9 of `780.049`, `window_s` within 1e-9 of `838.943`
  - tiny fixture: `offLayer === 1`, `byLayer.unknown === 1`
  - empty events → `events 0, agents 0, span_s 0, busiestLayer null`
  - tie on busiest layer → the earlier layer in `LAYERS` order wins
  - missing `coverage` → all coverage fields are `null`
  - `llm` undefined → `"not in log"`
- Fail: `analyze is not a function`
- Implement: `analyzer.js` `analyze` (and an internal `countBy` that uses `"unknown"` and `"none"`).
- Pass: `node --test tests/analyze.test.js`
- Commit: `feat(analyzer): analyze() with span vs window, ordered layer/agent counts`

**T5. `brief`**
- Test: `tests/brief.test.js`
  - crAPI + `gpt-oss:20b` → exactly equal to the §3.4 golden string
  - `window_s` null → no `in a … window` clause
  - findings 0, 1 and 2 → `0 findings`, `1 finding`, `2 findings`
  - 0 events → the exact empty-run string
  - an analysis whose `byAgent` contains a key `"<img src=x>"` → output does not contain `<img` (agent ids are never interpolated)
  - `llm = "glm-5.3:cloud"` → output doesn't match `/gemini/i`
- Fail: `brief is not a function`
- Implement: `analyzer.js` `brief`.
- Pass: `node --test tests/brief.test.js`
- Commit: `feat(analyzer): deterministic numbers-only brief`

### Phase B — data and repo gates

**T7. Manifest and data gate**
- Test: `tests/data-gate.test.js`
  - the manifest `schema` is `swarm-visualizer/manifest/v1`
  - for every entry: the file exists and stays under `data/runs/` with no `..`; `validateTimeline(file).ok === true`; `entry.id === run.campaign_stem`; `entry.frame === run.target_name`
  - the five ids and llm values equal the §2.2 table exactly
  - no entry's `llm` satisfies `isGeminiWorker`. Stub `isGeminiWorker` as `/^gemini-/i.test` locally until T17 lands, then import it.
  - every `data/runs/*.json` file appears in the manifest (no orphans)
- Fail: until the data matches, fix the **manifest or data**, not the test. On a clean tree, expect it to fail first only because the file is missing. Write the test before the gate code from T2 and T3 is final if you want a red run.
- Implement: nothing in product code unless the gate finds a real problem. If a run file fails the gate, it gets re-exported on the lab side. `[VERIFY]` Never hand-edit a run file to make it pass.
- Pass: `node --test tests/data-gate.test.js`
- Commit: `test(data): manifest ↔ run files consistency and sanitize gate`

**T8. Repo hygiene**
- Test: `tests/repo-hygiene.test.js`. Walk the repo (skipping `.git/` and `node_modules/`) and assert:
  - no file named `.env`, `.env.*`, `*.pem`, `*.key` or `id_*`
  - no file content matches the google key, openai-style key, bearer/jwt or ipv4 patterns from §2.3. `tests/fixtures/dirty-*.json` is allowlisted, and so is this doc's pattern table (it holds regex text, not addresses). Check the doc for real IPs by hand.
  - no `fetch(` call to an absolute `http` URL in `*.js`
  - `index.html` has no `<script src="http` and no `<link href="http`
- Fail: `inputs/` likely trips it (see the §6.2 gap), or it passes on a clean tree. If so, temporarily add `tests/fixtures/tmp.env` to confirm it fails, then delete the file.
- Implement: `.gitignore` with `inputs/`, `.env*` and `node_modules/`.
- Pass: `node --test tests/repo-hygiene.test.js`
- Commit: `test(repo): no secrets, no .env, no remote fetches; ignore inputs/`

### Phase C — visualizer model (pure)

**T9. `cursorToTime` / `visibleAt`**
- Test: `tests/viz-model.test.js`
  - `cursorToTime(0,t0,t1) === t0`; `(1000) === t1`; `(500)` gives the midpoint; `-5` clamps to t0; `2000` clamps to t1
  - `t1 === t0` → `cursorToTime(500) === t1`
  - crAPI: `visibleAt(events, t1).length === 33`; `visibleAt(events, t0).length === 1`
  - inclusive cutoff when two events share a ts
- Fail: `Cannot find module '../viz-model.js'`
- Implement: `viz-model.js` (UMD, `root.SwarmViz`), `LAYERS`, `LAYER_COLOR`, `cursorToTime`, `visibleAt`.
- Pass: `node --test tests/viz-model.test.js`
- Commit: `feat(viz): cursor→time and inclusive visible window`

**T10. Stable lanes**
- Test: append to `tests/viz-model.test.js`. For crAPI, `laneOrder(events)` deep-equals `["engine","memory","classifier","orchestrator","recon","exploit","scheduler","report"]`. Assert the order doesn't depend on any cursor, because the function takes the full event list only. Check `laneY` for `n=1` and for the endpoints when `n=8, h=720`.
- Fail: `laneOrder is not a function`
- Implement: `viz-model.js` `laneOrder` and `laneY`.
- Pass: same command.
- Commit: `feat(viz): lanes in first-appearance order over full run`

**T11. `layerX` and off-layer handling**
- Test: append. `layerX("human",1200) === 80`, `layerX("publish",1200) === 1160`, `layerX("bogus",1200) === null`, `layerX(undefined,1200) === null`. `markRadius` returns 6 for publish and 4 otherwise.
- Fail: `layerX is not a function`
- Implement: `viz-model.js`.
- Pass: same command.
- Commit: `feat(viz): layerX returns null for off-layer events`

**T12. Time-based playback**
- Test: append. `nextCursor(0, 8000) === 1000`; `nextCursor(0, 16.67)` ≈ 2.08; `nextCursor(990, 1000) === 1000`; `nextCursor(0, 4000, 4000) === 1000`.
- Fail: `nextCursor is not a function`
- Implement: `viz-model.js`.
- Pass: same command.
- Commit: `feat(viz): frame-rate independent playback step`

**T13. HUD model and LLM provenance**
- Test: `tests/hud.test.js`
  - for each of the five manifest entries, with the run loaded from its file: `hudModel({manifest, entry, run}).llm === entry.llm` and doesn't match `/gemini/i`
  - crAPI → `{frame:"crAPI", run:"crapi-1 · 6bec75ed", llm:"gpt-oss:20b"}`
  - dropped crAPI (`entry: null`) → llm `gpt-oss:20b` via the stem lookup
  - dropped run with an unknown stem and no `agent_llm` → `"not in log"`
  - dropped run with `agent_llm: "glm-5.3:cloud"` → that value
  - dropped run with `agent_llm: "http://x"` → `"not in log"` (fails the label rule). Note that validation would already have rejected that file; this tests `hudModel` in isolation.
  - no input combination without `gemini` in an input produces `gemini` in the output. Brute-force the cross product of the cases above.
- Fail: `hudModel is not a function`
- Implement: `viz-model.js` `hudModel` (it imports the label rule from `analyzer.js` in Node and from `self.SwarmAnalyzer` in the browser).
- Pass: `node --test tests/hud.test.js`
- Commit: `feat(viz): hudModel resolves AGENT LLM from manifest, never defaults to Gemini`

### Phase D — DOM glue

**T14. Render safety (static)**
- Test: `tests/render-safety.test.js`. Read `app.js` as text and assert it doesn't match `/\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write/`. Also assert `index.html` loads `analyzer.js` and `viz-model.js` **before** `app.js`.
- Fail: the stub `app.js` uses `innerHTML` in `bars()` and `renderStats()`.
- Implement: rewrite `bars()` and `renderStats()` with `createElement` + `textContent`, and add the two `<script>` tags to `index.html`.
- Pass: `node --test tests/render-safety.test.js`
- Commit: `fix(ui): textContent-only rendering; load pure modules first`

**T15. Wire `app.js` to the pure modules**
- Test: extend `tests/render-safety.test.js`. Assert `app.js` defines none of `parseTs`, `countBy`, `analyze` or `briefFrom`, so there's no duplicate logic, and that it references `SwarmAnalyzer.` and `SwarmViz.`.
- Fail: the stub defines all of them.
- Implement: in `app.js`, delete the duplicated functions and use:
  - `validateTimeline` → `analyze` → `brief`
  - `hudModel` for the HUD and the `<option>` text
  - `laneOrder` / `laneY` / `layerX` / `visibleAt` / `cursorToTime` in `draw()`
  - `nextCursor` with the rAF timestamp in `tick()`
  - a span/window line and an off-layer line in the stats
  - a visible "Serve over http (see README)" message when the manifest fetch rejects
  
  Update the README "Run" section to say `file://` supports Drop JSON only.
- Pass: `node --test tests/` (all green). Then run manual checklist §6.3 steps 1–4 and 7. `[VERIFY]`
- Commit: `refactor(ui): app.js is glue over SwarmAnalyzer/SwarmViz`

**T16. Drop JSON through the gate**
- Test: extend `tests/render-safety.test.js`. Assert that `app.js`'s file-change handler references `validateTimeline` and wraps `JSON.parse` in `try`. This is a static check, `[DECISION]`, because there's no DOM harness in v1.
- Fail: the stub calls `JSON.parse` bare and `setRun(data, "not in log")`.
- Implement: in `app.js`:
  - reject files over 5 MB
  - `try/catch` around `JSON.parse`
  - run `validateTimeline`
  - on failure, show up to 5 `Rejected: rule at path` lines and clear the canvas and stats
  - on success, use `hudModel({manifest, entry:null, run})`
- Pass: `node --test tests/`. Then run manual §6.3 steps 5–6. `[VERIFY]`
- Commit: `feat(ui): drop JSON validated, rejected files never render`

### Phase E — compare (later, after the go-ahead)

**T17. `isGeminiWorker` / `compareRuns`**
- Test: `tests/compare.test.js`
  - the §5.1 true/false table
  - crAPI vs Juice Shop (both `gpt-oss:20b`) → label `baseline vs baseline`, `sameFrame: false`
  - Vault exam 7 vs exam 8 → `baseline vs baseline`, `sameFrame: true`, correct `delta.events`
  - a synthetic pair with `llm: "gemini-x-test"` on the **right** → label `Gemini vs baseline` and the Gemini side moved to `left`
  - delta is null where either side's coverage value is null
  
  Then switch `tests/data-gate.test.js` to import the real `isGeminiWorker`.
- Fail: `isGeminiWorker is not a function`
- Implement: `analyzer.js`.
- Pass: `node --test tests/compare.test.js tests/data-gate.test.js`
- Commit: `feat(analyzer): compareRuns with Gemini label gated on real worker id`

### Phase F — runs table and per-run viz (rev 2)

T18–T22 can start as soon as T16 is green. They don't need T17, except that T20 imports `isGeminiWorker`. If T17 hasn't landed, use the same local stub as T7.

**T18. `runMetrics` — time-to-first, rate, layer share**
- Test: `tests/metrics.test.js`
  - crAPI: every row of the §3.5 golden table (`t_first_publish` and `t_first_proven_gate` within 1e-9 of 132.849, `events_per_min` within 1e-3 of 2.3601, `layerShare` deep-equal to within 1e-12 per key, with keys in `LAYERS` order)
  - `window_s` equals `analyze(...).window_s`
  - a tiny fixture with no publish-layer event → `t_first_publish === null`
  - `started_at` missing → both `t_first_*` are `null`, and `events_per_min` is `null`
  - 0 events → `layerShare` is all zeros, `events_per_min` is 0 or null as per §3.5 (null because the window may still be set; assert `0` when `window_s > 0` and events is 0)
  - "first publish" uses layer, not status: a fixture with `status:"publish"` on the recon layer and no publish layer → `null`
- Fail: `runMetrics is not a function`
- Implement: `analyzer.js` `runMetrics`.
- Pass: `node --test tests/metrics.test.js`, and T4 is still green, because `Analysis` is unchanged.
- Commit: `feat(analyzer): runMetrics with time-to-first publish/proven-gate and layer share`

**T19. Cost block validation and `costOf`**
- Test: `tests/cost.test.js`
  - `tests/fixtures/cost-ok.json` → `ok:true`, and `run.cost` is normalized per §3.2
  - `tests/fixtures/cost-bad.json` → `ok:false`, with errors `{path:"cost.usd", rule:"cost"}` and `{path:"cost.<extra>", rule:"cost"}`, and the error JSON doesn't contain the bad value
  - `usd` and `usd_micros` disagree by more than 1 micro → `ok:false`. Only `usd_micros: 421300` → `run.cost.usd === 0.4213`
  - near-miss: the key `tokens_in` doesn't trip `cred words`
  - `costOf` rules 1–3 from §3.6, one case each, including tokens without usd → `usd:null`
  - `usd_per_verified`: usd 1.2 and verified 3 → 0.4; verified 0 → null; local with verified 0 → `usd 0`, `usd_per_verified null`
  - the five real runs with today's manifest → every cost field is `null`
  - static: the `analyzer.js` source doesn't match `/price|per_?1[km]|per_?million/i`
- Fail: `costOf is not a function` (and cost-bad validates `ok:true`)
- Implement: `analyzer.js`, the cost branch of `validateTimeline`, `costOf`, and the two fixtures.
- Pass: `node --test tests/cost.test.js tests/validate.test.js`
- Commit: `feat(analyzer): optional logged cost block; costOf never uses list prices`

**T20. Table model — `runRow`, `formatCell`, `parseRunHash`**
- Test: `tests/runs-table.test.js`
  - crAPI → deep-equals the §4.7 golden row. `formatCell` gives `"838.9"`, `"132.8"`, `""` for usd and `""` for usd_per_verified
  - a test manifest copy with `billing:"local"` on crAPI → `usd 0`, display `$0 API (compute not billed)`, `usd_per_verified null` → `""`
  - a cost-ok fixture with `usd 0.4213` and verified 2 → displays `$0.4213` and `$0.2107` (round half up to 4 dp, pinned)
  - missing coverage → `"—"` for endpoints and verified, while usd cells stay `""` (not `—`)
  - all five manifest rows: `href` matches `^#run=[A-Za-z0-9_-]{1,32}$`, `row.llm === entry.llm`, and `JSON.stringify(row)` doesn't match `/gemini/i`
  - `runRow` has arity without a narration argument. Passing an extra object `{voice_model:"gemini-3.8-live"}` as a 2nd argument changes nothing in the output
  - `parseRunHash`: `"#run=6bec75ed"` → crAPI entry; `"#run=nope"`, `"#run="`, `"run=6bec75ed"`, `"#run=6bec75ed&x=1"`, `"#run=..%2F"` and `""` → `null`
- Fail: `runRow is not a function`
- Implement: `viz-model.js` `runRow`, `formatCell`, `parseRunHash`.
- Pass: `node --test tests/runs-table.test.js`
- Commit: `feat(viz): runs table row model with empty cost cells and safe viz links`

**T21. Plain-language explainer copy**
- Test: `tests/explainer.test.js`
  - `LAYER_EXPLAIN` has exactly the 5 `LAYERS` keys in order and is frozen. `EXPLAINER` is a frozen array of 6 strings
  - each string passes the §2.3 forbidden-pattern scan (reuse the analyzer's scanner) and the §4.8 deny-list
  - at least one string contains `after-run`. At least one contains `not` and `coordinat`, so the cause-and-effect caveat is present
  - each string is ≤ 200 characters (keeps it plain)
- Fail: `LAYER_EXPLAIN is undefined`
- Implement: `viz-model.js` constants with the §4.8 text. `[VERIFY]` Frank signs off on the layer meanings.
- Pass: `node --test tests/explainer.test.js`
- Commit: `feat(viz): plain-language explainer for what the swarm motion means`

**T22. Runs table UI and per-run viz routing (DOM glue)**
- Test: extend `tests/render-safety.test.js` (static, per the T16 `[DECISION]`):
  - `index.html` has, in this order, `id="viz"`, `id="explain"`, `id="runs"` and `id="stats"`. The viz comes first
  - `index.html` `#runs` contains a `<table>` whose `<th>` texts equal the §4.7 header list in order
  - `app.js` references `SwarmViz.runRow`, `SwarmViz.formatCell`, `SwarmViz.parseRunHash`, `SwarmViz.EXPLAINER` and `SwarmViz.LAYER_EXPLAIN`, and listens for `hashchange`
  - `app.js` still passes the T14 no-`innerHTML` scan, and doesn't assign `.href` from anything other than a `row.href` expression (regex: every `.href =` / `setAttribute("href"` has `row.href` on its right-hand side)
- Fail: `#runs` table is missing.
- Implement: `index.html` sections and table header; `app.js`:
  - on load, fetch all manifest runs, validate them, and build rows via `runRow`/`formatCell` (`rejected` rows per §4.7)
  - route via `parseRunHash` on load and on `hashchange`
  - render `EXPLAINER` and the `LAYER_EXPLAIN` legend with `textContent`
  - `styles.css`: table styles
- Pass: `node --test tests/`. Then manual §6.3 steps 9–10. `[VERIFY]`
- Commit: `feat(ui): first-class runs table and deep-linked per-run visualization`

### Phase G — Gemini voice (rev 2)

**T23. `narrationScript`**
- Test: `tests/narration.test.js`
  - crAPI + `gpt-oss:20b` → exactly the §3.7 golden string
  - `llm "not in log"` → contains `not recorded in the log`
  - `window_s` null → no `-second window` clause; `t_first_publish` null → no `first publish` sentence
  - 0 events → the exact empty-run string
  - for all five manifest runs, the script contains `entry.llm` verbatim and doesn't match `/gemini/i`
  - with a synthetic `llm "gemini-x-test"` → the script contains `gemini-x-test`
  - an analysis whose `byAgent` / `byStatus` / `byFindingClass` contain `"<img src=x>"` → not in the output
  - output passes the §2.3 scan and the §4.8 deny-list
- Fail: `narrationScript is not a function`
- Implement: `analyzer.js` `narrationScript`.
- Pass: `node --test tests/narration.test.js`
- Commit: `feat(analyzer): numbers-only narration script naming the real worker`

**T24. Narration sidecar gate and local render tool** `[LIVE]`
- Test: append to `tests/narration.test.js`, and extend `tests/data-gate.test.js` and `tests/repo-hygiene.test.js`:
  - for each `media/narration/*.json` (zero files is a pass): the schema is `swarm-visualizer/narration/v1`; `run_id` is in the manifest; `audio` exists under `media/narration/` with no `..` and is ≤ 3 MB; `duration_ms` is an integer within [1000, 120000]; `script_text === narrationScript(...)` for the current run file; `script_sha256` matches (`node:crypto`); the sidecar passes the §2.3 scan
  - a hand-built stale sidecar in a temp dir (script for a different run) → the checker reports `stale-script`. Export the checker as `checkNarrationSidecar(sidecar, manifest, runFile)` from `analyzer.js`, a pure function, so it's testable without fixtures in `media/`
  - data-gate: no manifest `llm` equals `"gemini-3.8-live"` (the narrator id, §2.2)
  - hygiene: `GEMINI_API_KEY` and the Gemini API host (`generativelanguage`) appear in no file loaded by `index.html` and in no file except `tools/narrate.mjs`, `README.md` and this doc. `tools/narrate.mjs` contains `process.env.GEMINI_API_KEY` and doesn't contain `AIza`, `console.log(` with `KEY` or `writeFile` with `KEY`. `media/narration/*.wav` is skipped from the content scan (§6.2)
  - `viz-model.js` `narrationPlayMs`: a valid sidecar → `duration_ms`; missing or invalid → 8000
- Fail: `checkNarrationSidecar is not a function`
- Implement: `analyzer.js` `checkNarrationSidecar`; `viz-model.js` `narrationPlayMs`; `tools/narrate.mjs` (§4.9: validate → script → Live API with the env key → WAV + sidecar); a `media/narration/.gitkeep`; a README note on running it locally.
- Pass: `node --test tests/`. `[VERIFY]` With a local key, run `node tools/narrate.mjs 6bec75ed`, listen to the clip, and confirm it's verbatim and names `gpt-oss:20b`. `[VERIFY]` Confirm the `gemini-3.8-live` model id and its audio output format before committing any audio.
- Commit: `feat(voice): local-only Gemini narration render with sidecar gate`

**T25. Voice overlay UI**
- Test: extend `tests/render-safety.test.js` (static):
  - `app.js` references `SwarmViz.narrationPlayMs` and fetches narration only via a relative `media/narration/` path
  - the exact §4.9 credit string appears in `index.html` or `app.js`, and nowhere in the canvas-drawing function (static: the credit text isn't inside the body of `draw`)
  - `app.js`'s canvas caption and HUD code paths don't reference the sidecar variable (static: the identifier used for the loaded sidecar doesn't appear inside `draw` or `renderHud`)
  - no `localStorage`, `sessionStorage`, `WebSocket`, `EventSource` or `GEMINI` in any browser-loaded file
  - the dropped-file handler doesn't fetch narration (§4.5)
- Fail: `narrationPlayMs` isn't referenced in `app.js`.
- Implement: `app.js`: the "Play with narration" button (shown only when the sidecar GET succeeds for a manifest entry), an `<audio>` element with a same-origin `src`, synced play/pause with `playMs = narrationPlayMs`, stopping the audio on manual scrub, a transcript via `textContent` and the credit line. `index.html`: the overlay container in `#viz`, outside `<canvas>`.
- Pass: `node --test tests/`. Then manual §6.3 step 11. `[VERIFY]`
- Commit: `feat(ui): after-run Gemini voice overlay; worker label untouched`

### Phase H — fair compare and cost (rev 2, `[LIVE]`)

**T26. `fairCompare` and cost compare model**
- Test: `tests/fair-compare.test.js`
  - with today's data, for each frame (Vault Notes, Juice Shop, crAPI) and the default baseline → `comparable:false`, `reason:"no Gemini run on this frame yet"`, every `gemini` cell `null`, insight exactly `No Gemini run on {frame} yet.`
  - with `tests/fixtures/gemini-synth.json` (frame `crAPI`) and a **test-only** manifest copy that gives it `llm:"gemini-x-test"` → `comparable:true`, metric rows in §5.3 order, values equal to the fixture's `runMetrics`, and an insight that matches the comparable template
  - baseline vs synthetic on a different frame → `comparable:false`, `reason:"different lab surface"`
  - both sides baseline → `reason:"gemini side is not a Gemini worker"`
  - the insight never matches the §5.3 deny-list, for every case above
  - the cost block: different bases → the note string is present; Gemini with tokens and no usd → usd `null`
  - **guard:** the test asserts `data/manifest.json` has no entry with `isGeminiWorker(llm)`. That assertion is meant to flip. When a real Carbon/Hydrogen run lands, it fails on purpose, and the author replaces it with that run's golden values. `[LIVE]`
- Fail: `fairCompare is not a function`
- Implement: `analyzer.js` `fairCompare` (+ the cost-compare rows), and the `gemini-synth.json` fixture (RFC-clean labels only).
- Pass: `node --test tests/fair-compare.test.js`
- Commit: `feat(analyzer): same-frame fair compare with empty Gemini cells until a real run`

**T27. Compare UI** `[LIVE]` (was T18, extended in rev 2)
- Test: extend `tests/render-safety.test.js`. If `compare.html` exists, it loads the pure modules first and has no `innerHTML`. Extend `tests/data-gate.test.js` so that any manifest entry whose `llm` satisfies `isGeminiWorker` has a `run` value that isn't one of the five baseline runs. That keeps a relabelled baseline from passing as Gemini. **(rev 2)** Also assert that the compare code references `SwarmAnalyzer.fairCompare`, renders null Gemini cells as empty text, and contains the §5.5 basis strings.
- Fail: `compare.html` is missing.
- Implement: `compare.html` (or a `#compare` section in `index.html`, `[DECISION]` at implementation time) with two selects, two canvases, one shared normalized scrub and a two-sentence delta brief. **(rev 2)** Below it: the per-frame fair-compare table (§5.3), the insight sentence and the cost block (§5.5) with token/usd/usd-per-verified columns.
- Pass: `node --test tests/`. `[VERIFY]` The "Gemini vs baseline" text appears **only** after a real Gemini run has been added to `data/` through the lab exporter with `--llm <real gemini id>`. Until then, the UI shows "baseline vs baseline" or "no Gemini run in data yet", and every Gemini cell is empty (§6.3 step 13).
- Commit: `feat(ui): side-by-side compare view with fair-compare and cost tables`

**T28 (optional). CI** (was T19)
- Add `.github/workflows/test.yml` that runs `node --test tests/` on Node 20 for push and PR. There's no secret and no deploy step, because Pages serves from the branch. **(rev 2)** CI never gets `GEMINI_API_KEY`, and narration is never rendered in CI.
- Commit: `ci: run node:test on push`

**T29 (optional, explicit go-ahead only). Gource clip export**
- `[DECISION]` Not scheduled. The canvas stays the default viz. If Frank says go: a pure `toGourceLog(run, entry)` in a new `gource-export.js` that emits `timestamp|agent_id|A/M|<layer>/<agent_id>` lines from sanitized fields only, with tests that cover the same §2.3 scan, the same "no Gemini unless worker" rule for any caption/title, and that the narration sidecar (§4.9) can be reused unchanged. Rendering happens offline with the Gource binary on the operator's machine, and only the resulting video (≤ 20 MB) is committed. WebGL in the page stays out of scope.
- Commit: `feat(export): optional sanitized Gource log export`

---

## 8. Out of scope

- A live swarm or any streaming or websocket feed from the lab
- The shim `/ui` and any proxy to lab services
- Cloudflare Access or any auth layer; the site is public and static
- Gemini (or any) API keys or LLM calls **in the browser**. The brief and the narration script are templates, not model output. **(rev 2)** The one exception is the local-only `tools/narrate.mjs`, which turns the template script into audio with a key from the operator's env (§4.9).
- **(rev 2)** Live narration during a run, and any voice that comments on a hunt in progress
- **(rev 2)** Price tables, estimated costs, or list prices presented as what a run cost
- **(rev 2)** Gemini numbers, labels or voice credits presented as the worker on a glm or oss run
- Docker or containers of any kind
- Gource or WebGL rendering, unless there's a later explicit go-ahead (T29)
- Rendering `attackgraph_counts`, `pheromone_board_dump` or any field beyond §2.1
- Editing, cleaning or re-sanitizing run files in the browser. Files that fail the gate are re-exported on the lab side.
- Any feature that names, links to or describes a technique, payload or CVE
