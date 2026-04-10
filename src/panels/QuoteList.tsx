import { cn, tempColor, effectiveTemperature } from '@/lib/utils';
import { STATUS_LABELS, STRATEGIC_RANK_LABELS } from '@/lib/constants';
import type { Quote, Client } from '@/lib/database.types';

/** Drawer = group of quotes by priority bucket */
interface Drawer {
  key: string;
  label: string;
  quotes: (Quote & { client?: Client })[];
}

interface QuoteListProps {
  quotes: (Quote & { client?: Client })[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onModeChange?: (mode: 'quotes' | 'captures' | 'report') => void;
  mode?: 'quotes' | 'captures' | 'report';
  isLoading?: boolean;
  focusMode?: boolean;
}

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * 3-drawer bucketing:
 *  1. "לטפל עכשיו" — high temp, overdue follow-ups, forgotten quotes
 *  2. "מעקב שגרתי" — normal active quotes
 *  3. "הכדור אצל הלקוח" — waiting on client response
 */
function bucketQuotes(quotes: (Quote & { client?: Client })[], focusMode: boolean): Drawer[] {
  const actNow:  typeof quotes = [];
  const routine: typeof quotes = [];
  const waiting: typeof quotes = [];

  for (const q of quotes) {
    if (['won', 'lost', 'dormant'].includes(q.status)) continue;

    // Drawer 3: ball is in the client's court
    if (q.status === 'waiting') { waiting.push(q); continue; }

    // Drawer 1 criteria: high temp, follow-up status, overdue, or forgotten (stale)
    const overdueFollowUp = q.follow_up_date && q.follow_up_date < TODAY;
    const staleContact = (q.days_since_contact ?? 0) >= 4;
    const eff = effectiveTemperature(q.temperature, q.days_since_contact);
    const isHot = q.temperature >= 4 || eff >= 4;
    const isUrgent = isHot || q.status === 'follow_up' || overdueFollowUp || staleContact;

    if (isUrgent) {
      actNow.push(q);
    } else {
      routine.push(q);
    }
  }

  // Sort "act now" by effective temperature desc, then staleness desc
  actNow.sort((a, b) => {
    const aEff = effectiveTemperature(a.temperature, a.days_since_contact);
    const bEff = effectiveTemperature(b.temperature, b.days_since_contact);
    if (bEff !== aEff) return bEff - aEff;
    return (b.days_since_contact ?? 0) - (a.days_since_contact ?? 0);
  });

  // Focus mode: only top 3 in "act now", hide other drawers
  if (focusMode) {
    return [
      { key: 'act_now', label: 'לטפל עכשיו', quotes: actNow.slice(0, 3) },
    ];
  }

  return [
    { key: 'act_now', label: 'לטפל עכשיו',       quotes: actNow  },
    { key: 'routine', label: 'מעקב שגרתי',       quotes: routine },
    { key: 'waiting', label: 'הכדור אצל הלקוח',  quotes: waiting },
  ];
}

export default function QuoteList({ quotes, selectedId, onSelect, onModeChange, mode = 'quotes', isLoading = false, focusMode = false }: QuoteListProps) {
  const drawers = bucketQuotes(quotes, focusMode);

  return (
    <div className="flex h-full flex-col">
      {/* Mode tabs */}
      <div className="flex border-b border-(--color-border)">
        <button
          onClick={() => onModeChange?.('quotes')}
          className={cn(
            'flex-1 py-2.5 text-xs font-semibold transition-colors',
            mode === 'quotes'
              ? 'text-(--color-accent) border-b-2 border-(--color-accent)'
              : 'text-(--color-text-secondary) hover:text-(--color-text)',
          )}
        >
          הצעות מחיר
        </button>
        <button
          onClick={() => onModeChange?.('captures')}
          className={cn(
            'flex-1 py-2.5 text-xs font-semibold transition-colors',
            mode === 'captures'
              ? 'text-(--color-accent) border-b-2 border-(--color-accent)'
              : 'text-(--color-text-secondary) hover:text-(--color-text)',
          )}
        >
          אירועים
        </button>
        <button
          onClick={() => onModeChange?.('report')}
          className={cn(
            'flex-1 py-2.5 text-xs font-semibold transition-colors',
            mode === 'report'
              ? 'text-(--color-accent) border-b-2 border-(--color-accent)'
              : 'text-(--color-text-secondary) hover:text-(--color-text)',
          )}
        >
          דוח שבועי
        </button>
      </div>

      {/* Drawers */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-(--color-border)/30 animate-pulse" />
            ))}
          </div>
        ) : drawers.map((drawer) => (
          <div key={drawer.key}>
            <div className={cn(
              'sticky top-0 px-4 py-2 text-xs font-bold uppercase tracking-wide border-b border-(--color-border)/50',
              drawer.key === 'act_now'
                ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                : drawer.key === 'waiting'
                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400'
                  : 'bg-(--color-surface-dim) text-(--color-text-secondary)',
            )}>
              {drawer.label}
              <span className="mr-1 opacity-60">({drawer.quotes.length})</span>
            </div>
            {drawer.quotes.length === 0 ? (
              <div className="px-4 py-3 text-xs text-(--color-text-secondary)/50">אין הצעות</div>
            ) : (
              drawer.quotes.map((q) => (
                <button
                  key={q.id}
                  onClick={() => onSelect(q.id)}
                  className={cn(
                    'w-full px-4 py-3 text-right transition-colors border-b border-(--color-border)/30',
                    selectedId === q.id
                      ? 'bg-(--color-accent)/8'
                      : 'hover:bg-(--color-surface-dim)/60',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-(--color-text)">{q.quote_number}</span>
                      {q.strategic_rank && (
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded',
                          q.strategic_rank === 1 && 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                          q.strategic_rank === 2 && 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
                          q.strategic_rank === 3 && 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-400',
                        )}>
                          {STRATEGIC_RANK_LABELS[q.strategic_rank]}
                        </span>
                      )}
                    </div>
                    <span className={cn('text-xs font-bold', tempColor(q.temperature))}>
                      {'●'.repeat(q.temperature)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-(--color-text-secondary)">
                    {q.client?.code ?? '—'}
                    <span className="mx-1.5 text-(--color-border)">|</span>
                    <span>{STATUS_LABELS[q.status]}</span>
                    {q.days_since_contact != null && q.days_since_contact >= 4 && (
                      <span className="mr-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                        {q.days_since_contact}d
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
