import { formatUsd } from "../../utils/format.ts";

/**
 * What a scanned batch is worth, and how much of it that figure covers.
 *
 * At a shop with a stack of cards, "what is this pile worth" is the question,
 * and the review is the only place the pile exists before it is added. Display
 * only: nothing here decides what is added.
 *
 * USD only (TCGdex's TCGplayer price, the same source Home values printings
 * with). Cardmarket EUR is never mixed into the figure.
 *
 * A row with no price is counted as unpriced and never guessed, so the total
 * always says how many cards it stands for. A silent partial total reads as
 * the whole pile being worth less than it is.
 */
export interface BatchValue {
  /** Sum of the priced rows, in USD. */
  total: number;
  /** Rows that had a price. */
  priced: number;
  /** Rows being valued. */
  of: number;
}

function isPrice(price: number | undefined): price is number {
  // Zero is not a price: absent means unknown, and $0 would read as worthless.
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

export function batchValue<T>(rows: readonly T[], priceOf: (row: T) => number | undefined): BatchValue {
  let total = 0;
  let priced = 0;
  for (const row of rows) {
    const price = priceOf(row);
    if (!isPrice(price)) continue;
    total += price;
    priced += 1;
  }
  return { total, priced, of: rows.length };
}

/**
 * The review footer's line, or null when no row is being added.
 *
 * Says it is still loading while any set's prices are on their way, so a
 * partial total is never presented as final.
 */
export function batchValueSummary(value: BatchValue, loading: boolean): string | null {
  if (value.of <= 0) return null;
  const worth = value.priced > 0 ? formatUsd(value.total) : "unknown";
  return `Batch worth ${worth} · ${value.priced} of ${value.of} priced${loading ? " · loading prices" : ""}`;
}

/** One row's line: the market price of the printing picked, or nothing. */
export function rowPriceNote(price: number | undefined): string | null {
  return isPrice(price) ? `Market ${formatUsd(price)}` : null;
}
