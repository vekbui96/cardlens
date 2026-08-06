import { describe, expect, it } from "vitest";
import { buildHistory } from "./history.ts";

const DAY = 24 * 60 * 60_000;
const NOW = 1_800_000_000_000;
const daysAgo = (n: number) => NOW - n * DAY;

describe("buildHistory", () => {
  it("is cumulative, not a daily count", () => {
    const h = buildHistory([daysAgo(3), daysAgo(2), daysAgo(1)], "30d", NOW);
    const totals = h.points.map((p) => p.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(h.endTotal).toBe(3);
  });

  it("starts the window at what was already owned, not at zero", () => {
    // Otherwise a 30-day view of a long-standing collection draws a cliff from
    // nothing, which reads as "I bought 900 cards last month".
    const h = buildHistory([daysAgo(400), daysAgo(300), daysAgo(2)], "30d", NOW);
    expect(h.startTotal).toBe(2);
    expect(h.points[0].total).toBe(2);
    expect(h.endTotal).toBe(3);
    expect(h.added).toBe(1);
  });

  it("collapses many marks on one day into one point", () => {
    // A scanning session marks dozens of printings minutes apart; one point per
    // row would be a vertical wall.
    const t = daysAgo(5);
    const h = buildHistory([t, t + 1000, t + 2000, t + 3000], "30d", NOW);
    expect(h.points).toHaveLength(3); // window start, that day, now
    expect(h.endTotal).toBe(4);
  });

  it("folds undated legacy rows into the starting total", () => {
    // Rows migrated from the pre-printing shape carry `at: 0`. Plotted
    // literally they sit in 1970 and squash every real point to the right edge.
    const h = buildHistory([0, 0, daysAgo(1)], "all", NOW);
    expect(h.undated).toBe(2);
    expect(h.startTotal).toBe(2);
    expect(h.endTotal).toBe(3);
    expect(h.points.every((p) => p.t > daysAgo(30))).toBe(true);
  });

  it("clamps a future timestamp to now rather than stretching the axis", () => {
    const h = buildHistory([NOW + 90 * DAY], "30d", NOW);
    expect(h.endTotal).toBe(1);
    expect(Math.max(...h.points.map((p) => p.t))).toBeLessThanOrEqual(NOW);
  });

  it("always reaches today, so a quiet month still draws a line", () => {
    const h = buildHistory([daysAgo(200)], "30d", NOW);
    expect(h.added).toBe(0);
    expect(h.points).toHaveLength(2);
    expect(h.points[0].total).toBe(1);
    expect(h.points[h.points.length - 1].t).toBe(NOW);
  });

  it("handles an empty collection without producing NaN", () => {
    const h = buildHistory([], "all", NOW);
    expect(h.endTotal).toBe(0);
    expect(h.points.every((p) => Number.isFinite(p.t) && Number.isFinite(p.total))).toBe(true);
  });
});
