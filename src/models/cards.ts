import type { Finish } from "./finishes.ts";
import { finishLabel, finishShort } from "./finishes.ts";

/** Kept for screens that still need a fixed offering when nothing else is known. */
const ALL_COLLECT_FINISHES_FALLBACK: readonly Finish[] = [
  "normal",
  "reverse",
  "holo",
  "firstEdition",
  "shadowless",
];

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
  /**
   * Market price (USD) per pokemontcg.io finish key, from the same payload as
   * `marketPrice`.
   *
   * The headline above cannot stand in for these: a card with a normal and a
   * reverse has one headline and two prices, and spending the headline on both
   * printings would count a number the data never claimed. Used only as a
   * fallback where TCGdex has no price — see models/catalogPrice.ts.
   */
  variantPrices?: Partial<Record<PriceFinishKey, number>>;
}

export interface CardVariants {
  normal?: boolean;
  holofoil?: boolean;
  reverseHolofoil?: boolean;
  firstEdition?: boolean;
}

/**
 * Printings are now modelled in finishes.ts as `type` or `type:foil` keys,
 * because sets keep inventing foils and a hardcoded union cannot follow them.
 * These re-exports keep the old name working across the app.
 */
export type CollectFinish = Finish;

export {
  ALL_COLLECT_FINISHES_FALLBACK as ALL_COLLECT_FINISHES,
  finishLabel as collectFinishLabel,
  finishShort as collectFinishShort,
};

/**
 * Printings implied by pokemontcg.io's pricing payload. A weak signal — it
 * reports nothing at all for some sets (Pitch Black) and never reports pattern
 * foils — so it is only a fallback for when TCGdex printings are unavailable.
 */
export function availableFinishes(variants?: CardVariants): CollectFinish[] {
  const found: CollectFinish[] = [];
  if (variants?.normal) found.push("normal");
  if (variants?.reverseHolofoil) found.push("reverse");
  if (variants?.holofoil) found.push("holo");
  if (variants?.firstEdition) found.push("firstEdition");
  return found.length > 0 ? found : ["normal"];
}

/**
 * The printings pricing can actually vouch for, or null when it vouches for none.
 *
 * `availableFinishes` answers "what should a row display" and pads to `normal`
 * so there is always something to show. That padding must never be mistaken for
 * knowledge. Pitch Black reports no variant data for any of its 120 cards, so
 * every card in it looks like a normal-only card until TCGdex printings arrive —
 * and marking against that guess wrote `normal` onto holo-only cards, which is
 * exactly what an audit of the live collection found.
 *
 * Callers that WRITE to the collection must use this and treat null as "ask the
 * user, do not guess". Callers that only render can keep using the padded list.
 */
export function knownFinishes(variants?: CardVariants): CollectFinish[] | null {
  if (!variants || !Object.values(variants).some(Boolean)) return null;
  return availableFinishes(variants);
}

/** The printing a single "I own this" gesture should mean for a card. */
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
  /** Short set code (PTCGO), e.g. "PBL" — how collectors refer to sets. */
  code?: string;
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
