import type { ExtractedField } from "@/shared/types";
import type { FieldKey } from "@/shared/constants";
import { FIELD_GROUPS, FIELD_INPUT_TYPE, GROUP_LABELS } from "@/shared/constants";
import { colIndexToLetter } from "@/utils/matching";

const GROUP_ORDER: (keyof typeof FIELD_GROUPS)[] = [
  "document",
  "seller",
  "buyer",
  "amounts",
  "other",
];

const CURRENCY_MAP: Record<string, string> = {
  din: "RSD",
  ден: "MKD",
  "ден.": "MKD",
  mkd: "MKD",
  rsd: "RSD",
  eur: "EUR",
  usd: "USD",
};

/** Format a YYYY-MM-DD date for display according to user preference. */
export function formatDateForDisplay(
  isoDate: string,
  dateFormat: "DMY" | "YMD"
): string {
  if (!isoDate || !isoDate.trim()) return isoDate;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  if (dateFormat === "DMY") {
    return `${d}.${mo}.${y}`;
  }
  return `${y}-${mo}-${d}`;
}

/** Normalize/format extracted value for display. dateFormat affects date output. */
export function formatFieldValue(
  key: FieldKey,
  value: string,
  dateFormat: "DMY" | "YMD" = "DMY"
): string {
  if (!value || !value.trim()) return value;
  const v = value.trim();

  if (FIELD_INPUT_TYPE[key] === "date") {
    const m = v.match(/(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
    if (m) {
      const [, d, mo, y] = m;
      const year = y.length === 2 ? `20${y}` : y;
      const iso = `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      return dateFormat === "DMY" ? `${d.padStart(2, "0")}.${mo.padStart(2, "0")}.${year}` : iso;
    }
  }

  if (FIELD_INPUT_TYPE[key] === "amount") {
    const cleaned = v.replace(/\s/g, "").replace(/\u00a0/g, "").replace(/,/g, ".");
    return cleaned;
  }

  if (key === "currency") {
    const norm = v.replace(/[€$]/g, "").trim().toLowerCase();
    return CURRENCY_MAP[norm] ?? v.toUpperCase();
  }

  return v;
}

/** Group and sort fields: filled first, then by logical group order. */
export function sortFieldsByData(fields: ExtractedField[]): ExtractedField[] {
  const filled = fields.filter((f) => f.value && f.value.trim());
  const empty = fields.filter((f) => !f.value || !f.value.trim());

  const keyToGroup = new Map<string, keyof typeof FIELD_GROUPS>();
  for (const g of GROUP_ORDER) {
    for (const k of FIELD_GROUPS[g]) {
      keyToGroup.set(k, g);
    }
  }

  const sortByGroup = (a: ExtractedField, b: ExtractedField) => {
    const ga = GROUP_ORDER.indexOf(keyToGroup.get(a.key) ?? "other");
    const gb = GROUP_ORDER.indexOf(keyToGroup.get(b.key) ?? "other");
    if (ga !== gb) return ga - gb;
    return fields.findIndex((f) => f.key === a.key) - fields.findIndex((f) => f.key === b.key);
  };

  return [...filled.sort(sortByGroup), ...empty.sort(sortByGroup)];
}

/** Group fields for section display. Preserves field order from sorted list. */
export function groupFieldsForDisplay(
  fields: ExtractedField[]
): { group: keyof typeof FIELD_GROUPS; label: string; fields: ExtractedField[] }[] {
  return GROUP_ORDER.map((group) => {
    const keys = FIELD_GROUPS[group];
    const groupFields = fields.filter((f) => keys.includes(f.key as never));
    return { group, label: GROUP_LABELS[group], fields: groupFields };
  }).filter((g) => g.fields.length > 0);
}

const HEADER_ROW_KEY = "_headerRow";
const SCHEMA_HASH_KEY = "_schemaHash";

/** Synthetic key prefix for Excel columns that have no semantic field mapping (e.g. col_A). */
export const COLUMN_KEY_PREFIX = "col_";

/**
 * Build display fields from the selected Excel profile: one field per column (mapped or unmapped),
 * in Excel column order (A, B, C...), with the Excel header as label.
 * Mapped columns use semantic field_key; unmapped columns use synthetic key "col_A", "col_B", etc.
 */
export function buildProfileDisplayFields(
  headers: string[],
  columnMapping: Record<string, string>,
  currentFields: ExtractedField[]
): ExtractedField[] {
  const keyToValue = new Map(currentFields.map((f) => [f.key, f.value]));
  const keyToConfidence = new Map(
    currentFields.filter((f) => f.confidence != null).map((f) => [f.key, f.confidence!])
  );
  const result: ExtractedField[] = [];
  for (let i = 0; i < headers.length; i++) {
    const colLetter = colIndexToLetter(i);
    if (colLetter === HEADER_ROW_KEY || colLetter === SCHEMA_HASH_KEY) continue;
    const fieldKey = columnMapping[colLetter];
    const key = fieldKey ?? `${COLUMN_KEY_PREFIX}${colLetter}`;
    const label = (headers[i] ?? colLetter).trim() || colLetter;
    result.push({
      key,
      value: keyToValue.get(key) ?? "",
      confidence: keyToConfidence.get(key),
      label,
    });
  }
  return result;
}
