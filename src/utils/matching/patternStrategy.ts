import type { FieldKey } from "@/shared/constants";
import type { StrategyResult } from "./types";
import { PATTERN_LIBRARY } from "./patternLibrary";
import { colIndexToLetter } from "./utils";

/**
 * Run pattern matching strategy on column sample values.
 * For each (field, column) pair, computes match ratio and confidence.
 */
export function runPatternStrategy(
  columnSamples: string[][],
  fieldKeys: readonly FieldKey[]
): StrategyResult[] {
  const results: StrategyResult[] = [];

  for (let colIdx = 0; colIdx < columnSamples.length; colIdx++) {
    const samples = columnSamples[colIdx]?.filter((s) => s.trim()) ?? [];
    if (samples.length === 0) continue;

    const colLetter = colIndexToLetter(colIdx);

    for (const fieldKey of fieldKeys) {
      const patterns = PATTERN_LIBRARY[fieldKey as FieldKey];
      if (!patterns || patterns.length === 0) continue;

      let totalMatches = 0;
      const patternCounts = new Map<number, number>();

      for (const sample of samples) {
        for (let i = 0; i < patterns.length; i++) {
          if (patterns[i].regex.test(sample.trim())) {
            patternCounts.set(i, (patternCounts.get(i) ?? 0) + 1);
            totalMatches++;
            break;
          }
        }
      }

      const matchRatio = totalMatches / samples.length;
      if (matchRatio < 0.3) continue;

      let bestWeight = 0.75;
      for (const [idx, count] of patternCounts) {
        if (count > 0) {
          const w = patterns[idx]?.weight ?? 0.75;
          if (w > bestWeight) bestWeight = w;
        }
      }

      let confidence = matchRatio * bestWeight;

      if (samples.length < 5) {
        confidence *= samples.length / 5;
      }

      if (confidence >= 0.3) {
        results.push({
          strategyName: "pattern_matching",
          columnIndex: colIdx,
          columnLetter: colLetter,
          fieldKey: fieldKey as FieldKey,
          confidence: Math.min(0.95, confidence),
          evidence: `pattern match ${Math.round(matchRatio * 100)}% (${samples.length} samples)`,
        });
      }
    }
  }

  return results;
}
