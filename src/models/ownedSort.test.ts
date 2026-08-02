import { describe, expect, it } from "vitest";
import { sortOwned, totalOf, type OwnedPrintingRow } from "./ownedSort.ts";

const row = (over: Partial<OwnedPrintingRow> = {}): OwnedPrintingRow => ({
  cardId: "me5-1",
  setId: "me5",
  setName: "Pitch Black",
  name: "Tropius",
  collectorNumber: "1",
  finish: "normal",
  at: 1,
  ...over,
});

const ids = (rows: OwnedPrintingRow[]) => rows.map((r) => `${r.collectorNumber}:${r.finish}`);

describe("sortOwned", () => {
  it("puts the dearest first", () => {
    const rows = [
      row({ collectorNumber: "1", price: 0.09 }),
      row({ collectorNumber: "2", price: 4.25 }),
      row({ collectorNumber: "3", price: 1.5 }),
    ];
    expect(ids(sortOwned(rows, "price")).map((s) => s.split(":")[0])).toEqual(["2", "3", "1"]);
  });

  it("sorts unpriced printings last, not as worthless", () => {
    // A pattern foil has no upstream price. Treating that as 0 would bury it
    // below a 1-cent common, which is a claim the data does not support.
    const rows = [
      row({ collectorNumber: "1" }),
      row({ collectorNumber: "2", price: 0.01 }),
      row({ collectorNumber: "3", price: 5 }),
    ];
    expect(ids(sortOwned(rows, "price")).map((s) => s.split(":")[0])).toEqual(["3", "2", "1"]);
  });

  it("breaks price ties by set and collector number, so the order never shuffles", () => {
    // Most of this catalogue prices within a cent of everything else, so a
    // price sort is mostly ties and an unstable one would reorder on rerender.
    const rows = [
      row({ collectorNumber: "10", price: 1 }),
      row({ collectorNumber: "2", price: 1 }),
      row({ collectorNumber: "1", price: 1 }),
    ];
    const once = ids(sortOwned(rows, "price"));
    expect(once.map((s) => s.split(":")[0])).toEqual(["1", "2", "10"]);
    expect(ids(sortOwned(sortOwned(rows, "price"), "price"))).toEqual(once);
  });

  it("orders the same card's printings consistently", () => {
    const rows = [
      row({ collectorNumber: "1", finish: "reverse", price: 1 }),
      row({ collectorNumber: "1", finish: "normal", price: 1 }),
    ];
    expect(ids(sortOwned(rows, "set"))).toEqual(["1:normal", "1:reverse"]);
  });

  it("sorts most recently added first", () => {
    const rows = [row({ collectorNumber: "1", at: 10 }), row({ collectorNumber: "2", at: 99 })];
    expect(ids(sortOwned(rows, "added")).map((s) => s.split(":")[0])).toEqual(["2", "1"]);
  });

  it("sorts by name", () => {
    const rows = [row({ name: "Zubat", collectorNumber: "9" }), row({ name: "Abra", collectorNumber: "1" })];
    expect(sortOwned(rows, "name").map((r) => r.name)).toEqual(["Abra", "Zubat"]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ collectorNumber: "1", price: 1 }), row({ collectorNumber: "2", price: 9 })];
    const before = ids(rows);
    sortOwned(rows, "price");
    expect(ids(rows)).toEqual(before);
  });
});

describe("totalOf", () => {
  it("sums the priced rows and counts the rest", () => {
    const { total, unpriced } = totalOf([row({ price: 1.5 }), row({ price: 0.25 }), row({})]);
    expect(total).toBeCloseTo(1.75);
    expect(unpriced).toBe(1);
  });

  it("is empty-safe", () => {
    expect(totalOf([])).toEqual({ total: 0, unpriced: 0 });
  });
});
