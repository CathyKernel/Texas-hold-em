import type { Action, GameState, LegalAction } from '../engine';
import type { AbstractChar } from '../abstraction';

export interface DecisionContext {
  /** Game state BEFORE the action; state.actor === seat. */
  state: GameState;
  legal: LegalAction;
  seat: number;
  /** Abstract action sequence of the current street (for infoset keys). */
  seq: string;
  rng: () => number;
}

export interface AgentDecision {
  action: Action;
  abstractChar?: AbstractChar;
  rationale: string;
  metrics?: Record<string, number>;
  probs?: { label: string; p: number }[];
}

export type AgentType = 'rule' | 'montecarlo' | 'cfr' | 'deepcfr' | 'rl';

export interface PokerAgent {
  type: AgentType;
  name: string;
  tagline: string;
  algorithm: string;
  description: string;
  decide(ctx: DecisionContext): AgentDecision;
}
