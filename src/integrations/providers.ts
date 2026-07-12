import type { PokemonCardSummary, PokemonCardDetails, CardPriceResult, PokemonSet } from "../models/cards.ts";

export interface FetchOpts {
  signal?: AbortSignal;
}

export interface SearchOpts extends FetchOpts {
  /** Restrict to these exact pokemontcg.io rarity strings (OR-ed). */
  rarities?: string[];
}

/** Card catalog: search + fetch one card, browse sets. Backed by pokemontcg.io or mocks. */
export interface CardCatalogProvider {
  searchCards(query: string, opts?: SearchOpts): Promise<PokemonCardSummary[]>;
  getCard(id: string, opts?: FetchOpts): Promise<PokemonCardDetails>;
  /** All sets, newest first. */
  listSets(opts?: FetchOpts): Promise<PokemonSet[]>;
  /** Cards in a set, sorted most-valuable first; optionally rarity-filtered. */
  getCardsBySet(setId: string, opts?: SearchOpts): Promise<PokemonCardSummary[]>;
}

/** Normalized pricing for a card. */
export interface CardPricingProvider {
  getPrices(cardId: string, opts?: FetchOpts): Promise<CardPriceResult>;
}

/** Typed error so the UI can distinguish network failure from "no results". */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "timeout" | "validation" | "not-found" | "rate-limit" | "unknown",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}
