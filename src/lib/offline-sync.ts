/**
 * Offline Sync with field-level merging, status protection & timestamp
 * conflict resolution.
 *
 * Queues mutations when offline, persists to localStorage, and
 * flushes them in order when connectivity returns.
 *
 * Conflict strategy (v3 — timestamp-aware):
 * - INSERT: append-only, idempotent via unique constraints.
 * - UPDATE: three-phase guard:
 *     1. Timestamp gate — if serverRow.updated_at > mutation.timestamp,
 *        the server was modified AFTER our offline edit ⇒ skip entirely.
 *     2. Field-level merge — only include fields the user actually
 *        changed vs the current server state.
 *     3. Status ladder — a stale offline write cannot downgrade a
 *        status that moved forward on the server.
 * - DELETE-on-server — if the row no longer exists, discard the
 *   queued mutation and purge any other mutations targeting the
 *   same row from the queue (orphan cleanup).
 */

import { supabase } from './supabase';
import type { QuoteStatus } from './database.types';

// ── Types ──────────────────────────────────────────────────────────────

interface QueuedMutation {
  id: string;
  table: string;
  operation: 'insert' | 'update';
  payload: Record<string, unknown>;
  /** For updates: the row ID to match */
  rowId?: string;
  /** Wall-clock time when the user made the change (ISO string) */
  timestamp: string;
}

export interface FlushResult {
  flushed: number;
  failed: number;
  skipped: number;
  /** Rows that no longer exist on the server — caller should invalidate caches */
  orphanedRows: { table: string; rowId: string }[];
}

const STORAGE_KEY = 'proseal_offline_queue';

// ── Status priority (higher = more "final") ──────────────────────────
// A queued update can only move status *forward* in this ladder.
// If the server is already at a higher-priority status, we skip the
// status field to prevent accidental rollback.

const STATUS_PRIORITY: Record<QuoteStatus, number> = {
  new: 0,
  open: 1,
  waiting: 2,
  follow_up: 3,
  dormant: 4,
  lost: 5,
  won: 6,
};

/** Tables that have a `status` column we need to protect */
const STATUS_PROTECTED_TABLES = new Set(['quotes']);

/** Fields that are never merged from offline (server-authoritative) */
const SERVER_ONLY_FIELDS = new Set([
  'created_at',
  'updated_at',
  'deleted_at',
  'ai_summary',
  'ai_summary_at',
  'days_since_contact',
  'last_contact_at',
]);

// ── Queue management ──────────────────────────────────────────────────

function loadQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedMutation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

/** Enqueue a mutation for later sync. Returns immediately. */
export function enqueueOfflineMutation(
  table: string,
  operation: 'insert' | 'update',
  payload: Record<string, unknown>,
  rowId?: string,
): void {
  const queue = loadQueue();
  queue.push({
    id: crypto.randomUUID(),
    table,
    operation,
    payload: { ...payload, updated_at: new Date().toISOString() },
    rowId,
    timestamp: new Date().toISOString(),
  });
  saveQueue(queue);
}

/** How many mutations are waiting? */
export function pendingMutationCount(): number {
  return loadQueue().length;
}

/**
 * Merge a queued update payload against the current server row.
 *
 * Rules:
 * 1. Skip server-authoritative fields (created_at, ai_summary, etc.)
 * 2. For `status`: only apply if queued status has equal or higher priority
 * 3. For all other fields: apply only if the queued value differs from server
 *
 * Returns the merged patch (may be empty if nothing to write).
 */
function mergePayload(
  table: string,
  queued: Record<string, unknown>,
  server: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const [key, queuedValue] of Object.entries(queued)) {
    // Never overwrite server-authoritative fields
    if (SERVER_ONLY_FIELDS.has(key)) continue;

    // Status protection: prevent downgrade
    if (key === 'status' && STATUS_PROTECTED_TABLES.has(table)) {
      const serverStatus = server[key] as QuoteStatus | undefined;
      const queuedStatus = queuedValue as QuoteStatus;

      if (serverStatus && queuedStatus) {
        const serverPrio = STATUS_PRIORITY[serverStatus] ?? -1;
        const queuedPrio = STATUS_PRIORITY[queuedStatus] ?? -1;

        if (queuedPrio < serverPrio) {
          // Queued status is lower priority — skip it
          console.info(
            `[offline-sync] Status protection: kept server "${serverStatus}" (prio ${serverPrio}), ` +
            `skipped queued "${queuedStatus}" (prio ${queuedPrio})`,
          );
          continue;
        }
      }
    }

    // Field-level diff: only include if value actually changed
    const serverValue = server[key];
    if (!fieldEqual(queuedValue, serverValue)) {
      patch[key] = queuedValue;
    }
  }

  return patch;
}

/** Deep-ish equality for JSON-safe values (primitives, arrays, plain objects) */
function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => fieldEqual(v, b[i]));
  }

  // Plain objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of keys) {
      if (!fieldEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Flush all queued mutations in order.
 * Called when coming back online.
 *
 * Three-phase guard for updates:
 *  1. Orphan check  — row deleted on server ⇒ discard + purge related mutations
 *  2. Timestamp gate — server updated_at > mutation timestamp ⇒ skip (stale)
 *  3. Field merge    — diff remaining fields, protect status ladder
 *
 * Returns FlushResult with counts + list of orphaned rows for cache invalidation.
 */
export async function flushOfflineQueue(): Promise<FlushResult> {
  const queue = loadQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0, skipped: 0, orphanedRows: [] };

  let flushed = 0;
  let failed = 0;
  let skipped = 0;
  const remaining: QueuedMutation[] = [];
  const orphanedRows: { table: string; rowId: string }[] = [];
  /** Track orphaned (table+rowId) so subsequent mutations for the same row are auto-skipped */
  const orphanedKeys = new Set<string>();

  for (const mutation of queue) {
    try {
      // ── Pre-check: skip if this row was already found orphaned in an earlier pass
      if (mutation.operation === 'update' && mutation.rowId) {
        const key = `${mutation.table}:${mutation.rowId}`;
        if (orphanedKeys.has(key)) {
          console.info(`[offline-sync] Purging related mutation ${mutation.id} for orphaned ${key}`);
          skipped++;
          continue;
        }
      }

      if (mutation.operation === 'insert') {
        // Inserts are append-only — no merge needed
        const { error } = await (supabase.from(mutation.table) as any).insert(mutation.payload);
        if (error) throw error;
        flushed++;
      } else if (mutation.operation === 'update' && mutation.rowId) {
        // ── Phase 1: Fetch current server row
        const { data: serverRow, error: fetchErr } = await (supabase.from(mutation.table) as any)
          .select('*')
          .eq('id', mutation.rowId)
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (!serverRow) {
          // Row deleted on server — discard this mutation and mark row as orphaned
          // so any subsequent mutations for the same row are also purged.
          const key = `${mutation.table}:${mutation.rowId}`;
          orphanedKeys.add(key);
          orphanedRows.push({ table: mutation.table, rowId: mutation.rowId });
          console.warn(
            `[offline-sync] Row ${mutation.rowId} deleted on server (${mutation.table}). ` +
            `Discarding mutation ${mutation.id} and purging related queue entries.`,
          );
          skipped++;
          continue;
        }

        // ── Phase 2: Timestamp conflict gate
        // If the server row was updated AFTER our offline mutation was queued,
        // the server data is authoritative — skip this mutation entirely.
        const serverUpdatedAt = (serverRow as Record<string, unknown>).updated_at as string | undefined;
        if (serverUpdatedAt && mutation.timestamp) {
          const serverTime = new Date(serverUpdatedAt).getTime();
          const mutationTime = new Date(mutation.timestamp).getTime();

          if (!isNaN(serverTime) && !isNaN(mutationTime) && serverTime > mutationTime) {
            console.info(
              `[offline-sync] Timestamp conflict for ${mutation.table}/${mutation.rowId}: ` +
              `server=${serverUpdatedAt} > mutation=${mutation.timestamp}. Skipping stale write.`,
            );
            skipped++;
            continue;
          }
        }

        // ── Phase 3: Field-level merge with status protection
        const patch = mergePayload(
          mutation.table,
          mutation.payload,
          serverRow as Record<string, unknown>,
        );

        // Only write if there's something to update
        if (Object.keys(patch).length === 0) {
          console.info(`[offline-sync] No effective changes for ${mutation.table}/${mutation.rowId}, skipping`);
          skipped++;
          continue;
        }

        const { error } = await (supabase.from(mutation.table) as any)
          .update(patch)
          .eq('id', mutation.rowId);
        if (error) throw error;
        flushed++;
      }
    } catch (err) {
      console.warn('[offline-sync] Failed to flush mutation:', mutation.id, err);
      failed++;
      remaining.push(mutation); // Keep for retry
    }
  }

  saveQueue(remaining);
  return { flushed, failed, skipped, orphanedRows };
}

/** Clear the entire queue (e.g., on logout) */
export function clearOfflineQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}
