# Scripts

Training, tournament, and verification utilities for the poker AI project.
All TypeScript scripts run with [Bun](https://bun.sh) (`bun run scripts/<name>.ts`)
or any tsx-compatible runner. Python scripts need Python 3 (figures additionally
require `matplotlib` and `numpy`).

## Training

| Script | Purpose | Output |
|---|---|---|
| `train-cfr.ts [budgetMs]` | External-sampling MCCFR blueprint self-play (6-max abstract game) | `public/ai/cfr-blueprint.json` |
| `train-deepcfr.ts [walkMs] [trainMs]` | Reservoir-sample (features, advantage) pairs via MCCFR traversals, then fit a small MLP | `public/ai/deepcfr-model.json` |
| `train-rl.ts [budgetMs]` | Tabular Q-learning self-play vs a mixed opponent pool | `public/ai/rl-policy.json` |
| `gen-preflop.ts` | Monte-Carlo the 169 canonical starting hands vs a random opponent, bucket into 20 percentiles | `src/lib/poker/preflop-table.generated.ts` |

## Tournament & analysis

| Script | Purpose |
|---|---|
| `tournament.ts [block] [nHands] [outPath]` | One tournament block: 5 paradigms + rotating shadow seat, per-hand stack reset, button-relative rotation, blind-corrected accounting |
| `aggregate-tournament.py` | Aggregate block JSONs into `tournament-aggregate.json` with z-scores |
| `blueprint-diagnostics.py` | Blueprint quality: near-uniform rows, per-street max-prob stats |
| `gen-experiment-figures.py` | Paper §8 figures (win rates, styles, per-block) |
| `gen-paper-figures.py` | Paper §3/§4 figures (hand ranks, preflop equity, MC precision) |

`tournament-results-block-*.json` and `tournament-aggregate.json` are the
committed results of the 100,000-hand run reported in the paper (§8).

## Verification

| Script | Purpose |
|---|---|
| `kuhn-cfr.ts` | CFR on Kuhn poker: converges to the exact value −1/18; verifies the 1:3 bluff:value equilibrium family by exhaustive best-response |
| `test-engine.ts` | Engine + evaluator self-tests (betting legality, pots, showdown) |
| `test-assert-awards.ts` | Chip conservation asserted on every hand |
| `test-card-diff.ts` | Deal distribution vs an independent replication (0 mismatches) |
| `test-winner-diff.ts` | Winner determination vs brute force |
| `test-fairness-final.ts` | Seat/position fairness across seeds (identical agents) |
