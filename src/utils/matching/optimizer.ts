import type { FieldKey } from "@/shared/constants";
import type { AggregatedMatch, MappingResult } from "./types";

const MIN_CONFIDENCE = 0.3;

/**
 * Greedy assignment: assign each field to at most one column, each column to at most one field.
 * Sort fields by selectivity (fewer high-confidence candidates first), then assign best available.
 */
export function optimizeMapping(
  aggregated: AggregatedMatch[],
  fieldKeys: readonly FieldKey[]
): MappingResult {
  const columnToField: Record<string, FieldKey> = {};
  const confidenceMap: Record<string, number> = {};
  const evidenceMap: Record<string, string[]> = {};

  const byField = new Map<FieldKey, AggregatedMatch[]>();
  for (const m of aggregated) {
    const list = byField.get(m.fieldKey) ?? [];
    list.push(m);
    byField.set(m.fieldKey, list);
  }

  const highConfCount = (fk: FieldKey) =>
    (byField.get(fk) ?? []).filter((m) => m.confidence >= 0.7).length;
  const sortedFields = [...fieldKeys].sort((a, b) => highConfCount(a) - highConfCount(b));

  const usedColumns = new Set<string>();

  for (const fk of sortedFields) {
    const candidates = (byField.get(fk) ?? [])
      .filter((m) => !usedColumns.has(m.columnLetter))
      .sort((a, b) => b.confidence - a.confidence);

    const best = candidates[0];
    if (!best || best.confidence < MIN_CONFIDENCE) continue;

    columnToField[best.columnLetter] = fk;
    confidenceMap[best.columnLetter] = best.confidence;
    evidenceMap[best.columnLetter] = best.evidenceList;
    usedColumns.add(best.columnLetter);
  }

  return { columnToField, confidenceMap, evidenceMap };
}
