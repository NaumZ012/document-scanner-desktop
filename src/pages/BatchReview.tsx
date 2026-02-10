import { useState, useEffect, useCallback } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { ExcelExportDialog } from "@/components/ExcelExportDialog";
import { FIELD_LABELS_MK } from "@/shared/constants";
import type { InvoiceData } from "@/shared/types";
import styles from "./BatchReview.module.css";

const MK = {
  delete: "Избриши",
  edit: "Измени",
  save: "Зачувај",
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
  reviewed: "Прегледано",
  markReviewed: "Означи како прегледано",
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

export function BatchReview() {
  const { batchInvoices, setBatchInvoices, setScreen, confirmBeforeExport } = useApp();
  const { success: showSuccess, error: showError } = useToast();
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [exportSuccessPath, setExportSuccessPath] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<Set<number>>(new Set());
  const [editingCards, setEditingCards] = useState<Set<number>>(new Set());

  useEffect(() => {
    setInvoices(batchInvoices ?? []);
  }, [batchInvoices]);

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
    setReviewedIds((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i === index) return;
        next.add(i > index ? i - 1 : i);
      });
      return next;
    });
    setEditingCards((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i === index) return;
        next.add(i > index ? i - 1 : i);
      });
      return next;
    });
  }, []);

  const toggleReviewed = useCallback((index: number) => {
    setReviewedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

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
    setScreen("home");
  }, [setBatchInvoices, setScreen]);

  const handleScanMore = useCallback(() => {
    setBatchInvoices(null);
    setScreen("home");
  }, [setBatchInvoices, setScreen]);

  if (batchInvoices == null || batchInvoices.length === 0) {
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
            const total = getFieldValue(inv, "total_amount");
            const reviewed = reviewedIds.has(index);
            const isEditing = editingCards.has(index);
            const cardClass = reviewed
              ? `${styles.card} ${styles.cardReviewed}`
              : styles.card;

            return (
              <article key={index} className={cardClass} data-index={index}>
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
                    <button
                      type="button"
                      className={isEditing ? styles.primaryButton : styles.secondaryButton}
                      onClick={() => (isEditing ? saveEdit(index) : startEdit(index))}
                    >
                      {isEditing ? MK.save : MK.edit}
                    </button>
                    <button
                      type="button"
                      className={styles.checkmarkBtn}
                      onClick={() => toggleReviewed(index)}
                      title={reviewed ? MK.reviewed : MK.markReviewed}
                      aria-pressed={reviewed}
                    >
                      {reviewed ? "✓" : "○"}
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
                          value={getFieldValue(inv, "total_amount")}
                          onChange={(e) => updateCell(index, "total_amount", e.target.value)}
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
                          value={getFieldValue(inv, "net_amount")}
                          onChange={(e) => updateCell(index, "net_amount", e.target.value)}
                          aria-label={FIELD_LABELS_MK.net_amount}
                        />
                      </label>
                      <label className={styles.gridLabel}>
                        {FIELD_LABELS_MK.tax_amount}
                        <input
                          type="text"
                          className={`${styles.input} ${styles.inputNumber}`}
                          value={getFieldValue(inv, "tax_amount")}
                          onChange={(e) => updateCell(index, "tax_amount", e.target.value)}
                          aria-label={FIELD_LABELS_MK.tax_amount}
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
                        <span className={styles.cardValue}>{getFieldValue(inv, "total_amount") || "—"}</span>
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
                        {FIELD_LABELS_MK.net_amount}
                        <span className={styles.cardValue}>{getFieldValue(inv, "net_amount") || "—"}</span>
                      </div>
                      <div className={styles.gridLabel}>
                        {FIELD_LABELS_MK.tax_amount}
                        <span className={styles.cardValue}>{getFieldValue(inv, "tax_amount") || "—"}</span>
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
    </div>
  );
}
