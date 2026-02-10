export type DocumentType = "faktura" | "plata" | "smetka" | "generic";

export interface OcrLine {
  text: string;
  confidence?: number;
  boundingBox?: number[];
}

export interface OcrResult {
  lines: OcrLine[];
  content?: string;
}

export interface ExcelProfile {
  id: number;
  name: string;
  excel_path: string;
  sheet_name: string;
  column_mapping: Record<string, string>;
}

export interface HistoryRecord {
  id: number;
  created_at: string;
  document_type: DocumentType;
  file_path_or_name: string;
  extracted_data: Record<string, string>;
  status: "pending" | "added_to_excel" | "error";
  excel_profile_id: number | null;
  error_message: string | null;
}

export type HistoryStatus = "pending" | "added_to_excel" | "error";

export interface ExtractedField {
  key: string;
  value: string;
  confidence?: number;
  label: string;
}

/** Structured invoice data from Azure prebuilt-invoice (run_ocr_invoice). */
export interface InvoiceFieldValue {
  value: string;
  confidence?: number;
}

export interface InvoiceData {
  fields: Record<string, InvoiceFieldValue>;
  /** Original PDF filename (set by batch_scan_invoices). */
  source_file?: string;
}

/** Excel schema from schemaService.analyzeSchema (for mapping and write). */
export interface ExcelSchema {
  worksheetName: string;
  headers: string[];
  columnSamples: string[][];
  lastDataRow: number;
  schemaHash: string;
}

export interface ColumnMetadata {
  index: number;        // 0-based column index
  letter: string;       // Excel column letter (A, B, C, ...)
  header: string;       // Column header text
  dataType: 'string' | 'number' | 'date';
  samples?: string[];   // Sample values from this column
}

export interface EnhancedExcelSchema extends ExcelSchema {
  columns: ColumnMetadata[];
}
