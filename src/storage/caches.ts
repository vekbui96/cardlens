import type { CardPriceResult, PokemonCardDetails, PokemonCardSummary, PokemonSet } from "../models/cards.ts";
import type { SetPrintings } from "../integrations/tcgdex/client.ts";
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

/**
 * Set list (7 days) and per-set card lists (6h) for cached-first browsing.
 *
 * The key carries a version suffix. Adding a field to the mapped shape does not
 * invalidate anything on its own, and these entries are long-lived and treated
 * as fresh — a device that cached sets before `code` existed, or set cards
 * before `variants` existed, would render without them for up to a week with no
 * refetch. Bump the suffix whenever toSet/toSummary gains a field the UI reads.
 */
export const setsCache = new TtlCache<PokemonSet[]>("cache:sets:v2", 7 * DAY, 2);
export const setCardsCache = new TtlCache<PokemonCardSummary[]>("cache:set-cards:v2", SEARCH_TTL_MS, 30);

/**
 * Printings per set, from TCGdex. Held for 30 days and kept for only a handful
 * of sets: assembling one costs a request per card (120-295), so this is the
 * difference between a 1.5s background fill and doing it on every visit.
 * Printings for a released set essentially never change.
 */
export const printingsCache = new TtlCache<SetPrintings>("cache:printings:v3", 30 * DAY, 8);
