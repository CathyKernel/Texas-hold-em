#!/usr/bin/env python3
"""Paper figures -- complete redesign (v2).

Design principles applied to every figure:
  * every text label lives in a reserved empty lane or zone, so overlaps
    are impossible by construction rather than by hand-tuning;
  * horizontal bar layouts give each label its own row;
  * axis limits are auto-extended (measure-then-extend) until every label
    fits inside the axes box with generous margin;
  * a strict renderer-level QA gate re-checks text/text, text/frame,
    text/bar, text/segment and text/marker collisions and fails the build.
"""
import json
import math
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
os.makedirs(FIG, exist_ok=True)

GREEN = '#2e5d4e'
DARKGREEN = '#16302a'
GOLD = '#B8860B'


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


def extend_xlim_for_texts(fig, ax, texts, log_x=False, pad_frac=0.06):
    """Measure-then-extend: widen xlim until every label clears the frame."""
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
    if log_x:
        want_hi = 10 ** (math.log10(hi) + pad_frac)
        want_lo = 10 ** (math.log10(lo) - pad_frac)
    else:
        span = cur[1] - cur[0]
        want_hi, want_lo = hi + pad_frac * span, lo - pad_frac * span
    ax.set_xlim(min(cur[0], want_lo), max(cur[1], want_hi))
    fig.canvas.draw()


# ---------------------------------------------------------------- Figure 3: preflop equity heatmap
data = json.load(open(os.path.join(FIG, 'preflop_data.json')))
eq, labels = data['equity'], data['labels']
RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

grid = np.full((13, 13), np.nan)
for lab, e in zip(labels, eq):
    hi, lo, suited = lab[0], lab[1], lab[-1] == 's'
    r_hi, r_lo = RANKS.index(hi), RANKS.index(lo)
    if suited:
        grid[r_hi, r_lo] = e
    else:
        grid[r_lo, r_hi] = e
for i, lab in enumerate(labels):
    if lab[0] == lab[1]:
        grid[RANKS.index(lab[0]), RANKS.index(lab[0])] = eq[i]

fig, ax = plt.subplots(figsize=(7.4, 6.2), constrained_layout=True)
im = ax.imshow(grid, cmap='RdYlGn', vmin=0.30, vmax=0.90, origin='upper')
ax.set_xticks(range(13), RANKS, fontsize=10)
ax.set_yticks(range(13), RANKS, fontsize=10)
ax.set_xlabel('Lower rank of the starting hand', fontsize=11)
ax.set_ylabel('Higher rank of the starting hand', fontsize=11)
for i in range(13):
    for j in range(13):
        if not math.isnan(grid[i, j]):
            v = grid[i, j]
            color = '#111' if 0.42 < v < 0.72 else '#fff'
            ax.text(j, i, f'{v:.2f}', ha='center', va='center',
                    fontsize=7.5, color=color)
ax.set_xticks(np.arange(-0.5, 13, 1), minor=True)
ax.set_yticks(np.arange(-0.5, 13, 1), minor=True)
ax.grid(which='minor', color='white', linewidth=0.6)
ax.tick_params(which='minor', length=0)
cb = fig.colorbar(im, ax=ax, shrink=0.86)
cb.set_label('Heads-up preflop equity vs. a uniform random hand')
verify_labels(fig, ax, 'Figure 3 (preflop_equity)')
fig.savefig(os.path.join(FIG, 'preflop_equity.png'), dpi=300)
plt.close(fig)
print('preflop_equity.png done')

# ------------------------------------------------- Figure 2: hand-category frequencies
# HORIZONTAL log-scale bars: every category owns a full row, so labels can
# never collide with each other; percent labels sit beyond the bar end in
# reserved open space (exact counts live in Table 1 right above the figure).
cats7 = [
    ('One Pair', 58_627_800),
    ('Two Pair', 31_433_400),
    ('High Card', 23_294_460),
    ('Three of a Kind', 6_461_620),
    ('Straight', 6_180_020),
    ('Flush', 4_047_644),
    ('Full House', 3_473_184),
    ('Four of a Kind', 224_848),
    ('Straight Flush', 41_584),
]
total7 = 133_784_560
probs = [c / total7 * 100 for _, c in cats7]

fig, ax = plt.subplots(figsize=(7.8, 4.7), constrained_layout=True)
ypos = np.arange(len(cats7))
XMIN = 1e-4
bars = ax.barh(ypos, [p - XMIN for p in probs], left=XMIN, height=0.62,
               color=GREEN, edgecolor=DARKGREEN, linewidth=0.6)
ax.set_xscale('log')
ax.set_xlim(XMIN, 300)
ax.set_ylim(len(cats7) - 0.45, -0.55)  # first row (modal category) on top
ax.set_yticks(ypos, [name for name, _ in cats7], fontsize=10.5)
ax.set_xticks([1e-4, 1e-3, 1e-2, 1e-1, 1, 10, 100])
ax.set_xticklabels(['0.0001%', '0.001%', '0.01%', '0.1%', '1%', '10%', '100%'],
                   fontsize=9.5)
ax.set_xlabel('Probability (% of all seven-card hands, log scale)', fontsize=11)
pct_labels = []
for y, p in zip(ypos, probs):
    t = ax.text(p * 1.9, y, f'{p:.3g}%', ha='left', va='center',
                fontsize=10.5, fontweight='bold', color=DARKGREEN)
    pct_labels.append(t)
ax.spines[['top', 'right']].set_visible(False)
ax.set_title('Hand-category frequencies among all seven-card combinations',
             fontsize=12, pad=12)
extend_xlim_for_texts(fig, ax, pct_labels, log_x=True)
verify_labels(fig, ax, 'Figure 2 (hand_ranks)', bars=bars)
fig.savefig(os.path.join(FIG, 'hand_ranks.png'), dpi=300)
plt.close(fig)
print('hand_ranks.png done')

# ------------------------------------------------- Figure 4: Monte Carlo precision
# Curves plus two budget markers; the markers carry only short bottom labels
# in the guaranteed-empty band along the x-axis (all curves sit far above
# there), and the exact SE values moved into the figure caption.
ns = np.logspace(0.5, 5, 400)
fig, ax = plt.subplots(figsize=(7.0, 4.3), constrained_layout=True)
ses = []
for p, ls in [(0.5, '-'), (0.25, '--'), (0.10, ':')]:
    se = np.sqrt(p * (1 - p) / ns)
    ses.append(se)
    ax.loglog(ns, se, ls, color=GOLD if p == 0.5 else '#555', linewidth=1.7,
              label=f'$e={p}$' if p != 0.5 else f'$e={p}$ (max)')
ax.set_xlabel('Number of simulated runouts $n$')
ax.set_ylabel('Standard error $\\sqrt{e(1-e)/n}$')
ax.grid(True, which='both', alpha=0.25, linewidth=0.5)
ax.set_axisbelow(True)
ax.legend(frameon=False, fontsize=10, loc='upper right')
ax.set_ylim(2e-4, 0.8)
budget_ns = [300, 1500]
for n, tag, side in [(300, 'batch', 'left'), (1500, 'interactive', 'right')]:
    ax.axvline(n, color=GREEN, linewidth=0.9, alpha=0.55)
    # log-axis clearance: a factor of 1.6 is ~0.2 decades (~20 px), far more
    # than the ~2 px a factor of 1.14 gives on a compressed axes
    if side == 'left':
        ax.text(n / 1.6, 2.6e-4, f'{tag}: $n = {n}$', fontsize=8.5,
                color=DARKGREEN, ha='right', va='bottom',
                bbox=dict(facecolor='white', edgecolor='none', pad=1.4))
    else:
        ax.text(n * 1.6, 2.6e-4, f'{tag}: $n = {n}$', fontsize=8.5,
                color=DARKGREEN, ha='left', va='bottom',
                bbox=dict(facecolor='white', edgecolor='none', pad=1.4))
ax.set_title('Monte Carlo equity precision decays as $1/\\sqrt{n}$',
             fontsize=12, pad=12)
# All display-space geometry is captured only AFTER the final layout has
# settled (constrained_layout may still move the axes until this draw).
fig.canvas.draw()
curve_clouds = [list(ax.transData.transform((n, s)) for n, s in zip(ns, se))
                for se in ses]
budget_segments = [(ax.transData.transform((n, 2e-4)),
                    ax.transData.transform((n, 0.8))) for n in budget_ns]
verify_labels(fig, ax, 'Figure 4 (mc_precision)',
              segments=budget_segments, point_clouds=curve_clouds)
fig.savefig(os.path.join(FIG, 'mc_precision.png'), dpi=300)
plt.close(fig)
print('mc_precision.png done')
