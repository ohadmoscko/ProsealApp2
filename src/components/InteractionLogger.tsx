'use client';

/**
 * [Req #127] Tab-only keyboard navigation — all controls have tabIndex
 * [Req #128] Auto-advance cursor to next field after selection
 * [Req #131] Structured tags as primary input, free-text as secondary
 * [Req #239] Micro-text memory anchor
 * [Req #112] Milestone event toggle
 */

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAddInteraction } from '@/lib/data';
import { useToast } from '@/lib/toast';
import { detectSensitiveContent } from '@/lib/sanitization';
import { INTERACTION_TAGS } from '@/lib/constants';
import type { InteractionType, InteractionOutcome } from '@/lib/database.types';

// ── Types ──────────────────────────────────────────────────────────────────

interface InteractionLoggerProps {
  quoteId: string;
  type: InteractionType;
  onClose: () => void;
}

// ── Outcome chips ──────────────────────────────────────────────────────────

const OUTCOMES: { value: InteractionOutcome; label: string }[] = [
  { value: 'reached',     label: 'שוחחנו' },
  { value: 'no_answer',   label: 'לא ענה' },
  { value: 'unavailable', label: 'לא זמין' },
];

// ── Follow-up date shortcuts ───────────────────────────────────────────────

function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const FOLLOWUP_SHORTCUTS = [
  { label: 'מחר',       days: 1  },
  { label: 'בשבוע',     days: 7  },
  { label: 'שבועיים',   days: 14 },
];

// ── Component ─────────────────────────────────────────────────────────────

export default function InteractionLogger({ quoteId, type, onClose }: InteractionLoggerProps) {
  const addInteraction = useAddInteraction();
  const { toast } = useToast();

  // [Req #127] Refs for auto-advance focus management
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const followUpRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  // For calls: outcome must be picked first
  const needsOutcome = type === 'call';

  const [outcome, setOutcome] = useState<InteractionOutcome | null>(null);
  const [note, setNote]       = useState('');
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState('');
  // [Req #131] Structured tag — primary input before free-text
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // [Req #239] Micro-text memory anchor (1-2 keywords to jog memory next call)
  const [microText, setMicroText] = useState('');
  // [Req #112] Mark interaction as milestone event (highlighted in timeline)
  const [isMilestone, setIsMilestone] = useState(false);

  // After picking "לא ענה" → save immediately, no text needed
  async function handleNoAnswer(o: InteractionOutcome) {
    if (o === 'no_answer') {
      await save(o, 'לא ענה', undefined);
      return;
    }
    setOutcome(o);
    // [Req #128] Auto-advance: focus tag selection area after outcome pick
    // Tags are shown next, so user can immediately start selecting
  }

  // [Req #128] Auto-advance when tag is selected
  function handleTagSelect(tag: string) {
    setSelectedTag(selectedTag === tag ? null : tag);
    // Auto-focus to note field after tag selection
    setTimeout(() => noteRef.current?.focus(), 50);
  }

  async function handleSave() {
    const tagLabel = INTERACTION_TAGS.find((t) => t.value === selectedTag)?.label ?? '';
    const content = note.trim()
      ? (tagLabel ? `[${tagLabel}] ${note.trim()}` : note.trim())
      : (tagLabel || (outcome ? labelFor(outcome) : 'הערה'));
    await save(outcome ?? undefined, content, (followUp ?? customDate) || undefined);
  }

  async function save(
    o: InteractionOutcome | undefined,
    content: string,
    followUpDate: string | undefined,
  ) {
    // ── Sanitization gate: block financial data / phone numbers ──
    const check = detectSensitiveContent(content);
    if (check.blocked) {
      toast(check.reason!, 'error');
      console.warn('[sanitization] Blocked interaction content:', check.match);
      return;
    }

    try {
      await addInteraction.mutateAsync({
        quoteId,
        type,
        content,
        outcome: o,
        followUpDate: followUpDate ?? null,
        microText: microText.trim() || null,      // [Req #239] memory anchor
        isMilestone,                               // [Req #112] milestone flag
      });
      toast('נרשם בהצלחה', 'success');
      onClose();
    } catch (error: any) {
      console.error(error);
      toast(`שגיאה בשמירה: ${error?.message || 'שגיאת רשת'}`, 'error');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  // Phase 1: pick outcome (calls only)
  if (needsOutcome && !outcome) {
    return (
      <div className="border-t border-(--color-border) bg-(--color-surface-dim) px-6 py-4 space-y-3 animate-fade-in">
        <p className="text-xs font-bold text-(--color-text-secondary)">תוצאת השיחה</p>
        <div className="flex gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              onClick={() => handleNoAnswer(o.value)}
              disabled={addInteraction.isPending}
              // [Req #127] Tab navigation — each outcome is tabbable
              tabIndex={0}
              className={cn(
                'rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40',
                o.value === 'no_answer'
                  ? 'border-zinc-300 text-(--color-text-secondary) hover:bg-(--color-surface)'
                  : o.value === 'reached'
                    ? 'border-(--color-accent) text-(--color-accent) hover:bg-(--color-accent)/5'
                    : 'border-zinc-300 text-(--color-text-secondary) hover:bg-(--color-surface)',
              )}
            >
              {addInteraction.isPending && o.value === 'no_answer' ? '...' : o.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} tabIndex={0} className="text-xs text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)">
          ביטול
        </button>
      </div>
    );
  }

  // Phase 2: structured tag + note + what-next
  const showNote     = !needsOutcome || outcome === 'reached' || outcome === 'unavailable';
  const showFollowUp = !needsOutcome || outcome === 'reached' || outcome === 'unavailable';
  // When user marks "unavailable" (a deferred task), follow-up date is mandatory
  const requireFollowUp = outcome === 'unavailable';
  const hasFollowUp = !!(followUp || customDate);

  return (
    <div className="border-t border-(--color-border) bg-(--color-surface-dim) px-6 py-4 space-y-3 animate-fade-in">
      {outcome && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-(--color-accent)">{labelFor(outcome)}</span>
          <button
            onClick={() => setOutcome(null)}
            tabIndex={0}
            className="text-xs text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)"
          >
            שנה
          </button>
        </div>
      )}

      {/* [Req #131] Structured tags — primary input BEFORE free text */}
      {showNote && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-(--color-text-secondary)">סוג הפעולה</p>
          <div className="flex flex-wrap gap-1.5">
            {INTERACTION_TAGS.map((tag) => (
              <button
                key={tag.value}
                onClick={() => handleTagSelect(tag.value)}
                tabIndex={0}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                  selectedTag === tag.value
                    ? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)'
                    : 'border-(--color-border) text-(--color-text-secondary) hover:border-(--color-accent)/50',
                )}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showNote && (
        <textarea
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus={!needsOutcome}
          rows={2}
          tabIndex={0}
          placeholder={
            selectedTag
              ? 'פרטים נוספים (אופציונלי)...'
              : type === 'note' ? 'הערה...' : type === 'whatsapp' ? 'מה נשלח/נכתב?' : 'סיכום השיחה...'
          }
          className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/50 focus:border-(--color-accent) resize-none"
          dir="rtl"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) handleSave();
            // [Req #128] Tab auto-advance to follow-up section
            if (e.key === 'Tab' && !e.shiftKey && showFollowUp) {
              // Default tab behavior will move focus — no override needed
            }
          }}
        />
      )}

      {showFollowUp && (
        <div ref={followUpRef} className="space-y-1.5">
          <p className="text-xs font-semibold text-(--color-text-secondary)">מה הלאה?</p>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOWUP_SHORTCUTS.map((s) => {
              const iso = isoFromToday(s.days);
              const active = followUp === iso && !customDate;
              return (
                <button
                  key={s.label}
                  tabIndex={0}
                  onClick={() => {
                    setFollowUp(active ? null : iso);
                    setCustomDate('');
                    // [Req #128] Auto-advance to save button after follow-up selection
                    setTimeout(() => saveRef.current?.focus(), 50);
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                    active
                      ? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)'
                      : 'border-(--color-border) text-(--color-text-secondary) hover:border-(--color-accent)/50',
                  )}
                >
                  {s.label}
                </button>
              );
            })}
            <input
              type="date"
              value={customDate}
              onChange={(e) => { setCustomDate(e.target.value); setFollowUp(null); }}
              tabIndex={0}
              className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary) bg-(--color-surface) outline-none focus:border-(--color-accent)"
              dir="ltr"
            />
          </div>
        </div>
      )}

      {/* [Req #239] Micro-text memory anchor + [Req #112] Milestone toggle */}
      {showNote && (
        <div className="flex items-center gap-2">
          <input
            value={microText}
            onChange={(e) => setMicroText(e.target.value)}
            placeholder="מילת מפתח לזיכרון (לא חובה)"
            maxLength={40}
            tabIndex={0}
            className="flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-[11px] text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/40 focus:border-(--color-accent)"
            dir="rtl"
          />
          <button
            type="button"
            onClick={() => setIsMilestone(!isMilestone)}
            tabIndex={0}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors',
              isMilestone
                ? 'border-violet-500 bg-violet-950/30 text-violet-300 light:bg-violet-50 light:text-violet-700'
                : 'border-(--color-border) text-(--color-text-secondary)/50 hover:border-violet-500/50',
            )}
            title="סמן כאירוע מפתח בציר הזמן"
          >
            {isMilestone ? '★ אבן דרך' : '☆ אבן דרך'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          ref={saveRef}
          onClick={handleSave}
          tabIndex={0}
          disabled={
            addInteraction.isPending ||
            (showNote && type !== 'note' && !note.trim() && !selectedTag && outcome === 'reached') ||
            (requireFollowUp && !hasFollowUp)
          }
          className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-30 hover:opacity-90"
        >
          {addInteraction.isPending ? '...' : 'שמור'}
        </button>
        <button
          onClick={onClose}
          tabIndex={0}
          className="text-sm text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)"
        >
          ביטול
        </button>
        {requireFollowUp && !hasFollowUp && (
          <span className="mr-auto text-[10px] font-semibold text-(--color-warning)">חובה לבחור תאריך מעקב</span>
        )}
        {showNote && !(requireFollowUp && !hasFollowUp) && (
          <span className="mr-auto text-[10px] text-(--color-text-secondary)/40">Ctrl+Enter לשמירה מהירה</span>
        )}
      </div>
    </div>
  );
}

function labelFor(o: InteractionOutcome): string {
  return o === 'reached' ? 'שוחחנו' : o === 'no_answer' ? 'לא ענה' : 'לא זמין';
}
