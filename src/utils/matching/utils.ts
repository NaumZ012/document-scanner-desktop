/**
 * Convert column index (0-based) to Excel column letter (A, B, ..., Z, AA, AB, ...).
 */
export function colIndexToLetter(col: number): string {
  let s = "";
  let n = col;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/**
 * Normalize header text for matching: lowercase, trim, collapse spaces, remove punctuation.
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/_/g, " ");
}
