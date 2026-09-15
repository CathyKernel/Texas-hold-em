/** DEFINITIVE fairness test: identical agents + stack reset + CORRECT statistics. */
import { createGame, startHand, applyAction, getLegalActions, cloneState } from '../src/lib/poker/engine';
import { mapAbstractAction, type AbstractChar } from '../src/lib/poker/abstraction';
import { seededRng } from '../src/lib/poker/cards';
import type { Action } from '../src/lib/poker/engine';

const POLICY = (process.argv[2] ?? 'h') as AbstractChar;
const N = Number(process.argv[3] ?? 3000);
const SEEDS = [1, 7, 42, 424242, 999, 31337, 20260914, 555, 123456789, 8080];

let worstSeatZ = 0;
let worstPosZ = 0;
let chi2Total = 0;

for (const seed of SEEDS) {
  const rng = seededRng(seed);
  const game = createGame({
    players: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, isHuman: false, aiType: 'fixed', stack: 1000 })),
    sb: 5,
    bb: 10,
  });
  const netBySeat = new Array(6).fill(0);
  const netByPos = new Array(6).fill(0);
  const sq = new Array(6).fill(0); // per-seat sum of squared deltas (for variance)

  for (let h = 0; h < N; h++) {
    for (const p of game.players) { p.stack = 1000; p.status = 'in'; }
    const startEvents = startHand(game, rng);
    const blindPaid = new Array(6).fill(0);
    for (const e of startEvents) if (e.t === 'blind') blindPaid[e.seat] = e.amount;
    const stacksAtStart = game.players.map((p, s) => p.stack + blindPaid[s]);
    const button = game.button;
    let safety = 0;
    while (game.stage !== 'handover' && game.actor !== null && safety < 200) {
      safety++;
      const seat = game.actor!;
      const legal = getLegalActions(game);
      if (!legal) break;
      const state = cloneState(game);
      const action: Action = mapAbstractAction(state, legal, POLICY);
      applyAction(game, action, rng);
    }
    game.players.forEach((p, s) => {
      const d = p.stack - stacksAtStart[s];
      netBySeat[s] += d;
      netByPos[(s - button + 6) % 6] += d;
      sq[s] += d * d;
    });
  }
  // Seat z-scores using EMPIRICAL variance
  for (let s = 0; s < 6; s++) {
    const varPer = sq[s] / N - (netBySeat[s] / N) ** 2;
    const se = Math.sqrt(Math.max(1e-9, varPer) / N);
    const z = Math.abs(netBySeat[s] / N) / se;
    if (z > worstSeatZ) worstSeatZ = z;
  }
  // Position z-scores (CORRECT divisor: N, since every position is occupied every hand)
  for (let p = 0; p < 6; p++) {
    const mean = netByPos[p] / N;
    // pooled per-hand std across seats ~ same variance
    const varPer = (sq.reduce((a, b) => a + b, 0) / (6 * N)) - 0; // rough pooled variance
    const se = Math.sqrt(Math.max(1e-9, varPer) / N);
    const z = Math.abs(mean) / se;
    if (z > worstPosZ) worstPosZ = z;
    chi2Total += (mean / se) ** 2;
  }
}
console.log(`policy=${POLICY} N=${N} x ${SEEDS.length} seeds (stacks reset every hand)`);
console.log(`worst |z| by seat: ${worstSeatZ.toFixed(2)}`);
console.log(`worst |z| by pos : ${worstPosZ.toFixed(2)}`);
console.log(`avg chi2 (pos, 6 dof incl. cross-corr) : ${(chi2Total / (SEEDS.length * 6)).toFixed(2)}`);
console.log('Fair if worst |z| < ~3 (multiple-testing tolerance)');
