import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Receipt, Calculator, Percent, CreditCard, LucideIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { batchScanInvoices, addHistoryRecord } from "@/services/api";
import { DOCUMENT_TYPE_CHOICES } from "@/shared/constants";
import type { DocumentType } from "@/shared/types";
import styles from "./Home.module.css";

const ICON_MAP: Record<string, LucideIcon> = {
  Receipt,
  Calculator,
  Percent,
  CreditCard,
};

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function Home() {
  const { setScreen, setBatchInvoices, setBatchFailures, defaultDocumentType, defaultFolderId } = useApp();
  const { error: showError, success: showSuccess } = useToast();
  const [chosenDocumentType, setChosenDocumentType] = useState<DocumentType | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const effectiveDocumentType: DocumentType = chosenDocumentType ?? defaultDocumentType ?? "generic";

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
      // Pass document type to OCR so it can select the appropriate model
      const result = await batchScanInvoices(selectedFiles, effectiveDocumentType);
      for (const inv of result.successes) {
        const docType = inv.fields.document_type?.value ?? effectiveDocumentType;
        const extractedData = Object.fromEntries(
          Object.entries(inv.fields).map(([k, v]) => [k, v.value])
        );
        const fileName = inv.source_file ?? "scanned.pdf";
        try {
          await addHistoryRecord({
            document_type: docType,
            file_path_or_name: fileName,
            extracted_data: extractedData,
            status: "pending",
            folder_id: defaultFolderId ?? undefined,
          });
        } catch {
          // non-fatal: history add failed for this one
        }
      }
      setBatchInvoices(result.successes);
      setBatchFailures(result.failures);
      setScreen("batchReview");
      if (result.failures.length > 0) {
        showSuccess(
          `${result.successes.length} of ${selectedFiles.length} invoices scanned. ${result.failures.length} file(s) failed.`
        );
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFiles, setBatchInvoices, setScreen, showError, showSuccess, effectiveDocumentType, defaultFolderId]);

  if (chosenDocumentType == null) {
    return (
      <div className={styles.page}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Invoice Scanner</h1>
          <p className={styles.subtitle}>
            Choose the type of document you want to scan
          </p>
        </div>
        <div className={styles.typeList} role="list">
          {DOCUMENT_TYPE_CHOICES.map(({ id, label, icon }) => {
            const IconComponent = ICON_MAP[icon] || Receipt;
            return (
              <button
                key={id}
                type="button"
                className={styles.typeItem}
                onClick={() => setChosenDocumentType(id)}
                role="listitem"
              >
                <span className={styles.typeIcon} aria-hidden>
                  <IconComponent size={24} strokeWidth={2} />
                </span>
                <span className={styles.typeLabel}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.backRow}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => setChosenDocumentType(null)}
          aria-label="Back to document type"
        >
          ← Back
        </button>
      </div>
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
