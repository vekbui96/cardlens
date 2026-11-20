import { describe, expect, it } from "vitest";
import { batchValue, batchValueSummary, rowPriceNote } from "./scanValue.ts";

interface Row {
  id: string;
  finish: string;
}

/** A tiny price table keyed by `id|finish`, standing in for the printings oracle. */
const PRICES: Record<string, number> = {
  "a|normal": 1.5,
  "a|reverse": 4.25,
  "b|normal": 10,
};
const priceOf = (row: Row) => PRICES[`${row.id}|${row.finish}`];

describe("batchValue", () => {
  it("sums the priced rows and counts the unpriced ones", () => {
    const value = batchValue(
      [
        { id: "a", finish: "normal" },
        { id: "b", finish: "normal" },
        { id: "c", finish: "normal" },
      ],
      priceOf,
    );
    expect(value).toEqual({ total: 11.5, priced: 2, of: 3 });
  });

  it("follows the printing picked for each row", () => {
    // Switching a row's finish chip from Normal to Reverse is a different card
    // to a collector, and a different price.
    const normal = batchValue([{ id: "a", finish: "normal" }], priceOf);
    const reverse = batchValue([{ id: "a", finish: "reverse" }], priceOf);
    expect(normal.total).toBe(1.5);
    expect(reverse.total).toBe(4.25);
  });

  it("never guesses a price it does not have", () => {
    // A zero or missing price is unpriced, not $0: a silent $0 reads as a
    // worthless card rather than an unknown one.
    const value = batchValue(
      [
        { id: "zero", finish: "normal" },
        { id: "missing", finish: "normal" },
      ],
      (row) => (row.id === "zero" ? 0 : undefined),
    );
    expect(value).toEqual({ total: 0, priced: 0, of: 2 });
  });
});

describe("batchValueSummary", () => {
  it("says what the batch is worth and how much of it that covers", () => {
    expect(batchValueSummary({ total: 42.1, priced: 22, of: 24 }, false)).toBe(
      "Batch worth $42.10 · 22 of 24 priced",
    );
  });

  it("does not present a partial total as final while prices are loading", () => {
    expect(batchValueSummary({ total: 1.5, priced: 1, of: 3 }, true)).toBe(
      "Batch worth $1.50 · 1 of 3 priced · loading prices",
    );
  });

  it("says unknown rather than $0 when nothing is priced", () => {
    expect(batchValueSummary({ total: 0, priced: 0, of: 3 }, false)).toBe(
      "Batch worth unknown · 0 of 3 priced",
    );
  });

  it("says nothing when no row is being added", () => {
    expect(batchValueSummary({ total: 0, priced: 0, of: 0 }, false)).toBeNull();
  });
});

describe("rowPriceNote", () => {
  it("shows the market price of the picked printing", () => {
    expect(rowPriceNote(4.25)).toBe("Market $4.25");
  });

  it("says nothing for an unpriced printing", () => {
    expect(rowPriceNote(undefined)).toBeNull();
    expect(rowPriceNote(0)).toBeNull();
  });
});
