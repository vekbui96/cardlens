import { describe, expect, it } from "vitest";
import { balance, sideTotal } from "./balanceModel.ts";

describe("sideTotal", () => {
  it("adds price times quantity and counts cards", () => {
    expect(
      sideTotal([
        { price: 2, qty: 3 },
        { price: 1.5, qty: 1 },
      ]),
    ).toEqual({ total: 7.5, cards: 4, unpriced: 0 });
  });

  it("leaves unpriced cards out of the total and counts them", () => {
    expect(
      sideTotal([
        { price: 4, qty: 1 },
        { price: undefined, qty: 2 },
        { price: 0, qty: 1 },
      ]),
    ).toEqual({ total: 4, cards: 4, unpriced: 3 });
  });

  it("is zero for no lines", () => {
    expect(sideTotal([])).toEqual({ total: 0, cards: 0, unpriced: 0 });
  });
});

describe("balance", () => {
  it("says you get more when the get side is worth more, as a percent of the larger side", () => {
    expect(balance(8, 10)).toEqual({ lean: "get", diff: 2, percent: 20 });
  });

  it("says you give more when the give side is worth more", () => {
    expect(balance(10, 5)).toEqual({ lean: "give", diff: 5, percent: 50 });
  });

  it("is even when both sides match", () => {
    expect(balance(6, 6)).toEqual({ lean: "even", diff: 0, percent: 0 });
  });

  it("is even, with no percent, when both totals are zero", () => {
    expect(balance(0, 0)).toEqual({ lean: "even", diff: 0, percent: 0 });
  });

  it("with one empty side the percent is 100", () => {
    expect(balance(0, 3)).toEqual({ lean: "get", diff: 3, percent: 100 });
  });

  it("rounds away cent-level float noise", () => {
    expect(balance(0.1 + 0.2, 0.3)).toEqual({ lean: "even", diff: 0, percent: 0 });
  });
});
