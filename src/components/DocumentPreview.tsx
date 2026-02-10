import { useState, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import styles from "./DocumentPreview.module.css";

interface DocumentPreviewProps {
  filePath: string;
  fileName: string;
  className?: string;
}

/** Check if file is PDF by extension */
function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

export function DocumentPreview({ filePath, fileName, className }: DocumentPreviewProps) {
  const [zoomOpen, setZoomOpen] = useState(false);

  const pdfUrl = useMemo(() => {
    if (!filePath) return null;
    try {
      return convertFileSrc(filePath);
    } catch {
      return null;
    }
  }, [filePath]);

  const canShowPdf = isPdf(filePath) && pdfUrl;

  const handlePreviewClick = () => {
    if (canShowPdf) setZoomOpen(true);
  };

  const handleCloseZoom = () => setZoomOpen(false);

  return (
    <>
      <div
        className={`${styles.preview} ${className ?? ""}`}
        role={canShowPdf ? "button" : undefined}
        tabIndex={canShowPdf ? 0 : undefined}
        onClick={canShowPdf ? handlePreviewClick : undefined}
        onKeyDown={
          canShowPdf
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handlePreviewClick();
                }
              }
            : undefined
        }
      >
        {canShowPdf ? (
          <div className={styles.previewFrame}>
            <embed
              src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1`}
              type="application/pdf"
              className={styles.embed}
              title={fileName}
            />
            <p className={styles.clickHint}>Click to zoom and review document</p>
          </div>
        ) : (
          <div className={styles.placeholder}>
            <p>Preview not available</p>
            <p className={styles.fileName}>{fileName}</p>
          </div>
        )}
      </div>

      {zoomOpen && canShowPdf && (
        <div
          className={styles.zoomOverlay}
          onClick={handleCloseZoom}
          role="dialog"
          aria-modal="true"
          aria-label="Document zoom view"
        >
          <div
            className={styles.zoomContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.zoomHeader}>
              <span className={styles.zoomTitle}>{fileName}</span>
              <button
                type="button"
                className={styles.zoomClose}
                onClick={handleCloseZoom}
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className={styles.zoomFrame}>
              <embed
                src={`${pdfUrl}#toolbar=1&navpanes=1`}
                type="application/pdf"
                className={styles.zoomEmbed}
                title={fileName}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
