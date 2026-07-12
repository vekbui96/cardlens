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
}

export interface CardVariants {
  normal?: boolean;
  holofoil?: boolean;
  reverseHolofoil?: boolean;
  firstEdition?: boolean;
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
