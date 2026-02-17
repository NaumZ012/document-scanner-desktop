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

/** Check if file is an image by extension */
function isImage(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || 
         lower.endsWith(".png") || lower.endsWith(".gif") || 
         lower.endsWith(".bmp") || lower.endsWith(".webp");
}

export function DocumentPreview({ filePath, fileName, className }: DocumentPreviewProps) {
  const [zoomOpen, setZoomOpen] = useState(false);

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
  const canPreview = canShowPdf || canShowImage;

  const handlePreviewClick = () => {
    if (canPreview) setZoomOpen(true);
  };

  const handleCloseZoom = () => setZoomOpen(false);

  return (
    <>
      <div
        className={`${styles.preview} ${className ?? ""}`}
        role={canPreview ? "button" : undefined}
        tabIndex={canPreview ? 0 : undefined}
        onClick={canPreview ? handlePreviewClick : undefined}
        onKeyDown={
          canPreview
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
            <iframe
              src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=1`}
              className={styles.embed}
              title={fileName}
            />
            <p className={styles.clickHint}>Click to zoom and review document</p>
          </div>
        ) : canShowImage ? (
          <div className={styles.previewFrame}>
            <img
              src={fileUrl!}
              alt={fileName}
              className={styles.imagePreview}
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

      {zoomOpen && canPreview && (
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
              {canShowPdf ? (
                <iframe
                  src={`${fileUrl}#toolbar=1&navpanes=1`}
                  className={styles.zoomEmbed}
                  title={fileName}
                />
              ) : canShowImage ? (
                <img
                  src={fileUrl!}
                  alt={fileName}
                  className={styles.zoomImage}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
