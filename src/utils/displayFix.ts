/**
 * Display values as-is from OCR (no post-processing).
 */

export function fixDisplayValue(value: string): string {
  return value ?? "";
}
