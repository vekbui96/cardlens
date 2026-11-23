import { describe, expect, it } from "vitest";
import { emptyBinder, type Binder, type CardSlot } from "../../../models/binderLayout.ts";
import { SWIPE_MIN, showcaseItems, swipeStep } from "./showcaseItems.ts";

describe("swipeStep", () => {
  it("turns forward on a left swipe and back on a right one", () => {
    expect(swipeStep(-SWIPE_MIN - 10)).toBe(1);
    expect(swipeStep(SWIPE_MIN + 10)).toBe(-1);
  });

  it("ignores a wobbly tap and a mostly vertical drag", () => {
    expect(swipeStep(SWIPE_MIN - 1)).toBe(0);
    expect(swipeStep(-(SWIPE_MIN + 20), SWIPE_MIN + 60)).toBe(0);
  });
});

const NOW = 1_763_000_000_000;

function card(name: string): CardSlot {
  return { kind: "card", cardId: `sv1-${name}`, finish: "normal", name };
}

describe("showcaseItems", () => {
  it("is empty for a binder with nothing in it", () => {
    expect(showcaseItems(emptyBinder("b", "Empty", "9", NOW))).toEqual([]);
  });

  it("walks the cover first, then every page in pocket order, skipping blanks", () => {
    const binder: Binder = {
      ...emptyBinder("b", "Mixed", "9", NOW),
      cover: card("Cover"),
      pages: [
        { slots: { 8: card("Last"), 0: card("First"), 4: card("Middle") } },
        { slots: {} },
        { slots: { 2: card("Later") } },
      ],
    };

    const items = showcaseItems(binder);

    expect(items.map((i) => (i.slot.kind === "card" ? i.slot.name : ""))).toEqual([
      "Cover",
      "First",
      "Middle",
      "Last",
      "Later",
    ]);
    expect(items.map((i) => i.page)).toEqual([null, 1, 1, 1, 3]);
  });

  it("does not change the binder it reads", () => {
    const binder: Binder = { ...emptyBinder("b", "One", "9", NOW), pages: [{ slots: { 3: card("A") } }] };
    const before = JSON.stringify(binder);
    showcaseItems(binder);
    expect(JSON.stringify(binder)).toBe(before);
  });
});
