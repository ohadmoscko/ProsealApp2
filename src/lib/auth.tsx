// [Req #292] Auth context rewritten for local-first single-user desktop.
// Supabase JWT auth REMOVED. Identity = hard-coded local user + SQLCipher unlock.
// Login page now collects the passphrase; success = DB pool up, user = LOCAL_USER_ID.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { LOCAL_USER_ID, isDbInitialized, initializeDb, unlockDb } from './db';
import type { Profile } from './database.types';

// Minimal User shape to preserve call-site API (previously @supabase/supabase-js's User).
export interface LocalUser {
  id: string;
  email: string;
}

interface AuthState {
  user: LocalUser | null;
  profile: Profile | null;
  loading: boolean;
  /** [Req #292] Passphrase-based unlock. `email` retained as display-only. */
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    // Attempt auto-unlock if keyring already has passphrase
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      if (await isDbInitialized()) {
        await unlockDb();
        await loadLocalSession();
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    } catch (e) {
      console.warn('[auth] bootstrap failed:', e);
      setUser(null);
      setProfile(null);
      setLoading(false);
    }
  }

  async function loadLocalSession() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', LOCAL_USER_ID)
      .maybeSingle();
    if (error) console.warn('[auth] profile load error:', error.message);
    setUser({ id: LOCAL_USER_ID, email: (data as Profile | null)?.email ?? 'local@proseal.local' });
    setProfile((data as Profile | null) ?? null);
    setLoading(false);
  }

  // [Req #292] `email` ignored — retained so UI doesn't break. `password` is the passphrase.
  async function signIn(_email: string, password: string) {
    try {
      if (!(await isDbInitialized())) {
        await initializeDb(password);   // first-run: persist passphrase
      } else {
        await unlockDb();               // subsequent: use keyring
      }
      await loadLocalSession();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  async function signOut() {
    // Local auth = nothing to revoke. Just clear in-memory state.
    setUser(null);
    setProfile(null);
    setLoading(false);
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
