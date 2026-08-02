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
// v3: summaries carry `variantPrices`, which the collection reads to price a
// printing TCGdex has no number for. A device holding v2 entries would keep
// serving summaries without it and show those printings as unpriced.
/**
 * Eight, not thirty. Measured: one set costs ~58KB here and ~49KB in the
 * printings cache below, and a 295-card set is over twice that — thirty entries
 * is upwards of 4MB of a ~5MB budget, spent on data that refetches in about a
 * second. The collection is written into whatever is left, and when nothing is
 * left a mark silently fails to save. Eight sets is far more than anyone
 * revisits inside a 6h TTL, and it leaves the irreplaceable data room.
 */
export const setCardsCache = new TtlCache<PokemonCardSummary[]>("cache:set-cards:v3", SEARCH_TTL_MS, 8);

/**
 * Printings per set, from TCGdex. Held for 30 days and kept for only a handful
 * of sets: assembling one costs a request per card (120-295), so this is the
 * difference between a 1.5s background fill and doing it on every visit.
 * Printings for a released set essentially never change.
 *
 * v4 alongside the server's PRINTINGS_CACHE_VERSION: the prices inside changed
 * for cards whose variants TCGdex generated, and a device holding a v3 entry
 * would sit on the old priceless copy for 30 days no matter what the server
 * sends. Both versions have to move together or only new devices see the fix.
 */
export const printingsCache = new TtlCache<SetPrintings>("cache:printings:v4", 30 * DAY, 8);
