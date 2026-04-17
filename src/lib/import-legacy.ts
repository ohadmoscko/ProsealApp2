/**
 * [Req #225] One-shot Supabase → SQLite legacy data importer.
 *
 * Run once per install to migrate the CEO's historical data from the old
 * Supabase Postgres into the new embedded SQLite database.
 *
 * Usage (from a hidden admin screen or dev console):
 *
 *   import { importFromSupabaseDump } from '@/lib/import-legacy';
 *   await importFromSupabaseDump(jsonBlob);
 *
 * Expected input shape: JSON object keyed by table name with arrays of rows,
 * as produced by a single-pass Supabase export:
 *
 *   {
 *     "clients":       [ { id, code, ... }, ... ],
 *     "quotes":        [ { id, quote_number, ... }, ... ],
 *     "interactions":  [ ... ],
 *     "captures":      [ ... ],
 *     "ceo_feedback":  [ ... ],
 *     ...
 *   }
 *
 * Rows are idempotent on primary key: `INSERT OR IGNORE` semantics.
 * Re-running the tool will not duplicate existing rows.
 */

import { dbImport } from './db';

export interface LegacyImportReport {
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  total_inserted: number;
  total_skipped: number;
  tables: string[];
}

// [Req #225] Order matters — parents before children to satisfy FK constraints.
const TABLE_ORDER = [
  'profiles',
  'categories',
  'weeks',
  'items',
  'comments',
  'clients',
  'quotes',
  'interactions',
  'captures',
  'saved_filters',
  'ai_training_telemetry',
  'audit_log',
  'ceo_feedback',
  'leads',
];

/** Run the one-shot import from a Supabase JSON dump. */
export async function importFromSupabaseDump(
  dump: Record<string, unknown[]>,
): Promise<LegacyImportReport> {
  // Order tables by FK dependency so children don't orphan
  const ordered: Record<string, unknown[]> = {};
  for (const t of TABLE_ORDER) {
    if (Array.isArray(dump[t]) && dump[t].length > 0) {
      ordered[t] = normalize(t, dump[t]);
    }
  }

  const result = await dbImport(ordered);

  const tables = Object.keys(result.inserted);
  const totalIns = tables.reduce((s, t) => s + (result.inserted[t] ?? 0), 0);
  const totalSkp = tables.reduce((s, t) => s + (result.skipped[t] ?? 0), 0);

  return {
    inserted: result.inserted,
    skipped: result.skipped,
    total_inserted: totalIns,
    total_skipped: totalSkp,
    tables,
  };
}

/**
 * Normalise Postgres → SQLite row shapes:
 *  - booleans → 0/1 integers
 *  - jsonb columns → JSON strings
 *  - `null` / undefined preserved
 */
function normalize(table: string, rows: unknown[]): unknown[] {
  return rows.map((r) => {
    if (!r || typeof r !== 'object') return r;
    const src = r as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'boolean') {
        out[k] = v ? 1 : 0;
      } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = JSON.stringify(v);
      } else if (Array.isArray(v)) {
        // tags, sales_ammo, etc. stored as JSON text
        out[k] = JSON.stringify(v);
      } else {
        out[k] = v;
      }
    }
    // Table-specific tweaks
    if (table === 'clients') {
      if ('vip' in out && !('is_vip' in out)) out.is_vip = out.vip;
    }
    return out;
  });
}
