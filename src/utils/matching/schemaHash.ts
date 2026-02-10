/**
 * Compute a deterministic schema hash from column headers.
 * Used to identify Excel structure for learned mappings.
 */
export function computeSchemaHash(headers: string[]): string {
  const normalized = [...headers].sort().join("|");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
