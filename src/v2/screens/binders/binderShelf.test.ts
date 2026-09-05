import { describe, expect, it } from "vitest";
import {
  countBinder,
  emptyBinder,
  placeSlot,
  type Binder,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import type { BinderValueSummary } from "../../../models/binderValue.ts";
import {
  coverArt,
  fillOf,
  metaLine,
  newBinderId,
  pricedBinders,
  shelfSummary,
  valueState,
} from "./binderShelf.ts";

/**
 * The decisions, not the markup.
 *
 * Every case here has a plausible wrong answer that looks fine on the one
 * binder anybody demos and is wrong on the shelf that matters.
 */

const NOW = 1_700_000_000_000;

function card(n: number, art = true): CardSlot {
  return {
    kind: "card",
    cardId: `base1-${n}`,
    finish: "normal",
    name: `Card ${n}`,
    collectorNumber: String(n),
    ...(art ? { imageSmall: `https://images.example/base1/${n}.png` } : {}),
  };
}

function binderWith(format: "4" | "9" | "12", place: [number, number][]): Binder {
  let b = emptyBinder("b1", "Jolteon", format, NOW);
  const maxPage = place.reduce((m, [p]) => Math.max(m, p), 0);
  while (b.pages.length <= maxPage) b = { ...b, pages: [...b.pages, { slots: {} }] };
  for (const [page, index] of place) b = placeSlot(b, page, index, card(index), NOW);
  return b;
}

describe("coverArt", () => {
  it("shows the cover the owner chose, over any page", () => {
    // The whole point of setting a cover is that you see it before you open the
    // binder, so a deliberate choice outranks a page that merely happened first.
    const b = { ...binderWith("9", [[0, 0]]), cover: card(4) };
    const art = coverArt(b);
    expect(art.kind).toBe("chosen");
  });

  it("falls back to the page when the chosen cover has no art to draw", () => {
    // A blank card is less recognisable than the binder's own contents, and
    // recognition is the only thing this image is for.
    const b = { ...binderWith("9", [[0, 0]]), cover: card(4, false) };
    expect(coverArt(b).kind).toBe("page");
  });

  it("uses the first page holding anything, not literally page 1", () => {
    // A binder with 23 pages and a card on page 3 would otherwise be twelve
    // empty pockets - true, useless, and identical to every other such binder.
    const b = binderWith("9", [[2, 4]]);
    const art = coverArt(b);
    if (art.kind !== "page") throw new Error("expected a page");
    expect(art.slots[4]).toBeDefined();
    expect(art.slots.filter(Boolean)).toHaveLength(1);
  });

  it("keeps a genuinely empty binder looking empty", () => {
    // The one case where "nothing in it" is the fact worth showing.
    const art = coverArt(emptyBinder("b1", "New", "9", NOW));
    if (art.kind !== "page") throw new Error("expected a page");
    expect(art.slots).toHaveLength(9);
    expect(art.slots.every((s) => s === undefined)).toBe(true);
  });

  it("draws one pocket per pocket the format has", () => {
    for (const [format, pockets] of [
      ["4", 4],
      ["9", 9],
      ["12", 12],
    ] as const) {
      const art = coverArt(emptyBinder("b1", "New", format, NOW));
      if (art.kind !== "page") throw new Error("expected a page");
      expect(art.slots).toHaveLength(pockets);
    }
  });
});

describe("fillOf", () => {
  it("counts pockets, not copies", () => {
    // A trade binder with three copies behind one pocket has filled ONE pocket.
    const b = binderWith("9", [[0, 0]]);
    const traded: Binder = {
      ...b,
      pages: [{ slots: { 0: { ...card(0), quantity: 3 } } }],
    };
    const fill = fillOf(countBinder(traded));
    expect(fill.text).toBe("1 / 9");
  });

  it("is complete only when every pocket is filled", () => {
    const full = binderWith("4", [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
    expect(fillOf(countBinder(full)).complete).toBe(true);
    expect(fillOf(countBinder(binderWith("4", [[0, 0]]))).complete).toBe(false);
  });

  it("draws no bar at all for a binder with no pockets", () => {
    // NaN, not 0. `Meter` renders a non-finite ratio as an empty track - "there
    // is nothing to have" - where 0 would claim "you have none of it".
    const fill = fillOf({ filled: 0, pockets: 0, cards: 0, images: 0, copies: 0 });
    expect(Number.isNaN(fill.ratio)).toBe(true);
    expect(fill.complete).toBe(false);
  });
});

describe("metaLine", () => {
  it("says the format and the page count", () => {
    const b = binderWith("12", [[0, 0]]);
    expect(metaLine(b, countBinder(b))).toContain("12-pocket");
    expect(metaLine(b, countBinder(b))).toContain("1 page");
  });

  it("pluralises pages", () => {
    const b = binderWith("9", [[1, 0]]);
    expect(metaLine(b, countBinder(b))).toContain("2 pages");
  });

  it("adds the copy count only where copies actually diverge", () => {
    // On a binder that is not for trade, copies always equal cards, so printing
    // the figure would be noise on every tile.
    const base = binderWith("9", [[0, 0]]);
    const stacked: Binder = { ...base, pages: [{ slots: { 0: { ...card(0), quantity: 3 } } }] };

    expect(metaLine(stacked, countBinder(stacked))).not.toContain("cards");
    const forTrade = { ...stacked, forTrade: true };
    expect(metaLine(forTrade, countBinder(forTrade))).toContain("3 cards");

    // For trade, but nothing stacked: still nothing to say.
    const plainTrade = { ...base, forTrade: true };
    expect(metaLine(plainTrade, countBinder(plainTrade))).not.toContain("cards");
  });
});

describe("valueState", () => {
  function summary(over: Partial<BinderValueSummary> = {}): BinderValueSummary {
    return { total: 412.5, priced: 24, unpriced: 0, pricedCopies: 24, ...over };
  }

  it("says nothing yet rather than nothing at all, while the sets answer", () => {
    // A total that appears out of nothing looks like a number that CHANGED, and
    // $0.00 is the one thing it must never say when it does not know yet.
    const s = valueState(undefined, true);
    expect(s.loading).toBe(true);
    expect(s.total).toBeUndefined();
  });

  it("shows the running total once anything is priced", () => {
    // A lower bound that is climbing beats a spinner, as long as the unpriced
    // count rides with it.
    const s = valueState(summary({ priced: 4, unpriced: 20 }), true);
    expect(s.loading).toBe(false);
    expect(s.total).toBe(412.5);
    expect(s.note).toBe("20 unpriced");
  });

  it("reports a binder nothing could price as absent, not as zero", () => {
    // `Money` turns a zero total into "Unavailable"; the note says how many.
    const s = valueState(summary({ total: 0, priced: 0, unpriced: 24 }), false);
    expect(s.loading).toBe(false);
    expect(s.total).toBe(0);
    expect(s.note).toBe("24 unpriced");
  });

  it("says nothing about unpriced pockets when there are none", () => {
    expect(valueState(summary(), false).note).toBe("");
  });
});

describe("pricedBinders", () => {
  /**
   * The budget. Pricing one binder is a request per SET it spans - thirty for
   * the Riolu binder - and the shelf otherwise asks for nothing at all. A
   * regression here is silent: the screen still works, it just costs thirty
   * requests per binder nobody asked to have priced.
   */
  it("asks only about the binders that opted in", () => {
    const a: Binder = { ...emptyBinder("a", "A", "9", NOW), showValue: true };
    const b = emptyBinder("b", "B", "9", NOW);
    const c: Binder = { ...emptyBinder("c", "C", "9", NOW), showValue: false };
    expect(pricedBinders([a, b, c]).map((x) => x.id)).toEqual(["a"]);
  });

  it("asks about nothing at all when nobody opted in", () => {
    expect(pricedBinders([emptyBinder("b", "B", "9", NOW)])).toEqual([]);
  });
});

describe("shelfSummary", () => {
  it("counts cards, because the binder count stops meaning anything", () => {
    const one = binderWith("9", [
      [0, 0],
      [0, 1],
    ]);
    expect(shelfSummary([one])).toBe("1 binder · 2 cards");
  });

  it("counts copies, so a trade binder's stacks are included", () => {
    const b: Binder = {
      ...emptyBinder("b", "B", "9", NOW),
      forTrade: true,
      pages: [{ slots: { 0: { ...card(0), quantity: 3 } } }],
    };
    expect(shelfSummary([b])).toBe("1 binder · 3 cards");
  });

  it("pluralises both halves", () => {
    const single: Binder = { ...emptyBinder("b", "B", "9", NOW), pages: [{ slots: { 0: card(0) } }] };
    expect(shelfSummary([single])).toBe("1 binder · 1 card");
    expect(shelfSummary([single, single])).toBe("2 binders · 2 cards");
  });
});

describe("newBinderId", () => {
  /**
   * Ids must be unique across DEVICES, because the id is what binders converge
   * on during sync: two phones that both minted "b1" would merge into one binder
   * and the older arrangement would vanish, silently and permanently.
   */
  it("does not collide for two binders made in the same millisecond", () => {
    let seed = 0;
    const random = () => {
      seed += 0.37;
      return seed % 1;
    };
    expect(newBinderId(NOW, random)).not.toBe(newBinderId(NOW, random));
  });

  it("is a plain identifier, safe in a URL", () => {
    expect(newBinderId(NOW, () => 0.123456789)).toMatch(/^b[0-9a-z]+$/);
  });
});
