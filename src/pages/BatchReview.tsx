import { useState, useEffect, useCallback, useMemo } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { ExcelExportDialog } from "@/components/ExcelExportDialog";
import { runOcrInvoice } from "@/services/api";
import { FIELD_LABELS_MK, FIELD_INPUT_TYPE } from "@/shared/constants";
import type { InvoiceData, FailedScan } from "@/shared/types";
import type { FieldKey } from "@/shared/constants";
import { formatAmountForDisplay } from "@/utils/fieldUtils";
import styles from "./BatchReview.module.css";

const MK = {
  delete: "Избриши",
  edit: "Измени",
  save: "Зачувај",
  preview: "Преглед",
  title: "Преглед на скенирани фактури",
  subtitleReady: (n: number) =>
    n === 1 ? "1 фактура подготвена за извоз" : `${n} фактури подготвени за извоз`,
  scanMore: "Сканирај уште",
  exportToExcel: "Извези во Excel",
  noInvoices: "Нема фактури за преглед.",
  goHome: "Кон почетна",
  excelCreated: "Excel датотеката е креирана",
  openExcel: "Отвори Excel",
  done: "Готово",
  exportedToast: (n: number) =>
    n === 1 ? "Извезена 1 фактура во Excel!" : `Извезени ${n} фактури во Excel!`,
  failedScans: "Неуспешни скенирања",
  failedScanTitle: "Неуспешно скенирање",
  errorReason: "Причина:",
  removeFailed: "Отстрани",
  rescan: "Повторно скенирај",
  rescanSuccess: "Успешно повторно скенирано!",
  rescanError: "Повторно скенирање не успеа: ",
} as const;

function getFieldValue(inv: InvoiceData, key: string): string {
  return inv.fields[key]?.value ?? "";
}

function setFieldValue(inv: InvoiceData, key: string, value: string): void {
  const existing = inv.fields[key];
  inv.fields[key] = {
    value,
    confidence: existing?.confidence,
  };
}

function isFieldEmpty(inv: InvoiceData, key: string): boolean {
  return getFieldValue(inv, key).trim() === "";
}

function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

function isImage(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || 
         lower.endsWith(".png") || lower.endsWith(".gif") || 
         lower.endsWith(".bmp") || lower.endsWith(".webp");
}

/** Convert technical error messages to user-friendly ones */
function simplifyError(error: string): string {
  // Try to parse JSON error response
  try {
    // Look for JSON in the error string
    const jsonMatch = error.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      // Extract inner error message if available
      if (parsed.error?.innererror?.message) {
        return parsed.error.innererror.message;
      }
      if (parsed.error?.message) {
        return parsed.error.message;
      }
    }
  } catch {
    // Not JSON, continue with other parsing
  }
  
  // Common error patterns
  if (error.includes("InvalidContentLength") || error.includes("too large")) {
    return "The input image is too large. Refer to documentation for the maximum file size.";
  }
  if (error.includes("InvalidRequest")) {
    return "Invalid request. The file format may not be supported.";
  }
  if (error.includes("File not found") || error.includes("not found")) {
    return "File not found.";
  }
  if (error.includes("timeout") || error.includes("Timeout")) {
    return "Request timed out. Please try again.";
  }
  if (error.includes("network") || error.includes("Network")) {
    return "Network error. Please check your internet connection.";
  }
  if (error.includes("Invalid key") || error.includes("unauthorized")) {
    return "Authentication failed. Please check your API credentials.";
  }
  
  // If it's a simple message without JSON, return as-is
  if (!error.includes("{") && !error.includes("OCR failed")) {
    return error;
  }
  
  // Default: extract meaningful part after "OCR failed" or similar
  const cleanError = error
    .replace(/^OCR failed \(\d+[^)]*\):\s*/, "")
    .replace(/^[^:]+:\s*/, "");
  
  return cleanError || "An error occurred during scanning.";
}

interface PreviewModalProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

function PreviewModal({ filePath, fileName, onClose }: PreviewModalProps) {
  const fileUrl = useMemo(() => {
    if (!filePath) return null;
    try {
      return convertFileSrc(filePath);
    } catch {
      return null;
    }
  }, [filePath]);

  const canShowPdf = isPdf(filePath) && fileUrl;
  const canShowImage = isImage(filePath) && fileUrl;

  return (
    <div className={styles.previewModalOverlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.previewModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.previewModalHeader}>
          <h2 className={styles.previewModalTitle}>{fileName}</h2>
          <button
            type="button"
            className={styles.previewModalClose}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.previewModalContent}>
          {canShowPdf ? (
            <iframe
              src={`${fileUrl}#toolbar=1&navpanes=1`}
              className={styles.previewIframe}
              title={fileName}
            />
          ) : canShowImage ? (
            <img
              src={fileUrl!}
              alt={fileName}
              className={styles.previewImage}
            />
          ) : (
            <div className={styles.previewPlaceholder}>
              <p>Preview not available</p>
              <p>{fileName}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BatchReview() {
  const { batchInvoices, setBatchInvoices, batchFailures, setBatchFailures, setScreen, confirmBeforeExport, defaultDocumentType } = useApp();
  const { success: showSuccess, error: showError } = useToast();
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [failures, setFailures] = useState<FailedScan[]>([]);
  const [exportSuccessPath, setExportSuccessPath] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [editingCards, setEditingCards] = useState<Set<number>>(new Set());
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewFilePath, setPreviewFilePath] = useState<{ path: string; name: string } | null>(null);
  const [rescanningIndex, setRescanningIndex] = useState<number | null>(null);

  useEffect(() => {
    setInvoices(batchInvoices ?? []);
  }, [batchInvoices]);

  useEffect(() => {
    setFailures(batchFailures ?? []);
  }, [batchFailures]);

  const updateCell = useCallback((rowIndex: number, fieldKey: string, value: string) => {
    setInvoices((prev) => {
      const next = prev.map((inv) => ({
        ...inv,
        fields: { ...inv.fields },
      }));
      if (next[rowIndex]) {
        setFieldValue(next[rowIndex], fieldKey, value);
      }
      return next;
    });
  }, []);

  const deleteRow = useCallback((index: number) => {
    setInvoices((prev) => prev.filter((_, i) => i !== index));
    setEditingCards((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i === index) return;
        next.add(i > index ? i - 1 : i);
      });
      return next;
    });
  }, []);

  const removeFailed = useCallback((index: number) => {
    setFailures((prev) => prev.filter((_, i) => i !== index));
    setBatchFailures((prev: FailedScan[] | null) => prev?.filter((_: FailedScan, i: number) => i !== index) ?? null);
  }, [setBatchFailures]);

  const rescanFailed = useCallback(
    async (index: number) => {
      const failure = failures[index];
      if (!failure?.file_path) return;
      setRescanningIndex(index);
      try {
        // Use default document type for rescan (defaults to "faktura" if not set)
        const docTypeForOcr = defaultDocumentType ?? "faktura";
        const data = await runOcrInvoice(failure.file_path, docTypeForOcr);
        const withSource: InvoiceData = {
          ...data,
          source_file: failure.file_name,
          source_file_path: failure.file_path,
        };
        setBatchInvoices((prev: InvoiceData[] | null) => [...(prev ?? []), withSource]);
        setBatchFailures((prev: FailedScan[] | null) =>
          prev?.filter((_: FailedScan, i: number) => i !== index) ?? null
        );
        showSuccess(MK.rescanSuccess);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showError(MK.rescanError + msg);
      } finally {
        setRescanningIndex(null);
      }
    },
    [failures, setBatchInvoices, setBatchFailures, showError, showSuccess, defaultDocumentType]
  );

  const startEdit = useCallback((index: number) => {
    setEditingCards((prev) => new Set(prev).add(index));
  }, []);

  const saveEdit = useCallback((index: number) => {
    setEditingCards((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const handleExportComplete = useCallback(
    (path: string) => {
      showSuccess(MK.exportedToast(invoices.length));
      setExportSuccessPath(path);
    },
    [invoices.length, showSuccess]
  );

  const handleOpenExportDialog = useCallback(() => {
    if (invoices.length === 0) return;
    if (confirmBeforeExport && !window.confirm("Да ги извезам фактурите во Excel?")) return;
    setShowExportDialog(true);
  }, [invoices.length, confirmBeforeExport]);

  const handleOpenExcel = useCallback(async () => {
    if (!exportSuccessPath) return;
    try {
      await openPath(exportSuccessPath);
    } catch {
      showError("Could not open file.");
    }
  }, [exportSuccessPath, showError]);

  const handleDone = useCallback(() => {
    setExportSuccessPath(null);
    setBatchInvoices(null);
    setBatchFailures(null);
    setScreen("home");
  }, [setBatchInvoices, setBatchFailures, setScreen]);

  const handleScanMore = useCallback(() => {
    setBatchInvoices(null);
    setBatchFailures(null);
    setScreen("home");
  }, [setBatchInvoices, setBatchFailures, setScreen]);

  if ((batchInvoices == null || batchInvoices.length === 0) && (batchFailures == null || batchFailures.length === 0)) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <p>{MK.noInvoices}</p>
          <button type="button" className={styles.primaryButton} onClick={handleScanMore}>
            {MK.goHome}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.stickyHeader}>
        <div className={styles.headerInner}>
          <div>
            <h1 className={styles.title}>{MK.title}</h1>
            <p className={styles.subtitle}>{MK.subtitleReady(invoices.length)}</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} onClick={handleScanMore}>
              {MK.scanMore}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleOpenExportDialog}
              disabled={invoices.length === 0}
            >
              {MK.exportToExcel}
            </button>
          </div>
        </div>
      </header>

      <div className={styles.scrollArea}>
        <div className={styles.cardList}>
          {invoices.map((inv, index) => {
            const seller = getFieldValue(inv, "seller_name");
            const totalRaw = getFieldValue(inv, "total_amount");
            const total = totalRaw ? formatAmountForDisplay(totalRaw) : "";
            const isEditing = editingCards.has(index);

            return (
              <article key={index} className={styles.card} data-index={index}>
                <div className={styles.cardTop}>
                  <div className={styles.cardHeader}>
                    <span className={styles.cardHeaderSeller}>
                      {FIELD_LABELS_MK.seller_name}: {seller || "—"}
                    </span>
                    <span className={styles.cardHeaderTotal}>
                      {FIELD_LABELS_MK.total_amount}: {total || "—"}
                    </span>
                  </div>
                  <div className={styles.cardRightActions}>
                    {inv.source_file_path && (
                      <button
                        type="button"
                        className={styles.previewBtn}
                        onClick={() => setPreviewIndex(index)}
                        aria-label={MK.preview}
                      >
                        {MK.preview}
                      </button>
                    )}
                    <button
                      type="button"
                      className={isEditing ? styles.primaryButton : styles.secondaryButton}
                      onClick={() => (isEditing ? saveEdit(index) : startEdit(index))}
                    >
                      {isEditing ? MK.save : MK.edit}
                    </button>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => deleteRow(index)}
                      aria-label={MK.delete}
                    >
                      {MK.delete}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <>
                    <div className={styles.cardGrid}>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.seller_name}
                        <input
                          type="text"
                          className={styles.input}
                          value={getFieldValue(inv, "seller_name")}
                          onChange={(e) => updateCell(index, "seller_name", e.target.value)}
                          aria-label={FIELD_LABELS_MK.seller_name}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.total_amount}
                        <input
                          type="text"
                          className={`${styles.input} ${styles.inputNumber}`}
                          value={(() => {
                            const val = getFieldValue(inv, "total_amount");
                            return val ? formatAmountForDisplay(val) : "";
                          })()}
                          onChange={(e) => {
                            // Parse formatted value back to raw format for storage
                            const raw = e.target.value.replace(/,/g, ".");
                            updateCell(index, "total_amount", raw);
                          }}
                          aria-label={FIELD_LABELS_MK.total_amount}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.date}
                        <input
                          type="text"
                          className={styles.input}
                          value={getFieldValue(inv, "date")}
                          onChange={(e) => updateCell(index, "date", e.target.value)}
                          aria-label={FIELD_LABELS_MK.date}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.invoice_number}
                        <input
                          type="text"
                          className={styles.input}
                          value={getFieldValue(inv, "invoice_number")}
                          onChange={(e) => updateCell(index, "invoice_number", e.target.value)}
                          aria-label={FIELD_LABELS_MK.invoice_number}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.buyer_name}
                        <input
                          type="text"
                          className={
                            isFieldEmpty(inv, "buyer_name")
                              ? `${styles.input} ${styles.inputInvalid}`
                              : styles.input
                          }
                          value={getFieldValue(inv, "buyer_name")}
                          onChange={(e) => updateCell(index, "buyer_name", e.target.value)}
                          aria-label={FIELD_LABELS_MK.buyer_name}
                          placeholder="Купувач (задолжително)"
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.net_amount}
                        <input
                          type="text"
                          className={`${styles.input} ${styles.inputNumber}`}
                          value={(() => {
                            const val = getFieldValue(inv, "net_amount");
                            return val ? formatAmountForDisplay(val) : "";
                          })()}
                          onChange={(e) => {
                            // Parse formatted value back to raw format for storage
                            const raw = e.target.value.replace(/,/g, ".");
                            updateCell(index, "net_amount", raw);
                          }}
                          aria-label={FIELD_LABELS_MK.net_amount}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.tax_amount}
                        <input
                          type="text"
                          className={`${styles.input} ${styles.inputNumber}`}
                          value={(() => {
                            const val = getFieldValue(inv, "tax_amount");
                            return val ? formatAmountForDisplay(val) : "";
                          })()}
                          onChange={(e) => {
                            // Parse formatted value back to raw format for storage
                            const raw = e.target.value.replace(/,/g, ".");
                            updateCell(index, "tax_amount", raw);
                          }}
                          aria-label={FIELD_LABELS_MK.tax_amount}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.document_type}
                        <input
                          type="text"
                          className={styles.input}
                          value={getFieldValue(inv, "document_type")}
                          onChange={(e) => updateCell(index, "document_type", e.target.value)}
                          aria-label={FIELD_LABELS_MK.document_type}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.currency}
                        <input
                          type="text"
                          className={styles.input}
                          value={getFieldValue(inv, "currency")}
                          onChange={(e) => updateCell(index, "currency", e.target.value)}
                          aria-label={FIELD_LABELS_MK.currency}
                        />
                      </label>
                    </div>
                    <div className={styles.cardDescRow}>
                      <label className={styles.descLabel}>
                        {FIELD_LABELS_MK.description}
                        <textarea
                          className={styles.descTextarea}
                          value={getFieldValue(inv, "description")}
                          onChange={(e) => updateCell(index, "description", e.target.value)}
                          aria-label={FIELD_LABELS_MK.description}
                          rows={4}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.cardGrid}>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.seller_name}
                        <span className={styles.cardValue}>{getFieldValue(inv, "seller_name") || "—"}</span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.total_amount}
                        <span className={styles.cardValue}>
                          {(() => {
                            const val = getFieldValue(inv, "total_amount");
                            return val ? formatAmountForDisplay(val) : "—";
                          })()}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.date}
                        <span className={styles.cardValue}>{getFieldValue(inv, "date") || "—"}</span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.invoice_number}
                        <span className={styles.cardValue}>{getFieldValue(inv, "invoice_number") || "—"}</span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.buyer_name}
                        <span className={isFieldEmpty(inv, "buyer_name") ? `${styles.cardValue} ${styles.cardValueInvalid}` : styles.cardValue}>
                          {getFieldValue(inv, "buyer_name") || "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.document_type}
                        <span className={styles.cardValue}>{getFieldValue(inv, "document_type") || "—"}</span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.currency}
                        <span className={styles.cardValue}>{getFieldValue(inv, "currency") || "—"}</span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.net_amount}
                        <span className={styles.cardValue}>
                          {(() => {
                            const val = getFieldValue(inv, "net_amount");
                            return val ? formatAmountForDisplay(val) : "—";
                          })()}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.tax_amount}
                        <span className={styles.cardValue}>
                          {(() => {
                            const val = getFieldValue(inv, "tax_amount");
                            return val ? formatAmountForDisplay(val) : "—";
                          })()}
                        </span>
                      </div>
                    </div>
                    <div className={styles.cardDescRow}>
                      <div className={styles.descLabel}>
                        {FIELD_LABELS_MK.description}
                        <div className={styles.cardValueBlock}>
                          {getFieldValue(inv, "description") || "—"}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </article>
            );
          })}

          {failures.length > 0 && (
            <div className={styles.failedSection}>
              <h2 className={styles.failedSectionTitle}>{MK.failedScans}</h2>
              <div className={styles.failedCardList}>
                {failures.map((failure, index) => (
                  <article key={index} className={styles.failedCard}>
                    <div className={styles.failedCardHeader}>
                      <div className={styles.failedCardInfo}>
                        <span className={styles.failedCardFileName}>{failure.file_name}</span>
                        <span className={styles.failedCardError}>
                          {MK.errorReason} {simplifyError(failure.error)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.failedCardRemove}
                        onClick={() => removeFailed(index)}
                        aria-label={MK.removeFailed}
                      >
                        {MK.removeFailed}
                      </button>
                    </div>
                    <div className={styles.failedCardPreview}>
                      {failure.file_path && (isPdf(failure.file_path) || isImage(failure.file_path)) && (
                        <button
                          type="button"
                          className={styles.previewBtn}
                          onClick={() => setPreviewFilePath({ path: failure.file_path, name: failure.file_name })}
                        >
                          {MK.preview}
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.rescanBtn}
                        onClick={() => rescanFailed(index)}
                        disabled={rescanningIndex === index}
                        aria-label={MK.rescan}
                      >
                        {rescanningIndex === index ? "…" : MK.rescan}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showExportDialog && (
        <ExcelExportDialog
          invoices={invoices}
          onClose={() => setShowExportDialog(false)}
          onExportComplete={(path) => {
            handleExportComplete(path);
            setShowExportDialog(false);
          }}
        />
      )}

      {exportSuccessPath != null && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>{MK.excelCreated}</h2>
            <p className={styles.modalPath}>{exportSuccessPath}</p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.primaryButton} onClick={handleOpenExcel}>
                {MK.openExcel}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={handleDone}>
                {MK.done}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewIndex !== null && invoices[previewIndex] && (
        <PreviewModal
          filePath={invoices[previewIndex].source_file_path!}
          fileName={invoices[previewIndex].source_file || "Document"}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {previewFilePath && (
        <PreviewModal
          filePath={previewFilePath.path}
          fileName={previewFilePath.name}
          onClose={() => setPreviewFilePath(null)}
        />
      )}
    </div>
  );
}
