import { describe, expect, it } from "vitest";
import {
  addPage,
  nextEmptyPocket,
  toSpreads,
  canRemoveLastPage,
  countBinder,
  emptyBinder,
  fillSequential,
  moveSlot,
  placeSlot,
  preferredFinish,
  reformat,
  removeLastPage,
  hasFacingPages,
  isBinderFormat,
  pageGroups,
  setCover,
  setForTrade,
  setShowValue,
  slotQuantity,
  specFor,
  withCondition,
  withQuantity,
  type CardSlot,
} from "./binderLayout.ts";
import { parseBinder } from "./binderParse.ts";

const NOW = 1_800_000_000_000;
const card = (n: string): CardSlot => ({ kind: "card", cardId: `me5-${n}`, finish: "normal" });
const base = () => emptyBinder("b1", "Vault X", "9", NOW);

describe("binder specs", () => {
  it("lays 9-pocket out as 3x3 and 12-pocket as 4x3", () => {
    expect(specFor("9")).toMatchObject({ cols: 3, rows: 3, pockets: 9 });
    expect(specFor("12")).toMatchObject({ cols: 4, rows: 3, pockets: 12 });
  });
});

describe("placeSlot", () => {
  it("puts a card in a pocket without touching its neighbours", () => {
    let b = placeSlot(base(), 0, 4, card("1"), NOW);
    b = placeSlot(b, 0, 0, card("2"), NOW);
    expect(b.pages[0].slots[4]).toMatchObject({ cardId: "me5-1" });
    expect(b.pages[0].slots[0]).toMatchObject({ cardId: "me5-2" });
    // Sparse: an untouched pocket stays empty rather than becoming a hole in
    // an array that later shifts.
    expect(b.pages[0].slots[1]).toBeUndefined();
  });

  it("grows pages on demand", () => {
    const b = placeSlot(base(), 2, 0, card("1"), NOW);
    expect(b.pages).toHaveLength(3);
    expect(b.pages[2].slots[0]).toMatchObject({ cardId: "me5-1" });
  });

  it("refuses a pocket the format does not have", () => {
    // 9-pocket has indexes 0..8; index 9 is not a real pocket.
    expect(placeSlot(base(), 0, 9, card("1"), NOW).pages[0].slots[9]).toBeUndefined();
  });

  it("clears a pocket when given null", () => {
    const b = placeSlot(placeSlot(base(), 0, 3, card("1"), NOW), 0, 3, null, NOW);
    expect(b.pages[0].slots[3]).toBeUndefined();
  });

  it("does not mutate the binder it was given", () => {
    const before = placeSlot(base(), 0, 0, card("1"), NOW);
    const after = placeSlot(before, 0, 1, card("2"), NOW);
    expect(before.pages[0].slots[1]).toBeUndefined();
    expect(after.pages[0].slots[1]).toBeDefined();
  });
});

const pocket = (page: number, index: number) => ({ kind: "pocket" as const, page, index });
const COVER = { kind: "cover" as const };

describe("moveSlot", () => {
  it("moves a card into an empty pocket", () => {
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = moveSlot(b, pocket(0, 0), pocket(1, 5), NOW);
    expect(b.pages[0].slots[0]).toBeUndefined();
    expect(b.pages[1].slots[5]).toMatchObject({ cardId: "me5-1" });
  });

  it("swaps rather than overwriting an occupied pocket", () => {
    // Overwriting would destroy a card with no undo; two cards changing places
    // is what the physical action means.
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = placeSlot(b, 0, 1, card("2"), NOW);
    b = moveSlot(b, pocket(0, 0), pocket(0, 1), NOW);
    expect(b.pages[0].slots[1]).toMatchObject({ cardId: "me5-1" });
    expect(b.pages[0].slots[0]).toMatchObject({ cardId: "me5-2" });
  });

  it("ignores a move from an empty pocket", () => {
    const b = base();
    expect(moveSlot(b, pocket(0, 0), pocket(0, 1), NOW)).toBe(b);
  });

  it("keeps the card when it is dropped back where it started", () => {
    // The commonest way a drag ends. Without the guard the two writes cancel
    // out — place it there, then clear there — and the card is destroyed by
    // being moved nowhere.
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = moveSlot(b, pocket(0, 0), pocket(0, 0), NOW);
    expect(b.pages[0].slots[0]).toMatchObject({ cardId: "me5-1" });
  });

  it("drags a card onto the cover, and off it again", () => {
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = moveSlot(b, pocket(0, 0), COVER, NOW);
    expect(b.cover).toMatchObject({ cardId: "me5-1" });
    expect(b.pages[0].slots[0]).toBeUndefined();

    b = moveSlot(b, COVER, pocket(0, 3), NOW);
    expect(b.cover).toBeUndefined();
    expect(b.pages[0].slots[3]).toMatchObject({ cardId: "me5-1" });
  });

  it("swaps with whatever the cover already held", () => {
    let b = setCover(placeSlot(base(), 0, 0, card("1"), NOW), card("2"), NOW);
    b = moveSlot(b, pocket(0, 0), COVER, NOW);
    expect(b.cover).toMatchObject({ cardId: "me5-1" });
    expect(b.pages[0].slots[0]).toMatchObject({ cardId: "me5-2" });
  });
});

describe("setCover", () => {
  it("is absent when cleared, not null, so a cleared cover is byte-identical to none", () => {
    const b = setCover(setCover(base(), card("1"), NOW), null, NOW);
    expect("cover" in b).toBe(false);
    expect(JSON.stringify(b)).toBe(JSON.stringify(base()));
  });

  it("returns the binder unchanged rather than manufacturing a sync edit", () => {
    const b = base();
    expect(setCover(b, null, NOW)).toBe(b);
  });

  it("is not a pocket: it does not count towards filled, and reformat leaves it", () => {
    const b = setCover(base(), card("1"), NOW);
    expect(countBinder(b).filled).toBe(0);
    expect(reformat(b, "12", NOW).cover).toMatchObject({ cardId: "me5-1" });
  });

  it("survives the sync validator, which is a whitelist", () => {
    // A field the client can write has to be NAMED in binderParse or it
    // silently vanishes the first time the binder round-trips through sync.
    const b = setCover(base(), card("1"), NOW);
    expect(parseBinder(JSON.parse(JSON.stringify(b)))?.cover).toMatchObject({ cardId: "me5-1" });
  });

  it("drops a cover that does not parse, without losing the binder", () => {
    const b = { ...setCover(base(), card("1"), NOW), cover: { kind: "card" } };
    const parsed = parseBinder(JSON.parse(JSON.stringify(b)));
    expect(parsed).not.toBeNull();
    expect(parsed?.cover).toBeUndefined();
  });
});

describe("reformat", () => {
  it("keeps reading order when moving 9-pocket to 12-pocket", () => {
    // Positions cannot survive - a 4-wide page has no pocket matching the 9th
    // of a 3-wide one - but the sequence is what a collector actually keeps.
    let b = base();
    for (let i = 0; i < 9; i++) b = placeSlot(b, 0, i, card(String(i)), NOW);
    b = placeSlot(b, 1, 0, card("9"), NOW);

    const wide = reformat(b, "12", NOW);
    expect(wide.format).toBe("12");
    expect(wide.pages).toHaveLength(1);
    expect(wide.pages[0].slots[0]).toMatchObject({ cardId: "me5-0" });
    expect(wide.pages[0].slots[9]).toMatchObject({ cardId: "me5-9" });
  });

  it("skips empty pockets when re-flowing", () => {
    let b = base();
    b = placeSlot(b, 0, 8, card("a"), NOW);
    const wide = reformat(b, "12", NOW);
    // The gap before it was empty pockets, not content, so it closes up.
    expect(wide.pages[0].slots[0]).toMatchObject({ cardId: "me5-a" });
  });

  it("is a no-op for the same format", () => {
    const b = base();
    expect(reformat(b, "9", NOW)).toBe(b);
  });
});

describe("counts", () => {
  it("counts cards and images against total pockets", () => {
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = placeSlot(b, 0, 1, { kind: "image", src: "data:image/png;base64,AAA" }, NOW);
    expect(countBinder(b)).toEqual({ filled: 2, pockets: 9, cards: 1, images: 1, copies: 1 });
  });

  it("counts copies separately from pockets", () => {
    // The two diverge the moment a trade binder stacks duplicates: three copies
    // behind one pocket is one card in the layout and three cards in the trade.
    let b = placeSlot(base(), 0, 0, withQuantity(card("1"), 3), NOW);
    b = placeSlot(b, 0, 1, card("2"), NOW);
    expect(countBinder(b)).toMatchObject({ cards: 2, copies: 4, filled: 2 });
  });
});
describe("preferredFinish", () => {
  it("prefers the reverse holo, which is how a set binder is usually sleeved", () => {
    expect(preferredFinish(["normal", "reverse"])).toBe("reverse");
  });

  it("falls back to holo for cards with no reverse — the ex tier", () => {
    expect(preferredFinish(["holo"])).toBe("holo");
    expect(preferredFinish(["normal", "holo"])).toBe("holo");
  });

  it("takes a patterned reverse over a plain holo", () => {
    // A Poké Ball reverse is still a reverse; it belongs in the reverse run.
    expect(preferredFinish(["holo", "reverse:pokeball"])).toBe("reverse:pokeball");
  });

  it("uses whatever exists when there is neither", () => {
    expect(preferredFinish(["normal"])).toBe("normal");
    expect(preferredFinish([])).toBeNull();
  });
});

describe("fillSequential", () => {
  it("lays cards in order across pages, from pocket zero", () => {
    const slots = Array.from({ length: 11 }, (_, i) => card(String(i)));
    const b = fillSequential(base(), slots, NOW);
    expect(b.pages).toHaveLength(2);
    expect(b.pages[0].slots[0]).toMatchObject({ cardId: "me5-0" });
    expect(b.pages[0].slots[8]).toMatchObject({ cardId: "me5-8" });
    expect(b.pages[1].slots[1]).toMatchObject({ cardId: "me5-10" });
  });

  it("replaces what was there rather than merging", () => {
    // "Fill from this set" is a statement about the whole binder; merging would
    // make the result depend on history the user cannot see.
    const before = placeSlot(base(), 0, 5, card("old"), NOW);
    const after = fillSequential(before, [card("new")], NOW);
    expect(after.pages[0].slots[5]).toBeUndefined();
    expect(after.pages[0].slots[0]).toMatchObject({ cardId: "me5-new" });
  });
});

describe("addPage / removeLastPage", () => {
  const b = () => emptyBinder("b1", "Masters", "9", 1);

  it("actually adds a page", () => {
    // The regression: the screen used to add a page by placing a null slot on
    // a new index, and trimPages removed it again on the same commit. The
    // button did nothing and said nothing.
    expect(addPage(b(), 2).pages).toHaveLength(2);
  });

  it("stamps updatedAt, so the new page syncs", () => {
    // Without this the binder converges on its old timestamp and the extra page
    // never reaches another device.
    expect(addPage(b(), 500).updatedAt).toBe(500);
    expect(removeLastPage(addPage(b(), 500), 900).updatedAt).toBe(900);
  });

  it("removes an empty last page but never the only one", () => {
    expect(removeLastPage(addPage(b(), 2), 3).pages).toHaveLength(1);
    expect(removeLastPage(b(), 3).pages).toHaveLength(1);
    expect(canRemoveLastPage(b())).toBe(false);
  });

  it("refuses to remove a page that holds a card", () => {
    // Removing it would destroy the card silently, and there is no undo.
    const filled = placeSlot(addPage(b(), 2), 1, 0, { kind: "card", cardId: "me5-1", finish: "normal" }, 3);
    expect(canRemoveLastPage(filled)).toBe(false);
    expect(removeLastPage(filled, 4).pages).toHaveLength(2);
  });
});

describe("nextEmptyPocket", () => {
  it("gives the pocket after the one just filled", () => {
    const b = placeSlot(base(), 0, 0, card("1"), NOW);
    expect(nextEmptyPocket(b, { page: 0, index: 0 })).toEqual({ kind: "pocket", page: 0, index: 1 });
  });

  it("skips pockets that are already occupied", () => {
    // Filling into a part-built page must not stop on a pocket that is taken —
    // placing there would silently replace a card the user put there earlier.
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = placeSlot(b, 0, 1, card("2"), NOW);
    b = placeSlot(b, 0, 2, card("3"), NOW);
    expect(nextEmptyPocket(b, { page: 0, index: 0 })).toEqual({ kind: "pocket", page: 0, index: 3 });
  });

  it("carries on to the next page when a page fills up", () => {
    let b = addPage(base(), NOW);
    for (let i = 0; i < 9; i++) b = placeSlot(b, 0, i, card(String(i)), NOW);
    expect(nextEmptyPocket(b, { page: 0, index: 8 })).toEqual({ kind: "pocket", page: 1, index: 0 });
  });

  it("returns null when the binder is full from here on", () => {
    // Not a wrap to the start: a pocket before the current one was skipped on
    // purpose as often as by accident, and quietly jumping backwards would
    // place the next card where the user is not looking.
    let b = base();
    for (let i = 0; i < 9; i++) b = placeSlot(b, 0, i, card(String(i)), NOW);
    expect(nextEmptyPocket(b, { page: 0, index: 0 })).toBeNull();
  });
});

describe("toSpreads", () => {
  it("stands page 1 on its own, then pairs 2|3 and 4|5", () => {
    // Opening the cover shows one page; everything after it faces a neighbour.
    expect(toSpreads(5)).toEqual([[0], [1, 2], [3, 4]]);
  });

  it("leaves the last page alone on the left when the count is even", () => {
    // A binder that ends on an even page ends mid-spread — the right half is
    // the next page you have not added yet.
    expect(toSpreads(4)).toEqual([[0], [1, 2], [3]]);
  });

  it("handles one page, and no pages at all", () => {
    expect(toSpreads(1)).toEqual([[0]]);
    expect(toSpreads(0)).toEqual([]);
  });

  it("never pairs a page with itself or repeats one", () => {
    // The pairing is off-by-one in three places; a page shown twice, or one
    // missing entirely, is the failure that looks almost right.
    for (const count of [1, 2, 3, 6, 7, 21]) {
      const flat = toSpreads(count).flat();
      expect(flat).toEqual([...Array(count).keys()]);
    }
  });
});

describe("trade quantities", () => {
  it("treats an absent quantity as one copy", () => {
    // Every binder that existed before trading did carries no quantity at all,
    // and must not start valuing at zero.
    expect(slotQuantity(card("1"))).toBe(1);
  });

  it("stores one copy as no quantity at all", () => {
    // Two ways to say the same thing is how last-write-wins starts producing
    // conflicts between devices that agree.
    const counted = withQuantity(card("1"), 4);
    expect(counted.quantity).toBe(4);
    expect(withQuantity(counted, 1)).toEqual(card("1"));
    expect("quantity" in withQuantity(counted, 1)).toBe(false);
  });

  it("clamps a nonsensical count rather than dropping the card", () => {
    // These can only arrive from a hand-edited file or a future client. The
    // card and its position are the valuable part; the count is not worth
    // emptying a pocket over.
    expect(slotQuantity({ ...card("1"), quantity: 0 })).toBe(1);
    expect(slotQuantity({ ...card("1"), quantity: -5 })).toBe(1);
    expect(slotQuantity({ ...card("1"), quantity: 2.7 })).toBe(2);
    expect(slotQuantity({ ...card("1"), quantity: Number.NaN })).toBe(1);
    expect(slotQuantity({ ...card("1"), quantity: 1e9 })).toBe(999);
  });

  it("images always count as one copy", () => {
    expect(slotQuantity({ kind: "image", src: "data:image/png;base64,AAA" })).toBe(1);
  });
});

describe("trade condition", () => {
  it("grades and ungrades a pocket", () => {
    const graded = withCondition(card("1"), "LP");
    expect(graded.condition).toBe("LP");
    expect(withCondition(graded, null)).toEqual(card("1"));
    expect("condition" in withCondition(graded, null)).toBe(false);
  });
});

describe("forTrade", () => {
  it("stamps the binder only when the flag actually changes", () => {
    // Saving a binder pushes it through sync; toggling to the value it already
    // has must not manufacture an edit for every device to pull.
    const b = emptyBinder("b1", "Trades", "9", NOW);
    expect(setForTrade(b, false, NOW + 1)).toBe(b);

    const on = setForTrade(b, true, NOW + 1);
    expect(on.forTrade).toBe(true);
    expect(on.updatedAt).toBe(NOW + 1);
    expect(setForTrade(on, true, NOW + 2)).toBe(on);
  });

  it("leaves no flag behind when trading is turned off", () => {
    const on = setForTrade(emptyBinder("b1", "Trades", "9", NOW), true, NOW + 1);
    const off = setForTrade(on, false, NOW + 2);
    expect("forTrade" in off).toBe(false);
    expect(off.updatedAt).toBe(NOW + 2);
  });
});

describe("4-pocket", () => {
  it("is two by two", () => {
    expect(specFor("4")).toMatchObject({ cols: 2, rows: 2, pockets: 4, label: "4-pocket" });
  });

  it("is read one page at a time, never as facing pages", () => {
    // Two 2-column pages side by side read as one 4-across grid — which is
    // exactly what a 12-pocket page looks like, so the two formats would be
    // indistinguishable at a glance.
    expect(hasFacingPages("4")).toBe(false);
    expect(hasFacingPages("9")).toBe(true);
    expect(hasFacingPages("12")).toBe(true);

    expect(pageGroups(5, "4")).toEqual([[0], [1], [2], [3], [4]]);
  });

  it("still pairs the formats that do have facing pages", () => {
    // Page 1 alone against the inside cover, then 2|3, 4|5.
    expect(pageGroups(5, "9")).toEqual([[0], [1, 2], [3, 4]]);
    expect(pageGroups(0, "9")).toEqual([]);
    expect(pageGroups(0, "4")).toEqual([]);
  });

  it("re-flows into and out of 4-pocket in reading order", () => {
    // Positions cannot survive a format change — a 2-wide page has no pocket
    // matching the 9th of a 3-wide one — but the order must.
    let b = emptyBinder("b1", "Jumbos", "9", NOW);
    ["1", "2", "3", "4", "5"].forEach((n, i) => {
      b = placeSlot(b, 0, i, card(n), NOW);
    });

    const four = reformat(b, "4", NOW + 1);
    expect(four.pages).toHaveLength(2);
    expect(Object.keys(four.pages[0].slots)).toEqual(["0", "1", "2", "3"]);
    expect((four.pages[1].slots[0] as CardSlot).cardId).toBe("me5-5");

    // And back again, with nothing lost or reordered.
    const nine = reformat(four, "9", NOW + 2);
    expect(Object.values(nine.pages[0].slots).map((s) => (s as CardSlot).cardId)).toEqual([
      "me5-1",
      "me5-2",
      "me5-3",
      "me5-4",
      "me5-5",
    ]);
  });

  it("drops a pocket a 4-pocket page cannot hold", () => {
    // The server's whitelist, against the smallest format: pocket 8 exists in a
    // 9-pocket binder and nowhere in a 4-pocket one, and moving it would put a
    // card somewhere the user never placed it.
    const parsed = parseBinder({
      id: "b1",
      name: "Jumbos",
      format: "4",
      pages: [{ slots: { 0: card("1"), 8: card("9") } }],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(Object.keys(parsed?.pages[0].slots ?? {})).toEqual(["0"]);
  });

  it("refuses a format nobody makes", () => {
    expect(isBinderFormat("4")).toBe(true);
    expect(isBinderFormat("18")).toBe(false);
    expect(isBinderFormat(4)).toBe(false);
  });
});

describe("showValue", () => {
  it("stamps the binder only when the flag actually changes", () => {
    // Saving pushes a binder through sync; toggling to the value it already has
    // must not manufacture an edit for every other device to pull.
    const b = emptyBinder("b1", "Vault", "9", NOW);
    expect(setShowValue(b, false, NOW + 1)).toBe(b);

    const on = setShowValue(b, true, NOW + 1);
    expect(on.showValue).toBe(true);
    expect(on.updatedAt).toBe(NOW + 1);
    expect(setShowValue(on, true, NOW + 2)).toBe(on);
  });

  it("leaves no flag behind when switched off", () => {
    const on = setShowValue(emptyBinder("b1", "Vault", "9", NOW), true, NOW + 1);
    expect("showValue" in setShowValue(on, false, NOW + 2)).toBe(false);
  });

  it("survives the server whitelist, and only as a real boolean", () => {
    const base = {
      id: "b1",
      name: "Vault",
      format: "9",
      pages: [{ slots: {} }],
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(parseBinder({ ...base, showValue: true })?.showValue).toBe(true);
    expect("showValue" in (parseBinder({ ...base, showValue: "yes" }) as object)).toBe(false);
    expect("showValue" in (parseBinder(base) as object)).toBe(false);
  });
});
