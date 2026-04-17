import { useState } from 'react';
import { cn, tempColor, effectiveTemperature, fmtDate, timeAgo, computePriorityScore, deriveNextCallTopic } from '@/lib/utils';
import { STATUS_LABELS, STATUS_COLORS, STRATEGIC_RANK_LABELS } from '@/lib/constants';
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
  onCreateNew?: () => void;
  // [Req #39] - Search integration
  searchActive?: boolean;
  // [Req #40] - Filter integration
  filterActive?: boolean;
  onToggleFilters?: () => void;
}

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * 3-drawer bucketing:
 * 1. "לטפל עכשיו" — high temp, overdue follow-ups, forgotten quotes
 * 2. "מעקב שגרתי" — normal active quotes
 * 3. "הכדור אצל הלקוח" — waiting on client response
 */
function bucketQuotes(quotes: (Quote & { client?: Client })[], focusMode: boolean): Drawer[] {
  const actNow:  typeof quotes = [];
  const routine: typeof quotes = [];
  const waiting: typeof quotes = [];
  // [Req #113] Far-deferred quotes go to "Future" tab
  const future:  typeof quotes = [];
  // [Req #119] Logistics sub-funnel (in_production / shipped)
  const logistics: typeof quotes = [];
  // [Req #108] Internal pending — stuck waiting on our side
  const internalPending: typeof quotes = [];
  // [Req #139] Leads pipeline — pre-sale separated from formal quotes
  const leads: typeof quotes = [];

  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const futureThreshold = thirtyDaysFromNow.toISOString().slice(0, 10);

  for (const q of quotes) {
    if (['won', 'lost', 'dormant'].includes(q.status)) continue;

    // [Req #139] Leads go to separate pipeline
    if (q.is_lead) { leads.push(q); continue; }

    // [Req #119] Logistics funnel — separate from sales pipeline
    if (q.status === 'in_production' || q.status === 'shipped') { logistics.push(q); continue; }

    // [Req #113] Future tab — follow-up > 30 days out
    if (q.follow_up_date && q.follow_up_date > futureThreshold) { future.push(q); continue; }

    // [Req #108] Internal pending — waiting status + last direction was "push" (we initiated)
    if (q.status === 'waiting' && (q.days_since_contact ?? 0) >= 3) {
      internalPending.push(q); continue;
    }

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

  // [Req #12, #81] Sort "act now" by weighted priority score desc
  actNow.sort((a, b) => {
    const aScore = computePriorityScore(a.temperature, a.days_since_contact, a.strategic_rank, a.client?.is_vip ?? false, a.follow_up_date, a.status);
    const bScore = computePriorityScore(b.temperature, b.days_since_contact, b.strategic_rank, b.client?.is_vip ?? false, b.follow_up_date, b.status);
    return bScore - aScore;
  });

  // Focus mode: only top 3 in "act now", hide other drawers
  if (focusMode) {
    return [
      { key: 'act_now', label: 'לטפל עכשיו', quotes: actNow.slice(0, 3) },
    ];
  }

  const drawers: Drawer[] = [
    { key: 'act_now', label: 'לטפל עכשיו',           quotes: actNow  },
    { key: 'routine', label: 'מעקב שגרתי',           quotes: routine },
    { key: 'waiting', label: 'הכדור אצל הלקוח',      quotes: waiting },
  ];

  // [Req #108] Only show internal pending if non-empty
  if (internalPending.length > 0) {
    drawers.push({ key: 'internal_pending', label: 'ממתין פנימי', quotes: internalPending });
  }
  // [Req #119] Only show logistics if non-empty
  if (logistics.length > 0) {
    drawers.push({ key: 'logistics', label: 'לוגיסטיקה (ייצור/משלוח)', quotes: logistics });
  }
  // [Req #113] Only show future if non-empty
  if (future.length > 0) {
    drawers.push({ key: 'future', label: 'עתידי (30+ יום)', quotes: future });
  }
  // [Req #139] Only show leads if non-empty — separate pre-sale pipeline
  if (leads.length > 0) {
    drawers.push({ key: 'leads', label: 'לידים (Pre-Sale)', quotes: leads });
  }

  return drawers;
}

export default function QuoteList({
  quotes,
  selectedId,
  onSelect,
  onModeChange,
  mode = 'quotes',
  isLoading = false,
  focusMode = false,
  onCreateNew,
  searchActive = false,
  filterActive = false,
  onToggleFilters,
}: QuoteListProps) {
  const drawers = bucketQuotes(quotes, focusMode);
  // [Req #76] - Track hovered card for hover actions
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Mode tabs + Create button */}
      <div className="flex items-center border-b border-(--color-border)">
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
        {/* [Req #40] - Filter toggle button */}
        {onToggleFilters && mode === 'quotes' && (
          <button
            onClick={onToggleFilters}
            className={cn(
              'shrink-0 mx-0.5 rounded-md px-1.5 py-1.5 text-xs transition-colors',
              filterActive
                ? 'text-(--color-accent) bg-(--color-accent)/10'
                : 'text-(--color-text-secondary) hover:text-(--color-text)',
            )}
            title="סינון מתקדם"
          >
            ⫶
          </button>
        )}
        {/* Create new quote — always visible */}
        {onCreateNew && (
          <button
            onClick={onCreateNew}
            className="shrink-0 mx-1 rounded-md px-2 py-1.5 text-sm font-bold text-(--color-accent) hover:bg-(--color-accent)/10 transition-colors"
            title="צור הצעה חדשה"
          >
            +
          </button>
        )}
      </div>

      {/* Drawers / Content Area */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-(--color-border)/30 animate-pulse" />
            ))}
          </div>
        ) : mode === 'quotes' ? (
          // [Req #39] - When searching, show flat list instead of drawers
          searchActive ? (
            <div>
              <div className="sticky top-0 px-4 py-2 text-xs font-bold text-(--color-text-secondary) bg-(--color-surface-dim) border-b border-(--color-border)/50">
                תוצאות חיפוש
                <span className="mr-1 opacity-60">({quotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status)).length})</span>
              </div>
              {quotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status)).length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-(--color-text-secondary)/50">
                  לא נמצאו תוצאות
                </div>
              ) : (
                quotes
                  .filter((q) => !['won', 'lost', 'dormant'].includes(q.status))
                  .map((q) => (
                    <RichQuoteCard
                      key={q.id}
                      quote={q}
                      isSelected={selectedId === q.id}
                      isHovered={hoveredId === q.id}
                      onSelect={() => onSelect(q.id)}
                      onHover={(h) => setHoveredId(h ? q.id : null)}
                    />
                  ))
              )}
            </div>
          ) : (
            drawers.map((drawer) => (
              <div key={drawer.key}>
                <div className={cn(
                  'sticky top-0 px-4 py-2 text-xs font-bold uppercase tracking-wide border-b border-(--color-border)/50',
                  drawer.key === 'act_now'
                    ? 'bg-red-950/20 text-red-400 light:bg-red-50 light:text-red-700'
                    : drawer.key === 'waiting'
                      ? 'bg-sky-950/20 text-sky-400 light:bg-sky-50 light:text-sky-700'
                      // [Req #108] Internal pending — amber
                      : drawer.key === 'internal_pending'
                        ? 'bg-amber-950/20 text-amber-400 light:bg-amber-50 light:text-amber-700'
                        // [Req #119] Logistics — violet
                        : drawer.key === 'logistics'
                          ? 'bg-violet-950/20 text-violet-400 light:bg-violet-50 light:text-violet-700'
                          // [Req #113] Future — muted
                          : drawer.key === 'future'
                            ? 'bg-zinc-800/20 text-zinc-500 light:bg-zinc-50 light:text-zinc-500'
                            // [Req #139] Leads — cyan
                            : drawer.key === 'leads'
                              ? 'bg-cyan-950/20 text-cyan-400 light:bg-cyan-50 light:text-cyan-700'
                              : 'bg-(--color-surface-dim) text-(--color-text-secondary)',
                )}>
                  {drawer.label}
                  <span className="mr-1 opacity-60">({drawer.quotes.length})</span>
                </div>
                {drawer.quotes.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-(--color-text-secondary)/50">אין הצעות</div>
                ) : (
                  drawer.quotes.map((q) => (
                    <RichQuoteCard
                      key={q.id}
                      quote={q}
                      isSelected={selectedId === q.id}
                      isHovered={hoveredId === q.id}
                      onSelect={() => onSelect(q.id)}
                      onHover={(h) => setHoveredId(h ? q.id : null)}
                    />
                  ))
                )}
              </div>
            ))
          )
        ) : mode === 'captures' ? (
          <div className="p-6 text-center text-(--color-text-secondary) text-sm">
            <p className="font-bold mb-2">יומן אירועים מתגלגל</p>
            כאן יוצגו האירועים והתיעוד השוטף (Rolling Log).
          </div>
        ) : (
          <div className="p-6 text-center text-(--color-text-secondary) text-sm">
            מעבר לדוח המנכ"ל...
          </div>
        )}

        {/* Zero-state: create button when no quotes exist */}
        {mode === 'quotes' && !isLoading && quotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status)).length === 0 && !searchActive && onCreateNew && (
          <div className="p-6 text-center">
            <p className="text-xs text-(--color-text-secondary)/50 mb-3">אין הצעות פעילות</p>
            <button
              onClick={onCreateNew}
              className="rounded-lg bg-(--color-accent) px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
            >
              צור הצעה חדשה
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rich Quote Card with hover actions ──────────────────────────────────────

interface RichQuoteCardProps {
  quote: Quote & { client?: Client };
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
}

// [Req #76, #40] - Rich card with more metadata + hover actions
function RichQuoteCard({ quote, isSelected, isHovered, onSelect, onHover }: RichQuoteCardProps) {
  const q = quote;
  const eff = effectiveTemperature(q.temperature, q.days_since_contact);
  const isOverdue = q.follow_up_date && q.follow_up_date < TODAY;
  const isStale = (q.days_since_contact ?? 0) >= 4;
  // [Req #142] Visual distinction for archived/closed results
  const isArchived = ['won', 'lost', 'dormant'].includes(q.status);

  // [Req #275] Visual degradation — compute opacity based on quote age
  const quoteAgeDays = Math.floor(
    (Date.now() - new Date(q.opened_at).getTime()) / 86_400_000,
  );
  const fadeOpacity = quoteAgeDays >= 60 ? 0.45 : quoteAgeDays >= 30 ? 0.6 : quoteAgeDays >= 14 ? 0.8 : 1;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ opacity: isSelected ? 1 : fadeOpacity }} // [Req #275] visual degradation
      className={cn(
        'w-full px-4 py-3 text-right transition-all border-b border-(--color-border)/30 relative group',
        isSelected
          ? 'bg-(--color-accent)/8'
          : 'hover:bg-(--color-surface-dim)/60 hover:opacity-100!',
      )}
    >
      {/* Row 1: Quote number + rank + temperature */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-(--color-text)">{q.quote_number}</span>
          {/* [Req #142] Archive badge for closed/old results */}
          {isArchived && (
            <span className="rounded bg-zinc-800 light:bg-zinc-200 px-1 py-0.5 text-[8px] font-bold text-zinc-400 light:text-zinc-500 uppercase">
              ארכיון
            </span>
          )}
          {q.strategic_rank && (
            <span className={cn(
              'text-[10px] font-bold px-1.5 py-0.5 rounded',
              q.strategic_rank === 1 && 'bg-red-950/40 text-red-300 light:bg-red-100 light:text-red-700',
              q.strategic_rank === 2 && 'bg-orange-950/40 text-orange-300 light:bg-orange-100 light:text-orange-700',
              q.strategic_rank === 3 && 'bg-zinc-800/40 text-zinc-400 light:bg-zinc-100 light:text-zinc-600',
            )}>
              {STRATEGIC_RANK_LABELS[q.strategic_rank]}
            </span>
          )}
          {/* [Req #76] - VIP badge on card */}
          {q.client?.is_vip && (
            <span className="text-[10px] font-bold text-amber-500">VIP</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* [Req #76] - Status badge on card */}
          <span className={cn(
            'text-[10px] font-bold rounded-full px-1.5 py-0.5',
            STATUS_COLORS[q.status],
          )}>
            {STATUS_LABELS[q.status]}
          </span>
          {/* Temperature dots — effective temp shown */}
          <span className={cn('text-xs font-bold', tempColor(eff))}>
            {'●'.repeat(eff)}
            {eff < q.temperature && (
              <span className="text-(--color-text-secondary)/20">{'●'.repeat(q.temperature - eff)}</span>
            )}
          </span>
        </div>
      </div>

      {/* Row 2: Client code + meta info */}
      <div className="mt-1 flex items-center gap-1.5 text-xs text-(--color-text-secondary)">
        <span className="font-medium">{q.client?.code ?? '—'}</span>
        {/* [Req #118] Passive age indicator — always visible as faded time badge */}
        <span className={cn(
          'text-[10px] font-medium',
          quoteAgeDays >= 30 ? 'text-red-400/60 light:text-red-500/60' : 'text-(--color-text-secondary)/40',
        )}>
          {timeAgo(q.opened_at)}
        </span>
        {/* [Req #76] - Staleness warning */}
        {isStale && (
          <span className="text-amber-400 light:text-amber-600 font-semibold">
            {q.days_since_contact}d
          </span>
        )}
        {/* [Req #76, #136] - Overdue follow-up indicator with dragged-task hourglass */}
        {isOverdue && (
          <span className="text-red-400 light:text-red-600 font-semibold text-[10px] flex items-center gap-0.5">
            <span className="animate-pulse">⏳</span> איחור
          </span>
        )}
        {/* [Req #76] - Follow-up date on card */}
        {q.follow_up_date && !isOverdue && (
          <span className="text-[10px] text-(--color-text-secondary)/50">
            {fmtDate(q.follow_up_date)}
          </span>
        )}
      </div>

      {/* [Req #5] Row 3: Next call topic */}
      <div className="mt-0.5 flex items-center gap-1">
        <span className="text-[10px] text-(--color-accent)/70 font-semibold truncate">
          {deriveNextCallTopic(q.status, q.temperature, q.days_since_contact, q.follow_up_date, q.sales_ammo, q.loss_reason, q.ai_summary)}
        </span>
        {/* [Req #213] Urgency + Impact dual-axis indicator */}
        {q.strategic_rank && q.strategic_rank <= 2 && eff >= 3 && (
          <span className={cn(
            'shrink-0 text-[9px] font-bold rounded px-1 py-0.5',
            q.strategic_rank === 1 && eff >= 4
              ? 'bg-red-950/40 text-red-300 light:bg-red-100 light:text-red-700'
              : 'bg-orange-950/40 text-orange-300 light:bg-orange-100 light:text-orange-700',
          )}>
            {q.strategic_rank === 1 ? '⚡' : '↑'}
          </span>
        )}
      </div>

      {/* [Req #279] - Desktop hover actions overlay — quick-action buttons */}
      {isHovered && !isSelected && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {q.client?.phone && (
            <a
              href={`https://wa.me/${q.client.phone.replace(/\D/g, '').replace(/^0/, '972')}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded bg-emerald-950/60 light:bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 light:text-emerald-600 hover:bg-emerald-900/80 light:hover:bg-emerald-100 transition-colors"
              title="פתח WhatsApp"
            >
              WA
            </a>
          )}
          {q.client?.phone && (
            <a
              href={`tel:${q.client.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded bg-blue-950/60 light:bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-400 light:text-blue-600 hover:bg-blue-900/80 light:hover:bg-blue-100 transition-colors"
              title="חייג"
            >
              📞
            </a>
          )}
          {/* [Req #279] Quick strategic rank indicator */}
          {q.strategic_rank === 1 && (
            <span
              className="rounded bg-red-950/60 light:bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-400 light:text-red-600 cursor-default"
              title="קריטי"
            >
              !
            </span>
          )}
        </div>
      )}
    </button>
  );
}
