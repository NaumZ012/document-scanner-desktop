import { useToast } from "@/context/ToastContext";
import styles from "./Toast.module.css";

export function ToastContainer() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className={styles.container} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
          <span className={styles.toastMessage}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className={styles.toastAction}
              onClick={async () => {
                await Promise.resolve(t.action!.onAction());
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
