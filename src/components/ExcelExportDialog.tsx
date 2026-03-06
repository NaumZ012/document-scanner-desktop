import { useState, useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  exportInvoicesToNewExcel,
  exportToNewExcelWithColumns,
  writeFileBase64,
} from "@/services/api";
import { exportPlataToNewTableBuffer } from "@/services/plataExportExcelJS";
import { exportTaxBalanceToNewTableBuffer } from "@/services/taxBalanceExportExcelJS";
import { useToast } from "@/context/ToastContext";
import type { InvoiceData } from "@/shared/types";
import {
  normalizeDocumentType,
  getSchemaForDocumentType,
  DDV_EXCEL_COLUMN_KEYS,
  DDV_EXCEL_HEADERS,
} from "@/shared/documentTypeSchemas";
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
  const { error: showError } = useToast();
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
      // CRITICAL: Always .xlsx — never CSV. Normalize path so output is always Excel binary.
      const savePath = path.toLowerCase().endsWith(".xlsx") ? path : `${path.replace(/\.[^.]*$/i, "")}.xlsx`;

      if (dt === "faktura") {
        const savedPath = await exportInvoicesToNewExcel(invoices, savePath, "Invoices");
        onExportComplete(savedPath);
      } else if (dt === "plata") {
        // Плати: new workbook with only the payroll table (no logo, legend, or metadata). Values only to avoid Excel repair issues.
        const resultBase64 = await exportPlataToNewTableBuffer(invoices);
        await writeFileBase64(savePath, resultBase64);
        onExportComplete(savePath);
      } else if (dt === "generic") {
        const schema = getSchemaForDocumentType(dt);
        const savedPath = await exportToNewExcelWithColumns(
          savePath,
          schema.title,
          DDV_EXCEL_HEADERS,
          DDV_EXCEL_COLUMN_KEYS,
          invoices
        );
        onExportComplete(savedPath);
      } else if (dt === "smetka") {
        if (invoices.length !== 1) {
          showError(MK.notSupportedForType);
          setExporting(false);
          return;
        }
        const invoice = invoices[0]!;
        const resultBase64 = await exportTaxBalanceToNewTableBuffer(invoice);
        await writeFileBase64(savePath, resultBase64);
        onExportComplete(savePath);
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
