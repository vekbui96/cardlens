import { catalogPrice } from "./catalogPrice.ts";
import { printingPrice, type SetPrintingIndex } from "./printingIndex.ts";
import type { Finish } from "./finishes.ts";

/**
 * The one price this app shows for one printing.
 *
 * Two oracles, in a fixed order: TCGdex first, the pokemontcg.io catalog only
 * where TCGdex has nothing. Neither covers the collection alone — measured,
 * TCGdex prices 0 of nothing but returns an empty `tcgplayer` block for promos
 * and older cards (smp-SM210: TCGdex `{}` against pokemontcg.io $169.02), while
 * pokemontcg.io prices 0/120 Pitch Black and 0/124 Perfect Order. Both are
 * TCGplayer market prices in USD, so one may stand in for the other.
 *
 * This exists because the ORDER was previously written out twice — once in
 * useCollectionValue for Home's total, once in useOwnedCards for the list of
 * the very printings behind that total. CLAUDE.md already warned what happens
 * if they drift: "the Home total and the list of the printings behind it would
 * stop adding up." A rule kept in two places and a comment asking them to agree
 * is the same shape as a merge rule copied into the server, which this codebase
 * decided long ago not to do.
 *
 * Collector number is taken by the CALLER rather than derived here. The two
 * sites get it from different places — the catalog when it has answered, the
 * card id when it has not — and quietly re-deriving it would throw away the
 * better answer one of them already holds.
 */
export function marketPrice(
  index: SetPrintingIndex | null | undefined,
  catalogPrices: Map<string, number> | undefined,
  cardId: string,
  collectorNumber: string,
  finish: Finish,
): number | undefined {
  return printingPrice(index, collectorNumber, finish) ?? catalogPrice(catalogPrices, cardId, finish);
}

/**
 * The collector number at the tail of a card id.
 *
 * FIRST dash, not the last: pokemontcg.io set ids never contain one, while a
 * collector number can (`swshp-SWSH001`-style promos aside, alt-art suffixes
 * appear in the wild). Splitting on the last dash would hand back only the
 * fragment after it.
 *
 * Note this is deliberately NOT the inverse of utils/cardId.ts `setIdFromCardId`,
 * which splits on the last dash to recover the set. For every id measured in
 * this catalog there is exactly one dash and the two agree; where they would
 * not, each is right about the end it is reading.
 *
 * Only a fallback. Prefer the catalog's own `collectorNumber` when it has
 * answered — this is what makes a price resolvable before it has.
 */
export function collectorNumberFromCardId(cardId: string): string {
  const cut = cardId.indexOf("-");
  return cut >= 0 ? cardId.slice(cut + 1) : cardId;
}
