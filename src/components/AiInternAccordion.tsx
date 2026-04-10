import { useState } from 'react';
import { cn, tempColor, timeAgo, tempLabel } from '@/lib/utils';
import { STATUS_LABELS, STRATEGIC_RANK_LABELS } from '@/lib/constants';
import { useRefreshSummary, useLogTelemetry } from '@/lib/data';
import type { Quote, Client } from '@/lib/database.types';

interface AiInternAccordionProps {
  quotes: (Quote & { client?: Client })[];
  onFocusQuote: (id: string) => void;
}

/**
 * AI Intern: Accordion view showing AI-generated one-liner summaries
 * for each active quote. Click to expand for full details + drill-down.
 */
export default function AiInternAccordion({ quotes, onFocusQuote }: AiInternAccordionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refreshSummary = useRefreshSummary();
  const logTelemetry = useLogTelemetry();

  /** Expand/collapse with telemetry tracking */
  function toggleExpand(quoteId: string, temperature: number) {
    const wasExpanded = expandedId === quoteId;
    setExpandedId(wasExpanded ? null : quoteId);
    logTelemetry.mutate({
      quoteId,
      action: wasExpanded ? 'collapse' : 'expand',
      metadata: { temperature },
    });
  }

  const activeQuotes = quotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status));

  if (activeQuotes.length === 0) return null;

  // Sort by strategic rank (1 first), then temperature desc
  const sorted = [...activeQuotes].sort((a, b) => {
    const aRank = a.strategic_rank ?? 99;
    const bRank = b.strategic_rank ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return b.temperature - a.temperature;
  });

  return (
    <div className="border-b border-(--color-border)">
      <div className="px-6 py-2 flex items-center justify-between">
        <span className="text-xs font-bold text-(--color-text-secondary)">סיכום AI</span>
        <button
          onClick={() => refreshSummary.mutate({ batch: true })}
          disabled={refreshSummary.isPending}
          className="text-[10px] text-(--color-accent) hover:text-(--color-accent)/80 disabled:opacity-40"
        >
          {refreshSummary.isPending ? 'מעדכן...' : 'רענן הכל'}
        </button>
      </div>
      <div className="divide-y divide-(--color-border)/30">
        {sorted.map((q) => {
          const isExpanded = expandedId === q.id;
          const hasSummary = !!q.ai_summary;

          return (
            <div key={q.id}>
              {/* Collapsed row: one-liner */}
              <button
                onClick={() => toggleExpand(q.id, q.temperature)}
                className="w-full px-6 py-2.5 text-right flex items-center gap-3 hover:bg-(--color-surface-dim)/60 transition-colors"
              >
                <span className={cn('text-xs font-bold shrink-0', tempColor(q.temperature))}>
                  {'●'.repeat(Math.min(q.temperature, 5))}
                </span>
                <span className="text-xs font-semibold text-(--color-text) shrink-0">{q.quote_number}</span>
                {q.strategic_rank && (
                  <span className={cn(
                    'text-[9px] font-bold px-1 py-0.5 rounded shrink-0',
                    q.strategic_rank === 1 && 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                    q.strategic_rank === 2 && 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
                    q.strategic_rank === 3 && 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-400',
                  )}>
                    {STRATEGIC_RANK_LABELS[q.strategic_rank]}
                  </span>
                )}
                <span className="flex-1 text-xs text-(--color-text-secondary) truncate text-right">
                  {hasSummary ? q.ai_summary : `${q.client?.code ?? '—'} — ${STATUS_LABELS[q.status]}`}
                </span>
                <span className="text-[10px] text-(--color-text-secondary)/40 shrink-0">
                  {isExpanded ? '▲' : '▼'}
                </span>
              </button>

              {/* Expanded: drill-down */}
              {isExpanded && (
                <div className="px-6 pb-3 pt-1 space-y-2 bg-(--color-surface-dim)/40 animate-fade-in">
                  {/* AI summary with refresh */}
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <p className="text-sm text-(--color-text)">
                        {q.ai_summary ?? 'לא נוצר סיכום עדיין'}
                      </p>
                      {q.ai_summary_at && (
                        <p className="text-[10px] text-(--color-text-secondary)/40 mt-0.5">
                          עודכן {timeAgo(q.ai_summary_at)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        refreshSummary.mutate({ quoteId: q.id });
                        logTelemetry.mutate({ quoteId: q.id, action: 'refresh', metadata: { temperature: q.temperature } });
                      }}
                      disabled={refreshSummary.isPending}
                      className="text-[10px] text-(--color-accent) hover:text-(--color-accent)/80 disabled:opacity-40 shrink-0"
                    >
                      רענן
                    </button>
                  </div>

                  {/* Quick meta */}
                  <div className="flex flex-wrap gap-3 text-xs text-(--color-text-secondary)">
                    <span>לקוח: {q.client?.code ?? '—'}</span>
                    <span>טמפרטורה: {tempLabel(q.temperature)}</span>
                    <span>סטטוס: {STATUS_LABELS[q.status]}</span>
                    {q.days_since_contact != null && (
                      <span className={q.days_since_contact > 4 ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
                        {q.days_since_contact} ימים ללא קשר
                      </span>
                    )}
                  </div>

                  {/* Drill-down button */}
                  <button
                    onClick={() => {
                      logTelemetry.mutate({ quoteId: q.id, action: 'drill_down', metadata: { temperature: q.temperature, status: q.status } });
                      onFocusQuote(q.id);
                    }}
                    className="text-xs font-semibold text-(--color-accent) hover:text-(--color-accent)/80 transition-colors"
                  >
                    פתח הצעה מלאה
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
