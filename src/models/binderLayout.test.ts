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
  specFor,
  type BinderSlot,
} from "./binderLayout.ts";

const NOW = 1_800_000_000_000;
const card = (n: string): BinderSlot => ({ kind: "card", cardId: `me5-${n}`, finish: "normal" });
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

describe("moveSlot", () => {
  it("moves a card into an empty pocket", () => {
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = moveSlot(b, { page: 0, index: 0 }, { page: 1, index: 5 }, NOW);
    expect(b.pages[0].slots[0]).toBeUndefined();
    expect(b.pages[1].slots[5]).toMatchObject({ cardId: "me5-1" });
  });

  it("swaps rather than overwriting an occupied pocket", () => {
    // Overwriting would destroy a card with no undo; two cards changing places
    // is what the physical action means.
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = placeSlot(b, 0, 1, card("2"), NOW);
    b = moveSlot(b, { page: 0, index: 0 }, { page: 0, index: 1 }, NOW);
    expect(b.pages[0].slots[1]).toMatchObject({ cardId: "me5-1" });
    expect(b.pages[0].slots[0]).toMatchObject({ cardId: "me5-2" });
  });

  it("ignores a move from an empty pocket", () => {
    const b = base();
    expect(moveSlot(b, { page: 0, index: 0 }, { page: 0, index: 1 }, NOW)).toBe(b);
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
    expect(countBinder(b)).toEqual({ filled: 2, pockets: 9, cards: 1, images: 1 });
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
    expect(nextEmptyPocket(b, { page: 0, index: 0 })).toEqual({ page: 0, index: 1 });
  });

  it("skips pockets that are already occupied", () => {
    // Filling into a part-built page must not stop on a pocket that is taken —
    // placing there would silently replace a card the user put there earlier.
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = placeSlot(b, 0, 1, card("2"), NOW);
    b = placeSlot(b, 0, 2, card("3"), NOW);
    expect(nextEmptyPocket(b, { page: 0, index: 0 })).toEqual({ page: 0, index: 3 });
  });

  it("carries on to the next page when a page fills up", () => {
    let b = addPage(base(), NOW);
    for (let i = 0; i < 9; i++) b = placeSlot(b, 0, i, card(String(i)), NOW);
    expect(nextEmptyPocket(b, { page: 0, index: 8 })).toEqual({ page: 1, index: 0 });
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
