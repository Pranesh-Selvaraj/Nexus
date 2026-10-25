import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface ToastInput {
  kind: 'info' | 'success' | 'error';
  message: string;
  /** Optional single action (e.g. Undo). Toasts with actions stay longer. */
  action?: { label: string; onClick: () => void };
}

interface Toast extends ToastInput {
  id: string;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_TTL_MS = 6_000;
const TOAST_ACTION_TTL_MS = 12_000;

/** Minimal app-wide toast stack (replaces alert()/silent failures). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: ToastInput) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(
      () => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      },
      toast.action ? TOAST_ACTION_TTL_MS : TOAST_TTL_MS,
    );
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
              toast.kind === 'success'
                ? 'border-emerald-800/60 bg-emerald-950/90 text-emerald-200'
                : toast.kind === 'error'
                  ? 'border-red-800/60 bg-red-950/90 text-red-200'
                  : 'border-zinc-700 bg-zinc-900/95 text-zinc-200'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    setToasts((prev) =>
                      prev.filter((item) => item.id !== toast.id),
                    );
                  }}
                  className="shrink-0 rounded-md border border-current/40 px-2 py-1 text-xs font-semibold hover:bg-white/5"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}
