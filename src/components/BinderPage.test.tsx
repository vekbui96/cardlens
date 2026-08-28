import { describe, expect, it } from "vitest";
import { formatBinderPrice } from "../models/binderPocket.ts";

describe("formatBinderPrice", () => {
  it("says n/a rather than nothing when a pocket has no price", () => {
    // A blank where a price belongs reads as "still loading" forever. Whole
    // categories here are unpriceable — a stamp rides on a finish the oracle
    // has never heard of — so this is the common case, not the edge one.
    expect(formatBinderPrice(undefined)).toBe("n/a");
  });

  it("treats zero and nonsense as no price, never as free", () => {
    // A 0 would sum into the total as if the card were worthless.
    expect(formatBinderPrice(0)).toBe("n/a");
    expect(formatBinderPrice(Number.NaN)).toBe("n/a");
    expect(formatBinderPrice(-5)).toBe("n/a");
  });

  it("keeps cents on small prices and drops them where they stop mattering", () => {
    expect(formatBinderPrice(1.5)).toBe("$1.50");
    expect(formatBinderPrice(12.34)).toBe("$12.34");
    expect(formatBinderPrice(429.99)).toBe("$430");
  });

  it("abbreviates thousands, because a pocket is 55px wide on a phone", () => {
    expect(formatBinderPrice(1200)).toBe("$1.2k");
    expect(formatBinderPrice(12000)).toBe("$12k");
  });
});
