import ExcelJS from "exceljs";
import { readFileBase64, writeFileBase64, copyFile, deleteFile, appendRowToExcel } from "@/services/api";
import type { FieldMapping } from "./mappingService";
import type { ColumnMetadata } from "@/shared/types";
import { colIndexToLetter } from "@/utils/matching";
import { COLUMN_KEY_PREFIX, formatNumberForExcel } from "@/utils/fieldUtils";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Read Excel file from path (via backend) and return as ArrayBuffer.
 */
export async function readExcelAsBuffer(path: string): Promise<ArrayBuffer> {
  const base64 = await readFileBase64(path);
  return base64ToArrayBuffer(base64);
}

/**
 * Write Excel buffer to path (via backend).
 */
export async function writeExcelBuffer(path: string, buffer: ArrayBuffer): Promise<void> {
  const base64 = arrayBufferToBase64(buffer);
  await writeFileBase64(path, base64);
}

/**
 * Load workbook from buffer (ExcelJS).
 */
export async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as Buffer);
  return workbook;
}

/**
 * Save workbook to ArrayBuffer (ExcelJS).
 */
export async function saveWorkbook(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export interface WriteResult {
  success: boolean;
  rowNumber: number;
}

/**
 * Append one row via backend only (no frontend Excel load). Avoids OOM on large workbooks.
 * Builds row from mapping + data and calls append_row_to_excel (edit_xlsx).
 */
export async function appendRowViaBackend(
  excelPath: string,
  worksheetName: string,
  mapping: FieldMapping,
  data: Record<string, string>,
  lastDataRow: number
): Promise<WriteResult> {
  const numCols = mapping.headers?.length ?? 0;
  const columnsToWrite =
    numCols > 0
      ? Array.from({ length: numCols }, (_, i) => colIndexToLetter(i))
      : Object.keys(mapping.columnToField);

  const AMOUNT_KEYS = new Set(["net_amount", "tax_amount", "total_amount"]);
  const row: { column: string; value: string }[] = columnsToWrite.map((colLetter, i) => {
    let value: string;
    if (i === 0) {
      value = data["document_type"] ?? "Фактура";
    } else {
      const fieldKey = mapping.columnToField[colLetter];
      value =
        fieldKey != null
          ? (data[fieldKey] ?? "")
          : (data[`${COLUMN_KEY_PREFIX}${colLetter}`] ?? "");
      if (fieldKey && AMOUNT_KEYS.has(fieldKey) && value.trim()) {
        value = formatNumberForExcel(value);
      }
    }
    return { column: colLetter, value };
  });

  await appendRowToExcel(excelPath, worksheetName, row);
  return {
    success: true,
    rowNumber: lastDataRow + 1,
  };
}

/**
 * Append one row from mapping + data, verify in memory, backup, write to disk. On failure, restore backup.
 * WARNING: Loads full workbook in frontend - can cause OOM on large files. Prefer appendRowViaBackend for UI.
 */
export async function writeAndVerify(
  excelPath: string,
  mapping: FieldMapping,
  data: Record<string, string>,
  lastDataRow: number
): Promise<WriteResult> {
  const buffer = await readExcelAsBuffer(excelPath);
  const workbook = await loadWorkbook(buffer);
  const worksheet = workbook.getWorksheet(mapping.worksheetName);
  if (!worksheet) throw new Error(`Sheet "${mapping.worksheetName}" not found`);

  const newRowNumber = lastDataRow + 1;
  const newRow = worksheet.getRow(newRowNumber);

  const numCols = mapping.headers?.length ?? 0;
  const columnsToWrite =
    numCols > 0
      ? Array.from({ length: numCols }, (_, i) => colIndexToLetter(i))
      : Object.keys(mapping.columnToField);

  for (const colLetter of columnsToWrite) {
    const fieldKey = mapping.columnToField[colLetter];
    const value =
      fieldKey != null
        ? (data[fieldKey] ?? "")
        : (data[`${COLUMN_KEY_PREFIX}${colLetter}`] ?? "");
    const colNum = colLetterToIndex(colLetter);
    const cell = newRow.getCell(colNum);
    cell.value = value;
  }

  for (const colLetter of columnsToWrite) {
    const fieldKey = mapping.columnToField[colLetter];
    const expected =
      fieldKey != null
        ? (data[fieldKey] ?? "")
        : (data[`${COLUMN_KEY_PREFIX}${colLetter}`] ?? "");
    const colNum = colLetterToIndex(colLetter);
    const written = newRow.getCell(colNum).value;
    const writtenStr = written == null ? "" : String(written);
    if (writtenStr !== expected) {
      const keyDesc = fieldKey ?? `${COLUMN_KEY_PREFIX}${colLetter}`;
      throw new Error(`Verification failed for ${keyDesc}: expected "${expected}", got "${writtenStr}"`);
    }
  }

  const newBuffer = await saveWorkbook(workbook);
  const base64 = arrayBufferToBase64(newBuffer);
  const backupPath = excelPath + ".backup";

  await copyFile(excelPath, backupPath);
  try {
    await writeFileBase64(excelPath, base64);
    await deleteFile(backupPath);
    return { success: true, rowNumber: newRowNumber };
  } catch (e) {
    await copyFile(backupPath, excelPath);
    try {
      await deleteFile(backupPath);
    } catch {
      // ignore
    }
    throw e;
  }
}

function colLetterToIndex(letter: string): number {
  let index = 0;
  const s = letter.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    index = index * 26 + (s.charCodeAt(i) - 64);
  }
  return index;
}

/**
 * Write full row to Excel using Rust backend (memory-efficient).
 * NEW: Accepts data keyed by column index, writes ALL columns from schema.
 *
 * @param excelPath - Path to Excel file
 * @param worksheetName - Worksheet name
 * @param schemaColumns - All columns from schema (determines which columns to write)
 * @param rowData - Data keyed by column index (0-based)
 * @param lastDataRow - Last row with data (to determine next row number)
 */
export async function writeFullRow(
  excelPath: string,
  worksheetName: string,
  schemaColumns: ColumnMetadata[],
  rowData: Record<number, string | number>,
  lastDataRow: number
): Promise<WriteResult> {
  // Build row cells for ALL columns in schema
  const row: { column: string; value: string }[] = schemaColumns.map((col) => ({
    column: col.letter,
    value: String(rowData[col.index] ?? ""),  // Empty string if not filled
  }));

  // Call Rust backend (uses edit_xlsx, memory-efficient, preserves formatting)
  await appendRowToExcel(excelPath, worksheetName, row);

  return {
    success: true,
    rowNumber: lastDataRow + 1,
  };
}
