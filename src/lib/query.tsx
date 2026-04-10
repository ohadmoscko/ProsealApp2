import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { flushOfflineQueue, pendingMutationCount } from './offline-sync';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 1, // Retry failed mutations once
      },
    },
  }));

  // Flush offline queue when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      const pending = pendingMutationCount();
      if (pending > 0) {
        console.info(`[offline-sync] Back online — flushing ${pending} queued mutations`);
        const { flushed, failed, skipped } = await flushOfflineQueue();
        console.info(`[offline-sync] Flushed: ${flushed}, Failed: ${failed}, Skipped: ${skipped}`);
        // Invalidate all queries to pick up synced data
        if (flushed > 0) {
          client.invalidateQueries();
        }
      }
    };
    window.addEventListener('online', handleOnline);
    // Also flush on mount (app may have been opened while offline then regained connection)
    if (navigator.onLine) handleOnline();
    return () => window.removeEventListener('online', handleOnline);
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Hook: returns true when the browser is offline */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    // Sync TanStack Query's online manager with browser events
    onlineManager.setEventListener((setOnline) => {
      const onOnline = () => { setOnline(true); setOffline(false); };
      const onOffline = () => { setOnline(false); setOffline(true); };
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    });
  }, []);

  return offline;
}

/** Hook: number of mutations waiting to sync */
export function usePendingSync(): number {
  const offline = useIsOffline();
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(pendingMutationCount());
    // Re-check every 5s while offline
    if (offline) {
      const interval = setInterval(() => setCount(pendingMutationCount()), 5000);
      return () => clearInterval(interval);
    }
  }, [offline]);

  return count;
}
