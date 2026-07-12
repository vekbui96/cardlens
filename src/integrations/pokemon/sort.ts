import type { PokemonCardSummary } from "../../models/cards.ts";

/** Sort by headline market price, highest first; cards without a price go last. */
export function byPriceDesc(a: PokemonCardSummary, b: PokemonCardSummary): number {
  const pa = a.marketPrice ?? -1;
  const pb = b.marketPrice ?? -1;
  return pb - pa;
}
