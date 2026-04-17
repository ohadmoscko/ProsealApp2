# ADR-003: Supabase Cloud → Embedded SQLite (Tauri)

**Status:** PROPOSED. Awaits CEO approval.
**Date:** 2026-04-18
**Phase:** SPARC `architect` — pre-Sprint-3.
**CSV Refs:** #225, #243, #245, #292, #301, #302.

---

## 1. Context

Sprint 1 shipped Supabase stack:
- PostgreSQL cloud DB.
- Supabase Auth (JWT).
- Row-Level Security (RLS) policies.
- 16 SQL migrations (010 → 025).
- `src/lib/supabase.ts` client.
- `src/lib/offline-sync.ts` localStorage queue → Supabase flush.

Conflict: CSV mandates local-first.
- **#225** Embedded DB, zero network dependency for core ops.
- **#243** Works offline indefinitely. No cloud dependency for reads/writes.
- **#245** SQLite file persisted in Tauri app data dir.
- **#292** Maximum security. No PII/financial data on third-party cloud.
- **#301** AI sanitization. Financial data hard-blocked client-side before API egress.
- **#302** Timestamp-based conflict resolution for bi-directional sync.

Supabase violates #292 (data leaves device) and #243 (requires network for auth/RLS).

---

## 2. Decision

**ABANDON Supabase Cloud. ADOPT Tauri-embedded SQLite.**

- Authoritative store: local `proseal.db` SQLite file.
- Location: Tauri `app_data_dir` (OS-standard per-user path).
- Auth: local OS-bound (Tauri identity + optional passphrase, no JWT/cloud).
- Encryption at rest: SQLCipher (AES-256), key derived from OS keyring.
- Sync: optional background push to Supabase (DEMOTED to backup/export only — NOT read path).
- Conflict rule: Last-Write-Wins by `updated_at` timestamp + status-ladder protection (#302).

---

## 3. Architecture

### 3.1 Stack

| Layer          | Old                          | New                                    |
|----------------|------------------------------|----------------------------------------|
| DB engine      | Supabase Postgres (cloud)    | SQLite via `tauri-plugin-sql` + SQLCipher |
| Auth           | Supabase Auth (JWT)          | Local passphrase + OS keyring          |
| RLS            | Postgres RLS policies        | App-layer role check (single-user)     |
| Schema mgmt    | `supabase/migrations/*.sql`  | `src-tauri/migrations/*.sql` + version table |
| Client API     | `supabase.from('t').select()`| `db.select()` wrapper (TanStack-Query) |
| Sync           | live (HTTPS)                 | queue-based, optional, background      |

### 3.2 Rust crates (Cargo.toml additions)

```toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-stronghold = "2"   # secret mgmt for SQLCipher key
rusqlite = { version = "0.31", features = ["bundled-sqlcipher"] }
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }
```

### 3.3 File layout (new)

```
src-tauri/
├── migrations/
│   ├── 001_init_schema.sql          # port of 010_clients_quotes
│   ├── 002_captures.sql             # port of 011
│   ├── 003_interactions.sql         # port of 013
│   ├── 004_soft_deletes.sql         # port of 018
│   ├── 005_audit_log.sql            # port of 022
│   ├── 006_vacation.sql             # port of 024
│   ├── 007_leads.sql                # port of 025
│   ├── 008_sync_queue.sql           # NEW — local mutation log
│   └── 009_sync_state.sql           # NEW — last_pulled_at per table
└── src/
    ├── db.rs                        # connection pool, migrations runner
    ├── commands/
    │   ├── quotes.rs                # #[tauri::command] CRUD
    │   ├── clients.rs
    │   ├── captures.rs
    │   ├── interactions.rs
    │   ├── leads.rs
    │   └── sync.rs                  # push/pull handlers
    └── security.rs                  # SQLCipher key, financial regex blocklist (#301)

src/lib/
├── db.ts                            # invoke('db_...') wrappers
├── sync-queue.ts                    # REPLACES offline-sync.ts
└── sanitization.ts                  # extend for #301
```

### 3.4 Schema port rules (Postgres → SQLite)

| Postgres type          | SQLite mapping            | Note                                   |
|------------------------|---------------------------|----------------------------------------|
| `uuid`                 | `TEXT` + CHECK length=36  | Generate via `uuid::Uuid::new_v4()`    |
| `timestamptz`          | `TEXT` ISO-8601 UTC       | Always store UTC, render local         |
| `jsonb`                | `TEXT` (JSON1 ext)        | Use `json_extract()` for queries       |
| `enum`                 | `TEXT` + CHECK IN (...)   | e.g. `quote_status`                    |
| `RLS policies`         | **DROPPED**               | Single-user app, app-layer role guard  |
| `triggers`             | Port as SQLite triggers   | `updated_at` auto-bump                 |
| `views`                | SQLite views OK           | `temperature_decay_view` works as-is   |

### 3.5 Auth replacement (#292)

- No cloud auth. Single-user desktop app.
- On first launch: prompt passphrase → derive SQLCipher key via PBKDF2(100k rounds).
- Store wrapped key in OS keyring (Tauri Stronghold plugin).
- Session: in-memory only. Auto-lock after 15min idle.
- Biometric unlock: Phase 2.

### 3.6 AI egress guard (#301)

- Pre-flight sanitizer regex: `/\$[\d,]+(\.\d{2})?|\b\d{2,}\s*(USD|EUR|ILS|₪)\b/gi`.
- Block keys: `price`, `total`, `discount`, `margin`, `cost`, `revenue`.
- Runs in Rust `security::sanitize()` before ANY outbound HTTP.
- Unit test coverage ≥ 95% mandatory.

---

## 4. Sync Queue Design (#302)

### 4.1 Purpose

SQLite is authoritative. Supabase = optional cold backup.
Queue records local mutations for **eventual push** if cloud sync is enabled by user.
Also handles pull-merge when same DB opened on a second device.

### 4.2 Tables (NEW)

```sql
-- migration 008_sync_queue.sql
CREATE TABLE sync_queue (
    id            TEXT PRIMARY KEY,                 -- uuid v4
    table_name    TEXT NOT NULL,
    row_id        TEXT NOT NULL,
    operation     TEXT NOT NULL CHECK (operation IN ('insert','update','delete')),
    payload       TEXT NOT NULL,                    -- JSON snapshot
    client_updated_at TEXT NOT NULL,                -- ISO UTC at write time
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    pushed_at     TEXT,                             -- null = pending
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sync_queue_pending ON sync_queue(pushed_at) WHERE pushed_at IS NULL;
CREATE INDEX idx_sync_queue_row    ON sync_queue(table_name, row_id);

-- migration 009_sync_state.sql
CREATE TABLE sync_state (
    table_name      TEXT PRIMARY KEY,
    last_pushed_at  TEXT,
    last_pulled_at  TEXT,
    cursor          TEXT                            -- opaque, for incremental pull
);
```

### 4.3 Write path (every mutation)

```
UI action
  → TanStack mutation
  → invoke('db_update_quote', {...})
  → Rust tx:
       BEGIN;
         UPDATE quotes SET ... , updated_at=now() WHERE id=?;
         INSERT INTO sync_queue(... operation='update' ...);
       COMMIT;
  → return fresh row
  → TanStack invalidate
```

All writes are **atomic**. Main table + queue in one transaction.
If sync disabled, queue rows remain but are never pushed (no harm, bounded growth via TTL job).

### 4.4 Push path (background, if cloud sync enabled)

```
every 60s OR on connectivity-restored event:
  rows = SELECT * FROM sync_queue WHERE pushed_at IS NULL ORDER BY created_at LIMIT 100;
  for r in rows:
      POST to Supabase (insert/update/delete)
      on success: UPDATE sync_queue SET pushed_at=now() WHERE id=r.id
      on conflict-409: resolve via §4.6
      on network-err: increment attempts, exponential backoff
```

### 4.5 Pull path (optional, multi-device)

```
every 5min OR on-demand:
  cursor = SELECT cursor FROM sync_state WHERE table_name=?;
  remote_rows = GET supabase where updated_at > cursor;
  for rr in remote_rows:
      local = SELECT * FROM t WHERE id=rr.id;
      merged = resolveConflict(local, rr);    -- see §4.6
      UPSERT merged;
  UPDATE sync_state SET cursor=max(updated_at), last_pulled_at=now();
```

### 4.6 Conflict Resolution (#302)

Rules, in priority order:

1. **Tombstone wins** — if either side has `deleted_at` set, propagate delete.
2. **Timestamp gate** — `updated_at` Max wins (UTC, ms precision). Monotonic clock-skew guard ±5min.
3. **Status ladder** (quotes only) — never downgrade. Preserve `STATUS_PRIORITY` ladder from `offline-sync.ts` lines 54-65.
4. **Field-level merge** — if both sides modified disjoint fields since last sync cursor, union them. Same field → timestamp gate decides.
5. **Server-only fields** — never overwrite `ai_summary`, `ai_summary_at`, `days_since_contact`, `last_contact_at`.

### 4.7 Failure modes

| Scenario                       | Behavior                                                    |
|--------------------------------|-------------------------------------------------------------|
| DB corruption                  | Tauri startup check → restore from nightly encrypted backup |
| SQLCipher key lost             | App locked. User re-enters passphrase. No recovery.         |
| Sync push 5xx                  | Exponential backoff, max 10 attempts, then dead-letter      |
| Clock skew > 5min              | Log warning, use server time as tiebreaker                  |
| Queue size > 10k pending       | Toast warning, auto-prune pushed rows older than 30d        |

---

## 5. Migration Plan (Sprint 3 scope)

1. Cargo deps added.
2. Port 16 Postgres migrations → 7 SQLite migrations (drop RLS, port enums as CHECK).
3. Add `db.rs` connection pool + migrations runner.
4. Generate Rust structs mirroring `database.types.ts`.
5. Implement `#[tauri::command]` CRUD for quotes, clients, captures, interactions, leads, audit_log.
6. Rewrite `src/lib/supabase.ts` → `src/lib/db.ts` (invoke wrappers, same shape).
7. Replace `offline-sync.ts` imports in `auth.tsx`, `query.tsx`, `hooks.ts`.
8. Rewrite `offline-sync.ts` → `sync-queue.ts` (sqlite-backed, same public API).
9. One-shot migration tool: read existing Supabase data → dump to local SQLite on first run post-upgrade (optional).
10. Delete `src/lib/supabase.ts` after migration verified.
11. Keep `supabase/` folder archived under `supabase/_archived/` for reference.

---

## 6. Risks

| Risk                                  | Mitigation                                           |
|---------------------------------------|------------------------------------------------------|
| Existing Supabase data loss           | Export-to-SQLite one-shot tool (#5 step 9)           |
| SQLCipher key loss → user locked out  | Passphrase hint + encrypted recovery file on USB     |
| Breaking TanStack Query cache shape   | Keep same row shape; change only transport layer     |
| Sprint 2 UI regressions               | Public API of `db.ts` matches `supabase.ts` select() |
| Cross-platform SQLite build issues    | `rusqlite` with `bundled-sqlcipher`, CI matrix       |

---

## 7. Verification Table (Phase 4 Quality Gate)

| Req ID | Description                              | ADR Section | Status   |
|--------|------------------------------------------|-------------|----------|
| #225   | Embedded DB, zero network for core ops   | §2, §3.1    | DESIGNED |
| #243   | Offline-first indefinite                 | §2, §4      | DESIGNED |
| #245   | SQLite in Tauri app_data_dir             | §2, §3.1    | DESIGNED |
| #292   | Max security, no cloud PII               | §2, §3.5    | DESIGNED |
| #301   | Financial data hard-block pre-AI         | §3.6        | DESIGNED |
| #302   | Timestamp-based conflict resolution      | §4.6        | DESIGNED |

---

## 8. Rollback Plan

If SQLite path fails in dev:
- Revert `src-tauri/Cargo.toml`.
- Restore `src/lib/supabase.ts` import path.
- Re-enable `supabase/migrations/`.
- Feature flag `VITE_USE_LOCAL_DB=false`.
Rollback window: before Sprint 3 merge to main.

---

## 9. Approval Gate

Awaiting CEO approval on:
- [ ] Abandon Supabase as primary store.
- [ ] SQLCipher + passphrase auth model.
- [ ] Conflict rules §4.6 (tombstone > timestamp > status > field-merge).
- [ ] Sprint 3 scope §5 (11 steps).

**Reply `APPROVE ADR-003` to initiate Coder swarm for Sprint 3.**
