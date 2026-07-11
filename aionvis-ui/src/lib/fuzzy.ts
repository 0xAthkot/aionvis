/**
 * Tiny dependency-free fuzzy matcher for list filtering. A query matches
 * when it's a case-insensitive substring OR its characters appear in order
 * (subsequence) in the target — "whsfty" finds "warehouse-safety".
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

/** True when the query fuzzy-matches ANY of the given targets. */
export function fuzzyAny(
  query: string,
  ...targets: (string | undefined | null)[]
): boolean {
  if (!query.trim()) return true;
  return targets.some((t) => !!t && fuzzyMatch(query, t));
}
