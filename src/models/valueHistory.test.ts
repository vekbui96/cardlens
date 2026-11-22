import { describe, expect, it } from "vitest";
import {
  buildValueSeries,
  coverageLine,
  localToday,
  parseValueHistory,
  type ValueRow,
} from "./valueHistory.ts";

function row(day: string, total: number, extra: Partial<ValueRow> = {}): ValueRow {
  return { day, total, priced: 400, printings: 480, currency: "USD", ...extra };
}

const TODAY = "2026-11-21";

describe("buildValueSeries", () => {
  it("breaks the line at a day where nothing was priced, and never joins across it", () => {
    const series = buildValueSeries(
      [
        row("2026-11-17", 100),
        row("2026-11-18", 110),
        row("2026-11-19", 0, { priced: 0 }),
        row("2026-11-20", 130),
        row("2026-11-21", 140),
      ],
      "7d",
      TODAY,
    );
    expect(series.segments.map((s) => s.map((p) => p.day))).toEqual([
      ["2026-11-17", "2026-11-18"],
      ["2026-11-20", "2026-11-21"],
    ]);
    // The unpriced day is not a zero on the axis either.
    expect(series.points.map((p) => p.total)).not.toContain(0);
    expect(series.min).toBe(100);
  });

  it("treats a missing day as a gap rather than interpolating it", () => {
    const series = buildValueSeries([row("2026-11-18", 100), row("2026-11-20", 120)], "7d", TODAY);
    expect(series.points).toHaveLength(2);
    expect(series.segments).toHaveLength(2);
    expect(series.points.find((p) => p.day === "2026-11-19")).toBeUndefined();
  });

  it("cuts the window at 7, 30 and 90 days, today included", () => {
    const rows = [row("2026-08-23", 1), row("2026-08-24", 2), row("2026-10-23", 3), row("2026-11-15", 4)];
    rows.push(row("2026-10-22", 5), row("2026-11-14", 6), row(TODAY, 7));

    const week = buildValueSeries(rows, "7d", TODAY);
    expect(week.days).toBe(7);
    expect(week.start).toBe("2026-11-15");
    expect(week.points.map((p) => p.day)).toEqual(["2026-11-15", TODAY]);
    expect(week.points.map((p) => p.index)).toEqual([0, 6]);

    const month = buildValueSeries(rows, "30d", TODAY);
    expect(month.start).toBe("2026-10-23");
    expect(month.points.map((p) => p.day)).toEqual(["2026-10-23", "2026-11-14", "2026-11-15", TODAY]);

    const quarter = buildValueSeries(rows, "90d", TODAY);
    expect(quarter.start).toBe("2026-08-24");
    expect(quarter.points[0].day).toBe("2026-08-24");
    expect(quarter.points).toHaveLength(6);
  });

  it("drops rows in another currency instead of plotting them on the same axis", () => {
    const series = buildValueSeries(
      [row("2026-11-19", 100), row("2026-11-20", 9000, { currency: "EUR" }), row(TODAY, 105)],
      "7d",
      TODAY,
    );
    expect(series.points.map((p) => p.day)).toEqual(["2026-11-19", TODAY]);
    expect(series.segments).toHaveLength(2);
    expect(series.max).toBe(105);
  });

  it("ignores rows after today", () => {
    const series = buildValueSeries([row(TODAY, 100), row("2026-11-22", 200)], "7d", TODAY);
    expect(series.points.map((p) => p.day)).toEqual([TODAY]);
  });

  it("keeps a single point as a one-point segment with its value", () => {
    const series = buildValueSeries([row(TODAY, 7172.64, { priced: 2184, printings: 2363 })], "30d", TODAY);
    expect(series.segments).toEqual([[expect.objectContaining({ day: TODAY, total: 7172.64, index: 29 })]]);
    expect(series.latest?.total).toBe(7172.64);
    expect(series.min).toBe(7172.64);
    expect(series.max).toBe(7172.64);
  });

  it("is empty, not broken, with no rows", () => {
    const series = buildValueSeries([], "30d", TODAY);
    expect(series.points).toEqual([]);
    expect(series.segments).toEqual([]);
    expect(series.latest).toBeNull();
  });

  it("crosses month and year ends by calendar day", () => {
    const series = buildValueSeries(
      [row("2026-12-31", 1), row("2027-01-01", 2), row("2027-01-02", 3)],
      "7d",
      "2027-01-02",
    );
    expect(series.segments).toHaveLength(1);
    expect(series.points.map((p) => p.index)).toEqual([4, 5, 6]);
  });
});

describe("parseValueHistory", () => {
  it("reads the server's version 1 body", () => {
    const rows = parseValueHistory({
      version: 1,
      rows: [
        {
          day: "2026-11-21",
          total: 7172.64,
          priced: 2184,
          printings: 2363,
          cards: 2001,
          currency: "USD",
          at: 1,
        },
      ],
    });
    expect(rows).toEqual([
      { day: "2026-11-21", total: 7172.64, priced: 2184, printings: 2363, currency: "USD" },
    ]);
  });

  it("treats an unknown version or a malformed body as no history", () => {
    expect(parseValueHistory({ version: 2, rows: [] })).toBeNull();
    expect(parseValueHistory({ version: 1 })).toBeNull();
    expect(parseValueHistory([])).toBeNull();
    expect(parseValueHistory(null)).toBeNull();
    expect(parseValueHistory("nope")).toBeNull();
  });

  it("drops rows that are off and keeps the rest", () => {
    const good = { day: "2026-11-20", total: 10, priced: 1, printings: 2, currency: "USD" };
    const rows = parseValueHistory({
      version: 1,
      rows: [
        good,
        { ...good, day: "2026-02-31" },
        { ...good, day: "yesterday" },
        { ...good, total: -1 },
        { ...good, priced: 3 },
        { ...good, currency: "" },
        null,
      ],
    });
    expect(rows).toEqual([good]);
  });
});

describe("coverageLine", () => {
  it("states the coverage of a day", () => {
    expect(coverageLine({ priced: 412, printings: 480 })).toBe("412 of 480 printings priced");
    expect(coverageLine({ priced: 2184, printings: 2363 })).toBe("2,184 of 2,363 printings priced");
    expect(coverageLine({ priced: 5, printings: 5 })).toBe("All 5 printings priced");
  });
});

describe("localToday", () => {
  it("formats this device's calendar day", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
