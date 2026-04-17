import { useMemo, useState } from 'react';
import { cn, effectiveTemperature, fmtDate } from '@/lib/utils';
import type { Quote, Client } from '@/lib/database.types';

// [Req #87] - Escalation alerts for overdue follow-ups
// [Req #13] - Custom alerts system with configurable thresholds

// ── Alert severity ────────────────────────────────────────────
type AlertSeverity = 'critical' | 'warning' | 'info';

interface EscalationAlert {
  id: string;
  quoteId: string;
  quoteNumber: string;
  clientCode: string;
  severity: AlertSeverity;
  message: string;
}

// ── Configurable alert thresholds (Req #13) ───────────────────
// These defaults can be extended to a settings panel in future sprints
const ALERT_THRESHOLDS = {
  // [Req #87] - Overdue follow-up escalation
  overdueFollowUpDays: 0,          // 0 = any overdue triggers alert
  criticalOverdueDays: 3,          // 3+ days overdue = critical
  // [Req #13] - Temperature & staleness thresholds
  staleDaysWarning: 5,             // 5+ days without contact = warning
  staleDaysCritical: 10,           // 10+ days without contact = critical
  coldEffTempThreshold: 2,         // effective temp ≤ 2 on hot quote = warning
  hotOriginalTempForDecay: 4,      // original temp ≥ 4 that decayed = critical
} as const;

interface EscalationAlertsProps {
  quotes: (Quote & { client?: Client })[];
  onFocusQuote: (id: string) => void;
  onDismiss: () => void;
}

// ── Alert generation engine ───────────────────────────────────

function generateAlerts(quotes: (Quote & { client?: Client })[]): EscalationAlert[] {
  const today = new Date().toISOString().slice(0, 10);
  const alerts: EscalationAlert[] = [];

  for (const q of quotes) {
    // Skip closed/dormant quotes
    if (['won', 'lost', 'dormant'].includes(q.status)) continue;

    const clientCode = q.client?.code ?? '—';
    const dsc = q.days_since_contact ?? 0;
    const eff = effectiveTemperature(q.temperature, dsc);

    // [Req #87] - Overdue follow-up alerts
    if (q.follow_up_date && q.follow_up_date < today) {
      const overdueDays = Math.floor(
        (new Date(today).getTime() - new Date(q.follow_up_date).getTime()) / 86_400_000,
      );
      const severity: AlertSeverity =
        overdueDays >= ALERT_THRESHOLDS.criticalOverdueDays ? 'critical' : 'warning';
      alerts.push({
        id: `overdue-${q.id}`,
        quoteId: q.id,
        quoteNumber: q.quote_number,
        clientCode,
        severity,
        message:
          severity === 'critical'
            ? `מעקב באיחור ${overdueDays} ימים! (${fmtDate(q.follow_up_date)})`
            : `מעקב באיחור — ${fmtDate(q.follow_up_date)}`,
      });
    }

    // [Req #13] - Staleness critical: 10+ days without contact
    if (dsc >= ALERT_THRESHOLDS.staleDaysCritical) {
      alerts.push({
        id: `stale-crit-${q.id}`,
        quoteId: q.id,
        quoteNumber: q.quote_number,
        clientCode,
        severity: 'critical',
        message: `${dsc} ימים ללא קשר — נדרש טיפול מיידי`,
      });
    } else if (dsc >= ALERT_THRESHOLDS.staleDaysWarning) {
      // [Req #13] - Staleness warning: 5-9 days without contact
      alerts.push({
        id: `stale-warn-${q.id}`,
        quoteId: q.id,
        quoteNumber: q.quote_number,
        clientCode,
        severity: 'warning',
        message: `${dsc} ימים ללא קשר`,
      });
    }

    // [Req #13] - Hot quote temperature decay alert
    if (
      q.temperature >= ALERT_THRESHOLDS.hotOriginalTempForDecay &&
      eff <= ALERT_THRESHOLDS.coldEffTempThreshold
    ) {
      alerts.push({
        id: `decay-${q.id}`,
        quoteId: q.id,
        quoteNumber: q.quote_number,
        clientCode,
        severity: 'critical',
        message: `טמפרטורה צנחה מ-${q.temperature} ל-${eff} — הצעה קרה!`,
      });
    }

    // [Req #13] - VIP without recent contact
    if (q.client?.is_vip && dsc >= ALERT_THRESHOLDS.staleDaysWarning) {
      alerts.push({
        id: `vip-stale-${q.id}`,
        quoteId: q.id,
        quoteNumber: q.quote_number,
        clientCode,
        severity: 'critical',
        message: `לקוח VIP ללא קשר ${dsc} ימים`,
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Deduplicate by quoteId — keep only highest severity per quote
  const seen = new Set<string>();
  const deduped: EscalationAlert[] = [];
  for (const alert of alerts) {
    if (!seen.has(alert.quoteId)) {
      seen.add(alert.quoteId);
      deduped.push(alert);
    }
  }

  return deduped;
}

// ── Component ─────────────────────────────────────────────────

export default function EscalationAlerts({ quotes, onFocusQuote, onDismiss }: EscalationAlertsProps) {
  const alerts = useMemo(() => generateAlerts(quotes), [quotes]);
  const [expanded, setExpanded] = useState(false);

  // No alerts = don't render anything
  if (alerts.length === 0) return null;

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const displayAlerts = expanded ? alerts : alerts.slice(0, 3);

  return (
    <div className="shrink-0 border-b border-(--color-border)">
      {/* [Req #87] - Alert header bar */}
      <div className={cn(
        'flex items-center justify-between px-4 py-1.5',
        criticalCount > 0
          ? 'bg-red-950/30 light:bg-red-50'
          : 'bg-amber-950/20 light:bg-amber-50',
      )}>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-bold',
            criticalCount > 0
              ? 'text-red-400 light:text-red-700'
              : 'text-amber-400 light:text-amber-700',
          )}>
            {criticalCount > 0 ? '⚠' : '△'} {alerts.length} התראות
            {criticalCount > 0 && (
              <span className="mr-1 text-red-300 light:text-red-600">
                ({criticalCount} קריטיות)
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {alerts.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] font-semibold text-(--color-text-secondary) hover:text-(--color-text) transition-colors"
            >
              {expanded ? 'צמצם' : `הצג הכל (${alerts.length})`}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-[10px] font-semibold text-(--color-text-secondary) hover:text-(--color-text) transition-colors"
            title="סגור התראות"
          >
            ✕
          </button>
        </div>
      </div>

      {/* [Req #87, #13] - Alert items */}
      <div className="divide-y divide-(--color-border)/30">
        {displayAlerts.map((alert) => (
          <button
            key={alert.id}
            onClick={() => onFocusQuote(alert.quoteId)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-1.5 text-right transition-colors hover:bg-(--color-surface-dim)/60',
            )}
          >
            {/* Severity indicator */}
            <span className={cn(
              'shrink-0 w-1.5 h-1.5 rounded-full',
              alert.severity === 'critical' && 'bg-red-500',
              alert.severity === 'warning' && 'bg-amber-500',
              alert.severity === 'info' && 'bg-blue-500',
            )} />
            {/* Quote info */}
            <span className="text-[11px] font-semibold text-(--color-text) shrink-0">{alert.quoteNumber}</span>
            <span className="text-[10px] text-(--color-text-secondary) shrink-0">{alert.clientCode}</span>
            {/* Alert message */}
            <span className={cn(
              'text-[10px] truncate',
              alert.severity === 'critical'
                ? 'text-red-400 light:text-red-600 font-semibold'
                : alert.severity === 'warning'
                  ? 'text-amber-400 light:text-amber-600'
                  : 'text-(--color-text-secondary)',
            )}>
              {alert.message}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Exported for testing ──────────────────────────────────────
export { generateAlerts, ALERT_THRESHOLDS };
export type { EscalationAlert, AlertSeverity };
