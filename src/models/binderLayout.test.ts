import { describe, expect, it } from "vitest";
import {
  countBinder,
  emptyBinder,
  moveSlot,
  placeSlot,
  reformat,
  specFor,
  trimPages,
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

describe("trimPages and counts", () => {
  it("drops trailing empty pages but keeps one", () => {
    let b = placeSlot(base(), 3, 0, card("1"), NOW);
    b = placeSlot(b, 3, 0, null, NOW);
    expect(trimPages(b).pages).toHaveLength(1);
    expect(trimPages(emptyBinder("x", "x", "9", NOW)).pages).toHaveLength(1);
  });

  it("counts cards and images against total pockets", () => {
    let b = placeSlot(base(), 0, 0, card("1"), NOW);
    b = placeSlot(b, 0, 1, { kind: "image", src: "data:image/png;base64,AAA" }, NOW);
    expect(countBinder(b)).toEqual({ filled: 2, pockets: 9, cards: 1, images: 1 });
  });
});
