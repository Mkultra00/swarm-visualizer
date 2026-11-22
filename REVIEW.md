# UI review — swarm-visualizer (review only, nothing implemented)

Scope: `index.html`, `styles.css`, `app.js`, `viz-model.js` (palette + HUD strings), `README.md`, including the uncommitted `index.html`/`styles.css` layout change (topbar + stage grid + rail).

## 1. Verdict

**Ship with nits — but do the three P0s first.** None of them is a big job. The honesty story is solid: real worker LLM stamps, the narrator disclaimer, no payloads, no `innerHTML`, no remote assets. The new stage/rail layout is a clear step up from the old stacked panels. What lets it down is the canvas. It is the hero element and it renders small, soft and a bit stretched. One of the two "first-class" elements (the table) is also buried below the fold.

## 2. What is actually on the glass

**Layout (desktop, after the uncommitted diff):**
- Sticky topbar: lowercase kicker "after-run · lab only", lowercase `swarm-visualizer` h1, and on the right three HUD chips (FRAME / RUN / AGENT LLM) with cyan top borders. Clean.
- Stage grid: the canvas takes roughly 75% width on the left, with a 320px rail on the right (Brief paragraph, Analyzer `dl`, By layer bars, By agent bars, fine print).
- Under the canvas: a player bar (Sample select, Play, scrubber, optional "Play with narration", Drop JSON). Below that, when a sidecar exists, the voice credit and the full transcript `<pre>`.
- Below the fold: the "What you're seeing" explainer and legend, and only after that the **Table of outputs**.

**Hierarchy problems:**
- The page has two first-class elements but gives them three levels of hierarchy: canvas > rail > explainer > table. The table comes last, behind six explainer bullets and a legend. A judge who scrolls once sees prose, not results.
- FRAME / RUN / AGENT LLM appears **twice**: in the topbar chips and again as canvas text at the bottom left (`app.js:108`). The canvas copy is tiny (see below) and adds nothing on the live page. It only earns its place in screenshots and recordings. Keep it, but treat it as a watermark.
- Every section heading (`h2`/`h3`) is 11px, uppercase, muted grey. "Brief", "Analyzer" and "Table of outputs" all have the same weight as "By agent". Nothing tells the eye where to go.

**Canvas legibility (the real problem):**
- The backing store is fixed at `1440×780` (`index.html:24`). CSS sets `width:100%; height:min(72vh,780px)` (`styles.css:69-74`). On a 1440-wide laptop the canvas shows at about 1120px wide, so all canvas text shrinks by about 0.78. The 11px agent labels come out at about 8.5px, and the 12px layer labels and HUD line at about 9.3px. On a projector that is unreadable.
- Width and height scale independently, so the aspect ratio drifts. At 1920×1080 the canvas is about 2.06:1 against an intrinsic 1.85:1, so dots become ellipses and text squashes by about 10%. At the `≤980px` breakpoint, `canvas { height: 420px }` on a 1440×780 bitmap is a severe squash.
- There is no `devicePixelRatio` handling. On a Retina MacBook (DPR 2) a 1440px bitmap is stretched to about 2240 device pixels, so everything looks soft.
- The layer labels are drawn at `x - 28` (`app.js:75`), a fixed offset. "proven-gate" therefore sits off-centre and "human" crowds the agent-label gutter. Agent labels start at x=8 and the human column is at x=80, so any agent id over about 10 characters runs into the human dots.
- The bottom-right counter `N / M` has no label and no time. Nothing on screen says "t = 12.3 s of 48.0 s".

**Contrast:**
- Body ink `#e8eef7` on `#05070c`/`#0c1018`: excellent. Muted `#8b97a8` on the panel: about 6:1, fine.
- Canvas gridlines `#243044` on `#05060a`: deliberately faint, OK.
- The `human` colour (`#4FC3F7`) and `recon` colour (`#6ee7ff`) are nearly the same cyan. In the bars and legend they cannot be told apart. On the canvas the column position carries the layer, so it is survivable there. The red `proven-gate` vs green `publish` pair is a classic colour-blind pair, but it is also position-redundant, so it is low priority.
- The cyan accent is used for everything: chips, primary button, links, the CLASS column, recon, and the default bar colour. Because it means everything, it means nothing.

**Dead or incorrect UI:**
- `tbody tr.current` and `tbody tr.rejected` are styled (`styles.css:168-169`), but `app.js` never adds either class. The table never shows which run is loaded, and rejected rows are never dimmed.
- The voice credit says "reading the numbers **above**" (`index.html:36`, `app.js:145`). After the new layout the numbers are in the rail to the **right**, so the copy is now wrong.
- The Drop JSON label hides its input with `display:none` (`styles.css:102`). The control can't be reached by keyboard and has no focus ring. No control on the page has a `:focus-visible` style.

## 3. What is weak compared with a $5k "Best Use of Managed Agents" demo

Be honest about what judges score: *agents*, plus evidence that the swarm was orchestrated and did something. Today's glass mostly says "here is a dot plot of a log".

1. **No headline claim.** The h1 is a repo slug. Nothing above the fold says "N managed agents, M runs, K verified findings, $X per verified finding". The numbers exist (in the table rows and `runMetrics`) but are spread across the rail and the bottom table.
2. **Agents are anonymous lanes.** The lanes carry raw `agent_id` strings in 8.5px grey. A managed-agents demo should make agents feel like actors. Say how many there are, and put each lane's event count next to its name (that is already in By agent; it just isn't on the canvas).
3. **No sense of time.** Play compresses the run into 8 seconds with no clock. The judge never learns whether the swarm took 40 seconds or 40 minutes, or when the first publish landed. `t_first_publish` and `window_s` are computed, but they only live in the table.
4. **The comparison story is hidden.** Five runs on three targets with two worker LLMs is a genuinely good "same harness, different models and targets" story. It sits in a 14-column, snake_case, `white-space:nowrap` table at the bottom of the page. `usd / verified` is the killer column and it is the 13th of 14.
5. **Gemini usage is under-sold, but correctly fenced.** The narration and the Decisions class both exist. CLASS renders as an unlabelled cyan uppercase word in the table, and the column header doesn't say it is Gemini output. Say once, in plain words, near the table: "CLASS = grok-4.6 label, written after the run."
6. **First paint waits for the whole table.** `boot()` fetches, validates and analyzes all five runs and their class files **one after another** before the first run is drawn (`app.js:295-321`). The judge sees an empty black canvas and "Load a run." for that whole time.

## 4. Ranked UI fixes (one file each, concrete change, no implementation here)

### P0 — before submit

| # | File | Change |
|---|------|--------|
| P0-1 | `app.js` | In `draw()`, size the canvas backing store from its CSS box every frame or on resize: `canvas.width = clientWidth * devicePixelRatio`, same for height, then `ctx.setTransform(dpr,0,0,dpr,0,0)`. Pass CSS-pixel `w`/`h` into `layerX`/`laneY`. This fixes blur, the squashed aspect ratio and the ~8px text in one move. Add a `resize` listener that calls `draw()`. Leave the geometry functions in `viz-model.js` alone; they already take `w`/`h`. |
| P0-2 | `index.html` | Move `<section id="runs">` (Table of outputs) **above** `<section id="explain">`. The table is first-class and the explainer is reference. |
| P0-3 | `app.js` | In `boot()`, call `loadEntry(first)` **before** the per-run table loop, and build the table rows in parallel (`Promise.all`) instead of a sequential `await` loop. The canvas should paint within one fetch. |

### P1 — should do

| # | File | Change |
|---|------|--------|
| P1-1 | `app.js` | In `fillTable()`, set `tr.className = "current"` for the row matching `state.entry.id`, and `"rejected"` for rejected rows. Re-run the highlight inside `loadEntry`. The CSS is already written. |
| P1-2 | `app.js` | In `draw()`, raise canvas fonts to 13px for agent labels and layer labels and 14px for the HUD line (after P0-1 they will finally render at that size). Centre layer labels with `ctx.textAlign = "center"` instead of `x - 28`. Truncate agent labels to the gutter width with an ellipsis. |
| P1-3 | `app.js` | Replace the bare `${visible.length} / ${events.length}` with `t ${elapsed.toFixed(1)}s / ${span.toFixed(1)}s · ${visible.length}/${events.length} events`, using `state.t0`/`state.t1` and `cutoff`. Time is the thing a replay should show. |
| P1-4 | `index.html` | Add a one-line headline stat strip under the h1 or in the topbar: total runs, total agents, total verified, best `usd / verified`. Give it fixed element ids so app.js can fill them via `textContent`. This is the "why should a judge care" line. |
| P1-5 | `index.html` | Rename table headers to plain words: `window_s` → "Active window (s)", `t_first_publish` → "First report (s)", `usd / verified` → "$ per verified", `CLASS` → "Gemini class", `stem` → "Run id". Also consider dropping `stem` (it duplicates the hash in `view`). |
| P1-6 | `app.js` | Fix the voice credit copy: "reading the numbers above" → "reading this run's numbers (right)". Change it in the `setSidecar` string, and in `index.html:36` too or the two will drift. |
| P1-7 | `styles.css` | Add `#viz-wrap { scroll-margin-top: 80px; }`. `loadEntry` calls `scrollIntoView({block:"start"})` and the sticky topbar currently covers the canvas's top 40px, which is exactly where the layer labels are. |
| P1-8 | `app.js` | Remove the duplicate `sel.addEventListener("input", …)` (`app.js:325`). Both `change` and `input` fire on a select, so every pick loads the run twice: double fetch, double scroll, and a narration race. |
| P1-9 | `styles.css` | Give hierarchy to the section headings: make `.panel h2` and the rail "Brief" 13–14px in `--ink` and keep the 11px muted style only for `h3`. Add `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` for buttons, select and `.drop`. |

### P2 — nice to have

| # | File | Change |
|---|------|--------|
| P2-1 | `viz-model.js` | Change `LAYER_COLOR.human` to a neutral (for example `#cfd8e3`) so it stops colliding with `recon` cyan. Mirror the change in `styles.css` `--human`. Colour only; no geometry or motion change. |
| P2-2 | `styles.css` | Replace `.drop input { display:none }` with a visually-hidden pattern (`position:absolute; opacity:0; width:1px; height:1px`) so the file input stays focusable. |
| P2-3 | `index.html` | Change `<title>` to "Swarm replay: managed agents on lab exams" and add `<meta name="description">` plus an inline-SVG `data:` favicon. Judges tab-hop. |
| P2-4 | `styles.css` | At `max-width: 980px`, drop `canvas { height: 420px }` in favour of `aspect-ratio: 16 / 9; height: auto;` (this pairs with P0-1). |
| P2-5 | `app.js` | Tidy up play/pause during narration. Pausing then pressing Play calls `startPlay(false)`, which kills the audio and resets `playMs` to 8000, so the replay loses sync with the voice. Resume in the same mode it was started in. |
| P2-6 | `styles.css` | Cap the transcript `<pre>` with `max-height: 8em; overflow:auto`. With a long narration it currently pushes the whole lower page down. |
| P2-7 | `styles.css` | Use a second accent for the primary CTA ("Play with narration") so it isn't the same cyan as every link and chip. |

## 5. What not to touch

- **Canvas motion and geometry**: `nextCursor` (frame-rate independent), `cursorToTime` (inclusive window), `laneOrder` (first-appearance lanes over the full run, which never jump), and `layerX` returning `null` for off-layer events. All of these were deliberate recent commits and are correct. P0-1 changes only the pixel mapping in `app.js`, not this model.
- **The LLM stamp honesty**: `hudModel` prefers the manifest's `llm` and falls back to "not in log". The manifest note "Do not label these Gemini". The narrator line "The narrator did not run this exam." Do not let any polish put "Gemini" next to AGENT LLM, and do not rename the chip to something vaguer.
- **The safety copy**: "Sanitized schema. No payloads…", the explainer bullets about not implying coordination and "more dots ≠ better run", and "Layer plot is not cause-and-effect". It can be restyled, not removed.
- **`textContent`-only rendering and no remote CSS/fonts.** Every P0–P2 fix above can be done with `el()`/`textContent` and system fonts. Don't reach for a webfont or a charting library at 4 PM.
- **Validation and rejection paths**: `validateTimeline`, the 5 MB drop cap, and the `rejected` rows. Show them better (P1-1); don't loosen them.
- **No exploit detail, ever**: no endpoint names, payload snippets or "how it found X" tooltips, even if a judge would love them.
