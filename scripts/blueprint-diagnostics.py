#!/usr/bin/env python3
"""Diagnostics on the trained CFR blueprint: convergence quality of pooled rows."""
import json
import math

bp = json.load(open('/home/z/my-project/public/ai/cfr-blueprint.json'))
pooled = bp['pooled']
meta = bp['meta']
print(f"iterations: {meta['iterations']:,}  seconds: {meta['seconds']}  infosets: {meta['infosets']:,}  pooled keys: {len(pooled):,}")

def entropy(p):
    p = [x for x in p if x > 0]
    tot = sum(p)
    if tot <= 0:
        return 0.0
    p = [x / tot for x in p]
    return -sum(x * math.log(x) for x in p)

rows = list(pooled.values())
lens = {}
for r in rows:
    lens[len(r)] = lens.get(len(r), 0) + 1
print('row length histogram:', lens)

near_uniform = 0
decisive = 0
max_probs = []
for r in rows:
    mx = max(r)
    max_probs.append(mx)
    if mx < 0.40:
        near_uniform += 1
    if mx > 0.70:
        decisive += 1
print(f'rows with max prob < 0.40 (near-uniform, under-converged): {near_uniform} ({near_uniform/len(rows)*100:.1f}%)')
print(f'rows with max prob > 0.70 (decisive):                       {decisive} ({decisive/len(rows)*100:.1f}%)')

# by street
from collections import defaultdict
street_stats = defaultdict(lambda: [0, 0.0])
for k, r in pooled.items():
    street = k.split('|')[1]
    street_stats[street][0] += 1
    street_stats[street][1] += max(r)
for s, (n, mx_sum) in sorted(street_stats.items()):
    print(f'{s:>8}: {n:>6} rows, mean max-prob {mx_sum/n:.3f}')

# aggression mass: average probability on aggressive actions (h, p) across rows
aggr_mass = 0.0
tot_mass = 0.0
for r in rows:
    aggr_mass += r[2] + r[3]
    tot_mass += sum(r)
print(f'mean probability mass on aggressive actions (h+p): {aggr_mass/tot_mass*100:.1f}%')
print(f'mean probability mass on fold: {sum(r[0] for r in rows)/tot_mass*100:.1f}%')
print(f'mean probability mass on check/call: {sum(r[1] for r in rows)/tot_mass*100:.1f}%')
