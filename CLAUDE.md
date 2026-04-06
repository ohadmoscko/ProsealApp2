# Proseal Brain

Tauri v2 desktop app + React SPA for quote management and weekly CEO reports.

## Stack
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + TanStack Query + Vite
- **Desktop**: Tauri v2 (Rust backend)
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **AI**: Claude API (via Supabase Edge Functions)

## Dev commands
- `npm run dev` — Vite dev server (web only, port 1420)
- `npm run tauri dev` — Tauri desktop app with HMR
- `npm run build` — Production build (web)
- `npm run tauri build` — Production desktop build

## Project structure
- `src/` — React frontend (shared between web and desktop)
- `src-tauri/` — Rust backend (Tauri commands, local file access)
- `supabase/migrations/` — Database migrations (010+)
- `src/lib/` — Supabase client, auth, types, utilities
- `src/layouts/` — Layout components (SplitView)
- `src/panels/` — Main panels (QuoteList, QuoteDetail, CaptureChat)
- `src/components/` — Shared components (Topbar, CaptureBar, CopilotBriefing)
- `src/pages/` — Page components (Login, Dashboard)

## Database
Extends existing proseal-app schema (migrations 001-007). New tables: clients, quotes, interactions, captures, saved_filters (migrations 010-012).

## Language
UI is in Hebrew (RTL). Code is in English.
