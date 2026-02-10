import { getLearnedMapping } from "@/services/api";
import type { FieldKey } from "@/shared/constants";
import type { StrategyResult } from "./types";
import { colIndexToLetter } from "./utils";

/**
 * Run learned mapping strategy using pre-fetched learned mappings.
 * Returns strategy results for each (field, column) where we have a learned mapping.
 */
export function runLearnedMappingStrategy(
  learnedMap: Map<string, { columnLetter: string; confidence: number }>,
  headers: string[]
): StrategyResult[] {
  const results: StrategyResult[] = [];
  const colLetterToIndex = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    colLetterToIndex.set(colIndexToLetter(i), i);
  }

  for (const [fieldKey, { columnLetter, confidence }] of learnedMap) {
    const colIdx = colLetterToIndex.get(columnLetter);
    if (colIdx === undefined) continue;
    results.push({
      strategyName: "learned_mapping",
      columnIndex: colIdx,
      columnLetter,
      fieldKey: fieldKey as FieldKey,
      confidence,
      evidence: "learned from user correction",
    });
  }
  return results;
}

/**
 * Fetch all learned mappings for a schema. Returns a map of fieldKey -> { columnLetter, confidence }.
 */
export async function fetchLearnedMappings(
  schemaHash: string,
  fieldKeys: readonly string[]
): Promise<Map<string, { columnLetter: string; confidence: number }>> {
  const map = new Map<string, { columnLetter: string; confidence: number }>();
  const promises = fieldKeys.map(async (fk) => {
    try {
      const result = await getLearnedMapping(schemaHash, fk);
      if (result) {
        map.set(fk, { columnLetter: result[0], confidence: result[1] });
      }
    } catch {
      // ignore
    }
  });
  await Promise.all(promises);
  return map;
}
