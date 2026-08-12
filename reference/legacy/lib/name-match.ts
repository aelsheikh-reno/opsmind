export type PotentialNameMatch = {
  newPersonId: string;
  newName: string;
  existingPersonId: string;
  existingName: string;
  newSource?: "contract" | "payroll";
  existingSource?: "contract" | "payroll";
  newJobTitle?: string | null;
  existingJobTitle?: string | null;
};

/** Split on whitespace AND hyphens; strip trailing dots (initials). */
export function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .trim()
    .split(/[\s\-]+/)
    .map((t) => t.replace(/\.$/, ""))
    .filter(Boolean);
}

/**
 * Two tokens are considered a match if:
 * - They are identical, OR
 * - One is a single-letter initial of the other ("M" matches "Mohamed")
 */
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  return false;
}

/**
 * Smart similarity for Arabic-style full names.
 *
 * Rules applied in order:
 * 1. Exact tokenized match → 1.0
 * 2. First-token + last-token both match → 0.85 (minimum; subset score wins if higher)
 *    Catches "Mohamed Elsheikh" vs "Mohamed Yousry Hassan Aly Elsheikh"
 * 3. Subset score: fraction of the shorter name's tokens that appear in the longer name
 *    (uses tokenMatch, so initials count)
 */
export function smartSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);

  if (ta.join(" ") === tb.join(" ")) return 1.0;

  const shorter = ta.length <= tb.length ? ta : tb;
  const longer  = ta.length <= tb.length ? tb : ta;

  let hits = 0;
  for (const st of shorter) {
    if (longer.some((lt) => tokenMatch(st, lt))) hits++;
  }
  const subsetScore = hits / shorter.length;

  // First + last token match is a strong signal regardless of middle names
  const aFirst = ta[0],     aLast = ta[ta.length - 1];
  const bFirst = tb[0],     bLast = tb[tb.length - 1];
  if (tokenMatch(aFirst, bFirst) && tokenMatch(aLast, bLast)) {
    return Math.max(subsetScore, 0.85);
  }

  return subsetScore;
}

/**
 * Returns persons from existingPersons whose names are a partial (but not exact)
 * match to newName, sorted by similarity descending.
 */
export function findPotentialMatches(
  newPersonId: string,
  newName: string,
  existingPersons: Array<{ id: string; name: string }>,
  threshold = 0.6
): PotentialNameMatch[] {
  const normalizedNew = tokenize(newName).join(" ");
  return existingPersons
    .filter((p) => p.id !== newPersonId)
    .map((p) => ({ p, sim: smartSimilarity(newName, p.name) }))
    .filter(({ p, sim }) => sim >= threshold && tokenize(p.name).join(" ") !== normalizedNew)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 2)
    .map(({ p }) => ({
      newPersonId,
      newName,
      existingPersonId: p.id,
      existingName: p.name,
    }));
}
