/**
 * [Req #163] Modernized 7-category CEO Weekly Report
 * [Req #164] Permanent sticky header with key metrics
 * [Req #165] Drill-down accordion tiles
 * [Req #196] Cube tiles with quick-switch navigation in drill-down
 * [Req #197] Deferred alert batching indicator
 * [Req #198] Strategic transparency — balanced problems + achievements
 * [Req #199] Optimized for quick reading (mobile responsive)
 * [Req #201] Prevent scrolling — paginated drill-down (5 items/page)
 * [Req #204] CEO feedback-to-action conversion
 * [Req #167] Auto-collapse recurring blockers
 * [Req #177] Cool-down surfacing
 * [Req #218] Clear report status indication
 */

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  useGenerateWeeklyReport,
  useCeoFeedback,
  useAddCeoFeedback,
  useUpdateCeoFeedback,
  type WeeklyReport as WeeklyReportData,
  type ReportCategory,
  type ReportCategoryItem,
  type CoolDownQuote,
} from '@/lib/data';
import type { CeoFeedbackType, CeoActionStatus } from '@/lib/database.types';

// ── Mood styles ──────────────────────────────────────────────────

const MOOD_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  positive: { bg: 'bg-emerald-950/20 light:bg-emerald-50', text: 'text-emerald-300 light:text-emerald-700', label: 'תקין' },
  neutral:  { bg: 'bg-sky-950/20 light:bg-sky-50', text: 'text-sky-300 light:text-sky-700', label: 'שגרתי' },
  warning:  { bg: 'bg-amber-950/20 light:bg-amber-50', text: 'text-amber-300 light:text-amber-700', label: 'דורש תשומת לב' },
  critical: { bg: 'bg-red-950/20 light:bg-red-50', text: 'text-red-300 light:text-red-700', label: 'דחוף' },
};

// ── Severity badge colors ────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  ok: 'bg-emerald-950/30 text-emerald-300 light:bg-emerald-50 light:text-emerald-700',
  warn: 'bg-amber-950/30 text-amber-300 light:bg-amber-50 light:text-amber-700',
  critical: 'bg-red-950/30 text-red-300 light:bg-red-50 light:text-red-700',
};

// ── Item type colors ─────────────────────────────────────────────

const ITEM_DOT_COLOR: Record<string, string> = {
  highlight: 'bg-emerald-500',
  risk: 'bg-red-500',
  action: 'bg-amber-500',
  info: 'bg-sky-500',
};

// ── Report status type ───────────────────────────────────────────
// [Req #218] Clear report status indication
type ReportStatus = 'idle' | 'generating' | 'ready' | 'error';

// [Req #201] Items per page in drill-down
const ITEMS_PER_PAGE = 5;

// ── Component ────────────────────────────────────────────────────

export default function WeeklyReport() {
  const generateReport = useGenerateWeeklyReport();
  const [report, setReport] = useState<WeeklyReportData | null>(null);
  // [Req #196] Which cube category is expanded (null = overview mode)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  // [Req #177] Show cool-downs panel
  const [showCoolDowns, setShowCoolDowns] = useState(false);
  // [Req #218] Report status
  const reportStatus: ReportStatus = generateReport.isPending ? 'generating'
    : generateReport.isError && !report ? 'error'
      : report ? 'ready' : 'idle';

  // [Req #211] CEO simulation mode — clean preview without operator controls
  const [ceoPreviewMode, setCeoPreviewMode] = useState(false);

  async function handleGenerate() {
    try {
      const result = await generateReport.mutateAsync(undefined);
      setReport(result);
      setExpandedCategory(null);
      setShowCoolDowns(false);
    } catch {
      // Error handled by mutation state
    }
  }

  // [Req #196] Quick-switch to another category from drill-down
  function handleSwitchCategory(key: string) {
    setExpandedCategory(key);
    setShowCoolDowns(false);
  }

  const mood = report ? MOOD_STYLES[report.mood] ?? MOOD_STYLES.neutral : null;
  const categories = report?.categories ?? [];
  const coolDowns = report?.cool_downs ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* [Req #164] Sticky header with key metrics — always visible */}
      {/* [Req #199] Mobile: smaller padding, stacked layout */}
      <div className="border-b border-(--color-border) px-3 sm:px-6 py-2 sm:py-3 shrink-0 bg-(--color-surface)">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
            <h2 className="text-sm sm:text-lg font-bold text-(--color-text) whitespace-nowrap">דוח שבועי למנכ"ל</h2>
            {/* [Req #218] Status badge */}
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap',
              reportStatus === 'ready' && 'bg-emerald-950/30 text-emerald-300 light:bg-emerald-50 light:text-emerald-700',
              reportStatus === 'generating' && 'bg-amber-950/30 text-amber-300 light:bg-amber-50 light:text-amber-700 animate-pulse',
              reportStatus === 'error' && 'bg-red-950/30 text-red-300 light:bg-red-50 light:text-red-700',
              reportStatus === 'idle' && 'bg-zinc-800/30 text-zinc-400 light:bg-zinc-100 light:text-zinc-500',
            )}>
              {reportStatus === 'ready' ? 'מוכן' : reportStatus === 'generating' ? 'מייצר...' : reportStatus === 'error' ? 'שגיאה' : 'טרם הופק'}
            </span>
            {mood && report && (
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap', mood.bg, mood.text)}>
                {mood.label}
              </span>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generateReport.isPending}
            className={cn(
              'rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition-colors shrink-0',
              // [Req #199] Mobile: min touch target 44px
              'min-h-[44px] sm:min-h-0',
              generateReport.isPending
                ? 'bg-(--color-border) text-(--color-text-secondary) cursor-wait'
                : 'bg-(--color-accent) text-white hover:opacity-90',
            )}
          >
            {generateReport.isPending ? 'מפיק...' : report ? 'הפק מחדש' : 'הפק דוח'}
          </button>
          {/* [Req #211] CEO simulation button — preview as CEO */}
          {report && (
            <button
              onClick={() => setCeoPreviewMode(!ceoPreviewMode)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors shrink-0 min-h-[44px] sm:min-h-0',
                ceoPreviewMode
                  ? 'bg-violet-600 text-white'
                  : 'border border-(--color-border) text-(--color-text-secondary) hover:bg-violet-950/20 hover:text-violet-400',
              )}
            >
              {ceoPreviewMode ? '← חזור למצב עבודה' : '👁 תצוגת מנכ"ל'}
            </button>
          )}
        </div>

        {/* [Req #164] Key metrics strip — shown when report is ready */}
        {/* [Req #199] Mobile: horizontal scroll for metrics */}
        {report && (
          <div className="mt-2 flex gap-2 sm:gap-3 text-[10px] overflow-x-auto pb-1 scrollbar-none">
            <MetricChip label="פעילות" value={report.raw_stats.total_active} />
            <MetricChip label="חדשות" value={report.raw_stats.new_this_week} accent />
            <MetricChip label="זכיות" value={report.raw_stats.closed_won} positive />
            <MetricChip label="הפסדים" value={report.raw_stats.closed_lost} negative />
            <MetricChip label="בייצור" value={report.raw_stats.in_production} />
            <MetricChip label="נשלחו" value={report.raw_stats.shipped} />
            <MetricChip label="אינטראקציות" value={report.raw_stats.interactions_count} />
            {/* [Req #178] Push/pull ratio */}
            <span className="flex items-center gap-1 rounded-full bg-(--color-surface-dim) px-2 py-0.5 whitespace-nowrap shrink-0">
              <span className="font-bold text-(--color-text-secondary)">יוזמה:</span>
              <span className="font-bold text-(--color-accent)">{report.raw_stats.push_count}</span>
              <span className="text-(--color-text-secondary)/50">|</span>
              <span className="font-bold text-teal-400 light:text-teal-600">{report.raw_stats.pull_count}</span>
              <span className="font-bold text-(--color-text-secondary)">:לקוח</span>
            </span>
            {/* [Req #197] Deferred alert batch indicator */}
            {report.raw_stats.ceo_messages_count > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-violet-950/30 light:bg-violet-50 px-2 py-0.5 whitespace-nowrap shrink-0">
                <span className="font-bold text-violet-300 light:text-violet-700">
                  {report.raw_stats.ceo_messages_count} הודעות למנכ"ל
                </span>
              </span>
            )}
            <span className="text-xs text-(--color-text-secondary)/40 whitespace-nowrap shrink-0">
              {report.week_start} — {report.week_end}
            </span>
          </div>
        )}
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading state */}
        {generateReport.isPending && (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center space-y-3">
              <div className="mx-auto h-8 w-8 rounded-full border-2 border-(--color-accent) border-t-transparent animate-spin" />
              <p className="text-sm text-(--color-text-secondary)">ה-AI מנתח את הנתונים ומכין דוח שבועי...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {generateReport.isError && !report && (
          <div className="mx-3 sm:mx-6 mt-4 rounded-lg border border-red-800 bg-red-950/20 p-4 text-sm text-red-300 light:border-red-200 light:bg-red-50 light:text-red-700">
            שגיאה ביצירת הדוח. ודא שהגדרת את ANTHROPIC_API_KEY בהגדרות Supabase.
            <br />
            <span className="text-xs opacity-70">{generateReport.error?.message}</span>
          </div>
        )}

        {/* Empty state */}
        {!report && !generateReport.isPending && !generateReport.isError && (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center space-y-2 max-w-sm px-4">
              <p className="text-sm text-(--color-text-secondary)/60">
                הדוח השבועי אוסף את כל הנתונים מהשבוע האחרון — הצעות מחיר, אינטראקציות,
                הקלדות, והודעות למנכ"ל — ומייצר סיכום ניהולי ב-7 קטגוריות באמצעות AI.
              </p>
            </div>
          </div>
        )}

        {/* ── Report content ── */}
        {report && !generateReport.isPending && (
          <div className="px-3 sm:px-6 py-4 space-y-4 max-w-3xl">
            {/* Executive summary */}
            <div className="rounded-lg bg-(--color-surface-dim) border border-(--color-border) p-3 sm:p-4">
              <p className="text-sm text-(--color-text) leading-relaxed font-medium">{report.executive_summary}</p>
            </div>

            {/* [Req #196] Cube tiles — 7 category overview grid */}
            {/* [Req #199] Mobile: 2-col, tablet: 3-col, desktop: 4-col */}
            {!expandedCategory && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
                {categories.map((cat) => (
                  <CubeTile
                    key={cat.key}
                    category={cat}
                    onClick={() => setExpandedCategory(cat.key)}
                  />
                ))}
                {/* Cool-downs tile */}
                {coolDowns.length > 0 && (
                  <button
                    onClick={() => setShowCoolDowns(!showCoolDowns)}
                    className={cn(
                      'rounded-lg border p-3 text-right transition-all hover:shadow-md min-h-[44px]',
                      'border-blue-800 bg-blue-950/20 light:border-blue-200 light:bg-blue-50',
                    )}
                  >
                    <div className="text-lg mb-1">❄️</div>
                    <div className="text-xs font-bold text-blue-300 light:text-blue-700">התקררויות</div>
                    <div className="text-[10px] text-blue-400/70 light:text-blue-600 mt-0.5">
                      {coolDowns.length} הצעות התקררו
                    </div>
                  </button>
                )}
              </div>
            )}

            {/* [Req #177] Cool-downs panel */}
            {showCoolDowns && !expandedCategory && coolDowns.length > 0 && (
              <CoolDownPanel coolDowns={coolDowns} onClose={() => setShowCoolDowns(false)} />
            )}

            {/* [Req #165, #196] Drill-down view with category quick-switch */}
            {expandedCategory && (
              <DrillDownView
                category={categories.find((c) => c.key === expandedCategory)!}
                allCategories={categories}
                reportWeek={report.week_start}
                onBack={() => setExpandedCategory(null)}
                onSwitchCategory={handleSwitchCategory}
                ceoPreviewMode={ceoPreviewMode}
              />
            )}

            {/* [Req #137] Friday wrap — positive psychology closing summary */}
            <FridaySummary report={report} />

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

// ── Cube Tile component ──────────────────────────────────────────
// [Req #196] Clickable category tile for CEO drill-down
// [Req #199] Mobile-friendly with min touch target

function CubeTile({ category, onClick, compact }: { category: ReportCategory; onClick: () => void; compact?: boolean }) {
  const itemCount = category.items.length;
  const hasRisks = category.items.some((i) => i.type === 'risk' || i.type === 'action');
  // [Req #167] Count recurring blockers
  const recurringCount = category.items.filter((i) => i.is_recurring).length;

  if (compact) {
    // [Req #196] Compact tile for quick-switch sidebar in drill-down
    return (
      <button
        onClick={onClick}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-right transition-all hover:shadow-sm min-h-[36px] w-full',
          category.severity === 'critical' && 'border-red-700 bg-red-950/15 light:border-red-200 light:bg-red-50/80',
          category.severity === 'warn' && 'border-amber-700 bg-amber-950/15 light:border-amber-200 light:bg-amber-50/80',
          category.severity === 'ok' && 'border-(--color-border) bg-(--color-surface) hover:border-(--color-accent)/50',
        )}
      >
        <span className="text-sm">{category.icon}</span>
        <span className="text-[10px] font-bold text-(--color-text) flex-1 truncate">{category.title}</span>
        <span className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          category.severity === 'critical' && 'bg-red-500',
          category.severity === 'warn' && 'bg-amber-500',
          category.severity === 'ok' && 'bg-emerald-500',
        )} />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        // [Req #199] Mobile: min touch target 44px
        'rounded-lg border p-2 sm:p-3 text-right transition-all hover:shadow-md group min-h-[44px]',
        category.severity === 'critical' && 'border-red-700 bg-red-950/15 light:border-red-200 light:bg-red-50/80',
        category.severity === 'warn' && 'border-amber-700 bg-amber-950/15 light:border-amber-200 light:bg-amber-50/80',
        category.severity === 'ok' && 'border-(--color-border) bg-(--color-surface) hover:border-(--color-accent)/50',
      )}
    >
      {/* Icon + severity dot */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-lg">{category.icon}</span>
        <span className={cn(
          'w-2 h-2 rounded-full',
          category.severity === 'critical' && 'bg-red-500',
          category.severity === 'warn' && 'bg-amber-500',
          category.severity === 'ok' && 'bg-emerald-500',
        )} />
      </div>
      <div className="text-xs font-bold text-(--color-text)">{category.title}</div>
      <div className="text-[10px] text-(--color-text-secondary) mt-0.5 line-clamp-2">{category.summary}</div>
      {/* Item count badge */}
      <div className="mt-2 flex items-center gap-1.5">
        {itemCount > 0 && (
          <span className="text-[9px] font-bold text-(--color-text-secondary)/60">
            {itemCount} פריטים
          </span>
        )}
        {recurringCount > 0 && (
          <span className="text-[9px] font-bold text-amber-400 light:text-amber-600">
            {recurringCount} חוזרים
          </span>
        )}
        {hasRisks && (
          <span className="text-[9px] font-bold text-red-400 light:text-red-600">!</span>
        )}
      </div>
    </button>
  );
}

// ── Drill-Down View component ────────────────────────────────────
// [Req #165, #196, #201, #204] Drill-down with quick-switch, pagination, feedback

function DrillDownView({
  category,
  allCategories,
  reportWeek,
  onBack,
  onSwitchCategory,
  ceoPreviewMode = false,
}: {
  category: ReportCategory;
  allCategories: ReportCategory[];
  reportWeek: string;
  onBack: () => void;
  onSwitchCategory: (key: string) => void;
  ceoPreviewMode?: boolean;
}) {
  // [Req #167] Auto-collapse recurring items by default
  const [showRecurring, setShowRecurring] = useState(false);
  // [Req #201] Pagination state
  const [page, setPage] = useState(0);
  // [Req #204] Active feedback item index
  const [feedbackItemIdx, setFeedbackItemIdx] = useState<number | null>(null);

  const regularItems = category.items.filter((i) => !i.is_recurring);
  const recurringItems = category.items.filter((i) => i.is_recurring);

  // [Req #201] Paginated regular items
  const totalPages = Math.max(1, Math.ceil(regularItems.length / ITEMS_PER_PAGE));
  const pagedItems = regularItems.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  // Reset page when switching categories
  const [prevKey, setPrevKey] = useState(category.key);
  if (prevKey !== category.key) {
    setPrevKey(category.key);
    setPage(0);
    setShowRecurring(false);
    setFeedbackItemIdx(null);
  }

  // [Req #196] Other categories for quick-switch sidebar
  const otherCategories = allCategories.filter((c) => c.key !== category.key);

  return (
    <div className="space-y-3">
      {/* Back button + category header */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <button
          onClick={onBack}
          // [Req #199] Mobile touch target
          className="rounded-lg border border-(--color-border) px-2.5 py-1.5 text-xs font-bold text-(--color-text-secondary) hover:bg-(--color-surface-dim) transition-colors min-h-[36px]"
        >
          ← חזור
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{category.icon}</span>
          <h3 className="text-sm font-bold text-(--color-text) truncate">{category.title}</h3>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap', SEVERITY_STYLES[category.severity])}>
            {category.severity === 'ok' ? 'תקין' : category.severity === 'warn' ? 'תשומת לב' : 'דחוף'}
          </span>
        </div>
      </div>

      {/* Category summary */}
      <div className="rounded-lg bg-(--color-surface-dim) border border-(--color-border) px-3 sm:px-4 py-2.5">
        <p className="text-sm text-(--color-text)">{category.summary}</p>
      </div>

      {/* [Req #201] Paginated regular items */}
      {pagedItems.length > 0 && (
        <div className="space-y-1.5">
          {pagedItems.map((item, i) => {
            const globalIdx = page * ITEMS_PER_PAGE + i;
            return (
              <ReportItemRow
                key={globalIdx}
                item={item}
                itemIndex={globalIdx}
                categoryKey={category.key}
                reportWeek={reportWeek}
                showFeedback={!ceoPreviewMode && feedbackItemIdx === globalIdx}
                onToggleFeedback={() => setFeedbackItemIdx(feedbackItemIdx === globalIdx ? null : globalIdx)}
                hideFeedbackBtn={ceoPreviewMode}
              />
            );
          })}
        </div>
      )}

      {/* [Req #201] Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className={cn(
              'rounded-lg border border-(--color-border) px-3 py-1.5 text-xs font-bold transition-colors min-h-[36px]',
              page === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-(--color-surface-dim)',
            )}
          >
            → הקודם
          </button>
          <span className="text-[10px] font-bold text-(--color-text-secondary)">
            עמוד {page + 1} מתוך {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className={cn(
              'rounded-lg border border-(--color-border) px-3 py-1.5 text-xs font-bold transition-colors min-h-[36px]',
              page >= totalPages - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-(--color-surface-dim)',
            )}
          >
            הבא ←
          </button>
        </div>
      )}

      {/* [Req #167] Recurring blockers — auto-collapsed */}
      {recurringItems.length > 0 && (
        <div className="border border-amber-800/40 light:border-amber-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowRecurring(!showRecurring)}
            className={cn(
              'w-full flex items-center justify-between px-3 sm:px-4 py-2 text-right transition-colors min-h-[44px]',
              'bg-amber-950/10 light:bg-amber-50 hover:bg-amber-950/20 light:hover:bg-amber-100',
            )}
          >
            <span className="text-xs font-bold text-amber-400 light:text-amber-700">
              חסימות חוזרות ({recurringItems.length})
            </span>
            <span className="text-xs text-amber-400/60">{showRecurring ? '▲' : '▼'}</span>
          </button>
          {showRecurring && (
            <div className="px-3 sm:px-4 py-2 space-y-1.5 bg-(--color-surface)">
              {recurringItems.map((item, i) => (
                <ReportItemRow
                  key={`rec-${i}`}
                  item={item}
                  itemIndex={-1}
                  categoryKey={category.key}
                  reportWeek={reportWeek}
                  showFeedback={false}
                  onToggleFeedback={() => {}}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {category.items.length === 0 && (
        <div className="text-center py-6 text-xs text-(--color-text-secondary)/50">
          אין פריטים בקטגוריה זו השבוע
        </div>
      )}

      {/* [Req #196] Quick-switch: navigate to other categories without going back */}
      {otherCategories.length > 0 && (
        <div className="border-t border-(--color-border) pt-3 space-y-1.5">
          <span className="text-[10px] font-bold text-(--color-text-secondary)/60 block mb-1">קטגוריות נוספות:</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {otherCategories.map((cat) => (
              <CubeTile
                key={cat.key}
                category={cat}
                onClick={() => onSwitchCategory(cat.key)}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Report Item Row ──────────────────────────────────────────────
// [Req #204] Each item has a feedback toggle button for CEO responses

function ReportItemRow({
  item,
  itemIndex,
  categoryKey,
  reportWeek,
  showFeedback,
  onToggleFeedback,
  hideFeedbackBtn,
}: {
  item: ReportCategoryItem;
  itemIndex: number;
  categoryKey: string;
  reportWeek: string;
  showFeedback: boolean;
  onToggleFeedback: () => void;
  hideFeedbackBtn?: boolean; // [Req #211] CEO preview hides feedback controls
}) {
  return (
    <div className="space-y-0">
      <div className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm text-(--color-text)',
        item.type === 'risk' && 'bg-red-950/10 light:bg-red-50/50',
        item.type === 'action' && 'bg-amber-950/10 light:bg-amber-50/50',
      )}>
        <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', ITEM_DOT_COLOR[item.type] ?? 'bg-zinc-500')} />
        <span className="flex-1">{item.text}</span>
        {item.is_recurring && (
          <span className="shrink-0 text-[9px] font-bold text-amber-400 light:text-amber-600 bg-amber-950/20 light:bg-amber-50 px-1.5 py-0.5 rounded">
            חוזר
          </span>
        )}
        {/* [Req #204] Feedback toggle — only for indexed items (not recurring collapsed) */}
        {/* [Req #211] Hidden in CEO preview mode */}
        {itemIndex >= 0 && !hideFeedbackBtn && (
          <button
            onClick={onToggleFeedback}
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors min-h-[24px]',
              showFeedback
                ? 'bg-(--color-accent) text-white'
                : 'text-(--color-text-secondary)/50 hover:text-(--color-accent) hover:bg-(--color-accent)/10',
            )}
            title="הוסף תגובה / המר לפעולה"
          >
            💬
          </button>
        )}
      </div>

      {/* [Req #204] Inline feedback form */}
      {showFeedback && itemIndex >= 0 && (
        <FeedbackForm
          categoryKey={categoryKey}
          itemIndex={itemIndex}
          reportWeek={reportWeek}
          onClose={onToggleFeedback}
        />
      )}
    </div>
  );
}

// ── Feedback Form ────────────────────────────────────────────────
// [Req #204] CEO feedback-to-action conversion

function FeedbackForm({
  categoryKey,
  itemIndex,
  reportWeek,
  onClose,
}: {
  categoryKey: string;
  itemIndex: number;
  reportWeek: string;
  onClose: () => void;
}) {
  const addFeedback = useAddCeoFeedback();
  const [feedbackType, setFeedbackType] = useState<CeoFeedbackType>('note');
  const [content, setContent] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  // [Req #204] Existing feedback for this item
  const { data: existingFeedback } = useCeoFeedback(reportWeek);
  const updateFeedback = useUpdateCeoFeedback();

  const itemFeedback = useMemo(
    () => (existingFeedback ?? []).filter(
      (f) => f.category_key === categoryKey && f.item_index === itemIndex,
    ),
    [existingFeedback, categoryKey, itemIndex],
  );

  async function handleSubmit() {
    if (!content.trim()) return;
    await addFeedback.mutateAsync({
      reportWeek,
      categoryKey,
      itemIndex,
      feedbackType,
      content: content.trim(),
      assignedTo: assignedTo.trim() || undefined,
    });
    setContent('');
    setAssignedTo('');
  }

  const FEEDBACK_TYPES: { value: CeoFeedbackType; label: string }[] = [
    { value: 'action', label: 'פעולה' },
    { value: 'note', label: 'הערה' },
    { value: 'escalate', label: 'הסלם' },
    { value: 'dismiss', label: 'בטל' },
  ];

  const ACTION_STATUSES: { value: CeoActionStatus; label: string }[] = [
    { value: 'open', label: 'פתוח' },
    { value: 'in_progress', label: 'בביצוע' },
    { value: 'done', label: 'הושלם' },
    { value: 'cancelled', label: 'בוטל' },
  ];

  return (
    <div className="mr-5 rounded-lg border border-(--color-accent)/30 bg-(--color-accent)/5 p-3 space-y-2">
      {/* Existing feedback for this item */}
      {itemFeedback.length > 0 && (
        <div className="space-y-1 mb-2">
          {itemFeedback.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-[10px]">
              <span className={cn(
                'rounded px-1.5 py-0.5 font-bold',
                f.feedback_type === 'action' && 'bg-amber-950/20 text-amber-400 light:bg-amber-50 light:text-amber-700',
                f.feedback_type === 'escalate' && 'bg-red-950/20 text-red-400 light:bg-red-50 light:text-red-700',
                f.feedback_type === 'note' && 'bg-sky-950/20 text-sky-400 light:bg-sky-50 light:text-sky-700',
                f.feedback_type === 'dismiss' && 'bg-zinc-800/30 text-zinc-400 light:bg-zinc-100 light:text-zinc-500',
              )}>
                {FEEDBACK_TYPES.find((ft) => ft.value === f.feedback_type)?.label}
              </span>
              <span className="text-(--color-text) flex-1 truncate">{f.content}</span>
              {f.assigned_to && <span className="text-(--color-text-secondary)">← {f.assigned_to}</span>}
              {/* Status toggle for action items */}
              {f.feedback_type === 'action' && (
                <select
                  value={f.action_status}
                  onChange={(e) => updateFeedback.mutate({ id: f.id, fields: { action_status: e.target.value as CeoActionStatus } })}
                  className="rounded border border-(--color-border) bg-(--color-surface) text-[9px] px-1 py-0.5"
                >
                  {ACTION_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New feedback form */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FEEDBACK_TYPES.map((ft) => (
          <button
            key={ft.value}
            onClick={() => setFeedbackType(ft.value)}
            className={cn(
              'rounded px-2 py-1 text-[10px] font-bold transition-colors min-h-[28px]',
              feedbackType === ft.value
                ? 'bg-(--color-accent) text-white'
                : 'bg-(--color-surface-dim) text-(--color-text-secondary) hover:bg-(--color-accent)/20',
            )}
          >
            {ft.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="תגובה / הנחיה..."
          className="flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 text-xs text-(--color-text) placeholder:text-(--color-text-secondary)/40 min-h-[36px]"
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        {feedbackType === 'action' && (
          <input
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            placeholder="אחראי..."
            className="w-24 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-xs text-(--color-text) placeholder:text-(--color-text-secondary)/40"
          />
        )}
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || addFeedback.isPending}
          className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-[10px] font-bold text-white hover:opacity-90 transition-colors disabled:opacity-30 min-h-[32px]"
        >
          {addFeedback.isPending ? 'שומר...' : 'שמור'}
        </button>
        <button
          onClick={onClose}
          className="text-[10px] text-(--color-text-secondary)/50 hover:text-(--color-text-secondary) transition-colors"
        >
          סגור
        </button>
      </div>
    </div>
  );
}

// ── Cool-Down Panel ──────────────────────────────────────────────
// [Req #177] AI surfaces cool-downs / abandoned offers

function CoolDownPanel({ coolDowns, onClose }: { coolDowns: CoolDownQuote[]; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-blue-800 light:border-blue-200 bg-blue-950/10 light:bg-blue-50/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-blue-950/20 light:bg-blue-50">
        <span className="text-xs font-bold text-blue-300 light:text-blue-700">
          ❄️ הצעות שהתקררו ({coolDowns.length})
        </span>
        <button onClick={onClose} className="text-xs text-blue-400/60 hover:text-blue-300 transition-colors min-h-[28px] min-w-[28px]">✕</button>
      </div>
      <div className="divide-y divide-blue-800/20 light:divide-blue-200">
        {coolDowns.map((cd, i) => (
          <div key={i} className="px-3 sm:px-4 py-2 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold text-(--color-text)">{cd.quote_number}</span>
              <span className="text-xs text-(--color-text-secondary) mr-2">{cd.client_code}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] shrink-0">
              <span className="text-red-400 font-bold">{cd.original_temp}→{cd.current_temp}</span>
              <span className="text-(--color-text-secondary)">{cd.days_silent}d שקט</span>
            </div>
            {cd.recommendation && (
              <span className="text-[10px] text-blue-400 light:text-blue-600 font-semibold truncate max-w-[120px]">{cd.recommendation}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Metric chip (sticky header) ──────────────────────────────────

// ── [Req #137] Friday Positive Psychology Wrap ──────────────────────────
// Generates a motivational week-close summary from report data
function FridaySummary({ report }: { report: WeeklyReportData }) {
  const stats = report.raw_stats;
  const wins = stats.closed_won;
  const interactions = stats.interactions_count;
  const newQuotes = stats.new_this_week;
  const achievements = report.categories.find((c) => c.key === 'achievements');
  const achievementCount = achievements?.items.length ?? 0;
  const isFriday = new Date().getDay() === 5;

  // Always show summary but label it as Friday-style on Fridays
  return (
    <div className="rounded-lg border border-emerald-800/50 light:border-emerald-200 bg-emerald-950/10 light:bg-emerald-50/50 p-4 space-y-2">
      <h4 className="text-xs font-bold text-emerald-400 light:text-emerald-700 flex items-center gap-1.5">
        <span>🏆</span>
        {isFriday ? 'סיכום יום שישי — סגירת שבוע חיובית' : 'סיכום הישגים שבועי'}
      </h4>
      <div className="text-sm text-(--color-text) leading-relaxed space-y-1">
        {wins > 0 && (
          <p>✅ סגרת <strong>{wins}</strong> עסק{wins > 1 ? 'אות' : 'ה'} השבוע — כל הכבוד!</p>
        )}
        {interactions > 0 && (
          <p>📞 ביצעת <strong>{interactions}</strong> אינטראקצי{interactions > 1 ? 'ות' : 'ה'} — המשך כך.</p>
        )}
        {newQuotes > 0 && (
          <p>🆕 <strong>{newQuotes}</strong> הצע{newQuotes > 1 ? 'ות חדשות' : 'ה חדשה'} נכנסו לפייפליין.</p>
        )}
        {achievementCount > 0 && (
          <p>🌟 {achievementCount} הישג{achievementCount > 1 ? 'ים' : ''} בולט{achievementCount > 1 ? 'ים' : ''} תועדו.</p>
        )}
        {wins === 0 && interactions === 0 && (
          <p>שבוע שקט — הזמן להיערך לשבוע הבא! 💪</p>
        )}
      </div>
    </div>
  );
}

function MetricChip({ label, value, accent, positive, negative }: {
  label: string;
  value: number;
  accent?: boolean;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-(--color-surface-dim) px-2 py-0.5 whitespace-nowrap shrink-0">
      <span className="font-bold text-(--color-text-secondary)">{label}:</span>
      <span className={cn(
        'font-bold',
        accent && 'text-(--color-accent)',
        positive && 'text-emerald-400 light:text-emerald-600',
        negative && value > 0 && 'text-red-400 light:text-red-600',
        !accent && !positive && !negative && 'text-(--color-text)',
      )}>
        {value}
      </span>
    </span>
  );
}
