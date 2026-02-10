import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { batchScanInvoices } from "@/services/api";
import styles from "./Home.module.css";

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function Home() {
  const { setScreen, setBatchInvoices } = useApp();
  const { error: showError, success: showSuccess } = useToast();
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSelectPdfs = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const pdfOnly = paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
    setSelectedFiles((prev) => {
      const combined = [...prev];
      for (const p of pdfOnly) {
        if (!combined.includes(p)) combined.push(p);
      }
      return combined;
    });
  }, []);

  const removeFile = useCallback((path: string) => {
    setSelectedFiles((prev) => prev.filter((p) => p !== path));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  const handleScanAll = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setIsProcessing(true);
    try {
      const result = await batchScanInvoices(selectedFiles);
      setBatchInvoices(result);
      setScreen("batchReview");
      if (result.length < selectedFiles.length) {
        showSuccess(
          `${result.length} of ${selectedFiles.length} invoices scanned. Some files could not be processed.`
        );
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFiles, setBatchInvoices, setScreen, showError, showSuccess]);

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Invoice Scanner</h1>
        <p className={styles.subtitle}>
          Select multiple PDF invoices, then scan all at once
        </p>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleSelectPdfs}
          disabled={isProcessing}
        >
          Select PDF Invoices
        </button>
      </div>
      {selectedFiles.length > 0 && (
        <div className={styles.fileSection}>
          <div className={styles.fileSectionHeader}>
            <span className={styles.fileCount}>
              {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""}{" "}
              selected
            </span>
            <button
              type="button"
              className={styles.clearButton}
              onClick={clearAll}
              disabled={isProcessing}
            >
              Clear all
            </button>
          </div>
          <ul className={styles.fileList}>
            {selectedFiles.map((path) => (
              <li key={path} className={styles.fileItem}>
                <span className={styles.fileName}>{getFileName(path)}</span>
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => removeFile(path)}
                  disabled={isProcessing}
                  aria-label={`Remove ${getFileName(path)}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.scanButton}
            onClick={handleScanAll}
            disabled={isProcessing}
          >
            {isProcessing ? "Scanning…" : "Scan All Invoices"}
          </button>
        </div>
      )}

      {isProcessing && (
        <div className={styles.scanOverlay} aria-live="polite">
          <div className={styles.scanOverlayContent}>
            <div className={styles.scanSpinner} aria-hidden="true" />
            <p className={styles.scanOverlayText}>
              Scanning {selectedFiles.length} invoice{selectedFiles.length !== 1 ? "s" : ""}…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
