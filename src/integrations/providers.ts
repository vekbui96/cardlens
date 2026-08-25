import type { PokemonCardSummary, PokemonCardDetails, CardPriceResult, PokemonSet } from "../models/cards.ts";

export interface FetchOpts {
  signal?: AbortSignal;
}

/**
 * The most rows a `full` search returns — the API's maximum page, taken in one
 * request. Exported because a caller that gets exactly this many back cannot
 * tell a complete answer from a cut one, and has to say the list was cut.
 */
export const FULL_SEARCH_LIMIT = 250;

export interface SearchOpts extends FetchOpts {
  /** Restrict to these exact pokemontcg.io rarity strings (OR-ed). */
  rarities?: string[];
  /**
   * Return everything the query matches, not the top slice.
   *
   * The default is deliberately short: a search result list on the glasses is a
   * focus ring stepped one card at a time, where the 41st Charizard is not a
   * result, it is a punishment. "Which of a Pokémon's cards exist" is a
   * different question — asked when laying out a binder — and it wants the lot.
   */
  full?: boolean;
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
