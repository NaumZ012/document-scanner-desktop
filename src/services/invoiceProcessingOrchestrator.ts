import { validateDocumentFile, validateExcelFile, runOcrInvoice } from "@/services/api";
import { analyzeSchema } from "./schemaService";
import { mapSchemaToFields, type FieldMapping } from "./mappingService";
import { appendRowViaBackend } from "./excelService";
import { recordMapping } from "./learningService";

export interface PipelineCallbacks {
  onProgress?: (stage: string, percent: number) => void;
  onReviewNeeded?: (mapping: FieldMapping) => Promise<FieldMapping>;
}

export interface PipelineResult {
  success: boolean;
  rowNumber?: number;
  error?: string;
}

/**
 * Coordinate the full pipeline: validate -> OCR -> schema -> mapping -> (review) -> write -> learning.
 * No business logic here; delegates to services.
 */
export async function processInvoice(
  pdfPath: string,
  excelPath: string,
  callbacks?: PipelineCallbacks
): Promise<PipelineResult> {
  const report = (stage: string, percent: number) => callbacks?.onProgress?.(stage, percent);

  try {
    report("validation", 0);
    const docVal = await validateDocumentFile(pdfPath);
    if (!docVal.valid) {
      return { success: false, error: docVal.error ?? "Invalid document file." };
    }
    const excelVal = await validateExcelFile(excelPath);
    if (!excelVal.valid) {
      return { success: false, error: excelVal.error ?? "Invalid Excel file." };
    }

    report("ocr", 10);
    const invoice = await runOcrInvoice(pdfPath);

    report("schema", 30);
    const schema = await analyzeSchema(excelPath);

    report("mapping", 50);
    let mapping = await mapSchemaToFields(schema);

    if (mapping.requiresReview && callbacks?.onReviewNeeded) {
      report("review", 70);
      const confirmed = await callbacks.onReviewNeeded(mapping);
      if (!confirmed) return { success: false, error: "User cancelled." };
      mapping = confirmed;
    }

    report("writing", 85);
    const data: Record<string, string> = {};
    for (const [key, f] of Object.entries(invoice.fields)) {
      data[key] = f.value;
    }
    const writeResult = await appendRowViaBackend(
      excelPath,
      mapping.worksheetName,
      mapping,
      data,
      schema.lastDataRow
    );

    report("learning", 95);
    await recordMapping(schema, mapping);

    report("complete", 100);
    return {
      success: true,
      rowNumber: writeResult.rowNumber,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
}
