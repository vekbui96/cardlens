import { describe, expect, it } from "vitest";
import { buildPrintingIndex } from "../../../models/printingIndex.ts";
import { printingsOf } from "./printings.ts";

describe("printingsOf", () => {
  it("prefers the real printing list, patterns included", () => {
    const index = buildPrintingIndex({
      "25": [{ type: "normal" }, { type: "reverse" }, { type: "reverse", foil: "pokeball" }],
    });

    const { finishes, source } = printingsOf(index, "25");

    expect(source).toBe("printings");
    // Sorted for a stable list: plain printings before patterned ones.
    expect(finishes).toEqual(["normal", "reverse", "reverse:pokeball"]);
  });

  it("matches a padded number against an unpadded one, and the other way round", () => {
    // TCGdex pads modern sets and pokemontcg.io does not; "007" and "7" are the
    // same card, and a miss here reads as "this card has no printings".
    const padded = buildPrintingIndex({ "007": [{ type: "holo" }] });
    expect(printingsOf(padded, "7").finishes).toEqual(["holo"]);

    const bare = buildPrintingIndex({ "7": [{ type: "holo" }] });
    expect(printingsOf(bare, "007").finishes).toEqual(["holo"]);
  });

  it("falls back to what the pricing payload implies, and says so", () => {
    const { finishes, source } = printingsOf(null, "4", { normal: true, holofoil: true });

    expect(source).toBe("pricing");
    expect(finishes).toEqual(["normal", "holo"]);
  });

  it("offers nothing when nothing vouches for the card", () => {
    // `availableFinishes` would pad this to ["normal"], and marking against that
    // padding is what wrote `normal` onto holo-only cards in a live collection.
    // An empty list plus a note is the honest answer.
    const { finishes, source } = printingsOf(null, "4", undefined);

    expect(finishes).toEqual([]);
    expect(source).toBe("unknown");
  });

  it("does not use the pricing fallback when the real list has the card", () => {
    const index = buildPrintingIndex({ "4": [{ type: "holo" }] });

    // Pricing claims a normal exists; TCGdex, which knows the set, does not.
    expect(printingsOf(index, "4", { normal: true }).finishes).toEqual(["holo"]);
  });
});
