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
 * IMPORTANT: this list is deliberately WIDER than what the data source can
 * tell us. Surveyed across eight sets, pokemontcg.io's tcgplayer payload only
 * ever exposes `normal`, `holofoil` and `reverseHolofoil` — Prismatic
 * Evolutions and 151 report exactly those three despite really having Poké Ball
 * and Master Ball patterns, and Base Set reports only `holofoil` despite 1st
 * Edition and Shadowless printings existing.
 *
 * Restricting collectors to what the API knows would make those printings
 * untrackable, so the extras are marked by hand. See availableFinishes (what
 * the data implies) versus ALL_COLLECT_FINISHES (what a person may record).
 */
export type CollectFinish =
  | "normal"
  | "holofoil"
  | "reverseHolofoil"
  | "pokeBall"
  | "masterBall"
  | "firstEdition"
  | "shadowless";

/** Priority order: the plainest printing first, specials after. */
export const COLLECT_FINISHES: readonly CollectFinish[] = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "firstEdition",
];

/** Everything a person can mark by hand, including what pricing never reveals. */
export const ALL_COLLECT_FINISHES: readonly CollectFinish[] = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "pokeBall",
  "masterBall",
  "firstEdition",
  "shadowless",
];

export const COLLECT_FINISH_LABELS: Record<CollectFinish, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holo",
  pokeBall: "Poké Ball pattern",
  masterBall: "Master Ball pattern",
  firstEdition: "1st Edition",
  shadowless: "Shadowless",
};

/** Compact badges for list rows, where the full labels never fit. */
export const COLLECT_FINISH_SHORT: Record<CollectFinish, string> = {
  normal: "N",
  holofoil: "H",
  reverseHolofoil: "RH",
  pokeBall: "PB",
  masterBall: "MB",
  firstEdition: "1st",
  shadowless: "SL",
};

/**
 * Which finishes the pricing payload implies a card exists in. This is the
 * master-set DENOMINATOR — it can only count what it can enumerate, so
 * hand-marked extras like Poké Ball pattern are owned printings that no total
 * accounts for.
 *
 * Falls back to `normal` when the payload revealed nothing: better to let
 * someone track a card as a single printing than to show it as untrackable.
 */
export function availableFinishes(variants?: CardVariants): CollectFinish[] {
  const found = COLLECT_FINISHES.filter((f) => variants?.[f as keyof CardVariants]);
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
