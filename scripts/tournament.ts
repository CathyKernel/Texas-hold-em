/**
 * 6-max AI tournament for the paper's experimental section.
 *
 * Design:
 *  - Five agent paradigms (rule / montecarlo / cfr / deepcfr / rl) share one table
 *    with a 6th "shadow" seat that duplicates one paradigm (block k).
 *  - Seat assignment rotates by BUTTON-RELATIVE distance so every paradigm
 *    occupies every position (BTN/SB/BB/UTG/MP/CO) uniformly across hands.
 *  - Stacks are RESET to 1000 (100bb) before every hand: each hand is then an
 *    i.i.d. sample, eliminating wealth-compounding correlations and making the
 *    per-paradigm mean an unbiased win-rate estimate with classical SEs.
 *  - Only the five regular seats are counted; the shadow seat is excluded, so
 *    each paradigm accumulates exactly `N` counted hands per block.
 *  - Deterministic seeded RNG; chip conservation asserted every hand.
 *
 * Usage: bun run scripts/tournament.ts <blockIndex 0-4> <hands> [outPath]
 */

import {
  applyAction,
  cloneState,
  createGame,
  getLegalActions,
  startHand,
  type Action,
} from '../src/lib/poker/engine';
import { inferAbstractChar } from '../src/lib/poker/abstraction';
import { seededRng } from '../src/lib/poker/cards';
import { createRuleAgent } from '../src/lib/poker/agents/rule-based';
import { createMonteCarloAgent } from '../src/lib/poker/agents/monte-carlo';
import { createCfrAgent, type CfrBlueprint } from '../src/lib/poker/agents/cfr';
import { createDeepCfrAgent, type DeepCfrModel } from '../src/lib/poker/agents/deepcfr';
import { createRlAgent, type RlPolicy } from '../src/lib/poker/agents/rl';
import type { PokerAgent } from '../src/lib/poker/agents/types';

const TYPE_ORDER = ['rule', 'montecarlo', 'cfr', 'deepcfr', 'rl'] as const;
type TypeName = (typeof TYPE_ORDER)[number];

const block = Number(process.argv[2] ?? 0) as number;
const N_HANDS = Number(process.argv[3] ?? 5000);
const outPath = process.argv[4] ?? `scripts/tournament-results-block-${block}.json`;
const MC_SIMS = 300;
const SB = 5;
const BB = 10;
const START = 1000;

const blueprint = JSON.parse(await Bun.file('public/ai/cfr-blueprint.json').text()) as CfrBlueprint;
const dmodel = JSON.parse(await Bun.file('public/ai/deepcfr-model.json').text()) as DeepCfrModel;
const rlpolicy = JSON.parse(await Bun.file('public/ai/rl-policy.json').text()) as RlPolicy;

const agents: Record<TypeName, PokerAgent> = {
  rule: createRuleAgent(),
  montecarlo: createMonteCarloAgent(MC_SIMS, 0),
  cfr: createCfrAgent(blueprint, 0),
  deepcfr: createDeepCfrAgent(dmodel),
  rl: createRlAgent(rlpolicy, 0.02),
};

interface TypeStats {
  hands: number;
  net: number;
  netSq: number;
  vpip: number;
  pfr: number;
  decisions: number;
  aggActions: number;
  showdowns: number;
  showdownWins: number;
}

const zero = (): TypeStats => ({ hands: 0, net: 0, netSq: 0, vpip: 0, pfr: 0, decisions: 0, aggActions: 0, showdowns: 0, showdownWins: 0 });
const stats: Record<TypeName, TypeStats> = {
  rule: zero(),
  montecarlo: zero(),
  cfr: zero(),
  deepcfr: zero(),
  rl: zero(),
};

// Table layout for block k: the five paradigms + a shadow duplicate of type k.
const shadowType = TYPE_ORDER[block];
const layout: TypeName[] = [...TYPE_ORDER, shadowType];

const rng = seededRng(20260914 + block * 7919);
const game = createGame({
  players: layout.map((t, i) => ({ name: `Bot-${t}-${i}`, isHuman: false, aiType: t, stack: START })),
  sb: SB,
  bb: BB,
});

let conservationErrors = 0;
let illegalActions = 0;
let showdownHands = 0;
let flopSeen = 0;

const t0 = Date.now();

for (let h = 0; h < N_HANDS; h++) {
  // Reset stacks every hand: i.i.d. samples, no wealth compounding.
  for (const p of game.players) {
    p.stack = START;
    p.status = 'in';
  }
  const startEvents = startHand(game, rng);

  // Pre-hand stacks: post-startHand stacks plus blinds already posted
  // (rebuys restore exactly START before blinds, so this holds in all cases).
  const blindPaid = new Array(layout.length).fill(0);
  for (const e of startEvents) if (e.t === 'blind') blindPaid[e.seat] = e.amount;
  const stacksAtStart = game.players.map((p, s) => p.stack + blindPaid[s]);

  // Rotate types by BUTTON-RELATIVE distance so every paradigm cycles through
  // all positions (BTN, SB, BB, UTG, MP, CO) independent of engine button rotation.
  const rotCount = h % 6;
  const n = game.players.length;
  const typeOfSeat: TypeName[] = game.players.map((p, s) => {
    const d = (s - game.button + n) % n;
    return layout[(d + rotCount) % layout.length];
  });
  const layoutIndexOfSeat = game.players.map((p, s) => {
    const d = (s - game.button + n) % n;
    return (d + rotCount) % layout.length;
  });
  // The seat holding the layout[5] shadow slot is excluded from stats.
  const isShadow = layoutIndexOfSeat.map((i) => i === layout.length - 1);

  let seq = '';
  let didVpip = new Array(n).fill(false);
  let didPfr = new Array(n).fill(false);
  let safety = 0;
  while (game.stage !== 'handover' && game.actor !== null && safety < 200) {
    safety++;
    const seat = game.actor!;
    const legal = getLegalActions(game);
    if (!legal) break;
    const type = typeOfSeat[seat];
    const agent = agents[type];
    const prevState = cloneState(game);
    const prevStage = prevState.stage;
    const decision = agent.decide({ state: prevState, legal, seat, seq, rng });

    let evts;
    try {
      evts = applyAction(game, decision.action, rng);
    } catch {
      illegalActions++;
      const fallback: Action = legal.toCall > 0 ? { type: 'fold' } : { type: 'check' };
      evts = applyAction(game, fallback, rng);
    }
    const ch = decision.abstractChar ?? inferAbstractChar(prevState, legal, decision.action);
    if (ch) seq += ch;
    for (const e of evts) if (e.t === 'street') seq = '';

    if (!isShadow[seat]) {
      const st = stats[type];
      st.decisions++;
      if (decision.action.type === 'raise') st.aggActions++;
      if (prevStage === 'preflop' && (decision.action.type === 'call' || decision.action.type === 'raise')) didVpip[seat] = true;
      if (prevStage === 'preflop' && decision.action.type === 'raise') didPfr[seat] = true;
    }
  }
  if (safety >= 200) throw new Error('hand did not terminate');

  // VPIP/PFR: once per hand (a fold after calling/raising still counts as VPIP).
  for (let s = 0; s < n; s++) {
    if (!isShadow[s] && didVpip[s]) stats[typeOfSeat[s]].vpip++;
    if (!isShadow[s] && didPfr[s]) stats[typeOfSeat[s]].pfr++;
  }

  // Hand settled: account chips.
  let deltaSum = 0;
  game.players.forEach((p, s) => {
    const delta = p.stack - stacksAtStart[s];
    deltaSum += delta;
    if (!isShadow[s]) {
      const st = stats[typeOfSeat[s]];
      st.hands++;
      st.net += delta;
      st.netSq += delta * delta;
    }
  });
  if (deltaSum !== 0) conservationErrors++;

  if (game.showdownInfo && !game.showdownInfo.foldWin) {
    showdownHands++;
    if (game.board.length >= 3) flopSeen++;
    const winners = new Set(game.showdownInfo.pots.flatMap((p) => p.winnerSeats));
    for (const r of game.showdownInfo.reveal) {
      if (!isShadow[r.seat]) {
        stats[typeOfSeat[r.seat]].showdowns++;
        if (winners.has(r.seat)) stats[typeOfSeat[r.seat]].showdownWins++;
      }
    }
  }

  if ((h + 1) % 500 === 0) {
    const el = (Date.now() - t0) / 1000;
    const done = ((h + 1) / N_HANDS) * 100;
    console.log(`block ${block} hand ${h + 1}/${N_HANDS} (${done.toFixed(0)}%) ${el.toFixed(0)}s elapsed`);
  }
}

const elapsed = (Date.now() - t0) / 1000;
const result = {
  meta: {
    block,
    shadowType,
    hands: N_HANDS,
    seed: 20260914 + block * 7919,
    mcSimsBudget: MC_SIMS,
    blinds: `${SB}/${BB}`,
    startStack: START,
    elapsedSeconds: Math.round(elapsed),
    conservationErrors,
    illegalActions,
    showdownHands,
    flopSeen,
  },
  stats: Object.fromEntries(
    TYPE_ORDER.map((t) => {
      const st = stats[t];
      const hands = Math.max(1, st.hands);
      const mean = st.net / hands;
      const variance = Math.max(0, st.netSq / hands - mean * mean);
      const se = Math.sqrt(variance / hands);
      return [
        t,
        {
          hands: st.hands,
          netChips: st.net,
          mbbPerHand: (st.net / BB / hands) * 1000,
          mbbPerHandSE: (se / BB) * 1000,
          vpip: (st.vpip / hands) * 100,
          pfr: (st.pfr / hands) * 100,
          aggressionFreq: (st.aggActions / Math.max(1, st.decisions)) * 100,
          showdownFreq: (st.showdowns / hands) * 100,
          showdownWinPct: (st.showdownWins / Math.max(1, st.showdowns)) * 100,
        },
      ];
    }),
  ),
};

await Bun.write(outPath, JSON.stringify(result, null, 2));
console.log(`\nblock ${block} done: ${N_HANDS} hands in ${elapsed.toFixed(0)}s (errors: ${conservationErrors} chip, ${illegalActions} action)`);
console.table(result.stats);
