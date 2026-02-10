import { useToast } from "@/context/ToastContext";
import styles from "./Toast.module.css";

export function ToastContainer() {
  const { toasts } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className={styles.container} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${styles[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
