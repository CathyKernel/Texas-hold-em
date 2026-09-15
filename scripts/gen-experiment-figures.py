#!/usr/bin/env python3
"""Experiment figures for the paper -- complete redesign (v2).

Layout rules applied to every figure:
  * value labels never touch bars, error bars, whisker caps, markers, the
    diagonal reference line, or the frame;
  * horizontal bar layouts give each label its own row, so label-label
    collisions are impossible by construction;
  * scatter labels are placed by an exhaustive geometric search that
    rejects any candidate overlapping a marker, the diagonal, another
    label, the legend, or the frame;
  * axis limits are auto-extended (measure-then-extend) until every label
    fits inside the frame with margin;
  * ALL display-space geometry is captured only after the final canvas
    draw, so constrained_layout can never invalidate the checks.
"""
import json
import os
from itertools import combinations

import matplotlib
import matplotlib.font_manager as fm

for fp in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
    if os.path.exists(fp):
        fm.fontManager.addfont(fp)

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Noto Sans SC']
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['font.size'] = 11

FIG = os.path.join(os.path.dirname(__file__), '..', 'paper', 'figures')
SCRIPTS = os.path.dirname(os.path.abspath(__file__))

agg = json.load(open(os.path.join(SCRIPTS, 'tournament-aggregate.json')))
stats = agg['stats']
blocks = [json.load(open(os.path.join(SCRIPTS, f'tournament-results-block-{b}.json')))
          for b in range(5)]

TYPES = ['rule', 'montecarlo', 'cfr', 'deepcfr', 'rl']
LABELS = {'rule': 'Rule-based', 'montecarlo': 'Monte Carlo', 'cfr': 'CFR (tabular)',
          'deepcfr': 'Deep CFR', 'rl': 'RL (Q-learning)'}
COLORS = {'rule': '#8a6d1d', 'montecarlo': '#4a7a8c', 'cfr': '#2e5d4e',
          'deepcfr': '#7a2e2e', 'rl': '#5b4a8c'}


# ------------------------------------------------------------------ QA toolkit
def _expanded(b, px):
    return matplotlib.transforms.Bbox([[b.x0 - px, b.y0 - px], [b.x1 + px, b.y1 + px]])


def _seg_points(p0, p1, n=200):
    return [(p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n)
            for i in range(n + 1)]


def _rect_hits_segment(rect, p0, p1, pad=3.0):
    r = _expanded(rect, pad)
    return any(r.contains(x, y) for (x, y) in _seg_points(p0, p1))


def _rect_hits_points(rect, pts, radius=4.0):
    r = _expanded(rect, radius)
    return any(r.contains(x, y) for (x, y) in pts)


def verify_labels(fig, ax, name, bars=None, segments=None, point_clouds=None,
                  markers=None, pad=2.0):
    """Renderer-level QA gate. Fails the build on any collision:
    text/text, text/frame, text/legend, text/bar, text/segment,
    text/point-cloud, text/marker."""
    fig.canvas.draw()
    ren = fig.canvas.get_renderer()
    axb = ax.get_window_extent(ren)
    boxes = [(t.get_text().replace('\n', ' '), t.get_window_extent(ren))
             for t in ax.texts]
    leg = ax.get_legend()
    legb = leg.get_window_extent(ren) if leg is not None else None
    figb = fig.bbox
    fails = []
    for artist, kind in [(ax.title, 'title'), (ax.xaxis.label, 'xlabel'),
                         (ax.yaxis.label, 'ylabel')]:
        if artist.get_text():
            b = artist.get_window_extent(ren)
            if (b.x0 < figb.x0 + 1 or b.x1 > figb.x1 - 1 or
                    b.y0 < figb.y0 + 1 or b.y1 > figb.y1 - 1):
                fails.append(f'{name}: {kind} {artist.get_text()[:40]!r} leaves the '
                             f'figure bounds box={tuple(round(v) for v in (b.x0, b.y0, b.x1, b.y1))} '
                             f'figure={tuple(round(v) for v in (figb.x0, figb.y0, figb.x1, figb.y1))}')
    for (na, ba), (nb, bb) in combinations(boxes, 2):
        if _expanded(ba, pad).overlaps(_expanded(bb, pad)):
            fails.append(f'{name}: text/text overlap {na!r} vs {nb!r}')
    for n, b in boxes:
        if (b.x0 < axb.x0 + 1 or b.x1 > axb.x1 - 1 or
                b.y0 < axb.y0 + 1 or b.y1 > axb.y1 - 1):
            fails.append(f'{name}: {n!r} touches or leaves the axes frame '
                         f'box={tuple(round(v) for v in (b.x0, b.y0, b.x1, b.y1))} '
                         f'axes={tuple(round(v) for v in (axb.x0, axb.y0, axb.x1, axb.y1))}')
        if legb is not None and b.overlaps(legb):
            fails.append(f'{name}: {n!r} overlaps the legend')
        if bars:
            for patch in bars:
                if b.overlaps(patch.get_window_extent(ren)):
                    fails.append(f'{name}: {n!r} overlaps a bar')
                    break
        if segments:
            for (p0, p1) in segments:
                if _rect_hits_segment(b, p0, p1):
                    fails.append(f'{name}: {n!r} overlaps a line segment')
                    break
        if point_clouds:
            for pts in point_clouds:
                if _rect_hits_points(b, pts):
                    fails.append(f'{name}: {n!r} overlaps a plotted curve')
                    break
        if markers:
            for (cx, cy, r) in markers:
                mb = matplotlib.transforms.Bbox([[cx - r, cy - r], [cx + r, cy + r]])
                if b.overlaps(mb):
                    fails.append(f'{name}: {n!r} overlaps a scatter marker')
                    break
    if fails:
        for f in fails:
            print('  FAIL ' + f)
        raise SystemExit(1)
    print(f'  {name}: label QA passed ({len(boxes)} text artists checked)')


def extend_xlim_for_texts(fig, ax, texts, pad_frac=0.06):
    """Measure-then-extend: widen xlim (both sides) until every label clears
    the frame. Works for labels anchored at data coordinates."""
    fig.canvas.draw()
    ren = fig.canvas.get_renderer()
    inv = ax.transData.inverted()
    axb = ax.get_window_extent(ren)
    ymid = 0.5 * (axb.y0 + axb.y1)
    x1 = max(t.get_window_extent(ren).x1 for t in texts)
    x0 = min(t.get_window_extent(ren).x0 for t in texts)
    hi = inv.transform((x1, ymid))[0]
    lo = inv.transform((x0, ymid))[0]
    cur = ax.get_xlim()
    span = cur[1] - cur[0]
    ax.set_xlim(min(cur[0], lo - pad_frac * span), max(cur[1], hi + pad_frac * span))
    fig.canvas.draw()


# ---------------------------------------------- Figure 6: win rates, HORIZONTAL bars
# Each agent owns a full row: the value label sits beyond its whisker cap
# with a fixed data-unit gap, so label/whisker/bar/frame collisions are all
# impossible by construction. Grid removed: nothing remains to cross.
order = ['deepcfr', 'rule', 'rl', 'montecarlo', 'cfr']  # best first (top row)
vals = np.array([stats[t]['bbPer100'] for t in order])
ses = np.array([stats[t]['se_bbPerHand'] * 100 for t in order])
names = [LABELS[t] for t in order]
cols = [COLORS[t] for t in order]

fig, ax = plt.subplots(figsize=(8.0, 4.3), constrained_layout=True)
ypos = np.arange(len(order))
bars = ax.barh(ypos, vals, height=0.58, color=cols,
               edgecolor='#222', linewidth=0.7)
ax.errorbar(vals, ypos, xerr=1.96 * ses, fmt='none', ecolor='#111',
            elinewidth=1.25, capsize=5.5, capthick=1.25, zorder=4)
ax.axvline(0, color='#444', linewidth=0.9, zorder=1)
val_labels = []
GAP = 16.0  # data units beyond the whisker cap
for y, v, s in zip(ypos, vals, ses):
    if v >= 0:
        t = ax.text(v + 1.96 * s + GAP, y, f'{v:+.1f}', ha='left', va='center',
                    fontsize=11, fontweight='bold', color='#16302a')
    else:
        t = ax.text(v - 1.96 * s - GAP, y, f'{v:+.1f}', ha='right', va='center',
                    fontsize=11, fontweight='bold', color='#16302a')
    val_labels.append(t)
ax.set_ylim(len(order) - 0.45, -0.55)  # best agent on the top row
ax.set_yticks(ypos, names, fontsize=10.5)
ax.set_xlim(-300, 260)
ax.set_xticks([-200, -100, 0, 100, 200])
ax.set_xlabel('Win rate (big blinds per 100 hands)', fontsize=11)
ax.spines[['top', 'right']].set_visible(False)
ax.set_title('Mean win rate over 100,000 hands (error bars: 95% CI)',
             fontsize=12, pad=12)
extend_xlim_for_texts(fig, ax, val_labels)
# error-bar geometry (whiskers + caps) captured after the FINAL layout+limits
fig.canvas.draw()
err_segments = []
for y, v, s in zip(ypos, vals, ses):
    lo, hi = v - 1.96 * s, v + 1.96 * s
    xlo, yy = ax.transData.transform((lo, y))
    xhi, _ = ax.transData.transform((hi, y))
    half_cap = 5.5 / 72 * fig.dpi
    err_segments.append(((xlo, yy), (xhi, yy)))                      # whisker line
    err_segments.append(((xlo, yy - half_cap), (xlo, yy + half_cap)))  # lo cap
    err_segments.append(((xhi, yy - half_cap), (xhi, yy + half_cap)))  # hi cap
verify_labels(fig, ax, 'Figure 6 (win_rates)', bars=bars, segments=err_segments)
fig.savefig(os.path.join(FIG, 'win_rates.png'), dpi=300)
plt.close(fig)
print('win_rates.png done')


# ---------------------------------------------- Figure 7: style space (VPIP vs PFR)
# Labels are placed by geometric search: for every marker we try eight
# candidate offsets (scaled to that marker's actual radius) and accept the
# first one whose rendered text box clears every marker, the diagonal, the
# previously placed labels, the legend and the frame.
fig, ax = plt.subplots(figsize=(7.2, 5.2), constrained_layout=True)
diag, = ax.plot([0, 80], [0, 80], '--', color='#999', linewidth=1.0, zorder=1,
                label='PFR = VPIP (no limping)')
for t in TYPES:
    s = stats[t]
    ax.scatter(s['vpip'], s['pfr'], s=90 + s['aggressionFreq'] * 5.5,
               color=COLORS[t], alpha=0.85, edgecolor='#222', linewidth=0.8,
               zorder=3)
ax.set_xlim(0, 100)
ax.set_ylim(0, 80)
ax.set_xlabel('VPIP: % of hands voluntarily played')
ax.set_ylabel('PFR: % of hands raised pre-flop')
ax.set_title('Playing styles: aggression axes '
             '(marker size = overall raise frequency)', fontsize=12, pad=12)
ax.grid(alpha=0.25, linewidth=0.5)
ax.set_axisbelow(True)
ax.legend(loc='upper left', frameon=False, fontsize=9.5)


def place_labels_geometrically(fig, ax, items):
    """items: list of (x, y, marker_size_pt2, text, color). Places each text
    at the first collision-free candidate offset around its marker."""
    fig.canvas.draw()
    ren = fig.canvas.get_renderer()
    axb = ax.get_window_extent(ren)
    leg = ax.get_legend()
    legb = leg.get_window_extent(ren) if leg is not None else None
    d0 = ax.transData.transform((0, 0))
    dxu = ax.transData.transform((1, 0))[0] - d0[0]   # px per x-data unit
    dyu = ax.transData.transform((0, 1))[1] - d0[1]   # px per y-data unit
    placed = []
    marker_circles = []
    for (x, y, sz, _, _) in items:
        r_px = np.sqrt(sz) / 2 * fig.dpi / 72
        marker_circles.append((*ax.transData.transform((x, y)), r_px))
    diag_p0 = ax.transData.transform((0, 0))
    diag_p1 = ax.transData.transform((80, 80))
    for (x, y, sz, text, color) in items:
        r_px = np.sqrt(sz) / 2 * fig.dpi / 72
        buf_px = r_px + 11
        cx_off = buf_px / dxu          # clear x-offset in data units
        cy_off = buf_px / dyu          # clear y-offset in data units
        candidates = [
            (cx_off * 1.18, 0, 'left', 'center'),
            (0, cy_off * 1.18, 'center', 'bottom'),
            (-cx_off * 1.18, 0, 'right', 'center'),
            (0, -cy_off * 1.18, 'center', 'top'),
            (cx_off * 0.92, cy_off * 0.92, 'left', 'bottom'),
            (cx_off * 0.92, -cy_off * 0.92, 'left', 'top'),
            (-cx_off * 0.92, cy_off * 0.92, 'right', 'bottom'),
            (-cx_off * 0.92, -cy_off * 0.92, 'right', 'top'),
        ]
        accepted = None
        for (dx, dy, ha, va) in candidates:
            t = ax.text(x + dx, y + dy, text, ha=ha, va=va, fontsize=10,
                        fontweight='bold', color=color,
                        bbox=dict(facecolor='white', edgecolor='none', pad=1.4))
            fig.canvas.draw()
            b = t.get_window_extent(ren)
            ok = (b.x0 > axb.x0 + 4 and b.x1 < axb.x1 - 4 and
                  b.y0 > axb.y0 + 4 and b.y1 < axb.y1 - 4)
            if ok and legb is not None and b.overlaps(legb):
                ok = False
            if ok:
                for (cx, cy, r) in marker_circles:
                    mb = matplotlib.transforms.Bbox(
                        [[cx - r - 7, cy - r - 7], [cx + r + 7, cy + r + 7]])
                    if b.overlaps(mb):
                        ok = False
                        break
            if ok:
                for (_, pb) in placed:
                    if _expanded(b, 3).overlaps(_expanded(pb, 3)):
                        ok = False
                        break
            if ok and _rect_hits_segment(b, diag_p0, diag_p1, pad=4.0):
                ok = False
            if ok:
                accepted = (t, b)
                break
            t.remove()
        if accepted is None:
            raise SystemExit(f'Figure 7: no collision-free label slot for {text!r}')
        placed.append((text, accepted[1]))
    fig.canvas.draw()


items = sorted(((stats[t]['vpip'], stats[t]['pfr'],
                 90 + stats[t]['aggressionFreq'] * 5.5, LABELS[t], COLORS[t])
                for t in TYPES), key=lambda it: -it[2])  # big markers first
place_labels_geometrically(fig, ax, items)
fig.canvas.draw()
marker_data = [(ax.transData.transform((stats[t]['vpip'], stats[t]['pfr']))[0],
                ax.transData.transform((stats[t]['vpip'], stats[t]['pfr']))[1],
                np.sqrt(90 + stats[t]['aggressionFreq'] * 5.5) / 2 * fig.dpi / 72 + 7)
               for t in TYPES]
diag_seg = (ax.transData.transform((0, 0)), ax.transData.transform((80, 80)))
verify_labels(fig, ax, 'Figure 7 (styles)', markers=marker_data,
              segments=[diag_seg])
fig.savefig(os.path.join(FIG, 'styles.png'), dpi=300)
plt.close(fig)
print('styles.png done')

# ---------------------------------------------- Figure 8: per-block consistency
fig, ax = plt.subplots(figsize=(8.0, 4.4), constrained_layout=True)
width = 0.15
xs = np.arange(5)
for i, t in enumerate(TYPES):
    per_block = [b['stats'][t]['mbbPerHand'] / 10 for b in blocks]  # -> bb/100
    ax.bar(xs + (i - 2) * width, per_block, width=width * 0.92, color=COLORS[t],
           edgecolor='#222', linewidth=0.5, label=LABELS[t])
ax.axhline(0, color='#444', linewidth=0.9)
allvals = [b['stats'][t]['mbbPerHand'] / 10 for b in blocks for t in TYPES]
ax.set_ylim(min(allvals) * 1.18, max(allvals) * 1.18)
ax.set_xticks(xs, [f'block {b}\nshadow: {blocks[b]["meta"]["shadowType"]}'
                   for b in range(5)], fontsize=9)
ax.set_ylabel('bb per 100 hands (per block)', fontsize=11)
ax.set_title('Per-block win rates (20,000 hands each; '
             'the shadow seat varies the field)', fontsize=12, pad=12)
ax.legend(frameon=False, fontsize=9, ncol=5, loc='upper center',
          bbox_to_anchor=(0.5, -0.20))
ax.grid(axis='y', alpha=0.25, linewidth=0.5)
ax.set_axisbelow(True)
ax.spines[['top', 'right']].set_visible(False)
verify_labels(fig, ax, 'Figure 8 (per_block)')
fig.savefig(os.path.join(FIG, 'per_block.png'), dpi=300)
plt.close(fig)
print('per_block.png done')
