// [Req #225, #243, #245, #292, #301, #302] Tauri entrypoint.
// Wires SQLCipher pool + financial sanitizer + generic DB bridge into Tauri invoke.

use serde_json::Value as JsonValue;
use tauri::Manager;

pub mod commands;
pub mod db;
pub mod security;

// ───────────────────────────────────────────────────────────────────
// Sprint 1 file helpers (unchanged)
// ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn open_file_location(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    let _ = path;
    Ok(())
}

#[tauri::command]
fn copy_to_clipboard(text: String, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .eval(&format!(
                "navigator.clipboard.writeText('{}')",
                text.replace('\\', "\\\\").replace('\'', "\\'")
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ───────────────────────────────────────────────────────────────────
// [Req #292] Passphrase lifecycle — keyring-backed SQLCipher unlock
// ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn is_db_initialized() -> bool {
    security::load_db_passphrase().is_ok()
}

#[tauri::command]
fn initialize_db(app: tauri::AppHandle, passphrase: String) -> Result<(), String> {
    if passphrase.len() < 8 {
        return Err("passphrase must be at least 8 characters".into());
    }
    security::save_db_passphrase(&passphrase)?;
    let path = db::db_path(&app).map_err(|e| e.to_string())?;
    db::init_pool(path, &passphrase).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn unlock_db(app: tauri::AppHandle) -> Result<(), String> {
    let pw = security::load_db_passphrase()?;
    let path = db::db_path(&app).map_err(|e| e.to_string())?;
    db::init_pool(path, &pw).map_err(|e| e.to_string())?;
    Ok(())
}

// ───────────────────────────────────────────────────────────────────
// [Req #301] Financial sanitizer — ALL AI egress must pass through
// ───────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct SanitizeResponse {
    payload: JsonValue,
    stripped_keys: Vec<String>,
    redacted_values: usize,
}

#[tauri::command]
fn sanitize_ai_payload(payload: JsonValue) -> SanitizeResponse {
    let (cleaned, report) = security::sanitize_for_ai(&payload);
    SanitizeResponse {
        payload: cleaned,
        stripped_keys: report.stripped_keys,
        redacted_values: report.redacted_values,
    }
}

// ───────────────────────────────────────────────────────────────────
// Entrypoint
// ───────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // Sprint 1 file helpers
            open_file_location,
            copy_to_clipboard,
            // [Req #292] DB lifecycle
            is_db_initialized,
            initialize_db,
            unlock_db,
            // [Req #301] AI sanitizer
            sanitize_ai_payload,
            // [Req #225, #243, #302] Generic CRUD bridge
            commands::db_select,
            commands::db_insert,
            commands::db_update,
            commands::db_delete,
            commands::db_rpc,
            commands::db_import,
            // [Req #302] Sync queue primitives
            commands::sync_queue_pending,
            commands::sync_queue_mark_pushed,
            commands::sync_queue_mark_failed,
            commands::sync_queue_count,
            commands::sync_queue_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
