import { byCollectorNumber } from "../integrations/pokemon/sort.ts";
import { compareFinishes } from "./finishes.ts";
import { weekChangePct, type EurAverages } from "./movement.ts";

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
  /** Cardmarket averages in EUR. Only ever turned into a percentage; see topMovers. */
  eur?: EurAverages;
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

/** The phone/desktop v2 screen also offers a movement sort; v1 keeps `OWNED_SORTS`. */
export const OWNED_SORTS_V2 = [...OWNED_SORTS, { key: "change", label: "Biggest change" }] as const;

export type OwnedSortKey = (typeof OWNED_SORTS_V2)[number]["key"];

/** Week-on-week percent for a row, undefined when it has no honest figure. */
export function weekChange(row: OwnedPrintingRow): number | undefined {
  return weekChangePct(row.eur);
}

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
    change: (a, b) => {
      const ca = weekChange(a);
      const cb = weekChange(b);
      if ((ca === undefined) !== (cb === undefined)) return ca === undefined ? 1 : -1;
      return Math.abs(cb ?? 0) - Math.abs(ca ?? 0) || bySetThenNumber(a, b);
    },
  };

  return [...rows].sort(compare[key]);
}

/**
 * Narrow held printings to those whose card name, set name or collector number
 * contains the query (case-insensitive, trimmed). A blank query returns the
 * same array, so callers can skip the work and memoisation stays stable.
 * Read-only: rows are never mutated.
 */
export function filterOwned(rows: OwnedPrintingRow[], query: string): OwnedPrintingRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.setName.toLowerCase().includes(q) ||
      r.collectorNumber.toLowerCase().includes(q),
  );
}

/**
 * The `n` dearest priced printings, dearest first: what is carrying the total.
 *
 * The same price order as `sortOwned`, ties included, so Home's short list
 * and the top of My cards sorted by price never disagree about which printing
 * comes first. Unpriced printings are left out rather than listed last: this
 * answers "what is the total made of", and an unknown price contributes
 * nothing to it. A zero is left out for the same reason `totalOf` skips it.
 */
export function topByValue(rows: OwnedPrintingRow[], n: number): OwnedPrintingRow[] {
  const priced = rows.filter((r) => typeof r.price === "number" && r.price > 0);
  return sortOwned(priced, "price").slice(0, n);
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
