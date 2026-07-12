import type { CardPriceResult, PokemonCardDetails, PokemonCardSummary, PokemonSet } from "../models/cards.ts";
import { CARD_TTL_MS, DAY, MINUTE, PRICE_TTL_MS, TtlCache } from "./cache.ts";
import { MAX_RECENTLY_VIEWED } from "./repositories.ts";

/** Search-result lists persist for 6h so repeated searches load instantly and
 * survive app reloads (cached-first, revalidated in the background). */
export const SEARCH_TTL_MS = 6 * 60 * MINUTE;

/** Cross-session TTL caches for instant, cached-first rendering. */
export const cardCache = new TtlCache<PokemonCardDetails>(
  "cache:cards",
  CARD_TTL_MS,
  MAX_RECENTLY_VIEWED + 20,
);
export const priceCache = new TtlCache<CardPriceResult>("cache:prices", PRICE_TTL_MS, 100);
export const searchCache = new TtlCache<PokemonCardSummary[]>("cache:search", SEARCH_TTL_MS, 40);

/** Set list (7 days) and per-set card lists (6h) for cached-first browsing. */
export const setsCache = new TtlCache<PokemonSet[]>("cache:sets", 7 * DAY, 2);
export const setCardsCache = new TtlCache<PokemonCardSummary[]>("cache:set-cards", SEARCH_TTL_MS, 30);
