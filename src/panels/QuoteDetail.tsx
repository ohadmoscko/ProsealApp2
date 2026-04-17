import { useState } from 'react';
import { cn, fmtDate, timeAgo, tempColor, tempLabel, computePriorityScore, generateIceBreaker, deriveNextCallTopic, computeRelationshipStrength } from '@/lib/utils';
import { STATUS_LABELS, STATUS_COLORS, INTERACTION_LABELS, STRATEGIC_RANK_LABELS, DEFER_REASON_LABELS, DIRECTION_LABELS, CHANNEL_LABELS, CUSTOMER_STYLE_LABELS } from '@/lib/constants';
import type { PreferredChannel, CustomerStyle } from '@/lib/database.types';
import { isTauri, copyToClipboard, openFileLocation } from '@/lib/tauri';
import { useToast } from '@/lib/toast';
import { detectSensitiveContent } from '@/lib/sanitization';
import { useUpdateClient, useUpdateQuote, useAddInteraction, useSoftDeleteInteraction, useQuotes } from '@/lib/data';
import InteractionLogger from '@/components/InteractionLogger';
import type { Quote, Client, Interaction, InteractionType, QuoteStatus, DeferReasonCategory } from '@/lib/database.types';

// ── Types ──────────────────────────────────────────────────────────────────

interface QuoteDetailProps {
  quote: Quote & { client?: Client };
  interactions: Interaction[];
}

// ── Timeline grouping ──────────────────────────────────────────────────────

type RawTimelineRow =
  | { kind: 'single'; interaction: Interaction }
  | { kind: 'failed-group'; interactions: Interaction[] };

function buildTimeline(interactions: Interaction[]): RawTimelineRow[] {
  const rows: RawTimelineRow[] = [];
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
  const softDeleteInteraction = useSoftDeleteInteraction(); // [Req #148]

  // [Req #103] Consolidated customer profile — all quotes for this client
  const { data: allQuotes } = useQuotes(true); // include archived
  const clientQuotes = quote.client
    ? (allQuotes ?? []).filter((q) => q.client_id === quote.client_id && q.id !== quote.id)
    : [];
  const [showClientProfile, setShowClientProfile] = useState(false);

  const [activeLogger, setActiveLogger] = useState<InteractionType | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // Status changer
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [pendingLost, setPendingLost] = useState(false);
  const [lossReason, setLossReason] = useState('');
  // [Req #121, #122] Win reason mandatory prompt
  const [pendingWon, setPendingWon] = useState(false);
  const [winReason, setWinReason] = useState('');

  // Defer panel
  const [showDeferPanel, setShowDeferPanel] = useState(false);
  const [deferCategory, setDeferCategory] = useState<DeferReasonCategory | null>(null);
  const [deferReason, setDeferReason] = useState('');
  const [deferWakeUp, setDeferWakeUp] = useState('');

  // Sales ammo
  const [newAmmoText, setNewAmmoText] = useState('');

  // [Req #19] Deal-won celebration animation
  const [showWonAnimation, setShowWonAnimation] = useState(false);

  // [Req #82] "What's next?" prompt state — shown after logging an interaction
  const [showNextStepPrompt, setShowNextStepPrompt] = useState(false);

  // [Req #130] Quick follow-up scheduling from header
  const [showQuickFollowUp, setShowQuickFollowUp] = useState(false);

  const rawTimeline = buildTimeline(interactions);

  // Latest ice-breaker tag from interactions
  const latestIceBreaker = [...interactions].reverse().find((ix) => ix.ice_breaker_tag)?.ice_breaker_tag;

  // [Req #12, #81] Computed priority score
  const priorityScore = computePriorityScore(
    quote.temperature,
    quote.days_since_contact,
    quote.strategic_rank,
    quote.client?.is_vip ?? false,
    quote.follow_up_date,
    quote.status,
  );

  // [Req #15] Auto-generated ice-breaker opener
  const lastInteractionType = interactions.length > 0
    ? [...interactions].reverse().find((ix) => ix.type !== 'system')?.type
    : undefined;
  const autoIceBreaker = generateIceBreaker(
    quote.days_since_contact,
    quote.client?.code ?? '',
    lastInteractionType,
  );

  // [Req #5] Next call topic
  const nextCallTopic = deriveNextCallTopic(
    quote.status,
    quote.temperature,
    quote.days_since_contact,
    quote.follow_up_date,
    quote.sales_ammo,
    quote.loss_reason,
    quote.ai_summary,
  );

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
    // [Req #121] Win reason mandatory on deal close
    if (newStatus === 'won' && reason) fields.win_reason = reason;
    try {
      await updateQuote.mutateAsync({ id: quote.id, fields });
      toast(`סטטוס: ${STATUS_LABELS[newStatus]}`, 'success');
      setShowStatusMenu(false);
      setPendingLost(false);
      setLossReason('');
      setPendingWon(false);
      setWinReason('');
      // [Req #19] Trigger celebration animation on deal won
      if (newStatus === 'won') {
        setShowWonAnimation(true);
        setTimeout(() => setShowWonAnimation(false), 3000);
      }
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

  async function changeStrategicRank(rank: number | null) {
    if (rank === quote.strategic_rank) rank = null; // toggle off
    try {
      await updateQuote.mutateAsync({ id: quote.id, fields: { strategic_rank: rank } });
      toast(rank ? `דירוג: ${STRATEGIC_RANK_LABELS[rank]}` : 'דירוג הוסר', 'success');
    } catch {
      toast('שגיאה בעדכון דירוג', 'error');
    }
  }

  async function saveDeferral() {
    if (!deferCategory) return;
    const categoryLabel = DEFER_REASON_LABELS[deferCategory];
    const reason = deferReason.trim();
    const content = reason ? `נדחה (${categoryLabel}): ${reason}` : `נדחה: ${categoryLabel}`;

    // Sanitization gate: block financial data / phone numbers in defer reason
    const check = detectSensitiveContent(content);
    if (check.blocked) {
      toast(check.reason!, 'error');
      console.warn('[sanitization] Blocked deferral content:', check.match);
      return;
    }

    try {
      await addInteraction.mutateAsync({
        quoteId: quote.id,
        type: 'note',
        content,
        outcome: undefined,
        followUpDate: deferWakeUp || null,
        deferCategory,
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
      setDeferCategory(null);
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

  /** WhatsApp "fire-and-forget": opens wa.me with pre-filled message */
  function openWhatsApp() {
    if (!quote.client?.phone) return;
    const clientName = quote.client.code;
    const msg = encodeURIComponent(
      `שלום, אני חוזר בעניין הצעה ${quote.quote_number} עבור ${clientName}. ` +
      `אשמח לדעת מה המצב מצדכם.`
    );
    window.open(`https://wa.me/${waPhone(quote.client.phone)}?text=${msg}`, '_blank');
    setActiveLogger('whatsapp');
  }

  /**
   * WhatsApp with sales ammo: builds a richer message from the quote's
   * strength points. One click -> wa.me opens with a persuasive template.
   * Satisfies the 3-click rule: click button -> WhatsApp opens -> send.
   */
  function openWhatsAppWithAmmo() {
    if (!quote.client?.phone) return;
    const clientName = quote.client.code;
    const ammoLines = quote.sales_ammo.length > 0
      ? '\n\nנקודות שכדאי לדעת:\n' + quote.sales_ammo.map((a) => `- ${a}`).join('\n')
      : '';
    const msg = encodeURIComponent(
      `שלום, בהמשך להצעה ${quote.quote_number} עבור ${clientName} —` +
      ammoLines +
      `\n\nאשמח לשמוע מכם.`
    );
    window.open(`https://wa.me/${waPhone(quote.client.phone)}?text=${msg}`, '_blank');
    setActiveLogger('whatsapp');
  }

  /**
   * [Req #8] WhatsApp "Set & Forget": one-click send + auto-log interaction.
   * Opens wa.me with pre-filled message AND immediately logs a WhatsApp
   * interaction with the ice-breaker text, so the operator doesn't need
   * to manually log the contact. True fire-and-forget.
   */
  async function whatsAppSetAndForget() {
    if (!quote.client?.phone) return;
    const msg = encodeURIComponent(autoIceBreaker);
    window.open(`https://wa.me/${waPhone(quote.client.phone)}?text=${msg}`, '_blank');

    // Auto-log the interaction silently
    try {
      await addInteraction.mutateAsync({
        quoteId: quote.id,
        type: 'whatsapp',
        content: autoIceBreaker,
        outcome: undefined,
      });
      toast('WA נשלח ונרשם', 'success');
    } catch {
      toast('WA נפתח אך הרישום נכשל', 'error');
    }
  }

  /**
   * [Req #7] Email template: opens mailto: with pre-filled subject and body.
   * Uses the quote context to build a professional follow-up email template.
   */
  function openEmailTemplate() {
    const clientName = quote.client?.code ?? '';
    const subject = encodeURIComponent(`בהמשך להצעת מחיר ${quote.quote_number} — ${clientName}`);
    const ammoSection = quote.sales_ammo.length > 0
      ? '\n\nנקודות מרכזיות:\n' + quote.sales_ammo.map((a) => `• ${a}`).join('\n')
      : '';
    const body = encodeURIComponent(
      `${autoIceBreaker},\n\n` +
      `בהמשך להצעת מחיר מספר ${quote.quote_number} שנשלחה אליכם, ` +
      `אשמח לקבל עדכון לגבי ההחלטה.` +
      ammoSection +
      `\n\nאשמח לעמוד לרשותכם לכל שאלה.\n\nבברכה`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
    setActiveLogger('email');
  }

  // [Req #117] Quick "no answer" one-click logging — skips the InteractionLogger entirely
  async function quickNoAnswer() {
    try {
      await addInteraction.mutateAsync({
        quoteId: quote.id,
        type: 'call',
        content: 'לא ענה',
        outcome: 'no_answer',
      });
      toast('נרשם: לא ענה', 'success');
      // [Req #82] Show "what's next?" prompt after logging
      setShowNextStepPrompt(true);
    } catch {
      toast('שגיאה ברישום', 'error');
    }
  }

  // [Req #114, #178] Client-initiated contact: logs a "pull" direction interaction
  async function logClientInitiated() {
    try {
      await addInteraction.mutateAsync({
        quoteId: quote.id,
        type: 'call',
        content: 'הלקוח יצר קשר',
        outcome: 'reached',
        direction: 'pull',
      });
      // Cancel pending follow-up if client reached out
      if (quote.follow_up_date) {
        await updateQuote.mutateAsync({
          id: quote.id,
          fields: { follow_up_date: null },
        });
      }
      toast('נרשם: הלקוח יצר קשר', 'success');
      setShowNextStepPrompt(true);
    } catch {
      toast('שגיאה ברישום', 'error');
    }
  }

  // [Req #82] Handle "what's next?" prompt actions
  function handleNextStepAction(action: 'followup' | 'defer' | 'note' | 'dismiss') {
    setShowNextStepPrompt(false);
    if (action === 'followup') setShowQuickFollowUp(true);
    else if (action === 'defer') { setShowDeferPanel(true); setActiveLogger(null); }
    else if (action === 'note') { setActiveLogger('note'); setShowDeferPanel(false); }
    // dismiss = close prompt, do nothing
  }

  // [Req #130] Quick follow-up date setter from header
  async function setQuickFollowUp(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const iso = d.toISOString().slice(0, 10);
    try {
      await updateQuote.mutateAsync({
        id: quote.id,
        fields: { follow_up_date: iso, status: quote.status === 'new' ? 'follow_up' : quote.status },
      });
      toast(`מעקב נקבע: ${iso}`, 'success');
      setShowQuickFollowUp(false);
    } catch {
      toast('שגיאה בקביעת מעקב', 'error');
    }
  }

  // [Req #82] Wrap the original logger close to trigger "what's next?"
  function handleLoggerClose() {
    setActiveLogger(null);
    setShowNextStepPrompt(true);
  }

  // [Req #118] Visual age indicator — compute quote age in days
  const quoteAgeDays = Math.floor(
    (Date.now() - new Date(quote.opened_at).getTime()) / 86_400_000,
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* [Req #19] Deal-won celebration overlay */}
      {showWonAnimation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none animate-fade-in">
          <div className="rounded-2xl bg-green-950/90 light:bg-green-50/95 border-2 border-green-500 px-12 py-8 text-center shadow-2xl">
            <div className="text-5xl mb-3" style={{ animation: 'fadeIn 0.5s ease-out' }}>
              ✓
            </div>
            <p className="text-2xl font-bold text-green-400 light:text-green-700">
              עסקה נסגרה!
            </p>
            <p className="mt-1 text-sm text-green-400/70 light:text-green-600">
              {quote.quote_number} — {quote.client?.code}
            </p>
          </div>
        </div>
      )}

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
                              setPendingWon(false);
                              setShowStatusMenu(false);
                            } else if (s === 'won') {
                              // [Req #121] Intercept — require win reason before closing
                              setPendingWon(true);
                              setPendingLost(false);
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

              {/* ── Strategic rank (1-3) ── */}
              <div className="flex gap-0.5">
                {[1, 2, 3].map((r) => (
                  <button
                    key={r}
                    onClick={() => changeStrategicRank(r)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors',
                      quote.strategic_rank === r
                        ? r === 1 ? 'bg-red-950/40 text-red-300 light:bg-red-100 light:text-red-700'
                          : r === 2 ? 'bg-orange-950/40 text-orange-300 light:bg-orange-100 light:text-orange-700'
                            : 'bg-zinc-800/40 text-zinc-400 light:bg-zinc-100 light:text-zinc-600'
                        : 'text-(--color-text-secondary)/30 hover:text-(--color-text-secondary)/60',
                    )}
                    title={STRATEGIC_RANK_LABELS[r]}
                  >
                    {STRATEGIC_RANK_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Loss reason prompt ── */}
          {pendingLost && (
            <div className="mt-3 rounded-lg border border-red-800 bg-red-950/20 light:border-red-200 light:bg-red-50 p-3 space-y-2 animate-fade-in">
              <p className="text-xs font-bold text-red-400 light:text-red-700">סיבת הפסד</p>
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

          {/* [Req #121, #122] Win reason prompt — mandatory documentation before closing as won */}
          {pendingWon && (
            <div className="mt-3 rounded-lg border border-green-800 bg-green-950/20 light:border-green-200 light:bg-green-50 p-3 space-y-2 animate-fade-in">
              <p className="text-xs font-bold text-green-400 light:text-green-700">סיבת זכייה</p>
              <input
                value={winReason}
                onChange={(e) => setWinReason(e.target.value)}
                autoFocus
                placeholder="למה זכינו? (מחיר / שירות / קשר אישי / אחר)"
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-green-400"
                dir="rtl"
                onKeyDown={(e) => e.key === 'Enter' && winReason.trim() && changeStatus('won', winReason.trim())}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => winReason.trim() && changeStatus('won', winReason.trim())}
                  disabled={!winReason.trim() || updateQuote.isPending}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-30 hover:opacity-90"
                >
                  {updateQuote.isPending ? '...' : 'סמן כזכייה'}
                </button>
                <button
                  onClick={() => { setPendingWon(false); setWinReason(''); }}
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

          {/* [Req #12, #81] - Priority score badge */}
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-(--color-text-secondary)">ציון עדיפות:</span>
              <span className={cn(
                'text-xs font-bold rounded-full px-2 py-0.5',
                priorityScore >= 80 ? 'bg-red-950/40 text-red-300 light:bg-red-100 light:text-red-700'
                  : priorityScore >= 50 ? 'bg-orange-950/40 text-orange-300 light:bg-orange-100 light:text-orange-700'
                    : priorityScore >= 30 ? 'bg-amber-950/40 text-amber-300 light:bg-amber-100 light:text-amber-700'
                      : 'bg-zinc-800/40 text-zinc-400 light:bg-zinc-100 light:text-zinc-600',
              )}>
                {priorityScore}
              </span>
            </div>

            {/* [Req #5] - Next call topic */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-[10px] font-bold text-(--color-text-secondary) shrink-0">נושא הבא:</span>
              <span className="text-[10px] text-(--color-accent) font-semibold truncate">{nextCallTopic}</span>
            </div>
          </div>

          {/* ── Ice-breaker tag (manual from interactions) ── */}
          {latestIceBreaker && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-xs font-semibold text-violet-400 light:text-violet-600">שובר קרח:</span>
              <span className="text-xs text-(--color-text)">{latestIceBreaker}</span>
            </div>
          )}

          {/* [Req #15] - Auto-generated ice-breaker opener */}
          {!latestIceBreaker && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-violet-400/60 light:text-violet-500">פתיח מוצע:</span>
              <span className="text-[10px] text-(--color-text-secondary) italic">"{autoIceBreaker}"</span>
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
              <span className="text-red-400 light:text-red-600 font-semibold">
                הפסד: {quote.loss_reason}
              </span>
            )}
            {/* [Req #121] Display win reason */}
            {quote.win_reason && (
              <span className="text-green-400 light:text-green-600 font-semibold">
                זכייה: {quote.win_reason}
              </span>
            )}
          </div>

          {/* [Req #118] Visual age indicator — passive visual cue for quote age */}
          <div className="mt-3 flex items-center gap-2">
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold',
              quoteAgeDays >= 30 ? 'bg-red-950/30 text-red-400 light:bg-red-50 light:text-red-600'
                : quoteAgeDays >= 14 ? 'bg-orange-950/30 text-orange-400 light:bg-orange-50 light:text-orange-600'
                  : quoteAgeDays >= 7 ? 'bg-amber-950/30 text-amber-400 light:bg-amber-50 light:text-amber-600'
                    : 'bg-zinc-800/30 text-zinc-400 light:bg-zinc-100 light:text-zinc-500',
            )}>
              {quoteAgeDays >= 30 ? '⏳' : quoteAgeDays >= 14 ? '⏱' : ''}
              גיל: {quoteAgeDays} ימים
            </span>
            {quoteAgeDays >= 14 && (
              <span className="text-[10px] text-(--color-text-secondary)/50">
                {quoteAgeDays >= 30 ? 'הצעה ותיקה — שקול סגירה' : 'הצעה בהתבגרות'}
              </span>
            )}
          </div>

          {/* [Req #101, #105, #104, #170, #268] — Client profile & quote overrides */}
          {quote.client && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px]">
              {/* [Req #105] Preferred channel */}
              <div className="flex items-center gap-1">
                <span className="font-bold text-(--color-text-secondary)">ערוץ:</span>
                <div className="flex gap-0.5">
                  {(Object.entries(CHANNEL_LABELS) as [PreferredChannel, string][]).map(([ch, label]) => (
                    <button
                      key={ch}
                      onClick={async () => {
                        try {
                          await updateClient.mutateAsync({ id: quote.client!.id, fields: { preferred_channel: ch } });
                          toast(`ערוץ מועדף: ${label}`, 'success');
                        } catch { toast('שגיאה בעדכון', 'error'); }
                      }}
                      className={cn(
                        'rounded-full border px-2 py-0.5 font-semibold transition-colors',
                        quote.client!.preferred_channel === ch
                          ? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)'
                          : 'border-(--color-border) text-(--color-text-secondary)/50 hover:border-(--color-accent)/50',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* [Req #101] Customer style */}
              <div className="flex items-center gap-1">
                <span className="font-bold text-(--color-text-secondary)">סוג:</span>
                <div className="flex gap-0.5">
                  {(Object.entries(CUSTOMER_STYLE_LABELS) as [CustomerStyle, string][]).map(([style, label]) => (
                    <button
                      key={style}
                      onClick={async () => {
                        try {
                          await updateClient.mutateAsync({ id: quote.client!.id, fields: { customer_style: style } });
                          toast(`סוג לקוח: ${label}`, 'success');
                        } catch { toast('שגיאה בעדכון', 'error'); }
                      }}
                      className={cn(
                        'rounded-full border px-2 py-0.5 font-semibold transition-colors',
                        quote.client!.customer_style === style
                          ? 'border-teal-500 bg-teal-950/20 text-teal-300 light:bg-teal-50 light:text-teal-700'
                          : 'border-(--color-border) text-(--color-text-secondary)/50 hover:border-teal-500/50',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* [Req #170] New customer flag */}
              <button
                onClick={async () => {
                  try {
                    await updateClient.mutateAsync({ id: quote.client!.id, fields: { is_new_customer: !quote.client!.is_new_customer } });
                    toast(quote.client!.is_new_customer ? 'הוסר כחדש' : 'סומן כלקוח חדש', 'success');
                  } catch { toast('שגיאה בעדכון', 'error'); }
                }}
                className={cn(
                  'rounded-full border px-2 py-0.5 font-bold transition-colors',
                  quote.client!.is_new_customer
                    ? 'border-blue-500 bg-blue-950/20 text-blue-300 light:bg-blue-50 light:text-blue-700'
                    : 'border-(--color-border) text-(--color-text-secondary)/50 hover:border-blue-500/50',
                )}
              >
                {quote.client!.is_new_customer ? 'לקוח חדש ✓' : 'חדש?'}
              </button>
              {/* [Req #268] Temp override toggle */}
              <button
                onClick={async () => {
                  try {
                    await updateQuote.mutateAsync({ id: quote.id, fields: { temp_override: !quote.temp_override } });
                    toast(quote.temp_override ? 'טמפרטורה חוזרת לאוטומטי' : 'טמפרטורה ידנית — לא תדעך', 'success');
                  } catch { toast('שגיאה בעדכון', 'error'); }
                }}
                className={cn(
                  'rounded-full border px-2 py-0.5 font-bold transition-colors',
                  quote.temp_override
                    ? 'border-red-500 bg-red-950/20 text-red-300 light:bg-red-50 light:text-red-700'
                    : 'border-(--color-border) text-(--color-text-secondary)/50 hover:border-red-500/50',
                )}
                title={quote.temp_override ? 'טמפרטורה ידנית — לחץ לחזור לאוטומטי' : 'נעל טמפרטורה (לא ידעך אוטומטית)'}
              >
                {quote.temp_override ? '🔒 נעול' : '🔓 נעל טמפ׳'}
              </button>
            </div>
          )}

          {/* [Req #106] Relationship strength composite metric */}
          {quote.client && (
            <div className="mt-2 flex items-center gap-2 text-[10px]">
              <span className="font-bold text-(--color-text-secondary)">חוזק קשר:</span>
              {(() => {
                const rs = computeRelationshipStrength(
                  quote.temperature,
                  quote.days_since_contact,
                  interactions.length,
                  quote.client?.customer_style,
                );
                return (
                  <>
                    <div className="flex-1 max-w-32 h-1.5 rounded-full bg-(--color-border)/30 overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          rs >= 70 ? 'bg-emerald-500' : rs >= 40 ? 'bg-amber-500' : 'bg-red-500',
                        )}
                        style={{ width: `${rs}%` }}
                      />
                    </div>
                    <span className={cn(
                      'font-bold',
                      rs >= 70 ? 'text-emerald-400 light:text-emerald-600' : rs >= 40 ? 'text-amber-400 light:text-amber-600' : 'text-red-400 light:text-red-600',
                    )}>
                      {rs}%
                    </span>
                  </>
                );
              })()}
            </div>
          )}

          {/* [Req #115] Role tags — display client tags as privacy-safe role identifiers */}
          {quote.client && quote.client.tags && quote.client.tags.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] flex-wrap">
              <span className="font-bold text-(--color-text-secondary)">תגיות:</span>
              {quote.client.tags.map((tag, i) => (
                <span key={i} className="rounded-full border border-(--color-border) bg-(--color-surface-dim) px-2 py-0.5 font-semibold text-(--color-text)">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* [Req #114] Quick "contacted early" button — reset follow-up when you contact before reminder */}
          {quote.follow_up_date && quote.follow_up_date > new Date().toISOString().slice(0, 10) && (
            <div className="mt-2">
              <button
                onClick={async () => {
                  try {
                    await updateQuote.mutateAsync({ id: quote.id, fields: { follow_up_date: null } });
                    toast('תזכורת מעקב בוטלה — יצרת קשר מוקדם', 'success');
                  } catch { toast('שגיאה', 'error'); }
                }}
                className="rounded-lg border border-(--color-border) px-2.5 py-1 text-[10px] font-bold text-(--color-text-secondary) hover:bg-emerald-950/20 hover:text-emerald-400 hover:border-emerald-700 light:hover:bg-emerald-50 light:hover:text-emerald-600 transition-colors"
              >
                יצרתי קשר מוקדם — בטל תזכורת
              </button>
            </div>
          )}

          {/* [Req #103] Consolidated customer profile — all quotes for this client */}
          {quote.client && clientQuotes.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setShowClientProfile(!showClientProfile)}
                className="text-[10px] font-bold text-(--color-accent) hover:opacity-80 transition-opacity"
              >
                {showClientProfile ? '▲' : '▼'} {clientQuotes.length} הצעות נוספות ללקוח {quote.client.code}
              </button>
              {showClientProfile && (
                <div className="mt-1.5 space-y-1 rounded-lg border border-(--color-border) bg-(--color-surface-dim) p-2">
                  {clientQuotes.slice(0, 10).map((cq) => (
                    <div key={cq.id} className="flex items-center gap-2 text-[10px]">
                      <span className="font-semibold text-(--color-text)">{cq.quote_number}</span>
                      <span className={cn('rounded-full px-1.5 py-0.5 font-bold', STATUS_COLORS[cq.status])}>
                        {STATUS_LABELS[cq.status]}
                      </span>
                      <span className="text-(--color-text-secondary)">{timeAgo(cq.opened_at)}</span>
                    </div>
                  ))}
                  {clientQuotes.length > 10 && (
                    <span className="text-[9px] text-(--color-text-secondary)/50">ו-{clientQuotes.length - 10} נוספות...</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="mt-3 flex flex-wrap gap-2">
            {ACTION_BUTTONS.map((btn) => (
              <button
                key={btn.type}
                onClick={() => {
                  setActiveLogger(activeLogger === btn.type ? null : btn.type);
                  setShowDeferPanel(false);
                  setShowNextStepPrompt(false);
                  setShowQuickFollowUp(false);
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
            {/* [Req #117] Quick "no answer" one-click button */}
            <button
              onClick={quickNoAnswer}
              disabled={addInteraction.isPending}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-400 light:text-zinc-500 hover:bg-zinc-900/30 light:hover:bg-zinc-100 transition-colors disabled:opacity-30"
              title="רשום ניסיון שלא ענו — לחיצה אחת"
            >
              {addInteraction.isPending ? '...' : 'לא ענה'}
            </button>
            {/* [Req #114, #178] Client-initiated contact button */}
            <button
              onClick={logClientInitiated}
              disabled={addInteraction.isPending}
              className="rounded-lg border border-teal-700 light:border-teal-300 px-3 py-1.5 text-xs font-medium text-teal-400 light:text-teal-600 hover:bg-teal-950/20 light:hover:bg-teal-50 transition-colors disabled:opacity-30"
              title="הלקוח התקשר / שלח הודעה — רשום כ'יוזמת לקוח'"
            >
              הלקוח יצר קשר
            </button>
            <button
              onClick={() => { setShowDeferPanel(!showDeferPanel); setActiveLogger(null); setShowNextStepPrompt(false); setShowQuickFollowUp(false); }}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium text-(--color-warning) transition-colors',
                showDeferPanel
                  ? 'border-(--color-warning)/50 bg-amber-950/20 light:bg-amber-50'
                  : 'border-(--color-border) hover:bg-(--color-surface-dim)',
              )}
            >
              דחה
            </button>
            {/* [Req #7] - Email template button */}
            <button
              onClick={openEmailTemplate}
              className="rounded-lg border border-sky-700 light:border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-400 light:text-sky-600 hover:bg-sky-950/20 light:hover:bg-sky-50 transition-colors"
              title="פתח מייל עם תבנית מוכנה"
            >
              שלח מייל
            </button>
            {quote.client?.phone && (
              <>
                <button
                  onClick={openWhatsApp}
                  className="rounded-lg border border-emerald-700 light:border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-400 light:text-emerald-600 hover:bg-emerald-950/20 light:hover:bg-emerald-50 transition-colors"
                >
                  שלח WA
                </button>
                {/* [Req #8] - WhatsApp Set & Forget: one-click send + auto-log */}
                <button
                  onClick={whatsAppSetAndForget}
                  disabled={addInteraction.isPending}
                  className="rounded-lg border border-emerald-700 light:border-emerald-300 bg-emerald-950/30 light:bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-400 light:text-emerald-700 hover:bg-emerald-950/50 light:hover:bg-emerald-100 transition-colors disabled:opacity-40"
                  title="שלח WA + תיעוד אוטומטי (לחיצה אחת)"
                >
                  {addInteraction.isPending ? '...' : 'WA שגר ושכח'}
                </button>
                {quote.sales_ammo.length > 0 && (
                  <button
                    onClick={openWhatsAppWithAmmo}
                    className="rounded-lg border border-emerald-700 light:border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-400 light:text-emerald-600 hover:bg-emerald-950/20 light:hover:bg-emerald-50 transition-colors"
                    title="שלח הודעה עם נקודות חוזק"
                  >
                    WA + נק' חוזק
                  </button>
                )}
              </>
            )}
            {quote.local_file_path && (
              <>
                {/* Copy path — works on both Tauri and web (clipboard API fallback) */}
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(quote.local_file_path!);
                    toast(
                      ok
                        ? isTauri ? 'הנתיב הועתק' : 'הנתיב הועתק — השתמש ב-VPN לשליפה'
                        : 'ההעתקה נכשלה',
                      ok ? 'success' : 'error',
                    );
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    isTauri
                      ? 'border-(--color-border) text-(--color-text-secondary) hover:bg-(--color-surface-dim)'
                      : 'border-amber-700 light:border-amber-300 text-amber-400 light:text-amber-700 hover:bg-amber-950/20 light:hover:bg-amber-50',
                  )}
                  title={quote.local_file_path}
                >
                  העתק נתיב
                </button>

                {/* Open folder — Tauri only; disabled with tooltip in web mode */}
                <button
                  onClick={isTauri ? async () => {
                    const ok = await openFileLocation(quote.local_file_path!);
                    if (!ok) toast('לא ניתן לפתוח תיקייה', 'error');
                  } : undefined}
                  disabled={!isTauri}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    isTauri
                      ? 'border-(--color-border) text-(--color-text-secondary) hover:bg-(--color-surface-dim)'
                      : 'border-(--color-border)/50 text-(--color-text-secondary)/30 cursor-not-allowed',
                  )}
                  title={
                    isTauri
                      ? 'פתח תיקייה במערכת הקבצים'
                      : 'פתיחת קבצים זמינה רק באפליקציית הדסקטופ (Tauri). במצב דפדפן, העתק את הנתיב והשתמש ב-VPN.'
                  }
                >
                  פתח תיקייה
                </button>

                {/* Cloud-mode notice — web only */}
                {!isTauri && (
                  <span className="rounded-lg border border-dashed border-amber-700 bg-amber-950/20 light:border-amber-300 light:bg-amber-50 px-3 py-1.5 text-xs text-amber-400 light:text-amber-700">
                    מצב ענן — גישה לקבצים דרך VPN בלבד
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Inline interaction logger ── */}
        {activeLogger && !showDeferPanel && (
          <InteractionLogger
            quoteId={quote.id}
            type={activeLogger}
            onClose={handleLoggerClose} // [Req #82] Triggers "what's next?" prompt
          />
        )}

        {/* [Req #82] "What's next?" dynamic prompt — shown after logging an interaction */}
        {showNextStepPrompt && !activeLogger && !showDeferPanel && (
          <div className="border-t border-(--color-border) bg-(--color-surface-dim) px-6 py-3 animate-fade-in">
            <p className="text-xs font-bold text-(--color-accent) mb-2">מה הצעד הבא?</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleNextStepAction('followup')}
                className="rounded-lg border border-(--color-accent)/30 px-3 py-1.5 text-xs font-semibold text-(--color-accent) hover:bg-(--color-accent)/5 transition-colors"
              >
                קבע מעקב
              </button>
              <button
                onClick={() => handleNextStepAction('defer')}
                className="rounded-lg border border-(--color-warning)/30 px-3 py-1.5 text-xs font-semibold text-(--color-warning) hover:bg-(--color-warning)/5 transition-colors"
              >
                דחה
              </button>
              <button
                onClick={() => handleNextStepAction('note')}
                className="rounded-lg border border-(--color-border) px-3 py-1.5 text-xs font-semibold text-(--color-text-secondary) hover:bg-(--color-surface) transition-colors"
              >
                הוסף הערה
              </button>
              <button
                onClick={() => handleNextStepAction('dismiss')}
                className="text-xs text-(--color-text-secondary)/40 hover:text-(--color-text-secondary) transition-colors"
              >
                סיימתי
              </button>
            </div>
          </div>
        )}

        {/* [Req #130] Quick follow-up date picker — shown from "what's next?" or header */}
        {showQuickFollowUp && !activeLogger && !showDeferPanel && (
          <div className="border-t border-(--color-border) bg-(--color-surface-dim) px-6 py-3 animate-fade-in">
            <p className="text-xs font-bold text-(--color-text-secondary) mb-2">קבע תאריך מעקב</p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setQuickFollowUp(1)} className="rounded-full border border-(--color-accent)/30 px-3 py-1 text-xs font-semibold text-(--color-accent) hover:bg-(--color-accent)/5 transition-colors">מחר</button>
              <button onClick={() => setQuickFollowUp(2)} className="rounded-full border border-(--color-border) px-3 py-1 text-xs font-semibold text-(--color-text-secondary) hover:bg-(--color-surface) transition-colors">בעוד יומיים</button>
              <button onClick={() => setQuickFollowUp(7)} className="rounded-full border border-(--color-border) px-3 py-1 text-xs font-semibold text-(--color-text-secondary) hover:bg-(--color-surface) transition-colors">בשבוע</button>
              <button onClick={() => setQuickFollowUp(14)} className="rounded-full border border-(--color-border) px-3 py-1 text-xs font-semibold text-(--color-text-secondary) hover:bg-(--color-surface) transition-colors">שבועיים</button>
              <button onClick={() => setShowQuickFollowUp(false)} className="text-xs text-(--color-text-secondary)/40 hover:text-(--color-text-secondary) transition-colors mr-2">ביטול</button>
            </div>
          </div>
        )}

        {/* ── Conditional Defer panel (requires reason category) ── */}
        {showDeferPanel && (
          <div className="border-t border-(--color-border) bg-(--color-surface-dim) px-6 py-4 space-y-3 animate-fade-in">
            <p className="text-xs font-bold text-(--color-warning)">דחיית הצעה — בחר סיבה</p>

            {/* Step 1: Reason category chips */}
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(DEFER_REASON_LABELS) as [DeferReasonCategory, string][]).map(([cat, label]) => (
                <button
                  key={cat}
                  onClick={() => setDeferCategory(deferCategory === cat ? null : cat)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    deferCategory === cat
                      ? 'border-(--color-warning) bg-(--color-warning)/10 text-(--color-warning)'
                      : 'border-(--color-border) text-(--color-text-secondary) hover:border-(--color-warning)/50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Step 2: Optional free-text note (shown after category selected) */}
            {deferCategory && (
              <>
                <textarea
                  value={deferReason}
                  onChange={(e) => setDeferReason(e.target.value)}
                  autoFocus
                  rows={2}
                  placeholder="פרטים נוספים (לא חובה)..."
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
              </>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={saveDeferral}
                disabled={!deferCategory || !deferWakeUp || addInteraction.isPending || updateQuote.isPending}
                className="rounded-lg bg-(--color-warning) px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-30 hover:opacity-90"
              >
                {(addInteraction.isPending || updateQuote.isPending) ? '...' : 'דחה'}
              </button>
              <button
                onClick={() => { setShowDeferPanel(false); setDeferCategory(null); setDeferReason(''); setDeferWakeUp(''); }}
                className="text-sm text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)"
              >
                ביטול
              </button>
              {!deferCategory ? (
                <span className="mr-auto text-[10px] font-semibold text-(--color-warning)">חובה לבחור סיבה</span>
              ) : !deferWakeUp ? (
                <span className="mr-auto text-[10px] font-semibold text-(--color-warning)">חובה תאריך התעוררות</span>
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
                    <SingleInteractionRow
                      key={row.interaction.id}
                      ix={row.interaction}
                      onSoftDelete={() => {
                        // [Req #148] Soft delete with undo-style confirmation
                        softDeleteInteraction.mutate(
                          { id: row.interaction.id, quoteId: quote.id },
                          { onSuccess: () => toast('הערה נמחקה (שמורה ביומן ביקורת)', 'success') },
                        );
                      }}
                      isDeleting={softDeleteInteraction.isPending}
                    />
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

function SingleInteractionRow({ ix, onSoftDelete, isDeleting }: { ix: Interaction; onSoftDelete?: () => void; isDeleting?: boolean }) {
  const isPending = ix.release_status === 'pending';

  return (
    <div className={cn(
      'flex gap-3 border-r-2 pr-4 pb-4 group/row',
      // [Req #112] Milestone events get a highlighted border
      ix.is_milestone ? 'border-violet-500 light:border-violet-400' :
      isPending ? 'border-amber-700 light:border-amber-300 opacity-60' : 'border-(--color-border)',
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-(--color-accent)">
            {INTERACTION_LABELS[ix.type] ?? ix.type}
          </span>
          {isPending && (
            <span className="text-[10px] font-bold text-amber-400 light:text-amber-600 bg-amber-950/30 light:bg-amber-50 px-1.5 py-0.5 rounded">
              ישוחרר ביום ראשון
            </span>
          )}
          {ix.outcome && (
            <span className={cn(
              'text-xs font-semibold',
              ix.outcome === 'reached' ? 'text-emerald-400 light:text-emerald-600' : 'text-(--color-text-secondary)/60',
            )}>
              {ix.outcome === 'reached' ? 'שוחחנו' : ix.outcome === 'no_answer' ? 'לא ענה' : 'לא זמין'}
            </span>
          )}
          {ix.defer_category && (
            <span className="text-[10px] font-semibold text-(--color-warning) bg-amber-950/20 light:bg-amber-50 px-1.5 py-0.5 rounded">
              {DEFER_REASON_LABELS[ix.defer_category]}
            </span>
          )}
          {/* [Req #178] Direction indicator — pull (client-initiated) gets visual marker */}
          {ix.direction === 'pull' && (
            <span className="text-[10px] font-semibold text-teal-400 light:text-teal-600 bg-teal-950/20 light:bg-teal-50 px-1.5 py-0.5 rounded">
              {DIRECTION_LABELS.pull}
            </span>
          )}
          {/* [Req #112] Milestone badge */}
          {ix.is_milestone && (
            <span className="text-[10px] font-bold text-violet-400 light:text-violet-600 bg-violet-950/20 light:bg-violet-50 px-1.5 py-0.5 rounded">
              ★ אבן דרך
            </span>
          )}
          <span className="text-xs text-(--color-text-secondary)">{timeAgo(ix.created_at)}</span>
        </div>
        {ix.content && ix.content !== 'לא ענה' && (
          <p className="mt-0.5 text-sm text-(--color-text)">{ix.content}</p>
        )}
        {/* [Req #239] Micro-text memory anchor */}
        {ix.micro_text && (
          <p className="mt-0.5 text-[10px] font-semibold text-amber-400 light:text-amber-600">
            🔖 {ix.micro_text}
          </p>
        )}
      </div>
      {/* [Req #148] Soft delete button — visible on hover, hidden by default */}
      {onSoftDelete && ix.type !== 'system' && (
        <button
          onClick={onSoftDelete}
          disabled={isDeleting}
          className="shrink-0 self-start opacity-0 group-hover/row:opacity-100 text-[10px] text-(--color-text-secondary)/30 hover:text-red-500 transition-all disabled:opacity-20"
          title="מחק הערה (נשמר ביומן ביקורת)"
        >
          ✕
        </button>
      )}
    </div>
  );
}
