import { getExcelSchema, cacheExcelSchema, analyzeExcelSchema, getSheetNames } from "@/services/api";
import type { ExcelSchema, EnhancedExcelSchema, ColumnMetadata } from "@/shared/types";

const DEFAULT_HEADER_ROW = 1;

/**
 * Convert column index to Excel letter (0→A, 1→B, 25→Z, 26→AA)
 */
function indexToLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * Infer data type from column samples
 */
function inferDataType(samples: string[]): 'string' | 'number' | 'date' {
  if (!samples || samples.length === 0) return 'string';

  const nonEmpty = samples.filter(s => s && s.trim() !== '');
  if (nonEmpty.length === 0) return 'string';

  // Check if all look like numbers
  const allNumbers = nonEmpty.every(s => !isNaN(Number(s.replace(/,/g, ''))));
  if (allNumbers) return 'number';

  // Check if all look like dates (DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD)
  const datePattern = /^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$|^\d{4}-\d{2}-\d{2}$/;
  const allDates = nonEmpty.every(s => datePattern.test(s.trim()));
  if (allDates) return 'date';

  return 'string';
}

/**
 * Enhance schema with column metadata (index, letter, dataType)
 */
export function enhanceSchema(schema: ExcelSchema): EnhancedExcelSchema {
  const columns: ColumnMetadata[] = schema.headers.map((header, index) => ({
    index,
    letter: indexToLetter(index),
    header: header || `Column ${indexToLetter(index)}`,
    dataType: inferDataType(schema.columnSamples[index] || []),
    samples: schema.columnSamples[index],
  }));

  return {
    ...schema,
    columns,
  };
}

/**
 * Analyze Excel file at path: return cached schema or use backend analysis (avoids loading full file into webview to prevent OOM).
 * If sheetName is provided, use that sheet; otherwise first sheet.
 */
export async function analyzeSchema(
  excelPath: string,
  headerRow: number = DEFAULT_HEADER_ROW,
  sheetName?: string
): Promise<ExcelSchema> {
  const response = await getExcelSchema(excelPath);

  if (response.cached && response.schema_json) {
    const cached = JSON.parse(response.schema_json) as ExcelSchema;
    if (!sheetName || cached.worksheetName === sheetName) return cached;
  }

  // Use backend schema analysis instead of loading full file into webview (prevents Out of Memory).
  const sheet = sheetName ?? (await getSheetNames(excelPath))[0];
  if (!sheet) {
    throw new Error("No worksheet found in Excel file.");
  }
  const payload = await analyzeExcelSchema(excelPath, sheet, headerRow);

  const schema: ExcelSchema = {
    worksheetName: payload.worksheetName,
    headers: payload.headers,
    columnSamples: payload.columnSamples,
    lastDataRow: payload.lastDataRow,
    schemaHash: payload.schemaHash,
  };

  await cacheExcelSchema(excelPath, JSON.stringify(schema), payload.schemaHash, payload.worksheetName);
  return schema;
}

/**
 * Get sheet names from Excel file using backend (avoids loading file into webview).
 */
export async function getSheetNamesFromPath(path: string): Promise<string[]> {
  return getSheetNames(path);
}

/**
 * Get enhanced schema for a profile (with column metadata)
 */
export async function getSchemaForProfile(
  excelPath: string,
  sheetName: string,
  headerRow: number = DEFAULT_HEADER_ROW
): Promise<EnhancedExcelSchema> {
  const schema = await analyzeSchema(excelPath, headerRow, sheetName);
  return enhanceSchema(schema);
}

