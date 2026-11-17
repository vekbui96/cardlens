import { describe, expect, it } from "vitest";
import { emptyBinder, type Binder, type BinderSlot } from "../../models/binderLayout.ts";
import { parseBinder } from "../../models/binderParse.ts";
import { canRemovePage, insertPageBefore, removePage } from "./pageEdits.ts";

// Plausible epoch stamps — parseBinder refuses nonsense ones.
const T0 = 1_760_000_000_000;
const T1 = T0 + 60_000;

const card = (cardId: string): BinderSlot => ({
  kind: "card",
  cardId,
  finish: "holo",
  name: cardId,
  collectorNumber: cardId.split("-")[1],
});

/** Three pages: a card on page 1, two on page 2, page 3 empty. With a cover. */
function threePages(): Binder {
  const b = emptyBinder("b1", "Pikachu", "9", T0);
  return {
    ...b,
    cover: card("sv1-1"),
    pages: [
      { slots: { 0: card("sv1-2") } },
      { slots: { 0: card("sv1-3"), 4: card("sv1-4") } },
      { slots: {} },
    ],
  };
}

describe("insertPageBefore", () => {
  it("puts a blank page in and moves the later pages back by one", () => {
    const before = threePages();
    const after = insertPageBefore(before, 1, T1);

    expect(after.pages).toHaveLength(4);
    expect(after.pages[0]).toEqual(before.pages[0]);
    expect(after.pages[1]).toEqual({ slots: {} });
    // The old page 2, pockets and all, is now page 3.
    expect(after.pages[2]).toEqual(before.pages[1]);
    expect(after.pages[3]).toEqual(before.pages[2]);
    expect(after.updatedAt).toBe(T1);
  });

  it("leaves the cover and the binder's settings alone", () => {
    const before = threePages();
    const after = insertPageBefore(before, 0, T1);
    expect(after.cover).toEqual(before.cover);
    expect(after.format).toBe(before.format);
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("does not mutate the binder it was given", () => {
    const before = threePages();
    insertPageBefore(before, 1, T1);
    expect(before.pages).toHaveLength(3);
  });

  it("refuses an index outside the binder", () => {
    const before = threePages();
    expect(insertPageBefore(before, -1, T1)).toBe(before);
    expect(insertPageBefore(before, 4, T1)).toBe(before);
    expect(insertPageBefore(before, 1.5, T1)).toBe(before);
  });
});

describe("removePage", () => {
  it("removes an empty page from the middle and moves the later pages up", () => {
    const start = insertPageBefore(threePages(), 1, T1);
    const after = removePage(start, 1, T1 + 1);

    expect(after.pages).toEqual(threePages().pages);
    expect(after.updatedAt).toBe(T1 + 1);
    expect(after.cover).toEqual(start.cover);
  });

  it("refuses a page that holds a card, and leaves the binder unchanged", () => {
    const before = threePages();
    expect(canRemovePage(before, 0)).toBe(false);
    expect(removePage(before, 0, T1)).toBe(before);
    expect(removePage(before, 1, T1)).toBe(before);
  });

  it("refuses the only page, even when it is empty", () => {
    const only = emptyBinder("b2", "Empty", "9", T0);
    expect(canRemovePage(only, 0)).toBe(false);
    expect(removePage(only, 0, T1)).toBe(only);
  });

  it("refuses a page that does not exist", () => {
    const before = threePages();
    expect(canRemovePage(before, 3)).toBe(false);
    expect(canRemovePage(before, -1)).toBe(false);
    expect(removePage(before, 3, T1)).toBe(before);
  });

  it("allows an empty last page, like the toolbar's Remove page", () => {
    const before = threePages();
    expect(canRemovePage(before, 2)).toBe(true);
    expect(removePage(before, 2, T1).pages).toHaveLength(2);
  });
});

describe("stored shape", () => {
  it("survives the sync parser unchanged after an insert and a remove", () => {
    // Pins that these are page edits and not a new shape: the binder that goes
    // to the server is exactly what comes back out of the whitelist.
    const inserted = insertPageBefore(threePages(), 2, T1);
    expect(parseBinder(JSON.parse(JSON.stringify(inserted)))).toEqual(inserted);

    const removed = removePage(inserted, 2, T1 + 1);
    expect(parseBinder(JSON.parse(JSON.stringify(removed)))).toEqual(removed);
  });
});
