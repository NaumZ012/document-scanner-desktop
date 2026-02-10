import { CheckCircle2 } from "lucide-react";
import type { ExcelSchemaFull } from "@/services/api";
import styles from "./ExcelSchemaPreview.module.css";

interface ExcelSchemaPreviewProps {
  schema: ExcelSchemaFull;
}

export function ExcelSchemaPreview({ schema }: ExcelSchemaPreviewProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Excel file summary</h3>
        <div className={styles.grid}>
          <div>
            <span className={styles.label}>Headers at:</span>
            <span className={styles.value}>Row {schema.headerRow}</span>
          </div>
          <div>
            <span className={styles.label}>Total columns:</span>
            <span className={styles.value}>{schema.headers.length}</span>
          </div>
          <div>
            <span className={styles.label}>Last data row:</span>
            <span className={styles.value}>Row {schema.lastDataRow}</span>
          </div>
          <div>
            <span className={styles.label}>Next free row:</span>
            <span className={styles.valueHighlight}>Row {schema.nextFreeRow}</span>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          Detected columns ({schema.columns.length})
        </h3>
        <div className={styles.columnList}>
          {schema.columns.map((col) => (
            <div
              key={col.columnLetter}
              className={styles.columnRow}
              style={{ backgroundColor: col.backgroundColor || "transparent" }}
            >
              <span className={styles.columnBadge}>{col.columnLetter}</span>
              <div className={styles.columnInfo}>
                <p
                  className={styles.columnHeader}
                  style={{
                    fontFamily: col.fontName || "inherit",
                    fontSize: `${col.fontSize ?? 11}px`,
                  }}
                >
                  {col.headerText}
                </p>
                <p className={styles.columnType}>Type: {col.dataType}</p>
              </div>
              <CheckCircle2 className={styles.check} aria-hidden />
            </div>
          ))}
        </div>
      </div>

      <div className={styles.infoCard}>
        <p className={styles.infoText}>
          <strong>Design preserved:</strong> Formatting (fonts, colors, borders)
          has been captured and will be applied to new rows automatically.
        </p>
      </div>
    </div>
  );
}
