import type { FieldKey } from "@/shared/constants";

export interface CompiledPattern {
  regex: RegExp;
  weight: number;
}

/** Regex patterns per field type for pattern-based matching on sample values. */
export const PATTERN_LIBRARY: Partial<Record<FieldKey, CompiledPattern[]>> = {
  invoice_number: [
    { regex: /^\d{1,10}[\/-]\d{1,10}$/, weight: 0.9 },
    { regex: /^\d{5,15}$/, weight: 0.75 },
    { regex: /^[A-Z]{2,5}\d{5,10}$/i, weight: 0.85 },
    { regex: /^\d{1,3}[\/-]\d{2,4}$/, weight: 0.88 },
  ],
  date: [
    { regex: /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/, weight: 0.9 },
    { regex: /^\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}$/, weight: 0.9 },
    { regex: /^\d{4}-\d{2}-\d{2}$/, weight: 0.95 },
  ],
  due_date: [
    { regex: /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/, weight: 0.9 },
    { regex: /^\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}$/, weight: 0.9 },
  ],
  net_amount: [
    { regex: /^[\d\s.,]+$/, weight: 0.8 },
    { regex: /^-?[\d\s.,]+$/, weight: 0.85 },
  ],
  tax_amount: [
    { regex: /^[\d\s.,]+$/, weight: 0.8 },
    { regex: /^-?[\d\s.,]+$/, weight: 0.85 },
  ],
  total_amount: [
    { regex: /^[\d\s.,]+$/, weight: 0.8 },
    { regex: /^-?[\d\s.,]+$/, weight: 0.85 },
  ],
  currency: [
    { regex: /^(RSD|EUR|USD|MKD|ден|din|€|\$|BAM|HRK)$/i, weight: 0.95 },
    { regex: /^[A-Z]{3}$/, weight: 0.85 },
  ],
  seller_tax_id: [
    { regex: /^\d{8,15}$/, weight: 0.85 },
    { regex: /^[A-Z]{2}\d{8,12}$/i, weight: 0.9 },
  ],
  buyer_tax_id: [
    { regex: /^\d{8,15}$/, weight: 0.85 },
    { regex: /^[A-Z]{2}\d{8,12}$/i, weight: 0.9 },
  ],
};
