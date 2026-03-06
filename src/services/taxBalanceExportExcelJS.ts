/**
 * Даночен биланс (Tax Balance) export — new workbook with ONLY the table.
 * No logo, no header block (Клиент, Предмет, Период, Подготвил/Проверил).
 * Values only — no formulas or named ranges — to avoid Excel "Repairs to file" / removed records.
 */
import ExcelJS from "exceljs";
import type { InvoiceData } from "@/shared/types";
import { TAX_BALANCE_FORM_ROWS } from "@/shared/documentTypeSchemas";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function parseNumber(value: string): number | null {
  if (value === "") return null;
  const n = parseFloat(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a NEW workbook with only the Даночен биланс table (ДОБИВКА НА НЕПРИЗНАЕНИ РАСХОДИ).
 * Single document; values only.
 */
export async function exportTaxBalanceToNewTableBuffer(invoice: InvoiceData): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Invoice Scanner";
  const sheet = workbook.addWorksheet("Даночен биланс", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // Title row
  sheet.mergeCells("A1:C1");
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "ДОБИВКА НА НЕПРИЗНАЕНИ РАСХОДИ";
  titleCell.font = { bold: true, size: 12 };
  titleCell.alignment = { horizontal: "center" };

  // Header row: Ред, Опис, Износ
  const headerRow = sheet.getRow(2);
  headerRow.getCell(1).value = "Ред";
  headerRow.getCell(2).value = "Опис";
  headerRow.getCell(3).value = "Износ";
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

  // Data rows: section, description, value (from invoice.fields[aop_1..aop_59])
  TAX_BALANCE_FORM_ROWS.forEach((row, idx) => {
    const r = sheet.getRow(3 + idx);
    r.getCell(1).value = row.section ?? "";
    r.getCell(2).value = row.description ?? `АОП ${idx + 1}`;
    const fieldKey = row.fieldKey;
    const raw = fieldKey ? (invoice.fields[fieldKey]?.value ?? "") : "";
    const str = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    const num = parseNumber(str);
    if (num !== null) {
      r.getCell(3).value = num;
    } else if (str !== "") {
      r.getCell(3).value = str;
    }
  });

  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = 80;
  sheet.getColumn(3).width = 14;

  const out = await workbook.xlsx.writeBuffer();
  const bytes =
    out instanceof ArrayBuffer
      ? new Uint8Array(out)
      : new Uint8Array(out as ArrayLike<number>);
  return arrayBufferToBase64(bytes.buffer);
}
