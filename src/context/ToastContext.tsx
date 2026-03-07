import React, { createContext, useCallback, useState } from "react";

type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
}

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, options?: { action?: ToastAction }) => void;
  dismiss: (id: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;
const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", options?: { action?: ToastAction }) => {
      const id = nextId++;
      const toast: Toast = { id, message, type, action: options?.action };
      setToasts((prev) => [...prev, toast]);
      if (!options?.action) {
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), AUTO_DISMISS_MS);
      }
    },
    []
  );

  const success = useCallback((message: string) => showToast(message, "success"), [showToast]);
  const error = useCallback((message: string) => showToast(message, "error"), [showToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismiss, success, error }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
