import { byCollectorNumber } from "../integrations/pokemon/sort.ts";
import { compareFinishes } from "./finishes.ts";

/** One printing you hold, flattened out of the collection for listing. */
export interface OwnedPrintingRow {
  cardId: string;
  setId: string;
  setName: string;
  name: string;
  collectorNumber: string;
  finish: string;
  /** USD, when the printing has a price. Absent is not zero. */
  price?: number;
  imageSmall?: string;
  /** Hi-res art. The showcase stage is far larger than a 245px thumbnail. */
  imageLarge?: string;
  /** When this printing was marked owned. */
  at: number;
}

export const OWNED_SORTS = [
  { key: "price", label: "Price" },
  { key: "added", label: "Recently added" },
  { key: "name", label: "Name" },
  { key: "set", label: "Set & number" },
] as const;

export type OwnedSortKey = (typeof OWNED_SORTS)[number]["key"];

/**
 * Order a list of held printings.
 *
 * Sorting is stable and total: every comparator falls through to set and
 * collector number so equal keys never shuffle between renders. That matters
 * more here than usual — most of this catalogue is priced within a cent or two
 * of everything else, so a price sort is mostly ties.
 *
 * Unpriced printings sort last under "price" rather than as zero. They are
 * unknown, not worthless, and burying them at the bottom of a cheap-first list
 * would be a claim the data does not support.
 */
export function sortOwned(rows: OwnedPrintingRow[], key: OwnedSortKey): OwnedPrintingRow[] {
  const bySetThenNumber = (a: OwnedPrintingRow, b: OwnedPrintingRow) =>
    a.setId === b.setId
      ? byCollectorNumber(a, b) || compareFinishes(a.finish, b.finish)
      : a.setId.localeCompare(b.setId);

  const compare: Record<OwnedSortKey, (a: OwnedPrintingRow, b: OwnedPrintingRow) => number> = {
    price: (a, b) => {
      const known = (r: OwnedPrintingRow) => typeof r.price === "number";
      if (known(a) !== known(b)) return known(a) ? -1 : 1;
      return (b.price ?? 0) - (a.price ?? 0) || bySetThenNumber(a, b);
    },
    added: (a, b) => b.at - a.at || bySetThenNumber(a, b),
    name: (a, b) => a.name.localeCompare(b.name) || bySetThenNumber(a, b),
    set: bySetThenNumber,
  };

  return [...rows].sort(compare[key]);
}

/** Total of the priced rows, and how many had no price. */
export function totalOf(rows: OwnedPrintingRow[]): { total: number; unpriced: number } {
  let total = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (typeof r.price === "number" && r.price > 0) total += r.price;
    else unpriced += 1;
  }
  return { total, unpriced };
}
