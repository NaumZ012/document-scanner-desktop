import type { StrategyResult, AggregatedMatch } from "./types";
import { STRATEGY_WEIGHTS } from "./types";

/**
 * Aggregate strategy results per (fieldKey, columnLetter) with weighted confidence,
 * consensus bonus, and disagreement penalty.
 */
export function aggregateStrategyResults(
  results: StrategyResult[]
): AggregatedMatch[] {
  const byKey = new Map<string, StrategyResult[]>();

  for (const r of results) {
    const key = `${r.fieldKey}:${r.columnLetter}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }

  const aggregated: AggregatedMatch[] = [];

  for (const [, list] of byKey) {
    if (list.length === 0) continue;

    const first = list[0];

    let weightedSum = 0;
    let weightTotal = 0;

    for (const r of list) {
      const w = STRATEGY_WEIGHTS[r.strategyName] ?? 0.75;
      weightedSum += r.confidence * w;
      weightTotal += w;
    }

    const baseConfidence = weightTotal > 0 ? weightedSum / weightTotal : 0;

    const numStrategies = list.length;
    let consensusBonus = 0;
    if (numStrategies >= 4) consensusBonus = 0.15;
    else if (numStrategies === 3) consensusBonus = 0.1;
    else if (numStrategies === 2) consensusBonus = 0.05;

    const confidences = list.map((r) => r.confidence);
    const meanConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const variance =
      confidences.reduce((sum, c) => sum + (c - meanConf) ** 2, 0) / confidences.length;
    const stdDev = Math.sqrt(variance);

    let disagreementPenalty = 0;
    if (stdDev > 0.2) disagreementPenalty = 0.1;
    else if (stdDev > 0.1) disagreementPenalty = 0.05;

    const hasLearned = list.some((r) => r.strategyName === "learned_mapping");
    const learnedBonus = hasLearned ? 0.08 : 0;

    let finalConfidence =
      baseConfidence + consensusBonus - disagreementPenalty + learnedBonus;
    finalConfidence = Math.max(0, Math.min(0.98, finalConfidence));

    aggregated.push({
      columnIndex: first.columnIndex,
      columnLetter: first.columnLetter,
      fieldKey: first.fieldKey,
      confidence: finalConfidence,
      evidenceList: list.map((r) => r.evidence),
      numStrategies,
    });
  }

  aggregated.sort((a, b) => b.confidence - a.confidence);
  return aggregated;
}
