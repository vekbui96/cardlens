import type { Printing } from "../integrations/tcgdex/client.ts";
import { isLikelyPackPrinting, makeFinish, type Finish } from "./finishes.ts";
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
 * Price for one printing of one card.
 *
 * Tries the number as given and then unpadded, because TCGdex pads modern sets
 * while pokemontcg.io does not and either form can reach here. This lookup was
 * previously inlined in useCollectionValue; it lives here so the set screen and
 * the collection total cannot disagree about what a printing is worth.
 */
export function printingPrice(
  index: SetPrintingIndex | null | undefined,
  collectorNumber: string,
  finish: Finish,
): number | undefined {
  if (!index) return undefined;
  return (
    index.prices[`${collectorNumber}|${finish}`] ??
    index.prices[`${unpadded(collectorNumber)}|${finish}`] ??
    index.prices[`${collectorNumber.padStart(3, "0")}|${finish}`]
  );
}

/**
 * Cardmarket rolling averages (EUR) for one printing.
 *
 * Same number-form fallbacks as printingPrice, for the same reason. Only ever
 * consumed in aggregate — a single card's change at these prices is a rounding
 * step, not a movement.
 */
export function printingEur(
  index: SetPrintingIndex | null | undefined,
  collectorNumber: string,
  finish: Finish,
): EurAverages | undefined {
  if (!index) return undefined;
  return (
    index.eur[`${collectorNumber}|${finish}`] ??
    index.eur[`${unpadded(collectorNumber)}|${finish}`] ??
    index.eur[`${collectorNumber.padStart(3, "0")}|${finish}`]
  );
}
