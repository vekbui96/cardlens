import { describe, expect, it } from "vitest";
import {
  filterOwned,
  sortOwned,
  topByValue,
  totalOf,
  weekChange,
  type OwnedPrintingRow,
} from "./ownedSort.ts";

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

describe("sortOwned by biggest change", () => {
  const eur = (avg1: number, avg7: number) => ({ avg1, avg7, avg30: avg7 });
  const nums = (rows: OwnedPrintingRow[]) => rows.map((r) => r.collectorNumber);

  it("ranks by absolute week-on-week percent, risers and fallers together", () => {
    const rows = [
      row({ collectorNumber: "1", eur: eur(11, 10) }), // +10%
      row({ collectorNumber: "2", eur: eur(7, 10) }), // -30%
      row({ collectorNumber: "3", eur: eur(12, 10) }), // +20%
    ];
    expect(nums(sortOwned(rows, "change"))).toEqual(["2", "3", "1"]);
  });

  it("sorts rows with no averages, or under the floor, last", () => {
    const rows = [
      row({ collectorNumber: "1" }),
      row({ collectorNumber: "2", eur: eur(0.03, 0.02) }), // +50% of a cent: not a move
      row({ collectorNumber: "3", eur: eur(1.1, 1) }),
    ];
    expect(nums(sortOwned(rows, "change"))).toEqual(["3", "1", "2"]);
  });

  it("breaks ties by set and collector number", () => {
    const rows = [
      row({ collectorNumber: "2", eur: eur(11, 10) }),
      row({ collectorNumber: "1", eur: eur(11, 10) }),
    ];
    expect(nums(sortOwned(rows, "change"))).toEqual(["1", "2"]);
  });
});

describe("weekChange", () => {
  it("is the percent for a qualifying row and undefined otherwise", () => {
    expect(weekChange(row({ eur: { avg1: 12, avg7: 10, avg30: 10 } }))).toBeCloseTo(20);
    expect(weekChange(row({ eur: { avg1: 0.5, avg7: 0.4, avg30: 0.4 } }))).toBeUndefined();
    expect(weekChange(row({}))).toBeUndefined();
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

describe("topByValue", () => {
  it("keeps the n dearest priced printings, dearest first", () => {
    const rows = [
      row({ collectorNumber: "1", price: 2 }),
      row({ collectorNumber: "2", price: 50 }),
      row({ collectorNumber: "3", price: 0.1 }),
      row({ collectorNumber: "4", price: 12 }),
      row({ collectorNumber: "5", price: 7 }),
      row({ collectorNumber: "6", price: 30 }),
      row({ collectorNumber: "7", price: 1 }),
    ];
    expect(ids(topByValue(rows, 5))).toEqual(["2:normal", "6:normal", "4:normal", "5:normal", "1:normal"]);
  });

  it("never lists an unpriced printing, nor one priced at zero", () => {
    // Unknown is not worthless, and it is not valuable either: the strip is
    // "what carries the total", and these contribute nothing to it.
    const rows = [
      row({ collectorNumber: "1" }),
      row({ collectorNumber: "2", price: 0 }),
      row({ collectorNumber: "3", price: 4 }),
    ];
    expect(ids(topByValue(rows, 5))).toEqual(["3:normal"]);
  });

  it("returns fewer than n when fewer are priced, and nothing when none are", () => {
    expect(topByValue([row({ price: 3 }), row({ collectorNumber: "2", price: 1 })], 5)).toHaveLength(2);
    expect(topByValue([row({}), row({ collectorNumber: "2" })], 5)).toEqual([]);
    expect(topByValue([], 5)).toEqual([]);
  });

  it("breaks price ties the way the price sort does, so the strip never reshuffles", () => {
    const rows = [
      row({ collectorNumber: "9", price: 5 }),
      row({ collectorNumber: "3", price: 5, finish: "reverse" }),
      row({ collectorNumber: "3", price: 5 }),
    ];
    expect(ids(topByValue(rows, 2))).toEqual(["3:normal", "3:reverse"]);
  });

  it("does not reorder the caller's rows", () => {
    const rows = [row({ collectorNumber: "1", price: 1 }), row({ collectorNumber: "2", price: 9 })];
    topByValue(rows, 5);
    expect(ids(rows)).toEqual(["1:normal", "2:normal"]);
  });
});

describe("filterOwned", () => {
  const rows = [
    row({ cardId: "a", name: "Charizard ex", setName: "Obsidian Flames", collectorNumber: "125" }),
    row({ cardId: "b", name: "Tropius", setName: "Pitch Black", collectorNumber: "1" }),
    row({ cardId: "c", name: "Pikachu", setName: "Obsidian Flames", collectorNumber: "TG01" }),
  ];
  const names = (rs: OwnedPrintingRow[]) => rs.map((r) => r.cardId);

  it("matches by card name, ignoring case", () => {
    expect(names(filterOwned(rows, "CHARI"))).toEqual(["a"]);
  });

  it("matches by set name", () => {
    expect(names(filterOwned(rows, "obsidian"))).toEqual(["a", "c"]);
  });

  it("matches by card number", () => {
    expect(names(filterOwned(rows, "tg01"))).toEqual(["c"]);
  });

  it("trims whitespace around the query", () => {
    expect(names(filterOwned(rows, "  tropius  "))).toEqual(["b"]);
  });

  it("returns the same rows for an empty or blank query", () => {
    expect(filterOwned(rows, "")).toBe(rows);
    expect(filterOwned(rows, "   ")).toBe(rows);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterOwned(rows, "zzz")).toEqual([]);
  });
});
