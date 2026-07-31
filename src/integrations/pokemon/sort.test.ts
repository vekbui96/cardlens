import { describe, expect, it } from "vitest";
import { byCollectorNumber, byPriceDesc } from "./sort.ts";
import type { PokemonCardSummary } from "../../models/cards.ts";

const card = (collectorNumber: string, marketPrice?: number): PokemonCardSummary => ({
  id: `x-${collectorNumber}`,
  name: "Card",
  setName: "Set",
  setCode: "ST",
  collectorNumber,
  ...(marketPrice === undefined ? {} : { marketPrice }),
});

const order = (nums: string[]) =>
  nums
    .map((n) => card(n))
    .sort(byCollectorNumber)
    .map((c) => c.collectorNumber);

describe("byCollectorNumber", () => {
  it("orders numerically, not lexically", () => {
    // The whole point: "1, 10, 2" is what a string sort gives and is useless
    // for working through a binder.
    expect(order(["10", "2", "1"])).toEqual(["1", "2", "10"]);
  });

  it("handles three-digit sets", () => {
    expect(order(["100", "99", "9"])).toEqual(["9", "99", "100"]);
  });

  it("treats zero-padded numbers as their value", () => {
    expect(order(["003", "1", "02"])).toEqual(["1", "02", "003"]);
  });

  it("keeps lettered subsets in their own run, after the plain numbers", () => {
    expect(order(["TG01", "5", "TG02", "1"])).toEqual(["1", "5", "TG01", "TG02"]);
  });

  it("orders alt-numbered cards next to their base number", () => {
    expect(order(["101a", "102", "101"])).toEqual(["101", "101a", "102"]);
  });

  it("puts unnumbered cards last rather than first", () => {
    // Parsing "" as 0 would float junk to the top of every set.
    const sorted = order(["", "2", "1"]);
    expect(sorted[sorted.length - 1]).toBe("");
  });

  it("is stable enough to be deterministic across equal inputs", () => {
    expect(order(["7", "7"])).toEqual(["7", "7"]);
  });
});

describe("byPriceDesc", () => {
  it("sorts highest price first", () => {
    const sorted = [card("1", 5), card("2", 50), card("3", 20)].sort(byPriceDesc);
    expect(sorted.map((c) => c.marketPrice)).toEqual([50, 20, 5]);
  });

  it("puts unpriced cards last", () => {
    const sorted = [card("1"), card("2", 3)].sort(byPriceDesc);
    expect(sorted[0]?.marketPrice).toBe(3);
  });
});
