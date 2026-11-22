import { describe, expect, it } from "vitest";
import { aggregateMovement, formatPct, MIN_HOLDINGS, topMovers, type EurAverages } from "./movement.ts";

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

describe("topMovers", () => {
  const row = (id: string, avg7: number, avg1: number, withEur = true) => ({
    id,
    ...(withEur ? { eur: s(avg1, avg7) } : {}),
  });
  const ids = (m: { row: { id: string } }[]) => m.map((x) => x.row.id);

  it("never ranks rounding noise: EUR 0.03 -> 0.05 is below the floor", () => {
    const m = topMovers([
      row("noise", 0.03, 0.05),
      row("a", 2, 3),
      row("b", 2, 2.5),
      row("c", 2, 1.5),
      row("d", 2, 1.2),
    ]);
    expect(ids(m.risers)).toEqual(["a", "b"]);
    expect(ids(m.fallers)).toEqual(["d", "c"]);
  });

  it("requires BOTH averages at the floor", () => {
    const m = topMovers([
      row("low1", 5, 0.9),
      row("low7", 0.9, 5),
      row("edge", 1, 1.2),
      row("up", 2, 3),
      row("dn1", 4, 2),
      row("dn2", 4, 3),
    ]);
    expect(ids(m.risers)).toEqual(["up", "edge"]);
    expect(ids(m.fallers)).toEqual(["dn1", "dn2"]);
  });

  it("orders by size of move and keeps input order on a tie", () => {
    const m = topMovers([row("t1", 10, 11), row("big", 10, 15), row("t2", 10, 11), row("small", 10, 10.5)]);
    expect(ids(m.risers)).toEqual(["big", "t1", "t2"]);
    expect(m.fallers).toEqual([]);
  });

  it("shows at most three per side, biggest falls first", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(`f${n}`, 10, 10 - n));
    expect(ids(topMovers(rows).fallers)).toEqual(["f5", "f4", "f3"]);
  });

  it("shows no side with fewer than two qualifying cards", () => {
    const m = topMovers([row("only", 5, 6), row("d1", 5, 4), row("d2", 5, 3)]);
    expect(m.risers).toEqual([]);
    expect(ids(m.fallers)).toEqual(["d2", "d1"]);
  });

  it("skips cards without averages, flat cards and an avg7 of 0", () => {
    const m = topMovers([
      row("none", 0, 0, false),
      row("zero", 0, 5),
      row("flat", 5, 5),
      row("tiny", 5, 5.001),
    ]);
    expect(m).toEqual({ risers: [], fallers: [] });
  });

  describe("30-day window", () => {
    const r30 = (id: string, avg1: number, avg30: number, avg7 = avg1) => ({
      id,
      eur: s(avg1, avg7, avg30),
    });

    it("ranks avg1 against avg30, not avg7", () => {
      const m = topMovers(
        [r30("up", 12, 8), r30("up2", 12, 10), r30("dn", 5, 10), r30("dn2", 8, 10), r30("flat", 6, 6)],
        30,
      );
      expect(ids(m.risers)).toEqual(["up", "up2"]);
      expect(ids(m.fallers)).toEqual(["dn", "dn2"]);
      expect(m.risers[0]?.pct).toBeCloseTo(50, 5);
    });

    it("applies the floor to avg30 as well as avg1, and ignores avg7", () => {
      const m = topMovers(
        [r30("low30", 5, 0.9), r30("low1", 0.9, 5), r30("low7ok", 3, 2, 0.1), r30("a", 3, 2), r30("b", 4, 2)],
        30,
      );
      expect(ids(m.risers)).toEqual(["b", "low7ok", "a"]);
    });

    it("defaults to the 7-day window", () => {
      const rows = [r30("a", 12, 1, 10), r30("b", 11, 1, 10)];
      expect(ids(topMovers(rows).risers)).toEqual(["a", "b"]);
      expect(topMovers(rows, 30).risers[0]?.pct).toBeCloseTo(1100, 5);
    });
  });

  it("returns percentages only, never an EUR amount", () => {
    const m = topMovers([row("a", 10, 12), row("b", 10, 11)]);
    expect(m.risers.map((x) => x.pct)).toEqual([20, 10].map((p) => expect.closeTo(p, 5)));
    expect(Object.keys(m.risers[0] as object).sort()).toEqual(["pct", "row"]);
  });
});
