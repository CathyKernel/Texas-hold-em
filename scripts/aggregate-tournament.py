#!/usr/bin/env python3
"""Aggregate the 5 tournament blocks into pooled per-paradigm statistics.

Recovery of raw sums from per-block derived stats:
  net = netChips (exact)
  var_i (per-hand chip variance) = (mbbPerHandSE_i * BB / 1000)^2 * hands_i
  netSq = sum_i hands_i * (var_i + mean_i^2)
  counts (vpip etc.) = pct_i/100 * hands_i
"""
import json
import math

TYPES = ['rule', 'montecarlo', 'cfr', 'deepcfr', 'rl']
BB = 10

blocks = [json.load(open(f'/home/z/my-project/scripts/tournament-results-block-{b}.json')) for b in range(5)]

pooled = {}
for t in TYPES:
    hands = sum(b['stats'][t]['hands'] for b in blocks)
    net = sum(b['stats'][t]['netChips'] for b in blocks)
    netSq = 0.0
    for b in blocks:
        s = b['stats'][t]
        n_i = s['hands']
        mean_i = s['netChips'] / n_i
        var_i = (s['mbbPerHandSE'] * BB / 1000.0) ** 2 * n_i
        netSq += n_i * (var_i + mean_i * mean_i)
    mean = net / hands
    var = max(0.0, netSq / hands - mean * mean)
    se = math.sqrt(var / hands)
    vpip = sum(b['stats'][t]['vpip'] / 100 * b['stats'][t]['hands'] for b in blocks)
    pfr = sum(b['stats'][t]['pfr'] / 100 * b['stats'][t]['hands'] for b in blocks)
    aggr = sum(b['stats'][t]['aggressionFreq'] / 100 * b['stats'][t]['hands'] for b in blocks)  # weighted by hands (proxy for decisions)
    sd = sum(b['stats'][t]['showdownFreq'] / 100 * b['stats'][t]['hands'] for b in blocks)
    sdw = 0.0
    sd_count = 0.0
    for b in blocks:
        s = b['stats'][t]
        c = s['showdownFreq'] / 100 * s['hands']
        sd_count += c
        sdw += s['showdownWinPct'] / 100 * c
    pooled[t] = {
        'hands': hands,
        'netChips': net,
        'bbPerHand': mean / BB,
        'bbPer100': mean / BB * 100,
        'se_bbPerHand': se / BB,
        'z': mean / se if se > 0 else 0.0,
        'vpip': vpip / hands * 100,
        'pfr': pfr / hands * 100,
        'aggressionFreq': aggr / hands * 100,
        'showdownFreq': sd / hands * 100,
        'showdownWinPct': sdw / sd_count * 100 if sd_count else 0.0,
        'perHandStd_bb': math.sqrt(var) / BB,
    }

meta = {
    'totalHands': sum(b['meta']['hands'] for b in blocks),
    'conservationErrors': sum(b['meta']['conservationErrors'] for b in blocks),
    'illegalActions': sum(b['meta']['illegalActions'] for b in blocks),
    'showdownHands': sum(b['meta']['showdownHands'] for b in blocks),
    'elapsedSeconds': sum(b['meta']['elapsedSeconds'] for b in blocks),
}

out = {'meta': meta, 'stats': pooled}
with open('/home/z/my-project/scripts/tournament-aggregate.json', 'w') as f:
    json.dump(out, f, indent=1)

print(f"total hands: {meta['totalHands']}, conservation errors: {meta['conservationErrors']}, illegal actions: {meta['illegalActions']}")
print(f"showdowns: {meta['showdownHands']} ({meta['showdownHands']/meta['totalHands']*100:.1f}% of hands)")
print()
hdr = f"{'type':<12}{'bb/100':>10}{'SE':>8}{'z':>7}{'VPIP%':>8}{'PFR%':>8}{'AGGR%':>8}{'SD%':>7}{'SDW%':>7}{'std/hand':>10}"
print(hdr)
print('-' * len(hdr))
for t in TYPES:
    s = pooled[t]
    print(f"{t:<12}{s['bbPer100']:>10.1f}{s['se_bbPerHand']*100:>8.2f}{s['z']:>7.1f}{s['vpip']:>8.1f}{s['pfr']:>8.1f}{s['aggressionFreq']:>8.1f}{s['showdownFreq']:>7.1f}{s['showdownWinPct']:>7.1f}{s['perHandStd_bb']:>10.1f}")

# pairwise significance vs zero and vs each other
print('\npairwise z (row vs column difference):')
names = TYPES
print(f"{'':<12}" + ''.join(f"{n:>12}" for n in names))
for a in names:
    row = []
    for b in names:
        if a == b:
            row.append('      ---')
            continue
        va = (pooled[a]['se_bbPerHand'] ** 2) * pooled[a]['hands']
        vb = (pooled[b]['se_bbPerHand'] ** 2) * pooled[b]['hands']
        diff = pooled[a]['bbPerHand'] - pooled[b]['bbPerHand']
        se_d = math.sqrt(va / pooled[a]['hands'] + vb / pooled[b]['hands'])
        row.append(f"{diff/se_d:>11.1f}" if se_d > 0 else '         ?')
    print(f"{a:<12}" + ''.join(f"{r:>12}" for r in row))
