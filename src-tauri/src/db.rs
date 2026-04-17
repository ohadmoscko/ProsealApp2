// [Req #225, #243, #245, #292, #302]
// SQLite connection pool + migration runner + atomic mutation helper.
// Local-first authoritative store. SQLCipher-encrypted at rest.

use anyhow::{anyhow, Context, Result};
use once_cell::sync::OnceCell;
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection};
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

/// Type alias for a pooled SQLCipher-backed SQLite connection.
pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConn = PooledConnection<SqliteConnectionManager>;

/// Process-wide singleton — initialised once at Tauri startup.
static POOL: OnceCell<DbPool> = OnceCell::new();

/// Embedded migrations — ordered by filename prefix.
/// [Req #225] Schema shipped with binary; no runtime downloads.
const MIGRATIONS: &[(&str, &str)] = &[
    ("001_init_schema",  include_str!("../migrations/001_init_schema.sql")),
    ("002_sync_queue",   include_str!("../migrations/002_sync_queue.sql")),
    ("003_full_schema",  include_str!("../migrations/003_full_schema.sql")),
];

/// Resolve DB path inside Tauri app-data dir.
/// [Req #245] Persisted in OS-standard per-user location.
pub fn db_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolve app_data_dir")?;
    std::fs::create_dir_all(&dir).context("create app_data_dir")?;
    Ok(dir.join("proseal.db"))
}

/// Initialise pool with SQLCipher key + run migrations.
/// Called once from `lib.rs::run()` at startup.
///
/// [Req #292] Passphrase wrapped in OS keyring (Stronghold phase-2).
/// For now accepts passphrase via param — caller responsible for keyring fetch.
pub fn init_pool(path: PathBuf, passphrase: &str) -> Result<&'static DbPool> {
    if POOL.get().is_some() {
        return Ok(POOL.get().unwrap());
    }

    // Escape single quotes in passphrase for PRAGMA statement
    let pass_escaped = passphrase.replace('\'', "''");

    let manager = SqliteConnectionManager::file(&path).with_init(move |c| {
        // [Req #292] Enable SQLCipher encryption BEFORE any other operation
        c.execute_batch(&format!("PRAGMA key = '{}';", pass_escaped))?;
        c.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(())
    });

    let pool = Pool::builder()
        .max_size(8)
        .build(manager)
        .context("build sqlite pool")?;

    // Run migrations on first connection
    {
        let conn = pool.get().context("acquire conn for migrate")?;
        run_migrations(&conn)?;
    }

    POOL.set(pool).map_err(|_| anyhow!("pool already set"))?;
    Ok(POOL.get().unwrap())
}

/// Borrow a pooled connection. Panics if pool not initialised.
pub fn conn() -> Result<DbConn> {
    let pool = POOL.get().ok_or_else(|| anyhow!("db pool not initialised"))?;
    pool.get().context("acquire sqlite conn")
}

/// Apply embedded migrations idempotently.
/// Tracks applied versions in `_migrations` table.
fn run_migrations(c: &Connection) -> Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );",
    )?;

    for (name, sql) in MIGRATIONS {
        let already: bool = c
            .query_row(
                "SELECT 1 FROM _migrations WHERE name = ?1",
                params![name],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if already {
            log::info!("[db] migration {} already applied", name);
            continue;
        }

        log::info!("[db] applying migration {}", name);
        c.execute_batch(sql)
            .with_context(|| format!("apply migration {}", name))?;
        c.execute(
            "INSERT INTO _migrations(name) VALUES (?1)",
            params![name],
        )?;
    }
    Ok(())
}

// ───────────────────────────────────────────────────────────────────────
// [Req #302] Atomic mutation helper: writes main table AND sync_queue
// inside one transaction. Either both succeed or neither.
// ───────────────────────────────────────────────────────────────────────

/// Enqueue a mutation row inside an existing transaction.
/// Caller must already have executed the actual INSERT/UPDATE/DELETE
/// on the main table within the same tx.
pub fn enqueue_in_tx(
    tx: &rusqlite::Transaction,
    table: &str,
    row_id: &str,
    op: &str,
    payload: &JsonValue,
) -> Result<()> {
    debug_assert!(matches!(op, "insert" | "update" | "delete"));
    let queue_id = Uuid::new_v4().to_string();
    let payload_str = serde_json::to_string(payload).context("serialize payload")?;
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    tx.execute(
        "INSERT INTO sync_queue
            (id, table_name, row_id, operation, payload, client_updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![queue_id, table, row_id, op, payload_str, now],
    )
    .context("insert sync_queue row")?;
    Ok(())
}

/// Current UTC ISO-8601 string (ms precision). Used for `updated_at` stamps.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
