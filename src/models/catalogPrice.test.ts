import { describe, expect, it } from "vitest";
import { catalogPrice, catalogPriceIndex, finishToPriceKey } from "./catalogPrice.ts";
import type { PokemonCardSummary } from "./cards.ts";

const card = (over: Partial<PokemonCardSummary> = {}): PokemonCardSummary => ({
  id: "smp-SM210",
  name: "Moltres & Zapdos & Articuno GX",
  setName: "SM Black Star Promos",
  setCode: "SMP",
  collectorNumber: "SM210",
  ...over,
});

describe("finishToPriceKey", () => {
  it("maps the printings pokemontcg.io actually prices", () => {
    expect(finishToPriceKey("normal")).toBe("normal");
    expect(finishToPriceKey("holo")).toBe("holofoil");
    expect(finishToPriceKey("reverse")).toBe("reverseHolofoil");
  });

  it("has no key for a patterned foil", () => {
    // pokemontcg.io reports no pattern foils in any set, so the plain reverse
    // price would be a fabricated number rather than a fallback.
    expect(finishToPriceKey("reverse:pokeball")).toBeUndefined();
    expect(finishToPriceKey("reverse:masterball")).toBeUndefined();
    expect(finishToPriceKey("holo:cosmos")).toBeUndefined();
  });

  it("has no key for a printing pokemontcg.io does not break out", () => {
    expect(finishToPriceKey("shadowless")).toBeUndefined();
  });
});

describe("catalogPriceIndex", () => {
  it("prices the printing the collection actually holds", () => {
    // The live case: TCGdex returns an empty tcgplayer block for this promo,
    // pokemontcg.io has holofoil market $169.02, and the row is marked holo.
    const index = catalogPriceIndex([card({ variantPrices: { holofoil: 169.02 } })]);
    expect(catalogPrice(index, "smp-SM210", "holo")).toBe(169.02);
  });

  it("does not lend one printing's price to another", () => {
    const index = catalogPriceIndex([card({ variantPrices: { holofoil: 169.02 } })]);
    expect(catalogPrice(index, "smp-SM210", "normal")).toBeUndefined();
    expect(catalogPrice(index, "smp-SM210", "reverse")).toBeUndefined();
  });

  it("treats zero as unknown rather than free", () => {
    const index = catalogPriceIndex([card({ variantPrices: { normal: 0, holofoil: 12 } })]);
    expect(catalogPrice(index, "smp-SM210", "normal")).toBeUndefined();
    expect(catalogPrice(index, "smp-SM210", "holo")).toBe(12);
  });

  it("skips cards with no pricing at all", () => {
    expect(catalogPriceIndex([card()]).size).toBe(0);
  });

  it("is safe with no index", () => {
    expect(catalogPrice(undefined, "smp-SM210", "holo")).toBeUndefined();
  });
});
