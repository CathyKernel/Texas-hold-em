'use client';

/**
 * Plain-language walkthrough of how a hand runs at this table, matching the
 * engine's actual behaviour (see src/lib/poker/engine.ts for the code).
 */
import { Card } from '@/components/ui/card';

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: '1 · Before the hand',
    items: [
      'The dealer button rotates one seat clockwise every hand.',
      'Small blind (5) and big blind (10) are posted by the two seats left of the button.',
      'Each player receives two private hole cards, dealt starting left of the button.',
    ],
  },
  {
    title: '2 · Betting rounds (streets)',
    items: [
      'Pre-flop: first to act is the seat after the big blind (UTG).',
      'Flop / Turn / River: first to act is the first live player left of the button.',
      'One card is burned before each community card deal (3 burn cards per full hand).',
      'A betting round ends when every live player has matched the largest wager or is all-in.',
      'The big blind gets an "option": if everyone merely calls pre-flop, the BB may still raise.',
    ],
  },
  {
    title: '3 · Bets and raises',
    items: [
      'Minimum raise = the size of the last raise or bet (initially one big blind).',
      'A raise below the minimum is legal only if it puts the player all-in.',
      'A short all-in raise does NOT re-open betting for players who have already acted.',
      'A full raise (at least the last raise size) re-opens betting for everyone.',
      'You cannot bet or raise when no opponent is able to call (everyone else folded or all-in).',
    ],
  },
  {
    title: '4 · End of the hand',
    items: [
      'If all but one player fold, the last player takes the pot with no showdown.',
      'Uncalled portion of the final bet is returned to its owner before the pot is awarded.',
      'At showdown, the best five-card hand out of each player\'s seven cards (2 hole + 5 community) wins.',
      'Side pots are layered by exact contribution: a player can only win chips they actually matched.',
      'Split pots divide evenly; an odd chip goes to the first winner left of the button.',
    ],
  },
  {
    title: '5 · Reading the table',
    items: [
      'The amber ring marks the seat currently acting; "thinking" indicates an AI running its decision algorithm.',
      'Chips in front of a seat show that street\'s bet; the pot chip counter includes all live bets.',
      'Hand-name badges appear at showdown next to each revealed hand.',
      'The Hand Log (first tab) narrates every event in order; AI Insights shows each bot\'s reasoning.',
    ],
  },
];

export function RulesHelp() {
  return (
    <div className="space-y-3">
      {SECTIONS.map((s) => (
        <Card key={s.title} className="border-white/8 bg-slate-900/60 p-3">
          <h3 className="text-[11px] font-bold text-amber-200/90 tracking-wide uppercase mb-1.5">{s.title}</h3>
          <ul className="space-y-1">
            {s.items.map((item, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-slate-400 flex gap-1.5">
                <span className="text-slate-600 shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <p className="text-[10px] text-slate-600 italic px-1">
        All of these rules are asserted by an automated test suite (scripts/test-rules-audit.ts, 6,000+ checks) that ships with this project.
      </p>
    </div>
  );
}
