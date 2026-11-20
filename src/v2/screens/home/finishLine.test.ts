import { describe, expect, it } from "vitest";
import type { Printing } from "../../../integrations/tcgdex/client.ts";
import { homeFinishLine } from "./finishLine.ts";

const byNumber: Record<string, Printing[]> = {
  "1": [{ type: "normal", price: 1 }],
  "2": [
    { type: "normal", price: 2.5 },
    { type: "holo", price: 9 },
  ],
  "3": [{ type: "normal" }],
  "4": [{ type: "normal", price: 0.4 }],
};

describe("homeFinishLine", () => {
  it("says nothing is left when the set is done", () => {
    expect(homeFinishLine({ cards: 4, total: 4, ownedNumbers: ["1", "2", "3", "4"], byNumber })).toBeNull();
  });

  it("gives the count alone when printings are not cached", () => {
    expect(homeFinishLine({ cards: 1, total: 4, ownedNumbers: ["1"], byNumber: null })).toBe("3 cards to go");
  });

  it("gives the count alone when the owned numbers are unknown", () => {
    expect(homeFinishLine({ cards: 1, total: 4, ownedNumbers: null, byNumber })).toBe("3 cards to go");
  });

  it("uses the singular for one card", () => {
    expect(homeFinishLine({ cards: 3, total: 4, ownedNumbers: ["1", "2", "3"], byNumber })).toBe(
      "1 card to go, about $0.40",
    );
  });

  it("prices each missing card at its cheapest printing and flags the unpriced", () => {
    expect(homeFinishLine({ cards: 1, total: 4, ownedNumbers: ["1"], byNumber })).toBe(
      "3 cards to go, about $2.90, 1 unpriced",
    );
  });

  it("says none priced when no missing card has a price", () => {
    expect(homeFinishLine({ cards: 3, total: 4, ownedNumbers: ["1", "2", "4"], byNumber })).toBe(
      "1 card to go, none priced",
    );
  });

  it("matches padded and unpadded collector numbers", () => {
    const padded: Record<string, Printing[]> = {
      "001": [{ type: "normal", price: 1 }],
      "1": [{ type: "normal", price: 1 }],
      "002": [{ type: "normal", price: 3 }],
      "2": [{ type: "normal", price: 3 }],
    };
    expect(homeFinishLine({ cards: 1, total: 2, ownedNumbers: ["001"], byNumber: padded })).toBe(
      "1 card to go, about $3.00",
    );
  });

  it("counts cards the cache does not list as unpriced", () => {
    expect(
      homeFinishLine({ cards: 1, total: 5, ownedNumbers: ["1"], byNumber: { "1": byNumber["1"] } }),
    ).toBe("4 cards to go, none priced");
  });
});
