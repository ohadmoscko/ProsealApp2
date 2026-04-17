import { useMemo } from 'react';
import { cn, effectiveTemperature, computePriorityScore } from '@/lib/utils';
import { STATUS_LABELS } from '@/lib/constants';
import { exportBottleneckReport, exportLossReasonReport, exportConversionReport } from '@/lib/export';
import type { Quote, Client } from '@/lib/database.types';

// [Req #17, #33] - Success metrics dashboard with visual graphs

interface MetricsDashboardProps {
  quotes: (Quote & { client?: Client })[];
}

// ── Metric computation helpers ──────────────────────────────────

interface DashMetrics {
  totalActive: number;
  totalAll: number;
  closedWon: number;
  closedLost: number;
  winRate: number;           // % of closed deals that were won
  avgTemperature: number;
  avgDaysSinceContact: number;
  overdueCount: number;
  hotCount: number;          // temp >= 4
  coldCount: number;         // effective temp <= 2
  vipCount: number;
  statusDistribution: { status: string; label: string; count: number; pct: number }[];
  temperatureDistribution: { temp: number; count: number }[];
  avgPriorityScore: number;
  topPriority: (Quote & { client?: Client; score: number })[];
}

function computeMetrics(quotes: (Quote & { client?: Client })[]): DashMetrics {
  const today = new Date().toISOString().slice(0, 10);

  const active = quotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status));
  const won = quotes.filter((q) => q.status === 'won');
  const lost = quotes.filter((q) => q.status === 'lost');
  const closed = won.length + lost.length;
  const winRate = closed > 0 ? Math.round((won.length / closed) * 100) : 0;

  const avgTemp = active.length > 0
    ? Math.round((active.reduce((sum, q) => sum + q.temperature, 0) / active.length) * 10) / 10
    : 0;

  const avgDsc = active.length > 0
    ? Math.round((active.reduce((sum, q) => sum + (q.days_since_contact ?? 0), 0) / active.length) * 10) / 10
    : 0;

  const overdue = active.filter((q) => q.follow_up_date && q.follow_up_date < today).length;
  const hot = active.filter((q) => q.temperature >= 4).length;
  const cold = active.filter((q) => effectiveTemperature(q.temperature, q.days_since_contact) <= 2).length;
  const vip = active.filter((q) => q.client?.is_vip).length;

  // Status distribution (active only)
  const statusCounts: Record<string, number> = {};
  for (const q of active) {
    statusCounts[q.status] = (statusCounts[q.status] ?? 0) + 1;
  }
  const statusDistribution = Object.entries(statusCounts)
    .map(([status, count]) => ({
      status,
      label: STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status,
      count,
      pct: active.length > 0 ? Math.round((count / active.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Temperature distribution
  const tempCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const q of active) {
    tempCounts[q.temperature] = (tempCounts[q.temperature] ?? 0) + 1;
  }
  const temperatureDistribution = [1, 2, 3, 4, 5].map((t) => ({
    temp: t,
    count: tempCounts[t] ?? 0,
  }));

  // Priority scores
  const scored = active.map((q) => ({
    ...q,
    score: computePriorityScore(
      q.temperature, q.days_since_contact, q.strategic_rank,
      q.client?.is_vip ?? false, q.follow_up_date, q.status,
    ),
  }));
  const avgScore = scored.length > 0
    ? Math.round((scored.reduce((s, q) => s + q.score, 0) / scored.length) * 10) / 10
    : 0;
  const topPriority = [...scored].sort((a, b) => b.score - a.score).slice(0, 5);

  return {
    totalActive: active.length,
    totalAll: quotes.length,
    closedWon: won.length,
    closedLost: lost.length,
    winRate,
    avgTemperature: avgTemp,
    avgDaysSinceContact: avgDsc,
    overdueCount: overdue,
    hotCount: hot,
    coldCount: cold,
    vipCount: vip,
    statusDistribution,
    temperatureDistribution,
    avgPriorityScore: avgScore,
    topPriority,
  };
}

// ── Component ───────────────────────────────────────────────────

export default function MetricsDashboard({ quotes }: MetricsDashboardProps) {
  const metrics = useMemo(() => computeMetrics(quotes), [quotes]);

  // [Req #126] Conversion rate trend — compute for display
  const conversionTrend = useMemo(() => {
    const won = quotes.filter((q) => q.status === 'won').length;
    const lost = quotes.filter((q) => q.status === 'lost').length;
    const closed = won + lost;
    const rate = closed > 0 ? Math.round((won / closed) * 100) : 0;
    // VIP conversion
    const vipWon = quotes.filter((q) => q.status === 'won' && q.client?.is_vip).length;
    const vipLost = quotes.filter((q) => q.status === 'lost' && q.client?.is_vip).length;
    const vipClosed = vipWon + vipLost;
    const vipRate = vipClosed > 0 ? Math.round((vipWon / vipClosed) * 100) : 0;
    // New customer conversion
    const newWon = quotes.filter((q) => q.status === 'won' && q.client?.is_new_customer).length;
    const newLost = quotes.filter((q) => q.status === 'lost' && q.client?.is_new_customer).length;
    const newClosed = newWon + newLost;
    const newRate = newClosed > 0 ? Math.round((newWon / newClosed) * 100) : 0;
    return { rate, vipRate, newRate, closed, vipClosed, newClosed };
  }, [quotes]);
  const maxTempCount = Math.max(...metrics.temperatureDistribution.map((t) => t.count), 1);

  return (
    <div className="h-full overflow-y-auto px-6 py-6 space-y-6">
      {/* [Req #17] - Header */}
      <div>
        <h2 className="text-lg font-bold text-(--color-text)">מדדי הצלחה</h2>
        <p className="text-xs text-(--color-text-secondary) mt-0.5">סקירה כללית של ביצועי המכירות</p>
      </div>

      {/* [Req #17] - KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="פעילות" value={metrics.totalActive} color="accent" />
        <KpiCard label="נסגרו" value={metrics.closedWon} color="success" subtitle={`${metrics.winRate}% אחוז הצלחה`} />
        <KpiCard label="הפסד" value={metrics.closedLost} color="danger" />
        <KpiCard label="באיחור" value={metrics.overdueCount} color={metrics.overdueCount > 0 ? 'danger' : 'muted'} />
        <KpiCard label="חמות" value={metrics.hotCount} color={metrics.hotCount > 0 ? 'warn' : 'muted'} subtitle="טמפ׳ 4+" />
        <KpiCard label="קרות" value={metrics.coldCount} color="muted" subtitle="טמפ׳ אפקטיבית 1-2" />
        <KpiCard label="VIP" value={metrics.vipCount} color="accent" />
        <KpiCard label="ציון ממוצע" value={metrics.avgPriorityScore} color="accent" subtitle="עדיפות" />
      </div>

      {/* [Req #33] - Visual graphs section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Temperature distribution bar chart */}
        <div className="rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-4">
          <h3 className="text-xs font-bold text-(--color-text-secondary) mb-3">פיזור טמפרטורה</h3>
          <div className="flex items-end gap-2 h-28">
            {metrics.temperatureDistribution.map((t) => {
              const heightPct = maxTempCount > 0 ? (t.count / maxTempCount) * 100 : 0;
              const colors = [
                'bg-zinc-600',
                'bg-yellow-600',
                'bg-orange-500',
                'bg-red-500',
                'bg-red-600',
              ];
              return (
                <div key={t.temp} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-(--color-text-secondary)">{t.count}</span>
                  <div
                    className={cn('w-full rounded-t-md transition-all', colors[t.temp - 1])}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className="text-[10px] text-(--color-text-secondary)/60">{t.temp}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-(--color-text-secondary)/40">
            <span>קר</span>
            <span>בוער</span>
          </div>
        </div>

        {/* Status distribution horizontal bars */}
        <div className="rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-4">
          <h3 className="text-xs font-bold text-(--color-text-secondary) mb-3">פיזור סטטוסים</h3>
          <div className="space-y-2">
            {metrics.statusDistribution.map((s) => (
              <div key={s.status} className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-(--color-text-secondary) w-16 text-left shrink-0">{s.label}</span>
                <div className="flex-1 bg-(--color-border)/30 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-(--color-accent) transition-all"
                    style={{ width: `${Math.max(s.pct, 2)}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-(--color-text-secondary) w-8 text-left">{s.count}</span>
              </div>
            ))}
            {metrics.statusDistribution.length === 0 && (
              <p className="text-xs text-(--color-text-secondary)/50">אין נתונים</p>
            )}
          </div>
        </div>
      </div>

      {/* [Req #17] - Summary stats row */}
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-4">
        <h3 className="text-xs font-bold text-(--color-text-secondary) mb-3">מדדי יעילות</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-(--color-text)">{metrics.avgTemperature}</p>
            <p className="text-[10px] text-(--color-text-secondary)">טמפרטורה ממוצעת</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-(--color-text)">{metrics.avgDaysSinceContact}</p>
            <p className="text-[10px] text-(--color-text-secondary)">ימים ממוצע ללא קשר</p>
          </div>
          <div>
            <p className={cn(
              'text-2xl font-bold',
              metrics.winRate >= 50 ? 'text-(--color-success)' : metrics.winRate >= 30 ? 'text-(--color-warning)' : 'text-(--color-danger)',
            )}>
              {metrics.winRate}%
            </p>
            <p className="text-[10px] text-(--color-text-secondary)">אחוז הצלחה</p>
          </div>
        </div>
      </div>

      {/* [Req #17] - Top 5 priority quotes */}
      {metrics.topPriority.length > 0 && (
        <div className="rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-4">
          <h3 className="text-xs font-bold text-(--color-text-secondary) mb-3">Top 5 — עדיפות גבוהה</h3>
          <div className="space-y-2">
            {metrics.topPriority.map((q, i) => (
              <div key={q.id} className="flex items-center gap-3 text-xs">
                <span className={cn(
                  'font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]',
                  i === 0 ? 'bg-red-950/40 text-red-300 light:bg-red-100 light:text-red-700'
                    : i <= 2 ? 'bg-orange-950/40 text-orange-300 light:bg-orange-100 light:text-orange-700'
                      : 'bg-zinc-800/40 text-zinc-400 light:bg-zinc-100 light:text-zinc-600',
                )}>
                  {i + 1}
                </span>
                <span className="font-semibold text-(--color-text)">{q.quote_number}</span>
                <span className="text-(--color-text-secondary)">{q.client?.code ?? '—'}</span>
                <span className="mr-auto text-(--color-accent) font-bold">{q.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* [Req #126] Conversion rate widget — motivation metric */}
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-4">
        <h3 className="text-xs font-bold text-(--color-text-secondary) mb-3">אחוז המרה לפי סגמנט</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className={cn(
              'text-2xl font-bold',
              conversionTrend.rate >= 50 ? 'text-emerald-400 light:text-emerald-600' : conversionTrend.rate >= 30 ? 'text-amber-400 light:text-amber-600' : 'text-red-400 light:text-red-600',
            )}>
              {conversionTrend.rate}%
            </p>
            <p className="text-[10px] text-(--color-text-secondary)">כללי ({conversionTrend.closed} סגורות)</p>
          </div>
          <div>
            <p className={cn(
              'text-2xl font-bold',
              conversionTrend.vipRate >= 50 ? 'text-emerald-400 light:text-emerald-600' : 'text-amber-400 light:text-amber-600',
            )}>
              {conversionTrend.vipRate}%
            </p>
            <p className="text-[10px] text-(--color-text-secondary)">VIP ({conversionTrend.vipClosed} סגורות)</p>
          </div>
          <div>
            <p className={cn(
              'text-2xl font-bold',
              conversionTrend.newRate >= 50 ? 'text-emerald-400 light:text-emerald-600' : 'text-amber-400 light:text-amber-600',
            )}>
              {conversionTrend.newRate}%
            </p>
            <p className="text-[10px] text-(--color-text-secondary)">לקוחות חדשים ({conversionTrend.newClosed} סגורות)</p>
          </div>
        </div>
      </div>

      {/* [Req #124] Export reports section */}
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-4">
        <h3 className="text-xs font-bold text-(--color-text-secondary) mb-3">ייצוא דוחות</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => exportBottleneckReport(quotes)}
            className="rounded-lg border border-(--color-border) px-3 py-2 text-xs font-semibold text-(--color-text) hover:bg-(--color-accent)/10 hover:border-(--color-accent)/50 transition-colors"
          >
            📊 צווארי בקבוק
          </button>
          <button
            onClick={() => exportLossReasonReport(quotes)}
            className="rounded-lg border border-(--color-border) px-3 py-2 text-xs font-semibold text-(--color-text) hover:bg-(--color-accent)/10 hover:border-(--color-accent)/50 transition-colors"
          >
            📉 סיבות הפסד
          </button>
          <button
            onClick={() => exportConversionReport(quotes)}
            className="rounded-lg border border-(--color-border) px-3 py-2 text-xs font-semibold text-(--color-text) hover:bg-(--color-accent)/10 hover:border-(--color-accent)/50 transition-colors"
          >
            📈 אחוזי המרה
          </button>
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: number;
  color: 'accent' | 'success' | 'danger' | 'warn' | 'muted';
  subtitle?: string;
}) {
  const colorClasses = {
    accent: 'text-(--color-accent)',
    success: 'text-(--color-success)',
    danger: 'text-(--color-danger)',
    warn: 'text-(--color-warning)',
    muted: 'text-(--color-text-secondary)',
  };

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-3 text-center">
      <p className={cn('text-2xl font-bold', colorClasses[color])}>{value}</p>
      <p className="text-[10px] font-semibold text-(--color-text-secondary) mt-0.5">{label}</p>
      {subtitle && <p className="text-[10px] text-(--color-text-secondary)/50">{subtitle}</p>}
    </div>
  );
}
