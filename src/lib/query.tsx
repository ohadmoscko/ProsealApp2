import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

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
