import { describe, expect, it } from "vitest";
import type { PokemonSet } from "../../../models/cards.ts";
import type { Finish } from "../../../models/finishes.ts";
import {
  cardPrintings,
  collectorLine,
  exclusionAction,
  factRows,
  pricingCoverage,
  printingState,
  variantPrice,
  type CardFacts,
  type PrintingSource,
} from "./cardFacts.ts";

/**
 * The decisions, not the markup.
 *
 * Card details is the screen where a wrong answer is least visible: one card, a
 * handful of rows, every one of them plausible. Each case below is a printing
 * that could be silently dropped, a price that could be invented, or a number
 * that could disagree with the one printed on the card in your hand.
 */

function source(over: Partial<PrintingSource> = {}): PrintingSource {
  return {
    available: ["normal"],
    held: [],
    excluded: [],
    priceFor: () => undefined,
    ...over,
  };
}

describe("cardPrintings", () => {
  it("gives a card with three printings three independent rows", () => {
    const rows = cardPrintings(source({ available: ["normal", "reverse", "holo"] }));

    expect(rows.map((r) => r.finish)).toEqual(["normal", "reverse", "holo"]);
    // Distinct keys, or React reuses one row's state for another printing.
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it("labels an unknown foil in words rather than showing a raw key", () => {
    // Three 2025-26 sets introduced nine new foils between them; anything
    // hardcoded is wrong by the next release.
    const rows = cardPrintings(source({ available: ["reverse:sparkle-crown"] }));
    expect(rows[0].label).toBe("Sparkle crown Reverse");
  });

  it("keeps a held printing the catalog has never heard of, and marks it extra", () => {
    // Sets keep inventing foils; the collection is allowed to know about one
    // before the catalog does. Dropping it would make it unmarkable forever.
    const rows = cardPrintings(source({ available: ["normal"], held: ["reverse:pokeball"] }));

    expect(rows.map((r) => r.finish)).toEqual(["normal", "reverse:pokeball"]);
    expect(rows[1].extra).toBe(true);
    expect(rows[1].held).toBe(true);
  });

  it("still offers something to mark when the set knows of no printings at all", () => {
    // Pitch Black reports no variant data for any of its 120 cards. A details
    // screen with nothing to mark is a dead page.
    const rows = cardPrintings(source({ available: [] }));
    expect(rows.map((r) => r.finish)).toEqual(["normal"]);
  });

  it("treats owned and excluded as independent, not as alternatives", () => {
    // You can own a staff promo and still not count it toward the set. v1's
    // sheet disables the mark on an excluded row, which makes an owned printing
    // unmarkable the moment it is excluded.
    const rows = cardPrintings(source({ available: ["holo"], held: ["holo"], excluded: ["holo"] }));
    expect(rows[0].held).toBe(true);
    expect(rows[0].excluded).toBe(true);
    expect(printingState(rows[0])).toBe("owned");
  });

  it("reads its price through the caller's lookup, per printing", () => {
    const prices: Record<Finish, number> = { normal: 8.11, holo: 58.42 };
    const rows = cardPrintings(
      source({ available: ["normal", "reverse", "holo"], priceFor: (f) => prices[f] }),
    );
    expect(rows.map((r) => r.price)).toEqual([8.11, undefined, 58.42]);
  });
});

describe("exclusionAction", () => {
  it("names the printing, because there are six of these on a card", () => {
    const [row] = cardPrintings(source({ available: ["reverse"] }));
    expect(exclusionAction(row)).toEqual({
      text: "Exclude",
      label: "Exclude Reverse Holo from this set",
    });
  });

  it("says what pressing it will do, not what the state currently is", () => {
    const [row] = cardPrintings(source({ available: ["reverse"], excluded: ["reverse"] }));
    expect(exclusionAction(row).text).toBe("Include");
  });
});

describe("variantPrice", () => {
  const prices = { normal: 4.25, holofoil: 10.5, reverseHolofoil: 2.75, firstEditionNormal: 900 };

  it("translates between the two price vocabularies", () => {
    expect(variantPrice("normal", prices)).toBe(4.25);
    expect(variantPrice("holo", prices)).toBe(10.5);
    expect(variantPrice("reverse", prices)).toBe(2.75);
  });

  it("answers for first edition from either of the payload's two keys", () => {
    expect(variantPrice("firstEdition", prices)).toBe(900);
  });

  it("lets a PATTERN foil borrow its base type — the same print run, pressed differently", () => {
    expect(variantPrice("reverse:pokeball", prices)).toBe(2.75);
  });

  it("refuses to price a STAMP at the base card's number", () => {
    // A staff promo shares its collector number with the card underneath and
    // nothing else. A staff-stamped Umbreon VMAX priced itself at $2.4k this
    // way, and it looked exactly like a real number.
    expect(variantPrice("reverse:staff", prices)).toBeUndefined();
  });

  it("has no answer where the payload has none, and never returns zero as one", () => {
    expect(variantPrice("normal", undefined)).toBeUndefined();
    expect(variantPrice("shadowless", prices)).toBeUndefined();
    expect(variantPrice("normal", { normal: 0 })).toBeUndefined();
  });
});

describe("pricingCoverage", () => {
  it("never leaves a column of prices without its denominator", () => {
    expect(pricingCoverage(6, 4).line).toBe("4 of 6 priced");
    expect(pricingCoverage(6, 6).line).toBe("All 6 priced");
  });

  it("separates a worthless card from one nobody has ever priced", () => {
    // Both are a column of grey; only this line tells them apart.
    const none = pricingCoverage(6, 0);
    expect(none.warn).toBe(true);
    expect(none.line).toContain("No prices");
  });

  it("does not say “1 printings”", () => {
    expect(pricingCoverage(1, 1).line).toBe("Priced");
    expect(pricingCoverage(1, 0).line).toBe("No price for this printing");
  });
});

describe("collectorLine", () => {
  it("uses the denominator printed on the card, not the set's real size", () => {
    // Obsidian Flames has 230 cards numbered out of 197. "223/230" appears
    // nowhere in the world.
    expect(collectorLine("223", 197)).toBe("223/197");
  });

  it("says the number alone rather than waiting for the set list", () => {
    expect(collectorLine("223")).toBe("223");
  });
});

describe("factRows", () => {
  const card: CardFacts = {
    id: "sv3-223",
    name: "Charizard ex",
    setName: "Obsidian Flames",
    setCode: "OBF",
    collectorNumber: "223",
    rarity: "Special Illustration Rare",
    artist: "PLANETA Mochizuki",
    releaseDate: "2023/08/11",
    subtypes: ["Stage 2", "ex"],
  };
  const set: PokemonSet = { id: "sv3", name: "Obsidian Flames", code: "OBF", printedTotal: 197, total: 230 };

  it("leads with what tells two cards of one name apart", () => {
    const rows = factRows(card, set);
    expect(rows.slice(0, 2)).toEqual([
      { term: "Set", value: "Obsidian Flames" },
      { term: "Number", value: "223/197" },
    ]);
  });

  it("omits what it does not know rather than showing an empty value", () => {
    // A `<dt>` with nothing under it reads as data that failed to load.
    const rows = factRows({ id: "x-1", name: "X", setName: "S", setCode: "", collectorNumber: "1" });
    expect(rows.map((r) => r.term)).toEqual(["Set", "Number"]);
  });

  it("still describes a card when only the summary has arrived", () => {
    const { artist: _artist, releaseDate: _releaseDate, subtypes: _subtypes, ...summary } = card;
    expect(factRows(summary, set).map((r) => r.term)).toEqual(["Set", "Number", "Rarity", "Set code"]);
  });
});
