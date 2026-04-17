/**
 * [Sprint 2 Auto-QA] Tests for search & filter logic.
 * Pure function tests — no React rendering needed.
 */

// @ts-expect-error — vitest types available when vitest is installed
import { describe, it, expect } from 'vitest';
import { matchesSearch, matchesFilters, applySearchAndFilters } from './search-filter';
import { EMPTY_FILTERS } from '@/components/FilterPanel';
import type { FilterState } from '@/components/FilterPanel';
import type { Quote, Client } from './database.types';

// ── Test fixtures ───────────────────────────────────────────────────────

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    code: 'ACME',
    erp_number: '12345',
    initials: 'AC',
    temperature: 3,
    tags: ['oring', 'seals'],
    phone: '0501234567',
    notes: 'חשוב מאוד',
    is_vip: false,
    vip_set_at: null,
    vip_set_by: null,
    preferred_channel: 'whatsapp',
    customer_style: 'recurring',
    relationship_strength: 60,
    is_new_customer: false,
    deleted_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuote(overrides: Partial<Quote> = {}, client?: Client): Quote & { client?: Client } {
  return {
    id: 'q1',
    quote_number: 'QT-001',
    client_id: 'c1',
    unified_id: '12345-AC-QT-001',
    status: 'open',
    temperature: 3,
    local_file_path: null,
    is_lead: false,           // [Req #139] Pre-sale lead flag
    follow_up_date: null,
    follow_up_rule: null,
    loss_reason: null,
    win_reason: null,
    strategic_rank: null,
    sales_ammo: [],
    ai_summary: 'הלקוח מעוניין באטמים מיוחדים',
    ai_summary_at: null,
    owner_id: null,
    temp_override: false,
    opened_at: '2026-01-01',
    last_contact_at: '2026-04-10T10:00:00Z',
    days_since_contact: 2,
    deleted_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-04-10T10:00:00Z',
    client: client ?? makeClient(),
    ...overrides,
  };
}

// ============================================================
//  [Req #39, #86] Search tests
// ============================================================

describe('matchesSearch', () => {
  it('returns true for empty query', () => {
    expect(matchesSearch(makeQuote(), '')).toBe(true);
    expect(matchesSearch(makeQuote(), '   ')).toBe(true);
  });

  it('matches quote_number', () => {
    expect(matchesSearch(makeQuote({ quote_number: 'QT-999' }), 'QT-999')).toBe(true);
    expect(matchesSearch(makeQuote({ quote_number: 'QT-999' }), 'qt-999')).toBe(true); // case-insensitive
    expect(matchesSearch(makeQuote({ quote_number: 'QT-999' }), 'QT-888')).toBe(false);
  });

  it('matches client code', () => {
    const q = makeQuote({}, makeClient({ code: 'PROSEAL' }));
    expect(matchesSearch(q, 'proseal')).toBe(true);
    expect(matchesSearch(q, 'SEAL')).toBe(true);
  });

  it('matches client ERP number', () => {
    const q = makeQuote({}, makeClient({ erp_number: '67890' }));
    expect(matchesSearch(q, '678')).toBe(true);
  });

  it('matches ai_summary', () => {
    const q = makeQuote({ ai_summary: 'הלקוח מעוניין באטמים' });
    expect(matchesSearch(q, 'אטמים')).toBe(true);
  });

  it('matches sales_ammo', () => {
    const q = makeQuote({ sales_ammo: ['מחיר תחרותי', 'אספקה מהירה'] });
    expect(matchesSearch(q, 'תחרותי')).toBe(true);
    expect(matchesSearch(q, 'אספקה')).toBe(true);
  });

  it('matches client tags', () => {
    const q = makeQuote({}, makeClient({ tags: ['hydraulic', 'custom'] }));
    expect(matchesSearch(q, 'hydraulic')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesSearch(makeQuote(), 'xyznonexistent')).toBe(false);
  });
});

// ============================================================
//  [Req #40, #76] Filter tests
// ============================================================

describe('matchesFilters', () => {
  it('passes with empty filters', () => {
    expect(matchesFilters(makeQuote(), EMPTY_FILTERS)).toBe(true);
  });

  // Dimension 1: Status
  it('filters by status', () => {
    const f: FilterState = { ...EMPTY_FILTERS, statuses: ['waiting'] };
    expect(matchesFilters(makeQuote({ status: 'waiting' }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ status: 'open' }), f)).toBe(false);
  });

  it('filters by multiple statuses', () => {
    const f: FilterState = { ...EMPTY_FILTERS, statuses: ['open', 'new'] };
    expect(matchesFilters(makeQuote({ status: 'open' }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ status: 'new' }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ status: 'lost' }), f)).toBe(false);
  });

  // Dimension 2: Temperature
  it('filters by temperature range', () => {
    const f: FilterState = { ...EMPTY_FILTERS, tempMin: 3, tempMax: 5 };
    expect(matchesFilters(makeQuote({ temperature: 4 }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ temperature: 2 }), f)).toBe(false);
    expect(matchesFilters(makeQuote({ temperature: 3 }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ temperature: 5 }), f)).toBe(true);
  });

  // Dimension 3: Strategic rank
  it('filters by strategic rank', () => {
    const f: FilterState = { ...EMPTY_FILTERS, strategicRanks: [1] };
    expect(matchesFilters(makeQuote({ strategic_rank: 1 }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ strategic_rank: 2 }), f)).toBe(false);
    expect(matchesFilters(makeQuote({ strategic_rank: null }), f)).toBe(false);
  });

  // Dimension 4: VIP
  it('filters VIP only', () => {
    const f: FilterState = { ...EMPTY_FILTERS, vipOnly: true };
    expect(matchesFilters(makeQuote({}, makeClient({ is_vip: true })), f)).toBe(true);
    expect(matchesFilters(makeQuote({}, makeClient({ is_vip: false })), f)).toBe(false);
  });

  // Dimension 5: Overdue
  it('filters overdue only', () => {
    const f: FilterState = { ...EMPTY_FILTERS, overdueOnly: true };
    expect(matchesFilters(makeQuote({ follow_up_date: '2020-01-01' }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ follow_up_date: '2099-01-01' }), f)).toBe(false);
    expect(matchesFilters(makeQuote({ follow_up_date: null }), f)).toBe(false);
  });

  // Dimension 6: Follow-up presence
  it('filters by follow-up presence', () => {
    const fHas: FilterState = { ...EMPTY_FILTERS, hasFollowUp: true };
    expect(matchesFilters(makeQuote({ follow_up_date: '2026-05-01' }), fHas)).toBe(true);
    expect(matchesFilters(makeQuote({ follow_up_date: null }), fHas)).toBe(false);

    const fNone: FilterState = { ...EMPTY_FILTERS, hasFollowUp: false };
    expect(matchesFilters(makeQuote({ follow_up_date: null }), fNone)).toBe(true);
    expect(matchesFilters(makeQuote({ follow_up_date: '2026-05-01' }), fNone)).toBe(false);
  });

  // Dimension 7: Client
  it('filters by client ID', () => {
    const f: FilterState = { ...EMPTY_FILTERS, clientIds: ['c2'] };
    expect(matchesFilters(makeQuote({ client_id: 'c2' }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ client_id: 'c1' }), f)).toBe(false);
  });

  // Dimension 8: Days since contact
  it('filters by days since contact range', () => {
    const f: FilterState = { ...EMPTY_FILTERS, daysSinceMin: 3, daysSinceMax: 7 };
    expect(matchesFilters(makeQuote({ days_since_contact: 5 }), f)).toBe(true);
    expect(matchesFilters(makeQuote({ days_since_contact: 2 }), f)).toBe(false);
    expect(matchesFilters(makeQuote({ days_since_contact: 8 }), f)).toBe(false);
  });
});

// ============================================================
//  Combined pipeline
// ============================================================

describe('applySearchAndFilters', () => {
  const q1 = makeQuote({ id: 'q1', quote_number: 'QT-001', status: 'open', temperature: 4 }, makeClient({ code: 'ALPHA', is_vip: true }));
  const q2 = makeQuote({ id: 'q2', quote_number: 'QT-002', status: 'waiting', temperature: 2 }, makeClient({ code: 'BETA', is_vip: false }));
  const q3 = makeQuote({ id: 'q3', quote_number: 'QT-003', status: 'follow_up', temperature: 5 }, makeClient({ code: 'GAMMA', is_vip: false }));

  it('returns all with empty search + empty filters', () => {
    const result = applySearchAndFilters([q1, q2, q3], '', EMPTY_FILTERS);
    expect(result).toHaveLength(3);
  });

  it('filters by search only', () => {
    const result = applySearchAndFilters([q1, q2, q3], 'ALPHA', EMPTY_FILTERS);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('q1');
  });

  it('filters by filters only', () => {
    const f: FilterState = { ...EMPTY_FILTERS, vipOnly: true };
    const result = applySearchAndFilters([q1, q2, q3], '', f);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('q1');
  });

  it('combines search + filters', () => {
    const f: FilterState = { ...EMPTY_FILTERS, tempMin: 4, tempMax: 5 };
    const result = applySearchAndFilters([q1, q2, q3], 'QT', f);
    expect(result).toHaveLength(2); // q1 (temp 4) and q3 (temp 5), both match "QT"
    expect(result.map((r) => r.id)).toEqual(['q1', 'q3']);
  });
});
