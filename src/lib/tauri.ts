/**
 * Tauri command bridge.
 * Wraps Rust invoke calls with proper typing and web fallbacks.
 * When running in browser (npm run dev), falls back gracefully.
 */

export const isTauri = '__TAURI_INTERNALS__' in window;

/** Invoke a Tauri command with fallback for web dev */
// [Req #225] Exported so db.ts facade can reach Rust SQLite bridge
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    console.warn(`[tauri] Not in Tauri — skipping command: ${cmd}`);
    throw new Error('Not running in Tauri');
  }
  // Dynamic import to avoid bundling issues in web-only mode
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** Open file location in system file explorer (Windows: explorer /select) */
export async function openFileLocation(path: string): Promise<boolean> {
  try {
    await invoke('open_file_location', { path });
    return true;
  } catch {
    console.warn('[tauri] openFileLocation failed for:', path);
    return false;
  }
}

/** Copy text to clipboard — Tauri command with web API fallback */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try Tauri command first
  try {
    await invoke('copy_to_clipboard', { text });
    return true;
  } catch {
    // Fallback to web API
  }

  // Web API fallback
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    console.warn('[clipboard] All methods failed for:', text);
    return false;
  }
}
