/**
 * [Req #39, #40, #76, #86] - Search & filter utilities for quote list.
 * Pure functions — no side effects, easily testable.
 */

import type { Quote, Client } from './database.types';
import type { FilterState } from '@/components/FilterPanel';

// ============================================================
//  [Req #39, #86] Global search across all fields
// ============================================================

/**
 * Search a quote + its nested client against a free-text query.
 * Matches against: quote_number, client.code, client.erp_number,
 * tags, ai_summary, loss_reason, sales_ammo, client.notes.
 */
export function matchesSearch(
  quote: Quote & { client?: Client },
  query: string,
): boolean {
  if (!query.trim()) return true;

  const q = query.trim().toLowerCase();
  const fields: (string | null | undefined)[] = [
    quote.quote_number,
    quote.unified_id,
    quote.ai_summary,
    quote.loss_reason,
    quote.win_reason,
    quote.local_file_path,
    ...(quote.sales_ammo ?? []),
    // Client fields
    quote.client?.code,
    quote.client?.erp_number,
    quote.client?.initials,
    quote.client?.phone,
    quote.client?.notes,
    ...(quote.client?.tags ?? []),
  ];

  return fields.some((f) => f && f.toLowerCase().includes(q));
}

// ============================================================
//  [Req #40, #76] Multi-dimension filtering
// ============================================================

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * Apply all active filters to a single quote.
 * Returns true if the quote passes ALL active filter criteria.
 */
export function matchesFilters(
  quote: Quote & { client?: Client },
  filters: FilterState,
): boolean {
  // [Req #40] Dimension 1: Status
  if (filters.statuses.length > 0 && !filters.statuses.includes(quote.status)) {
    return false;
  }

  // [Req #40] Dimension 2: Temperature range
  if (filters.tempMin != null && quote.temperature < filters.tempMin) return false;
  if (filters.tempMax != null && quote.temperature > filters.tempMax) return false;

  // [Req #40] Dimension 3: Strategic rank
  if (filters.strategicRanks.length > 0) {
    if (!quote.strategic_rank || !filters.strategicRanks.includes(quote.strategic_rank)) {
      return false;
    }
  }

  // [Req #40] Dimension 4: VIP only
  if (filters.vipOnly && !quote.client?.is_vip) return false;

  // [Req #40] Dimension 5: Overdue only
  if (filters.overdueOnly) {
    if (!quote.follow_up_date || quote.follow_up_date >= TODAY()) return false;
  }

  // [Req #40] Dimension 6: Follow-up presence
  if (filters.hasFollowUp === true && !quote.follow_up_date) return false;
  if (filters.hasFollowUp === false && quote.follow_up_date) return false;

  // [Req #40] Dimension 7: Client filter
  if (filters.clientIds.length > 0 && !filters.clientIds.includes(quote.client_id)) {
    return false;
  }

  // [Req #40] Dimension 8: Days since contact range
  const dsc = quote.days_since_contact ?? 0;
  if (filters.daysSinceMin != null && dsc < filters.daysSinceMin) return false;
  if (filters.daysSinceMax != null && dsc > filters.daysSinceMax) return false;

  return true;
}

// ============================================================
//  Combined search + filter pipeline
// ============================================================

/**
 * Apply search query AND filters to an array of quotes.
 * Returns filtered results preserving original order.
 */
export function applySearchAndFilters(
  quotes: (Quote & { client?: Client })[],
  searchQuery: string,
  filters: FilterState,
): (Quote & { client?: Client })[] {
  return quotes.filter(
    (q) => matchesSearch(q, searchQuery) && matchesFilters(q, filters),
  );
}
