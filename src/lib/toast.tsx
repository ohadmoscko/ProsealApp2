import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from './utils';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  // [Req #216] Optional undo action — replaces confirmation dialogs
  onUndo?: () => void;
}

interface ToastState {
  toast: (message: string, type?: ToastType, onUndo?: () => void) => void;
}

const ToastContext = createContext<ToastState | null>(null);

let nextId = 0;

// ── Global toast (works outside React tree) ───────────────────────────────
let _globalToastFn: ((message: string, type?: ToastType, onUndo?: () => void) => void) | null = null;

/** Fire a toast from anywhere — hooks, query cache callbacks, non-React code */
export function globalToast(message: string, type: ToastType = 'error', onUndo?: () => void) {
  if (_globalToastFn) _globalToastFn(message, type, onUndo);
  else console.error('[toast]', message);
}

// [Req #216] Toast duration: 5s for toasts with undo, 3s for normal
const TOAST_DURATION = 3000;
const UNDO_TOAST_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info', onUndo?: () => void) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type, onUndo }]);
    const duration = onUndo ? UNDO_TOAST_DURATION : TOAST_DURATION;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  // Register the global toast dispatcher
  useEffect(() => {
    _globalToastFn = toast;
    return () => { _globalToastFn = null; };
  }, [toast]);

  // [Req #216] Handle undo click — execute callback and dismiss toast
  const handleUndo = useCallback((t: Toast) => {
    if (t.onUndo) t.onUndo();
    setToasts((prev) => prev.filter((toast) => toast.id !== t.id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container — fixed bottom-left (RTL) */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                'rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg animate-[fadeIn_150ms_ease-out] flex items-center gap-3',
                t.type === 'success' && 'bg-emerald-600 text-white',
                t.type === 'error' && 'bg-red-600 text-white',
                t.type === 'info' && 'bg-(--color-accent) text-white',
              )}
            >
              <span className="flex-1">{t.message}</span>
              {/* [Req #216] Undo button — fast undo instead of confirmation dialogs */}
              {t.onUndo && (
                <button
                  onClick={() => handleUndo(t)}
                  className="shrink-0 rounded border border-white/30 px-2 py-0.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
                >
                  ביטול
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
