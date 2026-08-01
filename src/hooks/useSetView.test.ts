import { describe, expect, it } from "vitest";
import { buildPrintingIndex } from "../models/printingIndex.ts";
import { headlinePrice } from "./useSetView.ts";
import type { PokemonCardSummary } from "../models/cards.ts";

function card(over: Partial<PokemonCardSummary> = {}): PokemonCardSummary {
  return {
    id: "me5-007",
    name: "Test Card",
    collectorNumber: "007",
    imageSmall: "",
    ...over,
  } as PokemonCardSummary;
}

describe("headlinePrice", () => {
  it("prefers the catalog price when there is one", () => {
    // pokemontcg.io priced this card; that is the number the rest of the app
    // already sorts and displays by, so it stays authoritative.
    const index = buildPrintingIndex({ "007": [{ type: "normal", price: 99 }] });

    expect(headlinePrice(card({ marketPrice: 12 }), index)).toBe(12);
  });

  it("falls back to the dearest known printing when the catalog has none", () => {
    // Measured live: pokemontcg.io returns pricing for 0/120 Pitch Black cards.
    // Without this the whole set reads "Unavailable" despite TCGdex pricing it.
    const index = buildPrintingIndex({
      "007": [
        { type: "normal", price: 1.5 },
        { type: "reverse", price: 4.25 },
      ],
    });

    expect(headlinePrice(card({ marketPrice: undefined }), index)).toBe(4.25);
  });

  it("returns undefined when nothing prices the card", () => {
    const index = buildPrintingIndex({ "007": [{ type: "reverse", foil: "pokeball" }] });

    expect(headlinePrice(card({ marketPrice: undefined }), index)).toBeUndefined();
  });

  it("treats a zero catalog price as absent", () => {
    const index = buildPrintingIndex({ "007": [{ type: "normal", price: 3 }] });

    expect(headlinePrice(card({ marketPrice: 0 }), index)).toBe(3);
  });
});
