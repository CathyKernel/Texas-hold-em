/** Per-hand assertion: awards match stack deltas exactly. */
import { createGame, startHand, applyAction, getLegalActions, cloneState } from '../src/lib/poker/engine';
import { mapAbstractAction, type AbstractChar } from '../src/lib/poker/abstraction';
import { seededRng } from '../src/lib/poker/cards';
import type { Action } from '../src/lib/poker/engine';

const POLICY = (process.argv[2] ?? 'h') as AbstractChar;
const N = Number(process.argv[3] ?? 500);
const rng = seededRng(424242);
const game = createGame({
  players: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, isHuman: false, aiType: 'fixed', stack: 1000 })),
  sb: 5,
  bb: 10,
});

let violations = 0;
for (let h = 0; h < N; h++) {
  for (const p of game.players) { p.stack = 1000; p.status = 'in'; }
  const startEvents = startHand(game, rng);
  const blindPaid = new Array(6).fill(0);
  for (const e of startEvents) if (e.t === 'blind') blindPaid[e.seat] = e.amount;
  const stacksAtStart = game.players.map((p, s) => p.stack + blindPaid[s]);

  let safety = 0;
  const trace: string[] = [];
  while (game.stage !== 'handover' && game.actor !== null && safety < 200) {
    safety++;
    const seat = game.actor!;
    const legal = getLegalActions(game);
    if (!legal) break;
    const state = cloneState(game);
    const action: Action = mapAbstractAction(state, legal, POLICY);
    trace.push(`${seat}:${action.type === 'raise' ? `r${action.to}` : action.type}`);
    applyAction(game, action, rng);
  }

  const deltas = game.players.map((p, s) => p.stack - stacksAtStart[s]);
  const commits = game.players.map((p) => p.committed);
  // Expected deltas from showdown info
  if (!game.showdownInfo) continue;
  if (game.showdownInfo.foldWin) {
    // winner takes pot + bets: delta = total - own commit
    const w = game.showdownInfo.pots[0].winnerSeats[0];
    const total = game.showdownInfo.pots[0].amount;
    const expW = total - commits[w];
    if (deltas[w] !== expW) { violations++; console.log(`H${h} FOLDWIN mismatch seat${w}: delta=${deltas[w]} expected=${expW} :: ${trace.join(' ')}`); }
    continue;
  }
  const awardBySeat = new Array(6).fill(0);
  for (const pr of game.showdownInfo.pots) {
    // recompute split like engine
    const winners = pr.winnerSeats;
    const share = Math.floor(pr.amount / winners.length);
    let odd = pr.amount - share * winners.length;
    for (const w of winners) awardBySeat[w] += share;
    // odd chips: first odd count seats in distFromButton order get +1
    const ordered = winners.slice().sort((a, b) => ((a - game.button + 6) % 6) - ((b - game.button + 6) % 6));
    for (let i = 0; i < odd; i++) awardBySeat[ordered[i % ordered.length]] += 1;
  }
  const exp = awardBySeat.map((a, s) => a - commits[s]);
  const bad = exp.some((e, s) => e !== deltas[s]);
  if (bad) {
    violations++;
    console.log(`H${h} mismatch: deltas=[${deltas}] expected=[${exp}] commits=[${commits}] button=${game.button} :: ${trace.join(' ')}`);
    for (const pr of game.showdownInfo.pots) console.log(`   pot ${pr.amount} winners=[${pr.winnerSeats}] elig=[${pr.eligibleSeats}]`);
  }
}
console.log(`hands=${N} violations=${violations}`);
