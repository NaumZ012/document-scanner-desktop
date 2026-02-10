import type { FieldKey } from "@/shared/constants";

/** Result from a single matching strategy for one (field, column) pair. */
export interface StrategyResult {
  strategyName: string;
  columnIndex: number;
  columnLetter: string;
  fieldKey: FieldKey;
  confidence: number;
  evidence: string;
}

/** Per-column aggregated match after evidence fusion. */
export interface AggregatedMatch {
  columnIndex: number;
  columnLetter: string;
  fieldKey: FieldKey;
  confidence: number;
  evidenceList: string[];
  numStrategies: number;
}

/** Final mapping output: column letter -> field with confidence and evidence. */
export interface MappingResult {
  columnToField: Record<string, FieldKey>;
  confidenceMap: Record<string, number>;
  evidenceMap: Record<string, string[]>;
}

/** Match mode for keyword patterns. */
export type KeywordMatchMode = "ANY_REQUIRED" | "ALL_REQUIRED" | "WEIGHTED";

/** Strategy weight configuration. */
export const STRATEGY_WEIGHTS: Record<string, number> = {
  learned_mapping: 1.0,
  keyword_matching: 0.85,
  semantic_embedding: 0.9,
  pattern_matching: 0.75,
  positional_heuristic: 0.4,
  data_type_alignment: 0.65,
};
