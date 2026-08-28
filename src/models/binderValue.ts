import { slotQuantity, type Binder, type BinderSlot, type CardSlot } from "./binderLayout.ts";

/**
 * What a binder is worth, as arithmetic rather than as a hook.
 *
 * Split out of hooks/useBinderValue.ts because the sum is the part that can be
 * wrong, and it was reachable only through react-query, nineteen set fetches
 * and a React render. `useCollectionValue` has carried the same problem long
 * enough for the handoff to name it: this computes what a collection is worth
 * and has no direct test.
 *
 * The hook still owns everything that needs a network — which set a card is in,
 * what that set's printings cost — and hands the answer here as a lookup.
 *
 * The one rule this file exists to enforce: **an absent price is not zero.**
 * Whole categories cannot be priced at all (stamps and promos ride on finishes
 * the oracle has never heard of; pokemontcg.io prices no card in some sets), so
 * a missing price stays missing all the way through the sum and is counted
 * separately. A total here is always "the part we know".
 */

/**
 * One pocket's full worth: the unit price times the copies behind it.
 *
 * Undefined in, undefined out. Three copies of a card nothing prices is three
 * unpriced cards, not $0.00 worth of them.
 */
export function lineTotal(slot: BinderSlot, unit: number | undefined): number | undefined {
  return unit === undefined ? undefined : unit * slotQuantity(slot);
}

export interface BinderValueSummary {
  /** Summed line totals of the pockets that carry a price. */
  total: number;
  /** POCKETS with and without a price. Not copies — see pricedCopies. */
  priced: number;
  unpriced: number;
  /** Copies behind the priced pockets — what `total` is actually the sum over. */
  pricedCopies: number;
}

/**
 * Add up the pockets that can be added up.
 *
 * Pockets and copies are counted separately on purpose. A trade binder stacks
 * duplicates behind one pocket, so "23 of 24 priced" reported against a total
 * that summed forty cards would be a quiet lie about what was measured.
 */
export function summariseBinderValue(
  slots: BinderSlot[],
  priceFor: (slot: BinderSlot) => number | undefined,
): BinderValueSummary {
  let total = 0;
  let priced = 0;
  let pricedCopies = 0;

  for (const slot of slots) {
    const line = lineTotal(slot, priceFor(slot));
    if (line === undefined) continue;
    total += line;
    priced += 1;
    pricedCopies += slotQuantity(slot);
  }

  return { total, priced, unpriced: slots.length - priced, pricedCopies };
}

/**
 * Every card pocket in a binder, in page order.
 *
 * Image slots are left out: a divider or a photo has no market price and never
 * will, so counting one as an unpriced card would report the binder as less
 * measurable than it is.
 */
export function cardSlotsOf(binder: Binder | null | undefined): CardSlot[] {
  if (!binder) return [];
  return binder.pages.flatMap((page) =>
    Object.values(page.slots).filter((s): s is CardSlot => s.kind === "card"),
  );
}
