import { cn, tempLabel } from '@/lib/utils';
import type { Quote, Client } from '@/lib/database.types';

interface CopilotBriefingProps {
  quotes: (Quote & { client?: Client })[];
  onFocusQuote: (id: string) => void;
}

export default function CopilotBriefing({ quotes, onFocusQuote }: CopilotBriefingProps) {
  if (!quotes || quotes.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);

  // Buckets
  const overdueFollowUps = quotes.filter(
    (q) => q.follow_up_date && q.follow_up_date <= today && !['won', 'lost', 'dormant'].includes(q.status),
  );
  const hotQuotes = quotes.filter(
    (q) => q.temperature >= 4 && !['won', 'lost', 'dormant'].includes(q.status),
  );
  const forgotten = quotes.filter(
    (q) =>
      (q.days_since_contact ?? 0) >= 4 &&
      q.temperature < 4 &&
      !['won', 'lost', 'dormant', 'waiting'].includes(q.status),
  );
  const waitingQuotes = quotes.filter((q) => q.status === 'waiting');

  // Build briefing lines
  const lines: { text: string; quoteId?: string; severity: 'danger' | 'warn' | 'info' | 'muted' }[] = [];

  if (hotQuotes.length > 0) {
    lines.push({
      text: `${hotQuotes.length} הצעות ${tempLabel(4)}+ דורשות טיפול`,
      severity: 'danger',
    });
    for (const q of hotQuotes.slice(0, 3)) {
      lines.push({
        text: `${q.quote_number} (${q.client?.code ?? '?'}) — ${tempLabel(q.temperature)}`,
        quoteId: q.id,
        severity: 'danger',
      });
    }
  }

  if (overdueFollowUps.length > 0) {
    lines.push({
      text: `${overdueFollowUps.length} מעקבים שעבר זמנם`,
      severity: 'warn',
    });
    for (const q of overdueFollowUps.slice(0, 3)) {
      lines.push({
        text: `${q.quote_number} — מעקב: ${q.follow_up_date}`,
        quoteId: q.id,
        severity: 'warn',
      });
    }
  }

  if (forgotten.length > 0) {
    lines.push({
      text: `${forgotten.length} הצעות נשכחו (${forgotten[0].days_since_contact}+ ימים)`,
      severity: 'warn',
    });
  }

  if (waitingQuotes.length > 0) {
    lines.push({
      text: `${waitingQuotes.length} ממתינות לתגובת לקוח`,
      severity: 'muted',
    });
  }

  const activeCount = quotes.filter(
    (q) => !['won', 'lost', 'dormant'].includes(q.status),
  ).length;

  if (lines.length === 0) {
    lines.push({ text: `${activeCount} הצעות פתוחות. הכל תחת שליטה.`, severity: 'info' });
  }

  return (
    <div className="border-b border-(--color-border) bg-(--color-surface-dim) px-6 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-bold text-(--color-text-secondary)">תדריך בוקר</span>
        <span className="text-[10px] text-(--color-text-secondary)/40">{activeCount} הצעות פעילות</span>
      </div>
      <div className="space-y-0.5">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                line.severity === 'danger' && 'bg-red-500',
                line.severity === 'warn' && 'bg-amber-500',
                line.severity === 'info' && 'bg-emerald-500',
                line.severity === 'muted' && 'bg-(--color-text-secondary)/30',
              )}
            />
            {line.quoteId ? (
              <button
                onClick={() => onFocusQuote(line.quoteId!)}
                className="text-xs text-(--color-text) hover:text-(--color-accent) transition-colors text-right"
              >
                {line.text}
              </button>
            ) : (
              <span
                className={cn(
                  'text-xs',
                  line.severity === 'danger' && 'font-semibold text-red-600 dark:text-red-400',
                  line.severity === 'warn' && 'font-semibold text-amber-600 dark:text-amber-400',
                  line.severity === 'info' && 'text-(--color-text)',
                  line.severity === 'muted' && 'text-(--color-text-secondary)/60',
                )}
              >
                {line.text}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
