'use client';

import { usePokerGame } from '@/hooks/use-poker-game';
import { PokerTable } from '@/components/poker/poker-table';
import { ActionBar } from '@/components/poker/action-bar';
import { InsightPanel } from '@/components/poker/insight-panel';
import { HandLog } from '@/components/poker/hand-log';
import { StreetProgress } from '@/components/poker/street-progress';
import { RulesHelp } from '@/components/poker/rules-help';
import { AboutDialog } from '@/components/poker/about-dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spade, Zap, Gauge, Coins, Trophy, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Home() {
  const game = usePokerGame();
  const { phase, snap, humanTurn, actingSeat } = game;
  const actingName = snap && actingSeat !== null && actingSeat !== 0 ? snap.players[actingSeat].name : null;
  const winRate = game.stats.hands > 0 ? (game.stats.wins / game.stats.hands) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col casino-bg text-slate-200">
      <header className="border-b border-white/5 bg-slate-950/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-600 text-slate-950 shadow-lg shrink-0">
              <Spade className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-lg sm:text-xl font-bold text-amber-100 leading-tight truncate">GTO Poker Lab</h1>
              <p className="text-[10px] sm:text-[11px] text-slate-500 leading-tight">No-Limit Hold&apos;em · 6-max · 5 AI paradigms</p>
            </div>
          </div>

          <div className="flex-1" />

          {/* Stats */}
          <div className="hidden md:flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Layers className="h-3.5 w-3.5 text-slate-500" /> Hand <b className="text-slate-200 font-mono">{snap?.handNo ?? 0}</b>
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <Coins className="h-3.5 w-3.5 text-amber-400" /> Stack <b className="text-amber-200 font-mono">{(snap?.players[0].stack ?? 1000).toLocaleString()}</b>
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <Zap className="h-3.5 w-3.5 text-slate-500" /> Net{' '}
              <b className={cn('font-mono', game.stats.net >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                {game.stats.net >= 0 ? '+' : ''}
                {game.stats.net.toLocaleString()}
              </b>
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <Trophy className="h-3.5 w-3.5 text-yellow-500" /> <b className="text-slate-200 font-mono">{winRate.toFixed(0)}%</b> won
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 mr-1">
              <Gauge className="h-3.5 w-3.5" />
              {[1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => game.setSpeed(s)}
                  className={cn(
                    'px-2 py-0.5 rounded font-mono text-[11px] border transition-colors',
                    game.speed === s ? 'border-amber-400 bg-amber-500/20 text-amber-200' : 'border-white/10 text-slate-500 hover:text-slate-300',
                  )}
                  aria-label={`${s}x speed`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
              <span>Auto</span>
              <Switch checked={game.autoDeal} onCheckedChange={game.setAutoDeal} aria-label="auto-deal next hand" />
            </div>
            <AboutDialog artifactMeta={game.artifactMeta} />
            <Button
              size="sm"
              className="bg-gradient-to-b from-amber-400 to-amber-600 text-slate-950 hover:from-amber-300 hover:to-amber-500 font-bold shadow-lg"
              onClick={game.newHand}
              disabled={phase === 'loading' || phase === 'playing'}
            >
              {phase === 'handover' ? 'Deal Next Hand' : phase === 'ready' ? 'Deal Hand' : '…'}
            </Button>
          </div>
        </div>
      </header>

      {game.loadingError && (
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 pt-2">
          <p className="text-[11px] text-rose-300/80 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-1.5">{game.loadingError}</p>
        </div>
      )}

      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex flex-col gap-3 min-w-0">
          {/* Street-by-street progress — the spine of the whole hand */}
          {snap && <StreetProgress state={snap} phase={phase} />}

          {phase === 'loading' || !snap ? (
            <div className="aspect-[16/10] min-h-[380px] max-h-[560px] rounded-2xl border border-white/5 bg-slate-900/40 flex flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin" />
              <p className="text-sm text-slate-500">Loading AI brains — CFR blueprint, Deep CFR network, RL policy…</p>
            </div>
          ) : (
            <PokerTable state={snap} phase={phase} actingSeat={actingSeat} humanTurn={humanTurn} lastActions={game.lastActions} />
          )}
          {snap && <ActionBar state={snap} humanTurn={humanTurn && phase === 'playing'} onAct={game.humanAct} actingName={actingName} />}
        </section>

        <aside className="min-w-0">
          <Tabs defaultValue="log" className="h-full">
            <TabsList className="grid grid-cols-3 w-full bg-slate-900/60">
              <TabsTrigger value="log">Hand Log</TabsTrigger>
              <TabsTrigger value="insights">AI Insights</TabsTrigger>
              <TabsTrigger value="rules">Rules</TabsTrigger>
            </TabsList>
            <TabsContent value="log" className="mt-2">
              <Card className="border-white/8 bg-slate-950/50">
                <CardHeader className="py-3 px-3">
                  <CardTitle className="text-xs font-semibold text-slate-400 tracking-wide uppercase">
                    Hand history — every action, in order
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="h-[62vh] overflow-y-auto log-scroll pr-1">
                    <HandLog log={game.log} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="insights" className="mt-2">
              <Card className="border-white/8 bg-slate-950/50">
                <CardHeader className="py-3 px-3">
                  <CardTitle className="text-xs font-semibold text-slate-400 tracking-wide uppercase">Live decision transparency</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="max-h-[62vh] overflow-y-auto log-scroll pr-1">
                    <InsightPanel insights={game.insights} artifactMeta={game.artifactMeta} activeSeat={actingSeat} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="rules" className="mt-2">
              <Card className="border-white/8 bg-slate-950/50">
                <CardHeader className="py-3 px-3">
                  <CardTitle className="text-xs font-semibold text-slate-400 tracking-wide uppercase">How this table runs</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="max-h-[62vh] overflow-y-auto log-scroll pr-1">
                    <RulesHelp />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </aside>
      </main>

      <footer className="mt-auto border-t border-white/5 bg-slate-950/70">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span>Simulation only — no real money.</span>
          <span className="hidden sm:inline">Engine: strict NLHE rules (side pots, min-raise, uncalled bets, odd-chip splits).</span>
          <Badge variant="outline" className="ml-auto text-[9px] border-white/10 text-slate-500 font-mono">
            NL10 · 100bb · auto-rebuy
          </Badge>
        </div>
      </footer>
    </div>
  );
}
