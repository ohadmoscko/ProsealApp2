/**
 * [Req #263] Local auto-save: character-level persistence for text inputs.
 * If the user leaves mid-sentence, the text will be restored on next load.
 *
 * [Req #302] Offline conflict resolution: timestamp-based merge strategy.
 * Each save carries a `saved_at` ISO timestamp. When syncing back online,
 * the server-side data wins only if its `updated_at` > local `saved_at`.
 * Otherwise, the local change is applied (field-level merge, not row-level).
 */

const STORAGE_PREFIX = 'proseal_autosave_';

// ── Auto-save (Req #263) ──────────────────────────────────────────────

export interface AutoSaveEntry {
  value: string;
  saved_at: string; // ISO timestamp
}

/** Save a text value to localStorage for a given key */
export function autoSave(key: string, value: string): void {
  try {
    const entry: AutoSaveEntry = {
      value,
      saved_at: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded or unavailable — silent fail
  }
}

/** Load a previously auto-saved value. Returns null if nothing stored. */
export function autoLoad(key: string): AutoSaveEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as AutoSaveEntry;
  } catch {
    return null;
  }
}

/** Clear a specific auto-save entry (after successful save to DB) */
export function autoClear(key: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // silent
  }
}

// ── Offline conflict resolution (Req #302) ────────────────────────────

export interface ConflictCheck {
  /** true if the local change should be applied (it's newer) */
  localWins: boolean;
  /** Explanation for logging */
  reason: string;
}

/**
 * Check if a local change should overwrite the server data.
 * Uses a simple "last write wins" strategy based on timestamps.
 *
 * @param localSavedAt - When the user made the local change (ISO string)
 * @param serverUpdatedAt - When the server record was last updated (ISO string)
 * @returns ConflictCheck result
 */
export function resolveConflict(
  localSavedAt: string,
  serverUpdatedAt: string,
): ConflictCheck {
  const localTime = new Date(localSavedAt).getTime();
  const serverTime = new Date(serverUpdatedAt).getTime();

  if (localTime >= serverTime) {
    return {
      localWins: true,
      reason: `Local change (${localSavedAt}) is newer than server (${serverUpdatedAt})`,
    };
  }

  return {
    localWins: false,
    reason: `Server change (${serverUpdatedAt}) is newer than local (${localSavedAt})`,
  };
}

// ── Offline queue (Req #302) ──────────────────────────────────────────

const QUEUE_KEY = 'proseal_offline_queue';

export interface QueuedMutation {
  id: string;
  table: string;
  recordId: string;
  fields: Record<string, unknown>;
  queued_at: string;
}

/** Add a mutation to the offline queue when the network is down */
export function enqueueOfflineMutation(mutation: Omit<QueuedMutation, 'id' | 'queued_at'>): void {
  try {
    const queue = loadOfflineQueue();
    queue.push({
      ...mutation,
      id: crypto.randomUUID(),
      queued_at: new Date().toISOString(),
    });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // silent
  }
}

/** Load all queued offline mutations */
export function loadOfflineQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Clear the offline queue after successful sync */
export function clearOfflineQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    // silent
  }
}

/** Remove a specific mutation from the queue by ID */
export function dequeueMutation(id: string): void {
  try {
    const queue = loadOfflineQueue().filter((m) => m.id !== id);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // silent
  }
}
