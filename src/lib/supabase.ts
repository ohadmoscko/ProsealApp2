/**
 * [Req #225, #243, #245, #292] DEPRECATED Supabase re-export shim.
 *
 * Per ADR-003, the Proseal Brain is now local-first on Tauri-embedded SQLite.
 * This file used to initialise a `@supabase/supabase-js` client. It now
 * re-exports the local SQLite-backed facade under the same `supabase` name so
 * the rest of the codebase (data.ts, auth.tsx, hooks.ts, components/*) keeps
 * working without touching every call-site.
 *
 * Do NOT add new imports from this file. Use `./db` directly going forward.
 */

// [Req #225] Legacy name → local facade
export { db as supabase } from './db';

// Legacy Database type lives in database.types.ts; keep re-export for type
// compatibility with older callers. Runtime Database shape is unused.
export type { Database } from './database.types';
