import type { CollectFinish } from "./cards.ts";

/** A row of the collection, as the OR-Set stores it. */
export interface ValuableRow {
  cardId: string;
  setId: string;
  finish: CollectFinish;
}

export interface SetValue {
  setId: string;
  /** Printings held in this set. */
  printings: number;
  /** Of those, how many had a price. */
  priced: number;
  /** USD. Only priced printings contribute. */
  value: number;
}

export interface CollectionValue {
  total: number;
  bySet: SetValue[];
  printings: number;
  priced: number;
  /** Printings held but not priced — the number that makes `total` honest. */
  unpriced: number;
}

/**
 * What a collection is worth, from per-printing prices.
 *
 * Valued per PRINTING, not per card, because that is the unit the collection is
 * stored in and the unit prices differ by: a reverse holo is routinely worth
 * several times the normal of the same card. Summing a single headline price per
 * card would be wrong in both directions at once.
 *
 * Unpriced printings are counted, never guessed at and never treated as zero.
 * They are reported alongside the total so the number can be read honestly —
 * pattern foils have no separate price upstream, and whole sets sometimes have
 * no pricing at all.
 */
export function valueCollection(
  rows: ValuableRow[],
  priceOf: (row: ValuableRow) => number | undefined,
): CollectionValue {
  const sets = new Map<string, SetValue>();
  let total = 0;
  let priced = 0;

  for (const row of rows) {
    let entry = sets.get(row.setId);
    if (!entry) {
      entry = { setId: row.setId, printings: 0, priced: 0, value: 0 };
      sets.set(row.setId, entry);
    }
    entry.printings += 1;

    const price = priceOf(row);
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      entry.priced += 1;
      entry.value += price;
      priced += 1;
      total += price;
    }
  }

  // Most valuable first: on a phone the top of the list is what gets read.
  const bySet = [...sets.values()].sort((a, b) => b.value - a.value);
  const printings = rows.length;
  return { total, bySet, printings, priced, unpriced: printings - priced };
}
