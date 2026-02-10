import { useCallback, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { scanExcelSchema } from "@/services/api";
import type { ExcelSchemaFull } from "@/services/api";
import styles from "./ExcelDropZone.module.css";

interface ExcelDropZoneProps {
  onSchemaLoaded: (schema: ExcelSchemaFull) => void;
  worksheetName?: string;
}

export function ExcelDropZone({
  onSchemaLoaded,
  worksheetName = "Sheet1",
}: ExcelDropZoneProps) {
  const [isScanning, setIsScanning] = useState(false);

  const handleFileSelect = useCallback(async () => {
    try {
      const selected = await open({
        filters: [{ name: "Excel Files", extensions: ["xlsx", "xls"] }],
        multiple: false,
      });

      if (!selected || typeof selected !== "string") {
        return;
      }

      await scanExcelFile(selected);
    } catch (err) {
      console.error("File selection error:", err);
    }
  }, [worksheetName]);

  const scanExcelFile = async (filePath: string) => {
    setIsScanning(true);
    try {
      const schema = await scanExcelSchema(filePath, worksheetName);
      onSchemaLoaded(schema);
    } catch (err) {
      console.error("Scan error:", err);
      throw err;
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleFileSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleFileSelect()}
      className={`${styles.zone} ${isScanning ? styles.zoneScanning : ""}`}
    >
      <div className={styles.content}>
        {isScanning ? (
          <Loader2 className={styles.icon} aria-hidden />
        ) : (
          <FileSpreadsheet className={styles.icon} aria-hidden />
        )}
        <div>
          <p className={styles.title}>
            {isScanning ? "Scanning Excel file…" : "Select Excel file"}
          </p>
          <p className={styles.subtitle}>
            Click to browse for .xlsx or .xls file
          </p>
        </div>
        {!isScanning && (
          <p className={styles.hint}>
            Structure and formatting will be analyzed
          </p>
        )}
      </div>
    </div>
  );
}
