import { describe, expect, it } from "vitest";
import type { SealedPrice } from "../../../models/sealed.ts";
import {
  heldSetIds,
  kindCells,
  priceAge,
  pricedOf,
  productTally,
  READING_TTL_MS,
  rowNote,
  sealedStanding,
  silentNote,
  tallyLine,
  unmatchedNote,
} from "./sealedRows.ts";

/**
 * The decisions, not the markup.
 *
 * The wrong answers here all look identical on a healthy day: a screen that
 * says "loading" forever, a blank cell that could mean either of two things,
 * and a price from last Tuesday presented as today's.
 */

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60_000;

function priced(over: Partial<SealedPrice> & Pick<SealedPrice, "kind">): SealedPrice {
  return { productName: `${over.kind} product`, ...over };
}

describe("heldSetIds", () => {
  it("is one entry per set, sorted, however many cards came from it", () => {
    const ids = heldSetIds([
      { id: "sv3-223", setId: "sv3" },
      { id: "sv3-125", setId: "sv3" },
      { id: "base1-4", setId: "base1" },
    ]);
    expect(ids).toEqual(["base1", "sv3"]);
  });

  it("falls back to the card id exactly as the hook does", () => {
    // The two must agree: this list is what names the sets the hook could not
    // ask about, and a different derivation would name the wrong ones.
    expect(heldSetIds([{ id: "swsh12pt5-160" }])).toEqual(["swsh12pt5"]);
  });
});

describe("sealedStanding", () => {
  const base = { setNames: {}, setsLoaded: true, answered: [] as string[] };

  it("says there is nothing to price rather than showing an empty list", () => {
    const standing = sealedStanding({ ...base, held: [] });
    expect(standing.line).toBe("No sets collected yet");
    expect(standing.empty).toBe(true);
    expect(standing.waiting).toBe(false);
  });

  it("stops counting a set the catalog cannot name as something still coming", () => {
    /*
     * THE trap on this screen. `useSealed` counts a DISABLED query as pending,
     * and a set's query is disabled while its name is unknown — so a held set
     * the catalog has never heard of would leave the screen saying "loading 5
     * more…" for as long as it is open, waiting on a request nobody will make.
     */
    const standing = sealedStanding({ ...base, held: ["base2", "ecard3"], setNames: {} });
    expect(standing.silent).toBe(0);
    expect(standing.waiting).toBe(false);
    expect(standing.unmatched).toEqual(["base2", "ecard3"]);
    expect(standing.warn).toBe(true);
    expect(standing.line).not.toMatch(/loading|waiting/i);
  });

  it("still counts an unnamed set as outstanding before the set list has arrived", () => {
    // Until the catalog answers, a set with no name is one we have not been told
    // about yet — not one that can never be priced.
    const standing = sealedStanding({ ...base, held: ["base2"], setsLoaded: false });
    expect(standing.silent).toBe(1);
    expect(standing.unmatched).toEqual([]);
    expect(standing.waiting).toBe(true);
    expect(standing.line).toBe("Waiting on 1 set…");
  });

  it("counts what has not come back itself, rather than trusting the hook", () => {
    /*
     * `useSealed`'s memo is keyed on `dataUpdatedAt`, which a FAILED query never
     * moves off zero — so its `pending` and `missing` freeze at whatever they
     * were when the last success landed, and a failed set reads as "loading"
     * forever. `held − answered − unmatched` cannot be fooled that way.
     */
    const standing = sealedStanding({
      ...base,
      held: ["a", "b", "c"],
      setNames: { a: "A", b: "B", c: "C" },
      answered: ["a", "b"],
    });
    expect(standing.silent).toBe(1);
    expect(standing.line).toBe("2 of 3 sets priced");
    expect(standing.empty).toBe(false);
  });

  it("only claims 'all priced' when every held set really answered", () => {
    const all = sealedStanding({
      ...base,
      held: ["a", "b"],
      setNames: { a: "A", b: "B" },
      answered: ["a", "b"],
    });
    expect(all.line).toBe("All 2 sets priced");

    // One set the catalog cannot name is still a set this screen has no price
    // for, so the headline may not round up to "all".
    const partial = sealedStanding({
      ...base,
      held: ["a", "b"],
      setNames: { a: "A" },
      answered: ["a"],
    });
    expect(partial.line).toBe("1 of 2 sets priced");
  });

  it("warns only when nothing arrived and nothing can", () => {
    const hopeless = sealedStanding({ ...base, held: ["a", "b"], setNames: {} });
    expect(hopeless.warn).toBe(true);
    expect(hopeless.line).toContain("2 sets");

    // Something is still outstanding, so this is not yet a failure to report.
    const waiting = sealedStanding({ ...base, held: ["a"], setNames: { a: "A" } });
    expect(waiting.warn).toBe(false);
    expect(waiting.waiting).toBe(true);
  });

  it("pluralises, so one set is never '1 sets'", () => {
    expect(sealedStanding({ ...base, held: ["a"], setNames: { a: "A" } }).line).not.toContain("1 sets");
    expect(sealedStanding({ ...base, held: ["a"], setNames: {} }).line).not.toContain("1 sets");
  });
});

describe("kindCells", () => {
  it("keeps 'not sold' and 'no price' apart", () => {
    /*
     * A set that never sold a booster box and a booster box the feed has no
     * price for are different facts, and one shared dash would merge them —
     * turning a normal absence into a look-alike failure.
     */
    const cells = kindCells([priced({ kind: "pack", price: 4.5 }), priced({ kind: "etb" })]);
    const byKind = new Map(cells.map((c) => [c.key, c]));
    expect(byKind.get("pack")?.state).toBe("priced");
    expect(byKind.get("etb")?.state).toBe("unpriced");
    expect(byKind.get("box")?.state).toBe("not-sold");
  });

  it("always lists every tracked kind, in the model's order", () => {
    const cells = kindCells([]);
    expect(cells.map((c) => c.key)).toEqual(["pack", "etb", "box", "bundle"]);
  });

  it("never hands a price to a cell that has not got one", () => {
    // `Money` renders `undefined` as words and 0 as words too, but a cell that
    // carried a stray 0 would have shown "$0.00" before it ever reached Money.
    for (const cell of kindCells([priced({ kind: "pack" })])) {
      if (cell.state !== "priced") expect(cell.price).toBeUndefined();
    }
  });
});

describe("pricedOf and rowNote", () => {
  it("counts against what the set actually sells, not against four", () => {
    // A set with only packs and an ETB is not "2 of 4 priced" — it has no
    // booster box to be missing a price for.
    const cells = kindCells([priced({ kind: "pack", price: 4.5 }), priced({ kind: "etb", price: 49 })]);
    expect(pricedOf(cells)).toEqual({ offered: 2, priced: 2 });
    expect(rowNote(cells)).toBe("");
  });

  it("names what has no price, rather than counting it", () => {
    const cells = kindCells([priced({ kind: "pack", price: 4.5 }), priced({ kind: "box" })]);
    expect(rowNote(cells)).toContain("Booster Box");
    expect(rowNote(cells)).toContain("rather than shown as zero");
  });
});

describe("priceAge", () => {
  it("says how old a fresh reading is without calling it stale", () => {
    const age = priceAge(new Date(NOW - 2 * HOUR).toISOString(), NOW);
    expect(age.stale).toBe(false);
    expect(age.label).toBe("2 hr ago");
  });

  it("calls out a reading that outlived the window the server refreshes on", () => {
    /*
     * The server keeps serving a cached reading when the daily refresh fails
     * ("yesterday's price beats no price"). That is right for the data and a lie
     * if the screen does not say so, because this is the one figure in the app
     * expected to move day to day.
     */
    const age = priceAge(new Date(NOW - READING_TTL_MS - HOUR).toISOString(), NOW);
    expect(age.stale).toBe(true);
    expect(age.label).toBe("21 hr ago");
  });

  it("treats a missing or unreadable stamp as the worst case, not the best", () => {
    expect(priceAge("", NOW).stale).toBe(true);
    expect(priceAge("not a date", NOW).stale).toBe(true);
    expect(priceAge("", NOW).label).toContain("unknown");
  });
});

describe("productTally", () => {
  it("leaves products a set does not sell out of the denominator", () => {
    const tally = productTally([
      { prices: [priced({ kind: "pack", price: 4.5 }), priced({ kind: "etb", price: 49 })] },
      { prices: [priced({ kind: "pack", price: 5 }), priced({ kind: "box" })] },
    ]);
    expect(tally).toEqual({ offered: 4, priced: 3 });
    expect(tallyLine(tally)).toBe("3 of 4 products priced");
  });

  it("says so plainly when everything has a price", () => {
    const tally = productTally([{ prices: [priced({ kind: "pack", price: 4.5 })] }]);
    expect(tallyLine(tally)).toBe("All 1 product priced");
  });

  it("says nothing at all when there is nothing to qualify", () => {
    expect(tallyLine({ offered: 0, priced: 0 })).toBe("");
  });
});

describe("silentNote", () => {
  it("names all three possibilities rather than picking the comfortable one", () => {
    /*
     * A set still in flight, a set with no sealed product, and a set whose
     * lookup failed all reach this screen identically. Claiming the reassuring
     * one would hide a price service that is down behind "promos are not sold
     * in packs".
     */
    const note = silentNote(3);
    expect(note).toContain("still being fetched");
    expect(note).toContain("not sold sealed");
    expect(note).toContain("lookup failed");
    expect(note).toContain("ask again");
  });

  it("says nothing when every set came back", () => {
    expect(silentNote(0)).toBe("");
  });

  it("reads correctly for one set", () => {
    expect(silentNote(1)).toContain("1 set has not come back");
    expect(silentNote(1)).toContain("it is");
    expect(silentNote(2)).toContain("2 sets have not come back");
    expect(silentNote(2)).toContain("they are");
  });
});

describe("unmatchedNote", () => {
  it("names the sets nothing was asked about", () => {
    // Named, never silently folded into a count — the reader can go and look at
    // the set to see whether the catalog knows it by another name.
    expect(unmatchedNote(["base2", "ecard3"])).toContain("base2, ecard3");
  });

  it("says nothing when every set was matched", () => {
    expect(unmatchedNote([])).toBe("");
  });
});
