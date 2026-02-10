/**
 * Web Worker: parses Excel buffer with ExcelJS off the main thread
 * so the UI stays responsive when adding a profile or analyzing schema.
 */
import ExcelJS from "exceljs";

const SAMPLE_ROWS = 5;
const MAX_COLS = 200;
const MAX_LAST_ROW_SCAN = 300;

function cellToString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return String(val);
  if (val && typeof val === "object" && "text" in val) return String((val as { text: string }).text);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val);
}

function isRowEmpty(row: { getCell: (col: number) => { value: unknown } }): boolean {
  for (let c = 1; c <= MAX_COLS; c++) {
    const v = row.getCell(c).value;
    if (v != null && String(v).trim() !== "") return false;
  }
  return true;
}

async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

export type GetSheetNamesResult = { id?: number; type: "getSheetNames"; sheetNames: string[] };
export type AnalyzeSchemaResult = {
  id?: number;
  type: "analyzeSchema";
  worksheetName: string;
  headers: string[];
  columnSamples: string[][];
  lastDataRow: number;
};
export type WorkerResult = GetSheetNamesResult | AnalyzeSchemaResult;
export type WorkerError = { id?: number; type: "error"; message: string };

self.onmessage = async (e: MessageEvent<{ id?: number; type: string; buffer: ArrayBuffer; headerRow?: number; sheetName?: string }>) => {
  const { id, type, buffer, headerRow = 1, sheetName } = e.data;
  const reply = (msg: GetSheetNamesResult | AnalyzeSchemaResult | WorkerError) => self.postMessage({ ...msg, id });
  try {
    if (type === "getSheetNames") {
      const workbook = await loadWorkbook(buffer);
      const sheetNames = workbook.worksheets.map((ws) => ws.name);
      reply({ type: "getSheetNames", sheetNames } satisfies GetSheetNamesResult);
      return;
    }
    if (type === "analyzeSchema") {
      const workbook = await loadWorkbook(buffer);
      const worksheet = sheetName
        ? workbook.getWorksheet(sheetName) ?? workbook.worksheets[0]
        : workbook.worksheets[0];
      if (!worksheet) {
        reply({ type: "error", message: "No worksheet in workbook" } satisfies WorkerError);
        return;
      }
      const worksheetName = worksheet.name;
      const headerRowIdx = Math.max(0, (headerRow ?? 1) - 1);
      const headers: string[] = [];
      const firstRow = worksheet.getRow(headerRowIdx + 1);
      for (let c = 1; c <= MAX_COLS; c++) {
        const cell = firstRow.getCell(c);
        const s = cellToString(cell.value);
        if (headers.length > 0 && !s.trim()) break;
        headers.push(s);
      }
      while (headers.length > 0 && !headers[headers.length - 1]?.trim()) headers.pop();

      const columnSamples: string[][] = [];
      for (let col = 0; col < headers.length; col++) {
        const samples: string[] = [];
        for (let r = 1; r <= SAMPLE_ROWS; r++) {
          const row = worksheet.getRow(headerRowIdx + 1 + r);
          const cell = row.getCell(col + 1);
          const v = cellToString(cell.value);
          if (v) samples.push(v);
        }
        columnSamples.push(samples);
      }

      let lastDataRow = headerRowIdx + 1;
      const rowCount = (worksheet as { rowCount?: number }).rowCount ?? 0;
      const maxRow = Math.min(Math.max(rowCount, headerRowIdx + MAX_LAST_ROW_SCAN), headerRowIdx + MAX_LAST_ROW_SCAN);
      for (let r = headerRowIdx + 2; r <= maxRow; r++) {
        const row = worksheet.getRow(r);
        if (!row || isRowEmpty(row)) continue;
        lastDataRow = r;
      }

      reply({
        type: "analyzeSchema",
        worksheetName,
        headers,
        columnSamples,
        lastDataRow,
      } satisfies AnalyzeSchemaResult);
      return;
    }
    reply({ type: "error", message: `Unknown request: ${type}` } satisfies WorkerError);
  } catch (err) {
    reply({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerError);
  }
};
