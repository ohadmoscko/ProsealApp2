import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from './utils';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastState | null>(null);

let nextId = 0;

// ── Global toast (works outside React tree) ───────────────────────────────
let _globalToastFn: ((message: string, type?: ToastType) => void) | null = null;

/** Fire a toast from anywhere — hooks, query cache callbacks, non-React code */
export function globalToast(message: string, type: ToastType = 'error') {
  if (_globalToastFn) _globalToastFn(message, type);
  else console.error('[toast]', message);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // Register the global toast dispatcher
  useEffect(() => {
    _globalToastFn = toast;
    return () => { _globalToastFn = null; };
  }, [toast]);

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
                'rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg animate-[fadeIn_150ms_ease-out]',
                t.type === 'success' && 'bg-emerald-600 text-white',
                t.type === 'error' && 'bg-red-600 text-white',
                t.type === 'info' && 'bg-(--color-accent) text-white',
              )}
            >
              {t.message}
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
