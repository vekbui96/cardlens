import { describe, expect, it } from "vitest";
import { CardListResponseSchema, CardSchema } from "./schema.ts";
import { MOCK_CARDS } from "./fixtures.ts";

describe("CardSchema", () => {
  it("accepts a realistic card with pricing", () => {
    const parsed = CardSchema.safeParse(MOCK_CARDS[0]);
    expect(parsed.success).toBe(true);
  });

  it("accepts null price points", () => {
    const card = {
      id: "x-1",
      name: "Test",
      set: { id: "x", name: "X" },
      tcgplayer: { updatedAt: "2026/01/01", prices: { holofoil: { market: null, low: 1 } } },
    };
    expect(CardSchema.safeParse(card).success).toBe(true);
  });

  it("rejects a card without an id", () => {
    const bad = { name: "No id", set: { id: "x", name: "X" } };
    expect(CardSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a card without a set", () => {
    expect(CardSchema.safeParse({ id: "1", name: "X" }).success).toBe(false);
  });
});

describe("CardListResponseSchema", () => {
  it("parses a wrapped list", () => {
    const parsed = CardListResponseSchema.safeParse({ data: MOCK_CARDS, totalCount: MOCK_CARDS.length });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-array data field", () => {
    expect(CardListResponseSchema.safeParse({ data: "nope" }).success).toBe(false);
  });
});
