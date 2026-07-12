import type { CardPriceResult, PokemonCardDetails } from "../models/cards.ts";
import { CARD_TTL_MS, PRICE_TTL_MS, TtlCache } from "./cache.ts";
import { MAX_RECENTLY_VIEWED } from "./repositories.ts";

/** Cross-session TTL caches for instant, cached-first rendering. */
export const cardCache = new TtlCache<PokemonCardDetails>(
  "cache:cards",
  CARD_TTL_MS,
  MAX_RECENTLY_VIEWED + 20,
);
export const priceCache = new TtlCache<CardPriceResult>("cache:prices", PRICE_TTL_MS, 100);
