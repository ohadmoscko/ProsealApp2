import { useState, type KeyboardEvent, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useAddCapture } from '@/lib/data';
import { useToast } from '@/lib/toast';
import { detectSensitiveContent } from '@/lib/sanitization';

interface CaptureBarProps {
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** Slash command hints shown as user types */
const SLASH_COMMANDS = [
  { prefix: '/מ ', label: 'ממתין למנכ"ל', desc: 'סמן כממתין לאישור מאור' },
  { prefix: '/מאור ', label: 'הודעה למנכ"ל', desc: 'הודעה ישירה שתופיע בדוח' },
];

export default function CaptureBar({ inputRef }: CaptureBarProps) {
  const [text, setText] = useState('');
  const { toast } = useToast();
  const addCapture = useAddCapture();

  // Detect active slash command
  const activeSlash = SLASH_COMMANDS.find((cmd) => text.startsWith(cmd.prefix));
  const showHints = text === '/' || text === '/מ' || text === '/מא' || text === '/מאו' || text === '/מאור';

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || addCapture.isPending) return;

    // ── Sanitization gate: block financial data / phone numbers ──
    const check = detectSensitiveContent(trimmed);
    if (check.blocked) {
      toast(check.reason!, 'error');
      console.warn('[sanitization] Blocked capture content:', check.match);
      return;
    }

    try {
      await addCapture.mutateAsync(trimmed);
      setText('');
    } catch (error: any) {
      console.error(error);
      toast(`שגיאה בשמירת האירוע: ${error?.message || 'שגיאת מסד נתונים'}`, 'error');
    } finally {
      inputRef?.current?.focus();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function applySlash(prefix: string) {
    setText(prefix);
    inputRef?.current?.focus();
  }

  return (
    <div className="shrink-0 border-t border-(--color-border) bg-(--color-surface) px-4 py-2.5">
      {/* Slash command hints */}
      {showHints && (
        <div className="mx-auto max-w-3xl mb-2 flex gap-2">
          {SLASH_COMMANDS.map((cmd) => (
            <button
              key={cmd.prefix}
              onClick={() => applySlash(cmd.prefix)}
              className="rounded-lg border border-(--color-border) bg-(--color-surface-dim) px-3 py-1.5 text-right transition-colors hover:border-(--color-accent)/50"
            >
              <span className="text-xs font-semibold text-(--color-accent)">{cmd.prefix.trim()}</span>
              <span className="mr-1.5 text-[10px] text-(--color-text-secondary)">{cmd.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="תקליד משהו... AI יטפל בשאר"
          className={cn(
            'flex-1 rounded-xl border px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/50 transition-colors',
            activeSlash
              ? 'border-amber-700 bg-amber-950/10 light:border-amber-400 light:bg-amber-50/50'
              : 'border-(--color-border) bg-(--color-surface-dim) focus:border-(--color-accent)',
          )}
          dir="rtl"
          disabled={addCapture.isPending}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || addCapture.isPending}
          className="rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-30 hover:opacity-90"
        >
          {addCapture.isPending ? '...' : 'שלח'}
        </button>
      </div>

      {/* Active slash command indicator */}
      {activeSlash && (
        <div className="mx-auto max-w-3xl mt-1">
          <span className="text-[10px] font-semibold text-amber-400 light:text-amber-600">
            {activeSlash.label}
          </span>
        </div>
      )}
    </div>
  );
}