import { useState, useCallback, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  exportInvoicesToNewExcel,
  appendInvoicesToExistingExcel,
  getSheetNames,
} from "@/services/api";
import { useToast } from "@/context/ToastContext";
import type { InvoiceData } from "@/shared/types";
import styles from "./ExcelExportDialog.module.css";

const MK = {
  title: "Извези во Excel",
  modeNew: "Креирај нова датотека",
  modeExisting: "Додај во постоечка датотека",
  worksheetName: "Име на лист",
  worksheetNamePlaceholder: "На пр. Invoices",
  selectFile: "Избери Excel датотека",
  sheet: "Лист",
  headerRow: "Ред на наслови (1-based)",
  export: "Извези",
  cancel: "Откажи",
  exporting: "Се извезува…",
  noFileSelected: "Избери Excel датотека за да продолжиш.",
  chooseLocation: "Избери локација за нова датотека",
} as const;

export interface ExcelExportDialogProps {
  invoices: InvoiceData[];
  onClose: () => void;
  onExportComplete: (path: string) => void;
}

export function ExcelExportDialog({
  invoices,
  onClose,
  onExportComplete,
}: ExcelExportDialogProps) {
  const { error: showError } = useToast();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [worksheetName, setWorksheetName] = useState("Invoices");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (mode === "existing" && selectedFilePath && sheetNames.length > 0 && !selectedSheet) {
      setSelectedSheet(sheetNames[0]);
    }
  }, [mode, selectedFilePath, sheetNames, selectedSheet]);

  const handleSelectFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    });
    if (selected && typeof selected === "string") {
      setSelectedFilePath(selected);
      setSelectedSheet("");
      setLoadingSheets(true);
      getSheetNames(selected)
        .then((names) => {
          setSheetNames(names);
          if (names.length > 0) setSelectedSheet(names[0]);
        })
        .catch(() => setSheetNames([]))
        .finally(() => setLoadingSheets(false));
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (invoices.length === 0) return;
    setExporting(true);
    try {
      if (mode === "new") {
        const defaultName = `Фактури_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-6)}.xlsx`;
        const path = await save({
          filters: [{ name: "Excel", extensions: ["xlsx"] }],
          defaultPath: defaultName,
          title: MK.chooseLocation,
        });
        if (path == null) return;
        const savedPath = await exportInvoicesToNewExcel(
          invoices,
          path,
          worksheetName.trim() || "Invoices"
        );
        onExportComplete(savedPath);
      } else {
        if (!selectedFilePath.trim()) {
          showError(MK.noFileSelected);
          return;
        }
        await appendInvoicesToExistingExcel(
          selectedFilePath,
          selectedSheet || sheetNames[0] || "Sheet1",
          headerRow >= 1 ? headerRow : 1,
          invoices
        );
        onExportComplete(selectedFilePath);
      }
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [
    mode,
    invoices,
    worksheetName,
    selectedFilePath,
    selectedSheet,
    sheetNames,
    headerRow,
    onExportComplete,
    onClose,
    showError,
  ]);

  const canExport =
    mode === "new" || (mode === "existing" && selectedFilePath && (selectedSheet || sheetNames.length === 0));

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
      <div className={styles.modal}>
        <h2 id="export-dialog-title" className={styles.title}>
          {MK.title}
        </h2>

        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="exportMode"
              checked={mode === "new"}
              onChange={() => setMode("new")}
              className={styles.radio}
            />
            {MK.modeNew}
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="exportMode"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              className={styles.radio}
            />
            {MK.modeExisting}
          </label>
        </div>

        {mode === "new" && (
          <div className={styles.field}>
            <label className={styles.label}>{MK.worksheetName}</label>
            <input
              type="text"
              className={styles.input}
              value={worksheetName}
              onChange={(e) => setWorksheetName(e.target.value)}
              placeholder={MK.worksheetNamePlaceholder}
              aria-label={MK.worksheetName}
            />
          </div>
        )}

        {mode === "existing" && (
          <>
            <div className={styles.field}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleSelectFile}
                disabled={loadingSheets}
              >
                {loadingSheets ? "…" : MK.selectFile}
              </button>
              {selectedFilePath && (
                <span className={styles.filePath}>
                  {selectedFilePath.split(/[/\\]/).pop() ?? selectedFilePath}
                </span>
              )}
            </div>
            {sheetNames.length > 0 && (
              <div className={styles.field}>
                <label className={styles.label}>{MK.sheet}</label>
                <select
                  className={styles.select}
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  aria-label={MK.sheet}
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label className={styles.label}>{MK.headerRow}</label>
              <input
                type="number"
                min={1}
                className={styles.inputNumber}
                value={headerRow}
                onChange={(e) => setHeaderRow(Math.max(1, parseInt(e.target.value, 10) || 1))}
                aria-label={MK.headerRow}
              />
            </div>
          </>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={exporting}>
            {MK.cancel}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleExport}
            disabled={exporting || !canExport}
          >
            {exporting ? MK.exporting : MK.export}
          </button>
        </div>
      </div>
    </div>
  );
}
