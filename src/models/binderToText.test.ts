import { describe, expect, it } from "vitest";
import type { Binder, BinderSlot, CardSlot } from "./binderLayout.ts";
import { binderToText } from "./binderToText.ts";

function card(cardId: string, extra: Partial<CardSlot> = {}): CardSlot {
  return { kind: "card", cardId, finish: "holofoil", name: `Name ${cardId}`, collectorNumber: "7", ...extra };
}

function binderOf(slots: Record<number, BinderSlot>, name = "My binder"): Binder {
  return { id: "b1", name, format: "9-pocket", pages: [{ slots }], updatedAt: 1 } as unknown as Binder;
}

const PRICES: Record<string, number> = { a: 2.5, b: 10 };
const priceFor = (slot: BinderSlot) => (slot.kind === "card" ? PRICES[slot.cardId] : undefined);

describe("binderToText", () => {
  it("lists one line per card with a priced footer", () => {
    const { text, pockets } = binderToText(binderOf({ 0: card("a"), 2: card("b") }), priceFor, true);
    expect(pockets).toBe(2);
    expect(text).toContain("Name a - #7 - Holofoil - $2.50");
    expect(text).toContain("Name b - #7 - Holofoil - $10.00");
    expect(text.split("\n").pop()).toBe("2 cards, 2 priced, about 12.50 USD");
  });

  it("writes quantity and condition only when stated, and prices the copies", () => {
    const slots = { 0: card("b", { quantity: 3, condition: "NM" }), 1: card("a") };
    const { text } = binderToText(binderOf(slots), priceFor, true);
    expect(text).toContain("3x Name b - #7 - Holofoil - Near mint - $30.00");
    expect(text).toContain("\nName a - #7 - Holofoil - $2.50");
    expect(text).not.toContain("1x");
    expect(text.split("\n").pop()).toBe("4 cards, 2 priced, about 32.50 USD");
  });

  it("says unpriced and never invents a number", () => {
    const { text } = binderToText(binderOf({ 0: card("zzz") }), priceFor, true);
    expect(text).toContain("Name zzz - #7 - Holofoil - unpriced");
    expect(text.split("\n").pop()).toBe("1 card, 0 priced");
    expect(text).not.toContain("$0");
  });

  it("leaves prices out entirely when they are not shown", () => {
    const { text } = binderToText(binderOf({ 0: card("a") }), priceFor, false);
    expect(text).not.toContain("$");
    expect(text).not.toContain("priced");
    expect(text.split("\n").pop()).toBe("1 card");
  });

  it("falls back to the card id and skips image pockets, counting them apart", () => {
    const slots = {
      0: card("sv3-9", { name: undefined, collectorNumber: undefined }),
      1: { kind: "image", imageId: "img-1" } as unknown as BinderSlot,
    };
    const { text, pockets } = binderToText(binderOf(slots), priceFor, false);
    expect(pockets).toBe(1);
    expect(text).toContain("sv3-9 - Holofoil");
    expect(text).toContain("(1 photo or divider pocket not listed)");
  });
});
