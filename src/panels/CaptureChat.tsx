import { useEffect, useRef } from 'react';
import { cn, timeAgo } from '@/lib/utils';
import { useCaptures } from '@/lib/data';
import type { Capture } from '@/lib/database.types';

/** Category badge for AI-parsed captures */
const CATEGORY_COLORS: Record<string, string> = {
  'הצעה': 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  'משלוח': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  'תקלה': 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  'לקוח': 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  'הודעה_למנכל': 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  'כללי': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400',
};

function categoryLabel(cat: string): string {
  if (cat === 'הודעה_למנכל') return 'למנכ"ל';
  return cat;
}

export default function CaptureChat() {
  const { data: captures = [], isLoading } = useCaptures();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new captures arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [captures.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-(--color-border) px-6 py-4 shrink-0">
        <h2 className="text-lg font-bold text-(--color-text)">דוח שבועי</h2>
        <p className="text-xs text-(--color-text-secondary)">
          תקליד אירועים לאורך השבוע. ה-AI מעבד, מקטלג ומכין דוח.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-(--color-text-secondary)/50">טוען...</p>
          </div>
        ) : captures.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-2">
              <p className="text-sm text-(--color-text-secondary)/50">
                עדיין אין אירועים השבוע. תתחיל להקליד למטה.
              </p>
              <div className="text-[10px] text-(--color-text-secondary)/30 space-y-0.5">
                <p>/מ — סמן כממתין למנכ"ל</p>
                <p>/מאור — הודעה ישירה למנכ"ל בדוח</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {captures.map((c) => (
              <CaptureRow key={c.id} capture={c} />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}

function CaptureRow({ capture: c }: { capture: Capture }) {
  const parsed = c.ai_parsed as Record<string, unknown> | null;
  const category = parsed?.category as string | undefined;
  const importance = parsed?.importance as string | undefined;

  return (
    <div className="space-y-1">
      {/* User message */}
      <div className="flex justify-end">
        <div className={cn(
          'max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5',
          c.raw_text.startsWith('/מאור')
            ? 'bg-amber-100/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
            : 'bg-(--color-accent)/10',
        )}>
          <p className="text-sm text-(--color-text)">{c.raw_text}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] text-(--color-text-secondary)/60">
              {timeAgo(c.created_at)}
            </span>
            {category && (
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                CATEGORY_COLORS[category] ?? CATEGORY_COLORS['כללי'],
              )}>
                {categoryLabel(category)}
              </span>
            )}
            {importance === 'high' && (
              <span className="text-[9px] font-bold text-red-600 dark:text-red-400">חשוב</span>
            )}
          </div>
        </div>
      </div>

      {/* AI response */}
      {c.ai_response ? (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-(--color-surface-dim) border border-(--color-border) px-4 py-2.5">
            <p className="text-sm text-(--color-text)">{c.ai_response}</p>
          </div>
        </div>
      ) : c.status === 'pending' ? (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-bl-md bg-(--color-surface-dim) border border-(--color-border) px-4 py-2">
            <span className="text-xs text-(--color-text-secondary)/50 animate-pulse">מעבד...</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
