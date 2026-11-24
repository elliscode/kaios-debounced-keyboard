#!/usr/bin/env python3
"""gen_readme_svgs.py — regenerate the README diagrams in docs/img/.

Usage: python3 tools/gen_readme_svgs.py docs/img
The numbers match the defaults in app/js/debounce_config.js.
"""
import sys, os
OUT = sys.argv[1]
STYLE = """<style>
  .t { fill: #222; font-family: sans-serif; font-size: 14px; }
  .b { font-weight: bold; }
  .s { fill: #555; font-family: sans-serif; font-size: 12px; }
  .in { fill: #fff; font-family: sans-serif; font-size: 13px; font-weight: bold; }
  .ind { fill: #222; font-family: sans-serif; font-size: 13px; font-weight: bold; }
  .ax { stroke: #777; stroke-width: 1; fill: none; }
  .grid { stroke: #bbb; stroke-width: 1; stroke-dasharray: 3 3; fill: none; }
  .sig { stroke: #111; stroke-width: 2.5; fill: none; }
  .bnc { stroke: #d62828; stroke-width: 2.5; fill: none; }
  .bncl { stroke: #d62828; stroke-width: 1.5; stroke-dasharray: 4 3; fill: none; }
  .bt { fill: #d62828; font-family: sans-serif; font-size: 12px; font-weight: bold; }
  @media (prefers-color-scheme: dark) {
    .t { fill: #e6e6e6; }
    .s { fill: #aaa; }
    .ax { stroke: #999; }
    .grid { stroke: #555; }
    .sig { stroke: #f2f2f2; }
    .bnc, .bncl { stroke: #ff5c5c; }
    .bt { fill: #ff6b6b; }
  }
</style>"""
RED, AMB, GRN = "#c8323c", "#f0b429", "#2e8b57"
WIN_CD, WIN_GAP = "#7b61c9", "#c8323c"

def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">\n'
            f'<title>{title}</title>\n{STYLE}\n{body}</svg>\n')

# ---------- rule-windows.svg
def rule_windows():
    x0, x1, T = 30, 650, 120
    X = lambda ms: x0 + (x1 - x0) * ms / T
    o = []
    def bar(y, segs):
        for a, b, col, label, cls in segs:
            o.append(f'<rect x="{X(a):.1f}" y="{y}" width="{X(b)-X(a):.1f}" height="34" fill="{col}"/>')
            o.append(f'<text class="{cls}" x="{(X(a)+X(b))/2:.1f}" y="{y+22}" text-anchor="middle">{label}</text>')
    def ticks(y, ts):
        o.append(f'<line class="ax" x1="{x0}" y1="{y}" x2="{x1}" y2="{y}"/>')
        for t in ts:
            o.append(f'<line class="ax" x1="{X(t):.1f}" y1="{y}" x2="{X(t):.1f}" y2="{y+5}"/>')
            o.append(f'<text class="s" x="{X(t):.1f}" y="{y+19}" text-anchor="middle">{t} ms</text>')
    o.append(f'<text class="t b" x="{x0}" y="22">Gap rules: clock starts when you let go of the key</text>')
    o.append(f'<text class="s" x="{x0}" y="40">time from the last kept release of the same key to the next press</text>')
    bar(50, [(0, 45, RED, "always drop", "in"), (45, 60, AMB, "?", "ind"), (60, 120, GRN, "keep", "in")])
    o.append(f'<text class="s" x="{(X(0)+X(45))/2:.1f}" y="100" text-anchor="middle">Hard gap</text>')
    o.append(f'<text class="s" x="{(X(45)+X(60))/2:.1f}" y="100" text-anchor="middle">Soft gap</text>')
    ticks(108, [0, 45, 60, 120])
    o.append(f'<text class="t b" x="{x0}" y="170">Same-key cooldown: clock starts when you press the key</text>')
    o.append(f'<text class="s" x="{x0}" y="188">time from the last kept press of the same key to the next press</text>')
    bar(198, [(0, 110, RED, "drop", "in"), (110, 120, GRN, "keep", "in")])
    ticks(232, [0, 110, 120])
    o.append(f'<text class="s" x="{x0}" y="282">? = wait Short hold (30 ms): released sooner = drop,</text>')
    o.append(f'<text class="s" x="{x0}" y="298">still held = keep (delivered 30 ms late)</text>')
    return svg(680, 312, "\n".join(o) + "\n", "Debounce rule windows on a 0 to 120 ms axis")

# ---------- scenario plots
def scenario(T, press_up, b_down, b_up, cooldown, hard, ticks, caption, title, name):
    x0, x1 = 70, 650
    X = lambda ms: x0 + (x1 - x0) * ms / T
    yU, yD = 50, 100
    o = []
    o.append(f'<text class="t b" x="{x0}" y="22">{title}</text>')
    o.append(f'<text class="s" x="{x0-8}" y="{yU+4}" text-anchor="end">1 let go</text>')
    o.append(f'<text class="s" x="{x0-8}" y="{yD+4}" text-anchor="end">0 pressed</text>')
    o.append(f'<line class="grid" x1="{x0}" y1="{yU}" x2="{x1}" y2="{yU}"/>')
    o.append(f'<line class="grid" x1="{x0}" y1="{yD}" x2="{x1}" y2="{yD}"/>')
    # real press (black) then bounce (red)
    o.append(f'<path class="sig" d="M{x0},{yU} V{yD} H{X(press_up):.1f} V{yU} H{X(b_down):.1f} M{X(b_up):.1f},{yU} H{x1}"/>')
    o.append(f'<path class="bnc" d="M{X(b_down):.1f},{yU} V{yD} H{X(b_up):.1f} V{yU}"/>')
    o.append(f'<text class="s" x="{(x0+X(press_up))/2:.1f}" y="{yD+16}" text-anchor="middle">real press</text>')
    o.append(f'<text class="bt" x="{(X(b_down)+X(b_up))/2:.1f}" y="{yU-8}" text-anchor="middle">bounce</text>')
    # strips
    ys = [(140, 0, cooldown, WIN_CD, f"Cooldown {cooldown} ms (from press)"),
          (180, press_up, press_up + hard, WIN_GAP, f"Hard gap {hard} ms (from release)")]
    for y, a, b, col, label in ys:
        o.append(f'<rect x="{x0}" y="{y}" width="{x1-x0}" height="24" fill="{col}" fill-opacity="0.12"/>')
        o.append(f'<rect x="{X(a):.1f}" y="{y}" width="{X(b)-X(a):.1f}" height="24" fill="{col}" fill-opacity="0.85"/>')
        tx, anchor, cls = X(b) + 6, "start", "t"
        if tx > x1 - 200:
            if X(b) - X(a) > 240:
                tx, anchor, cls = X(a) + 8, "start", "in"
            else:
                tx, anchor = X(a) - 6, "end"
        o.append(f'<text class="{cls}" x="{tx:.1f}" y="{y+17}" text-anchor="{anchor}">{label}</text>')
    o.append(f'<line class="bncl" x1="{X(b_down):.1f}" y1="{yU}" x2="{X(b_down):.1f}" y2="212"/>')
    # axis
    o.append(f'<line class="ax" x1="{x0}" y1="222" x2="{x1}" y2="222"/>')
    for t in ticks:
        o.append(f'<line class="ax" x1="{X(t):.1f}" y1="222" x2="{X(t):.1f}" y2="227"/>')
        o.append(f'<text class="s" x="{X(t):.1f}" y="241" text-anchor="middle">{t}</text>')
    o.append(f'<text class="s" x="{x1}" y="241" text-anchor="end" dx="0" dy="14">ms</text>')
    o.append(f'<text class="t" x="{x0}" y="276">{caption}</text>')
    open(os.path.join(OUT, name), "w").write(svg(680, 290, "\n".join(o) + "\n", title))

open(os.path.join(OUT, "rule-windows.svg"), "w").write(rule_windows())
scenario(120, 30, 50, 55, 110, 45, [0, 30, 50, 75, 110, 120],
         "Bounce falls in both windows → dropped (cooldown catches it first).",
         "Short tap, bounce 20 ms after release", "scenario-short-hold.svg")
scenario(400, 300, 320, 330, 110, 45, [0, 110, 200, 300, 345, 400],
         "Cooldown already over → hard gap drops it.",
         "Long hold, bounce 20 ms after release", "scenario-long-hold.svg")
