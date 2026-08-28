import { describe, expect, it } from "vitest";
import { collectorNumberFromCardId, marketPrice } from "./marketPrice.ts";
import { buildPrintingIndex } from "./printingIndex.ts";

/** A printings index as buildPrintingIndex produces one, for a single card. */
function indexWith(number: string, prices: Record<string, number>) {
  return buildPrintingIndex({
    [number]: Object.entries(prices).map(([key, price]) => ({
      type: key.startsWith("reverse") ? "reverse" : key === "holofoil" ? "holo" : "normal",
      key,
      price,
    })),
  } as never);
}

describe("marketPrice", () => {
  it("takes TCGdex's price when there is one", () => {
    const index = indexWith("4", { normal: 12.5 });
    const catalog = new Map([["me5-4|normal", 99]]);
    // TCGdex is the first oracle and stays first: it prices per printing and
    // covers the modern sets this collection is mostly made of.
    expect(marketPrice(index, catalog, "me5-4", "4", "normal")).toBe(12.5);
  });

  it("falls back to the catalog where TCGdex has nothing", () => {
    // Measured on smp-SM210: TCGdex returns an empty tcgplayer block and
    // pokemontcg.io has holofoil market $169.02. Without this the most
    // valuable cards in the collection price at nothing.
    const catalog = new Map([["smp-SM210|holofoil", 169.02]]);
    expect(marketPrice(null, catalog, "smp-SM210", "SM210", "holo")).toBe(169.02);
  });

  it("is undefined when neither oracle knows, rather than zero", () => {
    expect(marketPrice(null, new Map(), "me5-4", "4", "normal")).toBeUndefined();
    expect(marketPrice(null, undefined, "me5-4", "4", "normal")).toBeUndefined();
  });

  it("never invents a price for a patterned foil", () => {
    // pokemontcg.io reports no Poké Ball or Master Ball reverse in any set, so
    // the catalog fallback must not quietly serve the plain reverse price.
    const catalog = new Map([["me5-4|reverseHolofoil", 8]]);
    expect(marketPrice(null, catalog, "me5-4", "4", "reverse:pokeball")).toBeUndefined();
  });

  it("gives Home and the owned-cards list the same answer", () => {
    // The whole reason this function exists. Home valued the collection and the
    // owned list priced the very printings behind that total, each writing the
    // oracle order out for itself — so the two could drift and stop adding up.
    const index = indexWith("4", { normal: 12.5 });
    const catalog = new Map([["me5-4|normal", 99]]);

    // Home's call site: collector number derived from the card id.
    const home = marketPrice(index, catalog, "me5-4", collectorNumberFromCardId("me5-4"), "normal");
    // The list's call site: the catalog's own number, once it has answered.
    const list = marketPrice(index, catalog, "me5-4", "4", "normal");
    expect(home).toBe(list);
  });
});

describe("collectorNumberFromCardId", () => {
  it("takes everything after the first dash", () => {
    expect(collectorNumberFromCardId("me5-4")).toBe("4");
    expect(collectorNumberFromCardId("swsh45sv-SV001")).toBe("SV001");
    expect(collectorNumberFromCardId("smp-SM210")).toBe("SM210");
  });

  it("keeps a number that itself contains a dash", () => {
    // The first dash, not the last: set ids carry no dash, collector numbers
    // can. Splitting on the last would hand back only the trailing fragment.
    expect(collectorNumberFromCardId("swshp-SWSH001-alt")).toBe("SWSH001-alt");
  });

  it("returns the id unchanged when there is no dash to split on", () => {
    expect(collectorNumberFromCardId("weird")).toBe("weird");
  });
});
