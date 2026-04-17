// [Req #225, #243, #245, #302]
// Generic Rust CRUD bridge exposed to the TS layer.
//
// Four primitives mirror Supabase's PostgREST surface:
//   db_select  → SELECT ... WHERE ... ORDER BY ... LIMIT
//   db_insert  → INSERT ... RETURNING *   + sync_queue row (#302)
//   db_update  → UPDATE ... WHERE ...     + sync_queue row per affected row
//   db_delete  → DELETE ... WHERE ...     + sync_queue row per affected row
//
// Plus two helpers:
//   db_rpc     → named SQL procedures (find_quote_by_unified_id, etc.)
//   db_import  → one-shot bulk import from JSON (Sprint 3.5)
//
// Filters use a small structured DSL so TS can build them without raw SQL:
//   Filter { col, op, value } where op ∈ eq,neq,in,not_in,is,not_is,gt,gte,lt,lte,like
// All binds are parameterised (?1, ?2...). NO raw SQL from JS ever.

use crate::db;
use anyhow::{anyhow, Context, Result};
use rusqlite::{types::Value as SqlValue, ToSql};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use uuid::Uuid;

// ── Allowed tables — hard whitelist to prevent arbitrary table access ──
const TABLES: &[&str] = &[
    "clients",
    "quotes",
    "interactions",
    "captures",
    "saved_filters",
    "ai_training_telemetry",
    "audit_log",
    "ceo_feedback",
    "profiles",
    "weeks",
    "items",
    "categories",
    "comments",
    "leads",
    "sync_queue",
    "sync_state",
    "app_meta",
];

fn assert_table(t: &str) -> Result<()> {
    if !TABLES.contains(&t) {
        return Err(anyhow!("table '{}' is not whitelisted", t));
    }
    Ok(())
}

fn is_safe_ident(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// ── Filter DSL ──────────────────────────────────────────────────────
#[derive(Debug, Deserialize)]
pub struct Filter {
    pub col: String,
    pub op: String,
    pub value: JsonValue,
}

#[derive(Debug, Deserialize)]
pub struct OrderBy {
    pub col: String,
    #[serde(default)]
    pub desc: bool,
    #[serde(default)]
    pub nulls_last: bool,
}

#[derive(Debug, Deserialize, Default)]
pub struct SelectArgs {
    pub table: String,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub order: Vec<OrderBy>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub single: bool,
}

#[derive(Debug, Deserialize)]
pub struct InsertArgs {
    pub table: String,
    pub row: JsonMap<String, JsonValue>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateArgs {
    pub table: String,
    pub patch: JsonMap<String, JsonValue>,
    pub filters: Vec<Filter>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteArgs {
    pub table: String,
    pub filters: Vec<Filter>,
}

#[derive(Debug, Serialize)]
pub struct MutationResult {
    pub rows: Vec<JsonValue>,
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Convert a JSON value to a rusqlite binding.
fn json_to_sql(v: &JsonValue) -> SqlValue {
    match v {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()), // arrays/objects → JSON string
    }
}

/// Convert a SQLite row cell to JSON.
fn sql_to_json(row: &rusqlite::Row, idx: usize) -> rusqlite::Result<JsonValue> {
    let val: rusqlite::types::ValueRef = row.get_ref(idx)?;
    Ok(match val {
        rusqlite::types::ValueRef::Null => JsonValue::Null,
        rusqlite::types::ValueRef::Integer(i) => JsonValue::Number(i.into()),
        rusqlite::types::ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        rusqlite::types::ValueRef::Text(t) => JsonValue::String(String::from_utf8_lossy(t).into_owned()),
        rusqlite::types::ValueRef::Blob(b) => JsonValue::String(base64_encode(b)),
    })
}

fn base64_encode(b: &[u8]) -> String {
    // RFC-4648 minimal encoder — avoid extra crate dep
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(4 * ((b.len() + 2) / 3));
    for chunk in b.chunks(3) {
        let (b0, b1, b2) = (chunk[0], chunk.get(1).copied().unwrap_or(0), chunk.get(2).copied().unwrap_or(0));
        out.push(A[(b0 >> 2) as usize] as char);
        out.push(A[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { A[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { A[(b2 & 0x3f) as usize] as char } else { '=' });
    }
    out
}

/// Build `WHERE` clause + params from a filter list.
fn build_where(filters: &[Filter]) -> Result<(String, Vec<SqlValue>)> {
    if filters.is_empty() {
        return Ok((String::new(), Vec::new()));
    }
    let mut parts = Vec::with_capacity(filters.len());
    let mut binds: Vec<SqlValue> = Vec::new();
    for f in filters {
        if !is_safe_ident(&f.col) {
            return Err(anyhow!("unsafe column ident: {}", f.col));
        }
        match f.op.as_str() {
            "eq" => {
                parts.push(format!("{} = ?", f.col));
                binds.push(json_to_sql(&f.value));
            }
            "neq" => {
                parts.push(format!("{} != ?", f.col));
                binds.push(json_to_sql(&f.value));
            }
            "gt" => {
                parts.push(format!("{} > ?", f.col));
                binds.push(json_to_sql(&f.value));
            }
            "gte" => {
                parts.push(format!("{} >= ?", f.col));
                binds.push(json_to_sql(&f.value));
            }
            "lt" => {
                parts.push(format!("{} < ?", f.col));
                binds.push(json_to_sql(&f.value));
            }
            "lte" => {
                parts.push(format!("{} <= ?", f.col));
                binds.push(json_to_sql(&f.value));
            }
            "like" => {
                parts.push(format!("{} LIKE ?", f.col));
                binds.push(json_to_sql(&f.value));
            }
            "is" => {
                // Postgrest .is('x', null) → IS NULL
                if f.value.is_null() {
                    parts.push(format!("{} IS NULL", f.col));
                } else {
                    parts.push(format!("{} IS ?", f.col));
                    binds.push(json_to_sql(&f.value));
                }
            }
            "not_is" => {
                if f.value.is_null() {
                    parts.push(format!("{} IS NOT NULL", f.col));
                } else {
                    parts.push(format!("{} IS NOT ?", f.col));
                    binds.push(json_to_sql(&f.value));
                }
            }
            "in" | "not_in" => {
                let arr = f
                    .value
                    .as_array()
                    .ok_or_else(|| anyhow!("'{}' expects JSON array value", f.op))?;
                if arr.is_empty() {
                    parts.push(if f.op == "in" { "0=1".to_string() } else { "1=1".to_string() });
                } else {
                    let placeholders: Vec<&str> = arr.iter().map(|_| "?").collect();
                    let kw = if f.op == "in" { "IN" } else { "NOT IN" };
                    parts.push(format!("{} {} ({})", f.col, kw, placeholders.join(",")));
                    for v in arr {
                        binds.push(json_to_sql(v));
                    }
                }
            }
            other => return Err(anyhow!("unsupported op: {}", other)),
        }
    }
    Ok((format!(" WHERE {}", parts.join(" AND ")), binds))
}

fn row_to_json_object(row: &rusqlite::Row, names: &[String]) -> rusqlite::Result<JsonValue> {
    let mut obj = JsonMap::with_capacity(names.len());
    for (i, n) in names.iter().enumerate() {
        obj.insert(n.clone(), sql_to_json(row, i)?);
    }
    Ok(JsonValue::Object(obj))
}

// ── SELECT ──────────────────────────────────────────────────────────
#[tauri::command]
pub fn db_select(args: SelectArgs) -> Result<JsonValue, String> {
    run_select(args).map_err(|e| e.to_string())
}

fn run_select(args: SelectArgs) -> Result<JsonValue> {
    assert_table(&args.table)?;
    let cols_sql = match &args.columns {
        Some(list) if !list.is_empty() => {
            for c in list {
                if !is_safe_ident(c) && c != "*" {
                    return Err(anyhow!("unsafe column: {}", c));
                }
            }
            list.join(", ")
        }
        _ => "*".to_string(),
    };

    let (where_sql, binds) = build_where(&args.filters)?;

    let order_sql = if args.order.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = args.order.iter().filter_map(|o| {
            if !is_safe_ident(&o.col) { return None; }
            let dir = if o.desc { "DESC" } else { "ASC" };
            let nulls = if o.nulls_last { " NULLS LAST" } else { "" };
            Some(format!("{} {}{}", o.col, dir, nulls))
        }).collect();
        if parts.is_empty() { String::new() } else { format!(" ORDER BY {}", parts.join(", ")) }
    };

    let limit_sql = match args.limit {
        Some(n) if n > 0 => format!(" LIMIT {}", n),
        _ => if args.single { " LIMIT 1".to_string() } else { String::new() },
    };

    let sql = format!(
        "SELECT {} FROM {}{}{}{}",
        cols_sql, args.table, where_sql, order_sql, limit_sql
    );

    let c = db::conn()?;
    let mut stmt = c.prepare(&sql).with_context(|| format!("prepare: {}", sql))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let param_refs: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
    let mut rows_iter = stmt.query(param_refs.as_slice())?;

    let mut rows_json = Vec::new();
    while let Some(row) = rows_iter.next()? {
        rows_json.push(row_to_json_object(row, &names)?);
    }

    if args.single {
        Ok(rows_json.into_iter().next().unwrap_or(JsonValue::Null))
    } else {
        Ok(JsonValue::Array(rows_json))
    }
}

// ── INSERT ──────────────────────────────────────────────────────────
#[tauri::command]
pub fn db_insert(args: InsertArgs) -> Result<JsonValue, String> {
    run_insert(args).map_err(|e| e.to_string())
}

fn run_insert(args: InsertArgs) -> Result<JsonValue> {
    assert_table(&args.table)?;
    let mut row = args.row;

    // Ensure id exists for tables that expect UUID primary keys.
    if !row.contains_key("id") {
        row.insert("id".into(), JsonValue::String(Uuid::new_v4().to_string()));
    }
    // Stamp timestamps if missing.
    let now = db::now_iso();
    row.entry("created_at".to_string()).or_insert(JsonValue::String(now.clone()));
    row.entry("updated_at".to_string()).or_insert(JsonValue::String(now.clone()));

    let cols: Vec<String> = row.keys().cloned().collect();
    for c in &cols {
        if !is_safe_ident(c) {
            return Err(anyhow!("unsafe column in insert: {}", c));
        }
    }
    let placeholders: Vec<&str> = cols.iter().map(|_| "?").collect();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}) RETURNING *",
        args.table,
        cols.join(", "),
        placeholders.join(", ")
    );

    let binds: Vec<SqlValue> = cols.iter().map(|c| json_to_sql(&row[c])).collect();

    let mut c = db::conn()?;
    let tx = c.transaction()?;

    let row_id: String = {
        let mut stmt = tx.prepare(&sql)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let param_refs: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
        let mut rows_iter = stmt.query(param_refs.as_slice())?;
        let row_obj = match rows_iter.next()? {
            Some(r) => row_to_json_object(r, &names)?,
            None => return Err(anyhow!("insert returned no row")),
        };
        // [Req #302] Enqueue for optional cloud push
        let id_str = row_obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        drop(rows_iter);
        drop(stmt);
        // Re-select to get the full object for the queue payload (returning is already captured above)
        // but we already have row_obj; serialize now.
        db::enqueue_in_tx(&tx, &args.table, &id_str, "insert", &row_obj)?;
        // Stash for return
        RETURN_ROW.with(|c| *c.borrow_mut() = Some(row_obj));
        id_str
    };
    tx.commit()?;
    let out = RETURN_ROW.with(|c| c.borrow_mut().take()).unwrap_or(JsonValue::Null);
    log::debug!("[db_insert] {} id={}", args.table, row_id);
    Ok(out)
}

// Thread-local stash to return row_obj past the borrow of stmt/tx.
thread_local! {
    static RETURN_ROW: std::cell::RefCell<Option<JsonValue>> = std::cell::RefCell::new(None);
    static RETURN_ROWS: std::cell::RefCell<Option<Vec<JsonValue>>> = std::cell::RefCell::new(None);
}

// ── UPDATE ──────────────────────────────────────────────────────────
#[tauri::command]
pub fn db_update(args: UpdateArgs) -> Result<JsonValue, String> {
    run_update(args).map_err(|e| e.to_string())
}

fn run_update(args: UpdateArgs) -> Result<JsonValue> {
    assert_table(&args.table)?;
    if args.patch.is_empty() {
        return Err(anyhow!("empty patch"));
    }

    let mut patch = args.patch;
    // Auto-bump updated_at if the table has one (triggers also do this, belt-and-suspenders).
    patch.entry("updated_at".to_string()).or_insert(JsonValue::String(db::now_iso()));

    let cols: Vec<String> = patch.keys().cloned().collect();
    for c in &cols {
        if !is_safe_ident(c) {
            return Err(anyhow!("unsafe column in update: {}", c));
        }
    }
    let set_clause = cols.iter().map(|c| format!("{} = ?", c)).collect::<Vec<_>>().join(", ");
    let (where_sql, where_binds) = build_where(&args.filters)?;
    let sql = format!("UPDATE {} SET {}{} RETURNING *", args.table, set_clause, where_sql);

    let mut binds: Vec<SqlValue> = cols.iter().map(|c| json_to_sql(&patch[c])).collect();
    binds.extend(where_binds);

    let mut c = db::conn()?;
    let tx = c.transaction()?;
    let affected_rows: Vec<JsonValue>;
    {
        let mut stmt = tx.prepare(&sql)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let param_refs: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
        let mut rows_iter = stmt.query(param_refs.as_slice())?;
        let mut out = Vec::new();
        while let Some(row) = rows_iter.next()? {
            out.push(row_to_json_object(row, &names)?);
        }
        affected_rows = out;
    }
    // [Req #302] Enqueue one sync_queue row per affected row.
    for row in &affected_rows {
        if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
            db::enqueue_in_tx(&tx, &args.table, id, "update", row)?;
        }
    }
    tx.commit()?;

    Ok(JsonValue::Array(affected_rows))
}

// ── DELETE ──────────────────────────────────────────────────────────
#[tauri::command]
pub fn db_delete(args: DeleteArgs) -> Result<JsonValue, String> {
    run_delete(args).map_err(|e| e.to_string())
}

fn run_delete(args: DeleteArgs) -> Result<JsonValue> {
    assert_table(&args.table)?;
    let (where_sql, binds) = build_where(&args.filters)?;
    if where_sql.is_empty() {
        return Err(anyhow!("refusing unfiltered DELETE on {}", args.table));
    }

    let sql = format!("DELETE FROM {}{} RETURNING *", args.table, where_sql);

    let mut c = db::conn()?;
    let tx = c.transaction()?;
    let deleted_rows: Vec<JsonValue>;
    {
        let mut stmt = tx.prepare(&sql)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let param_refs: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
        let mut rows_iter = stmt.query(param_refs.as_slice())?;
        let mut out = Vec::new();
        while let Some(row) = rows_iter.next()? {
            out.push(row_to_json_object(row, &names)?);
        }
        deleted_rows = out;
    }
    for row in &deleted_rows {
        if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
            db::enqueue_in_tx(&tx, &args.table, id, "delete", row)?;
        }
    }
    tx.commit()?;
    Ok(JsonValue::Array(deleted_rows))
}

// ── RPC ─────────────────────────────────────────────────────────────
// [Req #015] find_quote_by_unified_id — de-duplication helper
#[derive(Debug, Deserialize)]
pub struct RpcArgs {
    pub name: String,
    #[serde(default)]
    pub args: JsonMap<String, JsonValue>,
}

#[tauri::command]
pub fn db_rpc(args: RpcArgs) -> Result<JsonValue, String> {
    run_rpc(args).map_err(|e| e.to_string())
}

fn run_rpc(args: RpcArgs) -> Result<JsonValue> {
    match args.name.as_str() {
        "find_quote_by_unified_id" => {
            // [Req #015] Build canonical key "{erp}-{initials}-{quote_number}" and probe
            let erp = args.args.get("p_erp_number").and_then(|v| v.as_str()).unwrap_or("NO-ERP");
            let initials = args.args.get("p_initials").and_then(|v| v.as_str()).unwrap_or("XX");
            let quote_number = args.args.get("p_quote_number").and_then(|v| v.as_str()).unwrap_or("");
            let key = format!("{}-{}-{}", erp, initials, quote_number);
            let c = db::conn()?;
            let id: Option<String> = c
                .query_row(
                    "SELECT id FROM quotes WHERE unified_id = ?1 AND deleted_at IS NULL LIMIT 1",
                    [&key],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(match id {
                Some(s) => JsonValue::String(s),
                None => JsonValue::Null,
            })
        }
        // [Req #141] auto_archive_stale → mark won/lost quotes dormant after 60d
        "auto_archive_stale" => {
            let mut c = db::conn()?;
            let tx = c.transaction()?;
            let updated: Vec<(String, String)> = {
                let mut stmt = tx.prepare(
                    "UPDATE quotes SET status='dormant'
                       WHERE status IN ('won','lost')
                         AND julianday('now') - julianday(updated_at) > 60
                         AND deleted_at IS NULL
                     RETURNING id, status",
                )?;
                let mut rows = stmt.query([])?;
                let mut out = Vec::new();
                while let Some(r) = rows.next()? {
                    out.push((r.get::<_, String>(0)?, r.get::<_, String>(1)?));
                }
                out
            };
            for (id, _) in &updated {
                db::enqueue_in_tx(
                    &tx,
                    "quotes",
                    id,
                    "update",
                    &serde_json::json!({ "id": id, "status": "dormant" }),
                )?;
            }
            tx.commit()?;
            Ok(JsonValue::Number((updated.len() as i64).into()))
        }
        other => Err(anyhow!("unknown rpc: {}", other)),
    }
}

// Import rusqlite OptionalExtension for .optional()
use rusqlite::OptionalExtension;

// ── IMPORT (Sprint 3.5) ─────────────────────────────────────────────
// [Req #225] One-shot JSON bulk import: `{ table_name: [rows...], ... }`
#[derive(Debug, Deserialize)]
pub struct ImportArgs {
    pub payload: JsonMap<String, JsonValue>,
}

#[derive(Debug, Serialize)]
pub struct ImportReport {
    pub inserted: JsonMap<String, JsonValue>,
    pub skipped: JsonMap<String, JsonValue>,
}

#[tauri::command]
pub fn db_import(args: ImportArgs) -> Result<ImportReport, String> {
    run_import(args).map_err(|e| e.to_string())
}

fn run_import(args: ImportArgs) -> Result<ImportReport> {
    let mut report = ImportReport {
        inserted: JsonMap::new(),
        skipped: JsonMap::new(),
    };

    for (table, value) in args.payload.iter() {
        assert_table(table)?;
        let rows = value.as_array().ok_or_else(|| anyhow!("{}: expected JSON array", table))?;
        let mut c = db::conn()?;
        let tx = c.transaction()?;
        let mut inserted = 0_i64;
        let mut skipped = 0_i64;

        for row_val in rows {
            let row = match row_val.as_object() {
                Some(m) => m,
                None => {
                    skipped += 1;
                    continue;
                }
            };
            let cols: Vec<String> = row.keys().cloned().collect();
            if cols.iter().any(|c| !is_safe_ident(c)) {
                skipped += 1;
                continue;
            }
            let placeholders: Vec<&str> = cols.iter().map(|_| "?").collect();
            let sql = format!(
                "INSERT OR IGNORE INTO {} ({}) VALUES ({})",
                table,
                cols.join(", "),
                placeholders.join(", ")
            );
            let binds: Vec<SqlValue> = cols.iter().map(|c| json_to_sql(&row[c])).collect();
            let param_refs: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
            let changed = tx.execute(&sql, param_refs.as_slice())?;
            if changed > 0 {
                inserted += 1;
            } else {
                skipped += 1;
            }
        }
        tx.commit()?;
        report.inserted.insert(table.clone(), JsonValue::Number(inserted.into()));
        report.skipped.insert(table.clone(), JsonValue::Number(skipped.into()));
    }

    Ok(report)
}

// ── SYNC QUEUE PRIMITIVES (exposed for sync-queue.ts) ──────────────
#[derive(Debug, Serialize)]
pub struct QueueRow {
    pub id: String,
    pub table_name: String,
    pub row_id: String,
    pub operation: String,
    pub payload: String,
    pub client_updated_at: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub pushed_at: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn sync_queue_pending(limit: Option<i64>) -> Result<Vec<QueueRow>, String> {
    let lim = limit.unwrap_or(200);
    let c = db::conn().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, table_name, row_id, operation, payload,
                    client_updated_at, attempts, last_error, pushed_at, created_at
               FROM sync_queue
              WHERE pushed_at IS NULL
           ORDER BY created_at ASC
              LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([lim], |r| {
            Ok(QueueRow {
                id: r.get(0)?,
                table_name: r.get(1)?,
                row_id: r.get(2)?,
                operation: r.get(3)?,
                payload: r.get(4)?,
                client_updated_at: r.get(5)?,
                attempts: r.get(6)?,
                last_error: r.get(7)?,
                pushed_at: r.get(8)?,
                created_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn sync_queue_mark_pushed(id: String) -> Result<(), String> {
    let c = db::conn().map_err(|e| e.to_string())?;
    c.execute(
        "UPDATE sync_queue SET pushed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [&id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sync_queue_mark_failed(id: String, err: String) -> Result<(), String> {
    let c = db::conn().map_err(|e| e.to_string())?;
    c.execute(
        "UPDATE sync_queue
            SET attempts = attempts + 1, last_error = ?2
          WHERE id = ?1",
        rusqlite::params![id, err],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sync_queue_count() -> Result<i64, String> {
    let c = db::conn().map_err(|e| e.to_string())?;
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE pushed_at IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n)
}

#[tauri::command]
pub fn sync_queue_clear() -> Result<(), String> {
    let c = db::conn().map_err(|e| e.to_string())?;
    c.execute("DELETE FROM sync_queue", []).map_err(|e| e.to_string())?;
    Ok(())
}
