import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a debounced version of the callback.
 * The callback fires after `delay` ms of inactivity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebounce<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const callbackRef = useRef<T>(callback);
  callbackRef.current = callback;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((...args: any[]) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callbackRef.current(...args), delay);
    }) as T,
    [delay],
  );
}

/**
 * Register a global keyboard shortcut.
 * Supports single keys ("Escape") and combos ("ctrl+k").
 *
 * @example useHotkey('ctrl+k', () => focusCaptureBar())
 * @example useHotkey('Escape', () => closeSidebar())
 */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  enabled = true,
) {
  const handlerRef = useRef<typeof handler>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const parts = combo.toLowerCase().split('+');
    const key = parts.pop()!;
    const mods = new Set(parts); // "ctrl", "shift", "alt", "meta"

    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== key) return;
      if (mods.has('ctrl') !== (e.ctrlKey || e.metaKey)) return;
      if (mods.has('shift') !== e.shiftKey) return;
      if (mods.has('alt') !== e.altKey) return;

      // Don't fire if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();
      handlerRef.current(e);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combo, enabled]);
}
