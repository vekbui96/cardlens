import { describe, expect, it } from "vitest";
import { aggregateMovement, formatPct, MIN_HOLDINGS, type EurAverages } from "./movement.ts";

const s = (avg1: number, avg7: number, avg30 = avg7): EurAverages => ({ avg1, avg7, avg30 });
const many = (n: number, one: EurAverages) => Array.from({ length: n }, () => one);

describe("aggregateMovement", () => {
  it("reports nothing from a single holding", () => {
    // The measured failure this exists to prevent: me05-014 went EUR 0.04 -> 0.02,
    // one rounding step, which as a per-card figure reads as a 50% crash.
    const m = aggregateMovement([s(0.02, 0.04)]);

    expect(m.pct7).toBeUndefined();
    expect(m.contributing).toBe(1);
  });

  it("stays silent below the holdings floor", () => {
    const m = aggregateMovement(many(MIN_HOLDINGS - 1, s(0.04, 0.03)));
    expect(m.pct7).toBeUndefined();
  });

  it("reports once enough holdings contribute", () => {
    const m = aggregateMovement(many(MIN_HOLDINGS, s(0.033, 0.03)));

    expect(m.contributing).toBe(MIN_HOLDINGS);
    expect(m.pct7).toBeCloseTo(10, 5);
  });

  it("weights by value, so a dear card moves the total more than a cheap one", () => {
    // 100 flat cards at 1.00, plus one card that doubled from 10 to 20.
    const series = [...many(100, s(1, 1)), s(20, 10)];

    const m = aggregateMovement(series);

    // 120 now against 110 then.
    expect(m.pct7).toBeCloseTo((10 / 110) * 100, 5);
  });

  it("skips holdings with no series rather than counting them as zero", () => {
    const series = [...many(MIN_HOLDINGS, s(0.033, 0.03)), undefined, undefined];

    const m = aggregateMovement(series);

    expect(m.contributing).toBe(MIN_HOLDINGS);
    expect(m.pct7).toBeCloseTo(10, 5);
  });

  it("reports 30-day movement independently of 7-day", () => {
    const m = aggregateMovement(many(MIN_HOLDINGS, s(1.2, 1.0, 2.0)));

    expect(m.pct7).toBeCloseTo(20, 5);
    expect(m.pct30).toBeCloseTo(-40, 5);
  });

  it("is empty-safe and never divides by zero", () => {
    expect(aggregateMovement([])).toEqual({ contributing: 0 });
    expect(aggregateMovement(many(MIN_HOLDINGS, s(1, 0, 0))).pct7).toBeUndefined();
  });
});

describe("formatPct", () => {
  it("signs a gain and a loss", () => {
    expect(formatPct(3.24)).toBe("+3.2%");
    // A real minus sign: a hyphen reads as a list bullet at a glance.
    expect(formatPct(-1.78)).toBe("−1.8%");
  });

  it("does not sign a value that rounds to nothing", () => {
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPct(0.01)).toBe("0.0%");
    expect(formatPct(-0.02)).toBe("0.0%");
  });
});
