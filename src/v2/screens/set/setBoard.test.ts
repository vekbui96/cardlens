import { describe, expect, it } from "vitest";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import type { Finish } from "../../../models/finishes.ts";
import {
  board,
  buildPockets,
  filterSummary,
  isFiltered,
  pocketState,
  pricingCoverage,
  printingName,
  visiblePockets,
  type Filters,
  type PocketSource,
} from "./setBoard.ts";

/**
 * The decisions, not the markup.
 *
 * Every case here is one where the screen has a plausible wrong answer that
 * looks fine on a modern set and lies on an old one, a filtered one, or one the
 * pricing providers have never heard of.
 */

function card(collectorNumber: string, over: Partial<PokemonCardSummary> = {}): PokemonCardSummary {
  return {
    id: `set1-${collectorNumber}`,
    name: `Card ${collectorNumber}`,
    setName: "A Set",
    setCode: "set1",
    collectorNumber,
    ...over,
  };
}

interface SourceOptions {
  finishes?: Record<string, Finish[]>;
  held?: Record<string, Finish[]>;
  excluded?: Record<string, Finish[]>;
  prices?: Record<string, number>;
}

function source(options: SourceOptions = {}): PocketSource {
  return {
    finishesFor: (number) => options.finishes?.[number] ?? ["normal"],
    heldFor: (cardId) => options.held?.[cardId] ?? [],
    excludedFor: (cardId) => options.excluded?.[cardId] ?? [],
    priceFor: (number, finish) => options.prices?.[`${number}|${finish}`],
  };
}

const NO_FILTER: Filters = { rarities: null, missingOnly: false };

describe("buildPockets", () => {
  it("gives a card with three printings three independent targets", () => {
    const pockets = buildPockets([card("4")], source({ finishes: { "4": ["normal", "reverse", "holo"] } }));

    expect(pockets.map((p) => p.finish)).toEqual(["normal", "reverse", "holo"]);
    // Distinct keys, or React reuses one pocket's state for another printing.
    expect(new Set(pockets.map((p) => p.key)).size).toBe(3);
  });

  it("marks only the printing that is held, not the card", () => {
    const pockets = buildPockets(
      [card("4")],
      source({ finishes: { "4": ["normal", "reverse"] }, held: { "set1-4": ["reverse"] } }),
    );

    expect(pockets.map((p) => p.held)).toEqual([false, true]);
  });

  it("keeps a card whose set reports no printings at all", () => {
    // Pitch Black returns no variant data for any of its 120 cards. A card that
    // produced zero pockets would vanish from its own set.
    const pockets = buildPockets([card("77")], source({ finishes: { "77": [] } }));

    expect(pockets).toHaveLength(1);
    expect(pockets[0].finish).toBe("normal");
  });

  it("keeps a held printing the set has never heard of, and marks it an extra", () => {
    // Sets invent foils faster than the catalog indexes them. Dropping this
    // pocket would hide a row the collection is already carrying, and a printing
    // you cannot see is one you cannot unmark.
    const pockets = buildPockets(
      [card("4")],
      source({ finishes: { "4": ["normal"] }, held: { "set1-4": ["reverse:quickball"] } }),
    );

    expect(pockets.map((p) => p.finish)).toEqual(["normal", "reverse:quickball"]);
    expect(pockets[1].extra).toBe(true);
    expect(pockets[1].held).toBe(true);
  });

  it("counts an excluded printing as complete without counting it as owned", () => {
    // A page is finished when nothing on it is still wanted, and a promo you
    // have opted out of is not wanted. It is still not a card you own.
    const pockets = buildPockets(
      [card("4")],
      source({ finishes: { "4": ["normal"] }, excluded: { "set1-4": ["normal"] } }),
    );

    expect(pockets[0]).toMatchObject({ complete: true, held: false, excluded: true });
  });

  it("leaves an unpriced printing undefined rather than zero", () => {
    // `Money` turns undefined into "Unavailable" and refuses to render $0.00.
    // A free card and an unpriced card are not the same card.
    const pockets = buildPockets(
      [card("4")],
      source({ finishes: { "4": ["normal", "reverse"] }, prices: { "4|normal": 12.5 } }),
    );

    expect(pockets[0].price).toBe(12.5);
    expect(pockets[1].price).toBeUndefined();
  });
});

describe("visiblePockets", () => {
  it("hides what is held when only the missing are wanted", () => {
    const pockets = buildPockets([card("1"), card("2")], source({ held: { "set1-1": ["normal"] } }));

    const missing = visiblePockets(pockets, { rarities: null, missingOnly: true });
    expect(missing.map((p) => p.collectorNumber)).toEqual(["2"]);
  });

  it("hides excluded printings from the missing list", () => {
    // An excluded printing is not missing — it is one you decided is not part of
    // this set. Listing it as still to find is a task that never completes.
    const pockets = buildPockets([card("1")], source({ excluded: { "set1-1": ["normal"] } }));

    expect(visiblePockets(pockets, { rarities: null, missingOnly: true })).toEqual([]);
  });

  it("changes nothing when no filter is on", () => {
    const pockets = buildPockets([card("1"), card("2")], source());
    expect(visiblePockets(pockets, NO_FILTER)).toHaveLength(2);
  });
});

describe("board", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => card(String(i + 1)));

  it("draws nine-pocket pages over an unbroken run", () => {
    const result = board(buildPockets(twelve, source()), NO_FILTER);

    expect(result.kind).toBe("pages");
    if (result.kind !== "pages") throw new Error("expected pages");
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toMatchObject({ index: 1, from: "1", to: "9" });
    expect(result.pages[1]).toMatchObject({ index: 2, from: "10", to: "12" });
  });

  it("falls back to a flat grid the moment a filter is on", () => {
    // A "Page 3" drawn over a discontinuous run names a physical sheet that does
    // not exist, and its completion marker counts pockets that were never on it.
    const rarity = board(buildPockets(twelve, source()), { rarities: ["Ultra Rare"], missingOnly: false });
    const missing = board(buildPockets(twelve, source()), { rarities: null, missingOnly: true });

    expect(rarity.kind).toBe("grid");
    expect(missing.kind).toBe("grid");
  });

  it("restores the pages when the filter is cleared", () => {
    expect(board(buildPockets(twelve, source()), NO_FILTER).kind).toBe("pages");
  });

  it("marks a short last page full when everything on it is complete", () => {
    const held = Object.fromEntries(twelve.slice(9).map((c) => [c.id, ["normal"] as Finish[]]));
    const result = board(buildPockets(twelve, source({ held })), NO_FILTER);

    if (result.kind !== "pages") throw new Error("expected pages");
    expect(result.pages[1].full).toBe(true);
    expect(result.pages[0].full).toBe(false);
  });
});

describe("isFiltered", () => {
  it("is false only when nothing narrows the view", () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ rarities: [], missingOnly: false })).toBe(true);
    expect(isFiltered({ rarities: null, missingOnly: true })).toBe(true);
  });
});

describe("filterSummary", () => {
  it("says nothing at all when the view is the whole set", () => {
    // The pages carry their own ranges and counts; a total above them would be a
    // number with no page to check it against.
    expect(filterSummary(NO_FILTER, null, 40)).toBeNull();
  });

  it("counts what survived the filter, and names the filter", () => {
    const summary = filterSummary(
      { rarities: ["Illustration Rare"], missingOnly: false },
      "Illustration Rare",
      12,
    );
    expect(summary).toMatchObject({ title: "12 printings · Illustration Rare", empty: false });
  });

  it("says printing, singular, when one survived", () => {
    const summary = filterSummary({ rarities: null, missingOnly: true }, null, 1);
    expect(summary?.title).toBe("1 printing · missing only");
  });

  it("reports a finished set as finished, not as an error", () => {
    // "Nothing missing" is the good news this screen exists to deliver. Reporting
    // it with the same words as "no such cards" would make finishing a set read
    // like a failed search.
    const summary = filterSummary({ rarities: null, missingOnly: true }, null, 0);
    expect(summary).toMatchObject({ title: "Nothing missing", empty: true });
    expect(summary?.hint).toContain("already marked");
  });

  it("separates a finished rarity from a rarity the set does not contain", () => {
    const finished = filterSummary({ rarities: ["Hyper Rare"], missingOnly: true }, "Hyper / Rainbow", 0);
    const absent = filterSummary({ rarities: ["Hyper Rare"], missingOnly: false }, "Hyper / Rainbow", 0);

    expect(finished?.title).toBe("Nothing missing in Hyper / Rainbow");
    expect(absent?.title).toBe("No Hyper / Rainbow cards in this set");
  });
});

describe("pricingCoverage", () => {
  it("never reports prices without saying how many there are", () => {
    expect(pricingCoverage(120, 48).line).toBe("48 of 120 printings priced");
  });

  it("says so, and warns, when the set could not be priced at all", () => {
    // Pitch Black returns `prices: {}` for all 120 cards. Pocket by pocket that
    // is indistinguishable from a set of worthless cards; this line is the only
    // thing that separates them.
    const none = pricingCoverage(120, 0);
    expect(none.line).toBe("No prices for any of the 120 printings in this set");
    expect(none.warn).toBe(true);
  });

  it("says all when all of them are priced", () => {
    expect(pricingCoverage(9, 9)).toEqual({ line: "All 9 printings priced", warn: false });
  });

  it("does not warn about an empty set", () => {
    // Nothing loaded yet is not a pricing failure, and warning about it would
    // paint every set red for the first second of its life.
    expect(pricingCoverage(0, 0)).toEqual({ line: "Nothing to price yet", warn: false });
  });

  it("stays readable for a set of one printing", () => {
    expect(pricingCoverage(1, 0).line).toBe("No price for the one printing in this set");
    expect(pricingCoverage(1, 1).line).toBe("The one printing here is priced");
  });
});

describe("printingName", () => {
  it("humanises a foil nobody has taught it about", () => {
    // Three 2025-26 sets introduced nine new foils between them. Anything
    // hardcoded is wrong by the next release, so an unknown key has to arrive as
    // words rather than as a raw string or a crash.
    // Sentence case, not title case: `humanize` in models/finishes.ts
    // capitalises the first letter only, so a hyphenated foil comes out
    // "Sparkle crown". Asserted as it is rather than as it ought to be —
    // reported upstream, not forked here.
    expect(printingName("reverse:sparkle-crown")).toBe("Sparkle crown Reverse");
    expect(printingName("holo:tinsel")).toBe("Holofoil — Tinsel");
    expect(printingName("wPromo")).toBe("Promo");
  });

  it("names the printings a collector actually says", () => {
    expect(printingName("normal")).toBe("Normal");
    expect(printingName("reverse")).toBe("Reverse Holo");
    expect(printingName("reverse:pokeball")).toBe("Poké Ball Reverse");
  });
});

describe("pocketState", () => {
  it("keeps excluded and not-owned as different words", () => {
    // "I still want this" and "this is not part of my set" are the whole point
    // of the state, and both look like an unmarked pocket.
    const [notOwned] = buildPockets([card("1")], source());
    const [owned] = buildPockets([card("1")], source({ held: { "set1-1": ["normal"] } }));
    const [skipped] = buildPockets([card("1")], source({ excluded: { "set1-1": ["normal"] } }));

    expect(pocketState(notOwned)).toBe("not owned");
    expect(pocketState(owned)).toBe("owned");
    expect(pocketState(skipped)).toBe("excluded");
  });
});
