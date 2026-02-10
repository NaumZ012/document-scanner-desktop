import { FIELD_KEYS } from "@/shared/constants";
import type { FieldKey } from "@/shared/constants";
import { runKeywordStrategy } from "./keywordStrategy";
import { runLearnedMappingStrategy, fetchLearnedMappings } from "./learnedMappingStrategy";
import { runPatternStrategy } from "./patternStrategy";
import { aggregateStrategyResults } from "./aggregator";
import { optimizeMapping } from "./optimizer";
import { computeSchemaHash } from "./schemaHash";
import type { MappingResult } from "./types";

export { colIndexToLetter } from "./utils";
export { computeSchemaHash } from "./schemaHash";
export type { MappingResult, StrategyResult, AggregatedMatch } from "./types";

export interface AutoMatchOptions {
  /** Sample values per column (columns × rows) for pattern matching. */
  columnSamples?: string[][];
}

/**
 * Auto-match Excel headers to field keys using multi-strategy matching.
 * Returns column->field mapping with confidence and evidence.
 */
export async function autoMatchHeadersAdvanced(
  headers: string[],
  fieldKeys: readonly FieldKey[] = FIELD_KEYS,
  options?: AutoMatchOptions
): Promise<MappingResult> {
  const schemaHash = computeSchemaHash(headers);
  const learnedMap = await fetchLearnedMappings(schemaHash, fieldKeys);
  const keywordResults = runKeywordStrategy(headers, fieldKeys);
  const learnedResults = runLearnedMappingStrategy(learnedMap, headers);
  let results = [...keywordResults, ...learnedResults];

  if (options?.columnSamples && options.columnSamples.length > 0) {
    const patternResults = runPatternStrategy(options.columnSamples, fieldKeys);
    results = [...results, ...patternResults];
  }

  const aggregated = aggregateStrategyResults(results);
  return optimizeMapping(aggregated, fieldKeys);
}

/**
 * Legacy-compatible: return only column->field Record (no confidence/evidence).
 */
export async function autoMatchHeadersLegacy(headers: string[]): Promise<Record<string, string>> {
  const { columnToField } = await autoMatchHeadersAdvanced(headers);
  return columnToField;
}
