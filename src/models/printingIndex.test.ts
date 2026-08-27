import { describe, expect, it } from "vitest";
import type { Printing } from "../integrations/tcgdex/client.ts";
import { buildPrintingIndex, printingPrice } from "./printingIndex.ts";

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

describe("printingPrice", () => {
  it("indexes a price per number and finish", () => {
    const index = buildPrintingIndex({
      "001": [
        { type: "normal", price: 1.5 },
        { type: "reverse", price: 4.25 },
      ],
    });

    expect(printingPrice(index, "001", "normal")).toBe(1.5);
    expect(printingPrice(index, "001", "reverse")).toBe(4.25);
  });

  it("resolves an unpadded number against a padded key", () => {
    // TCGdex pads modern sets; pokemontcg.io does not. Both forms must answer.
    const index = buildPrintingIndex({ "007": [{ type: "normal", price: 2 }] });

    expect(printingPrice(index, "7", "normal")).toBe(2);
  });

  it("reports an unpriced printing as undefined rather than zero", () => {
    // A pattern foil has no upstream price. Zero would total up as worthless
    // rather than unknown.
    const index = buildPrintingIndex({
      "001": [{ type: "reverse", foil: "pokeball" }],
    });

    expect(printingPrice(index, "001", "reverse:pokeball")).toBeUndefined();
  });

  it("prices a patterned foil from the base type when the provider has no pattern", () => {
    // TCGdex models variants as flat booleans (normal/reverse/holo) and has no
    // concept of ball patterns, so a set full of pokeball reverses still comes
    // back as a bare `reverse`. The collection holds `reverse:pokeball`, so an
    // exact-match-only lookup resolves to nothing and the row silently totals
    // as $0. Measured on me2pt5: 15 of 63 held cards.
    const index = buildPrintingIndex({
      "001": [{ type: "reverse", price: 3.5 }],
    });

    expect(printingPrice(index, "001", "reverse:pokeball")).toBe(3.5);
  });

  it("does not fall back across different types", () => {
    // A holo price must never answer for a reverse. Stripping the foil is a
    // narrowing of the same printing; crossing types is a different card.
    const index = buildPrintingIndex({
      "001": [{ type: "holo", price: 12 }],
    });

    expect(printingPrice(index, "001", "reverse:pokeball")).toBeUndefined();
  });

  it("returns undefined for a missing index or unknown card", () => {
    expect(printingPrice(null, "001", "normal")).toBeUndefined();
    expect(printingPrice(buildPrintingIndex({}), "999", "normal")).toBeUndefined();
  });
});

describe("printingPrice and foils", () => {
  const index = buildPrintingIndex({
    "215": [{ type: "holo" }],
    "50": [{ type: "reverse" }],
  })!;

  it("lets a pattern foil borrow its base reverse price", () => {
    // Providers do not model pattern foils at all, so without this a Poké Ball
    // reverse prices at nothing even though it is the same print run.
    index.prices["50|reverse"] = 4.25;
    expect(printingPrice(index, "50", "reverse:pokeball")).toBe(4.25);
  });

  it("refuses to price a STAMP at the base card's price", () => {
    // A staff promo is a different, scarcer object that happens to share a
    // number. Borrowing here produced a $2.4k staff Umbreon in a binder total —
    // a made-up number that looked exactly like a real one.
    index.prices["215|holo"] = 2400;
    expect(printingPrice(index, "215", "holo:staff")).toBeUndefined();
    expect(printingPrice(index, "215", "holo:jumbo")).toBeUndefined();
    expect(printingPrice(index, "215", "normal:comic-con-2009")).toBeUndefined();
  });

  it("still never crosses types", () => {
    // A holo price answering for a reverse would be wrong in both directions.
    expect(printingPrice(index, "215", "reverse")).toBeUndefined();
  });
});
