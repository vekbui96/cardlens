import type { PokemonCardSummary } from "../../../models/cards.ts";

export type SearchSort = "best" | "price-desc" | "price-asc";

export const SEARCH_SORTS: { id: SearchSort; label: string }[] = [
  { id: "best", label: "Best match" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "price-asc", label: "Price: low to high" },
];

const priced = (card: PokemonCardSummary): card is PokemonCardSummary & { marketPrice: number } =>
  typeof card.marketPrice === "number" && Number.isFinite(card.marketPrice);

/**
 * Reorder fetched results. Pure and stable: "best" is the catalog's own order,
 * ties keep it, and an unpriced card goes last in both directions rather than
 * being treated as a price of zero.
 */
export function sortCards(cards: PokemonCardSummary[], sort: SearchSort): PokemonCardSummary[] {
  if (sort === "best") return cards;
  const sign = sort === "price-desc" ? -1 : 1;
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const aPrice = priced(a.card) ? a.card.marketPrice : null;
      const bPrice = priced(b.card) ? b.card.marketPrice : null;
      if ((aPrice === null) !== (bPrice === null)) return aPrice === null ? 1 : -1;
      if (aPrice !== null && bPrice !== null && aPrice !== bPrice) return sign * (aPrice - bPrice);
      return a.index - b.index;
    })
    .map((entry) => entry.card);
}
