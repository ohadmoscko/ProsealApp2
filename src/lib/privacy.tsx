/**
 * [Req #140] Privacy mode context — show code names instead of real client names.
 * When active, client.code is displayed and real identifiers are hidden.
 * Toggled via a button in the dashboard toolbar.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface PrivacyContextValue {
  privacyMode: boolean;
  togglePrivacy: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  privacyMode: false,
  togglePrivacy: () => {},
});

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [privacyMode, setPrivacyMode] = useState(() => {
    try { return localStorage.getItem('proseal_privacy_mode') === 'true'; }
    catch { return false; }
  });

  const togglePrivacy = useCallback(() => {
    setPrivacyMode((prev) => {
      const next = !prev;
      try { localStorage.setItem('proseal_privacy_mode', String(next)); } catch { /* silent */ }
      return next;
    });
  }, []);

  return (
    <PrivacyContext.Provider value={{ privacyMode, togglePrivacy }}>
      {children}
    </PrivacyContext.Provider>
  );
}

// [Req #140] Hook to read privacy state
export function usePrivacy() {
  return useContext(PrivacyContext);
}

// [Req #140] Helper: returns display name based on privacy mode
export function clientDisplayName(
  code: string | undefined | null,
  realName: string | undefined | null,
  privacyMode: boolean,
): string {
  if (privacyMode) return code ?? '***';
  return realName ?? code ?? '—';
}
