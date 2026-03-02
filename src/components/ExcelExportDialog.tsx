import { useState, useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  exportInvoicesToNewExcel,
  exportToNewExcelWithColumns,
  copyTemplateAndFillTaxBalance,
} from "@/services/api";
import { useToast } from "@/context/ToastContext";
import type { InvoiceData } from "@/shared/types";
import { normalizeDocumentType, getSchemaForDocumentType } from "@/shared/documentTypeSchemas";
import styles from "./ExcelExportDialog.module.css";

const MK = {
  title: "Извези во Excel",
  export: "Извези",
  cancel: "Откажи",
  exporting: "Се извезува…",
  chooseLocation: "Избери локација за нова датотека",
  notSupportedForType: "За Даночен биланс, овој екран поддржува извоз само кога има еден документ. Отстранете ги останатите или користете Преглед.",
} as const;

export interface ExcelExportDialogProps {
  invoices: InvoiceData[];
  onClose: () => void;
  onExportComplete: (path: string) => void;
  /** Document type label/id from OCR (used to filter profiles). */
  documentType?: string;
}

export function ExcelExportDialog({
  invoices,
  onClose,
  onExportComplete,
  documentType,
}: ExcelExportDialogProps) {
  const { error: showError, success: showSuccess } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (invoices.length === 0) return;
    setExporting(true);
    try {
      const dt = normalizeDocumentType(documentType);
      const defaultNameBase =
        dt === "smetka"
          ? "Даночен_биланс"
          : dt === "generic"
          ? "ДДВ"
          : dt === "plata"
          ? "Плати"
          : "Фактури";
      const defaultName = `${defaultNameBase}_${new Date().toISOString().slice(0, 10)}_${Date.now()
        .toString()
        .slice(-6)}.xlsx`;
      const path = await save({
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
        defaultPath: defaultName,
        title: MK.chooseLocation,
      });
      if (path == null) return;

      if (dt === "faktura") {
        // Invoices: existing structured export (fixed column order).
        const savedPath = await exportInvoicesToNewExcel(invoices, path, "Invoices");
        onExportComplete(savedPath);
      } else if (dt === "generic" || dt === "plata") {
        // ДДВ и Плати: build a fixed-column workbook from the document-type schema.
        const schema = getSchemaForDocumentType(dt);
        const headers = schema.fields.map((f) => f.label);
        const columnFieldKeys = schema.fields.map((f) => f.key);
        const savedPath = await exportToNewExcelWithColumns(
          path,
          schema.title,
          headers,
          columnFieldKeys,
          invoices
        );
        onExportComplete(savedPath);
      } else if (dt === "smetka") {
        // Даночен биланс: support export from batch screen only when there is a single document,
        // mirroring the behavior from Преглед (one Excel form per scan).
        if (invoices.length !== 1) {
          showError(MK.notSupportedForType);
          setExporting(false);
          return;
        }
        const invoice = invoices[0]!;
        const savedPath = await copyTemplateAndFillTaxBalance(0, path, invoice);
        onExportComplete(savedPath);
      }
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [invoices, onExportComplete, onClose, showError, documentType]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
      <div className={styles.modal}>
        <h2 id="export-dialog-title" className={styles.title}>
          {MK.title}
        </h2>

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={exporting}>
            {MK.cancel}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? MK.exporting : MK.export}
          </button>
        </div>
      </div>
    </div>
  );
}
