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

/** How many sets the top-sets share line covers. */
export const TOP_SETS = 3;

export interface SetValue {
  setId: string;
  setName: string;
  /** Sum of the set's priced printings, USD. */
  worth: number;
  /** Share of the total priced value, whole percent. */
  sharePct: number;
  priced: number;
  /** Printings in this set with no price; never valued. */
  unpriced: number;
}

export interface ValueBySet {
  sets: SetValue[];
  /** The top sets' share of the total, whole percent. Null when nothing is priced. */
  topShare: { count: number; pct: number } | null;
  unpriced: number;
}

/**
 * Where the value sits, set by set. Unpriced printings are counted against
 * their set and left out of every sum (unknown, not zero); a set holding only
 * unpriced cards is kept, last, so the count is visible. USD only.
 */
export function valueBySet(rows: readonly OwnedPrintingRow[]): ValueBySet {
  const bySet = new Map<string, SetValue>();
  let total = 0;
  for (const r of rows) {
    const entry = bySet.get(r.setId) ?? {
      setId: r.setId,
      setName: r.setName,
      worth: 0,
      sharePct: 0,
      priced: 0,
      unpriced: 0,
    };
    const p = priceOf(r);
    if (p > 0) {
      entry.worth += p;
      entry.priced += 1;
      total += p;
    } else {
      entry.unpriced += 1;
    }
    bySet.set(r.setId, entry);
  }
  const sets = [...bySet.values()].sort((a, b) => b.worth - a.worth || a.setId.localeCompare(b.setId));
  for (const s of sets) s.sharePct = total > 0 ? Math.round((s.worth / total) * 100) : 0;
  const top = sets.slice(0, TOP_SETS);
  const topSum = top.reduce((sum, s) => sum + s.worth, 0);
  return {
    sets,
    topShare: total > 0 ? { count: top.length, pct: Math.round((topSum / total) * 100) } : null,
    unpriced: rows.length - sets.reduce((n, s) => n + s.priced, 0),
  };
}

export interface AddedThisMonth {
  /** Printings last marked owned in the current calendar month. */
  count: number;
  /** Their current worth, USD. Unpriced printings are left out. */
  worth: number;
  /** Printings among them with no price; never valued. */
  unpriced: number;
}

/**
 * What was marked owned in the current calendar month (local time), from each
 * row's `at`. A re-marked row carries a newer `at`, so this is "marked", not
 * "first acquired". `rows` are live rows only (removals are tombstones the
 * owned list already drops). Unpriced printings are counted, never valued.
 */
export function addedThisMonth(rows: readonly OwnedPrintingRow[], now: number): AddedThisMonth {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  let count = 0;
  let worth = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (!(r.at >= start && r.at < end)) continue;
    count += 1;
    const p = priceOf(r);
    if (p > 0) worth += p;
    else unpriced += 1;
  }
  return { count, worth, unpriced };
}

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
