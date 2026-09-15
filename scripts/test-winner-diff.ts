/** Compare engine showdown winners vs independently evaluated best hands. */
import { createGame, startHand, applyAction, getLegalActions, cloneState } from '../src/lib/poker/engine';
import { mapAbstractAction, type AbstractChar } from '../src/lib/poker/abstraction';
import { seededRng, cardStr } from '../src/lib/poker/cards';
import { evaluate, describeScore } from '../src/lib/poker/evaluator';
import type { Action } from '../src/lib/poker/engine';

const POLICY = (process.argv[2] ?? 'c') as AbstractChar;
const N = Number(process.argv[3] ?? 300);
const rng = seededRng(424242);
const game = createGame({
  players: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, isHuman: false, aiType: 'fixed', stack: 1000 })),
  sb: 5,
  bb: 10,
});

let wrongWinners = 0;
for (let h = 0; h < N; h++) {
  for (const p of game.players) { p.stack = 1000; p.status = 'in'; }
  startHand(game, rng);
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
  const si = game.showdownInfo;
  if (!si || si.foldWin) continue;

  // Independent evaluation
  const live = game.players.filter((p) => p.status === 'in' || p.status === 'allin');
  const myScores = new Map<number, number>();
  for (const p of live) myScores.set(p.seat, evaluate([...p.hole, ...game.board]));
  const best = Math.max(...myScores.values());
  const myWinners = [...myScores.entries()].filter(([, v]) => v === best).map(([s]) => s).sort();

  const engineWinners = [...new Set(si.pots.flatMap((p) => p.winnerSeats))].sort();
  if (JSON.stringify(engineWinners) !== JSON.stringify(myWinners)) {
    wrongWinners++;
    if (wrongWinners <= 5) {
      console.log(`H${h} button=${game.button}: engine=[${engineWinners}] mine=[${myWinners}]`);
      for (const p of live) console.log(`  seat ${p.seat}: ${p.hole.map(cardStr).join(' ')} -> ${describeScore(myScores.get(p.seat)!)}`);
      console.log(`  board: ${game.board.map(cardStr).join(' ')}`);
    }
  }
}
console.log(`hands=${N} wrong-winners=${wrongWinners}`);
