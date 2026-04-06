import { cn, tempColor } from '@/lib/utils';
import { STATUS_LABELS } from '@/lib/constants';
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
  onModeChange?: (mode: 'quotes' | 'report') => void;
  mode?: 'quotes' | 'report';
  isLoading?: boolean;
}

const TODAY = new Date().toISOString().slice(0, 10);

function bucketQuotes(quotes: (Quote & { client?: Client })[]): Drawer[] {
  const urgent:    typeof quotes = [];
  const forgotten: typeof quotes = [];
  const routine:   typeof quotes = [];
  const waiting:   typeof quotes = [];

  for (const q of quotes) {
    if (['won', 'lost', 'dormant'].includes(q.status)) continue;

    // "Waiting on them" — ball is in the client's court
    if (q.status === 'waiting') { waiting.push(q); continue; }

    // Overdue follow-up or ≥4 days without contact → forgotten
    const overdueFollowUp = q.follow_up_date && q.follow_up_date < TODAY;
    const staleContact    = (q.days_since_contact ?? 0) >= 4;
    const isForgotten     = (overdueFollowUp || staleContact) && q.temperature < 4 && q.status !== 'follow_up';

    if (q.temperature >= 4 || q.status === 'follow_up') {
      urgent.push(q);
    } else if (isForgotten) {
      forgotten.push(q);
    } else {
      routine.push(q);
    }
  }

  // Sort forgotten by staleness (most neglected first)
  forgotten.sort((a, b) => (b.days_since_contact ?? 0) - (a.days_since_contact ?? 0));

  return [
    { key: 'urgent',    label: 'לטפל עכשיו',   quotes: urgent    },
    { key: 'forgotten', label: 'נשכחו',         quotes: forgotten },
    { key: 'routine',   label: 'מעקב שגרתי',   quotes: routine   },
    { key: 'waiting',   label: 'הכדור אצלם',   quotes: waiting   },
  ];
}

export default function QuoteList({ quotes, selectedId, onSelect, onModeChange, mode = 'quotes', isLoading = false }: QuoteListProps) {
  const drawers = bucketQuotes(quotes);

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
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-(--color-border)/30 animate-pulse" />
            ))}
          </div>
        ) : drawers.map((drawer) => (
          <div key={drawer.key}>
            <div className={cn(
              'sticky top-0 px-4 py-2 text-xs font-bold uppercase tracking-wide border-b border-(--color-border)/50',
              drawer.key === 'forgotten'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
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
                    <span className="text-sm font-semibold text-(--color-text)">{q.quote_number}</span>
                    <span className={cn('text-xs font-bold', tempColor(q.temperature))}>
                      {'●'.repeat(q.temperature)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-(--color-text-secondary)">
                    {q.client?.code ?? '—'}
                    <span className="mx-1.5 text-(--color-border)">|</span>
                    <span>{STATUS_LABELS[q.status]}</span>
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
