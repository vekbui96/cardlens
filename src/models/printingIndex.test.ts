import { describe, expect, it } from "vitest";
import type { Printing } from "../integrations/tcgdex/client.ts";
import { buildPrintingIndex } from "./printingIndex.ts";

/** A set where every card has the same printings, indexed padded and unpadded. */
function uniformSet(cards: number, printings: Printing[]): Record<string, Printing[]> {
  const byNumber: Record<string, Printing[]> = {};
  for (let n = 1; n <= cards; n++) {
    byNumber[String(n).padStart(3, "0")] = printings;
    byNumber[String(n)] = printings;
  }
  return byNumber;
}

describe("buildPrintingIndex", () => {
  it("returns null when there are no printings to index", () => {
    expect(buildPrintingIndex(null)).toBeNull();
    expect(buildPrintingIndex(undefined)).toBeNull();
  });

  it("counts each card once even though numbers are indexed padded and unpadded", () => {
    // TCGdex pads modern sets and pokemontcg.io does not, so both forms are
    // keys. Counting entries rather than cards would double every total.
    const index = buildPrintingIndex(uniformSet(10, [{ type: "normal" }, { type: "reverse" }]));

    expect(index?.packTotal).toBe(20);
    expect(index?.all).toEqual(["normal", "reverse"]);
  });

  it("keeps both number forms addressable", () => {
    const index = buildPrintingIndex(uniformSet(10, [{ type: "normal" }]));

    expect(index?.byNumber["007"]).toEqual(["normal"]);
    expect(index?.byNumber["7"]).toEqual(["normal"]);
  });

  it("excludes a printing too rare to be a pack pull", () => {
    // White Flare's holo:tinsel: 2 cards out of 173, against pack printings
    // that appear on 71-105. Frequency is the only available proxy.
    const byNumber = uniformSet(100, [{ type: "normal" }]);
    byNumber["001"] = [{ type: "normal" }, { type: "holo", foil: "tinsel" }];
    byNumber["1"] = byNumber["001"];

    const index = buildPrintingIndex(byNumber);

    expect(index?.excluded).toEqual([{ finish: "holo:tinsel", cards: 1 }]);
    expect(index?.packTotal).toBe(100);
    // Still offered in the picker — excluded from the denominator, not hidden.
    expect(index?.all).toContain("holo:tinsel");
  });

  it("joins a type and its foil into one key", () => {
    const index = buildPrintingIndex({ "1": [{ type: "reverse", foil: "pokeball" }] });

    expect(index?.byNumber["1"]).toEqual(["reverse:pokeball"]);
  });
});
