import { describe, expect, it } from "vitest";
import { summaryText, type TradeLine } from "./summaryText.ts";

const line = (name: string, price: number | undefined, qty = 1): TradeLine => ({
  name,
  setName: "Base Set",
  collectorNumber: "4",
  qty,
  price,
});

describe("summaryText", () => {
  it("lists priced cards with quantity, totals and an uneven balance", () => {
    const text = summaryText([line("Charizard", 10, 2)], [line("Blastoise", 5)]);
    expect(text).toContain("I give:\n2 x Charizard (Base Set 4) - $20.00\nTotal: $20.00");
    expect(text).toContain("I get:\n1 x Blastoise (Base Set 4) - $5.00\nTotal: $5.00");
    expect(text).toContain("Balance: you give $15.00 more.");
    expect(text).toContain("Prices are in USD.");
  });

  it("prints unpriced cards as unpriced, never 0", () => {
    const text = summaryText([line("Pikachu", undefined)], [line("Mew", 3)]);
    expect(text).toContain("1 x Pikachu (Base Set 4) - unpriced");
    expect(text).toContain("Total: no price yet (1 unpriced, not counted)");
    expect(text).not.toContain("$0");
    expect(text).toContain("Balance: you get $3.00 more.");
  });

  it("says even when both sides match", () => {
    const text = summaryText([line("A", 4)], [line("B", 4)]);
    expect(text).toContain("Balance: even, both sides are worth the same.");
  });

  it("has nothing to compare when no side has a price", () => {
    const text = summaryText([line("A", undefined)], [line("B", undefined)]);
    expect(text).toContain("Balance: no prices yet, nothing to compare.");
  });
});
