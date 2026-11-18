import { describe, expect, it } from "vitest";
import type { BinderSlot, CardSlot } from "./binderLayout.ts";
import { stillToGet, stillToGetLine } from "./binderToGet.ts";

function card(cardId: string, finish = "holo", quantity?: number): CardSlot {
  return {
    kind: "card",
    cardId,
    finish,
    name: cardId,
    collectorNumber: "1",
    ...(quantity ? { quantity } : {}),
  };
}

const image = { kind: "image", imageId: "img-1" } as unknown as BinderSlot;

const PRICES: Record<string, number> = { "sv3-1": 2.5, "sv3-2": 10, "sv3-9": 40 };
const priceFor = (slot: BinderSlot) => (slot.kind === "card" ? PRICES[slot.cardId] : undefined);

describe("stillToGet", () => {
  it("counts every unowned card pocket and sums the ones with a price", () => {
    const slots = [card("sv3-1"), card("sv3-2"), card("sv3-404")];
    expect(stillToGet(slots, () => false, priceFor)).toEqual({ cards: 3, priced: 2, total: 12.5 });
  });

  it("leaves out owned pockets and image pockets", () => {
    const owned = card("sv3-9");
    const slots = [card("sv3-1"), owned, image];
    const owns = (slot: BinderSlot) => slot === owned;
    expect(stillToGet(slots, owns, priceFor)).toEqual({ cards: 1, priced: 1, total: 2.5 });
  });

  it("judges ownership per printing: the holo is still to get when only the reverse is owned", () => {
    const holo = card("sv3-1", "holo");
    const reverse = card("sv3-1", "reverse");
    const owns = (slot: BinderSlot) => slot.kind === "card" && slot.finish === "reverse";
    expect(stillToGet([holo, reverse], owns, priceFor)).toEqual({ cards: 1, priced: 1, total: 2.5 });
  });

  it("is nothing when every card is owned", () => {
    expect(stillToGet([card("sv3-1"), image], () => true, priceFor)).toEqual({
      cards: 0,
      priced: 0,
      total: 0,
    });
  });

  it("never prices an unpriced card as zero", () => {
    expect(stillToGet([card("sv3-404")], () => false, priceFor)).toEqual({ cards: 1, priced: 0, total: 0 });
  });
});

describe("stillToGetLine", () => {
  it("says the binder is complete", () => {
    expect(stillToGetLine({ cards: 0, priced: 0, total: 0 }, false)).toBe(
      "You own every card in this binder",
    );
  });

  it("names the priced part and the unpriced count", () => {
    expect(stillToGetLine({ cards: 9, priced: 7, total: 31.4 }, false)).toBe(
      "Still to get: 9 cards · $31.40 for 7 of them (2 unpriced)",
    );
  });

  it("gives the plain total when everything is priced", () => {
    expect(stillToGetLine({ cards: 1, priced: 1, total: 2.5 }, false)).toBe("Still to get: 1 card · $2.50");
  });

  it("says pricing… instead of a partial figure while prices load", () => {
    expect(stillToGetLine({ cards: 2, priced: 1, total: 2.5 }, true)).toBe(
      "Still to get: 2 cards · pricing…",
    );
  });

  it("does not show $0.00 when nothing is priced", () => {
    expect(stillToGetLine({ cards: 2, priced: 0, total: 0 }, false)).toBe("Still to get: 2 cards (unpriced)");
  });
});
