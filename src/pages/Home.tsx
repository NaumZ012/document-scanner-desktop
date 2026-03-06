import { useState, useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Receipt, Calculator, Percent, CreditCard, Upload, FileText, X, LucideIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { runOcrInvoice, addHistoryRecord, buildExtractedDataFromInvoiceFields } from "@/services/api";
import { DOCUMENT_TYPE_CHOICES } from "@/shared/constants";
import type { DocumentType, InvoiceData } from "@/shared/types";
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
  const [dropZoneActive, setDropZoneActive] = useState(false);
  const scanInProgressRef = useRef(false);

  const effectiveDocumentType: DocumentType = chosenDocumentType ?? defaultDocumentType ?? "generic";

  const addPdfPaths = useCallback((paths: string[]) => {
    const pdfOnly = paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
    if (pdfOnly.length === 0) return;
    setSelectedFiles((prev) => {
      const combined = [...prev];
      for (const p of pdfOnly) {
        if (!combined.includes(p)) combined.push(p);
      }
      return combined;
    });
  }, []);

  const handleSelectPdfs = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    addPdfPaths(paths);
  }, [addPdfPaths]);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onDragDropEvent((event) => {
      if (event.payload.type === "enter") setDropZoneActive(true);
      else if (event.payload.type === "leave") setDropZoneActive(false);
      else if (event.payload.type === "drop") {
        setDropZoneActive(false);
        const paths = event.payload.paths ?? [];
        addPdfPaths(paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addPdfPaths]);

  const removeFile = useCallback((path: string) => {
    setSelectedFiles((prev) => prev.filter((p) => p !== path));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  const handleScanAll = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    if (scanInProgressRef.current) return;
    scanInProgressRef.current = true;
    setIsProcessing(true);
    try {
      const successes: (InvoiceData & { source_file?: string; source_file_path?: string; _document_count?: number })[] = [];
      const failures: { file_path: string; file_name: string; error: string }[] = [];
      let firstNavigated = false;
      const CONCURRENCY = 4;
      let index = 0;

      const processNext = async () => {
        // Simple work queue: grab next index until we exhaust selectedFiles.
        // JS is single-threaded so this increment is safe enough here.
        const current = index;
        if (current >= selectedFiles.length) return;
        index += 1;
        const path = selectedFiles[current];
        const fileName = getFileName(path);
        try {
          const invoiceData = await runOcrInvoice(path, effectiveDocumentType);
          const docType = invoiceData.fields.document_type?.value ?? effectiveDocumentType;
          const extractedData = buildExtractedDataFromInvoiceFields(invoiceData.fields);
          try {
            await addHistoryRecord({
              document_type: docType,
              file_path_or_name: fileName,
              extracted_data: extractedData,
              status: "pending",
              folder_id: defaultFolderId ?? undefined,
            });
          } catch {
            // history failure is non-fatal
          }
          successes.push({
            ...invoiceData,
            source_file: fileName,
            source_file_path: path,
          });
          // Sort so PDFs that likely contain multiple documents (Azure detected >1 document)
          // are shown last in the scanned list on BatchReview.
          const sortedSuccesses = [...successes].sort((a: any, b: any) => {
            const aMulti = (a._document_count ?? 1) > 1;
            const bMulti = (b._document_count ?? 1) > 1;
            if (aMulti === bMulti) return 0;
            return aMulti ? 1 : -1;
          });
          setBatchInvoices(sortedSuccesses as any);
          setBatchFailures([...failures] as any);
          if (!firstNavigated) {
            firstNavigated = true;
            setScreen("batchReview");
          }
        } catch (e) {
          failures.push({
            file_path: path,
            file_name: fileName,
            error: e instanceof Error ? e.message : String(e),
          });
          setBatchFailures([...failures] as any);
        }
        // Recurse to pick up the next job in this worker.
        await processNext();
      };

      const workers: Promise<void>[] = [];
      const workerCount = Math.min(CONCURRENCY, selectedFiles.length);
      for (let i = 0; i < workerCount; i += 1) {
        workers.push(processNext());
      }
      await Promise.all(workers);

      if (failures.length > 0) {
        const summary = `${successes.length} од ${selectedFiles.length} документи успешно скенирани. ${failures.length} неуспешни.`;
        if (successes.length === 0 && failures[0]) {
          showError(`${summary} Грешка: ${failures[0].error}`);
        } else {
          showSuccess(summary);
        }
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      scanInProgressRef.current = false;
      setIsProcessing(false);
    }
  }, [selectedFiles, setBatchInvoices, setScreen, showError, showSuccess, effectiveDocumentType, defaultFolderId]);

  if (chosenDocumentType == null) {
    const typeDescriptions: Record<string, string> = {
      faktura: "Фактури, испратници, кредитни белешки",
      smetka: "Даночен биланс на добивка",
      generic: "ДДВ пријави и поврат на данок",
      plata: "Плати и трошоци за вработени",
    };
    return (
      <div className={styles.landingPage}>
        <div className={styles.hero}>
          <h1 className={styles.landingTitle}>Document Scanner</h1>
          <p className={styles.landingSubtitle}>
            Изберете тип на документ за скенирање
          </p>
        </div>
        <div className={styles.typeGrid} role="list" aria-label="Тип на документ">
          {DOCUMENT_TYPE_CHOICES.map(({ id, label, icon }) => {
            const IconComponent = ICON_MAP[icon] || Receipt;
            const description = typeDescriptions[id];
            return (
              <button
                key={id}
                type="button"
                className={styles.typeCard}
                onClick={() => setChosenDocumentType(id)}
                role="listitem"
                aria-describedby={description ? `desc-${id}` : undefined}
              >
                <span className={styles.typeCardIcon} aria-hidden>
                  <IconComponent size={40} strokeWidth={1.8} />
                </span>
                <span className={styles.typeCardLabel}>{label}</span>
                {description && (
                  <span id={`desc-${id}`} className={styles.typeCardDesc}>
                    {description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageContent}>
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
          <h1 className={styles.title}>Document Scanner</h1>
          <p className={styles.subtitle}>
            {selectedFiles.length === 0
              ? "Додајте документи за скенирање"
              : "Подгответе ги документите за скенирање"}
          </p>
        </div>
        {selectedFiles.length > 0 ? (
          <div className={styles.fileListWrap}>
            <div className={styles.fileSectionHeader}>
              <span className={styles.fileCount}>
                {selectedFiles.length} документ{selectedFiles.length === 1 ? "" : "и"} избрани
              </span>
              <button
                type="button"
                className={styles.clearButton}
                onClick={clearAll}
                disabled={isProcessing}
              >
                Исчисти ги сите
              </button>
            </div>
            <ul className={styles.fileList} role="list">
              {selectedFiles.map((path) => {
                const name = getFileName(path);
                return (
                  <li key={path} className={styles.fileItem}>
                    <span className={styles.fileItemIcon} aria-hidden>
                      <FileText size={22} strokeWidth={2} />
                    </span>
                    <span
                      className={styles.fileName}
                      title={name}
                    >
                      {name}
                    </span>
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeFile(path)}
                      disabled={isProcessing}
                      aria-label={`Отстрани ${name}`}
                      title="Отстрани од листата"
                    >
                      <X size={18} strokeWidth={2.5} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div
            className={`${styles.dropZone} ${dropZoneActive ? styles.dropZoneActive : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropZoneActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZoneActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropZoneActive(false);
              const items = e.dataTransfer?.items;
              if (!items) return;
              const paths: string[] = [];
              for (let i = 0; i < items.length; i++) {
                const file = items[i].getAsFile();
                if (!file) continue;
                const path = (file as File & { path?: string }).path;
                if (path && file.name.toLowerCase().endsWith(".pdf")) paths.push(path);
              }
              addPdfPaths(paths);
            }}
            role="region"
            aria-label="Додај PDF документи"
          >
            <Upload className={styles.dropZoneIcon} size={48} strokeWidth={1.6} aria-hidden />
            <p className={styles.dropZoneTitle}>Додај документи или повлеци</p>
            <p className={styles.dropZoneSub}>Повлечете PDF датотеки тука или изберете со копчето подолу</p>
            <button
              type="button"
              className={styles.dropZoneButton}
              onClick={handleSelectPdfs}
              disabled={isProcessing}
            >
              Додај документи
            </button>
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.footerButtonSecondary}
          onClick={handleSelectPdfs}
          disabled={isProcessing}
        >
          Додај уште
        </button>
        <button
          type="button"
          className={styles.footerButtonPrimary}
          onClick={handleScanAll}
          disabled={isProcessing || selectedFiles.length === 0}
        >
          {isProcessing ? "Скенира…" : "Скенирај"}
        </button>
      </footer>

      {isProcessing && (
        <div className={styles.scanOverlay} aria-live="polite">
          <div className={styles.scanOverlayContent}>
            <div className={styles.scanSpinner} aria-hidden="true" />
            <p className={styles.scanOverlayText}>
              Scanning
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
