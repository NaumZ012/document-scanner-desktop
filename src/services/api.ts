import { invoke } from "@tauri-apps/api/core";
import type { OcrResult, InvoiceData, OcrInvoiceResult } from "@/shared/types";
import type { ExtractedField } from "@/shared/types";
import {
  parseAzureExtraction,
  parseAzureFieldsWithConfidence,
  parsedExtractionToInvoiceData,
} from "@/utils/parseAzureExtraction";

/** Build extracted_data payload for history: key-value plus _confidence so the Review page can show confidence %. */
export function buildExtractedDataWithConfidence(fields: ExtractedField[]): Record<string, unknown> {
  const data: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  const conf: Record<string, number> = {};
  for (const f of fields) {
    if (f.confidence != null) conf[f.key] = f.confidence;
  }
  if (Object.keys(conf).length > 0) data._confidence = conf;
  return data;
}

/** Build extracted_data with _confidence from InvoiceData.fields (e.g. after batch scan). */
export function buildExtractedDataFromInvoiceFields(
  fields: Record<string, { value: string; confidence?: number }>
): Record<string, unknown> {
  const data: Record<string, unknown> = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, v.value])
  );
  const conf: Record<string, number> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.confidence != null) conf[k] = v.confidence;
  }
  if (Object.keys(conf).length > 0) data._confidence = conf;
  return data;
}

export async function getAppDataPath(): Promise<string> {
  return invoke<string>("get_app_data_path");
}

export async function openAppDataFolder(): Promise<void> {
  return invoke("open_app_data_folder");
}

export async function getAppVersion(): Promise<string> {
  return invoke<string>("get_app_version");
}

export async function getAzureStatus(): Promise<string> {
  return invoke<string>("get_azure_status");
}

export async function clearLearnedMappings(): Promise<number> {
  return invoke<number>("clear_learned_mappings");
}

export async function runOcr(filePath: string): Promise<OcrResult> {
  return invoke<OcrResult>("run_ocr", { filePath });
}

export async function runOcrInvoice(filePath: string, documentType?: string): Promise<InvoiceData> {
  const result = await invoke<OcrInvoiceResult>("run_ocr_invoice", {
    filePath,
    documentType: documentType ?? null,
  });

  const hasRaw = result?.raw_azure_fields != null && typeof result.raw_azure_fields === "object" && !Array.isArray(result.raw_azure_fields);
  const backendFields = result?.invoice_data?.fields ?? {};
  const backendCount = Object.keys(backendFields).filter((k) => (backendFields[k]?.value ?? "").toString().trim() !== "").length;

  // 3. Debug: always log what we received so we can see why UI is empty
  console.log("=== OCR RESULT ===", {
    hasRawAzureFields: hasRaw,
    rawKeys: hasRaw ? Object.keys(result!.raw_azure_fields!) : [],
    backendFieldCount: Object.keys(backendFields).length,
    backendFilledCount: backendCount,
    sampleBackend: Object.fromEntries(Object.entries(backendFields).slice(0, 5)),
  });
  if (hasRaw) {
    console.log("=== RAW AZURE FIELDS ===", JSON.stringify(result!.raw_azure_fields, null, 2));
  }

  // 1. Data mapping: parse raw Azure .valueString / .valueNumber / .valueDate into canonical keys
  // 2. Description sanitized inside parseAzureExtraction (strip ``` blocks)
  const base: InvoiceData = {
    fields: { ...backendFields },
    source_file: result?.invoice_data?.source_file,
    source_file_path: result?.invoice_data?.source_file_path,
  };

  if (hasRaw) {
    const raw = result!.raw_azure_fields as Record<string, Record<string, unknown>>;
    // Confidence is only from Azure API (never hardcoded); UI shows "—" when missing.
    const withConfidence = parseAzureFieldsWithConfidence(raw);
    for (const [k, fv] of Object.entries(withConfidence)) {
      if (fv.value.trim() !== "" || fv.value === "0") {
        base.fields[k] = { value: fv.value, confidence: fv.confidence };
      }
    }
    const parsed = parseAzureExtraction(raw);
    for (const [k, v] of Object.entries(parsed)) {
      const val = v ?? "";
      const strVal = String(val);
      const isZero = val === 0 || strVal.trim() === "0";
      if (isZero) {
        base.fields[k] = { value: "0", confidence: base.fields[k]?.confidence };
      } else if (strVal.trim() !== "" && !(k in base.fields)) {
        base.fields[k] = { value: strVal, confidence: undefined };
      }
    }

    // Extra safety for Даночен биланс: map any Azure field ending with AOP1…AOP59
    // (e.g. "namaluvanjeDanokFiskalniSistemiAOP52") into our canonical "aop_52" keys.
    // This guarantees that even if backend mapping misses a field, the UI still sees it.
    if (documentType === "smetka") {
      for (const [azureKey, rawField] of Object.entries(raw)) {
        const match = azureKey.match(/AOP(\d{1,2})$/i);
        if (!match) continue;
        const num = parseInt(match[1]!, 10);
        if (!Number.isFinite(num) || num < 1 || num > 59) continue;
        const key = `aop_${num}`;
        const f = rawField as any;
        let value: string | number | null = null;
        if (typeof f?.valueNumber === "number") value = f.valueNumber;
        else if (typeof f?.valueInteger === "number") value = f.valueInteger;
        else if (typeof f?.valueString === "string") value = f.valueString.trim();
        if (value === null || value === "") continue;
        const strVal = String(value);
        const confidence = typeof f?.confidence === "number" ? (f.confidence as number) : undefined;
        // Always preserve zero – we want 0, not "—".
        if (strVal.trim() !== "" || value === 0) {
          base.fields[key] = {
            value: strVal.trim() === "" ? "0" : strVal,
            confidence: confidence ?? base.fields[key]?.confidence,
          };
        }
      }
    }
  }

  // Ensure document_type is always set for non-invoice flows so that
  // the Review (Преглед) page and Excel profile filtering can pick
  // the correct document-type schema (Даночен биланс, ДДВ, Плати).
  const docTypeField = base.fields.document_type;
  const hasDocType = typeof docTypeField?.value === "string" && docTypeField.value.trim().length > 0;
  if (!hasDocType && documentType) {
    let friendly: string | null = null;
    if (documentType === "smetka") friendly = "Даночен биланс";
    else if (documentType === "generic") friendly = "ДДВ";
    else if (documentType === "plata") friendly = "Плата";

    if (friendly) {
      base.fields.document_type = {
        value: friendly,
      };
    }
  }

  return base;
}

export async function batchScanInvoices(pdfPaths: string[], documentType?: string): Promise<import("@/shared/types").BatchScanResult> {
  return invoke<import("@/shared/types").BatchScanResult>("batch_scan_invoices", { pdfPaths, documentType: documentType ?? null });
}

export async function exportInvoicesToExcel(
  invoices: InvoiceData[],
  path?: string | null
): Promise<string> {
  return invoke<string>("export_invoices_to_excel", { invoices, path: path ?? null });
}

export async function exportInvoicesToNewExcel(
  invoices: InvoiceData[],
  path?: string | null,
  worksheetName?: string | null
): Promise<string> {
  return invoke<string>("export_invoices_to_new_excel", {
    invoices,
    path: path ?? null,
    worksheetName: worksheetName ?? null,
  });
}

export async function exportToNewExcelWithColumns(
  path: string,
  worksheetName: string,
  headers: string[],
  columnFieldKeys: string[],
  invoices: InvoiceData[]
): Promise<string> {
  return invoke<string>("export_to_new_excel_with_columns", {
    path,
    worksheetName,
    headers,
    columnFieldKeys,
    invoices,
  });
}

/** Copy the profile's template to dest_path and append invoice rows. Preserves template layout (merged headers, styling). */
export async function copyTemplateAndAppendRows(
  profileId: number,
  destPath: string,
  invoices: InvoiceData[]
): Promise<string> {
  return invoke<string>("copy_template_and_append_rows", {
    profileId,
    destPath,
    invoices,
  });
}

/** Copy Даночен биланс template and fill column D at fixed rows (form layout). Single document. */
export async function copyTemplateAndFillTaxBalance(
  profileId: number,
  destPath: string,
  invoice: InvoiceData
): Promise<string> {
  return invoke<string>("copy_template_and_fill_tax_balance", {
    profileId,
    destPath,
    invoice,
  });
}

export async function appendInvoicesToExistingExcel(
  excelPath: string,
  worksheetName: string,
  headerRow: number,
  invoices: InvoiceData[]
): Promise<void> {
  return invoke("append_invoices_to_existing_excel", {
    excelPath,
    worksheetName,
    headerRow: headerRow >= 1 ? headerRow : 1,
    invoices,
  });
}

export async function readExcelHeaders(
  path: string,
  sheet: string,
  headerRow?: number
): Promise<string[]> {
  return invoke<string[]>("read_excel_headers", {
    path,
    sheet,
    header_row: headerRow ?? null,
  });
}

export interface ExcelHeaderItem {
  columnLetter: string;
  headerText: string;
  columnIndex: number;
}

export async function getExcelHeaders(
  path: string,
  sheetName: string,
  headerRow: number
): Promise<ExcelHeaderItem[]> {
  return invoke<ExcelHeaderItem[]>("get_excel_headers", {
    excelPath: path,
    worksheetName: sheetName,
    headerRow: headerRow >= 1 ? headerRow : 1,
  });
}

export async function getSheetNames(path: string): Promise<string[]> {
  return invoke<string[]>("get_sheet_names", { path });
}

export async function appendRowToExcel(
  path: string,
  sheet: string,
  row: { column: string; value: string }[]
): Promise<void> {
  return invoke("append_row_to_excel", {
    payload: { path, sheet, row },
  });
}

export async function getProfiles(): Promise<
  [number, string, string, string, string][]
> {
  return invoke("get_profiles");
}

export async function saveProfile(payload: {
  id?: number;
  name: string;
  excel_path: string;
  sheet_name: string;
  column_mapping: Record<string, string | number>;
}): Promise<number> {
  return invoke("save_profile", { payload });
}

export async function deleteProfile(id: number): Promise<void> {
  return invoke("delete_profile", { id });
}

export async function getHistory(payload?: {
  search?: string;
  folder_id?: number | null; // null/undefined = all, -1 = uncategorized
}): Promise<
  [number, string, string, string, string, string, number | null, string | null][]
> {
  return invoke("get_history", { payload: payload ?? null });
}

export async function createFolder(name: string): Promise<number> {
  return invoke("create_folder", { name });
}

export async function getFolders(): Promise<[number, string, string][]> {
  return invoke("get_folders");
}

export async function deleteFolder(id: number): Promise<void> {
  return invoke("delete_folder", { id });
}

export async function assignHistoryToFolder(
  historyId: number,
  folderId: number | null
): Promise<void> {
  return invoke("assign_history_to_folder", {
    historyId,
    folderId: folderId ?? null,
  });
}

export async function getHistoryById(
  id: number
): Promise<
  [string, string, string, string, number | null] | null
> {
  return invoke("get_history_by_id", { id });
}

export async function addHistoryRecord(payload: {
  document_type: string;
  file_path_or_name: string;
  extracted_data: Record<string, unknown>;
  status: string;
  excel_profile_id?: number | null;
  error_message?: string | null;
  folder_id?: number | null;
}): Promise<number> {
  return invoke("add_history_record", { payload });
}

export async function updateHistoryStatus(payload: {
  id: number;
  status: string;
  excel_profile_id?: number | null;
  error_message?: string | null;
}): Promise<void> {
  return invoke("update_history_status", { payload });
}

export async function updateHistoryRecord(payload: {
  id: number;
  document_type: string;
  file_path_or_name: string;
  extracted_data: Record<string, unknown>;
  status: string;
  excel_profile_id?: number | null;
  error_message?: string | null;
}): Promise<void> {
  return invoke("update_history_record", { payload });
}

export async function deleteHistoryRecord(id: number): Promise<void> {
  return invoke("delete_history_record", { id });
}

export async function getLearnedMapping(schemaHash: string, fieldType: string): Promise<[string, number] | null> {
  return invoke("get_learned_mapping", { schema_hash: schemaHash, field_type: fieldType });
}

export async function upsertLearnedMapping(payload: {
  schema_hash: string;
  field_type: string;
  column_index: number;
  column_letter: string;
  action: "ACCEPT" | "REJECT" | "EDIT" | "MANUAL_SELECT";
}): Promise<void> {
  return invoke("upsert_learned_mapping", payload);
}

export async function getColumnSamples(payload: {
  path: string;
  sheet: string;
  header_row?: number;
  max_rows?: number;
}): Promise<string[][]> {
  return invoke("get_column_samples", payload);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export async function validateDocumentFile(path: string): Promise<ValidationResult> {
  return invoke("validate_document_file", { path });
}

export async function validateExcelFile(path: string): Promise<ValidationResult> {
  return invoke("validate_excel_file", { path });
}

export async function readFileBase64(path: string): Promise<string> {
  return invoke("read_file_base64", { path });
}

export async function writeFileBase64(path: string, base64Content: string): Promise<void> {
  return invoke("write_file_base64", { path, base64Content });
}

export async function copyFile(src: string, dest: string): Promise<void> {
  return invoke("copy_file", { src, dest });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export interface ExcelSchemaResponse {
  cached: boolean;
  schema_json?: string;
  file_bytes?: string;
}

export async function getExcelSchema(path: string): Promise<ExcelSchemaResponse> {
  return invoke("get_excel_schema", { path });
}

export interface AnalyzedExcelSchema {
  worksheetName: string;
  headers: string[];
  columnSamples: string[][];
  lastDataRow: number;
  schemaHash: string;
}

export async function analyzeExcelSchema(
  path: string,
  sheetName: string,
  headerRow: number
): Promise<AnalyzedExcelSchema> {
  return invoke("analyze_excel_schema", {
    path,
    sheetName,
    headerRow,
  });
}

export async function cacheExcelSchema(
  path: string,
  schemaJson: string,
  schemaHash: string,
  worksheetName: string
): Promise<void> {
  return invoke("cache_excel_schema", {
    path,
    schemaJson,
    schemaHash,
    worksheetName,
  });
}

// --- Excel schema cache (profile-centric) ---

export interface ExcelSchemaHeader {
  columnIndex: number;
  columnLetter: string;
  text: string;
}

export interface ExcelSchemaColumnFormat {
  columnIndex: number;
  columnLetter: string;
  headerText: string;
  fontName: string;
  fontSize: number;
  fontColor: string;
  fontBold: boolean;
  fontItalic: boolean;
  backgroundColor: string;
  backgroundColorAlt?: string;
  borderStyle: string;
  borderColor: string;
  alignment: string;
  dataType: string;
  numberFormat?: string;
  columnWidth: number;
}

export interface ExcelSchemaRowTemplate {
  templateRowIndex: number;
  rowHeight: number;
  useAlternatingColors: boolean;
}

export interface ExcelSchemaFull {
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  nextFreeRow: number;
  totalRows: number;
  totalColumns: number;
  headers: ExcelSchemaHeader[];
  columns: ExcelSchemaColumnFormat[];
  rowTemplate: ExcelSchemaRowTemplate;
  fileSize: number;
  fileMtime: number;
}

export async function scanExcelSchema(
  excelPath: string,
  worksheetName: string
): Promise<ExcelSchemaFull> {
  return invoke("scan_excel_schema", {
    excelPath,
    worksheetName,
  });
}

export async function saveExcelSchema(
  profileId: number,
  schema: ExcelSchemaFull
): Promise<void> {
  return invoke("save_excel_schema", {
    profileId,
    schema,
  });
}

export async function getExcelSchemaForProfile(
  profileId: number,
  forceRefresh: boolean
): Promise<ExcelSchemaFull> {
  return invoke("get_excel_schema_for_profile", {
    profileId,
    forceRefresh,
  });
}

export async function appendToExcelFast(
  profileId: number,
  invoiceData: { fields: Record<string, { value: string; confidence?: number }> }
): Promise<number> {
  return invoke("append_to_excel_fast", {
    profileId,
    invoiceData,
  });
}
