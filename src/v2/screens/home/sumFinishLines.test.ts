import { describe, expect, it } from "vitest";
import { sumFinishLines } from "./finishLine.ts";

describe("sumFinishLines", () => {
  it("adds cards, price and unpriced across sets", () => {
    expect(
      sumFinishLines([{ toGo: 10, priced: 9, total: 20.5 }, { toGo: 11, priced: 10, total: 27.75 }, null]),
    ).toBe("To finish these 2 sets: 21 cards to go, about $48.25 (2 unpriced)");
  });

  it("leaves out the unpriced note when every card is priced", () => {
    expect(
      sumFinishLines([
        { toGo: 1, priced: 1, total: 1 },
        { toGo: 2, priced: 2, total: 3 },
      ]),
    ).toBe("To finish these 2 sets: 3 cards to go, about $4.00");
  });

  it("gives the count alone when a row has no price data", () => {
    expect(
      sumFinishLines([
        { toGo: 4, priced: 4, total: 9 },
        { toGo: 5, priced: null, total: 0 },
      ]),
    ).toBe("To finish these 2 sets: 9 cards to go");
  });

  it("says none priced when nothing has a price", () => {
    expect(
      sumFinishLines([
        { toGo: 1, priced: 0, total: 0 },
        { toGo: 2, priced: 0, total: 0 },
      ]),
    ).toBe("To finish these 2 sets: 3 cards to go, none priced");
  });

  it("is absent for one set, none, or complete sets", () => {
    expect(sumFinishLines([{ toGo: 3, priced: 3, total: 5 }])).toBeNull();
    expect(sumFinishLines([])).toBeNull();
    expect(sumFinishLines([null, undefined, { toGo: 3, priced: 3, total: 5 }])).toBeNull();
  });
});
