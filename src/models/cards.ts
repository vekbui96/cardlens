/**
 * Core domain models. Game-neutral types live here so additional trading-card
 * games can reuse them (see docs/adding-new-games.md). Pokémon-specific summary
 * and details types extend the neutral shapes.
 */

export interface PokemonCardSummary {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity?: string;
  imageSmall?: string;
  imageLarge?: string;
  /**
   * Convenience headline market price (USD) derived from the search payload so
   * result rows can show a price without an extra fetch. May be stale/absent;
   * the details screen always re-fetches authoritative pricing.
   */
  marketPrice?: number;
  /**
   * Which printings exist, derived from the same pricing payload the market
   * price comes from. Present on summaries so a set list can show and total
   * variants without a per-card details fetch.
   */
  variants?: CardVariants;
}

export interface CardVariants {
  normal?: boolean;
  holofoil?: boolean;
  reverseHolofoil?: boolean;
  firstEdition?: boolean;
}

/**
 * The finishes a collector tracks separately. A master set means owning each
 * printing of a card, not just the card — so the collection is keyed by
 * (card, finish), and these are the finish half of that key.
 *
 * Deliberately the four `CardVariants` keys rather than the five pricing
 * finishes: TCGplayer splits 1st Edition into holo and non-holo price points,
 * but a card is only ever one of those, so collapsing them avoids offering a
 * choice that can't apply.
 */
export type CollectFinish = "normal" | "holofoil" | "reverseHolofoil" | "firstEdition";

/** Priority order: the plainest printing first, specials after. */
export const COLLECT_FINISHES: readonly CollectFinish[] = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "firstEdition",
];

export const COLLECT_FINISH_LABELS: Record<CollectFinish, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holo",
  firstEdition: "1st Edition",
};

/** Compact badges for list rows, where the full labels never fit. */
export const COLLECT_FINISH_SHORT: Record<CollectFinish, string> = {
  normal: "N",
  holofoil: "H",
  reverseHolofoil: "RH",
  firstEdition: "1st",
};

/**
 * Which finishes a card actually exists in. Falls back to `normal` when the
 * pricing payload revealed nothing — better to let someone track a card as a
 * single printing than to show it as untrackable.
 */
export function availableFinishes(variants?: CardVariants): CollectFinish[] {
  const found = COLLECT_FINISHES.filter((f) => variants?.[f]);
  return found.length > 0 ? found : ["normal"];
}

/** The finish a single "I own this" gesture should mean for a card. */
export function primaryFinish(variants?: CardVariants): CollectFinish {
  return availableFinishes(variants)[0];
}

export interface PokemonCardDetails extends PokemonCardSummary {
  supertype?: string;
  subtypes?: string[];
  artist?: string;
  releaseDate?: string;
  /** National Pokédex numbers — used as a popularity/recency tie-breaker. */
  nationalPokedexNumbers?: number[];
  variants?: CardVariants;
}

/** A single finish's price points. */
export interface VariantPrice {
  market?: number;
  low?: number;
  mid?: number;
  high?: number;
}

/**
 * Normalized pricing. Never store 0/NaN as a real price — treat absent values as
 * `undefined` so the UI can render "Unavailable" instead of "$0.00".
 */
export interface CardPriceResult {
  currency: string;
  marketPrice?: number;
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  directLowPrice?: number;
  lastUpdated: string;
  source: string;
  /** Which finish the top-level headline numbers represent. */
  headlineFinish?: PriceFinishKey;
  variants: {
    normal?: VariantPrice;
    holofoil?: VariantPrice;
    reverseHolofoil?: VariantPrice;
    firstEditionHolofoil?: VariantPrice;
    firstEditionNormal?: VariantPrice;
  };
}

export type PriceFinishKey = keyof CardPriceResult["variants"];

export const FINISH_LABELS: Record<PriceFinishKey, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holo",
  firstEditionHolofoil: "1st Edition Holo",
  firstEditionNormal: "1st Edition",
};

/** A Pokémon TCG set (for the set browser). */
export interface PokemonSet {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
  total?: number;
  symbolImage?: string;
  logoImage?: string;
}

/** Game-neutral search result (used by the multi-game seam). */
export interface CardSearchResult {
  id: string;
  name: string;
  setName: string;
  collectorNumber: string;
  rarity?: string;
  imageSmall?: string;
}

/** Game-neutral card record. */
export interface TradingCard extends CardSearchResult {
  setCode: string;
  imageLarge?: string;
  artist?: string;
  releaseDate?: string;
}
