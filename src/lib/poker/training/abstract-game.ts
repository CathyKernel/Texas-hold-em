/**
 * Abstract-game driver used by offline training scripts (CFR / Deep CFR / RL).
 * Wraps the real engine: every action flows through the action abstraction,
 * and the abstract betting sequence per street is tracked for infoset keys.
 */

import {
  applyAction,
  cloneState,
  createGame,
  getLegalActions,
  handOver,
  positionClass,
  startHand,
  streetKey,
  type GameConfig,
  type GameState,
  type GameEvent,
  type LegalAction,
} from '../engine';
import {
  handBucket,
  infosetKey,
  legalAbstractActions,
  mapAbstractAction,
  type AbstractChar,
} from '../abstraction';

export class AbstractGame {
  state: GameState;
  rng: () => number;
  seq = '';

  constructor(cfg: GameConfig, rng: () => number) {
    this.state = createGame(cfg);
    this.rng = rng;
  }

  start(): GameEvent[] {
    const ev = startHand(this.state, this.rng);
    this.seq = '';
    return ev;
  }

  clone(): AbstractGame {
    const g = Object.create(AbstractGame.prototype) as AbstractGame;
    g.state = cloneState(this.state);
    g.rng = this.rng;
    g.seq = this.seq;
    return g;
  }

  legal(): LegalAction | null {
    return getLegalActions(this.state);
  }

  chars(legal: LegalAction): AbstractChar[] {
    return legalAbstractActions(this.state, legal);
  }

  /** Infoset key for the current actor. */
  key(): string {
    const seat = this.state.actor!;
    return infosetKey(positionClass(this.state, seat), streetKey(this.state), handBucket(this.state, seat), this.seq);
  }

  act(ch: AbstractChar): GameEvent[] {
    const legal = this.legal();
    if (!legal) throw new Error('act() with no legal actions');
    const action = mapAbstractAction(this.state, legal, ch);
    const evs = applyAction(this.state, action, this.rng);
    this.seq += ch;
    for (const e of evs) {
      if (e.t === 'street') this.seq = '';
    }
    return evs;
  }

  over(): boolean {
    return handOver(this.state);
  }

  payoff(seat: number): number {
    return this.state.players[seat].stack - this.state.startingStack;
  }
}

export function standardTrainingConfig(n: number, button?: number): GameConfig {
  return {
    players: Array.from({ length: n }, (_, i) => ({ name: `T${i}`, isHuman: false, aiType: 'train', stack: 1000 })),
    sb: 5,
    bb: 10,
    button,
  };
}
