import { describe, expect, it } from "vitest";
import {
  countBinder,
  emptyBinder,
  placeSlot,
  reformat,
  setCover,
  slotAt,
  type Binder,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import { applyDrop, applyPlace } from "./binderEdits.ts";

/**
 * The decisions, not the markup.
 *
 * Every case here is a bug that has actually happened to a binder, and each one
 * failed in silence: a card destroyed by being dropped where it started, a
 * second card replacing the first instead of joining it, a cover counted as a
 * pocket. None of them throws.
 */

const NOW = 1_700_000_000_000;

const jolteon: BinderSlot = { kind: "card", cardId: "base2-4", finish: "holo", name: "Jolteon" };
const flareon: BinderSlot = { kind: "card", cardId: "base2-3", finish: "holo", name: "Flareon" };
const vaporeon: BinderSlot = { kind: "card", cardId: "base2-2", finish: "holo", name: "Vaporeon" };

function binderWith(...at: Array<[number, number, BinderSlot]>): Binder {
  let binder = emptyBinder("b", "Eeveelutions", "9", NOW);
  for (const [page, index, slot] of at) binder = placeSlot(binder, page, index, slot, NOW);
  return binder;
}

describe("a drag that lands", () => {
  it("SWAPS two pockets, because the card leaving has to go somewhere", () => {
    // Overwriting would destroy the target, and there is no undo for that.
    const binder = binderWith([0, 0, jolteon], [0, 4, flareon]);
    const { binder: next } = applyDrop(
      binder,
      { kind: "address", at: { kind: "pocket", page: 0, index: 0 } },
      jolteon,
      { kind: "pocket", page: 0, index: 4 },
      NOW,
    );

    expect(slotAt(next, { kind: "pocket", page: 0, index: 4 })).toEqual(jolteon);
    expect(slotAt(next, { kind: "pocket", page: 0, index: 0 })).toEqual(flareon);
  });

  it("REPLACES when the card came from the picker, because there is nothing to swap back", () => {
    const binder = binderWith([0, 4, flareon]);
    const { binder: next } = applyDrop(
      binder,
      { kind: "new" },
      vaporeon,
      { kind: "pocket", page: 0, index: 4 },
      NOW,
    );

    expect(slotAt(next, { kind: "pocket", page: 0, index: 4 })).toEqual(vaporeon);
    expect(countBinder(next).cards).toBe(1);
  });

  it("keeps the card when it is dropped back where it started", () => {
    // The commonest way a drag ends: a press that moved a few pixels, or a
    // change of mind. Without the guard the two writes cancel out to "put it
    // there, then clear where it came from" — the same address — and the card
    // is destroyed by being moved nowhere.
    const binder = binderWith([0, 3, jolteon]);
    const at = { kind: "pocket", page: 0, index: 3 } as const;
    const { binder: next } = applyDrop(binder, { kind: "address", at }, jolteon, at, NOW);

    expect(slotAt(next, at)).toEqual(jolteon);
    expect(countBinder(next).cards).toBe(1);
  });

  it("does NOT select the pocket it landed on, when the card was already in the binder", () => {
    // Rearranging is not filling. Opening the picker on the target answers a
    // question nobody asked, once per card, while a page is being tidied.
    const binder = binderWith([0, 0, jolteon]);
    const result = applyDrop(
      binder,
      { kind: "address", at: { kind: "pocket", page: 0, index: 0 } },
      jolteon,
      { kind: "pocket", page: 0, index: 5 },
      NOW,
    );

    expect(result.select).toBeUndefined();
  });

  it("DOES select when the card came from the picker, because that IS filling", () => {
    // The sheet it opens is where copies, condition and "I own this" are set
    // for the card just placed.
    const to = { kind: "pocket", page: 0, index: 5 } as const;
    const result = applyDrop(binderWith(), { kind: "new" }, jolteon, to, NOW);

    expect(result.select).toEqual(to);
  });

  it("moves a card onto the cover, and off it again", () => {
    const binder = binderWith([0, 0, jolteon]);
    const onCover = applyDrop(
      binder,
      { kind: "address", at: { kind: "pocket", page: 0, index: 0 } },
      jolteon,
      { kind: "cover" },
      NOW,
    ).binder;

    expect(onCover.cover).toEqual(jolteon);
    expect(countBinder(onCover).filled).toBe(0);

    const backOff = applyDrop(
      onCover,
      { kind: "address", at: { kind: "cover" } },
      jolteon,
      { kind: "pocket", page: 0, index: 2 },
      NOW,
    ).binder;

    expect(backOff.cover).toBeUndefined();
    expect(slotAt(backOff, { kind: "pocket", page: 0, index: 2 })).toEqual(jolteon);
  });
});

describe("placing from the picker", () => {
  it("advances to the next empty pocket, so a second card is added and not swapped in", () => {
    // The bug: the pocket stayed selected after a place, so every card picked
    // after the first replaced the one before it. The binder never grew past a
    // single card, and nothing said why.
    const first = applyPlace(binderWith(), { kind: "pocket", page: 0, index: 0 }, jolteon, NOW);
    expect(first?.select).toEqual({ kind: "pocket", page: 0, index: 1 });

    const second = applyPlace(first!.binder, first!.select ?? null, flareon, NOW);
    expect(countBinder(second!.binder).cards).toBe(2);
  });

  it("stays put when a pocket is CLEARED, because that is an edit to this pocket", () => {
    const at = { kind: "pocket", page: 0, index: 4 } as const;
    const result = applyPlace(binderWith([0, 4, jolteon]), at, null, NOW);

    expect(result?.select).toEqual(at);
    expect(countBinder(result!.binder).cards).toBe(0);
  });

  it("does not advance off the COVER, which is one slot and not a sequence", () => {
    // Advancing into page 1, pocket 1 would be the app deciding you meant to
    // carry on filling pages when you were setting a cover.
    const result = applyPlace(binderWith(), { kind: "cover" }, jolteon, NOW);

    expect(result?.select).toEqual({ kind: "cover" });
    expect(result?.binder.cover).toEqual(jolteon);
  });

  it("puts a card in the first empty pocket when nothing is selected", () => {
    // On a desktop the rail is open whether or not a pocket is chosen, so
    // clicking a card having chosen nothing is ordinary. Refusing it would make
    // the rail a shop window.
    const result = applyPlace(binderWith([0, 0, jolteon]), null, flareon, NOW);

    expect(result?.select).toEqual({ kind: "pocket", page: 0, index: 2 });
    expect(slotAt(result!.binder, { kind: "pocket", page: 0, index: 1 })).toEqual(flareon);
  });

  it("does nothing at all when there is nothing to clear and nowhere to put it", () => {
    expect(applyPlace(binderWith(), null, null, NOW)).toBeNull();
  });
});

describe("the cover is not a pocket", () => {
  it("is excluded from the filled count", () => {
    const binder = setCover(binderWith([0, 0, jolteon]), flareon, NOW);
    const counts = countBinder(binder);

    expect(counts.filled).toBe(1);
    expect(counts.pockets).toBe(9);
  });

  it("survives a reformat, because a cover is not contents", () => {
    // Moving a binder from 9-pocket to 12 re-flows the pages in reading order.
    // The cover holds no position, so there is nothing to re-flow.
    const binder = setCover(binderWith([0, 0, jolteon], [0, 8, flareon]), vaporeon, NOW);
    const wider = reformat(binder, "12", NOW + 1);

    expect(wider.cover).toEqual(vaporeon);
    expect(wider.format).toBe("12");
    expect(countBinder(wider).cards).toBe(2);
  });
});
