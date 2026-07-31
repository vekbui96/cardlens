import type { Printing } from "../integrations/tcgdex/client.ts";
import { isLikelyPackPrinting, makeFinish, type Finish } from "./finishes.ts";

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
  const cardsPerFinish = new Map<Finish, number>();
  // Count by card, not by index entry: numbers are indexed twice (padded and
  // unpadded), so counting entries would double every total.
  const counted = new Set<string>();

  for (const [number, printings] of Object.entries(raw)) {
    const finishes = printings.map((p) => makeFinish(p.type, p.foil));
    byNumber[number] = finishes;
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

  return { byNumber, all, packTotal, excluded };
}
