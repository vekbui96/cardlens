import { describe, expect, it } from "vitest";
import { filterByRarity, rarityFilterAt, RARITY_FILTERS } from "./rarityFilters.ts";

const cards = [
  { id: "a", rarity: "Illustration Rare" },
  { id: "b", rarity: "Ultra Rare" },
  { id: "c", rarity: "Rare Ultra" },
  { id: "d" },
];

describe("filterByRarity", () => {
  it("returns everything when there is no filter", () => {
    expect(filterByRarity(cards, null)).toBe(cards);
  });

  it("keeps every rarity the filter names", () => {
    // "Full Art" spans two era-specific rarity names, so both must match.
    const fullArt = RARITY_FILTERS.find((f) => f.key === "fullart");
    expect(filterByRarity(cards, fullArt?.rarities ?? null).map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("drops cards with no rarity, as a rarity query does", () => {
    expect(filterByRarity(cards, ["Illustration Rare"]).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("rarityFilterAt", () => {
  it("wraps in both directions so swiping never runs out", () => {
    expect(rarityFilterAt(-1)).toBe(RARITY_FILTERS[RARITY_FILTERS.length - 1]);
    expect(rarityFilterAt(RARITY_FILTERS.length)).toBe(RARITY_FILTERS[0]);
  });
});
