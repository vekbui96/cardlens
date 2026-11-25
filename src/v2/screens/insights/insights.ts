import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";

/** How many cards the Most valuable list shows. */
export const TOP_COUNT = 10;

export interface TopCard {
  row: OwnedPrintingRow;
  /** This printing's share of the total priced value, as a whole percent (0-100). */
  sharePct: number;
}

export interface MostValuable {
  top: TopCard[];
  /** The top cards' share of the total priced value, whole percent. Null when nothing is priced. */
  concentrationPct: number | null;
  /** Printings held with no price. Never guessed, never counted as zero. */
  unpriced: number;
  /** Printings held with a price. */
  priced: number;
}

const priceOf = (row: OwnedPrintingRow): number =>
  typeof row.price === "number" && Number.isFinite(row.price) && row.price > 0 ? row.price : 0;

/**
 * The printings that carry the value of the collection.
 *
 * Only priced printings are ranked and only they make up the total the shares
 * are taken from: an unpriced printing is unknown, not worthless, so it is
 * counted (`unpriced`) and left out of the arithmetic. USD only; the
 * Cardmarket EUR series is never mixed into these figures.
 *
 * Ties break on set and collector number, then finish, so equal prices never
 * reshuffle between renders.
 */
export function mostValuable(rows: readonly OwnedPrintingRow[], count: number = TOP_COUNT): MostValuable {
  const pricedRows = rows.filter((r) => priceOf(r) > 0);
  const total = pricedRows.reduce((sum, r) => sum + priceOf(r), 0);
  const ranked = [...pricedRows].sort(
    (a, b) =>
      priceOf(b) - priceOf(a) ||
      a.setId.localeCompare(b.setId) ||
      a.collectorNumber.localeCompare(b.collectorNumber, undefined, { numeric: true }) ||
      a.finish.localeCompare(b.finish),
  );
  const top = ranked.slice(0, count).map((row) => ({
    row,
    sharePct: total > 0 ? Math.round((priceOf(row) / total) * 100) : 0,
  }));
  const topSum = ranked.slice(0, count).reduce((sum, r) => sum + priceOf(r), 0);
  return {
    top,
    concentrationPct: total > 0 ? Math.round((topSum / total) * 100) : null,
    unpriced: rows.length - pricedRows.length,
    priced: pricedRows.length,
  };
}
