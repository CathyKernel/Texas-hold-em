'use client';

import { cn } from '@/lib/utils';
import type { InsightEntry, ArtifactMeta } from '@/hooks/use-poker-game';
import { BookOpen, Dices, Scale, BrainCircuit, Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const AGENT_STYLE: Record<string, { icon: React.ReactNode; badge: string }> = {
  rule: { icon: <BookOpen className="h-4 w-4" />, badge: 'border-emerald-500/40 text-emerald-300' },
  montecarlo: { icon: <Dices className="h-4 w-4" />, badge: 'border-rose-500/40 text-rose-300' },
  cfr: { icon: <Scale className="h-4 w-4" />, badge: 'border-amber-500/40 text-amber-300' },
  deepcfr: { icon: <BrainCircuit className="h-4 w-4" />, badge: 'border-orange-500/40 text-orange-300' },
  rl: { icon: <Repeat className="h-4 w-4" />, badge: 'border-teal-500/40 text-teal-300' },
};

function formatMetric(k: string, v: number): string {
  if (['equity', 'requiredEquity', 'stdErr', 'strength'].includes(k)) return `${k}: ${(v * 100).toFixed(1)}%`;
  if (k === 'sims') return `${v.toLocaleString()} rollouts`;
  return `${k}: ${v % 1 === 0 ? v.toLocaleString() : v.toFixed(2)}`;
}

const METRIC_ORDER = ['equity', 'stdErr', 'sims', 'requiredEquity', 'opponents', 'strength', 'bucket', 'pot'];

function MetricChips({ metrics }: { metrics: Record<string, number> }) {
  const keys = Object.keys(metrics).sort((a, b) => {
    const ia = METRIC_ORDER.indexOf(a);
    const ib = METRIC_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return (
    <div className="flex flex-wrap gap-1">
      {keys.slice(0, 6).map((k) => (
        <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-white/5">
          {formatMetric(k, metrics[k])}
        </span>
      ))}
    </div>
  );
}

function ProbBars({ probs }: { probs: { label: string; p: number }[] }) {
  return (
    <div className="space-y-1">
      {probs.map((p) => (
        <div key={p.label} className="flex items-center gap-2">
          <span className="text-[10px] w-[76px] text-slate-400 text-right shrink-0 truncate">{p.label}</span>
          <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden border border-white/5">
            <div
              className={cn(
                'h-full rounded-full',
                p.label === 'Fold' ? 'bg-red-500/70' : p.label.includes('Call') ? 'bg-emerald-500/70' : 'bg-amber-500/70',
              )}
              style={{ width: `${Math.max(1, p.p * 100)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-300 w-[34px]">{(p.p * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

export function InsightPanel({
  insights,
  artifactMeta,
  activeSeat,
}: {
  insights: Record<number, InsightEntry>;
  artifactMeta: ArtifactMeta;
  activeSeat: number | null;
}) {
  const seats = [1, 2, 3, 4, 5];
  return (
    <div className="space-y-2.5">
      {/* Training credentials */}
      <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
        {artifactMeta.cfr && (
          <Badge variant="outline" className="border-amber-500/30 text-amber-200/80 font-normal">
            CFR · {artifactMeta.cfr.iterations.toLocaleString()} MCCFR iterations · {artifactMeta.cfr.infosets.toLocaleString()} infosets
          </Badge>
        )}
        {artifactMeta.deepcfr && (
          <Badge variant="outline" className="border-orange-500/30 text-orange-200/80 font-normal">
            Deep CFR · {artifactMeta.deepcfr.samples.toLocaleString()} samples · val loss {artifactMeta.deepcfr.finalLoss}
          </Badge>
        )}
        {artifactMeta.rl && (
          <Badge variant="outline" className="border-teal-500/30 text-teal-200/80 font-normal">
            RL · {artifactMeta.rl.episodes.toLocaleString()} episodes · {artifactMeta.rl.states.toLocaleString()} states
          </Badge>
        )}
      </div>

      {seats.map((seat) => {
        const ins = insights[seat];
        const style = AGENT_STYLE[ins?.type ?? ['rule', 'montecarlo', 'cfr', 'deepcfr', 'rl'][seat - 1]];
        const isActive = activeSeat === seat;
        return (
          <div
            key={seat}
            className={cn(
              'rounded-lg border p-2.5 bg-slate-900/60 transition-colors',
              isActive ? 'border-amber-400/50 bg-slate-900/90' : 'border-white/8',
            )}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-md border bg-slate-800', style.badge)}>{style.icon}</span>
              <span className="text-xs font-semibold text-slate-200 truncate">{ins?.name ?? ['Professor Rule', 'The Simulator', 'The Game Theorist', 'The Deep Thinker', 'The Self-Taught'][seat - 1]}</span>
              {isActive && <span className="ml-auto text-[9px] text-amber-300 animate-pulse">● DECIDING</span>}
            </div>
            {ins ? (
              <>
                <p className="text-[11px] leading-relaxed text-slate-400 mb-1.5 line-clamp-4">{ins.rationale}</p>
                {ins.probs && ins.probs.length > 0 && <ProbBars probs={ins.probs} />}
                {ins.metrics && <div className="mt-1.5">{<MetricChips metrics={ins.metrics} />}</div>}
              </>
            ) : (
              <p className="text-[11px] text-slate-600 italic">Awaiting its first decision this hand…</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
