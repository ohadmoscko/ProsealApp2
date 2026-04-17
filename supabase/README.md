# Supabase — DEPRECATED

Per `ADR-003_SUPABASE_TO_SQLITE.md`, Proseal Brain is now local-first on
Tauri-embedded SQLite. All former Supabase artefacts have been moved under
`./_archived/` for historical reference only.

- `_archived/migrations/` — original Postgres migrations 010–025 (ported into
  `src-tauri/migrations/`).
- `_archived/functions/`  — Edge Function sources (`process-capture`,
  `generate-summary`, `generate-weekly-report`). These are not wired into the
  Tauri build and will be re-implemented as local AI commands in Sprint 4.
- `_archived/RUN_ALL_MIGRATIONS.sql` — combined Postgres migration bundle.

Do **not** add new files under this directory. New schema work lives in
`src-tauri/migrations/*.sql` and new command surface lives in
`src-tauri/src/commands.rs`.

Related requirement IDs: #225, #243, #245, #292, #301, #302.
