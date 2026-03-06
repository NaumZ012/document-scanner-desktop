/**
 * Plata (МПИН / Плати) export — XLSX ONLY, NO CSV.
 *
 * Two modes:
 * 1. exportPlataToNewTableBuffer — builds a NEW workbook with ONLY the payroll table
 *    (no logo, no legend, no metadata). Plain values only to avoid Excel repair/corruption.
 * 2. exportPlataToTemplateBuffer — legacy: loads a template and injects values (kept for reference).
 */
import ExcelJS from "exceljs";
import type { InvoiceData } from "@/shared/types";

const SHEET_NAMES = ["Пресметка на плата", "МПИН"];

/** Month columns: E=5 (Jan) through P=16 (Dec). Column A=№, B=Опис, C=%, D=Вкупно. */
const COL_NUM = 1;
const COL_LABEL = 2;
const COL_PERCENT = 3;
const COL_TOTAL = 4;
const MONTH_COL_START = 5; // E = January

const MONTH_HEADERS_MK = [
  "Јануари",
  "Февруари",
  "Март",
  "Април",
  "Мај",
  "Јуни",
  "Јули",
  "Август",
  "Септември",
  "Октомври",
  "Ноември",
  "Декември",
];

/** Table rows: №, label, optional % text, and field keys for mapping OCR data. */
const TABLE_ROWS: { num: number; label: string; percent?: string; fieldKeys: string[] }[] = [
  { num: 1, label: "Бруто плата (Бруто 2)", fieldKeys: ["brutoPlata", "totalGrossSalary"] },
  { num: 2, label: "Придонес за ПИО", percent: "18.40%", fieldKeys: ["pridonesPIO"] },
  { num: 3, label: "Придонес за здравство", percent: "7.30%", fieldKeys: ["pridonesZdravstvo"] },
  { num: 4, label: "Придонес за профес. здравствено осигурување", percent: "0.50%", fieldKeys: ["pridonesProfesionalnoZaboluvanje"] },
  { num: 5, label: "Придонес за вработување", percent: "1.20%", fieldKeys: ["pridonesVrabotuvanje"] },
  { num: 6, label: "Вкупни придонеси (2+3+4+5)", percent: "28.00%", fieldKeys: [] },
  { num: 7, label: "Бруто основа (Бруто 1) (1-6)", fieldKeys: [] },
  { num: 8, label: "Даночно ослободување", fieldKeys: ["taxExemption", "даночно ослободување"] },
  { num: 9, label: "Вкупна даночна основа (7-8)", fieldKeys: [] },
  { num: 10, label: "Персонален данок", percent: "10.00%", fieldKeys: ["personalenDanok"] },
  { num: 11, label: "Нето плата (7-11)", fieldKeys: [] },
  { num: 12, label: "Вкупно нето ефективна плата по декларација", fieldKeys: ["vkupnaNetoPlata", "totalNetSalary"] },
  { num: 13, label: "Број на вработени за кои се пресметува плата", fieldKeys: ["brojVraboteni"] },
];

/** Template-based export: month columns D=4 (Jan) through O=15 (Dec). */
const TEMPLATE_MONTH_COL_START = 4;

/** Column B label -> field key(s) for template-based export. */
const LABEL_TO_FIELD: [string, string[]][] = [
  ["Бруто плата (Бруто 2)", ["brutoPlata", "totalGrossSalary"]],
  ["Придонес за ПИО", ["pridonesPIO"]],
  ["Придонес за здравство", ["pridonesZdravstvo"]],
  ["Придонес за профес. здравствено осигурување", ["pridonesProfesionalnoZaboluvanje"]],
  ["Придонес за вработување", ["pridonesVrabotuvanje"]],
  ["Даночно ослободување", ["taxExemption", "даночно ослободување"]],
  ["Персонален данок", ["personalenDanok"]],
  ["Вкупно нето ефективна плата по декларација", ["vkupnaNetoPlata", "totalNetSalary"]],
  ["Број на вработени за кои се пресметува плата", ["brojVraboteni"]],
];

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

/** Parse declarationPeriod "MM/YYYY" or "MM.YYYY" -> month 1–12, or null. */
function parseMonth(declarationPeriod: string): number | null {
  const s = (declarationPeriod || "").trim();
  const match = /^(\d{1,2})[\/\.\-](\d{4})$/.exec(s);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  if (month >= 1 && month <= 12) return month;
  return null;
}

function getFieldValue(
  fields: Record<string, { value: string }>,
  keys: string[]
): string {
  for (const key of keys) {
    const v = fields[key]?.value ?? "";
    const s = typeof v === "string" ? v.trim() : String(v).trim();
    if (s !== "") return s;
  }
  return "";
}

/** Cast to number for Excel (use parseFloat so Excel treats as number, not string). */
function parseNumber(value: string): number | null {
  if (value === "") return null;
  const n = parseFloat(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function cellValueToString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return String(val);
  if (val && typeof val === "object" && "text" in val) return String((val as { text: string }).text);
  return String(val);
}

/** Normalize label from cell: strip leading "1. ", "1 ", "10 " etc. so we match LABEL_TO_FIELD. */
function normalizeLabel(label: string): string {
  const t = label.trim();
  const withoutNum = t.replace(/^\d+\.?\s*/, "").trim();
  return withoutNum || t;
}

/**
 * Build a NEW workbook with only the payroll table (no logo, legend, or metadata).
 * Values only — no named ranges or formulas — to avoid Excel "Repairs to file" / removed records.
 */
export async function exportPlataToNewTableBuffer(invoices: InvoiceData[]): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Invoice Scanner";
  const sheet = workbook.addWorksheet("Пресметка на плата", { views: [{ state: "frozen", ySplit: 2 }] });

  // Title row: "Пресметка на плата"
  sheet.mergeCells("A1:P1");
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "Пресметка на плата";
  titleCell.font = { bold: true, size: 12 };
  titleCell.alignment = { horizontal: "center" };

  // Header row: №, Опис, %, Вкупно, Јануари … Декември
  const headerRow = sheet.getRow(2);
  headerRow.getCell(COL_NUM).value = "№";
  headerRow.getCell(COL_LABEL).value = "Опис";
  headerRow.getCell(COL_PERCENT).value = "%";
  headerRow.getCell(COL_TOTAL).value = "Вкупно";
  MONTH_HEADERS_MK.forEach((name, i) => {
    headerRow.getCell(MONTH_COL_START + i).value = name;
  });
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2E5090" },
  };
  headerRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Data rows: fixed labels and %; month columns filled from invoices
  TABLE_ROWS.forEach((row, idx) => {
    const r = sheet.getRow(3 + idx);
    r.getCell(COL_NUM).value = row.num;
    r.getCell(COL_LABEL).value = row.label;
    if (row.percent) r.getCell(COL_PERCENT).value = row.percent;
  });

  // Fill month columns from each invoice (by declaration period)
  for (const invoice of invoices) {
    const declarationPeriod =
      getFieldValue(invoice.fields, ["declarationPeriod"]) ||
      getFieldValue(invoice.fields, ["taxPeriod"]);
    const month = parseMonth(declarationPeriod);
    if (month == null) continue;

    const targetCol = MONTH_COL_START + month - 1;

    TABLE_ROWS.forEach((row, idx) => {
      if (row.fieldKeys.length === 0) return;
      const raw = getFieldValue(invoice.fields, row.fieldKeys);
      const num = parseNumber(raw);
      if (num !== null) {
        const cell = sheet.getCell(3 + idx, targetCol);
        cell.value = num;
      }
    });
  }

  for (let c = 1; c <= MONTH_COL_START + 11; c++) {
    sheet.getColumn(c).width = c === COL_LABEL ? 42 : 12;
  }

  const out = await workbook.xlsx.writeBuffer();
  const bytes =
    out instanceof ArrayBuffer
      ? new Uint8Array(out)
      : new Uint8Array(out as ArrayLike<number>);
  return arrayBufferToBase64(bytes.buffer);
}

/**
 * Load template from base64, write each invoice into its month column (by label in column B),
 * return workbook as base64. Preserves all original styles. (Legacy — prefer exportPlataToNewTableBuffer.)
 */
export async function exportPlataToTemplateBuffer(
  templateBase64: string,
  sheetName: string,
  invoices: InvoiceData[]
): Promise<string> {
  const buffer = base64ToArrayBuffer(templateBase64);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  let worksheet =
    workbook.getWorksheet(sheetName) ??
    SHEET_NAMES.map((n) => workbook.getWorksheet(n)).find(Boolean) ??
    workbook.worksheets[0];
  if (!worksheet) throw new Error("No worksheet found in template.");

  const labelToFieldKeys = new Map(LABEL_TO_FIELD);
  const maxRows = 200;

  for (const invoice of invoices) {
    const declarationPeriod =
      getFieldValue(invoice.fields, ["declarationPeriod"]) ||
      getFieldValue(invoice.fields, ["taxPeriod"]);
    const month = parseMonth(declarationPeriod);
    if (month == null) continue;

    const targetCol = TEMPLATE_MONTH_COL_START + month - 1; // D=4 Jan, …, O=15 Dec

    for (let row = 1; row <= maxRows; row++) {
      const rowObj = worksheet.getRow(row);
      const labelCell = rowObj.getCell(COL_LABEL);
      const rawLabel = cellValueToString(labelCell.value).trim();
      if (!rawLabel) continue;

      const normalized = normalizeLabel(rawLabel);
      const fieldKeys = labelToFieldKeys.get(normalized) ?? labelToFieldKeys.get(rawLabel);
      if (!fieldKeys) continue;

      const raw = getFieldValue(invoice.fields, fieldKeys);
      const num = parseNumber(raw);
      if (num !== null) {
        const cell = rowObj.getCell(targetCol);
        cell.value = num; // number only — do not touch cell.style
      }
    }
  }

  // XLSX binary only — no CSV. writeBuffer() produces .xlsx format.
  const out = await workbook.xlsx.writeBuffer();
  const bytes =
    out instanceof ArrayBuffer
      ? new Uint8Array(out)
      : new Uint8Array(out as ArrayLike<number>);
  return arrayBufferToBase64(bytes.buffer);
}
