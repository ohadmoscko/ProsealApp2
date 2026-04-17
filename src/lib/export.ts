/**
 * [Req #124] Export 3 Excel/CSV reports:
 *   1. Bottleneck analysis (quotes stuck in pipeline)
 *   2. Loss reason summary (grouped by reason)
 *   3. Conversion rate by client segment
 *
 * Uses CSV format (no external library needed) — universally opens in Excel.
 */

import type { Quote, Client } from './database.types';
import { effectiveTemperature } from './utils';

// ── CSV helpers ──────────────────────────────────────────────────

function escapeCSV(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  // [Req #124] UTF-8 BOM for Hebrew text in Excel
  const bom = '\uFEFF';
  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = rows.map((row) => row.map(escapeCSV).join(','));
  return bom + [headerLine, ...dataLines].join('\n');
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ── 1. Bottleneck Report ─────────────────────────────────────────
// [Req #124] Quotes stuck in pipeline — sorted by days stuck

export function exportBottleneckReport(quotes: (Quote & { client?: Client })[]) {
  const today = new Date().toISOString().slice(0, 10);

  const stuck = quotes
    .filter((q) => !['won', 'lost', 'dormant'].includes(q.status))
    .filter((q) => (q.days_since_contact ?? 0) >= 3)
    .sort((a, b) => (b.days_since_contact ?? 0) - (a.days_since_contact ?? 0));

  const headers = [
    'מספר הצעה',
    'קוד לקוח',
    'סטטוס',
    'ימים ללא קשר',
    'טמפרטורה',
    'טמפרטורה אפקטיבית',
    'תאריך מעקב',
    'באיחור',
  ];

  const rows = stuck.map((q) => [
    q.quote_number,
    q.client?.code ?? '',
    q.status,
    q.days_since_contact ?? 0,
    q.temperature,
    effectiveTemperature(q.temperature, q.days_since_contact),
    q.follow_up_date ?? '',
    q.follow_up_date && q.follow_up_date < today ? 'כן' : 'לא',
  ]);

  const csv = toCSV(headers, rows);
  downloadCSV(csv, `bottleneck_report_${today}.csv`);
}

// ── 2. Loss Reason Summary ───────────────────────────────────────
// [Req #124] Grouped by loss reason with counts

export function exportLossReasonReport(quotes: (Quote & { client?: Client })[]) {
  const today = new Date().toISOString().slice(0, 10);
  const lost = quotes.filter((q) => q.status === 'lost');

  // Group by loss_reason
  const groups: Record<string, (Quote & { client?: Client })[]> = {};
  for (const q of lost) {
    const reason = q.loss_reason || 'לא צוין';
    if (!groups[reason]) groups[reason] = [];
    groups[reason].push(q);
  }

  const headers = [
    'סיבת הפסד',
    'מספר הצעות',
    'דוגמאות',
  ];

  const rows = Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([reason, qs]) => [
      reason,
      qs.length,
      qs.slice(0, 3).map((q) => q.quote_number).join(' / '),
    ]);

  const csv = toCSV(headers, rows);
  downloadCSV(csv, `loss_reasons_${today}.csv`);
}

// ── 3. Conversion Rate Report ────────────────────────────────────
// [Req #124, #126] Conversion by client segment

export function exportConversionReport(quotes: (Quote & { client?: Client })[]) {
  const today = new Date().toISOString().slice(0, 10);

  // Segment by customer_style
  const segments: Record<string, { won: number; lost: number; active: number }> = {};

  for (const q of quotes) {
    const style = q.client?.customer_style ?? 'unknown';
    if (!segments[style]) segments[style] = { won: 0, lost: 0, active: 0 };
    if (q.status === 'won') segments[style].won++;
    else if (q.status === 'lost') segments[style].lost++;
    else if (!['dormant'].includes(q.status)) segments[style].active++;
  }

  const headers = [
    'סגמנט לקוח',
    'זכיות',
    'הפסדים',
    'פעילות',
    'אחוז המרה',
  ];

  const rows = Object.entries(segments)
    .sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost))
    .map(([style, s]) => {
      const closed = s.won + s.lost;
      const rate = closed > 0 ? Math.round((s.won / closed) * 100) : 0;
      return [style, s.won, s.lost, s.active, `${rate}%`];
    });

  // Add total row
  const totalWon = quotes.filter((q) => q.status === 'won').length;
  const totalLost = quotes.filter((q) => q.status === 'lost').length;
  const totalActive = quotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status)).length;
  const totalClosed = totalWon + totalLost;
  const totalRate = totalClosed > 0 ? Math.round((totalWon / totalClosed) * 100) : 0;
  rows.push(['סה"כ', totalWon, totalLost, totalActive, `${totalRate}%`]);

  const csv = toCSV(headers, rows);
  downloadCSV(csv, `conversion_report_${today}.csv`);
}
