/**
 * Sealed product prices, from TCGplayer via tcgcsv.com.
 *
 * A third source, and it has to be: neither card API prices sealed product at
 * all. pokemontcg.io and TCGdex both key everything by card, so a booster pack
 * is not a thing either of them can describe. tcgcsv publishes TCGplayer's own
 * daily dump — free, no key — which is the same market price already behind
 * every card figure in the app, so nothing here mixes currencies or vendors.
 */

/** The product kinds worth tracking, in the order they are shown. */
export const SEALED_KINDS = [
  { key: "pack", label: "Booster Pack" },
  { key: "etb", label: "Elite Trainer Box" },
  { key: "box", label: "Booster Box" },
  { key: "bundle", label: "Booster Bundle" },
] as const;

export type SealedKind = (typeof SEALED_KINDS)[number]["key"];

export interface SealedPrice {
  kind: SealedKind;
  /** The product's own name upstream, so an odd match can be spotted. */
  productName: string;
  /** TCGplayer market price, USD. Absent is never zero. */
  price?: number;
}

export interface SetSealed {
  setId: string;
  prices: SealedPrice[];
  /** When the upstream dump was read, ISO. */
  updated: string;
}

/**
 * Which kind of sealed product a TCGplayer product name is, if any.
 *
 * Ordered and exclusive, because the names nest: "Booster Box Case" contains
 * "Booster Box", and "Elite Trainer Box Case" contains "Elite Trainer Box".
 * Cases and half boxes are deliberately NOT tracked — a case is a wholesale
 * unit, not the thing anyone quotes a set's price in.
 */
export function classifySealed(name: string): SealedKind | undefined {
  const n = name.toLowerCase();
  // Anything qualifying the unit means it is not the plain unit. The
  // parenthesised and store-exclusive forms are here because of a live miss:
  // Phantasmal Flames lists "Pokemon Center Elite Trainer Box (Exclusive)"
  // BEFORE the standard one, and taking the first match priced that set's ETB
  // at $311.34 against a real $78. A wrong price is worse than a missing one.
  if (/\bcase\b|\bhalf\b|\[|\(|\bset of\b|3-pack|blister|sleeved/.test(n)) return undefined;
  if (/pokemon center|exclusive|premium|ultra/.test(n)) return undefined;
  if (/elite trainer box/.test(n)) return "etb";
  if (/booster bundle/.test(n)) return "bundle";
  if (/booster box/.test(n)) return "box";
  if (/booster pack/.test(n)) return "pack";
  return undefined;
}

/**
 * Set names as tcgcsv writes them, reduced for matching.
 *
 * tcgcsv prefixes the printed code — "ME05: Pitch Black", "SV: Black Bolt" —
 * where the catalog just says "Pitch Black". The prefix is dropped and the rest
 * normalised the same way TCGdex set names are, so one rule covers both.
 */
export function normalizeSetName(name: string): string {
  return name
    .replace(/^[^:]{1,12}:\s*/, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}
