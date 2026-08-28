import { describe, expect, it } from "vitest";
import { parseTradeShare, tradeRows } from "./tradeShare.ts";
import { emptyBinder, placeSlot, withQuantity, type Binder, type CardSlot } from "./binderLayout.ts";

const NOW = 1_800_000_000_000;

const card = (n: string, over: Partial<CardSlot> = {}): CardSlot => ({
  kind: "card",
  cardId: `me5-${n}`,
  finish: "normal",
  collectorNumber: n,
  name: `Card ${n}`,
  ...over,
});

function binderWith(...placements: [page: number, index: number, slot: CardSlot][]): Binder {
  let b = emptyBinder("b1", "Trades", "9", NOW);
  for (const [page, index, slot] of placements) b = placeSlot(b, page, index, slot, NOW);
  return b;
}

const payload = (binder: Binder) => ({ kind: "binder", binder, at: NOW });

describe("parseTradeShare", () => {
  it("accepts a binder payload and keeps the trade fields", () => {
    const binder = binderWith([0, 0, card("4", { quantity: 3, condition: "LP" })]);
    const parsed = parseTradeShare(payload(binder));
    expect(parsed?.binder.pages[0].slots[0]).toMatchObject({ quantity: 3, condition: "LP" });
    expect(parsed?.at).toBe(NOW);
  });

  it("refuses a SET share, which shares an id space with this one", () => {
    // A set link opened on the trade screen must read as "not a trade binder"
    // rather than rendering an empty binder as if it were one.
    expect(parseTradeShare({ kind: "set", setId: "me5", setName: "Pitch Black", owned: [] })).toBeNull();
  });

  it("refuses anything that is not a binder at all", () => {
    expect(parseTradeShare(null)).toBeNull();
    expect(parseTradeShare({ kind: "binder" })).toBeNull();
    expect(parseTradeShare({ kind: "binder", binder: { id: "b1" } })).toBeNull();
  });

  it("validates the binder with the same rules the server stores it under", () => {
    // The shared parser is the point: a pocket outside the format's range is
    // dropped here exactly as it is on ingest, so the two ends cannot disagree
    // about what is in the binder.
    const binder = binderWith([0, 0, card("4")]);
    const hostile = {
      ...binder,
      pages: [{ slots: { ...binder.pages[0].slots, 11: card("9") } }],
    };
    const parsed = parseTradeShare({ kind: "binder", binder: hostile, at: NOW });
    expect(Object.keys(parsed?.binder.pages[0].slots ?? {})).toEqual(["0"]);
  });
});

describe("tradeRows", () => {
  it("carries the address, so a card can be asked for by pocket", () => {
    const binder = binderWith([0, 4, card("4")], [1, 0, card("9")]);
    expect(tradeRows(binder)).toMatchObject([
      { page: 1, pocket: 5, copies: 1 },
      { page: 2, pocket: 1, copies: 1 },
    ]);
  });

  it("reads in pocket order regardless of the order pockets were filled", () => {
    // Object key order is not a promise, and the list must open reading the way
    // the binder does before the visitor sorts it by anything else.
    const binder = binderWith([0, 8, card("9")], [0, 0, card("1")], [0, 3, card("4")]);
    expect(tradeRows(binder).map((r) => r.pocket)).toEqual([1, 4, 9]);
  });

  it("counts copies per row", () => {
    const binder = binderWith([0, 0, withQuantity(card("4"), 3)]);
    expect(tradeRows(binder)[0].copies).toBe(3);
  });

  it("leaves out images, which are not on offer", () => {
    // A divider or a photo is part of how the binder reads, not part of the
    // trade — counting them would inflate "24 cards".
    let binder = binderWith([0, 0, card("4")]);
    binder = placeSlot(binder, 0, 1, { kind: "image", src: "data:image/png;base64,AAA" }, NOW);
    expect(tradeRows(binder)).toHaveLength(1);
  });
});
