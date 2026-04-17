/**
 * [Req #302] Local sync queue — SQLite-backed replacement for offline-sync.ts.
 *
 * Authoritative store is now the local SQLite file. Every mutation is written
 * atomically to its main table AND the `sync_queue` table in a single Rust
 * transaction (see src-tauri/src/commands.rs run_insert / run_update / run_delete).
 *
 * This module drives the OPTIONAL push path: if cloud sync is enabled by the
 * user, pending queue rows are drained to a remote endpoint with timestamp
 * conflict resolution. In local-only mode (default) it simply reports the
 * pending count so the UI can show "all saved locally".
 *
 * Conflict resolution rules (#302):
 *   1. Tombstone wins      — delete propagates
 *   2. Timestamp gate      — server.updated_at > mutation.client_updated_at ⇒ skip
 *   3. Status ladder       — never downgrade on `quotes.status`
 *   4. Field-level merge   — diff queued payload vs server, union disjoint fields
 *   5. Server-only fields  — never overwrite ai_summary, last_contact_at, etc.
 */

import { invoke } from './tauri';
import type { QuoteStatus } from './database.types';

// ── Types mirror Rust side ─────────────────────────────────────────
interface QueueRow {
  id: string;
  table_name: string;
  row_id: string;
  operation: 'insert' | 'update' | 'delete';
  payload: string;                // JSON string
  client_updated_at: string;      // ISO UTC
  attempts: number;
  last_error: string | null;
  pushed_at: string | null;
  created_at: string;
}

export interface FlushResult {
  flushed: number;
  failed: number;
  skipped: number;
  orphanedRows: { table: string; rowId: string }[];
}

// ── Status ladder — identical to legacy offline-sync.ts ──────────
// [Req #157, #222, #240] Higher number = more "final"; never downgrade.
const STATUS_PRIORITY: Record<QuoteStatus, number> = {
  new: 0,
  open: 1,
  waiting: 2,
  follow_up: 3,
  verbal_approval: 4,
  in_production: 5,
  shipped: 6,
  dormant: 7,
  lost: 8,
  won: 9,
};

const STATUS_PROTECTED_TABLES = new Set(['quotes']);

/** [Req #302] Server-authoritative fields — never overwritten by queued offline edits. */
const SERVER_ONLY_FIELDS = new Set([
  'created_at',
  'updated_at',
  'deleted_at',
  'ai_summary',
  'ai_summary_at',
  'days_since_contact',
  'last_contact_at',
]);

// ── Public API (preserves offline-sync.ts surface) ────────────────

/**
 * Count of mutations not yet pushed to cloud.
 * In pure local mode this is "pending backup" — data itself is already safe.
 */
export async function pendingMutationCount(): Promise<number> {
  try {
    return await invoke<number>('sync_queue_count');
  } catch {
    return 0;
  }
}

/**
 * Legacy enqueue shim. In the new architecture, enqueueing is done atomically
 * inside the Rust mutation commands. This function is kept for backward
 * compatibility but is effectively a no-op — the mutation has already been
 * queued by the transactional INSERT/UPDATE/DELETE.
 */
export function enqueueOfflineMutation(
  _table: string,
  _operation: 'insert' | 'update',
  _payload: Record<string, unknown>,
  _rowId?: string,
): void {
  // Intentionally empty. Atomic enqueue lives in Rust.
  if (import.meta.env.DEV) {
    console.warn('[sync-queue] enqueueOfflineMutation is a no-op; mutations auto-queue in Rust');
  }
}

/** Clear the entire pending queue (e.g. after a successful full re-sync). */
export async function clearOfflineQueue(): Promise<void> {
  try {
    await invoke<void>('sync_queue_clear');
  } catch (e) {
    console.warn('[sync-queue] clear failed:', e);
  }
}

/**
 * Drain the pending queue by pushing rows to the supplied remote transport.
 * Injectable transport lets tests/cloud-opt-in hook their own endpoint.
 * In default local-only mode the transport is a no-op which "skips" everything.
 */
export interface RemoteTransport {
  /** Fetch current server row (or null if absent). Must include `updated_at`. */
  fetchRow(table: string, rowId: string): Promise<Record<string, unknown> | null>;
  /** Apply insert/update/delete. Return `{ ok: true }` on success. */
  apply(op: {
    table: string;
    rowId: string;
    operation: 'insert' | 'update' | 'delete';
    patch: Record<string, unknown>;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Default transport: cloud sync disabled. Every row is "skipped". */
export const noopTransport: RemoteTransport = {
  async fetchRow() { return null; },
  async apply() { return { ok: true }; },
};

export async function flushOfflineQueue(
  transport: RemoteTransport = noopTransport,
): Promise<FlushResult> {
  let queue: QueueRow[] = [];
  try {
    queue = await invoke<QueueRow[]>('sync_queue_pending', { limit: 500 });
  } catch (e) {
    console.warn('[sync-queue] pending fetch failed:', e);
    return { flushed: 0, failed: 0, skipped: 0, orphanedRows: [] };
  }
  if (queue.length === 0) return { flushed: 0, failed: 0, skipped: 0, orphanedRows: [] };

  let flushed = 0;
  let failed = 0;
  let skipped = 0;
  const orphanedRows: { table: string; rowId: string }[] = [];
  const orphanedKeys = new Set<string>();

  for (const m of queue) {
    const key = `${m.table_name}:${m.row_id}`;

    // Pre-check: orphaned in earlier iteration
    if (orphanedKeys.has(key)) {
      skipped++;
      await markPushed(m.id);    // clear from queue
      continue;
    }

    try {
      const payload = JSON.parse(m.payload) as Record<string, unknown>;

      if (m.operation === 'insert') {
        const r = await transport.apply({
          table: m.table_name, rowId: m.row_id, operation: 'insert', patch: payload,
        });
        if (!r.ok) throw new Error(r.error);
        await markPushed(m.id);
        flushed++;
        continue;
      }

      if (m.operation === 'delete') {
        // Rule 1: tombstone always wins
        const r = await transport.apply({
          table: m.table_name, rowId: m.row_id, operation: 'delete', patch: payload,
        });
        if (!r.ok) throw new Error(r.error);
        await markPushed(m.id);
        flushed++;
        continue;
      }

      // UPDATE path
      const serverRow = await transport.fetchRow(m.table_name, m.row_id);

      if (!serverRow) {
        // Rule 0: row deleted on server — purge this mutation and any siblings
        orphanedKeys.add(key);
        orphanedRows.push({ table: m.table_name, rowId: m.row_id });
        await markPushed(m.id);
        skipped++;
        continue;
      }

      // Rule 2: timestamp gate
      const serverTs = typeof serverRow.updated_at === 'string'
        ? Date.parse(serverRow.updated_at) : NaN;
      const mutTs = Date.parse(m.client_updated_at);
      if (!isNaN(serverTs) && !isNaN(mutTs) && serverTs > mutTs) {
        await markPushed(m.id);
        skipped++;
        continue;
      }

      // Rules 3-5: merge
      const patch = mergePayload(m.table_name, payload, serverRow);
      if (Object.keys(patch).length === 0) {
        await markPushed(m.id);
        skipped++;
        continue;
      }

      const r = await transport.apply({
        table: m.table_name, rowId: m.row_id, operation: 'update', patch,
      });
      if (!r.ok) throw new Error(r.error);
      await markPushed(m.id);
      flushed++;
    } catch (e) {
      failed++;
      await markFailed(m.id, e instanceof Error ? e.message : String(e));
    }
  }

  return { flushed, failed, skipped, orphanedRows };
}

// ── Merge logic (rules 3-5) ────────────────────────────────────────

function mergePayload(
  table: string,
  queued: Record<string, unknown>,
  server: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(queued)) {
    if (SERVER_ONLY_FIELDS.has(k)) continue;                  // Rule 5

    if (k === 'status' && STATUS_PROTECTED_TABLES.has(table)) { // Rule 3
      const sv = server[k] as QuoteStatus | undefined;
      const qv = v as QuoteStatus;
      if (sv && qv) {
        const sp = STATUS_PRIORITY[sv] ?? -1;
        const qp = STATUS_PRIORITY[qv] ?? -1;
        if (qp < sp) continue;                                // skip downgrade
      }
    }

    if (!deepEqual(v, server[k])) patch[k] = v;               // Rule 4
  }
  return patch;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

// ── Rust helpers ──────────────────────────────────────────────────

async function markPushed(id: string): Promise<void> {
  try {
    await invoke('sync_queue_mark_pushed', { id });
  } catch (e) {
    console.warn('[sync-queue] mark_pushed failed:', e);
  }
}

async function markFailed(id: string, err: string): Promise<void> {
  try {
    await invoke('sync_queue_mark_failed', { id, err });
  } catch (e) {
    console.warn('[sync-queue] mark_failed failed:', e);
  }
}
