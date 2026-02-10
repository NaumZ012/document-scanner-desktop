import type { ExcelSchema } from "@/shared/types";
import { autoMatchHeadersAdvanced } from "@/utils/matching";
import { colIndexToLetter } from "@/utils/matching";

const DEFAULT_REVIEW_THRESHOLD = 0.8;
const LOW_FIELD_THRESHOLD = 0.7;

export interface FieldMapping {
  /** Column letter -> field key (our FIELD_KEYS). */
  columnToField: Record<string, string>;
  confidenceMap: Record<string, number>;
  /** Whether user should review before writing. */
  requiresReview: boolean;
  schemaHash: string;
  worksheetName: string;
  headers: string[];
}

export interface MapSchemaOptions {
  /** Confidence threshold for requiring user review (0-1). Default 0.8. */
  confidenceThreshold?: number;
}

/**
 * Produce column->field mapping from schema (and optional invoice for future use).
 * Uses existing keyword + learned + pattern strategies.
 */
export async function mapSchemaToFields(
  schema: ExcelSchema,
  options?: MapSchemaOptions
): Promise<FieldMapping> {
  const reviewThreshold = options?.confidenceThreshold ?? DEFAULT_REVIEW_THRESHOLD;
  const result = await autoMatchHeadersAdvanced(schema.headers, undefined, {
    columnSamples:
      schema.columnSamples && schema.columnSamples.length > 0 ? schema.columnSamples : undefined,
  });
  const confidences = Object.values(result.confidenceMap);
  const minConf = confidences.length ? Math.min(...confidences) : 1;
  const avgConf =
    confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 1;
  const requiresReview =
    avgConf < reviewThreshold || minConf < LOW_FIELD_THRESHOLD || confidences.length === 0;

  return {
    columnToField: result.columnToField as Record<string, string>,
    confidenceMap: result.confidenceMap,
    requiresReview,
    schemaHash: schema.schemaHash,
    worksheetName: schema.worksheetName,
    headers: schema.headers,
  };
}

export { colIndexToLetter };
