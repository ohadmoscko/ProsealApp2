import { useState } from 'react';
import { cn, fmtDate, timeAgo, tempColor, tempLabel } from '@/lib/utils';
import { STATUS_LABELS, STATUS_COLORS, INTERACTION_LABELS } from '@/lib/constants';
import { isTauri, copyToClipboard, openFileLocation } from '@/lib/tauri';
import { useToast } from '@/lib/toast';
import { useUpdateClient, useUpdateQuote, useAddInteraction } from '@/lib/data';
import InteractionLogger from '@/components/InteractionLogger';
import type { Quote, Client, Interaction, InteractionType, QuoteStatus } from '@/lib/database.types';

// ── Types ──────────────────────────────────────────────────────────────────

interface QuoteDetailProps {
  quote: Quote & { client?: Client };
  interactions: Interaction[];
}

// ── Timeline grouping ──────────────────────────────────────────────────────

type TimelineRow =
  | { kind: 'single'; interaction: Interaction }
  | { kind: 'failed-group'; interactions: Interaction[]; expanded: boolean };

function buildTimeline(interactions: Interaction[]): Omit<TimelineRow, 'expanded'>[] {
  const rows: Omit<TimelineRow, 'expanded'>[] = [];
  let i = 0;

  while (i < interactions.length) {
    const ix = interactions[i];
    const isFailed =
      ix.type === 'call' &&
      (ix.outcome === 'no_answer' || ix.outcome === 'unavailable');

    if (isFailed) {
      const group: Interaction[] = [ix];
      while (
        i + group.length < interactions.length &&
        interactions[i + group.length].type === 'call' &&
        (interactions[i + group.length].outcome === 'no_answer' ||
          interactions[i + group.length].outcome === 'unavailable')
      ) {
        group.push(interactions[i + group.length]);
      }

      if (group.length === 1) {
        rows.push({ kind: 'single', interaction: ix });
      } else {
        rows.push({ kind: 'failed-group', interactions: group });
      }
      i += group.length;
    } else {
      rows.push({ kind: 'single', interaction: ix });
      i++;
    }
  }

  return rows;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_TRANSITIONS: QuoteStatus[] = ['open', 'waiting', 'follow_up', 'won', 'lost', 'dormant'];

/** Format Israeli phone for wa.me: 0501234567 → 972501234567 */
function waPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) return '972' + d.slice(1);
  return d;
}

// ── Component ─────────────────────────────────────────────────────────────

const ACTION_BUTTONS: { type: InteractionType; label: string }[] = [
  { type: 'call',      label: 'טלפון'    },
  { type: 'whatsapp',  label: 'וואטסאפ' },
  { type: 'email',     label: 'מייל'     },
  { type: 'note',      label: 'הערה'     },
];

export default function QuoteDetail({ quote, interactions }: QuoteDetailProps) {
  const { toast } = useToast();
  const updateClient = useUpdateClient();
  const updateQuote = useUpdateQuote();
  const addInteraction = useAddInteraction();

  const [activeLogger, setActiveLogger] = useState<InteractionType | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // Status changer
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [pendingLost, setPendingLost] = useState(false);
  const [lossReason, setLossReason] = useState('');

  // Defer panel
  const [showDeferPanel, setShowDeferPanel] = useState(false);
  const [deferReason, setDeferReason] = useState('');
  const [deferWakeUp, setDeferWakeUp] = useState('');

  // Sales ammo
  const [newAmmoText, setNewAmmoText] = useState('');

  const rawTimeline = buildTimeline(interactions);

  // Latest ice-breaker tag from interactions
  const latestIceBreaker = [...interactions].reverse().find((ix) => ix.ice_breaker_tag)?.ice_breaker_tag;

  // ── Handlers ───────────────────────────────────────────────────────────

  function toggleGroup(idx: number) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  async function toggleVip() {
    if (!quote.client) return;
    const newVip = !quote.client.is_vip;
    if (newVip) {
      const ok = window.confirm(`האם לסמן את ${quote.client.code} כ-VIP אסטרטגי?`);
      if (!ok) return;
    }
    try {
      await updateClient.mutateAsync({ id: quote.client.id, fields: { is_vip: newVip } });
      toast(newVip ? 'סומן כ-VIP' : 'הוסר מ-VIP', 'success');
    } catch {
      toast('שגיאה בעדכון', 'error');
    }
  }

  async function changeStatus(newStatus: QuoteStatus, reason?: string) {
    const fields: Partial<Quote> = { status: newStatus };
    if (newStatus === 'lost' && reason) fields.loss_reason = reason;
    try {
      await updateQuote.mutateAsync({ id: quote.id, fields });
      toast(`סטטוס: ${STATUS_LABELS[newStatus]}`, 'success');
      setShowStatusMenu(false);
      setPendingLost(false);
      setLossReason('');
    } catch {
      toast('שגיאה בעדכון סטטוס', 'error');
    }
  }

  async function changeTemperature(temp: number) {
    if (temp === quote.temperature) return;
    try {
      await updateQuote.mutateAsync({ id: quote.id, fields: { temperature: temp } });
    } catch {
      toast('שגיאה בעדכון טמפרטורה', 'error');
    }
  }

  async function saveDeferral() {
    const reason = deferReason.trim();
    if (!reason) return;
    try {
      await addInteraction.mutateAsync({
        quoteId: quote.id,
        type: 'note',
        content: `נדחה: ${reason}`,
        outcome: undefined,
        followUpDate: deferWakeUp || null,
      });
      await updateQuote.mutateAsync({
        id: quote.id,
        fields: {
          status: deferWakeUp ? 'follow_up' : 'dormant',
          follow_up_date: deferWakeUp || null,
        },
      });
      toast('ההצעה נדחתה', 'success');
      setShowDeferPanel(false);
      setDeferReason('');
      setDeferWakeUp('');
    } catch {
      toast('שגיאה בשמירה', 'error');
    }
  }

  async function addAmmo() {
    const text = newAmmoText.trim();
    if (!text) return;
    try {
      await updateQuote.mutateAsync({
        id: quote.id,
        fields: { sales_ammo: [...quote.sales_ammo, text] },
      });
      setNewAmmoText('');
    } catch {
      toast('שגיאה בהוספה', 'error');
    }
  }

  async function removeAmmo(index: number) {
    try {
      await updateQuote.mutateAsync({
        id: quote.id,
        fields: { sales_ammo: quote.sales_ammo.filter((_, i) => i !== index) },
      });
    } catch {
      toast('שגיאה במחיקה', 'error');
    }
  }

  function openWhatsApp() {
    if (!quote.client?.phone) return;
    window.open(`https://wa.me/${waPhone(quote.client.phone)}`, '_blank');
    setActiveLogger('whatsapp');
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* ── Header ── */}
        <div className="border-b border-(--color-border) px-6 py-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-(--color-text)">{quote.quote_number}</h2>
              {quote.client && (
                <button
                  onClick={toggleVip}
                  disabled={updateClient.isPending}
                  title={quote.client.is_vip ? 'הסר VIP' : 'סמן כ-VIP אסטרטגי'}
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-sm transition-colors disabled:opacity-40',
                    quote.client.is_vip
                      ? 'text-amber-500 hover:text-amber-600'
                      : 'text-(--color-text-secondary)/30 hover:text-amber-400',
                  )}
                >
                  ♛
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* ── Clickable status badge ── */}
              <div className="relative">
                <button
                  onClick={() => { setShowStatusMenu(!showStatusMenu); setPendingLost(false); }}
                  className={cn('rounded-full px-3 py-1 text-xs font-bold cursor-pointer transition-opacity hover:opacity-80', STATUS_COLORS[quote.status])}
                >
                  {STATUS_LABELS[quote.status]}
                </button>
                {showStatusMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowStatusMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 rounded-lg border border-(--color-border) bg-(--color-surface) shadow-lg py-1 min-w-[120px]">
                      {STATUS_TRANSITIONS.filter((s) => s !== quote.status).map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            if (s === 'lost') {
                              setPendingLost(true);
                              setShowStatusMenu(false);
                            } else {
                              changeStatus(s);
                            }
                          }}
                          className="w-full px-3 py-1.5 text-right text-xs hover:bg-(--color-surface-dim) transition-colors"
                        >
                          <span className={cn('inline-block rounded-full px-2 py-0.5 font-bold', STATUS_COLORS[s])}>
                            {STATUS_LABELS[s]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* ── Clickable temperature dots ── */}
              <div className="flex gap-0.5" title={tempLabel(quote.temperature)}>
                {[1, 2, 3, 4, 5].map((t) => (
                  <button
                    key={t}
                    onClick={() => changeTemperature(t)}
                    className={cn(
                      'text-sm font-bold transition-colors hover:scale-110',
                      t <= quote.temperature ? tempColor(quote.temperature) : 'text-(--color-text-secondary)/20 hover:text-(--color-text-secondary)/40',
                    )}
                    title={tempLabel(t)}
                  >
                    ●
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Loss reason prompt ── */}
          {pendingLost && (
            <div className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-3 space-y-2 animate-fade-in">
              <p className="text-xs font-bold text-red-700 dark:text-red-400">סיבת הפסד</p>
              <input
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                autoFocus
                placeholder="למה הפסדנו?"
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-red-400"
                dir="rtl"
                onKeyDown={(e) => e.key === 'Enter' && lossReason.trim() && changeStatus('lost', lossReason.trim())}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => lossReason.trim() && changeStatus('lost', lossReason.trim())}
                  disabled={!lossReason.trim() || updateQuote.isPending}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-30 hover:opacity-90"
                >
                  {updateQuote.isPending ? '...' : 'סמן כהפסד'}
                </button>
                <button
                  onClick={() => { setPendingLost(false); setLossReason(''); }}
                  className="text-xs text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}

          <p className="mt-0.5 text-sm text-(--color-text-secondary)">
            {quote.client?.code ?? 'ללא לקוח'}
            {quote.client?.is_vip && (
              <span className="mr-2 text-xs font-semibold text-amber-500">VIP</span>
            )}
          </p>

          {/* ── Ice-breaker tag ── */}
          {latestIceBreaker && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-xs font-semibold text-violet-600 dark:text-violet-400">שובר קרח:</span>
              <span className="text-xs text-(--color-text)">{latestIceBreaker}</span>
            </div>
          )}

          {/* ── Meta ── */}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-(--color-text-secondary)">
            <span>נפתח: {fmtDate(quote.opened_at)}</span>
            {quote.follow_up_date && (
              <span className={cn(
                quote.follow_up_date < new Date().toISOString().slice(0, 10)
                  ? 'text-(--color-danger) font-semibold'
                  : '',
              )}>
                מעקב: {fmtDate(quote.follow_up_date)}
              </span>
            )}
            {quote.last_contact_at && (
              <span>קשר אחרון: {timeAgo(quote.last_contact_at)}</span>
            )}
            {quote.days_since_contact != null && (
              <span className={quote.days_since_contact > 4 ? 'text-(--color-danger) font-semibold' : ''}>
                {quote.days_since_contact} ימים ללא קשר
              </span>
            )}
            {quote.loss_reason && (
              <span className="text-red-600 dark:text-red-400 font-semibold">
                הפסד: {quote.loss_reason}
              </span>
            )}
          </div>

          {/* ── Action buttons ── */}
          <div className="mt-4 flex flex-wrap gap-2">
            {ACTION_BUTTONS.map((btn) => (
              <button
                key={btn.type}
                onClick={() => {
                  setActiveLogger(activeLogger === btn.type ? null : btn.type);
                  setShowDeferPanel(false);
                }}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  activeLogger === btn.type
                    ? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)'
                    : 'border-(--color-border) text-(--color-text-secondary) hover:bg-(--color-surface-dim)',
                )}
              >
                {btn.label}
              </button>
            ))}
            <button
              onClick={() => { setShowDeferPanel(!showDeferPanel); setActiveLogger(null); }}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium text-(--color-warning) transition-colors',
                showDeferPanel
                  ? 'border-(--color-warning)/50 bg-amber-50 dark:bg-amber-950/20'
                  : 'border-(--color-border) hover:bg-(--color-surface-dim)',
              )}
            >
              דחה
            </button>
            {quote.client?.phone && (
              <button
                onClick={openWhatsApp}
                className="rounded-lg border border-emerald-300 dark:border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors"
              >
                שלח WA
              </button>
            )}
            {quote.local_file_path && (
              isTauri ? (
                <>
                  <button
                    onClick={async () => {
                      const ok = await copyToClipboard(quote.local_file_path!);
                      toast(ok ? 'הנתיב הועתק' : 'ההעתקה נכשלה', ok ? 'success' : 'error');
                    }}
                    className="rounded-lg border border-(--color-border) px-3 py-1.5 text-xs font-medium text-(--color-text-secondary) hover:bg-(--color-surface-dim) transition-colors"
                    title={quote.local_file_path}
                  >
                    העתק נתיב
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await openFileLocation(quote.local_file_path!);
                      if (!ok) toast('לא ניתן לפתוח תיקייה', 'error');
                    }}
                    className="rounded-lg border border-(--color-border) px-3 py-1.5 text-xs font-medium text-(--color-text-secondary) hover:bg-(--color-surface-dim) transition-colors"
                  >
                    פתח תיקייה
                  </button>
                </>
              ) : (
                <span className="rounded-lg border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-text-secondary)/60">
                  קבצים מקומיים נגישים רק ממחשב המשרד
                </span>
              )
            )}
          </div>
        </div>

        {/* ── Inline interaction logger ── */}
        {activeLogger && !showDeferPanel && (
          <InteractionLogger
            quoteId={quote.id}
            type={activeLogger}
            onClose={() => setActiveLogger(null)}
          />
        )}

        {/* ── Defer panel ── */}
        {showDeferPanel && (
          <div className="border-t border-(--color-border) bg-(--color-surface-dim) px-6 py-4 space-y-3 animate-fade-in">
            <p className="text-xs font-bold text-(--color-warning)">דחיית הצעה</p>
            <textarea
              value={deferReason}
              onChange={(e) => setDeferReason(e.target.value)}
              autoFocus
              rows={2}
              placeholder="למה דוחים?"
              className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/50 focus:border-(--color-warning) resize-none"
              dir="rtl"
              onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && saveDeferral()}
            />
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-(--color-text-secondary)">תזכורת להתעוררות</p>
              <input
                type="date"
                value={deferWakeUp}
                onChange={(e) => setDeferWakeUp(e.target.value)}
                className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary) bg-(--color-surface) outline-none focus:border-(--color-warning)"
                dir="ltr"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={saveDeferral}
                disabled={!deferReason.trim() || !deferWakeUp || addInteraction.isPending || updateQuote.isPending}
                className="rounded-lg bg-(--color-warning) px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-30 hover:opacity-90"
              >
                {(addInteraction.isPending || updateQuote.isPending) ? '...' : 'דחה'}
              </button>
              <button
                onClick={() => { setShowDeferPanel(false); setDeferReason(''); setDeferWakeUp(''); }}
                className="text-sm text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)"
              >
                ביטול
              </button>
              {(!deferReason.trim() || !deferWakeUp) ? (
                <span className="mr-auto text-[10px] font-semibold text-(--color-warning)">
                  {!deferReason.trim() ? 'חובה סיבה' : 'חובה תאריך התעוררות'}
                </span>
              ) : (
                <span className="mr-auto text-[10px] text-(--color-text-secondary)/40">Ctrl+Enter לשמירה</span>
              )}
            </div>
          </div>
        )}

        {/* ── Sales ammo (editable) ── */}
        <div className="border-b border-(--color-border) px-6 py-4">
          <h3 className="mb-2 text-xs font-bold text-(--color-text-secondary)">נקודות חוזק למכירה</h3>
          {quote.sales_ammo.length > 0 && (
            <ul className="space-y-1 mb-2">
              {quote.sales_ammo.map((point, i) => (
                <li key={i} className="flex items-center gap-2 group">
                  <span className="text-sm text-(--color-text) flex-1">• {point}</span>
                  <button
                    onClick={() => removeAmmo(i)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-(--color-text-secondary)/40 hover:text-red-500 transition-all"
                    title="הסר"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={newAmmoText}
              onChange={(e) => setNewAmmoText(e.target.value)}
              placeholder="הוסף נקודת חוזק..."
              className="flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/40 focus:border-(--color-accent)"
              dir="rtl"
              onKeyDown={(e) => e.key === 'Enter' && addAmmo()}
            />
            <button
              onClick={addAmmo}
              disabled={!newAmmoText.trim() || updateQuote.isPending}
              className="rounded-lg border border-(--color-accent)/30 px-2.5 py-1 text-xs font-semibold text-(--color-accent) disabled:opacity-30 hover:bg-(--color-accent)/5 transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* ── Timeline ── */}
        <div className="px-6 py-4">
          <h3 className="mb-3 text-xs font-bold text-(--color-text-secondary)">ציר זמן</h3>
          {interactions.length === 0 ? (
            <p className="text-sm text-(--color-text-secondary)/50">אין אינטראקציות עדיין</p>
          ) : (
            <div className="space-y-0">
              {rawTimeline.map((row, idx) => {
                if (row.kind === 'single') {
                  return (
                    <SingleInteractionRow key={row.interaction.id} ix={row.interaction} />
                  );
                }

                const expanded = expandedGroups.has(idx);
                const group = row.interactions;
                return (
                  <div key={idx} className="border-r-2 border-(--color-border) pr-4 pb-3">
                    <button
                      onClick={() => toggleGroup(idx)}
                      className="flex items-center gap-1.5 text-xs text-(--color-text-secondary)/70 hover:text-(--color-text-secondary) transition-colors"
                    >
                      <span className="font-semibold">
                        [{group.length}] ניסיונות חסרי מענה
                      </span>
                      <span>{expanded ? '▲' : '▼'}</span>
                      <span className="mr-1">{timeAgo(group[group.length - 1].created_at)}</span>
                    </button>
                    {expanded && (
                      <div className="mt-2 space-y-1.5 pr-2">
                        {group.map((ix) => (
                          <div key={ix.id} className="flex items-center gap-2 text-xs text-(--color-text-secondary)/60">
                            <span>{timeAgo(ix.created_at)}</span>
                            <span>{ix.outcome === 'no_answer' ? 'לא ענה' : 'לא זמין'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Single timeline row ────────────────────────────────────────────────────

function SingleInteractionRow({ ix }: { ix: Interaction }) {
  return (
    <div className="flex gap-3 border-r-2 border-(--color-border) pr-4 pb-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-(--color-accent)">
            {INTERACTION_LABELS[ix.type] ?? ix.type}
          </span>
          {ix.outcome && (
            <span className={cn(
              'text-xs font-semibold',
              ix.outcome === 'reached' ? 'text-emerald-600 dark:text-emerald-400' : 'text-(--color-text-secondary)/60',
            )}>
              {ix.outcome === 'reached' ? 'שוחחנו' : ix.outcome === 'no_answer' ? 'לא ענה' : 'לא זמין'}
            </span>
          )}
          <span className="text-xs text-(--color-text-secondary)">{timeAgo(ix.created_at)}</span>
        </div>
        {ix.content && ix.content !== 'לא ענה' && (
          <p className="mt-0.5 text-sm text-(--color-text)">{ix.content}</p>
        )}
      </div>
    </div>
  );
}
