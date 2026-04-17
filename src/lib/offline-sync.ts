/**
 * [Req #302] DEPRECATED — legacy import path.
 *
 * Implementation moved to `sync-queue.ts` (SQLite-backed). This file exists
 * only as a re-export shim so existing imports keep working without edits.
 *
 * New code should import from `./sync-queue` directly.
 */

export {
  pendingMutationCount,
  clearOfflineQueue,
  flushOfflineQueue,
  enqueueOfflineMutation,
  noopTransport,
  type FlushResult,
  type RemoteTransport,
} from './sync-queue';
