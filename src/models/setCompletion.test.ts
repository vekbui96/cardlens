import { describe, expect, it } from "vitest";
import { baseSetTotal, completionPercent, isBaseNumber, setTiers, type SetSizes } from "./setCompletion.ts";

/** Collector numbers `from`..`to`, as the strings the API actually returns. */
const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/** Pitch Black: 120 cards, 84 printed, so 36 over-number. */
const PITCH_BLACK: SetSizes = { total: 120, printedTotal: 84 };

describe("isBaseNumber", () => {
  it("accepts numerics inside the printed run and rejects those past it", () => {
    expect(isBaseNumber("1", 84)).toBe(true);
    expect(isBaseNumber("84", 84)).toBe(true);
    expect(isBaseNumber("85", 84)).toBe(false);
    expect(isBaseNumber("120", 84)).toBe(false);
  });

  it("treats every non-numeric number as over-number", () => {
    // 7.75% of all collector numbers. Counting them as over-number is what
    // closes all 35 discrepancies against total - printedTotal.
    for (const number of ["TG01", "SWSH001", "H1", "88a", "GG12", "SV107", ""]) {
      expect(isBaseNumber(number, 999)).toBe(false);
    }
  });

  it("tolerates padding around an otherwise numeric number", () => {
    expect(isBaseNumber(" 42 ", 84)).toBe(true);
    expect(isBaseNumber("042", 84)).toBe(true);
  });
});

describe("baseSetTotal", () => {
  it("is the printed total when the set has secrets", () => {
    expect(baseSetTotal(PITCH_BLACK)).toBe(84);
  });

  it("declines when printedTotal equals total — 67 of 174 sets", () => {
    expect(baseSetTotal({ total: 102, printedTotal: 102 })).toBeUndefined();
  });

  it("declines when printedTotal exceeds total (swshp 307/304, svp 215/196)", () => {
    // min(printedTotal, total) === total, which is the single-tier case again.
    expect(baseSetTotal({ total: 304, printedTotal: 307 })).toBeUndefined();
    expect(baseSetTotal({ total: 196, printedTotal: 215 })).toBeUndefined();
  });

  it("declines when printedTotal is absent or nonsense", () => {
    expect(baseSetTotal({ total: 120 })).toBeUndefined();
    expect(baseSetTotal({ total: 120, printedTotal: 0 })).toBeUndefined();
    expect(baseSetTotal({ total: 120, printedTotal: Number.NaN })).toBeUndefined();
  });
});

describe("setTiers — the numerator is partitioned, never clamped", () => {
  it("does not call the base set complete when secrets pad the numerator", () => {
    // 64 of the 84 base cards, plus every one of the 36 secrets: 100 owned
    // cards against a base total of 84. Anything that pointed the whole
    // numerator at the base denominator — with or without a Math.min — would
    // report this set finished with a fifth of it missing.
    const owned = [...range(1, 64), ...range(85, 120)];
    const tiers = setTiers(PITCH_BLACK, owned);

    expect(tiers.tier).toBe("none");
    expect(tiers.masterOwned).toBe(100);
    expect(tiers.baseOwned).toBe(64);
    expect(tiers.baseTotal).toBe(84);
    expect(completionPercent(tiers.baseRatio)).toBe(76);
  });

  it("still refuses when the secrets alone outnumber the base total", () => {
    // The extreme of the same bug: owning nothing but over-number cards.
    const tiers = setTiers({ total: 300, printedTotal: 10 }, range(11, 300));
    expect(tiers.masterOwned).toBe(290);
    expect(tiers.baseOwned).toBe(0);
    expect(tiers.tier).toBe("none");
    expect(tiers.baseRatio).toBe(0);
  });

  it("awards base the moment the base cards are all held, secrets or not", () => {
    const justBase = setTiers(PITCH_BLACK, range(1, 84));
    expect(justBase.baseOwned).toBe(84);
    expect(justBase.masterOwned).toBe(84);
    expect(justBase.tier).toBe("base");

    const withSomeSecrets = setTiers(PITCH_BLACK, [...range(1, 84), ...range(85, 100)]);
    expect(withSomeSecrets.tier).toBe("base");
  });

  it("awards master only at the full total", () => {
    const oneShort = setTiers(PITCH_BLACK, range(1, 119));
    expect(oneShort.tier).toBe("base");
    expect(completionPercent(oneShort.masterRatio)).toBe(99);

    const all = setTiers(PITCH_BLACK, range(1, 120));
    expect(all.tier).toBe("master");
    expect(completionPercent(all.masterRatio)).toBe(100);
  });

  it("counts non-numeric cards toward master and never toward base", () => {
    // Trainer Gallery / Shiny Vault cards sit outside the printed run.
    const tiers = setTiers({ total: 195, printedTotal: 172 }, [...range(1, 172), "TG01", "TG02"]);
    expect(tiers.baseOwned).toBe(172);
    expect(tiers.masterOwned).toBe(174);
    expect(tiers.tier).toBe("base");
  });
});

describe("setTiers — declining a base tier", () => {
  it("reports one tier when printedTotal is not smaller than total", () => {
    const tiers = setTiers({ total: 102, printedTotal: 102 }, range(1, 102));
    expect(tiers.baseTotal).toBeUndefined();
    expect(tiers.baseOwned).toBe(0);
    expect(tiers.baseRatio).toBeUndefined();
    expect(tiers.tier).toBe("master");
  });

  it("reports one tier when printedTotal is missing entirely", () => {
    const tiers = setTiers({ total: 120 }, range(1, 60));
    expect(tiers.baseTotal).toBeUndefined();
    expect(tiers.masterTotal).toBe(120);
    expect(tiers.tier).toBe("none");
  });

  it("declines for an all-alphanumeric promo set (xyp, smp)", () => {
    // printedTotal 208 < total 211, so the sizes alone would offer a base tier —
    // but no card in the set can ever satisfy the rule, so it would sit at
    // 0 / 208 forever. Only the card numbers can reveal that.
    const promo: SetSizes = { total: 211, printedTotal: 208 };
    const numbers = ["XY01", "XY02", "XY03", "XYP1"];
    expect(setTiers(promo, numbers).baseTotal).toBe(208);
    expect(setTiers(promo, numbers, { setCardNumbers: numbers }).baseTotal).toBeUndefined();
    expect(setTiers(promo, numbers, { setCardNumbers: numbers }).tier).toBe("none");
  });

  it("keeps the base tier when at least one card in the set qualifies", () => {
    const tiers = setTiers(PITCH_BLACK, range(1, 10), { setCardNumbers: range(1, 120) });
    expect(tiers.baseTotal).toBe(84);
  });

  it("ignores an empty setCardNumbers rather than declining on no evidence", () => {
    // A set whose card list has not loaded yet must not lose its base tier.
    expect(setTiers(PITCH_BLACK, range(1, 10), { setCardNumbers: [] }).baseTotal).toBe(84);
  });

  it("declines when the caller only knows how many cards, not which", () => {
    // ownedCountsBySet gives a bare count; guessing a partition from it is the
    // exact bug this function exists to prevent.
    const tiers = setTiers(PITCH_BLACK, 100);
    expect(tiers.masterOwned).toBe(100);
    expect(tiers.baseTotal).toBeUndefined();
    expect(tiers.baseOwned).toBe(0);
    expect(tiers.tier).toBe("none");
  });
});

describe("setTiers — totals come from the set, not from the cards", () => {
  it("keeps master at set.total when the index is short of it", () => {
    // /api/set-information pages at 250 with no pagination: sv8 indexes 250 of
    // 252. Counting cards would call this complete two cards early.
    const tiers = setTiers({ total: 252, printedTotal: 191 }, range(1, 250), {
      setCardNumbers: range(1, 250),
    });
    expect(tiers.masterTotal).toBe(252);
    expect(tiers.tier).toBe("base");
    expect(completionPercent(tiers.masterRatio)).toBe(99);
  });

  it("counts duplicate collector numbers as separate cards", () => {
    // zsv10pt5-80 carries number "60" and collides with a real card 60;
    // cel25c has four cards numbered 15. Distinct numbers would under-count.
    const tiers = setTiers({ total: 200, printedTotal: 100 }, ["60", "60", "15", "15", "15", "15"]);
    expect(tiers.masterOwned).toBe(6);
    expect(tiers.baseOwned).toBe(6);
  });

  it("survives an owned count larger than either total", () => {
    const tiers = setTiers(PITCH_BLACK, [...range(1, 120), ...range(1, 20)]);
    expect(tiers.masterOwned).toBe(140);
    expect(tiers.masterRatio).toBe(1);
    expect(tiers.baseRatio).toBe(1);
    expect(tiers.tier).toBe("master");
  });

  it("handles an empty collection", () => {
    const tiers = setTiers(PITCH_BLACK, []);
    expect(tiers).toMatchObject({ baseOwned: 0, masterOwned: 0, tier: "none" });
    expect(tiers.baseRatio).toBe(0);
  });

  it("has no tier at all when the set's size is unknown", () => {
    const tiers = setTiers({}, range(1, 40));
    expect(tiers.masterTotal).toBeUndefined();
    expect(tiers.baseTotal).toBeUndefined();
    expect(tiers.tier).toBe("none");
  });
});

describe("completionPercent", () => {
  it("floors, so a set three cards short can never print 100", () => {
    expect(completionPercent(0.997)).toBe(99);
    expect(completionPercent(0.999999)).toBe(99);
    expect(completionPercent(1)).toBe(100);
  });

  it("clamps into 0-100 and passes undefined through", () => {
    expect(completionPercent(0)).toBe(0);
    expect(completionPercent(1.4)).toBe(100);
    expect(completionPercent(-0.2)).toBe(0);
    expect(completionPercent(Number.NaN)).toBeUndefined();
    expect(completionPercent(undefined)).toBeUndefined();
  });

  it("agrees with the star: 99% never carries one", () => {
    const tiers = setTiers({ total: 300, printedTotal: 300 }, range(1, 299));
    expect(completionPercent(tiers.masterRatio)).toBe(99);
    expect(tiers.tier).toBe("none");
  });
});
