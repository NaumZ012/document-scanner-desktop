import { distance } from "fastest-levenshtein";
import { HEADER_KEYWORDS, FIELD_LABELS } from "@/shared/constants";
import type { FieldKey } from "@/shared/constants";
import type { StrategyResult } from "./types";
import { normalizeHeader, colIndexToLetter } from "./utils";

const FUZZY_THRESHOLD = 0.85;

/**
 * Compute similarity between two strings using Levenshtein distance.
 * Returns a value in [0, 1] where 1 = exact match.
 */
function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = distance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Fuzzy keyword matching strategy using Levenshtein distance.
 * For each column header, finds the best matching field based on keyword patterns.
 * Uses ANY_REQUIRED mode: at least one keyword must match (with fuzzy threshold).
 */
export function runKeywordStrategy(
  headers: string[],
  fieldKeys: readonly FieldKey[]
): StrategyResult[] {
  const results: StrategyResult[] = [];

  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const headerText = headers[colIdx];
    if (!headerText || !headerText.trim()) continue;

    const normalized = normalizeHeader(headerText);
    const tokens = normalized.split(/\s+/).filter(Boolean);

    for (const fieldKey of fieldKeys) {
      const keywords = HEADER_KEYWORDS[fieldKey];
      if (!keywords) continue;

      let bestPatternScore = 0;

      for (const kw of keywords) {
        const kwNorm = normalizeHeader(kw);
        if (!kwNorm) continue;

        let bestTokenMatch = 0;

        for (const token of tokens) {
          const sim = stringSimilarity(token, kwNorm);
          if (sim >= FUZZY_THRESHOLD && sim > bestTokenMatch) {
            bestTokenMatch = sim;
          }
        }

        if (bestTokenMatch > 0) {
          bestPatternScore = Math.max(bestPatternScore, bestTokenMatch);
        }

        if (normalized.includes(kwNorm) || kwNorm.includes(normalized) || normalized === kwNorm) {
          bestPatternScore = Math.max(bestPatternScore, 1.0);
        }
      }

      const label = FIELD_LABELS[fieldKey];
      if (label) {
        const labelNorm = normalizeHeader(label);
        if (labelNorm === normalized) {
          bestPatternScore = Math.max(bestPatternScore, 1.0);
        } else if (tokens.some((t) => stringSimilarity(t, labelNorm) >= FUZZY_THRESHOLD)) {
          bestPatternScore = Math.max(bestPatternScore, 0.9);
        }
      }

      if (bestPatternScore >= FUZZY_THRESHOLD) {
        results.push({
          strategyName: "keyword_matching",
          columnIndex: colIdx,
          columnLetter: colIndexToLetter(colIdx),
          fieldKey,
          confidence: Math.min(0.95, bestPatternScore),
          evidence: `keyword match (${bestPatternScore.toFixed(2)})`,
        });
      }
    }
  }

  return results;
}
