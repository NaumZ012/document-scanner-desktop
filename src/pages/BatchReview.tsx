import { useState, useEffect, useCallback, useMemo } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { ExcelExportDialog } from "@/components/ExcelExportDialog";
import { runOcrInvoice } from "@/services/api";
import { FIELD_LABELS_MK, FIELD_INPUT_TYPE, ANALYZER_FIELD_INPUT_TYPE } from "@/shared/constants";
import type { InvoiceData, FailedScan } from "@/shared/types";
import type { FieldKey } from "@/shared/constants";
import { getSchemaForDocumentType, normalizeDocumentType } from "@/shared/documentTypeSchemas";
import { formatAmountForDisplay, normalizeAmountInput } from "@/utils/fieldUtils";
import styles from "./BatchReview.module.css";

const MK = {
  delete: "Избриши",
  edit: "Измени",
  save: "Зачувај",
  preview: "Преглед",
  title: "Преглед на скенирани документи",
  subtitleReady: (n: number, docLabel: string) =>
    n === 1 ? `1 ${docLabel} подготвен за извоз` : `${n} ${docLabel} подготвени за извоз`,
  scanMore: "Сканирај уште",
  exportToExcel: "Извези во Excel",
  noInvoices: "Нема фактури за преглед.",
  goHome: "Кон почетна",
  excelCreated: "Excel датотеката е креирана",
  openExcel: "Отвори Excel",
  done: "Готово",
  exportedToast: (n: number) =>
    n === 1 ? "Извезен 1 документ во Excel!" : `Извезени ${n} документи во Excel!`,
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

function getFieldConfidence(inv: InvoiceData, key: string): number | undefined {
  return inv.fields[key]?.confidence;
}

/** Format a field value for display: "0" when extracted zero, "—" only when no data. */
function formatFieldDisplayValue(key: string, value: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return "—";
  if (trimmed === "0") return "0";
  const isAmount =
    FIELD_INPUT_TYPE[key as FieldKey] === "amount" ||
    ANALYZER_FIELD_INPUT_TYPE[key] === "amount";
  return isAmount ? formatAmountForDisplay(value) : value;
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
  invoice?: InvoiceData;
  /** Document type for this batch (used when invoice.document_type is missing). */
  documentType?: string;
}

function PreviewModal({ filePath, fileName, onClose, invoice, documentType }: PreviewModalProps) {
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

  const docTypeId = useMemo(() => {
    if (!invoice) return normalizeDocumentType(documentType);
    const raw = invoice.fields.document_type?.value as string | undefined;
    return normalizeDocumentType(raw || documentType);
  }, [invoice, documentType]);

  const schema = useMemo(
    () => (docTypeId ? getSchemaForDocumentType(docTypeId) : null),
    [docTypeId]
  );

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
        <div
          className={`${styles.previewModalContent} ${
            invoice ? styles.previewModalContentSplit : ""
          }`}
        >
          <div className={styles.previewPane}>
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

          {invoice && (
            <div className={styles.previewPaneRight}>
              <h3 className={styles.previewFieldsTitle}>
                {schema ? `Извлечени податоци — ${schema.title}` : "Извлечени податоци"}
              </h3>
              <div className={styles.schemaFieldsList}>
                {schema
                  ? schema.fields.map((def) => {
                      const confidence = getFieldConfidence(invoice, def.key);
                      return (
                        <div key={def.key} className={styles.schemaFieldRowWithConfidence}>
                          <span className={styles.schemaFieldLabel}>{def.label}</span>
                          <span className={styles.schemaFieldValue}>
                            {formatFieldDisplayValue(def.key, getFieldValue(invoice, def.key))}
                          </span>
                          <span className={styles.schemaFieldConfidence} title="Доверба">
                            {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
                          </span>
                        </div>
                      );
                    })
                  : (
                    <>
                      <div className={styles.previewField}>
                        <span className={styles.previewFieldLabel}>{FIELD_LABELS_MK.seller_name}</span>
                        <span className={styles.previewFieldValue}>
                          {getFieldValue(invoice, "seller_name") || "—"}
                        </span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(invoice, "seller_name") != null ? `${Math.round(getFieldConfidence(invoice, "seller_name")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.previewField}>
                        <span className={styles.previewFieldLabel}>{FIELD_LABELS_MK.total_amount}</span>
                        <span className={styles.previewFieldValue}>
                          {(() => {
                            const val = getFieldValue(invoice, "total_amount");
                            return val ? formatAmountForDisplay(val) : "—";
                          })()}
                        </span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(invoice, "total_amount") != null ? `${Math.round(getFieldConfidence(invoice, "total_amount")! * 100)}%` : "—"}
                        </span>
                      </div>
                    </>
                  )}
              </div>
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

  const batchDocType = useMemo(() => {
    const first = batchInvoices?.[0];
    if (!first) return "";
    const raw = getFieldValue(first, "document_type");
    return normalizeDocumentType(raw || (defaultDocumentType as string | undefined));
  }, [batchInvoices, defaultDocumentType]);

  const batchDocLabel = useMemo(() => {
    if (batchDocType === "smetka") return "даночен биланс";
    if (batchDocType === "generic") return "ДДВ извештај";
    if (batchDocType === "plata") return "платен извештај";
    return "фактура";
  }, [batchDocType]);

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

  /** Update multiple fields in one row (avoids batching issues). */
  const updateCells = useCallback((rowIndex: number, updates: Record<string, string>) => {
    setInvoices((prev) => {
      const next = prev.map((inv, i) => {
        if (i !== rowIndex) return inv;
        const fields = { ...inv.fields };
        for (const [key, value] of Object.entries(updates)) {
          const existing = fields[key];
          fields[key] = { value, confidence: existing?.confidence };
        }
        return { ...inv, fields };
      });
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
    if (confirmBeforeExport && !window.confirm("Да ги извезам документите во Excel?")) return;
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
      <div className={styles.scrollArea}>
        <div className={`${styles.cardList} ${styles.scrollAreaWithFooter}`}>
          {invoices.map((inv, index) => {
            const rawDocType = getFieldValue(inv, "document_type");
            const normDocType = normalizeDocumentType(
              rawDocType || (batchDocType as string | undefined) || (defaultDocumentType as string | undefined)
            );
            const isEditing = editingCards.has(index);

            // Custom layout for Даночен биланс (Tax Balance)
            if (normDocType === "smetka") {
              const company = getFieldValue(inv, "companyName") || getFieldValue(inv, "seller_name");
              const year = getFieldValue(inv, "taxYear") || getFieldValue(inv, "date");
              const taxBase = getFieldValue(inv, "taxBaseAfterReduction") || getFieldValue(inv, "finalTaxBase");
              const calculatedTax = getFieldValue(inv, "calculatedProfitTax") || getFieldValue(inv, "calculatedTaxAfterReduction");
              const finalBalance = getFieldValue(inv, "amountToPayOrOverpaid");
              const taxSchema = getSchemaForDocumentType("smetka");

              return (
                <article key={index} className={styles.card} data-index={index}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardHeader}>
                      <span className={styles.cardHeaderSeller}>
                        Даночен обврзник: {company || "—"}
                      </span>
                      <span className={styles.cardHeaderTotal}>
                        Даночна година: {year || "—"}
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
                          Даночна основа по намалување (V):
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "taxBaseAfterReduction") || getFieldValue(inv, "aop_49")}
                            onChange={(e) => {
                              const raw = normalizeAmountInput(e.target.value);
                              updateCells(index, { taxBaseAfterReduction: raw, aop_49: raw });
                            }}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          Пресметан данок на добивка (VI):
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "calculatedProfitTax") || getFieldValue(inv, "aop_50")}
                            onChange={(e) => {
                              const raw = normalizeAmountInput(e.target.value);
                              updateCells(index, { calculatedProfitTax: raw, aop_50: raw });
                            }}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          Платени аконтации:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "advanceTaxPaid") || getFieldValue(inv, "aop_57")}
                            onChange={(e) => {
                              const raw = normalizeAmountInput(e.target.value);
                              updateCells(index, { advanceTaxPaid: raw, aop_57: raw });
                            }}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          Износ за доплата / повеќе платен износ:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "amountToPayOrOverpaid") || getFieldValue(inv, "aop_59")}
                            onChange={(e) => {
                              const raw = normalizeAmountInput(e.target.value);
                              updateCells(index, { amountToPayOrOverpaid: raw, aop_59: raw });
                            }}
                          />
                        </label>
                      </div>
                      <div className={styles.schemaFieldsList}>
                        {taxSchema.fields.map((def) => {
                          const confidence = getFieldConfidence(inv, def.key);
                          const isAmount =
                            ANALYZER_FIELD_INPUT_TYPE[def.key] === "amount" ||
                            def.key.startsWith("aop_");
                          return (
                            <div key={def.key} className={styles.schemaFieldRowWithConfidence}>
                              <span className={styles.schemaFieldLabel}>{def.label}</span>
                              <input
                                type="text"
                                className={isAmount ? `${styles.input} ${styles.inputNumber}` : styles.input}
                                value={getFieldValue(inv, def.key)}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/,/g, ".");
                                  updateCell(index, def.key, raw);
                                }}
                                aria-label={def.label}
                              />
                              <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                                {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={styles.cardGrid}>
                        <div className={styles.gridLabel}>
                          Даночна основа по намалување (V):
                          <span className={styles.cardValue}>
                            {taxBase ? formatAmountForDisplay(taxBase) : "—"}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          Пресметан данок на добивка (VI):
                          <span className={styles.cardValue}>
                            {calculatedTax ? formatAmountForDisplay(calculatedTax) : "—"}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          Платени аконтации:
                          <span className={styles.cardValue}>
                            {(() => {
                              const val = getFieldValue(inv, "advanceTaxPaid");
                              return val ? formatAmountForDisplay(val) : "—";
                            })()}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          Износ за доплата / повеќе платен износ:
                          <span className={styles.cardValue}>
                            {finalBalance ? formatAmountForDisplay(finalBalance) : "—"}
                          </span>
                        </div>
                      </div>

                      <div className={styles.schemaFieldsList}>
                        {taxSchema.fields.map((def) => {
                          const confidence = getFieldConfidence(inv, def.key);
                          return (
                            <div key={def.key} className={styles.schemaFieldRowWithConfidence}>
                              <span className={styles.schemaFieldLabel}>{def.label}</span>
                              <span className={styles.schemaFieldValue}>
                                {formatFieldDisplayValue(def.key, getFieldValue(inv, def.key))}
                              </span>
                              <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                                {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </article>
              );
            }

            // Custom layout for ДДВ (VAT return)
            if (normDocType === "generic") {
              const company = getFieldValue(inv, "companyName") || getFieldValue(inv, "seller_name");
              const period = getFieldValue(inv, "taxPeriod") || getFieldValue(inv, "date");
              const totalTaxBase = getFieldValue(inv, "totalTaxBase") || getFieldValue(inv, "net_amount");
              const totalOutputVat = getFieldValue(inv, "totalOutputVat");
              const totalInputVat = getFieldValue(inv, "totalInputVat");
              const vatPayableOrRefund = getFieldValue(inv, "vatPayableOrRefund") || getFieldValue(inv, "total_amount");
              const ddvSchema = getSchemaForDocumentType("generic");

              return (
                <article key={index} className={styles.card} data-index={index}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardHeader}>
                      <span className={styles.cardHeaderSeller}>
                        Даночен обврзник: {company || "—"}
                      </span>
                      <span className={styles.cardHeaderTotal}>
                        Период: {period || "—"}
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
                          Вкупна даночна основа:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "totalTaxBase")}
                            onChange={(e) => updateCell(index, "totalTaxBase", normalizeAmountInput(e.target.value))}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          Вкупен излезен ДДВ:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "totalOutputVat")}
                            onChange={(e) => updateCell(index, "totalOutputVat", normalizeAmountInput(e.target.value))}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          Вкупен влезен ДДВ:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "totalInputVat")}
                            onChange={(e) => updateCell(index, "totalInputVat", normalizeAmountInput(e.target.value))}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          ДДВ за плаќање / поврат:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "vatPayableOrRefund")}
                            onChange={(e) => updateCell(index, "vatPayableOrRefund", normalizeAmountInput(e.target.value))}
                          />
                        </label>
                      </div>
                      <div className={styles.schemaFieldsList}>
                        {ddvSchema.fields.map((def) => {
                          const confidence = getFieldConfidence(inv, def.key);
                          return (
                            <div key={def.key} className={styles.schemaFieldRowWithConfidence}>
                              <span className={styles.schemaFieldLabel}>{def.label}</span>
                              <input
                                type="text"
                                className={styles.input}
                                value={getFieldValue(inv, def.key)}
                                onChange={(e) => updateCell(index, def.key, e.target.value)}
                                aria-label={def.label}
                              />
                              <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                                {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={styles.cardGrid}>
                        <div className={styles.gridLabel}>
                          Вкупна даночна основа:
                          <span className={styles.cardValue}>
                            {totalTaxBase ? formatAmountForDisplay(totalTaxBase) : "—"}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          Вкупен излезен ДДВ:
                          <span className={styles.cardValue}>
                            {totalOutputVat ? formatAmountForDisplay(totalOutputVat) : "—"}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          Вкупен влезен ДДВ:
                          <span className={styles.cardValue}>
                            {totalInputVat ? formatAmountForDisplay(totalInputVat) : "—"}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          ДДВ за плаќање / поврат:
                          <span className={styles.cardValue}>
                            {vatPayableOrRefund ? formatAmountForDisplay(vatPayableOrRefund) : "—"}
                          </span>
                        </div>
                      </div>

                      <div className={styles.schemaFieldsList}>
                        {ddvSchema.fields.map((def) => {
                          const confidence = getFieldConfidence(inv, def.key);
                          return (
                            <div key={def.key} className={styles.schemaFieldRowWithConfidence}>
                              <span className={styles.schemaFieldLabel}>{def.label}</span>
                              <span className={styles.schemaFieldValue}>
                                {formatFieldDisplayValue(def.key, getFieldValue(inv, def.key))}
                              </span>
                              <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                                {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </article>
              );
            }

            // Custom layout for Плата (Payroll)
            if (normDocType === "plata") {
              const company = getFieldValue(inv, "companyName") || getFieldValue(inv, "seller_name");
              const year = getFieldValue(inv, "year") || getFieldValue(inv, "date");
              const totalGross = getFieldValue(inv, "totalGrossSalary") || getFieldValue(inv, "total_amount");
              const totalNet = getFieldValue(inv, "totalNetSalary") || getFieldValue(inv, "net_amount");
              const totalCost = getFieldValue(inv, "totalPayrollCost") || getFieldValue(inv, "tax_amount");
              const payrollSchema = getSchemaForDocumentType("plata");

              return (
                <article key={index} className={styles.card} data-index={index}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardHeader}>
                      <span className={styles.cardHeaderSeller}>
                        Работодавач: {company || "—"}
                      </span>
                      <span className={styles.cardHeaderTotal}>
                        Година: {year || "—"}
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
                          Вкупна бруто плата:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "totalGrossSalary")}
                            onChange={(e) => updateCell(index, "totalGrossSalary", normalizeAmountInput(e.target.value))}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          Вкупна нето плата:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "totalNetSalary")}
                            onChange={(e) => updateCell(index, "totalNetSalary", normalizeAmountInput(e.target.value))}
                          />
                        </label>
                        <label className={styles.gridLabel}>
                          Вкупен трошок за плати:
                          <input
                            type="text"
                            className={`${styles.input} ${styles.inputNumber}`}
                            value={getFieldValue(inv, "totalPayrollCost")}
                            onChange={(e) => updateCell(index, "totalPayrollCost", normalizeAmountInput(e.target.value))}
                          />
                        </label>
                      </div>
                      <div className={styles.schemaFieldsList}>
                        {payrollSchema.fields.map((def) => {
                          const confidence = getFieldConfidence(inv, def.key);
                          return (
                            <div key={def.key} className={styles.schemaFieldRowWithConfidence}>
                              <span className={styles.schemaFieldLabel}>{def.label}</span>
                              <input
                                type="text"
                                className={styles.input}
                                value={getFieldValue(inv, def.key)}
                                onChange={(e) => updateCell(index, def.key, e.target.value)}
                                aria-label={def.label}
                              />
                              <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                                {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={styles.cardGrid}>
                        <div className={styles.gridLabel}>
                          Вкупна бруто плата:
                          <span className={styles.cardValue}>
                            {totalGross ? formatAmountForDisplay(totalGross) : "—"}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          Вкупна нето плата:
                          <span className={styles.cardValue}>
                            {totalNet ? formatAmountForDisplay(totalNet) : "—"}
                          </span>
                        </div>
                        <div className={styles.gridLabel}>
                          Вкупен трошок за плати:
                          <span className={styles.cardValue}>
                            {totalCost ? formatAmountForDisplay(totalCost) : "—"}
                          </span>
                        </div>
                      </div>

                      <div className={styles.schemaFieldsList}>
                        {payrollSchema.fields.map((def) => {
                          const confidence = getFieldConfidence(inv, def.key);
                          return (
                            <div key={def.key} className={styles.schemaFieldRowWithConfidence}>
                              <span className={styles.schemaFieldLabel}>{def.label}</span>
                              <span className={styles.schemaFieldValue}>
                                {formatFieldDisplayValue(def.key, getFieldValue(inv, def.key))}
                              </span>
                              <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                                {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </article>
              );
            }

            // Default invoice layout (existing behaviour)
            const seller = getFieldValue(inv, "seller_name");
            const totalRaw = getFieldValue(inv, "total_amount");
            const total = totalRaw ? formatAmountForDisplay(totalRaw) : "";

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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "seller_name") != null ? `${Math.round(getFieldConfidence(inv, "seller_name")! * 100)}%` : "—"}
                        </span>
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
                            const raw = normalizeAmountInput(e.target.value);
                            updateCell(index, "total_amount", raw);
                          }}
                          aria-label={FIELD_LABELS_MK.total_amount}
                        />
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "total_amount") != null ? `${Math.round(getFieldConfidence(inv, "total_amount")! * 100)}%` : "—"}
                        </span>
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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "date") != null ? `${Math.round(getFieldConfidence(inv, "date")! * 100)}%` : "—"}
                        </span>
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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "invoice_number") != null ? `${Math.round(getFieldConfidence(inv, "invoice_number")! * 100)}%` : "—"}
                        </span>
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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "buyer_name") != null ? `${Math.round(getFieldConfidence(inv, "buyer_name")! * 100)}%` : "—"}
                        </span>
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
                            const raw = normalizeAmountInput(e.target.value);
                            updateCell(index, "net_amount", raw);
                          }}
                          aria-label={FIELD_LABELS_MK.net_amount}
                        />
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "net_amount") != null ? `${Math.round(getFieldConfidence(inv, "net_amount")! * 100)}%` : "—"}
                        </span>
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
                            const raw = normalizeAmountInput(e.target.value);
                            updateCell(index, "tax_amount", raw);
                          }}
                          aria-label={FIELD_LABELS_MK.tax_amount}
                        />
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "tax_amount") != null ? `${Math.round(getFieldConfidence(inv, "tax_amount")! * 100)}%` : "—"}
                        </span>
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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "document_type") != null ? `${Math.round(getFieldConfidence(inv, "document_type")! * 100)}%` : "—"}
                        </span>
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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "currency") != null ? `${Math.round(getFieldConfidence(inv, "currency")! * 100)}%` : "—"}
                        </span>
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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "description") != null ? `${Math.round(getFieldConfidence(inv, "description")! * 100)}%` : "—"}
                        </span>
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.cardGrid}>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.seller_name}
                        <span className={styles.cardValue}>{getFieldValue(inv, "seller_name") || "—"}</span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "seller_name") != null ? `${Math.round(getFieldConfidence(inv, "seller_name")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.total_amount}
                        <span className={styles.cardValue}>
                          {(() => {
                            const val = getFieldValue(inv, "total_amount");
                            return val ? formatAmountForDisplay(val) : "—";
                          })()}
                        </span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "total_amount") != null ? `${Math.round(getFieldConfidence(inv, "total_amount")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.date}
                        <span className={styles.cardValue}>{getFieldValue(inv, "date") || "—"}</span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "date") != null ? `${Math.round(getFieldConfidence(inv, "date")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.invoice_number}
                        <span className={styles.cardValue}>{getFieldValue(inv, "invoice_number") || "—"}</span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "invoice_number") != null ? `${Math.round(getFieldConfidence(inv, "invoice_number")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.buyer_name}
                        <span className={isFieldEmpty(inv, "buyer_name") ? `${styles.cardValue} ${styles.cardValueInvalid}` : styles.cardValue}>
                          {getFieldValue(inv, "buyer_name") || "—"}
                        </span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "buyer_name") != null ? `${Math.round(getFieldConfidence(inv, "buyer_name")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.document_type}
                        <span className={styles.cardValue}>{getFieldValue(inv, "document_type") || "—"}</span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "document_type") != null ? `${Math.round(getFieldConfidence(inv, "document_type")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.currency}
                        <span className={styles.cardValue}>{getFieldValue(inv, "currency") || "—"}</span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "currency") != null ? `${Math.round(getFieldConfidence(inv, "currency")! * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.net_amount}
                        <span className={styles.cardValue}>
                          {(() => {
                            const val = getFieldValue(inv, "net_amount");
                            return val ? formatAmountForDisplay(val) : "—";
                          })()}
                        </span>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "net_amount") != null ? `${Math.round(getFieldConfidence(inv, "net_amount")! * 100)}%` : "—"}
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
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "tax_amount") != null ? `${Math.round(getFieldConfidence(inv, "tax_amount")! * 100)}%` : "—"}
                        </span>
                      </div>
                    </div>
                    <div className={styles.cardDescRow}>
                      <div className={styles.descLabel}>
                        {FIELD_LABELS_MK.description}
                        <div className={styles.cardValueBlock}>
                          {getFieldValue(inv, "description") || "—"}
                        </div>
                        <span className={styles.schemaFieldConfidence} title="Доверба (од моделот)">
                          {getFieldConfidence(inv, "description") != null ? `${Math.round(getFieldConfidence(inv, "description")! * 100)}%` : "—"}
                        </span>
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

      <footer className={styles.fixedFooter}>
        <div className={styles.footerInner}>
          <div>
            <h1 className={styles.footerTitle}>{MK.title}</h1>
            <p className={styles.footerSubtitle}>{MK.subtitleReady(invoices.length, batchDocLabel)}</p>
          </div>
          <div className={styles.footerActions}>
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
      </footer>

      {showExportDialog && (
        <ExcelExportDialog
          invoices={invoices}
          documentType={batchDocType}
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
          invoice={invoices[previewIndex]}
          documentType={batchDocType}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {previewFilePath && (
        <PreviewModal
          filePath={previewFilePath.path}
          fileName={previewFilePath.name}
          documentType={batchDocType}
          onClose={() => setPreviewFilePath(null)}
        />
      )}
    </div>
  );
}
