import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useGenerateWeeklyReport, type WeeklyReport as WeeklyReportData } from '@/lib/data';

const MOOD_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  positive: { bg: 'bg-emerald-50 dark:bg-emerald-950/20', text: 'text-emerald-700 dark:text-emerald-300', label: 'תקין' },
  neutral:  { bg: 'bg-sky-50 dark:bg-sky-950/20', text: 'text-sky-700 dark:text-sky-300', label: 'שגרתי' },
  warning:  { bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-300', label: 'דורש תשומת לב' },
  critical: { bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-300', label: 'דחוף' },
};

export default function WeeklyReport() {
  const generateReport = useGenerateWeeklyReport();
  const [report, setReport] = useState<WeeklyReportData | null>(null);

  async function handleGenerate() {
    try {
      const result = await generateReport.mutateAsync();
      setReport(result);
    } catch {
      // Error handled by mutation state
    }
  }

  const mood = report ? MOOD_STYLES[report.mood] ?? MOOD_STYLES.neutral : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-(--color-border) px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-(--color-text)">דוח שבועי למנכ"ל</h2>
            <p className="text-xs text-(--color-text-secondary)">
              {report
                ? `${report.week_start} — ${report.week_end}`
                : 'לחץ "הפק דוח" לבניית סיכום שבועי מבוסס AI'}
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generateReport.isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
              generateReport.isPending
                ? 'bg-(--color-border) text-(--color-text-secondary) cursor-wait'
                : 'bg-(--color-accent) text-white hover:opacity-90',
            )}
          >
            {generateReport.isPending ? 'מפיק דוח...' : 'הפק דוח'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {generateReport.isPending && (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center space-y-3">
              <div className="mx-auto h-8 w-8 rounded-full border-2 border-(--color-accent) border-t-transparent animate-spin" />
              <p className="text-sm text-(--color-text-secondary)">
                ה-AI מנתח את הנתונים ומכין דוח שבועי...
              </p>
            </div>
          </div>
        )}

        {generateReport.isError && !report && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4 text-sm text-red-700 dark:text-red-300">
            שגיאה ביצירת הדוח. ודא שהגדרת את ANTHROPIC_API_KEY בהגדרות Supabase.
            <br />
            <span className="text-xs opacity-70">{generateReport.error?.message}</span>
          </div>
        )}

        {!report && !generateReport.isPending && !generateReport.isError && (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center space-y-2 max-w-sm">
              <p className="text-sm text-(--color-text-secondary)/60">
                הדוח השבועי אוסף את כל הנתונים מהשבוע האחרון — הצעות מחיר, אינטראקציות,
                הקלדות, והודעות למנכ"ל — ומייצר סיכום ניהולי באמצעות AI.
              </p>
              <p className="text-xs text-(--color-text-secondary)/40">
                כל הקלדה שנרשמה ב-Capture Bar תופיע בדוח
              </p>
            </div>
          </div>
        )}

        {report && !generateReport.isPending && (
          <div className="space-y-5 max-w-2xl">
            {/* Mood badge */}
            {mood && (
              <div className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1', mood.bg)}>
                <span className={cn('text-xs font-bold', mood.text)}>{mood.label}</span>
              </div>
            )}

            {/* Executive summary */}
            <section>
              <h3 className="text-sm font-bold text-(--color-text) mb-2">תקציר מנהלים</h3>
              <p className="text-sm text-(--color-text) leading-relaxed bg-(--color-surface-dim) rounded-lg p-4 border border-(--color-border)">
                {report.executive_summary}
              </p>
            </section>

            {/* Stats grid */}
            <section className="grid grid-cols-3 gap-3">
              <StatCard label="הצעות פעילות" value={report.raw_stats.total_active} />
              <StatCard label="חדשות השבוע" value={report.raw_stats.new_this_week} accent />
              <StatCard label="זכיות" value={report.raw_stats.closed_won} positive />
              <StatCard label="הפסדים" value={report.raw_stats.closed_lost} negative />
              <StatCard label="אינטראקציות" value={report.raw_stats.interactions_count} />
              <StatCard label="הקלדות" value={report.raw_stats.captures_count} />
            </section>

            {/* Highlights */}
            {report.highlights.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-(--color-text) mb-2">נקודות עיקריות</h3>
                <ul className="space-y-1.5">
                  {report.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-(--color-text)">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Risks */}
            {report.risks.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-red-600 dark:text-red-400 mb-2">סיכונים</h3>
                <ul className="space-y-1.5">
                  {report.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-(--color-text)">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Action items */}
            {report.action_items.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-amber-600 dark:text-amber-400 mb-2">פעולות נדרשות</h3>
                <ul className="space-y-1.5">
                  {report.action_items.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-(--color-text)">
                      <span className="mt-1 .5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* CEO messages */}
            {report.ceo_messages.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-(--color-accent) mb-2">הודעות למנכ"ל</h3>
                <div className="space-y-2">
                  {report.ceo_messages.map((m, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 px-4 py-2.5 text-sm text-(--color-text)"
                    >
                      {m}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Footer */}
            <div className="border-t border-(--color-border) pt-3 text-[10px] text-(--color-text-secondary)/40">
              נוצר ב-{new Date(report.generated_at).toLocaleString('he-IL')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, positive, negative }: {
  label: string;
  value: number;
  accent?: boolean;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 text-center">
      <div className={cn(
        'text-xl font-bold',
        accent && 'text-(--color-accent)',
        positive && 'text-emerald-600 dark:text-emerald-400',
        negative && value > 0 && 'text-red-600 dark:text-red-400',
        !accent && !positive && !negative && 'text-(--color-text)',
      )}>
        {value}
      </div>
      <div className="text-[10px] text-(--color-text-secondary) mt-0.5">{label}</div>
    </div>
  );
}
