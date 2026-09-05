import { describe, expect, it } from "vitest";
import { emptyBinder, placeSlot, specFor, type Binder, type CardSlot } from "../../../models/binderLayout.ts";
import {
  chosenCover,
  coverPageIndex,
  coverPockets,
  metaLine,
  newBinderId,
  pageAspect,
  shelfSummary,
  tileLabel,
  valuePending,
} from "./shelf.ts";

/**
 * The decisions the shelf makes, tested without React.
 *
 * Every one of these was previously reachable only through a render, which is
 * why "a full binder reads as empty" shipped twice: the bug is in an answer,
 * not in a div.
 */

const NOW = 1_700_000_000_000;
/** Nothing is owned, unless a test says otherwise. Shading only. */
const ownsNothing = () => false;
const ownsEverything = () => true;

function card(cardId: string, imageSmall?: string): CardSlot {
  return { kind: "card", cardId, finish: "normal", name: "Jolteon", ...(imageSmall ? { imageSmall } : {}) };
}

function binderWith(format: "4" | "9" | "12", fill: (b: Binder) => Binder): Binder {
  return fill(emptyBinder("b1", "Jolteon", format, NOW));
}

describe("which page stands for the binder", () => {
  it("takes the first page that holds anything, not literally page one", () => {
    // A binder with 23 pages and a card on page 3 would otherwise show twelve
    // empty pockets — true, and useless, because every such binder looks the
    // same.
    const binder = binderWith("9", (b) => placeSlot(b, 2, 4, card("sv1-1", "art.png"), NOW));
    expect(coverPageIndex(binder)).toBe(2);
  });

  it("falls back to page one for a genuinely empty binder", () => {
    // The one case where "nothing in it" is the fact worth showing.
    expect(coverPageIndex(emptyBinder("b1", "New", "9", NOW))).toBe(0);
  });
});

describe("the cover it was given", () => {
  it("wins over a page from inside it", () => {
    // Setting a cover is a deliberate statement about what a binder IS. The
    // shelf is where it pays off — seeing it before you open the binder is the
    // entire point.
    const binder: Binder = {
      ...binderWith("9", (b) => placeSlot(b, 0, 0, card("sv1-1", "inside.png"), NOW)),
      cover: card("sv1-9", "front.png"),
    };
    expect(chosenCover(binder, ownsNothing)?.src).toBe("front.png");
  });

  it("falls through to the page when the cover carries no art", () => {
    // An unresolvable cover must not leave the tile blank: the shelf's whole
    // job is to show something.
    const binder: Binder = {
      ...binderWith("9", (b) => placeSlot(b, 0, 0, card("sv1-1", "inside.png"), NOW)),
      cover: card("sv1-9"),
    };
    expect(chosenCover(binder, ownsNothing)).toBeNull();
  });

  it("reports whether the collection holds it, for the shading", () => {
    const binder: Binder = { ...emptyBinder("b1", "X", "9", NOW), cover: card("sv1-9", "front.png") };
    expect(chosenCover(binder, ownsNothing)?.owned).toBe(false);
    expect(chosenCover(binder, ownsEverything)?.owned).toBe(true);
  });
});

describe("the page mosaic", () => {
  it("is always a whole page of pockets, gaps and all", () => {
    const binder = binderWith("12", (b) => placeSlot(b, 0, 6, card("sv1-1", "art.png"), NOW));
    const pockets = coverPockets(binder, ownsNothing);
    expect(pockets).toHaveLength(specFor("12").pockets);
    expect(pockets.filter((p) => p.kind === "empty")).toHaveLength(11);
  });

  it("draws a filled pocket with no art as a CARD, never as an empty pocket", () => {
    /*
     * The rule this whole file exists for. Binders filled before `imageSmall`
     * was denormalised have slots carrying no art at all, and rendering those
     * as gaps reports a full binder as an empty one — which is a worse lie than
     * a slow one, because it is silent.
     */
    const binder = binderWith("9", (b) => {
      let next = b;
      for (let i = 0; i < 9; i++) next = placeSlot(next, 0, i, card(`sv1-${i}`), NOW);
      return next;
    });
    const pockets = coverPockets(binder, ownsNothing);
    expect(pockets.every((p) => p.kind === "card")).toBe(true);
    expect(pockets.every((p) => p.kind === "card" && p.src === undefined)).toBe(true);
  });
});

describe("a page's shape", () => {
  it("is wider for more pockets across, at one height", () => {
    /*
     * Covers are ONE height, so width is the only thing left to say a 12-pocket
     * page is four cards across and a 9-pocket page three. Sizing the pocket
     * instead made a 4-pocket cover taller than a 12-pocket one, which is
     * backwards on a shelf.
     */
    const widthAt = (format: "4" | "9" | "12", height: number) => {
      const [w, h] = pageAspect(specFor(format))
        .split("/")
        .map((n) => Number(n.trim()));
      return (height * w) / h;
    };
    expect(widthAt("12", 168)).toBeGreaterThan(widthAt("9", 168));
    expect(widthAt("9", 168)).toBeCloseTo(widthAt("4", 168), 5);
  });
});

describe("the words the tile carries", () => {
  it("names the binder, its format and how full it is", () => {
    // The art beside it is decorative in full, so this is the ONLY thing a
    // screen reader gets — a name alone would make nine binders nine identical
    // stops.
    const binder = binderWith("12", (b) => placeSlot(b, 0, 0, card("sv1-1", "a.png"), NOW));
    expect(tileLabel(binder)).toBe("Jolteon, 12-pocket, 1 of 12 pockets filled");
  });

  it("says complete in words, not only in gold", () => {
    const binder = binderWith("4", (b) => {
      let next = b;
      for (let i = 0; i < 4; i++) next = placeSlot(next, 0, i, card(`sv1-${i}`, "a.png"), NOW);
      return next;
    });
    expect(tileLabel(binder)).toContain("complete");
  });

  it("says a trade binder is for trade", () => {
    const binder: Binder = { ...emptyBinder("b1", "Trade", "9", NOW), forTrade: true };
    expect(tileLabel(binder)).toContain("for trade");
  });
});

describe("what shape the binder is", () => {
  it("gives format and pages, and nothing else for an ordinary binder", () => {
    const binder = binderWith("9", (b) => placeSlot(b, 1, 0, card("sv1-1", "a.png"), NOW));
    expect(metaLine(binder)).toBe("9-pocket · 2 pages");
  });

  it("adds the copies only where they diverge from the pockets", () => {
    // Everywhere else the two are the same number and printing it twice says
    // nothing.
    const base = binderWith("4", (b) => placeSlot(b, 0, 0, { ...card("sv1-1", "a.png"), quantity: 3 }, NOW));
    expect(metaLine(base)).toBe("4-pocket · 1 page");
    expect(metaLine({ ...base, forTrade: true })).toBe("4-pocket · 1 page · 3 cards");
  });
});

describe("what the shelf holds", () => {
  it("counts cards, because that is the figure that grows", () => {
    const a = binderWith("9", (b) => placeSlot(b, 0, 0, card("sv1-1", "a.png"), NOW));
    const b = { ...a, id: "b2" };
    expect(shelfSummary([a, b])).toBe("2 binders · 2 cards");
  });

  it("says one binder, not 1 binders", () => {
    expect(shelfSummary([emptyBinder("b1", "X", "9", NOW)])).toBe("1 binder · 0 cards");
  });
});

describe("when a total is still in flight", () => {
  it("is pending before any summary exists", () => {
    expect(valuePending(undefined, true)).toBe(true);
    expect(valuePending(undefined, false)).toBe(true);
  });

  it("is pending while loading and nothing has been priced", () => {
    expect(valuePending({ total: 0, priced: 0, unpriced: 4, pricedCopies: 0 }, true)).toBe(true);
  });

  it("stops being pending once anything is priced, even mid-flight", () => {
    // A binder spans many sets and they answer one at a time. Holding
    // "Pricing…" until the last one lands would hide an answer the tile
    // already has, and the unpriced count beside it says what is missing.
    expect(valuePending({ total: 12, priced: 1, unpriced: 3, pricedCopies: 1 }, true)).toBe(false);
  });

  it("is not pending when nothing is loading, however little was priced", () => {
    // The unpriceable case: settled, and the answer is "we cannot price this".
    expect(valuePending({ total: 0, priced: 0, unpriced: 4, pricedCopies: 0 }, false)).toBe(false);
  });
});

describe("a new binder's id", () => {
  it("is unique across devices, not just across this millisecond", () => {
    // Two phones that both minted "b1" would merge into one binder and the
    // older arrangement would vanish. The failure is silent and permanent.
    const ids = new Set(Array.from({ length: 200 }, () => newBinderId(NOW)));
    expect(ids.size).toBe(200);
  });
});
