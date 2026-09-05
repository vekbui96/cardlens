import { describe, expect, it } from "vitest";
import { sortOwned, type OwnedPrintingRow } from "../../../models/ownedSort.ts";

/**
 * The owned list orders by COLLECTOR NUMBER, not by price.
 *
 * This screen writes no comparator of its own. `sortOwned` already routes its
 * "Set & number" key through `integrations/pokemon/sort.ts`, and the lettered
 * runs — `TG01`, `SV001`, `H12` — are exactly the rules a fresh one would get
 * wrong. What is tested here is the reuse: that the three shapes the spec calls
 * out come back in an order a collector would recognise from a binder.
 *
 * It is a test of a decision (use the shared comparator) rather than of the
 * comparator, which has its own tests in `models/ownedSort.test.ts`.
 */

const row = (collectorNumber: string, price?: number): OwnedPrintingRow => ({
  cardId: `sv3-${collectorNumber}`,
  setId: "sv3",
  setName: "Obsidian Flames",
  name: `Card ${collectorNumber}`,
  collectorNumber,
  finish: "normal",
  ...(price === undefined ? {} : { price }),
  at: 0,
});

const order = (rows: OwnedPrintingRow[]) => sortOwned(rows, "set").map((r) => r.collectorNumber);

describe("set & number order", () => {
  it("keeps 1, 2, 10 in binder order rather than in string order", () => {
    expect(order([row("10"), row("2"), row("1")])).toEqual(["1", "2", "10"]);
  });

  it("sorts the three shapes the spec calls out sanely", () => {
    // Plain numbers first, then each lettered run together and in its own
    // numeric order. `101a` belongs beside 101, not at the end with the TGs.
    expect(order([row("TG01"), row("SV001"), row("101a"), row("101"), row("TG10"), row("SV002")])).toEqual([
      "101",
      "101a",
      "SV001",
      "SV002",
      "TG01",
      "TG10",
    ]);
  });

  it("does not fall back to price — the dearest card does not jump the queue", () => {
    expect(order([row("102", 900), row("101", 1)])).toEqual(["101", "102"]);
  });
});

describe("price order", () => {
  it("puts unpriced printings last, not at zero: unknown is not worthless", () => {
    const rows = [row("1"), row("2", 5), row("3", 50)];
    expect(sortOwned(rows, "price").map((r) => r.collectorNumber)).toEqual(["3", "2", "1"]);
  });
});
