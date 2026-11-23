import { describe, expect, it } from "vitest";
import {
  formatChange,
  formatChangeOver,
  formatChangeShort,
  formatPrice,
  formatUsd,
  formatWindow,
  UNAVAILABLE,
  UNPRICED,
} from "./format.ts";

/**
 * The one way a price and a movement percent are written, on every v2 screen
 * (Home, My cards, Want list, the card sheet). These pin the sign, the
 * rounding and the word for "no price", so a screen cannot drift on its own.
 */

describe("formatUsd", () => {
  it("writes dollars and cents", () => {
    expect(formatUsd(412.5)).toBe("$412.50");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.01)).toBe("$0.01");
  });

  it("never writes $0.00 for an absent, zero or broken price", () => {
    for (const v of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatUsd(v)).toBe(UNAVAILABLE);
    }
  });
});

describe("formatPrice", () => {
  it("writes a card's price the same way as formatUsd", () => {
    expect(formatPrice(12.4)).toBe("$12.40");
    expect(formatPrice(1234.5)).toBe("$1,234.50");
  });

  it('says "Unpriced" for a card with no price, never $0.00 or "Unavailable"', () => {
    expect(UNPRICED).toBe("Unpriced");
    for (const v of [undefined, null, 0, Number.NaN]) {
      expect(formatPrice(v)).toBe("Unpriced");
    }
  });
});

describe("formatChange", () => {
  it("signs a rise with + and a fall with a real minus, one decimal", () => {
    expect(formatChange(3.24)).toBe("+3.2%");
    expect(formatChange(-1.78)).toBe("−1.8%");
    expect(formatChange(23)).toBe("+23.0%");
    expect(formatChange(-1.78)).not.toContain("-");
  });

  it("writes no sign for a change that rounds to zero", () => {
    expect(formatChange(0)).toBe("0.0%");
    expect(formatChange(0.01)).toBe("0.0%");
    expect(formatChange(-0.04)).toBe("0.0%");
    expect(formatChange(-0)).toBe("0.0%");
  });

  it("rounds halves away from zero on both sides, as the movers floor expects", () => {
    // topMovers counts >= 0.05 as a riser and <= -0.05 as a faller.
    expect(formatChange(0.05)).toBe("+0.1%");
    expect(formatChange(-0.05)).toBe("−0.1%");
    expect(formatChange(2.25)).toBe("+2.3%");
    expect(formatChange(-2.25)).toBe("−2.3%");
  });

  it("groups thousands in a very large change", () => {
    expect(formatChange(1234.56)).toBe("+1,234.6%");
  });

  it("never writes NaN% or Infinity%", () => {
    expect(formatChange(Number.NaN)).toBe("—");
    expect(formatChange(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("movement windows", () => {
  it("names the window in words for a panel line", () => {
    expect(formatWindow(7)).toBe("over 7 days");
    expect(formatWindow(30)).toBe("over 30 days");
    expect(formatChangeOver(10, 7)).toBe("+10.0% over 7 days");
    expect(formatChangeOver(-4.76, 30)).toBe("−4.8% over 30 days");
  });

  it("has a compact form for a row with no room for words", () => {
    expect(formatChangeShort(23, 7)).toBe("+23.0% 7d");
    expect(formatChangeShort(-50, 30)).toBe("−50.0% 30d");
  });
});
