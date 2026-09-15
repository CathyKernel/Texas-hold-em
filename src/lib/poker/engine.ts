/**
 * Texas Hold'em No-Limit game engine.
 *
 * Rules implemented strictly:
 *  - Rotating dealer button; blinds posted by SB and BB seats (heads-up: button posts SB).
 *  - Preflop action starts left of the BB (heads-up: button acts first).
 *  - Postflop action starts with the first live player left of the button.
 *  - Minimum raise = size of the last raise/bet (initially one big blind); raise-to semantics.
 *  - A short all-in "raise" does NOT reopen betting for players who have already acted.
 *  - Big-blind option: the BB may raise even after everyone limps.
 *  - Uncalled bets are returned to the final aggressor.
 *  - Side pots computed from exact contribution layers; split pots split evenly with
 *    odd chips awarded one at a time starting left of the button.
 *  - Burn cards before flop/turn/river; best 5-card hand from 7 at showdown.
 */

import { makeDeck, shuffle } from './cards';
import { describeScore, evaluate } from './evaluator';

export type Stage = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'handover';
export type PlayerStatus = 'in' | 'folded' | 'allin' | 'busted';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface PlayerState {
  seat: number;
  name: string;
  stack: number;
  bet: number; // chips in front this street
  committed: number; // total wagered this hand
  hole: number[];
  status: PlayerStatus;
  hasActed: boolean; // acted voluntarily this street
  actedAtRaiseCount: number; // fullRaiseCount snapshot when last acted
  isHuman: boolean;
  aiType: string; // 'human' | 'rule' | 'montecarlo' | 'cfr' | 'deepcfr' | 'rl'
}

export interface LegalAction {
  seat: number;
  toCall: number; // chips needed to match current bet
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAllIn: boolean;
  canRaise: boolean;
  isBet: boolean; // true when no bet yet this street (display "Bet" vs "Raise")
  minRaiseTo: number; // minimum bet-to amount
  maxRaiseTo: number; // all-in bet-to amount
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }; // bet-to total (all-in allowed below min-raise if short)

export interface PotResult {
  amount: number;
  eligibleSeats: number[];
  winnerSeats: number[];
  handName: string;
  potIndex: number;
}

export interface ShowdownInfo {
  reveal: { seat: number; cards: number[]; score: number; handName: string; won: boolean }[];
  pots: PotResult[];
  totalAward: { seat: number; amount: number }[];
  foldWin: boolean;
}

export type GameEvent =
  | { t: 'blind'; seat: number; amount: number; blind: 'sb' | 'bb' }
  | { t: 'hole'; seat: number; cards: number[] }
  | { t: 'fold'; seat: number }
  | { t: 'check'; seat: number }
  | { t: 'call'; seat: number; amount: number }
  | { t: 'raise'; seat: number; to: number; raiseBy: number; allin: boolean; isBet: boolean }
  | { t: 'street'; street: Street; cards: number[] }
  | { t: 'return'; seat: number; amount: number }
  | { t: 'reveal'; seat: number; cards: number[]; handName: string }
  | { t: 'award'; seat: number; amount: number; handName: string | null; potIndex: number }
  | { t: 'handover'; foldWin: boolean }
  | { t: 'rebuy'; seat: number; amount: number };

export interface GameState {
  players: PlayerState[];
  deck: number[];
  board: number[];
  burned: number[];
  stage: Stage;
  button: number;
  pot: number; // collected chips from completed streets
  currentBet: number;
  lastRaiseSize: number;
  minRaiseTo: number;
  fullRaiseCount: number;
  raisesThisStreet: number; // any voluntary raise/bet this street (abstraction cap)
  actor: number | null;
  handNo: number;
  sb: number;
  bb: number;
  startingStack: number;
  showdownInfo: ShowdownInfo | null;
}

export interface GameConfig {
  players: { name: string; isHuman: boolean; aiType: string; stack: number }[];
  sb: number;
  bb: number;
  button?: number;
}

export function createGame(config: GameConfig): GameState {
  return {
    players: config.players.map((p, i) => ({
      seat: i,
      name: p.name,
      stack: p.stack,
      bet: 0,
      committed: 0,
      hole: [],
      status: p.stack > 0 ? 'in' : 'busted',
      hasActed: false,
      actedAtRaiseCount: 0,
      isHuman: p.isHuman,
      aiType: p.aiType,
    })),
    deck: [],
    board: [],
    burned: [],
    stage: 'idle',
    button: config.button ?? config.players.length - 1,
    pot: 0,
    currentBet: 0,
    lastRaiseSize: config.bb,
    minRaiseTo: config.bb,
    fullRaiseCount: 0,
    raisesThisStreet: 0,
    actor: null,
    handNo: 0,
    sb: config.sb,
    bb: config.bb,
    startingStack: config.players[0].stack,
    showdownInfo: null,
  };
}

export function cloneState(s: GameState): GameState {
  return {
    players: s.players.map((p) => ({ ...p, hole: p.hole.slice() })),
    deck: s.deck.slice(),
    board: s.board.slice(),
    burned: s.burned.slice(),
    stage: s.stage,
    button: s.button,
    pot: s.pot,
    currentBet: s.currentBet,
    lastRaiseSize: s.lastRaiseSize,
    minRaiseTo: s.minRaiseTo,
    fullRaiseCount: s.fullRaiseCount,
    raisesThisStreet: s.raisesThisStreet,
    actor: s.actor,
    handNo: s.handNo,
    sb: s.sb,
    bb: s.bb,
    startingStack: s.startingStack,
    showdownInfo: s.showdownInfo === null ? null : {
      reveal: s.showdownInfo.reveal.map((r) => ({ ...r, cards: r.cards.slice() })),
      pots: s.showdownInfo.pots.map((p) => ({ ...p, eligibleSeats: p.eligibleSeats.slice(), winnerSeats: p.winnerSeats.slice() })),
      totalAward: s.showdownInfo.totalAward.map((a) => ({ ...a })),
      foldWin: s.showdownInfo.foldWin,
    },
  };
}

function nextOccupiedSeat(s: GameState, from: number): number {
  const n = s.players.length;
  return (from + 1) % n;
}

/** Start a new hand. Mutates state; returns events. */
export function startHand(s: GameState, rng: () => number): GameEvent[] {
  const events: GameEvent[] = [];
  s.board = [];
  s.burned = [];
  s.deck = shuffle(makeDeck(), rng);
  s.pot = 0;
  s.currentBet = s.bb;
  s.lastRaiseSize = s.bb;
  s.minRaiseTo = 2 * s.bb;
  s.fullRaiseCount = 0;
  s.raisesThisStreet = 0;
  s.showdownInfo = null;
  s.stage = 'preflop';

  // Rebuy busted players (cash-game style)
  for (const p of s.players) {
    if (p.status === 'busted' || p.stack === 0) {
      p.stack = s.startingStack;
      p.status = 'in';
      events.push({ t: 'rebuy', seat: p.seat, amount: s.startingStack });
    }
    p.bet = 0;
    p.committed = 0;
    p.hole = [];
    p.hasActed = false;
    p.actedAtRaiseCount = 0;
    if (p.status === 'folded' || p.status === 'allin') p.status = 'in';
  }

  // Rotate button (but not on the very first hand)
  s.handNo++;
  if (s.handNo > 1) s.button = nextOccupiedSeat(s, s.button);
  const n = s.players.length;
  const headsUp = n === 2;
  const sbSeat = headsUp ? s.button : nextOccupiedSeat(s, s.button);
  const bbSeat = nextOccupiedSeat(s, sbSeat);

  // Post blinds
  postBlind(s, sbSeat, s.sb, 'sb', events);
  postBlind(s, bbSeat, s.bb, 'bb', events);

  // Deal hole cards, starting left of the button
  let seat = nextOccupiedSeat(s, s.button);
  for (let i = 0; i < n; i++) {
    const p = s.players[seat];
    p.hole = [s.deck.pop()!, s.deck.pop()!];
    events.push({ t: 'hole', seat, cards: p.hole.slice() });
    seat = nextOccupiedSeat(s, seat);
  }

  s.actor = headsUp ? sbSeat : nextOccupiedSeat(s, bbSeat);
  return events;
}

function postBlind(s: GameState, seat: number, amount: number, blind: 'sb' | 'bb', events: GameEvent[]): void {
  const p = s.players[seat];
  const pay = Math.min(amount, p.stack);
  p.stack -= pay;
  p.bet += pay;
  p.committed += pay;
  if (p.stack === 0) p.status = 'allin';
  events.push({ t: 'blind', seat, amount: pay, blind });
}

/** Legal actions for the current actor. Returns null if no action pending. */
export function getLegalActions(s: GameState): LegalAction | null {
  if (s.actor === null || s.stage === 'handover' || s.stage === 'showdown') return null;
  const p = s.players[s.actor];
  const toCall = s.currentBet - p.bet;
  const canCheck = toCall === 0;
  const canCall = toCall > 0;
  const reopenAllowed = !p.hasActed || s.fullRaiseCount > p.actedAtRaiseCount;
  const maxTo = p.bet + p.stack;
  // If every other live player is all-in (or no one else can call), betting is
  // meaningless: a bet cannot be called. Only folding/calling/checking allowed.
  const othersLive = s.players.filter((q) => q !== p && (q.status === 'in' || q.status === 'allin'));
  const othersCanCall = s.players.some((q) => q !== p && q.status === 'in' && q.stack > 0);
  const canRaise = reopenAllowed && p.stack > 0 && maxTo > s.currentBet && othersCanCall && (othersLive.length > 1 || othersCanCall);
  const minTo = Math.min(s.minRaiseTo, maxTo);
  return {
    seat: p.seat,
    toCall,
    canFold: true,
    canCheck,
    canCall,
    callAllIn: canCall && toCall >= p.stack,
    canRaise,
    isBet: s.currentBet === 0,
    minRaiseTo: canRaise ? minTo : 0,
    maxRaiseTo: canRaise ? maxTo : 0,
  };
}

/** Apply an action for the current actor, then advance the game automatically. */
export function applyAction(s: GameState, action: Action, rng: () => number): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.actor === null) throw new Error('No actor');
  const seat = s.actor;
  const p = s.players[seat];

  if (action.type === 'fold') {
    p.status = 'folded';
    p.hasActed = true;
    p.actedAtRaiseCount = s.fullRaiseCount;
    events.push({ t: 'fold', seat });
  } else if (action.type === 'check') {
    if (s.currentBet !== p.bet) throw new Error('Illegal check');
    p.hasActed = true;
    p.actedAtRaiseCount = s.fullRaiseCount;
    events.push({ t: 'check', seat });
  } else if (action.type === 'call') {
    const pay = Math.min(s.currentBet - p.bet, p.stack);
    p.stack -= pay;
    p.bet += pay;
    p.committed += pay;
    if (p.stack === 0) p.status = 'allin';
    p.hasActed = true;
    p.actedAtRaiseCount = s.fullRaiseCount;
    events.push({ t: 'call', seat, amount: pay });
  } else {
    // raise to `to`
    let to = Math.round(action.to);
    const maxTo = p.bet + p.stack;
    if (to > maxTo) to = maxTo;
    const wasBet = s.currentBet === 0;
    const reopenAllowed = !p.hasActed || s.fullRaiseCount > p.actedAtRaiseCount;
    if (!reopenAllowed && to > s.currentBet) {
      throw new Error('Betting not reopened: cannot raise');
    }
    if (to <= s.currentBet) throw new Error('Raise must exceed current bet');
    if (to < maxTo && to < s.minRaiseTo) {
      throw new Error(`Raise below minimum (min raise-to ${s.minRaiseTo})`);
    }
    // A bet/raise is meaningless if no opponent can ever call it (everyone else
    // folded or all-in): the chips would be uncalled. Reject it outright.
    const othersCanCall = s.players.some((q) => q !== p && q.status === 'in' && q.stack > 0);
    if (!othersCanCall) throw new Error('No opponent can call: bet or raise is not allowed');
    const raiseInc = to - s.currentBet;
    const pay = to - p.bet;
    p.stack -= pay;
    p.bet = to;
    p.committed += pay;
    const allin = p.stack === 0;
    if (allin) p.status = 'allin';
    if (raiseInc >= s.lastRaiseSize) {
      // full raise: reopens betting
      s.lastRaiseSize = raiseInc;
      s.minRaiseTo = to + raiseInc;
      s.fullRaiseCount++;
    }
    s.currentBet = to;
    s.raisesThisStreet++;
    p.hasActed = true;
    p.actedAtRaiseCount = s.fullRaiseCount;
    events.push({ t: 'raise', seat, to, raiseBy: raiseInc, allin, isBet: wasBet });
  }

  s.actor = null;
  advance(s, rng, events);
  return events;
}

/** Number of players who can still act (not folded, not all-in, not busted). */
function activeCount(s: GameState): number {
  return s.players.filter((p) => p.status === 'in').length;
}

function aliveCount(s: GameState): number {
  return s.players.filter((p) => p.status === 'in' || p.status === 'allin').length;
}

/** Return uncalled portion of the largest bet to its owner. */
function refundUncalled(s: GameState, events: GameEvent[]): void {
  const live = s.players.filter((p) => p.status !== 'folded' && p.status !== 'busted' && p.bet > 0);
  if (live.length === 0) return;
  const sorted = live.slice().sort((a, b) => b.bet - a.bet);
  const top = sorted[0];
  const second = sorted.length > 1 ? sorted[1].bet : 0;
  // Only refund if the top bettor is not matched by anyone (all others all-in/folded)
  const othersAllMatched = live.every((p) => p === top || p.bet >= top.bet);
  if (!othersAllMatched) {
    const refund = top.bet - second;
    if (refund > 0) {
      top.bet -= refund;
      top.committed -= refund;
      top.stack += refund;
      events.push({ t: 'return', seat: top.seat, amount: refund });
    }
  }
}

function collectBets(s: GameState): void {
  for (const p of s.players) {
    s.pot += p.bet;
    p.bet = 0;
    p.hasActed = false;
    p.actedAtRaiseCount = 0;
  }
  s.currentBet = 0;
  s.lastRaiseSize = s.bb;
  s.minRaiseTo = s.bb;
  s.fullRaiseCount = 0;
  s.raisesThisStreet = 0;
}

/** Deal the next street (with burn). */
function dealStreet(s: GameState, events: GameEvent[]): void {
  if (s.stage === 'preflop') {
    s.burned.push(s.deck.pop()!);
    const cards = [s.deck.pop()!, s.deck.pop()!, s.deck.pop()!];
    s.board.push(...cards);
    s.stage = 'flop';
    events.push({ t: 'street', street: 'flop', cards: cards.slice() });
  } else if (s.stage === 'flop') {
    s.burned.push(s.deck.pop()!);
    const card = s.deck.pop()!;
    s.board.push(card);
    s.stage = 'turn';
    events.push({ t: 'street', street: 'turn', cards: [card] });
  } else if (s.stage === 'turn') {
    s.burned.push(s.deck.pop()!);
    const card = s.deck.pop()!;
    s.board.push(card);
    s.stage = 'river';
    events.push({ t: 'street', street: 'river', cards: [card] });
  }
}

/** Move the game forward after an action: next actor, street transitions, runouts, showdown. */
function advance(s: GameState, rng: () => number, events: GameEvent[]): void {
  const n = s.players.length;

  // Fold win: only one player left
  if (aliveCount(s) === 1) {
    const winner = s.players.find((p) => p.status === 'in' || p.status === 'allin')!;
    let total = s.pot;
    for (const p of s.players) total += p.bet;
    winner.stack += total;
    for (const p of s.players) p.bet = 0;
    s.pot = 0;
    events.push({ t: 'award', seat: winner.seat, amount: total, handName: null, potIndex: 0 });
    events.push({ t: 'handover', foldWin: true });
    s.stage = 'handover';
    s.actor = null;
    s.showdownInfo = {
      reveal: [],
      pots: [{ amount: total, eligibleSeats: [winner.seat], winnerSeats: [winner.seat], handName: 'folded to', potIndex: 0 }],
      totalAward: [{ seat: winner.seat, amount: total }],
      foldWin: true,
    };
    markBusted(s);
    return;
  }

  // Round end?
  const active = s.players.filter((p) => p.status === 'in');
  const roundEnd = active.length === 0 || active.every((p) => p.hasActed && p.bet === s.currentBet);

  if (!roundEnd) {
    // Find next player who can act (status 'in'), starting after current
    // (actor is already null; use last acting seat stored implicitly — we track via
    // searching from the last aggressor or the seat that just acted)
    const from = lastActorSeat(s, events);
    let seat = (from + 1) % n;
    for (let i = 0; i < n; i++) {
      const p = s.players[seat];
      if (p.status === 'in') {
        s.actor = seat;
        return;
      }
      seat = (seat + 1) % n;
    }
    // No one can act — fall through to round end handling
  }

  refundUncalled(s, events);
  collectBets(s);

  if (s.stage === 'river') {
    showdown(s, events);
    return;
  }

  // Deal next street; keep dealing if nobody can act (all-in runout)
  do {
    dealStreet(s, events);
    if (s.stage === 'river') break;
  } while (activeCount(s) === 0);

  if (activeCount(s) === 0 && s.stage === 'river') {
    showdown(s, events);
    return;
  }

  // Postflop first to act: first live player left of the button
  let seat = (s.button + 1) % n;
  for (let i = 0; i < n; i++) {
    const p = s.players[seat];
    if (p.status === 'in') {
      s.actor = seat;
      return;
    }
    seat = (seat + 1) % n;
  }
  if (s.actor === null) {
    // Everyone all-in mid-street edge
    showdown(s, events);
  }
}

/** Remember the seat that just acted (recovered from the last event). */
function lastActorSeat(_s: GameState, events: GameEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if ('seat' in e) return e.seat;
  }
  return _s.button;
}

function markBusted(s: GameState): void {
  for (const p of s.players) if (p.stack === 0) p.status = 'busted';
}

/** Build side pots from committed amounts; evaluate hands; award. */
function showdown(s: GameState, events: GameEvent[]): void {
  s.stage = 'showdown';
  const n = s.players.length;

  // Reveal hands of all live players (last aggressor first is cosmetic; we reveal all)
  const live = s.players.filter((p) => p.status === 'in' || p.status === 'allin');
  const scores = new Map<number, number>();
  for (const p of live) {
    const score = evaluate([...p.hole, ...s.board]);
    scores.set(p.seat, score);
    events.push({ t: 'reveal', seat: p.seat, cards: p.hole.slice(), handName: describeScore(score) });
  }

  // Build contribution layers
  // Folded players' chips are dead money: they still fund pots, but the layer
  // eligibility is decided by non-folded players. If a layer would end up with
  // NO eligible player (top layer contributed only by folded players), its chips
  // must be pushed down into the highest layer that has an eligible winner.
  const remaining = s.players.map((p) => p.committed);
  const pots: { amount: number; eligible: number[] }[] = [];
  while (remaining.some((r) => r > 0)) {
    const positive = s.players.filter((_, i) => remaining[i] > 0);
    const level = Math.min(...positive.map((p) => remaining[p.seat]));
    let amount = 0;
    const eligible: number[] = [];
    for (const p of s.players) {
      if (remaining[p.seat] > 0) {
        amount += level;
        remaining[p.seat] -= level;
        if (p.status !== 'folded' && p.status !== 'busted') eligible.push(p.seat);
      }
    }
    pots.push({ amount, eligible });
    // merge consecutive pots with identical eligibility
    if (pots.length > 1) {
      const prev = pots[pots.length - 2];
      const cur = pots[pots.length - 1];
      if (prev.eligible.length === cur.eligible.length && prev.eligible.every((v, i) => v === cur.eligible[i])) {
        prev.amount += cur.amount;
        pots.pop();
      }
    }
  }
  // Dead-money repair: a layer with no eligible winner (only folded players
  // contributed at that depth) rolls into the deepest layer that has one.
  for (let i = pots.length - 1; i >= 0; i--) {
    if (pots[i].eligible.length === 0) {
      const target = pots.slice(0, i).findLastIndex((p) => p.eligible.length > 0);
      if (target === -1) {
        // No eligible winner anywhere: refund contributors (should not happen;
        // guarded by fold-win path) — return chips to folded contributors.
        for (const p of s.players) {
          if (p.committed > 0) { p.stack += p.committed; }
        }
        return;
      }
      pots[target].amount += pots[i].amount;
      pots.splice(i, 1);
    }
  }

  const potResults: PotResult[] = [];
  const totalAward = new Map<number, number>();
  pots.forEach((pot, potIndex) => {
    let best = -1;
    for (const seat of pot.eligible) best = Math.max(best, scores.get(seat)!);
    const winners = pot.eligible.filter((seat) => scores.get(seat) === best);
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    // Odd chips: one at a time starting left of the button
    const ordered = winners.slice().sort((a, b) => distFromButton(s, a) - distFromButton(s, b));
    const amounts = new Map<number, number>();
    for (const seat of ordered) amounts.set(seat, share);
    let oi = 0;
    while (odd > 0) {
      const seat = ordered[oi % ordered.length];
      amounts.set(seat, (amounts.get(seat) ?? 0) + 1);
      odd--;
      oi++;
    }
    const handName = describeScore(best);
    for (const [seat, amount] of amounts) {
      s.players[seat].stack += amount;
      totalAward.set(seat, (totalAward.get(seat) ?? 0) + amount);
      events.push({ t: 'award', seat, amount, handName, potIndex });
    }
    potResults.push({ amount: pot.amount, eligibleSeats: pot.eligible, winnerSeats: winners, handName, potIndex });
  });

  s.pot = 0;
  events.push({ t: 'handover', foldWin: false });
  s.stage = 'handover';
  s.actor = null;
  s.showdownInfo = {
    reveal: live.map((p) => ({
      seat: p.seat,
      cards: p.hole.slice(),
      score: scores.get(p.seat)!,
      handName: describeScore(scores.get(p.seat)!),
      won: potResults.some((pr) => pr.winnerSeats.includes(p.seat)),
    })),
    pots: potResults,
    totalAward: [...totalAward.entries()].map(([seat, amount]) => ({ seat, amount })),
    foldWin: false,
  };
  markBusted(s);
}

function distFromButton(s: GameState, seat: number): number {
  const n = s.players.length;
  return (seat - s.button + n) % n;
}

/** Position label for UI/training. */
export function positionLabel(s: GameState, seat: number): string {
  const n = s.players.length;
  const d = distFromButton(s, seat);
  if (n === 2) return d === 0 ? 'BTN/SB' : 'BB';
  if (d === 0) return 'BTN';
  if (d === 1) return 'SB';
  if (d === 2) return 'BB';
  if (n === 6) return d === 3 ? 'UTG' : d === 4 ? 'MP' : 'CO';
  // generic fallback
  const labels = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'MP2', 'CO'];
  return labels[d] ?? `P${d}`;
}

/** Coarse position class used in abstractions: EP / MP / LP / SB / BB. */
export function positionClass(s: GameState, seat: number): string {
  const n = s.players.length;
  const d = distFromButton(s, seat);
  if (n === 2) return d === 0 ? 'LP' : 'BB';
  if (d === 0) return 'LP'; // BTN
  if (d === 1) return 'SB';
  if (d === 2) return 'BB';
  if (d === 3) return 'EP';
  if (d === 4) return 'MP';
  return 'LP';
}

/** Whether the hand is complete. */
export function handOver(s: GameState): boolean {
  return s.stage === 'handover';
}

/** Current street as string key. */
export function streetKey(s: GameState): string {
  return s.stage === 'preflop' || s.stage === 'flop' || s.stage === 'turn' || s.stage === 'river' ? s.stage : 'other';
}

/** Pot size including current street bets. */
export function totalPot(s: GameState): number {
  return s.pot + s.players.reduce((a, p) => a + p.bet, 0);
}
