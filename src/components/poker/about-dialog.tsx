'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Dices, Scale, BrainCircuit, Repeat, Info } from 'lucide-react';
import type { ArtifactMeta } from '@/hooks/use-poker-game';

const AGENTS = [
  {
    id: 'rule',
    name: 'Professor Rule',
    family: 'Rule-Based Expert System',
    icon: <BookOpen className="h-4 w-4" />,
    badge: 'border-emerald-500/40 text-emerald-300',
    math: 'strength ≥ potOdds + margin → call; strength > position threshold → raise',
    body: 'A hand-crafted expert system in the spirit of classical poker AI. At every decision it computes (1) hand strength — preflop from a precomputed 169-hand Monte Carlo equity table, postflop from the made-hand percentile of its 5-card best plus draw bonuses for flush and straight draws; (2) position — coarse class (EP/MP/LP/SB/BB) shifts its thresholds: early positions open ~4% tighter, late positions steal wider; (3) pot odds — the required equity toCall/(pot+toCall). It value-bets strong made hands, probes with medium strength, occasionally bluffs in position, and folds when its equity falls below the pot-odds hurdle. Deterministic, transparent, and exploitable — the perfect baseline.',
  },
  {
    id: 'montecarlo',
    name: 'The Simulator',
    family: 'Monte Carlo Estimation',
    icon: <Dices className="h-4 w-4" />,
    badge: 'border-rose-500/40 text-rose-300',
    math: 'P(win) ≈ (wins + ties/2) / N, N up to 1,500 rollouts per decision',
    body: 'Pure sampling-based decision making. For every decision it deals thousands of random opponent hole cards and community runouts from the unseen deck and directly measures how often it wins. The estimator comes with a standard error of √(p(1−p)/N), shown live in its insight panel. Decisions compare simulated equity against the pot-odds requirement plus a multiway safety margin — the same math as the rule bot, but with empirically measured strength instead of a lookup table. Draws are captured automatically because simulated runouts complete them.',
  },
  {
    id: 'cfr',
    name: 'The Game Theorist',
    family: 'Counterfactual Regret Minimization',
    icon: <Scale className="h-4 w-4" />,
    badge: 'border-amber-500/40 text-amber-300',
    math: 'R(I,a) += v(I,a) − Σ_b σ(I,b)·v(I,b);  σ = R⁺/ΣR⁺',
    body: 'Plays the average strategy profile from offline self-play by external-sampling Monte Carlo CFR. During training, each bot accumulates per-infoset counterfactual regrets — how much better it would have done by always taking action a instead of following its current mixed strategy σ — and repeatedly converts regrets into a new strategy via regret matching. The average of these strategies provably converges toward a Nash equilibrium of the abstracted game. The abstraction: 20 preflop / 10 postflop hand-strength buckets, 4 abstract actions (fold / check-call / half-pot / pot), 3 raises per street cap, betting patterns compressed to action counts. At the table the blueprint is sampled faithfully — its bluffs and thin value bets are genuine mixed-strategy draws, the closest thing to GTO play in this lineup.',
  },
  {
    id: 'deepcfr',
    name: 'The Deep Thinker',
    family: 'Deep CFR (miniature)',
    icon: <BrainCircuit className="h-4 w-4" />,
    badge: 'border-orange-500/40 text-orange-300',
    math: 'min_θ Σ ‖f_θ(features(I)) − adv(I)‖² over reservoir-sampled regrets',
    body: 'The Deep CFR architecture shrunk to run in your browser. Instead of storing a regret table per infoset, (state features, counterfactual advantage) pairs were reservoir-sampled during MCCFR traversals into a replay memory, and a small MLP (14 → 32 tanh → 4) was trained to predict the advantage of every action from 14 features (street, hand bucket, pot odds, pot-to-stack ratio, live players, position, raise availability). At the table the network prediction replaces the tabular regrets and feeds regret matching, producing the strategy. This is exactly how Deep CFR amortizes regret storage with a neural network — at 1/100,000th the scale of the research systems.',
  },
  {
    id: 'rl',
    name: 'The Self-Taught',
    family: 'Reinforcement Learning (Q-learning)',
    icon: <Repeat className="h-4 w-4" />,
    badge: 'border-teal-500/40 text-teal-300',
    math: 'Q(s_t,a_t) ← Q + α·(γ^(T−t)·R_hand − Q)',
    body: 'Tabular Q-learning over the same abstracted state space, trained purely by self-play: ε-greedy exploration against a fixed pool of rule-based, random, and CFR-blueprint opponents, with the terminal chip delta of each hand as reward, discounted (γ=0.9) and propagated backwards over its own decisions. No poker knowledge was hand-coded — thresholds for aggression, position awareness, and the discipline to fold trash emerged from hundreds of thousands of hands of trial and error. Its insight panel shows the raw Q-values it compares. The learning curve from training is in the RL badge on the stats bar.',
  },
];

export function AboutDialog({ artifactMeta }: { artifactMeta: ArtifactMeta }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100">
          <Info className="h-4 w-4 mr-1.5" /> The Five Bots
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-950 border-amber-500/20">
        <DialogHeader>
          <DialogTitle className="font-serif text-amber-100">Five Approaches to One Game</DialogTitle>
          <DialogDescription className="text-slate-400">
            Every seat at this table is a different family of poker AI — from hand-written heuristics to game-theoretic equilibrium
            approximation and reinforcement learning. All decisions run locally in your browser.
          </DialogDescription>
        </DialogHeader>
        <Accordion type="single" collapsible defaultValue="rule">
          {AGENTS.map((a, i) => (
            <AccordionItem key={a.id} value={a.id} className="border-white/10">
              <AccordionTrigger className="hover:no-underline">
                <span className="flex items-center gap-2.5">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-md border bg-slate-800 ${a.badge}`}>{a.icon}</span>
                  <span className="text-sm font-semibold text-slate-200">{a.name}</span>
                  <Badge variant="outline" className={`hidden sm:inline-flex text-[10px] font-normal ${a.badge}`}>
                    {a.family}
                  </Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-[13px] leading-relaxed text-slate-400 space-y-2">
                <p>{a.body}</p>
                <p className="font-mono text-[11px] text-amber-200/70 bg-slate-900 rounded px-2.5 py-1.5 border border-white/5">{a.math}</p>
                {i === 2 && artifactMeta.cfr && (
                  <p className="text-[11px] text-slate-500">
                    Training: {artifactMeta.cfr.iterations.toLocaleString()} iterations · {artifactMeta.cfr.seconds}s · {artifactMeta.cfr.infosets.toLocaleString()} infosets
                  </p>
                )}
                {i === 3 && artifactMeta.deepcfr && (
                  <p className="text-[11px] text-slate-500">
                    Training: {artifactMeta.deepcfr.samples.toLocaleString()} advantage samples · {artifactMeta.deepcfr.epochs} epochs · validation loss {artifactMeta.deepcfr.finalLoss}
                  </p>
                )}
                {i === 4 && artifactMeta.rl && (
                  <p className="text-[11px] text-slate-500">
                    Training: {artifactMeta.rl.episodes.toLocaleString()} episodes · avg reward {artifactMeta.rl.finalAvgReward} chips/hand vs the pool
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <p className="text-[11px] text-slate-500 leading-relaxed border-t border-white/10 pt-3">
          Game rules: No-Limit Texas Hold&apos;em, 6-max, 1000-chip stacks (100bb), blinds 5/10, rotating dealer button, min-raise
          rules, side pots, uncalled-bet returns and odd-chip splitting all enforced exactly by the engine. Auto-rebuy keeps the
          game flowing. Simulation only — no real money.
        </p>
      </DialogContent>
    </Dialog>
  );
}
