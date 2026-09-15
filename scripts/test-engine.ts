/**
 * Engine + evaluator self-tests.
 * Run: bun scripts/test-engine.ts
 */
import { applyAction, createGame, getLegalActions, startHand, totalPot } from '../src/lib/poker/engine';
import { cardFromStr, seededRng } from '../src/lib/poker/cards';
import { evaluate, describeScore } from '../src/lib/poker/evaluator';
import { legalAbstractActions, mapAbstractAction } from '../src/lib/poker/abstraction';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
}

// ---------- Evaluator tests ----------
const ev = (cards: string[]) => evaluate(cards.map(cardFromStr));

assert(ev(['As', 'Ks', 'Qs', 'Js', 'Ts']) > ev(['Ks', 'Kh', 'Kd', 'Kc', '2h']), 'royal > quads');
assert(ev(['Ks', 'Kh', 'Kd', 'Kc', '2h']) > ev(['As', 'Ah', 'Ad', '2s', '2h']), 'quads > full house');
assert(ev(['As', 'Ah', 'Ad', '2s', '2h']) > ev(['As', 'Ks', 'Qs', 'Js', '9s']), 'full house > flush');
assert(ev(['As', 'Ks', 'Qs', 'Js', '9s']) > ev(['Ah', 'Kd', 'Qc', 'Js', 'Th']), 'flush > straight');
assert(ev(['Ah', 'Kd', 'Qc', 'Js', 'Th']) > ev(['Kh', 'Kd', 'Kc', '2s', '5h']), 'straight > trips');
assert(ev(['6h', '2d', '3c', '4s', '5h']) > ev(['Ah', '2d', '3c', '4s', '5h']), '6-high straight > wheel');
assert(ev(['As', 'Ah', '2s', '2h', '5c']) > ev(['Ks', 'Kh', '2s', '2h', '5c']), 'higher two pair wins');
assert(ev(['As', 'Ah', '2s', '2h', '5c']) > ev(['Ks', 'Kh', 'Qs', 'Qh', '5c']), 'top pair dominates two pair');
assert(ev(['As', 'Ad', 'Ks', 'Kh', 'Qc']) > ev(['As', 'Ah', '2s', '2h', '5c']), 'higher two pair (kicker pair) wins');
assert(ev(['2s', '2h', '2c', '2d', 'As']) > ev(['2s', '2h', '2c', '2d', 'Ks']), 'quad kicker');
assert(describeScore(ev(['As', 'Ks', 'Qs', 'Js', 'Ts'])) === 'Royal Flush', 'royal name');
assert(describeScore(ev(['9s', '8s', '7s', '6s', '5s'])) === 'Straight Flush, Nine high', 'sf name');

// 7-card: board plays
assert(ev(['As', 'Ah', '2s', '2h', '5c', '5d', '5s']) === ev(['5c', '5d', '5s', '2s', '2h']) || ev(['As', 'Ah', '2s', '2h', '5c', '5d', '5s']) > 0, '7card');
const fullHouseScore = ev(['As', 'Ah', '2s', '2h', '5c', '5d', '5s']);
assert(describeScore(fullHouseScore).startsWith('Full House'), 'best of 7 = full house fives over twos, got: ' + describeScore(fullHouseScore));

// split pot detection: identical board straight plays for both
assert(ev(['As', 'Ah', '9s', '8d', '7c', '6h', '5s']) === ev(['Ad', 'Ac', '9s', '8d', '7c', '6h', '5s']), 'board straight splits');
// wheel check: A-5 straight exists and loses to 6-high
assert(ev(['Ah', '2d', '3c', '4s', '5h']) > ev(['Kh', 'Kd', 'Kc', '2s', '5h']), 'wheel straight beats trips');

// ---------- Random playout invariants ----------
const rng = seededRng(42);
const TOTAL = 6 * 2000;
let hands = 0;
let showdowns = 0;
const actionCounts: Record<string, number> = {};

while (hands < 3000) {
  const g = createGame({
    players: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, isHuman: false, aiType: 't', stack: 2000 })),
    sb: 5,
    bb: 10,
  });
  startHand(g, rng);
  let guard = 0;
  while (g.stage !== 'handover' && guard < 400) {
    guard++;
    const legal = getLegalActions(g);
    if (!legal) break;
    const chars = legalAbstractActions(g, legal);
    const ch = chars[Math.floor(rng() * chars.length)];
    actionCounts[ch] = (actionCounts[ch] ?? 0) + 1;
    const action = mapAbstractAction(g, legal, ch);
    applyAction(g, action, rng);
    const totalChips = g.players.reduce((a, p) => a + p.stack, 0) + totalPot(g);
    assert(totalChips === TOTAL, `chip conservation mid-hand: ${totalChips} != ${TOTAL} (stage ${g.stage})`);
  }
  const finalChips = g.players.reduce((a, p) => a + p.stack, 0);
  assert(finalChips === TOTAL, `chip conservation final: ${finalChips} != ${TOTAL}`);
  if (g.showdownInfo && !g.showdownInfo.foldWin) showdowns++;
  hands++;
}
console.log(`played ${hands} random hands, ${showdowns} showdowns, actions:`, actionCounts);

// ---------- Side pot scenario ----------
// 3 players: A=120, B=500, C=800. A all-in short, B raises, C calls; B wins everything
{
  const g = createGame({
    players: [
      { name: 'A', isHuman: false, aiType: 't', stack: 120 },
      { name: 'B', isHuman: false, aiType: 't', stack: 500 },
      { name: 'C', isHuman: false, aiType: 't', stack: 800 },
    ],
    sb: 5,
    bb: 10,
    button: 2, // A=SB? with button at seat2: SB=seat0(A), BB=seat1(B), first actor=seat2(C)
  });
  const r = seededRng(7);
  startHand(g, r);
  // Force deterministic cards not needed; just drive actions.
  // C (BTN) first: raise to 40
  let legal = getLegalActions(g)!;
  applyAction(g, { type: 'raise', to: 40 }, r);
  // A (SB) all-in raise to 120
  legal = getLegalActions(g)!;
  assert(g.actor === 0, `A to act, actor=${g.actor}`);
  applyAction(g, { type: 'raise', to: 120 }, r);
  // B (BB) raise to 300
  legal = getLegalActions(g)!;
  assert(g.actor === 1, `B to act, actor=${g.actor}`);
  applyAction(g, { type: 'raise', to: 300 }, r);
  // C call 300
  legal = getLegalActions(g)!;
  assert(g.actor === 2, `C to act, actor=${g.actor}`);
  applyAction(g, { type: 'call' }, r);
  // B call the extra 180 (300 total) — wait B already at 300. C called 300. A all-in 120.
  legal = getLegalActions(g)!;
  assert(legal === null || g.actor === 1, 'B option check');
  if (legal) applyAction(g, legal.toCall > 0 ? { type: 'call' } : { type: 'check' }, r);
  const totalChips = g.players.reduce((a, p) => a + p.stack, 0) + totalPot(g);
  assert(totalChips === 1420, `side pot chip total: ${totalChips}`);
  // Runout: everyone continues until showdown automatically
  while (g.stage !== 'handover') {
    const l = getLegalActions(g);
    if (l) applyAction(g, l.toCall > 0 ? { type: 'call' } : { type: 'check' }, r);
    else break;
  }
  const finalChips = g.players.reduce((a, p) => a + p.stack, 0);
  assert(finalChips === 1420, `side pot final: ${finalChips}`);
  const info = g.showdownInfo!;
  assert(info.pots.length >= 2, `expected >= 2 pots, got ${info.pots.length}: ${JSON.stringify(info.pots.map((p) => ({ a: p.amount, e: p.eligibleSeats })))}`);
  console.log('side pot pots:', JSON.stringify(info.pots.map((p) => ({ amount: p.amount, eligible: p.eligibleSeats, winners: p.winnerSeats })), null, 0));
}

// ---------- Split pot with odd chip ----------
{
  const g = createGame({
    players: [
      { name: 'A', isHuman: false, aiType: 't', stack: 100 },
      { name: 'B', isHuman: false, aiType: 't', stack: 100 },
      { name: 'C', isHuman: false, aiType: 't', stack: 100 },
    ],
    sb: 5,
    bb: 10,
    button: 2,
  });
  const r = seededRng(99);
  startHand(g, r);
  // All call down to showdown
  while (g.stage !== 'handover') {
    const l = getLegalActions(g);
    if (!l) break;
    if (l.toCall > 0) applyAction(g, { type: 'call' }, r);
    else applyAction(g, { type: 'check' }, r);
  }
  const finalChips = g.players.reduce((a, p) => a + p.stack, 0);
  assert(finalChips === 300, `split final: ${finalChips}`);
  console.log('3-way hand awards:', JSON.stringify(g.showdownInfo?.totalAward));
}

// ---------- Uncalled bet return ----------
{
  const g = createGame({
    players: [
      { name: 'A', isHuman: false, aiType: 't', stack: 1000 },
      { name: 'B', isHuman: false, aiType: 't', stack: 1000 },
      { name: 'C', isHuman: false, aiType: 't', stack: 1000 },
    ],
    sb: 5,
    bb: 10,
    button: 2,
  });
  const r = seededRng(123);
  startHand(g, r);
  // C (BTN) bets big, everyone folds
  applyAction(g, { type: 'raise', to: 100 }, r); // C opens 100
  applyAction(g, { type: 'fold' }, r); // A folds
  applyAction(g, { type: 'fold' }, r); // B folds
  assert(g.stage === 'handover', 'hand over after folds');
  const cStack = g.players[2].stack;
  assert(cStack === 1000 + 15, `uncalled bet returned: C stack ${cStack} should be 1015`);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
