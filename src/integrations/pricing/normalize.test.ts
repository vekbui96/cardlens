import { describe, expect, it } from "vitest";
import { cleanPrice, normalizeTcgplayerPricing, toIso, type RawTcgplayer } from "./normalize.ts";

describe("cleanPrice", () => {
  it("treats 0, null, NaN, and negatives as absent", () => {
    expect(cleanPrice(0)).toBeUndefined();
    expect(cleanPrice(null)).toBeUndefined();
    expect(cleanPrice(undefined)).toBeUndefined();
    expect(cleanPrice(Number.NaN)).toBeUndefined();
    expect(cleanPrice(-5)).toBeUndefined();
  });
  it("keeps positive finite prices", () => {
    expect(cleanPrice(58.42)).toBe(58.42);
  });
});

describe("toIso", () => {
  it("converts YYYY/MM/DD to ISO", () => {
    expect(toIso("2026/07/11")).toBe("2026-07-11T00:00:00.000Z");
  });
  it("returns empty string for unknown input", () => {
    expect(toIso(undefined)).toBe("");
    expect(toIso("not a date")).toBe("");
  });
});

describe("normalizeTcgplayerPricing", () => {
  it("returns empty variants and no headline when there is no pricing", () => {
    const result = normalizeTcgplayerPricing(undefined);
    expect(result.currency).toBe("USD");
    expect(result.marketPrice).toBeUndefined();
    expect(result.headlineFinish).toBeUndefined();
    expect(result.variants).toEqual({});
  });

  it("prefers holofoil as the headline finish", () => {
    const tcg: RawTcgplayer = {
      updatedAt: "2026/07/11",
      prices: {
        normal: { market: 4.25 },
        holofoil: { low: 49.99, mid: 61.25, high: 120, market: 58.42 },
      },
    };
    const result = normalizeTcgplayerPricing(tcg);
    expect(result.headlineFinish).toBe("holofoil");
    expect(result.marketPrice).toBe(58.42);
    expect(result.lowPrice).toBe(49.99);
    expect(result.midPrice).toBe(61.25);
    expect(result.variants.normal?.market).toBe(4.25);
  });

  it("keeps finishes separate and maps 1st edition keys", () => {
    const tcg: RawTcgplayer = {
      prices: {
        "1stEditionHolofoil": { market: 500 },
        reverseHolofoil: { market: 30 },
      },
    };
    const result = normalizeTcgplayerPricing(tcg);
    expect(result.variants.firstEditionHolofoil?.market).toBe(500);
    expect(result.variants.reverseHolofoil?.market).toBe(30);
  });

  it("drops all-zero/null finishes so nothing shows $0.00", () => {
    const tcg: RawTcgplayer = {
      prices: {
        reverseHolofoil: { low: null, mid: null, high: null, market: null },
        normal: { market: 0 },
      },
    };
    const result = normalizeTcgplayerPricing(tcg);
    expect(result.variants.reverseHolofoil).toBeUndefined();
    expect(result.variants.normal).toBeUndefined();
    expect(result.marketPrice).toBeUndefined();
  });
});
