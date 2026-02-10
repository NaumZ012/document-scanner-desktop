import { upsertLearnedMapping } from "@/services/api";
import type { ExcelSchema } from "@/shared/types";
import type { FieldMapping } from "./mappingService";
import { colIndexToLetter } from "./mappingService";

/**
 * Record the final mapping choices for learning (so next time we suggest better).
 */
export async function recordMapping(schema: ExcelSchema, mapping: FieldMapping): Promise<void> {
  const colToIndex: Record<string, number> = {};
  schema.headers.forEach((_, i) => {
    colToIndex[colIndexToLetter(i)] = i;
  });
  for (const [colLetter, fieldKey] of Object.entries(mapping.columnToField)) {
    if (!fieldKey) continue;
    const columnIndex = colToIndex[colLetter] ?? 0;
    try {
      await upsertLearnedMapping({
        schema_hash: schema.schemaHash,
        field_type: fieldKey,
        column_index: columnIndex,
        column_letter: colLetter,
        action: "ACCEPT",
      });
    } catch {
      // non-fatal
    }
  }
}
