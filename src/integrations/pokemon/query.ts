import type { NormalizedQuery } from "../../services/search/normalize.ts";

/**
 * Escape a value for use in a pokemontcg.io Lucene query token.
 *
 * Punctuation becomes a SPACE, never nothing. Deleting it glued the halves of a
 * name together — "Lucario-GX" searched as `name:lucariogx*` and "Farfetch'd"
 * as `name:farfetchd*` — and a prefix that matches no card returns zero results
 * rather than an error, so every hyphenated and apostrophised Pokémon in the
 * catalog was simply unfindable and said "No cards found" about itself.
 *
 * As a separator it is also more accurate than a deletion: the punctuation in
 * these names is a word boundary, which is exactly what a space means to the
 * tokeniser that reads the result.
 */
export function escapeLuceneValue(value: string): string {
  // Keep it conservative: alphanumerics + spaces only for the wildcard token.
  return value
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Set ids are alphanumeric with hyphens (e.g. "sv3", "swsh7", "base1"). */
export function escapeSetId(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "");
}

/**
 * Build the `q` parameter for pokemontcg.io from a normalized query. We prefix-
 * match the name, add a collector-number constraint when present, and optionally
 * restrict to a set of rarities; client-side ranking then orders the results
 * (see services/search/rank.ts).
 */
export function buildLuceneQuery(nq: NormalizedQuery, rarities?: string[]): string {
  const clauses: string[] = [];

  if (nq.name) {
    const cleaned = escapeLuceneValue(nq.name);
    const tokens = cleaned.split(" ").filter(Boolean);
    if (tokens.length >= 1) {
      // Prefix-match the leading token (broad), rank narrows the rest.
      clauses.push(`name:${tokens[0]}*`);
    }
  }

  if (nq.collectorNumber) {
    clauses.push(`number:${nq.collectorNumber}`);
  }

  if (rarities && rarities.length > 0) {
    const ors = rarities.map((r) => `rarity:"${r}"`).join(" OR ");
    clauses.push(`(${ors})`);
  }

  return clauses.join(" ");
}
