import { parseFinish, type Finish } from "./finishes.ts";
import type { PokemonCardSummary, PriceFinishKey } from "./cards.ts";

/**
 * Our printing keys mapped onto pokemontcg.io's price keys.
 *
 * This is the SECOND pricing oracle. TCGdex is first and stays first — it
 * prices per printing and covers the modern sets this collection is mostly
 * made of, where pokemontcg.io reports nothing at all (measured: 0/120 Pitch
 * Black, 0/124 Perfect Order). But the reverse gap is just as real: TCGdex
 * returns an empty `tcgplayer` block for promos and older cards where
 * pokemontcg.io has a price. Measured on smp-SM210 (Moltres & Zapdos &
 * Articuno GX) — TCGdex `{}`, pokemontcg.io holofoil market $169.02.
 *
 * Neither source covers the collection alone, so a printing takes TCGdex's
 * price when there is one and this when there is not.
 *
 * Both are TCGplayer market prices in USD, so the two can be summed into one
 * total. Cardmarket EUR must never join them — see models/movement.ts.
 */
const FINISH_TO_PRICE_KEY: Record<string, PriceFinishKey> = {
  normal: "normal",
  holo: "holofoil",
  reverse: "reverseHolofoil",
  firstEdition: "firstEditionHolofoil",
};

/**
 * The pokemontcg.io price key for one of our printings, if it has one.
 *
 * Patterned foils never do. pokemontcg.io reports no Poké Ball, Master Ball or
 * energy reverse in any set, so pricing `reverse:pokeball` off the plain
 * reverse key would invent a number — the same reason the TCGdex path refuses
 * to. Shadowless has no key either and is left unpriced rather than guessed.
 */
export function finishToPriceKey(finish: Finish): PriceFinishKey | undefined {
  const { foil, type } = parseFinish(finish);
  if (foil) return undefined;
  return FINISH_TO_PRICE_KEY[type];
}

/**
 * `<cardId>|<finish>` -> USD market price, from catalog summaries.
 *
 * Built from cards the set screens already fetched, so the fallback costs no
 * extra request. Only positive prices are stored: absent means unknown, and a
 * zero would total up as though the printing were worthless.
 */
export function catalogPriceIndex(cards: Iterable<PokemonCardSummary>): Map<string, number> {
  const out = new Map<string, number>();
  for (const card of cards) {
    const prices = card.variantPrices;
    if (!prices) continue;
    for (const [key, price] of Object.entries(prices)) {
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
      out.set(`${card.id}|${key}`, price);
    }
  }
  return out;
}

/** Look one printing up in an index built by catalogPriceIndex. */
export function catalogPrice(
  index: Map<string, number> | undefined,
  cardId: string,
  finish: Finish,
): number | undefined {
  const key = finishToPriceKey(finish);
  if (!index || !key) return undefined;
  return index.get(`${cardId}|${key}`);
}
