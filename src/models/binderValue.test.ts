import { describe, expect, it } from "vitest";
import { lineTotal, summariseBinderValue } from "./binderValue.ts";
import { withQuantity, type BinderSlot, type CardSlot } from "./binderLayout.ts";

const card = (n: string): CardSlot => ({ kind: "card", cardId: `me5-${n}`, finish: "normal" });

/** Price by collector-number suffix, and undefined for anything not listed. */
function pricer(table: Record<string, number>) {
  return (slot: BinderSlot) =>
    slot.kind === "card" ? table[slot.cardId.slice(slot.cardId.lastIndexOf("-") + 1)] : undefined;
}

describe("lineTotal", () => {
  it("multiplies by the copies behind the pocket", () => {
    expect(lineTotal(withQuantity(card("1"), 3), 12.5)).toBe(37.5);
  });

  it("treats a single copy as itself", () => {
    expect(lineTotal(card("1"), 12.5)).toBe(12.5);
  });

  it("keeps an absent price absent rather than making it zero", () => {
    // Three copies of a card nothing prices is three UNPRICED cards, not
    // $0.00 worth of them. This is the rule the whole file exists for.
    expect(lineTotal(withQuantity(card("1"), 3), undefined)).toBeUndefined();
  });
});

describe("summariseBinderValue", () => {
  it("sums what it can and counts what it cannot", () => {
    const slots = [card("1"), card("2"), card("3")];
    // Nothing prices card 2 — a stamp or a promo, or a whole set the oracle
    // has no prices for.
    expect(summariseBinderValue(slots, pricer({ 1: 10, 3: 5 }))).toEqual({
      total: 15,
      priced: 2,
      unpriced: 1,
      pricedCopies: 2,
    });
  });

  it("counts POCKETS as priced but sums over COPIES", () => {
    // The two genuinely differ in a trade binder, and reporting "2 of 2 priced"
    // against a total that summed five cards would misdescribe the measurement.
    const slots = [withQuantity(card("1"), 4), card("2")];
    expect(summariseBinderValue(slots, pricer({ 1: 10, 2: 5 }))).toEqual({
      total: 45,
      priced: 2,
      unpriced: 0,
      pricedCopies: 5,
    });
  });

  it("does not let an unpriced stack drag copies into the count", () => {
    // Its four copies are unpriced, so they belong to neither the total nor
    // pricedCopies — the number under the total must describe the total.
    const slots = [withQuantity(card("1"), 4), card("2")];
    const summary = summariseBinderValue(slots, pricer({ 2: 5 }));
    expect(summary).toEqual({ total: 5, priced: 1, unpriced: 1, pricedCopies: 1 });
  });

  it("is zero and empty for a binder with nothing in it", () => {
    expect(summariseBinderValue([], pricer({}))).toEqual({
      total: 0,
      priced: 0,
      unpriced: 0,
      pricedCopies: 0,
    });
  });

  it("counts a binder nothing can price as entirely unpriced, not as worthless", () => {
    // Measured live: pokemontcg.io prices 0/120 Pitch Black and 0/124 Perfect
    // Order. A binder of one of those must read as unmeasured.
    const slots = [card("1"), withQuantity(card("2"), 3)];
    expect(summariseBinderValue(slots, pricer({}))).toEqual({
      total: 0,
      priced: 0,
      unpriced: 2,
      pricedCopies: 0,
    });
  });

  it("prices a custom image at nothing without counting it as a failure to price", () => {
    // An image has no market price and never will. It still occupies a pocket,
    // so it lands in `unpriced` — which is why that number is described as
    // pockets rather than as cards the oracle let us down on.
    const slots: BinderSlot[] = [card("1"), { kind: "image", src: "data:image/png;base64,AAA" }];
    expect(summariseBinderValue(slots, pricer({ 1: 10 }))).toEqual({
      total: 10,
      priced: 1,
      unpriced: 1,
      pricedCopies: 1,
    });
  });
});
