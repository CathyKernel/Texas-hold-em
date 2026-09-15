'use client';

import { useEffect, useRef } from 'react';
import type { LogLine } from '@/hooks/use-poker-game';
import { cn } from '@/lib/utils';

export function HandLog({ log }: { log: LogLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [log.length]);
  return (
    <div className="h-full overflow-y-auto pr-1 log-scroll">
      <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
        {log.length === 0 && <p className="text-slate-600 italic p-2">The hand history will appear here…</p>}
        {log.map((line) => (
          <p
            key={line.id}
            className={cn(
              'px-1.5 py-0.5 rounded',
              line.kind === 'action' && 'text-slate-400',
              line.kind === 'street' && 'text-amber-300/90 bg-amber-500/5 font-semibold',
              line.kind === 'system' && 'text-slate-500',
              line.kind === 'showdown' && 'text-violet-300/90 font-semibold bg-violet-500/5',
              line.kind === 'award' && 'text-yellow-300 font-semibold bg-yellow-500/5',
            )}
          >
            {line.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
