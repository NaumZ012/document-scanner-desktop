import type { InvoiceData } from "@/shared/types";
import type { ExtractedField } from "@/shared/types";
import { FIELD_KEYS, FIELD_LABELS_MK, TAX_FIELD_LABELS_MK } from "@/shared/constants";
import { sanitizeDescription } from "@/utils/parseAzureExtraction";
import type { FieldKey } from "@/shared/constants";

const NRE_LABELS: Record<string, string> = {
  lineNumber: "Бр. ред",
  label: "Назив",
  amount: "Износ",
};

function getLabelForKey(key: string): string {
  if (FIELD_KEYS.includes(key as FieldKey)) {
    return FIELD_LABELS_MK[key as FieldKey];
  }
  if (TAX_FIELD_LABELS_MK[key]) {
    return TAX_FIELD_LABELS_MK[key];
  }
  const nreMatch = key.match(/^nonRecognizedExpenseRows_(\d+)_(lineNumber|label|amount)$/);
  if (nreMatch) {
    const row = Number(nreMatch[1]) + 1;
    const part = NRE_LABELS[nreMatch[2]] ?? nreMatch[2];
    return `Непризнаени расходи (ред ${row}) — ${part}`;
  }
  return key;
}

/**
 * Build ExtractedField[] from OCR/analyzer result for the Review UI.
 * Includes all keys from data.fields (invoice + tax/smetka and any custom analyzer fields).
 */
export function invoiceDataToFields(data: InvoiceData): ExtractedField[] {
  const seen = new Set<string>();
  const result: ExtractedField[] = [];

  // Known invoice keys first, in FIELD_KEYS order (so grouping and order are stable).
  for (const key of FIELD_KEYS) {
    seen.add(key);
    const field = data.fields[key];
    let value = field?.value ?? "";
    if (key === "description" && value) {
      value = sanitizeDescription(value);
    }
    result.push({
      key,
      value,
      confidence: field?.confidence,
      label: getLabelForKey(key),
    });
  }

  // All other keys from the analyzer (tax/smetka and any extra fields).
  for (const key of Object.keys(data.fields)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const field = data.fields[key];
    let value = field?.value ?? "";
    if (key === "description" && value) {
      value = sanitizeDescription(value);
    }
    result.push({
      key,
      value,
      confidence: field?.confidence,
      label: getLabelForKey(key),
    });
  }

  return result;
}
