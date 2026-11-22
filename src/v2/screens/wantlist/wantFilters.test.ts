import { beforeEach, describe, expect, it } from "vitest";
import type { WantSet } from "./wantList.ts";
import {
  DEFAULT_WANT_FILTERS,
  WANT_FILTERS_KEY,
  applyWantFilters,
  readWantFilters,
  storeWantFilters,
  wantFilteredHeadline,
  wantRarities,
} from "./wantFilters.ts";

const set: WantSet = {
  cards: [
    { collectorNumber: "1", finish: "normal", price: 5, rarity: "Common" },
    { collectorNumber: "2", finish: "holo", price: null, rarity: "Rare" },
    { collectorNumber: "3", finish: "holo", price: 50.25, rarity: "Rare" },
    { collectorNumber: "4", finish: "normal", price: 0.5, rarity: "Common" },
    { collectorNumber: "5", finish: "normal", price: 9, rarity: "Ultra Rare" },
  ],
  missing: 5,
  priced: 4,
  unpriced: 1,
  total: 64.75,
};
const nums = (w: WantSet) => w.cards.map((c) => c.collectorNumber);

describe("applyWantFilters", () => {
  it("leaves set order and the totals alone by default", () => {
    expect(applyWantFilters(set, DEFAULT_WANT_FILTERS)).toEqual(set);
  });

  it("sorts cheapest first with unpriced cards last", () => {
    expect(nums(applyWantFilters(set, { ...DEFAULT_WANT_FILTERS, sort: "cheapest" }))).toEqual([
      "4",
      "1",
      "5",
      "3",
      "2",
    ]);
  });

  it("sorts most expensive first with unpriced cards still last", () => {
    expect(nums(applyWantFilters(set, { ...DEFAULT_WANT_FILTERS, sort: "expensive" }))).toEqual([
      "3",
      "5",
      "1",
      "4",
      "2",
    ]);
  });

  it("keeps only the chosen rarities and recomputes the total from what is left", () => {
    const rare = applyWantFilters(set, { ...DEFAULT_WANT_FILTERS, rarities: ["Rare"] });
    expect(nums(rare)).toEqual(["2", "3"]);
    expect(rare).toMatchObject({ missing: 2, priced: 1, unpriced: 1, total: 50.25 });
    const two = applyWantFilters(set, { ...DEFAULT_WANT_FILTERS, rarities: ["Common", "Ultra Rare"] });
    expect(two).toMatchObject({ missing: 3, priced: 3, unpriced: 0, total: 14.5 });
  });

  it("does not mutate its input", () => {
    applyWantFilters(set, { ...DEFAULT_WANT_FILTERS, sort: "cheapest" });
    expect(nums(set)).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("wantRarities", () => {
  it("lists each rarity once, in first-seen order, across sets", () => {
    expect(
      wantRarities([set, null, undefined, { ...set, cards: [{ ...set.cards[0], rarity: "Promo" }] }]),
    ).toEqual(["Common", "Rare", "Ultra Rare", "Promo"]);
  });
});

describe("wantFilteredHeadline", () => {
  it("states the count and the price of what is shown", () => {
    expect(wantFilteredHeadline({ missing: 31, priced: 31, unpriced: 0, total: 96 })).toBe(
      "Showing 31 cards, about $96.00",
    );
    expect(wantFilteredHeadline({ missing: 1, priced: 0, unpriced: 1, total: 0 })).toBe(
      "Showing 1 card, none priced",
    );
    expect(wantFilteredHeadline({ missing: 3, priced: 2, unpriced: 1, total: 2.9 })).toBe(
      "Showing 3 cards, about $2.90, 1 unpriced",
    );
    expect(wantFilteredHeadline({ missing: 0, priced: 0, unpriced: 0, total: 0 })).toBe(
      "No missing cards match these filters",
    );
  });
});

describe("stored filters", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips and clears when back at the defaults", () => {
    const f = { setId: "sv3", rarities: ["Rare"], sort: "cheapest" as const };
    storeWantFilters(f);
    expect(readWantFilters()).toEqual(f);
    storeWantFilters(DEFAULT_WANT_FILTERS);
    expect(window.localStorage.getItem(WANT_FILTERS_KEY)).toBeNull();
  });

  it("falls back to the defaults on anything unreadable", () => {
    window.localStorage.setItem(WANT_FILTERS_KEY, "{not json");
    expect(readWantFilters()).toEqual(DEFAULT_WANT_FILTERS);
    window.localStorage.setItem(WANT_FILTERS_KEY, JSON.stringify({ setId: 4, rarities: "x", sort: "bogus" }));
    expect(readWantFilters()).toEqual(DEFAULT_WANT_FILTERS);
  });
});
