import type { PokemonCardSummary, PokemonCardDetails, CardPriceResult } from "../models/cards.ts";

export interface FetchOpts {
  signal?: AbortSignal;
}

/** Card catalog: search + fetch one card. Backed by pokemontcg.io or mocks. */
export interface CardCatalogProvider {
  searchCards(query: string, opts?: FetchOpts): Promise<PokemonCardSummary[]>;
  getCard(id: string, opts?: FetchOpts): Promise<PokemonCardDetails>;
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
