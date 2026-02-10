import type { InvoiceData } from "@/shared/types";
import type { ExtractedField } from "@/shared/types";
import { FIELD_KEYS, FIELD_LABELS } from "@/shared/constants";
import type { FieldKey } from "@/shared/constants";

/**
 * Build ExtractedField[] from Azure prebuilt-invoice InvoiceData for the Review UI.
 */
export function invoiceDataToFields(data: InvoiceData): ExtractedField[] {
  return FIELD_KEYS.map((key) => {
    const field = data.fields[key as string];
    const value = field?.value ?? "";
    return {
      key,
      value,
      confidence: field?.confidence,
      label: FIELD_LABELS[key as FieldKey],
    };
  });
}
