import { useState, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { runOcrInvoice, addHistoryRecord, buildExtractedDataWithConfidence } from "@/services/api";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { invoiceDataToFields } from "@/utils/invoiceDataToFields";
import { logger } from "@/utils/logger";
import styles from "./DragDrop.module.css";

const ACCEPT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
];
const ACCEPT_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif"];

// Azure has payload size limits; reject obviously huge files from the HTML drag/drop
// path so the user gets a clear message before we call the backend.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const LOADING_HINTS = [
  { icon: "🔢", label: "Se analizira broj…" },
  { icon: "📝", label: "Se analizira tekst…" },
  { icon: "💬", label: "Se analizira opis…" },
  { icon: "💱", label: "Se analizira currency…" },
];

function isAcceptedFile(file: File): boolean {
  if (ACCEPT_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return ACCEPT_EXT.some((ext) => name.endsWith(ext));
}

function isAcceptedPath(path: string): boolean {
  const name = path.toLowerCase();
  return ACCEPT_EXT.some((ext) => name.endsWith(ext));
}

export function DragDrop() {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const { setScreen, setReview, defaultDocumentType, defaultFolderId } = useApp();
  const { error: showError } = useToast();

  const processFile = useCallback(
    async (filePath: string, fileName: string) => {
      setLoading(true);
      const scanId =
        (typeof crypto !== "undefined" && "randomUUID" in crypto && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2));
      try {
        // Pass document type to OCR so it can select the appropriate model
        const docTypeForOcr = defaultDocumentType ?? "faktura";
        logger.info("scan:start", { scanId, filePath, documentType: docTypeForOcr });
        const invoiceData = await runOcrInvoice(filePath, docTypeForOcr);
        const fields = invoiceDataToFields(invoiceData);
        // Use the user-selected/default document type for layout,
        // so misclassified OCR labels (e.g. "Даночен биланс" on an invoice)
        // do not switch the review screen to the wrong schema.
        const docType = docTypeForOcr;
        const extractedData = buildExtractedDataWithConfidence(fields);
        let historyId: number | null = null;
        try {
          historyId = await addHistoryRecord({
            document_type: docType,
            file_path_or_name: fileName,
            extracted_data: extractedData,
            status: "pending",
            folder_id: defaultFolderId ?? undefined,
          });
        } catch {
          // non-fatal
        }
        const contentSummary = Object.entries(invoiceData.fields)
          .map(([k, v]) => `${k}: ${v.value}`)
          .join("\n");
        const documentCount = (invoiceData as any)._document_count as number | undefined;
        logger.info("scan:success", {
          scanId,
          filePath,
          documentType: docType,
          historyId,
          fieldCount: Object.keys(invoiceData.fields ?? {}).length,
          documentCount: documentCount ?? 1,
        });
        const maybeMultipleDocuments = documentCount != null && documentCount > 1;
        setReview({
          filePath,
          fileName,
          ocrResult: { lines: [], content: contentSummary },
          documentType: docType,
          fields,
          historyId,
          maybeMultipleDocuments,
        });
        setScreen("review");
      } catch (e) {
        logger.error("scan:error", {
          scanId,
          filePath,
          error: e instanceof Error ? e.message : String(e),
        });
        showError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [setReview, setScreen, showError, defaultDocumentType, defaultFolderId]
  );

  useEffect(() => {
    if (!loading) {
      setHintIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setHintIndex((prev) => (prev + 1) % LOADING_HINTS.length);
    }, 1800);
    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        setDragging(true);
      } else if (event.payload.type === "leave") {
        setDragging(false);
      } else if (event.payload.type === "drop") {
        setDragging(false);
        const paths = event.payload.paths;
        if (paths?.length > 0) {
          const filePath = paths[0];
          if (isAcceptedPath(filePath)) {
            const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
            processFile(filePath, fileName);
          } else {
            showError("Please drop a PDF or image (JPG, PNG, TIFF).");
          }
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [processFile, showError]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file || !isAcceptedFile(file)) {
        showError("Please drop a PDF or image (JPG, PNG, TIFF).");
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        showError("Фајлот е преголем за скенирање. Намали ја големината или скенирај помал документ.");
        return;
      }
      const path = (file as File & { path?: string }).path;
      if (path) {
        await processFile(path, file.name);
      } else {
        showError("Could not get file path. Use 'Click to browse' instead.");
      }
    },
    [processFile, showError]
  );

  const handleBrowse = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Documents",
          extensions: ["pdf", "jpg", "jpeg", "png", "tiff", "tif"],
        },
      ],
    });
    if (selected && typeof selected === "string") {
      const fileName = selected.split(/[/\\]/).pop() ?? selected;
      await processFile(selected, fileName);
    }
  }, [processFile]);

  return (
    <div
      className={`${styles.zone} ${dragging ? styles.dragging : ""} ${loading ? styles.loading : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {loading ? (
        <div className={styles.loadingContent}>
          <div className={styles.scanner} aria-hidden="true">
            <div className={styles.scannerGrid} />
            <div className={styles.scannerGlow} />
            <div className={styles.scanLine} />
          </div>
          <div className={styles.loadingText}>
            <div className={styles.spinner} aria-hidden="true" />
            <div>
              <p className={styles.loadingTitle}>Analiziramo fakturu…</p>
              <p className={styles.loadingHint} aria-live="polite">
                <span className={styles.hintIcon} aria-hidden="true">
                  {LOADING_HINTS[hintIndex].icon}
                </span>
                {LOADING_HINTS[hintIndex].label}
              </p>
            </div>
          </div>
          <div className={styles.progressDots} aria-hidden="true">
            {LOADING_HINTS.map((_, index) => (
              <span
                key={index}
                className={`${styles.dot} ${index === hintIndex ? styles.dotActive : ""}`}
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          <svg
            className={styles.uploadIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className={styles.title}>Drop a document here</p>
          <p className={styles.sub}>PDF, JPG, PNG, or TIFF</p>
          <button type="button" className={styles.browse} onClick={handleBrowse}>
            Choose file
          </button>
        </>
      )}
    </div>
  );
}
