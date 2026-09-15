'use client';

/**
 * Game orchestration hook: owns the engine state, drives AI turns with
 * natural delays, tracks abstract betting sequences, builds the hand log,
 * and exposes per-agent "insight" records for the transparency panels.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyAction,
  cloneState,
  createGame,
  getLegalActions,
  positionLabel,
  startHand,
  totalPot,
  type Action,
  type GameEvent,
  type GameState,
} from '@/lib/poker/engine';
import { inferAbstractChar, type AbstractChar } from '@/lib/poker/abstraction';
import { cardStr } from '@/lib/poker/cards';
import { createRuleAgent } from '@/lib/poker/agents/rule-based';
import { createMonteCarloAgent } from '@/lib/poker/agents/monte-carlo';
import { createCfrAgent, type CfrBlueprint } from '@/lib/poker/agents/cfr';
import { createDeepCfrAgent, type DeepCfrModel } from '@/lib/poker/agents/deepcfr';
import { createRlAgent, type RlPolicy } from '@/lib/poker/agents/rl';
import type { AgentDecision, PokerAgent } from '@/lib/poker/agents/types';

export type Phase = 'loading' | 'ready' | 'playing' | 'handover';

export interface LogLine {
  id: number;
  text: string;
  kind: 'action' | 'street' | 'showdown' | 'system' | 'award';
}

export interface InsightEntry {
  seat: number;
  type: string;
  name: string;
  rationale: string;
  probs?: { label: string; p: number }[];
  metrics?: Record<string, number>;
  handNo: number;
}

export interface ArtifactMeta {
  cfr: CfrBlueprint['meta'] | null;
  deepcfr: DeepCfrModel['meta'] | null;
  deepcfrValLoss?: number;
  rl: RlPolicy['meta'] | null;
  rlCurve?: { episode: number; avgReward: number }[];
}

export interface Stats {
  hands: number;
  wins: number;
  showdowns: number;
  net: number;
  buyins: number;
}

const START_STACK = 1000;
const SEAT_NAMES = ['You', 'Professor Rule', 'The Simulator', 'The Game Theorist', 'The Deep Thinker', 'The Self-Taught'];

export interface UsePokerGameReturn {
  phase: Phase;
  snap: GameState | null;
  humanTurn: boolean;
  log: LogLine[];
  insights: Record<number, InsightEntry>;
  artifactMeta: ArtifactMeta;
  stats: Stats;
  loadingError: string | null;
  speed: number;
  setSpeed: (s: number) => void;
  autoDeal: boolean;
  setAutoDeal: (b: boolean) => void;
  newHand: () => void;
  humanAct: (action: Action) => void;
  actingSeat: number | null;
  lastActions: Record<number, string>;
}

export function usePokerGame(): UsePokerGameReturn {
  const [phase, setPhase] = useState<Phase>('loading');
  const [snap, setSnap] = useState<GameState | null>(null);
  const [humanTurn, setHumanTurn] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [insights, setInsights] = useState<Record<number, InsightEntry>>({});
  const [artifactMeta, setArtifactMeta] = useState<ArtifactMeta>({ cfr: null, deepcfr: null, rl: null });
  const [stats, setStats] = useState<Stats>({ hands: 0, wins: 0, showdowns: 0, net: 0, buyins: 1 });
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [lastActions, setLastActions] = useState<Record<number, string>>({});
  const [speed, setSpeed] = useState(1);
  const [autoDeal, setAutoDeal] = useState(true);

  const stateRef = useRef<GameState | null>(null);
  const seqRef = useRef<string>('');
  const agentsRef = useRef<Map<number, PokerAgent>>(new Map());
  const logIdRef = useRef(0);
  const handStartStackRef = useRef(START_STACK);
  const speedRef = useRef(1);
  const autoRef = useRef(true);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const statsRef = useRef<Stats>({ hands: 0, wins: 0, showdowns: 0, net: 0, buyins: 1 });
  const newHandRef = useRef<() => void>(() => {});

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    autoRef.current = autoDeal;
  }, [autoDeal]);

  const pushLog = useCallback((text: string, kind: LogLine['kind'] = 'action') => {
    logIdRef.current += 1;
    const line: LogLine = { id: logIdRef.current, text, kind };
    setLog((prev) => [...prev.slice(-400), line]);
  }, []);

  // ---------- Load artifacts & construct agents ----------
  useEffect(() => {
    let cancelled = false;
    const agents = agentsRef.current;
    agents.set(1, createRuleAgent());
    agents.set(2, createMonteCarloAgent());
    agents.set(4, createDeepCfrAgent(null));
    agents.set(5, createRlAgent(null));
    agents.set(3, createCfrAgent(null, 3));

    (async () => {
      const [cfrP, dcfrP, rlP] = await Promise.allSettled([
        fetch('/ai/cfr-blueprint.json').then((r) => r.json() as Promise<CfrBlueprint>),
        fetch('/ai/deepcfr-model.json').then((r) => r.json() as Promise<DeepCfrModel>),
        fetch('/ai/rl-policy.json').then((r) => r.json() as Promise<RlPolicy>),
      ]);
      if (cancelled) return;
      let err = false;
      if (cfrP.status === 'fulfilled' && (cfrP.value?.pooled || cfrP.value?.players)) {
        agents.set(3, createCfrAgent(cfrP.value, 3));
      } else err = true;
      if (dcfrP.status === 'fulfilled' && dcfrP.value?.w1) {
        agents.set(4, createDeepCfrAgent(dcfrP.value));
      } else err = true;
      if (rlP.status === 'fulfilled' && rlP.value?.q) {
        agents.set(5, createRlAgent(rlP.value));
      } else err = true;
      setArtifactMeta({
        cfr: cfrP.status === 'fulfilled' ? cfrP.value.meta : null,
        deepcfr: dcfrP.status === 'fulfilled' ? dcfrP.value.meta : null,
        deepcfrValLoss: dcfrP.status === 'fulfilled' ? dcfrP.value?.meta?.finalLoss : undefined,
        rl: rlP.status === 'fulfilled' ? rlP.value.meta : null,
        rlCurve: rlP.status === 'fulfilled' ? rlP.value.learningCurve : undefined,
      });
      if (err) setLoadingError('Some AI artifacts failed to load; affected bots fall back to uniform strategies.');

      const g = createGame({
        players: SEAT_NAMES.map((name, i) => ({
          name,
          isHuman: i === 0,
          aiType: i === 0 ? 'human' : ['rule', 'montecarlo', 'cfr', 'deepcfr', 'rl'][i - 1],
          stack: START_STACK,
        })),
        sb: 5,
        bb: 10,
      });
      stateRef.current = g;
      setSnap(cloneState(g));
      setPhase('ready');
      pushLog('AI brains loaded. Press "Deal Hand" to start.', 'system');
    })();
    return () => {
      cancelled = true;
    };
  }, [pushLog]);

  const nameOf = useCallback((seat: number): string => {
    return seat === 0 ? 'You' : stateRef.current?.players[seat]?.name ?? `Seat ${seat}`;
  }, []);

  /** Verb conjugation: third person for bots ("Rule checks"), plain for "You" ("You check"). */
  const verbOf = useCallback((seat: number, verb: string): string => {
    return seat === 0 ? verb : `${verb}s`;
  }, []);

  const eventsToLog = useCallback(
    (events: GameEvent[]) => {
      for (const e of events) {
        switch (e.t) {
          case 'blind':
            pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'post')} ${e.blind === 'sb' ? 'small' : 'big'} blind ${e.amount}.`);
            break;
          case 'hole':
            if (e.seat === 0) pushLog(`You are dealt ${e.cards.map(cardStr).join(' ')}.`, 'system');
            break;
          case 'fold':
            setLastActions((prev) => ({ ...prev, [e.seat]: 'FOLD' }));
            pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'fold')}.`);
            break;
          case 'check':
            setLastActions((prev) => ({ ...prev, [e.seat]: 'CHECK' }));
            pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'check')}.`);
            break;
          case 'call':
            setLastActions((prev) => ({ ...prev, [e.seat]: `CALL ${e.amount}` }));
            pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'call')} ${e.amount}.`);
            break;
          case 'raise':
            setLastActions((prev) => ({ ...prev, [e.seat]: e.allin ? `ALL-IN ${e.to}` : e.isBet ? `BET ${e.to}` : `RAISE ${e.to}` }));
            if (e.allin) pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'go')} ALL-IN for ${e.to}.`);
            else if (e.isBet) pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'bet')} ${e.to}.`);
            else pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'raise')} to ${e.to}.`);
            break;
          case 'street': {
            // New street: clear per-street action chips so the table reads fresh
            setLastActions({});
            pushLog(
              `— ${e.street[0].toUpperCase() + e.street.slice(1)} dealt: ${e.cards.map(cardStr).join(' ')} —`,
              'street',
            );
            break;
          }
          case 'return':
            pushLog(`${e.amount} uncalled returned to ${nameOf(e.seat)}.`);
            break;
          case 'reveal':
            pushLog(`${nameOf(e.seat)} shows ${e.cards.map(cardStr).join(' ')} — ${e.handName}.`, 'showdown');
            break;
          case 'award': {
            const amt = e.amount;
            pushLog(`${nameOf(e.seat)} ${verbOf(e.seat, 'win')} ${amt}${e.handName ? ` with ${e.handName}` : ''}.`, 'award');
            break;
          }
          case 'rebuy':
            if (e.seat === 0) {
              statsRef.current.buyins += 1;
              pushLog(`You re-buy for ${e.amount}.`, 'system');
            } else {
              pushLog(`${nameOf(e.seat)} re-buys for ${e.amount}.`, 'system');
            }
            break;
          case 'handover':
            break;
        }
      }
    },
    [nameOf, pushLog, verbOf],
  );

  const updateSeq = useCallback((events: GameEvent[], ch: AbstractChar | null) => {
    if (ch) seqRef.current += ch;
    for (const e of events) {
      if (e.t === 'street') seqRef.current = '';
    }
  }, []);

  const snapshot = useCallback(() => {
    if (stateRef.current) setSnap(cloneState(stateRef.current));
  }, []);

  // ---------- Deal a new hand ----------
  const newHand = useCallback(() => {
    const g = stateRef.current;
    if (!g) return;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    const events = startHand(g, Math.random);
    seqRef.current = '';
    setInsights({});
    setLastActions({});
    pushLog(`— Hand #${g.handNo} begins —`, 'system');
    eventsToLog(events);
    handStartStackRef.current = g.players[0].stack;
    statsRef.current.hands += 1;
    setStats({ ...statsRef.current });
    setHumanTurn(false);
    snapshot();
    setPhase('playing');
    // If the human acts first, enable the action bar via derived state
    if (g.actor === 0) setHumanTurn(true);
  }, [eventsToLog, pushLog, snapshot]);

  useEffect(() => {
    newHandRef.current = newHand;
  }, [newHand]);

  // ---------- Apply any action (human or AI) ----------
  const applyAndAdvance = useCallback(
    (seat: number, action: Action, abstractChar: AbstractChar | null, decision?: AgentDecision, agent?: PokerAgent) => {
      const g = stateRef.current;
      if (!g || g.actor !== seat) return;
      const events = applyAction(g, action, Math.random);
      updateSeq(events, abstractChar);
      eventsToLog(events);
      if (decision && agent) {
        const insight: InsightEntry = {
          seat,
          type: agent.type,
          name: agent.name,
          rationale: decision.rationale,
          probs: decision.probs,
          metrics: decision.metrics,
          handNo: g.handNo,
        };
        setInsights((prev) => ({ ...prev, [seat]: insight }));
      }
      if (g.stage === 'handover') {
        const delta = g.players[0].stack - handStartStackRef.current;
        statsRef.current.net += delta;
        if (g.showdownInfo) {
          const humanWon = g.showdownInfo.totalAward.some((a) => a.seat === 0);
          if (humanWon) statsRef.current.wins += 1;
          if (!g.showdownInfo.foldWin) statsRef.current.showdowns += 1;
        }
        setStats({ ...statsRef.current });
        setHumanTurn(false);
        setPhase('handover');
        snapshot();
        if (autoRef.current) {
          const t = setTimeout(() => newHandRef.current(), 4200 / speedRef.current);
          timersRef.current.push(t);
        }
        return;
      }
      setHumanTurn(g.actor === 0);
      snapshot();
    },
    [eventsToLog, snapshot, updateSeq],
  );

  const humanAct = useCallback(
    (action: Action) => {
      const g = stateRef.current;
      if (!g || g.actor !== 0 || phase !== 'playing') return;
      const legal = getLegalActions(g);
      if (!legal) return;
      const prevState = cloneState(g);
      const prevLegal = legal;
      applyAndAdvance(0, action, inferAbstractChar(prevState, prevLegal, action));
    },
    [applyAndAdvance, phase],
  );

  // ---------- Driver effect: schedule AI turns (state transitions happen in event handlers) ----------
  useEffect(() => {
    if (phase !== 'playing' || !snap) return;
    if (snap.stage === 'handover' || snap.actor === null) return;
    if (snap.actor === 0) return;
    const seat = snap.actor;
    const base = 700 + Math.random() * 800;
    const t = setTimeout(() => {
      const g = stateRef.current;
      if (!g || g.actor !== seat || g.stage === 'handover') return;
      const agent = agentsRef.current.get(seat);
      if (!agent) return;
      const legal = getLegalActions(g);
      if (!legal) return;
      const decision = agent.decide({
        state: cloneState(g),
        legal,
        seat,
        seq: seqRef.current,
        rng: Math.random,
      });
      applyAndAdvance(seat, decision.action, decision.abstractChar ?? null, decision, agent);
    }, base / speedRef.current);
    timersRef.current.push(t);
    return () => {
      clearTimeout(t);
      timersRef.current = timersRef.current.filter((x) => x !== t);
    };
  }, [snap, phase, applyAndAdvance]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  return {
    phase,
    snap,
    humanTurn,
    log,
    insights,
    artifactMeta,
    stats,
    loadingError,
    speed,
    setSpeed,
    autoDeal,
    setAutoDeal,
    newHand,
    humanAct,
    actingSeat: phase === 'playing' && snap && snap.actor !== null ? snap.actor : null,
    lastActions,
  };
}
