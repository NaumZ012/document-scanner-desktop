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
  euro: "EUR",
  usd: "USD",
  dollar: "USD",
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
    // Format amount for display with comma as thousands separator
    return formatAmountForDisplay(v);
  }

  if (key === "currency") {
    const norm = v.replace(/[€$]/g, "").trim().toLowerCase();
    return CURRENCY_MAP[norm] ?? v.toUpperCase();
  }

  // document_type: Keep as-is from Azure OCR, no translation or normalization
  // if (key === "document_type") {
  //   return v; // Already handled by returning v at the end
  // }

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

const DOCUMENT_TYPE_LABEL = "Тип на документ";

/**
 * Format a numeric value for display: comma as thousands separator, comma as decimal separator (European/Macedonian format).
 * Handles both "151.565,00" (European format) and "151565.00" (standard format) as input.
 * Returns formatted string like "151,565,00" (comma for both thousands and decimals)
 * If the decimal part is zero (.00), displays as whole number without decimals (e.g., "151,565")
 */
export function formatAmountForDisplay(value: string): string {
  if (!value || !value.trim()) return value;
  const cleaned = value.replace(/\s/g, "").replace(/\u00a0/g, "");
  
  // Check if it's European format (dot as thousands, comma as decimal): "151.565,00"
  const europeanFormat = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(cleaned);
  
  // Check if it's already formatted with comma as thousands and period as decimal: "514,327.00"
  const commaThousandsPeriodDecimal = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(cleaned);
  
  let num: number;
  if (europeanFormat) {
    // European format: "151.565,00" -> parse as "151565.00"
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    num = parseFloat(normalized);
  } else if (commaThousandsPeriodDecimal) {
    // Already formatted: "514,327.00" -> parse as "514327.00" (remove comma thousands separator)
    const normalized = cleaned.replace(/,/g, "");
    num = parseFloat(normalized);
  } else {
    // Standard format: "151565.00" or "151565,00" or "151565"
    num = parseFloat(cleaned.replace(/,/g, "."));
  }
  
  if (Number.isNaN(num)) return value;
  
  // Check if it's a whole number (handle floating point precision issues)
  // Use a small epsilon to account for floating point errors (e.g., 514327.0000001 should be treated as whole)
  const epsilon = 0.0001;
  const remainder = Math.abs(num % 1);
  const isWholeNumber = remainder < epsilon || remainder > (1 - epsilon);
  
  if (isWholeNumber) {
    // Format as whole number without decimals (round to nearest integer to handle precision issues)
    // Example: 514327.00 -> "514,327" (comma as thousands separator, no decimal part)
    const wholeNum = Math.round(num);
    const intPart = Math.abs(wholeNum).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return wholeNum < 0 ? `-${intPart}` : intPart;
  } else {
    // Format with comma as thousands separator and comma as decimal separator (European format)
    // Example: 514327.33 -> "514,327,33"
    const parts = num.toFixed(2).split(".");
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decPart = parts[1];
    // Remove trailing zeros from decimal part
    const trimmedDec = decPart.replace(/0+$/, "");
    return trimmedDec ? `${intPart},${trimmedDec}` : intPart;
  }
}

/**
 * Format a numeric value for Excel: comma as thousands separator, period as decimal (Excel standard).
 * Handles both "50343.12" and "50343,12" as input.
 * Note: Excel uses period for decimals, so we format differently than display.
 */
export function formatNumberForExcel(value: string): string {
  if (!value || !value.trim()) return value;
  const cleaned = value.replace(/\s/g, "").replace(/\u00a0/g, "");
  
  // Check if it's European format (dot as thousands, comma as decimal)
  const europeanFormat = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(cleaned);
  
  let num: number;
  if (europeanFormat) {
    // European format: "151.565,00" -> parse as "151565.00"
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    num = parseFloat(normalized);
  } else {
    // Standard format: "151565.00" or "151565,00"
    num = parseFloat(cleaned.replace(/,/g, "."));
  }
  
  if (Number.isNaN(num)) return value;
  
  // Format with comma as thousands separator and period as decimal separator (Excel format)
  const parts = num.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decPart = parts[1];
  return decPart ? `${intPart}.${decPart}` : intPart;
}

/**
 * Build display fields from the selected Excel profile: one field per column (mapped or unmapped),
 * in Excel column order (A, B, C...), with the Excel header as label.
 * Document type (Тип на документ) is always shown first for preview/export.
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
  // Ensure document type is first in preview (Тип на документ)
  const docTypeField = result.find((f) => f.key === "document_type");
  const rest = result.filter((f) => f.key !== "document_type");
  if (docTypeField) {
    return [{ ...docTypeField, label: DOCUMENT_TYPE_LABEL }, ...rest];
  }
  return [
    {
      key: "document_type",
      value: keyToValue.get("document_type") ?? "Фактура",
      confidence: keyToConfidence.get("document_type"),
      label: DOCUMENT_TYPE_LABEL,
    },
    ...result,
  ];
}
