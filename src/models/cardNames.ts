/**
 * Card-name autofill: the matching and the ranking.
 *
 * Pure, and shared by both UI versions — see `docs/card-name-autofill.md`.
 * Nothing here touches React, the DOM or the network, because everything worth
 * arguing about in this feature is a ranking decision and those are only
 * arguable if they are testable.
 *
 * **Suggestions never hit the network.** The catalog fails roughly a quarter of
 * the time in bursts and rate-limits, which is why this app searches on submit
 * and not on keystroke. Autofill is answered from a 25KB file of distinct
 * names, on the device, or it is not answered at all.
 */

/** A name and how many printings carry it. The shipped file's row shape. */
export type NameRow = [name: string, printings: number];

export interface Suggestion {
  /** The card's real name, exactly as it will appear in results. */
  name: string;
  printings: number;
}

/**
 * The comparison form.
 *
 * This catalog contains `Charizard δ`, `Charizard ★ δ`, `Charizard-EX` and
 * `Charizard & Braixen-GX`. Somebody typing "charizard ex" means the third one
 * and should not have to guess the hyphen; somebody typing "charizard d"
 * should still reach the delta.
 *
 * NFKD splits accented letters into base + combining mark, which the mark range
 * then removes, so `é` folds to `e`. Everything that is not a letter or digit
 * collapses to a single space, which is what makes `-EX`, ` ex` and `&` all
 * meet in the middle.
 */
export function foldName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * How well a name matches, as a tier. Lower is better; -1 is no match.
 *
 * The tiers exist because alphabetical order is actively wrong here: typing
 * "char" and being offered `Charcadet` before `Charizard` is the failure this
 * ranking is built to avoid.
 */
function tier(folded: string, query: string): number {
  if (folded === query) return 0;
  if (folded.startsWith(query)) return 1;
  // A word-prefix: "brai" should reach `Charizard & Braixen-GX`, but it is a
  // weaker signal than the name simply starting with what you typed.
  if (folded.includes(` ${query}`)) return 2;
  if (folded.includes(query)) return 3;
  return -1;
}

/** Nothing is suggested for one character — a single letter matches hundreds. */
export const MIN_QUERY = 2;

/**
 * A glance, not a scroll. On a phone a longer list covers the field you are
 * typing into, which is the one thing it must not hide.
 */
export const MAX_SUGGESTIONS = 8;

/**
 * The best names for what has been typed so far.
 *
 * Ranked by tier, then by **printings**, then alphabetically. The printings
 * count is the whole reason it ships beside the name: "pik" has to return
 * Pikachu, which has 99 printings, rather than whichever obscure card happens
 * to sort first.
 */
export function rankNames(query: string, rows: readonly NameRow[], limit = MAX_SUGGESTIONS): Suggestion[] {
  const q = foldName(query);
  if (q.length < MIN_QUERY) return [];

  const hits: { row: NameRow; tier: number }[] = [];
  for (const row of rows) {
    const t = tier(foldName(row[0]), q);
    if (t >= 0) hits.push({ row, tier: t });
  }

  hits.sort(
    (a, b) =>
      a.tier - b.tier ||
      // Descending: the name a collector is most likely to mean is the one
      // printed the most times.
      b.row[1] - a.row[1] ||
      // Stable and testable, rather than whatever order the file happened to be in.
      a.row[0].localeCompare(b.row[0]),
  );

  return hits.slice(0, limit).map(({ row }) => ({ name: row[0], printings: row[1] }));
}

/** Reject a file that is not the shape we expect, rather than half-using it. */
export function parseNameRows(value: unknown): NameRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: NameRow[] = [];
  for (const row of value) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "number") continue;
    rows.push([row[0], row[1]]);
  }
  return rows.length > 0 ? rows : null;
}
