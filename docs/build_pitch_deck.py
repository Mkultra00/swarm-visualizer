#!/usr/bin/env python3
"""Build the 6-slide swarm-visualizer pitch deck (python-pptx + PIL graphics).

Adapted from inputs/flame-pitch-deck-builder.py. Harness kept: word-count
asserts, ban sweep, overflow audit, saved-XML readback. Graphics are drawn
locally with PIL into docs/assets/ (no remote images, no network).

Run:  python3 docs/build_pitch_deck.py
"""
import datetime as dt
import math
import random
import re
import shutil
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "docs" / "assets"
REPO_COPY = REPO / "docs" / "swarm-visualizer-pitch.pptx"
OUT = Path("/Users/franky/Downloads/swarm-visualizer-pitch.pptx")
BUILD_LOG = REPO / "BUILD_LOG.md"
STILL_CRAPI = REPO / "inputs" / "gource-still-crapi.png"
STILL_JUICE = REPO / "inputs" / "gource-still-juice.png"

# Palette from the live site
HEX = {
    "bg": "#05070c", "panel": "#0c1018", "ink": "#e8eef7", "mute": "#8b97a8",
    "accent": "#6ee7ff", "warn": "#ffb300", "bad": "#e53935", "ok": "#43a047",
}


def rgb_tuple(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb(h):
    return RGBColor(*rgb_tuple(h))


BG, PANEL, INK, MUTE = rgb(HEX["bg"]), rgb(HEX["panel"]), rgb(HEX["ink"]), rgb(HEX["mute"])
ACCENT, WARN, BAD, OK = rgb(HEX["accent"]), rgb(HEX["warn"]), rgb(HEX["bad"]), rgb(HEX["ok"])
LINE = rgb("#1a2231")

FONT = "Calibri"
MAX_BULLETS, MAX_WORDS = 5, 12
EMU = 914400


# ====================================================================
# PIL graphics
# ====================================================================
def pil_font(size):
    for p in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/SFNSMono.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def glow_layer(size, draw_fn, blur):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def draw_tree(path, W=1400, H=1400, seed=7):
    """Radial Gource-style tree: hub -> branches -> leaves, glowing agents."""
    rnd = random.Random(seed)
    S = 2  # supersample
    w, h = W * S, H * S
    cx, cy = w / 2, h / 2
    img = Image.new("RGBA", (w, h), rgb_tuple(HEX["bg"]) + (255,))

    # faint concentric rings
    d = ImageDraw.Draw(img)
    for r in range(260, int(w * 0.5), 260):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(18, 26, 38, 255), width=2 * S)

    lane_cols = [HEX["accent"], HEX["bad"], HEX["warn"], HEX["ok"], "#9b7bff", "#7fb2ff"]
    nodes, edges = [(cx, cy, 0)], []
    branches = 7
    for b in range(branches):
        ang = 2 * math.pi * b / branches + rnd.uniform(-0.15, 0.15)
        col = lane_cols[b % len(lane_cols)]
        r1 = rnd.uniform(0.17, 0.22) * w
        p1 = (cx + r1 * math.cos(ang), cy + r1 * math.sin(ang))
        edges.append(((cx, cy), p1))
        nodes.append((*p1, 1))
        for k in range(rnd.randint(2, 3)):
            a2 = ang + rnd.uniform(-0.55, 0.55)
            r2 = r1 + rnd.uniform(0.09, 0.15) * w
            p2 = (cx + r2 * math.cos(a2), cy + r2 * math.sin(a2))
            edges.append((p1, p2))
            nodes.append((*p2, 2))
            # leaf cluster (files touched)
            for _ in range(rnd.randint(4, 10)):
                a3 = rnd.uniform(0, 2 * math.pi)
                rr = rnd.uniform(18, 70) * S
                leaf = (p2[0] + rr * math.cos(a3), p2[1] + rr * math.sin(a3))
                nodes.append((*leaf, ("leaf", col)))

    # edges
    d = ImageDraw.Draw(img)
    for a, b in edges:
        d.line([a, b], fill=(120, 140, 170, 140), width=2 * S)

    # leaf glow then leaves
    def leaf_glow(dd):
        for x, y, kind in nodes:
            if isinstance(kind, tuple):
                c = rgb_tuple(kind[1])
                dd.ellipse([x - 22 * S, y - 22 * S, x + 22 * S, y + 22 * S], fill=c + (70,))
    img = Image.alpha_composite(img, glow_layer((w, h), leaf_glow, 18 * S))
    d = ImageDraw.Draw(img)
    for x, y, kind in nodes:
        if isinstance(kind, tuple):
            c = rgb_tuple(kind[1])
            r = 7 * S
            d.ellipse([x - r, y - r, x + r, y + r], fill=c + (255,))
        else:
            r = (12 if kind == 0 else 7 if kind == 1 else 5) * S
            d.ellipse([x - r, y - r, x + r, y + r], fill=(180, 196, 230, 255))

    # agent badges with halos
    agents = [(0.30, 0.28, HEX["accent"]), (0.70, 0.66, HEX["bad"]),
              (0.24, 0.70, "#ff8a5c"), (0.74, 0.30, HEX["warn"])]

    def halo(dd):
        for ax, ay, c in agents:
            x, y = ax * w, ay * h
            dd.ellipse([x - 70 * S, y - 70 * S, x + 70 * S, y + 70 * S], fill=rgb_tuple(c) + (150,))
    img = Image.alpha_composite(img, glow_layer((w, h), halo, 30 * S))
    d = ImageDraw.Draw(img)
    for ax, ay, c in agents:
        x, y = ax * w, ay * h
        r = 26 * S
        d.ellipse([x - r, y - r, x + r, y + r], fill=rgb_tuple(c) + (255,),
                  outline=(232, 238, 247, 255), width=3 * S)
        # beam from agent to nearest mid node
        near = min((n for n in nodes if n[2] == 2), key=lambda n: (n[0] - x) ** 2 + (n[1] - y) ** 2)
        d.line([(x, y), (near[0], near[1])], fill=rgb_tuple(c) + (200,), width=3 * S)

    img = img.resize((W, H), Image.LANCZOS)
    img.save(path)
    return path


def draw_waveform(path, W=1600, H=420, seed=3):
    """Symmetric TTS waveform bars, cyan gradient, transparent background."""
    rnd = random.Random(seed)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bars, gap = 96, 6
    bw = (W - gap * (bars - 1)) / bars
    mid = H / 2
    a = rgb_tuple(HEX["accent"])
    b = rgb_tuple("#2a6cff")

    def shape(dd, alpha_mul):
        for i in range(bars):
            t = i / (bars - 1)
            env = math.sin(math.pi * t) ** 0.6
            amp = env * (0.25 + 0.75 * abs(math.sin(i * 0.37) * math.cos(i * 0.11))) * rnd.uniform(0.7, 1)
            bh = max(6, amp * (H * 0.46))
            x0 = i * (bw + gap)
            c = tuple(int(a[k] * (1 - t) + b[k] * t) for k in range(3))
            dd.rounded_rectangle([x0, mid - bh, x0 + bw, mid + bh], radius=bw / 2,
                                 fill=c + (int(255 * alpha_mul),))
    state = rnd.getstate()
    glow = glow_layer((W, H), lambda dd: shape(dd, 0.55), 10)
    rnd.setstate(state)
    img = Image.alpha_composite(img, glow)
    sharp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shape(ImageDraw.Draw(sharp), 1.0)
    img = Image.alpha_composite(img, sharp)
    img.save(path)
    return path


def draw_table(path, W=1400, H=900):
    """Abstract outputs table: header + rows with status chips (no numbers)."""
    img = Image.new("RGBA", (W, H), rgb_tuple(HEX["panel"]) + (255,))
    d = ImageDraw.Draw(img)
    f = pil_font(30)
    pad, head_h, row_h = 50, 90, 120
    cols = [pad, 330, 640, 960, 1180]
    heads = ["RUN", "TARGET", "AGENT LLM", "LABEL", "USD"]
    d.rectangle([0, 0, W, head_h], fill=(16, 22, 33, 255))
    for x, t in zip(cols, heads):
        d.text((x, head_h / 2), t, font=f, fill=rgb_tuple(HEX["mute"]) + (255,), anchor="lm")
    d.line([(0, head_h), (W, head_h)], fill=rgb_tuple(HEX["accent"]) + (255,), width=4)
    status = [HEX["ok"], HEX["warn"], HEX["ok"], HEX["bad"], HEX["ok"], HEX["warn"]]
    for i, sc in enumerate(status):
        y = head_h + i * row_h + row_h / 2
        if i % 2:
            d.rectangle([0, y - row_h / 2, W, y + row_h / 2], fill=(14, 19, 28, 255))
        ink = rgb_tuple(HEX["ink"])
        d.rounded_rectangle([cols[0], y - 12, cols[0] + 200, y + 12], 12, fill=ink + (190,))
        d.rounded_rectangle([cols[1], y - 12, cols[1] + 230, y + 12], 12, fill=ink + (110,))
        d.rounded_rectangle([cols[2], y - 14, cols[2] + 260, y + 14], 14,
                            fill=rgb_tuple(HEX["accent"]) + (160,))
        d.rounded_rectangle([cols[3], y - 22, cols[3] + 170, y + 22], 22, fill=rgb_tuple(sc) + (255,))
        d.line([(cols[4], y), (cols[4] + 60, y)], fill=rgb_tuple(HEX["mute"]) + (255,), width=4)
    for i in range(1, len(status) + 1):
        y = head_h + i * row_h
        d.line([(pad, y), (W - pad, y)], fill=(26, 34, 49, 255), width=2)
    img.save(path)
    return path


ASSETS.mkdir(parents=True, exist_ok=True)
TREE_PNG = draw_tree(ASSETS / "tree.png")
WAVE_PNG = draw_waveform(ASSETS / "waveform.png")
TABLE_PNG = draw_table(ASSETS / "table-grid.png")
for p in (STILL_CRAPI, STILL_JUICE):
    assert p.exists(), p

# ====================================================================
# Deck
# ====================================================================
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
SW, SH = prs.slide_width, prs.slide_height
ALL_TEXT = []
PICTURES = []


def rect(slide, x, y, w, h, color, shape=MSO_SHAPE.RECTANGLE, name=None, line=None):
    s = slide.shapes.add_shape(shape, x, y, w, h)
    s.fill.solid()
    s.fill.fore_color.rgb = color
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(1)
    s.shadow.inherit = False
    if name:
        s.name = name
    return s


def card(slide, x, y, w, h, name, radius=0.06, line=LINE):
    c = rect(slide, x, y, w, h, PANEL, MSO_SHAPE.ROUNDED_RECTANGLE, name=name, line=line)
    c.adjustments[0] = radius
    return c


def text(slide, x, y, w, h, runs, size=16, color=INK, bold=False,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, name=None):
    tb = slide.shapes.add_textbox(x, y, w, h)
    if name:
        tb.name = name
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(tf, side, 0)
    p = tf.paragraphs[0]
    p.alignment = align
    if isinstance(runs, str):
        runs = [(runs, {})]
    for t, opt in runs:
        r = p.add_run()
        r.text = t
        ALL_TEXT.append(t)
        f = r.font
        f.name = FONT
        f.size = Pt(opt.get("size", size))
        f.bold = opt.get("bold", bold)
        f.color.rgb = opt.get("color", color)
    return tb


def picture(slide, path, x, y, w=None, h=None, name=None, frame=False):
    if frame:
        pad = Inches(0.06)
        fr = rect(slide, x - pad, y - pad, (w or 0) + 2 * pad, (h or 0) + 2 * pad, PANEL,
                  MSO_SHAPE.ROUNDED_RECTANGLE, name=f"{name} frame", line=ACCENT)
        fr.adjustments[0] = 0.02
    pic = slide.shapes.add_picture(str(path), x, y, w, h)
    if name:
        pic.name = name
    PICTURES.append(Path(path).name)
    return pic


def base(title, notes, kicker=None):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg = rect(s, 0, 0, SW, SH, BG, name="Background")
    bg.fill.solid()
    bg.fill.fore_color.rgb = BG
    rect(s, 0, 0, Inches(0.12), SH, ACCENT, name="Accent bar")
    rect(s, Inches(0.7), Inches(0.32), Inches(0.9), Inches(0.05), ACCENT, name="Accent tick")
    if kicker:
        text(s, Inches(1.75), Inches(0.22), Inches(9), Inches(0.3), kicker,
             size=12, color=MUTE, bold=True, name="Kicker")
    if title:
        text(s, Inches(0.7), Inches(0.5), Inches(11.9), Inches(0.85), title,
             size=34, bold=True, name="Title")
    text(s, Inches(9.6), Inches(7.05), Inches(3.3), Inches(0.3),
         "swarm-visualizer  ·  Gemini 4 NYC", size=10, color=MUTE,
         align=PP_ALIGN.RIGHT, name="Slide footer")
    assert notes.strip()
    s.notes_slide.notes_text_frame.text = notes
    ALL_TEXT.append(notes)
    return s


def bullets(slide, x, y, w, items, gap=0.78, size=20, dot=ACCENT):
    assert len(items) <= MAX_BULLETS, items
    for i, item in enumerate(items):
        runs = item if isinstance(item, list) else [(item, {})]
        plain = "".join(t for t, _ in runs)
        assert len(plain.split()) <= MAX_WORDS, (len(plain.split()), plain)
        yy = y + Inches(gap * i)
        d = Inches(0.14)
        rect(slide, x, yy + Inches(0.11), d, d, dot, MSO_SHAPE.OVAL, name=f"Bullet dot {i + 1}")
        text(slide, x + Inches(0.38), yy, w - Inches(0.38), Inches(gap - 0.08),
             runs, size=size, name=f"Bullet {i + 1}")


def chip(slide, x, y, label, value, w=3.0, vcol=INK, name=None):
    c = rect(slide, x, y, Inches(w), Inches(0.46), PANEL, MSO_SHAPE.ROUNDED_RECTANGLE,
             name=name or f"Chip {label}", line=ACCENT)
    c.adjustments[0] = 0.5
    text(slide, x + Inches(0.18), y, Inches(w - 0.3), Inches(0.46),
         [(label + "  ", {"color": MUTE, "bold": True, "size": 12}),
          (value, {"color": vcol, "bold": True})],
         size=15, anchor=MSO_ANCHOR.MIDDLE, name=f"{name or label} text")


# ---------- 1. Title ----------
s = base(None,
         "THE PITCH: see the swarm after it ran. swarm-visualizer is the public, "
         "after-run website only. Attack engines stay on the lab Mac. Judges get a table "
         "of outputs plus a Gource-style tree clip for each run, with a Gemini voice "
         "narrating the numbers. Lane: Best Use of Managed Agents.")
glow = rect(s, Inches(7.75), Inches(0.55), Inches(5.2), Inches(6.4), PANEL,
            MSO_SHAPE.ROUNDED_RECTANGLE, name="Tree panel", line=LINE)
glow.adjustments[0] = 0.04
picture(s, TREE_PNG, Inches(7.95), Inches(0.95), Inches(4.8), Inches(4.8), name="PIL tree")
text(s, Inches(7.95), Inches(5.95), Inches(4.8), Inches(0.8),
     "Original PIL drawing in the Gource style: agents, branches, files touched.",
     size=12, color=MUTE, align=PP_ALIGN.CENTER, name="Tree caption")
text(s, Inches(0.7), Inches(0.55), Inches(6.8), Inches(0.35),
     "AFTER-RUN  ·  LAB ONLY", size=14, color=ACCENT, bold=True, name="Kicker")
text(s, Inches(0.7), Inches(0.95), Inches(6.9), Inches(0.35),
     "Gemini 4 NYC  ·  2026-11-21  ·  Cerebral Valley × Google DeepMind",
     size=14, color=MUTE, name="Event line")
text(s, Inches(0.7), Inches(1.5), Inches(6.9), Inches(1.1), "swarm-visualizer",
     size=56, bold=True, name="Title")
rect(s, Inches(0.7), Inches(2.75), Inches(0.08), Inches(1.15), ACCENT, name="Pitch bar")
text(s, Inches(0.95), Inches(2.75), Inches(6.5), Inches(0.35), "THE PITCH.",
     size=14, color=ACCENT, bold=True, name="Pitch label")
text(s, Inches(0.95), Inches(3.1), Inches(6.5), Inches(0.8),
     "“See the swarm after it ran.”", size=32, bold=True, name="One-liner")
bullets(s, Inches(0.7), Inches(4.3), Inches(6.8), [
    "Table of outputs plus a tree clip per run",
    "Gemini voice narrates the numbers in one minute",
    "Public MIT site: visualization only, engines stay home",
], gap=0.55, size=17)
text(s, Inches(0.7), Inches(6.2), Inches(6.9), Inches(0.35),
     "Lane: Best Use of Managed Agents", size=14, color=WARN, bold=True, name="Lane")
text(s, Inches(0.7), Inches(6.6), Inches(6.9), Inches(0.35),
     "mkultra00.github.io/swarm-visualizer", size=14, color=ACCENT, name="Live URL")

# ---------- 2. What it is ----------
s = base("What it is: table + tree + voice",
         "Three pieces on one page. The table of outputs and the Gource-style tree clip "
         "are the two first-class elements. The Gemini TTS sidecar reads the numbers. "
         "The site is visualization only; the attack engines never leave the lab Mac.",
         kicker="WHAT IT IS")
cards = [
    ("Table of outputs", TABLE_PNG, "One row per sanitized run: target, agent LLM, label."),
    ("Gource tree clip", TREE_PNG, "media/gource/*.mp4 from the saved renderer."),
    ("Gemini voice", WAVE_PNG, "gemini-3.8-flash-tts wav reads the run aloud."),
]
cw, gx = 3.85, 0.2
for i, (head, img, desc) in enumerate(cards):
    x = Inches(0.7 + i * (cw + gx))
    card(s, x, Inches(1.55), Inches(cw), Inches(4.5), f"{head} card")
    ih = 2.2
    if img == WAVE_PNG:
        picture(s, img, x + Inches(0.25), Inches(1.85) + Inches(0.55), Inches(cw - 0.5),
                Inches((cw - 0.5) * 420 / 1600), name=f"{head} art")
    elif img == TREE_PNG:
        picture(s, img, x + Inches((cw - ih) / 2), Inches(1.8), Inches(ih), Inches(ih),
                name=f"{head} art")
    else:
        aw = cw - 0.5
        picture(s, img, x + Inches(0.25), Inches(1.85), Inches(aw), Inches(aw * 900 / 1400),
                name=f"{head} art")
    text(s, x + Inches(0.3), Inches(4.25), Inches(cw - 0.6), Inches(0.5), head,
         size=22, bold=True, name=f"{head} header")
    assert len(desc.split()) <= MAX_WORDS, desc
    text(s, x + Inches(0.3), Inches(4.85), Inches(cw - 0.6), Inches(1.0), desc,
         size=15, color=MUTE, name=f"{head} desc")
bar = rect(s, Inches(0.7), Inches(6.3), Inches(11.95), Inches(0.55), PANEL,
           MSO_SHAPE.ROUNDED_RECTANGLE, name="Scope strip", line=ACCENT)
bar.adjustments[0] = 0.5
text(s, Inches(1.0), Inches(6.3), Inches(11.4), Inches(0.55),
     [("Public site is viz-only.  ", {"color": ACCENT, "bold": True}),
      ("Attack engines stay on the lab Mac. This repo is the website only.", {})],
     size=16, anchor=MSO_ANCHOR.MIDDLE, name="Scope text")

# ---------- 3. Why it's useful ----------
s = base("Why it's useful: see · hear · classify",
         "Judges can see a swarm after the run as tree motion plus a table, not a log "
         "dump. The voice explains the numbers so a one-minute demo is audible. The "
         "Decisions API labels each run from numbers-only JSON, never from payloads. "
         "Nothing on the public site is a live target, an exploit, or a key.",
         kicker="WHY IT'S USEFUL")
bullets(s, Inches(0.7), Inches(1.65), Inches(6.6), [
    [("See: ", {"bold": True, "color": ACCENT}), ("tree motion plus table, not a log dump", {})],
    [("Hear: ", {"bold": True, "color": ACCENT}), ("voice explains the numbers, demo is audible", {})],
    [("Classify: ", {"bold": True, "color": ACCENT}), ("Decisions API labels runs from numbers only", {})],
    [("Safe: ", {"bold": True, "color": ACCENT}), ("no exploits, no live targets, no keys", {})],
    "Offline after load; no keys in the browser",
], gap=0.92, size=19)
card(s, Inches(7.7), Inches(1.55), Inches(4.95), Inches(5.2), "Demo panel")
text(s, Inches(8.0), Inches(1.8), Inches(4.4), Inches(0.35), "DEMO LENGTH",
     size=13, color=MUTE, bold=True, name="Demo label")
text(s, Inches(8.0), Inches(2.15), Inches(4.4), Inches(1.0),
     [("1", {"color": ACCENT}), (" minute", {"size": 30, "color": INK})],
     size=64, bold=True, name="Demo stat")
picture(s, WAVE_PNG, Inches(8.0), Inches(3.45), Inches(4.4), Inches(4.4 * 420 / 1600),
        name="Waveform")
text(s, Inches(8.0), Inches(4.75), Inches(4.4), Inches(0.35), "LABELED BY",
     size=13, color=MUTE, bold=True, name="Label label")
text(s, Inches(8.0), Inches(5.1), Inches(4.4), Inches(0.5), "gemini-decision-1",
     size=24, bold=True, color=WARN, name="Decision model")
text(s, Inches(8.0), Inches(5.65), Inches(4.4), Inches(0.8),
     "Numbers-only JSON in, a label out. Payloads never sent.",
     size=14, color=MUTE, name="Decision note")

# ---------- 4. The picture ----------
s = base("The picture",
         "This is a real still from the Gource-style tree clip of a sanitized crAPI run, "
         "run 6bec75ed. The HUD shows FRAME, RUN and AGENT LLM. AGENT LLM is the worker "
         "from that run's own log, gpt-oss:20b here, not Gemini. Gemini only narrates "
         "and classifies. The smaller still is the Juice Shop run 7eaf9541.",
         kicker="THE PICTURE")
pw = 8.6
ph = pw * 720 / 1280
picture(s, STILL_CRAPI, Inches(0.7), Inches(1.5), Inches(pw), Inches(ph),
        name="Gource still crAPI", frame=True)
text(s, Inches(0.7), Inches(1.5 + ph + 0.15), Inches(pw), Inches(0.4),
     "Gource tree of a sanitized crAPI run", size=16, color=MUTE, name="Caption")
rx = 9.65
jw = 3.0
picture(s, STILL_JUICE, Inches(rx), Inches(1.5), Inches(jw), Inches(jw * 720 / 1280),
        name="Gource still Juice Shop", frame=True)
text(s, Inches(rx), Inches(1.5 + jw * 720 / 1280 + 0.1), Inches(jw), Inches(0.35),
     "Juice Shop  ·  7eaf9541", size=12, color=MUTE, name="Juice caption")
text(s, Inches(rx), Inches(3.75), Inches(jw), Inches(0.3), "HUD",
     size=13, color=MUTE, bold=True, name="HUD label")
chip(s, Inches(rx), Inches(4.1), "FRAME", "crAPI", w=jw, name="Chip FRAME")
chip(s, Inches(rx), Inches(4.7), "RUN", "6bec75ed", w=jw, name="Chip RUN")
chip(s, Inches(rx), Inches(5.3), "AGENT LLM", "gpt-oss:20b", w=jw, vcol=OK, name="Chip AGENT LLM")
text(s, Inches(rx), Inches(5.95), Inches(jw), Inches(0.8),
     "Worker comes from that run's log.", size=13, color=MUTE, name="HUD note")

# ---------- 5. Stack ----------
s = base("Stack: five tools we actually used",
         "GitHub Pages hosts the static site. Gemini Decisions gemini-decision-1 labels "
         "runs. Gemini TTS gemini-3.8-flash-tts is the narrator sidecar. The Gource-style "
         "renderer is PIL to mp4 from the swarm-attack-gource skill. The Node test suite "
         "passes 110 of 110. Honesty: the sample workers are glm and gpt-oss; Gemini did "
         "voice and Decisions only.",
         kicker="STACK")
stack = [
    ("GitHub Pages", "Static site", ACCENT),
    ("Gemini Decisions", "gemini-decision-1 on numbers-only JSON", WARN),
    ("Gemini TTS", "gemini-3.8-flash-tts narrator sidecar (wav)", ACCENT),
    ("Gource-style renderer", "PIL → mp4, skill swarm-attack-gource", BAD),
    ("Node test suite", "node --test tests/*.test.js → 110/110", OK),
]
cw, gx = 2.27, 0.15
for i, (head, desc, col) in enumerate(stack):
    x = Inches(0.7 + i * (cw + gx))
    card(s, x, Inches(1.55), Inches(cw), Inches(2.9), f"{head} card")
    rect(s, x + Inches(0.25), Inches(1.8), Inches(0.5), Inches(0.08), col, name=f"{head} bar")
    text(s, x + Inches(0.25), Inches(2.05), Inches(cw - 0.45), Inches(0.9), head,
         size=19, bold=True, name=f"{head} name")
    assert len(desc.split()) <= MAX_WORDS, desc
    text(s, x + Inches(0.25), Inches(3.0), Inches(cw - 0.45), Inches(1.3), desc,
         size=13, color=MUTE, name=f"{head} desc")
text(s, Inches(0.7), Inches(4.7), Inches(11.9), Inches(0.35), "SAMPLE RUNS  ·  AGENT LLM FROM EACH LOG",
     size=13, color=MUTE, bold=True, name="Samples label")
samples = [
    ("Vault Notes exam 7", "7b5ee689", "glm-5.3:cloud", OK),
    ("Vault Notes exam 8", "7c2756ff", "rejected · no clip", BAD),
    ("Vault Notes exam 9", "28bdd7b7", "glm-5.3:cloud", OK),
    ("Juice Shop", "7eaf9541", "gpt-oss:20b", OK),
    ("crAPI", "6bec75ed", "gpt-oss:20b", OK),
]
for i, (name, rid, worker, col) in enumerate(samples):
    x = Inches(0.7 + i * (cw + gx))
    c = rect(s, x, Inches(5.1), Inches(cw), Inches(1.0), PANEL, MSO_SHAPE.ROUNDED_RECTANGLE,
             name=f"Sample {rid}", line=LINE)
    c.adjustments[0] = 0.15
    text(s, x + Inches(0.2), Inches(5.15), Inches(cw - 0.3), Inches(0.25), name,
         size=12, bold=True, name=f"Sample {rid} name")
    text(s, x + Inches(0.2), Inches(5.4), Inches(cw - 0.3), Inches(0.25), rid,
         size=11, color=MUTE, name=f"Sample {rid} id")
    text(s, x + Inches(0.2), Inches(5.67), Inches(cw - 0.3), Inches(0.35), worker,
         size=16, bold=True, color=col, name=f"Sample {rid} worker")
text(s, Inches(0.7), Inches(6.35), Inches(11.9), Inches(0.45),
     [("Honesty: ", {"color": WARN, "bold": True}),
      ("sample workers are glm / gpt-oss; Gemini did voice + Decisions.", {})],
     size=16, name="Honesty line")

# ---------- 6. Links + limits ----------
s = base("Links + limits",
         "Open the live site now; it works offline after load and has no keys in the "
         "browser. Limits, stated plainly: it is visualization only with no payloads. "
         "Exam 8 was rejected for a dirty log, so it has no clip. The usd column stays "
         "empty unless the log carries cost. The narrator is Gemini; the worker is "
         "whatever the run's log says.",
         kicker="LINKS + LIMITS")
card(s, Inches(0.7), Inches(1.55), Inches(5.9), Inches(5.2), "Links panel")
text(s, Inches(1.0), Inches(1.85), Inches(5.3), Inches(0.35), "LIVE",
     size=13, color=MUTE, bold=True, name="Live label")
text(s, Inches(1.0), Inches(2.2), Inches(5.3), Inches(0.9),
     "https://mkultra00.github.io/swarm-visualizer/", size=20, bold=True, color=ACCENT,
     name="Live link")
text(s, Inches(1.0), Inches(3.25), Inches(5.3), Inches(0.35), "GITHUB",
     size=13, color=MUTE, bold=True, name="GitHub label")
text(s, Inches(1.0), Inches(3.6), Inches(5.3), Inches(0.9),
     "https://github.com/Mkultra00/swarm-visualizer", size=20, bold=True, color=INK,
     name="GitHub link")
picture(s, TREE_PNG, Inches(1.0), Inches(4.65), Inches(1.8), Inches(1.8), name="Mini tree")
text(s, Inches(3.0), Inches(4.85), Inches(3.4), Inches(1.6),
     "MIT · GitHub Pages · offline after load · no keys in the browser",
     size=15, color=MUTE, name="Site facts")
text(s, Inches(7.1), Inches(1.6), Inches(5.5), Inches(0.35), "LIMITS",
     size=13, color=WARN, bold=True, name="Limits label")
bullets(s, Inches(7.1), Inches(2.05), Inches(5.6), [
    "Visualization only; no payloads on the public site",
    "Vault Notes exam 8 skipped: dirty log, no clip",
    "usd stays empty unless the log carries cost",
    "Narrator (Gemini TTS) is not the worker LLM",
    "HUD worker comes from each run's own log",
], gap=0.9, size=18, dot=WARN)

# ====================================================================
# Checks + save
# ====================================================================
blob = "\n".join(ALL_TEXT)
BANNED = [r"sk_", r"\.env\b", r"api[_-]?key", r"password", r"\bquantum\b", r"THE HOOK",
          r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", r"\bAWS\b", r"\bAzure\b",
          r"Cloudflare", r"ElevenLabs", r"OpenAI", r"ChatGPT", r"Anthropic", r"Shopify",
          r"\bCarbon\b", r"\bHydrogen\b", r"\bNeon\b"]
for pat in BANNED:
    assert not re.search(pat, blob, re.I), f"forbidden text: {pat}"
for must in ("swarm-visualizer", "Gource", "gemini-decision-1", "gemini-3.8-flash-tts",
             "GitHub Pages", "THE PITCH", "110/110", "glm-5.3:cloud", "gpt-oss:20b"):
    assert must in blob, must
assert len(prs.slides) == 6
for sl in prs.slides:
    assert sl.has_notes_slide and sl.notes_slide.notes_text_frame.text.strip()
assert {"gource-still-crapi.png", "tree.png"} <= set(PICTURES), PICTURES

audit = []
overflow = []
SH_IN, SW_IN = SH / EMU, SW / EMU
for i, sl in enumerate(prs.slides, 1):
    worst_b = worst_r = 0.0
    for sh in sl.shapes:
        bottom = (sh.top + sh.height) / EMU
        right = (sh.left + sh.width) / EMU
        worst_b, worst_r = max(worst_b, bottom), max(worst_r, right)
        if bottom > SH_IN + 1e-3 or right > SW_IN + 1e-3:
            overflow.append((i, sh.name, round(bottom, 3), round(right, 3)))
    audit.append((i, len(sl.shapes), round(worst_b, 3), round(worst_r, 3)))
assert not overflow, overflow

REPO_COPY.parent.mkdir(parents=True, exist_ok=True)
prs.save(REPO_COPY)
OUT.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(REPO_COPY, OUT)

xml = []
with zipfile.ZipFile(REPO_COPY) as z:
    for n in z.namelist():
        if re.fullmatch(r"ppt/slides/slide\d+\.xml", n):
            xml.append(z.read(n).decode("utf-8", "replace"))
    media = [n for n in z.namelist() if n.startswith("ppt/media/")]
joined = "\n".join(xml)
for must in ("swarm-visualizer", "Gource", "gemini-decision-1", "gemini-3.8-flash-tts",
             "GitHub Pages", "THE PITCH"):
    assert must in joined, f"missing in slide XML: {must}"
assert "THE HOOK" not in joined and "quantum" not in joined.lower()

# Readback
rb = Presentation(str(REPO_COPY))
titles = []
for sl in rb.slides:
    first = next((sh.text_frame.text for sh in sl.shapes
                  if sh.has_text_frame and sh.name == "Title"), "")
    titles.append(first.splitlines()[0] if first else "")
    assert sl.notes_slide.notes_text_frame.text.strip()
assert len(rb.slides) == 6 and all(titles), titles

stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
log = [f"\n## {stamp} — pitch deck build (docs/build_pitch_deck.py)\n",
       f"- Output: `docs/swarm-visualizer-pitch.pptx`, copy `{OUT}`",
       f"- Slide count: {len(rb.slides)} (16:9, 13.333 × 7.5 in); notes on every slide",
       f"- Titles: " + " | ".join(titles),
       f"- PIL assets: `docs/assets/tree.png`, `docs/assets/waveform.png`, `docs/assets/table-grid.png`",
       f"- Embedded media parts: {len(media)} ({', '.join(sorted(set(PICTURES)))})",
       f"- Bullets ≤{MAX_BULLETS} per block, ≤{MAX_WORDS} words each: asserted",
       "- Ban sweep: pass; slide-XML string check: pass",
       f"- Overflow audit (top+height ≤ {SH_IN:.2f} in, left+width ≤ {SW_IN:.3f} in): "
       f"{'PASS' if not overflow else 'FAIL'}",
       "",
       "| slide | shapes | max bottom (in) | max right (in) |",
       "|---|---|---|---|"]
log += [f"| {i} | {n} | {b} | {r} |" for i, n, b, r in audit]
with BUILD_LOG.open("a") as fh:
    if fh.tell() == 0:
        fh.write("# BUILD_LOG\n")
    fh.write("\n".join(log) + "\n")

print(f"SLIDE_COUNT={len(rb.slides)}")
print("TITLES=" + " | ".join(titles))
print("OVERFLOW_AUDIT=PASS")
for row in audit:
    print("  slide %d: shapes=%d max_bottom=%.3f max_right=%.3f" % row)
print(f"OUTPUT={REPO_COPY}")
print(f"COPY={OUT}")
