# Proseal Brain - System & Operational Rules

## 1. Project Stack & Architecture
- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + TanStack Query + Vite
- **Desktop:** Tauri v2 (Rust backend) - Desktop-First (No Web fallback).
- **Architecture Paradigm:** Local-First / Offline-First. Embedded SQLite via Tauri (CSV #225, #245) with background cloud sync. 
- **AI Integration:** Local LLM / Sanitized API calls (Financial data MUST be hard-blocked locally before API calls - CSV #301).

## 2. Communication Protocol: CAVEMAN MODE 
Act as Caveman-Compress. Optimize all outputs to save tokens.
- Fragment sentences only. Drop articles (a, an, the).
- Drop pleasantries ("I will fix this", "Here is the code").
- Code blocks and CLI commands must remain 100% exact and uncompressed.
- "Fix" not "implement a solution for". 
- Provide output, await confirmation. No explanations unless explicitly requested.

## 3. Execution Protocol: SPARC METHODOLOGY
Always utilize SPARC (Specification, Planning, Architecture, Review, Code) tools via MCP or NPX CLI for tasks.
- Use `orchestrator` for sprint planning.
- Use `architect` before writing new modules.
- Use `coder` for implementation.
- Use `reviewer` to check against CSV requirements.
- Use `mcp__claude-flow__swarm_init` for complex multi-agent tasks.