/**
 * [Req #225, #243, #245, #302]
 * Local-first DB facade — Supabase-shaped API backed by Tauri SQLite commands.
 *
 * Goal: existing callers (`supabase.from('t').select().eq(...).single()`) keep
 * working after a one-line import swap (`./supabase` → `./db`).
 *
 * Supported subset of PostgREST:
 *   .from(table)
 *   .select(cols?)
 *   .insert(row).select().single()
 *   .update(patch)
 *   .delete()
 *   .eq / .neq / .gt / .gte / .lt / .lte / .like / .is / .in / .not
 *   .order(col, { ascending, nullsFirst })
 *   .limit(n)
 *   .single() / .maybeSingle()
 *   .rpc(name, args)
 *   .functions.invoke(name, { body })  → no-op stub (returns { data, error: null })
 *
 * NOT supported (throws): joins via nested select (`clients(*)`), realtime.
 * The caller in `data.ts` uses `*, client:clients(*)` which we emulate by
 * performing a second fetch when a relation alias is detected.
 */

import { invoke } from './tauri';

// ── invoke-safe wrapper (dev / non-Tauri fallback) ─────────────────
// When running vite in browser preview, Tauri.invoke is undefined.
// We fall back to throwing so devs notice and run `npm run tauri dev`.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await invoke(cmd, args)) as T;
  } catch (e) {
    throw new Error(`[db] ${cmd} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Filter DSL mirrors Rust side ───────────────────────────────────
type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'is' | 'not_is' | 'in' | 'not_in';
interface Filter { col: string; op: Op; value: unknown }
interface OrderBy { col: string; desc?: boolean; nulls_last?: boolean }

type Result<T> = { data: T | null; error: { message: string } | null };

// ── Relation parsing for `*, client:clients(*)` shorthand ─────────
interface Relation { alias: string; table: string }

function parseRelations(select: string): { baseCols: string[]; relations: Relation[] } {
  // Example: "*, client:clients(*), interactions:interactions(*)"
  const parts = select.split(',').map((s) => s.trim()).filter(Boolean);
  const baseCols: string[] = [];
  const relations: Relation[] = [];
  for (const p of parts) {
    const m = p.match(/^([a-zA-Z_][\w]*)\s*:\s*([a-zA-Z_][\w]*)\s*\(\s*\*\s*\)$/);
    if (m) {
      relations.push({ alias: m[1], table: m[2] });
    } else {
      baseCols.push(p);
    }
  }
  return { baseCols, relations };
}

// ── Chainable builder ──────────────────────────────────────────────
class QueryBuilder<Row = Record<string, unknown>> implements PromiseLike<Result<Row | Row[]>> {
  private _select = '*';
  private _filters: Filter[] = [];
  private _order: OrderBy[] = [];
  private _limit?: number;
  private _single = false;
  private _maybeSingle = false;

  // Mutation state
  private _mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private _insertRow: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private _patch: Record<string, unknown> | null = null;
  // Ignored options — kept for API parity
  // private _onConflict?: string;

  constructor(private table: string) {}

  // ── Entry verbs ──
  select(cols = '*'): this { this._select = cols; this._mode = this._mode === 'select' ? 'select' : this._mode; return this; }
  insert(row: Record<string, unknown> | Record<string, unknown>[]): this {
    this._mode = 'insert';
    this._insertRow = row;
    return this;
  }
  update(patch: Record<string, unknown>): this {
    this._mode = 'update';
    this._patch = patch;
    return this;
  }
  delete(): this { this._mode = 'delete'; return this; }
  upsert(row: Record<string, unknown> | Record<string, unknown>[]): this {
    // Minimal: treat as insert (Rust INSERT uses RETURNING *; duplicate-PK → caller handles)
    return this.insert(row);
  }

  // ── Filters ──
  eq(col: string, value: unknown): this { this._filters.push({ col, op: 'eq', value }); return this; }
  neq(col: string, value: unknown): this { this._filters.push({ col, op: 'neq', value }); return this; }
  gt(col: string, value: unknown): this { this._filters.push({ col, op: 'gt', value }); return this; }
  gte(col: string, value: unknown): this { this._filters.push({ col, op: 'gte', value }); return this; }
  lt(col: string, value: unknown): this { this._filters.push({ col, op: 'lt', value }); return this; }
  lte(col: string, value: unknown): this { this._filters.push({ col, op: 'lte', value }); return this; }
  like(col: string, value: unknown): this { this._filters.push({ col, op: 'like', value }); return this; }
  is(col: string, value: unknown): this { this._filters.push({ col, op: 'is', value }); return this; }
  in(col: string, values: unknown[]): this { this._filters.push({ col, op: 'in', value: values }); return this; }

  /** Supabase `.not('status', 'in', '("a","b")')` — we support the common shapes */
  not(col: string, op: string, value: unknown): this {
    if (op === 'is') { this._filters.push({ col, op: 'not_is', value }); return this; }
    if (op === 'in') {
      // Parse either array or string "(a,b,c)" form
      let arr: unknown[];
      if (Array.isArray(value)) arr = value;
      else if (typeof value === 'string') {
        arr = value
          .replace(/^\(|\)$/g, '')
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''));
      } else arr = [value];
      this._filters.push({ col, op: 'not_in', value: arr });
      return this;
    }
    throw new Error(`[db] .not('${col}', '${op}', ...) unsupported`);
  }

  // ── Ordering / paging ──
  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this._order.push({
      col,
      desc: opts.ascending === false,
      nulls_last: opts.nullsFirst === false,
    });
    return this;
  }
  limit(n: number): this { this._limit = n; return this; }
  range(_from: number, _to: number): this {
    this._limit = _to - _from + 1;
    return this;
  }
  single(): this { this._single = true; return this; }
  maybeSingle(): this { this._single = true; this._maybeSingle = true; return this; }

  // ── Execution ──
  async execute(): Promise<Result<Row | Row[]>> {
    try {
      const relResult = await this.runMain();
      const { data, error } = relResult;
      if (error || data == null) return { data, error };
      // Optional relation hydration
      const rels = parseRelations(this._select).relations;
      if (rels.length === 0) return { data, error: null };
      const rows = Array.isArray(data) ? data : [data];
      for (const rel of rels) {
        await this.hydrateRelation(rows as Record<string, unknown>[], rel);
      }
      return { data: Array.isArray(data) ? (rows as Row[]) : (rows[0] as Row), error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  private async runMain(): Promise<Result<Row | Row[]>> {
    switch (this._mode) {
      case 'insert':   return this.execInsert();
      case 'update':   return this.execUpdate();
      case 'delete':   return this.execDelete();
      case 'select':
      default:         return this.execSelect();
    }
  }

  private async execSelect(): Promise<Result<Row | Row[]>> {
    const { baseCols } = parseRelations(this._select);
    const columns = baseCols.length === 0 || baseCols[0] === '*' ? undefined : baseCols;
    const out = await call<unknown>('db_select', {
      args: {
        table: this.table,
        columns,
        filters: this._filters,
        order: this._order,
        limit: this._limit,
        single: this._single,
      },
    });
    if (this._single) {
      // out is object or null
      if (out == null) {
        if (this._maybeSingle) return { data: null, error: null };
        return { data: null, error: { message: 'no rows returned' } };
      }
      return { data: out as Row, error: null };
    }
    return { data: (out as Row[]) ?? [], error: null };
  }

  private async execInsert(): Promise<Result<Row | Row[]>> {
    const rows = Array.isArray(this._insertRow) ? this._insertRow : [this._insertRow!];
    const inserted: Row[] = [];
    for (const row of rows) {
      const out = await call<Row>('db_insert', {
        args: { table: this.table, row },
      });
      inserted.push(out);
    }
    if (this._single) return { data: inserted[0] ?? null, error: null };
    return { data: inserted, error: null };
  }

  private async execUpdate(): Promise<Result<Row | Row[]>> {
    const out = await call<Row[]>('db_update', {
      args: { table: this.table, patch: this._patch!, filters: this._filters },
    });
    if (this._single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  private async execDelete(): Promise<Result<Row | Row[]>> {
    const out = await call<Row[]>('db_delete', {
      args: { table: this.table, filters: this._filters },
    });
    if (this._single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  /** Nested `client:clients(*)` → load referenced rows by foreign key column. */
  private async hydrateRelation(rows: Record<string, unknown>[], rel: Relation) {
    // Convention: local column is `${singular(rel.table)}_id` e.g. clients → client_id
    const fkCol = `${singular(rel.table)}_id`;
    const ids = Array.from(new Set(rows.map((r) => r[fkCol]).filter((v) => !!v))) as unknown[];
    if (ids.length === 0) {
      for (const r of rows) r[rel.alias] = null;
      return;
    }
    const related = await call<Record<string, unknown>[]>('db_select', {
      args: {
        table: rel.table,
        filters: [{ col: 'id', op: 'in', value: ids }],
      },
    });
    const byId = new Map<unknown, Record<string, unknown>>();
    for (const rr of related) byId.set(rr.id, rr);
    for (const r of rows) r[rel.alias] = byId.get(r[fkCol]) ?? null;
  }

  // PromiseLike — allows `await qb` without calling .execute()
  then<TResult1 = Result<Row | Row[]>, TResult2 = never>(
    onfulfilled?: ((value: Result<Row | Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function singular(t: string): string {
  // Hack: crude plural→singular for FK-column convention
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('s'))   return t.slice(0, -1);
  return t;
}

// ── Client facade ──────────────────────────────────────────────────
class LocalClient {
  from<R = Record<string, unknown>>(table: string): QueryBuilder<R> {
    return new QueryBuilder<R>(table);
  }

  async rpc(name: string, args?: Record<string, unknown>): Promise<Result<unknown>> {
    try {
      const out = await call<unknown>('db_rpc', { args: { name, args: args ?? {} } });
      return { data: out, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  /**
   * Edge Function stub. Real cloud Edge Functions are out of scope in local-first
   * mode. Callers should handle a null/empty response gracefully. Specific
   * functions (generate-summary, generate-weekly-report, process-capture) are
   * dispatched to local AI integration points when wired in a later sprint.
   */
  functions = {
    invoke: async (name: string, _opts?: { body?: unknown }): Promise<Result<unknown>> => {
      console.warn(`[db] functions.invoke('${name}') — local stub, returning null`);
      return { data: null, error: null };
    },
  };

  /** Auth stub — single-user local desktop app. See auth.tsx. */
  auth = {
    getUser: async () => ({ data: { user: { id: LOCAL_USER_ID } }, error: null }),
    signInWithPassword: async () => ({ data: { user: { id: LOCAL_USER_ID } }, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: (_cb: unknown) => ({
      data: { subscription: { unsubscribe: () => undefined } },
    }),
  };
}

export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Drop-in replacement for the old Supabase client. */
export const db = new LocalClient();

// Convenience utilities for direct use -------------------------------------
export async function dbImport(payload: Record<string, unknown[]>): Promise<{
  inserted: Record<string, number>;
  skipped: Record<string, number>;
}> {
  return (await call('db_import', { args: { payload } })) as {
    inserted: Record<string, number>;
    skipped: Record<string, number>;
  };
}

export async function isDbInitialized(): Promise<boolean> {
  return await call<boolean>('is_db_initialized');
}
export async function initializeDb(passphrase: string): Promise<void> {
  await call<void>('initialize_db', { passphrase });
}
export async function unlockDb(): Promise<void> {
  await call<void>('unlock_db');
}

// [Req #301] Sanitize payload before ANY outbound AI call
export async function sanitizeAiPayload<T = unknown>(payload: T): Promise<{
  payload: T;
  stripped_keys: string[];
  redacted_values: number;
}> {
  return (await call('sanitize_ai_payload', { payload })) as {
    payload: T;
    stripped_keys: string[];
    redacted_values: number;
  };
}
