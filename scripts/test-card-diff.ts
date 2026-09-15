/** Card-by-card diff: engine-dealt cards vs independent replication (same rng stream). */
import { createGame, startHand, applyAction, getLegalActions, cloneState } from '../src/lib/poker/engine';
import { mapAbstractAction, type AbstractChar } from '../src/lib/poker/abstraction';
import { makeDeck, shuffle, seededRng } from '../src/lib/poker/cards';
import { evaluate } from '../src/lib/poker/evaluator';
import type { Action } from '../src/lib/poker/engine';

const POLICY = 'c' as AbstractChar;
const N = Number(process.argv[2] ?? 50);
const SEED = 424242;

// Two independent streams from the same seed
const rngA = seededRng(SEED); // engine
const rngB = seededRng(SEED); // replication
const game = createGame({
  players: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, isHuman: false, aiType: 'fixed', stack: 1000 })),
  sb: 5,
  bb: 10,
});

let mismatches = 0;
for (let h = 0; h < N; h++) {
  for (const p of game.players) { p.stack = 1000; p.status = 'in'; }
  startHand(game, rngA);

  // play the hand with policy c
  let safety = 0;
  while (game.stage !== 'handover' && game.actor !== null && safety < 200) {
    safety++;
    const seat = game.actor!;
    const legal = getLegalActions(game);
    if (!legal) break;
    const state = cloneState(game);
    const action: Action = mapAbstractAction(state, legal, POLICY);
    applyAction(game, action, rngA);
  }

  // Independent replication of THIS hand's deal
  const deck = shuffle(makeDeck(), rngB);
  const holes: number[][] = [];
  let seat = (game.button + 1) % 6; // engine button for this hand
  for (let i = 0; i < 6; i++) {
    holes[seat] = [deck.pop()!, deck.pop()!];
    seat = (seat + 1) % 6;
  }
  deck.pop();
  const board = [deck.pop()!, deck.pop()!, deck.pop()!];
  deck.pop(); board.push(deck.pop()!);
  deck.pop(); board.push(deck.pop()!);

  // Compare
  const engineBoard = game.board.slice().sort((a, b) => a - b);
  const repBoard = board.slice().sort((a, b) => a - b);
  let handMismatch = false;
  for (let s = 0; s < 6; s++) {
    const eh = game.players[s].hole.slice().sort((a, b) => a - b);
    const rh = holes[s].slice().sort((a, b) => a - b);
    if (eh[0] !== rh[0] || eh[1] !== rh[1]) {
      handMismatch = true;
      if (mismatches < 5) console.log(`H${h} seat${s}: engine=[${eh}] repl=[${rh}]`);
    }
  }
  if (engineBoard.length === 5) {
    for (let i = 0; i < 5; i++) if (engineBoard[i] !== repBoard[i]) {
      handMismatch = true;
      if (mismatches < 5) console.log(`H${h} board[${i}]: engine=${engineBoard[i]} repl=${repBoard[i]}`);
    }
  }
  if (handMismatch) mismatches++;
}
console.log(`hands=${N} hands-with-card-mismatch=${mismatches}`);
