import { useEffect, useState } from "react";
import { getExcelHeaders } from "@/services/api";
import type { ExcelHeaderItem } from "@/services/api";
import styles from "./ExcelHeaderPreview.module.css";

export interface ExcelHeaderPreviewProps {
  /** Pre-fetched headers (from parent). If not provided, component will fetch when fetch props are set. */
  headers?: ExcelHeaderItem[];
  /** When headers not provided: path to Excel file (local). */
  excelPath?: string;
  /** When headers not provided: worksheet name. */
  worksheetName?: string;
  /** When headers not provided: 1-based header row. */
  headerRow?: number;
  /** Display name for the file (e.g. file name only). */
  fileName?: string;
  /** Column letters that are mapped (highlighted in green). */
  mappedColumns?: Set<string>;
  /** Currently selected column letter (e.g. from click). */
  selectedColumn?: string | null;
  /** Called when user clicks a column. */
  onSelectColumn?: (letter: string | null) => void;
}

export function ExcelHeaderPreview({
  headers: headersProp,
  excelPath,
  worksheetName,
  headerRow = 1,
  fileName,
  mappedColumns,
  selectedColumn,
  onSelectColumn,
}: ExcelHeaderPreviewProps) {
  const [headers, setHeaders] = useState<ExcelHeaderItem[]>(headersProp ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shouldFetch = !headersProp && excelPath && worksheetName;

  useEffect(() => {
    if (!shouldFetch) {
      if (headersProp) setHeaders(headersProp);
      return;
    }
    setLoading(true);
    setError(null);
    getExcelHeaders(excelPath!, worksheetName!, headerRow)
      .then(setHeaders)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [shouldFetch, excelPath, worksheetName, headerRow, headersProp]);

  const displayHeaders = headersProp ?? headers;
  const mappedSet = mappedColumns ?? new Set<string>();

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.loading}>Reading Excel file from your computer…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  if (displayHeaders.length === 0) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.empty}>No headers found.</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.meta}>
        {fileName != null && (
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Excel file:</span> {fileName}
          </div>
        )}
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Worksheet:</span> {worksheetName ?? "—"}
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Headers found at:</span> Row {headerRow}
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {displayHeaders.map((h) => (
                <th
                  key={h.columnIndex}
                  className={`${styles.th} ${mappedSet.has(h.columnLetter) ? styles.mapped : ""} ${selectedColumn === h.columnLetter ? styles.selected : ""}`}
                  onClick={() => onSelectColumn?.(h.columnLetter)}
                  title={mappedSet.has(h.columnLetter) ? `Mapped (${h.columnLetter})` : `Column ${h.columnLetter}`}
                >
                  <span className={styles.colLetter}>{h.columnLetter}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {displayHeaders.map((h) => (
                <td
                  key={h.columnIndex}
                  className={`${styles.td} ${mappedSet.has(h.columnLetter) ? styles.mapped : ""} ${selectedColumn === h.columnLetter ? styles.selected : ""}`}
                  onClick={() => onSelectColumn?.(h.columnLetter)}
                  title={h.headerText || "(empty)"}
                >
                  {h.headerText?.trim() || "(empty)"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
