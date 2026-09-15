/**
 * Train the CFR blueprint: external-sampling MCCFR self-play (6-max abstract game).
 * Output: public/ai/cfr-blueprint.json
 */
import { seededRng } from '../src/lib/poker/cards';
import { AbstractGame, standardTrainingConfig } from '../src/lib/poker/training/abstract-game';
import { createTables, mccfrWalk } from '../src/lib/poker/training/mccfr';

const TIME_BUDGET_MS = Number(process.argv[2] ?? 180_000);
const MAX_ITER = 2_000_000;
const SEED = 20260914;

const rng = seededRng(SEED);
const tables = createTables(6);
const start = Date.now();
let iter = 0;
let totalPayoff = 0;

while (Date.now() - start < TIME_BUDGET_MS && iter < MAX_ITER) {
  // Randomize the dealer button each iteration so every player experiences
  // every position class (EP/MP/LP/SB/BB) across training.
  const game = new AbstractGame(standardTrainingConfig(6, Math.floor(rng() * 6)), rng);
  game.start();
  const traverser = iter % 6;
  totalPayoff += mccfrWalk(game, traverser, tables, rng, 1);
  iter++;
  if (iter % 10_000 === 0) {
    const infosets = tables.strategySum.reduce((a, m) => a + m.size, 0);
    console.log(`iter ${iter} | ${((Date.now() - start) / 1000).toFixed(0)}s | infosets ${infosets} | avg payoff ${(totalPayoff / iter).toFixed(2)}`);
  }
}

const elapsed = (Date.now() - start) / 1000;

// Population-average strategy: sum strategy mass across all players per key,
// then normalize. Smoother than any single slot's table.
const pooledSums = new Map<string, Float64Array>();
for (let p = 0; p < 6; p++) {
  for (const [key, s] of tables.strategySum[p]) {
    let acc = pooledSums.get(key);
    if (!acc) {
      acc = new Float64Array(s.length);
      pooledSums.set(key, acc);
    }
    for (let i = 0; i < s.length; i++) acc[i] += s[i];
  }
}
const pooled: Record<string, number[]> = {};
for (const [key, s] of pooledSums) {
  let total = 0;
  for (let i = 0; i < s.length; i++) total += s[i];
  if (total < 1e-6) continue;
  pooled[key] = Array.from(s, (v) => Math.round((v / total) * 1000) / 1000);
}

const infosets = tables.strategySum.reduce((a, m) => a + m.size, 0);

const blueprint = {
  meta: {
    iterations: iter,
    seconds: Math.round(elapsed),
    infosets,
    trainedAt: new Date().toISOString(),
    abstraction: '6-max ES-MCCFR (CFR+ regrets); 20 preflop / 10 postflop buckets; actions {fold, call, half, pot}; raise cap 3/street; 100bb stacks; random button each hand',
  },
  pooled,
};

await Bun.write('public/ai/cfr-blueprint.json', JSON.stringify(blueprint));
const size = (await Bun.file('public/ai/cfr-blueprint.json').arrayBuffer()).byteLength / 1024;
console.log(`\nCFR blueprint: ${iter} iterations in ${elapsed.toFixed(0)}s, ${infosets} infosets (${pooledSums.size} pooled), file ${size.toFixed(0)} KB`);
const firstKeys = Object.keys(pooled).slice(0, 5);
console.log('sample pooled strategies:');
for (const k of firstKeys) console.log(' ', k, pooled[k]);
