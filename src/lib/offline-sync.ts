/**
 * Offline Sync with Last-Write-Wins (LWW) conflict resolution.
 *
 * Queues mutations when offline, persists to localStorage, and
 * flushes them in order when connectivity returns.
 *
 * Conflict strategy: each mutation carries an `updated_at` timestamp.
 * The server's `update_updated_at()` trigger handles LWW — if the
 * row was modified more recently than our queued write, our write
 * still overwrites (true LWW: last writer wins by wall-clock time).
 *
 * For append-only data (interactions, captures), there's no conflict —
 * inserts are idempotent via Supabase's unique constraints.
 */

import { supabase } from './supabase';

// ── Types ──────────────────────────────────────────────────────────────

interface QueuedMutation {
  id: string;
  table: string;
  operation: 'insert' | 'update';
  payload: Record<string, unknown>;
  /** For updates: the row ID to match */
  rowId?: string;
  /** Wall-clock time when the user made the change */
  timestamp: string;
}

const STORAGE_KEY = 'proseal_offline_queue';

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
 * Flush all queued mutations in order.
 * Called when coming back online.
 * Returns { flushed, failed } counts.
 */
export async function flushOfflineQueue(): Promise<{ flushed: number; failed: number }> {
  const queue = loadQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueuedMutation[] = [];

  for (const mutation of queue) {
    try {
      // Dynamic table name requires type assertion
      const table = supabase.from(mutation.table) as ReturnType<typeof supabase.from>;
      if (mutation.operation === 'insert') {
        const { error } = await (table as any).insert(mutation.payload);
        if (error) throw error;
      } else if (mutation.operation === 'update' && mutation.rowId) {
        const { error } = await (table as any).update(mutation.payload).eq('id', mutation.rowId);
        if (error) throw error;
      }
      flushed++;
    } catch (err) {
      console.warn('[offline-sync] Failed to flush mutation:', mutation.id, err);
      failed++;
      remaining.push(mutation); // Keep for retry
    }
  }

  saveQueue(remaining);
  return { flushed, failed };
}

/** Clear the entire queue (e.g., on logout) */
export function clearOfflineQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}
