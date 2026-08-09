import type { Printing } from "../integrations/tcgdex/client.ts";
import { isLikelyPackPrinting, makeFinish, parseFinish, type Finish } from "./finishes.ts";
import type { EurAverages } from "./movement.ts";

export interface SetPrintingIndex {
  /** Collector number -> the printings that card exists in. */
  byNumber: Record<string, Finish[]>;
  /** Every printing seen in the set, ordered for pickers. */
  all: Finish[];
  /**
   * Total printings counted toward completion — the master-set denominator
   * under the rule "if you can pull it from a standard pack it counts".
   */
  packTotal: number;
  /** Printings excluded as product exclusives, with the card counts that got them excluded. */
  excluded: { finish: Finish; cards: number }[];
  /**
   * `<collectorNumber>|<finish>` -> USD market price.
   *
   * Only priced printings appear, so a missing key means "unknown" rather than
   * "free". Kept as a flat record rather than a method so the index stays plain
   * data and can be compared and snapshotted in tests.
   */
  prices: Record<string, number>;
  /**
   * `<collectorNumber>|<finish>` -> Cardmarket rolling averages, in **EUR**.
   *
   * Separate from `prices` (USD) rather than merged into one record, because the
   * two currencies must never be summed together and a shared shape would make
   * that mistake easy. Used only in aggregate — see models/movement.ts.
   */
  eur: Record<string, EurAverages>;
}

/**
 * Turn raw TCGdex printings into the shape the set screen reads.
 *
 * Shared rather than inlined in a hook because two endpoints now deliver the
 * same raw map: `/api/printings/:setId` on its own, and `/api/set-information`
 * which carries it alongside the cards.
 */
export function buildPrintingIndex(
  raw: Record<string, Printing[]> | null | undefined,
): SetPrintingIndex | null {
  if (!raw) return null;

  const byNumber: Record<string, Finish[]> = {};
  const prices: Record<string, number> = {};
  const eur: Record<string, EurAverages> = {};
  const cardsPerFinish = new Map<Finish, number>();
  // Count by card, not by index entry: numbers are indexed twice (padded and
  // unpadded), so counting entries would double every total.
  const counted = new Set<string>();

  for (const [number, printings] of Object.entries(raw)) {
    const finishes = printings.map((p) => makeFinish(p.type, p.foil));
    byNumber[number] = finishes;
    for (const p of printings) {
      // Zero is not a price. Absent means unknown, and a 0 would sum as if the
      // printing were worthless.
      if (typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0) {
        prices[`${number}|${makeFinish(p.type, p.foil)}`] = p.price;
      }
      if (p.eur) eur[`${number}|${makeFinish(p.type, p.foil)}`] = p.eur;
    }
    const canonicalKey = number.replace(/^0+(?=\d)/, "");
    if (counted.has(canonicalKey)) continue;
    counted.add(canonicalKey);
    for (const f of finishes) cardsPerFinish.set(f, (cardsPerFinish.get(f) ?? 0) + 1);
  }

  const cardsInSet = counted.size;
  const all: Finish[] = [];
  const excluded: { finish: Finish; cards: number }[] = [];
  let packTotal = 0;

  for (const [finish, cards] of cardsPerFinish) {
    all.push(finish);
    if (isLikelyPackPrinting(cards, cardsInSet)) packTotal += cards;
    else excluded.push({ finish, cards });
  }

  return { byNumber, all, packTotal, excluded, prices, eur };
}

/** Strip leading zeros from a collector number: "007" -> "7", "001a" -> "1a". */
function unpadded(collectorNumber: string): string {
  return collectorNumber.replace(/^0+(?=\d)/, "");
}

/**
 * Every key worth trying for one number+finish, most specific first.
 *
 * Three number forms because TCGdex pads modern sets while pokemontcg.io does
 * not and either form can reach here.
 *
 * Then the same three with the foil stripped. Providers do not model pattern
 * foils: TCGdex exposes variants as flat booleans (normal/reverse/holo) with no
 * concept of pokeball, energy or quickball, so a set full of patterned reverses
 * still comes back as a bare `reverse`. The collection stores the pattern it saw
 * on the card, so without this an exact-match lookup finds nothing and the row
 * totals as $0 with no indication anything is missing.
 *
 * A base-type price is the right stand-in: a patterned reverse and a plain
 * reverse are the same print run wherever both exist. Crossing *types* is not —
 * a holo price must never answer for a reverse — so only the foil is dropped.
 */
function lookupKeys(collectorNumber: string, finish: Finish): string[] {
  const numbers = [collectorNumber, unpadded(collectorNumber), collectorNumber.padStart(3, "0")];
  const { type } = parseFinish(finish);
  const finishes = type === finish ? [finish] : [finish, type];
  return finishes.flatMap((f) => numbers.map((n) => `${n}|${f}`));
}

/**
 * Price for one printing of one card.
 *
 * This lookup was previously inlined in useCollectionValue; it lives here so the
 * set screen and the collection total cannot disagree about what a printing is
 * worth.
 */
export function printingPrice(
  index: SetPrintingIndex | null | undefined,
  collectorNumber: string,
  finish: Finish,
): number | undefined {
  if (!index) return undefined;
  for (const key of lookupKeys(collectorNumber, finish)) {
    const price = index.prices[key];
    if (price !== undefined) return price;
  }
  return undefined;
}

/**
 * Cardmarket rolling averages (EUR) for one printing.
 *
 * Same key fallbacks as printingPrice, for the same reasons. Only ever consumed
 * in aggregate — a single card's change at these prices is a rounding step, not
 * a movement.
 */
export function printingEur(
  index: SetPrintingIndex | null | undefined,
  collectorNumber: string,
  finish: Finish,
): EurAverages | undefined {
  if (!index) return undefined;
  for (const key of lookupKeys(collectorNumber, finish)) {
    const eur = index.eur[key];
    if (eur !== undefined) return eur;
  }
  return undefined;
}
