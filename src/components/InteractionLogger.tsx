'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAddInteraction } from '@/lib/data';
import { useToast } from '@/lib/toast';
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

  // For calls: outcome must be picked first
  const needsOutcome = type === 'call';

  const [outcome, setOutcome] = useState<InteractionOutcome | null>(null);
  const [note, setNote]       = useState('');
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState('');

  // After picking "לא ענה" → save immediately, no text needed
  async function handleNoAnswer(o: InteractionOutcome) {
    if (o === 'no_answer') {
      await save(o, 'לא ענה', undefined);
      return;
    }
    setOutcome(o);
  }

  async function handleSave() {
    const content = note.trim() || (outcome ? labelFor(outcome) : 'הערה');
    await save(outcome ?? undefined, content, (followUp ?? customDate) || undefined);
  }

  async function save(
    o: InteractionOutcome | undefined,
    content: string,
    followUpDate: string | undefined,
  ) {
    try {
      await addInteraction.mutateAsync({
        quoteId,
        type,
        content,
        outcome: o,
        followUpDate: followUpDate ?? null,
      });
      toast('נרשם בהצלחה', 'success');
      onClose();
    } catch {
      toast('שגיאה בשמירה', 'error');
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
        <button onClick={onClose} className="text-xs text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)">
          ביטול
        </button>
      </div>
    );
  }

  // Phase 2: note + what-next
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
            className="text-xs text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)"
          >
            שנה
          </button>
        </div>
      )}

      {showNote && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
          rows={2}
          placeholder={type === 'note' ? 'הערה...' : type === 'whatsapp' ? 'מה נשלח/נכתב?' : 'סיכום השיחה...'}
          className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/50 focus:border-(--color-accent) resize-none"
          dir="rtl"
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleSave()}
        />
      )}

      {showFollowUp && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-(--color-text-secondary)">מה הלאה?</p>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOWUP_SHORTCUTS.map((s) => {
              const iso = isoFromToday(s.days);
              const active = followUp === iso && !customDate;
              return (
                <button
                  key={s.label}
                  onClick={() => { setFollowUp(active ? null : iso); setCustomDate(''); }}
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
              className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary) bg-(--color-surface) outline-none focus:border-(--color-accent)"
              dir="ltr"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={
            addInteraction.isPending ||
            (showNote && type !== 'note' && !note.trim() && outcome === 'reached') ||
            (requireFollowUp && !hasFollowUp)
          }
          className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-30 hover:opacity-90"
        >
          {addInteraction.isPending ? '...' : 'שמור'}
        </button>
        <button
          onClick={onClose}
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
