import { describe, expect, it } from "vitest";
import { costToFinish, costToFinishLabel } from "./costToFinish.ts";

const price = (table: Record<string, number>) => (n: string, f: string) => table[`${n}:${f}`];

const slot = (collectorNumber: string, finish: string, held = false, excluded = false) => ({
  collectorNumber,
  finish,
  held,
  excluded,
});

describe("costToFinish", () => {
  it("sums every missing printing when all are priced", () => {
    const slots = [slot("1", "normal"), slot("2", "normal")];
    expect(costToFinish(slots, price({ "1:normal": 1.5, "2:normal": 2.25 }))).toEqual({
      missing: 2,
      priced: 2,
      total: 3.75,
    });
  });

  it("counts unpriced printings but never gives them a number", () => {
    const slots = [slot("1", "normal"), slot("2", "normal"), slot("3", "normal")];
    expect(costToFinish(slots, price({ "1:normal": 4 }))).toEqual({ missing: 3, priced: 1, total: 4 });
  });

  it("reports no total when nothing missing is priced", () => {
    expect(costToFinish([slot("1", "normal")], price({}))).toEqual({ missing: 1, priced: 0, total: 0 });
  });

  it("leaves out held and excluded printings", () => {
    const slots = [slot("1", "normal", true), slot("2", "normal", false, true), slot("3", "normal")];
    const p = price({ "1:normal": 10, "2:normal": 20, "3:normal": 5 });
    expect(costToFinish(slots, p)).toEqual({ missing: 1, priced: 1, total: 5 });
  });

  it("does not drift on float sums", () => {
    const slots = [slot("1", "normal"), slot("2", "normal"), slot("3", "normal")];
    const p = price({ "1:normal": 0.1, "2:normal": 0.2, "3:normal": 0.3 });
    expect(costToFinish(slots, p).total).toBe(0.6);
  });
});

describe("costToFinishLabel", () => {
  it("says nothing when nothing is missing", () => {
    expect(costToFinishLabel({ missing: 0, priced: 0, total: 0 })).toBeNull();
  });

  it("states the price coverage with the total", () => {
    expect(costToFinishLabel({ missing: 12, priced: 9, total: 48 })).toBe(
      "To finish: 12 printings missing, 9 priced, about $48.00",
    );
  });

  it("gives no dollar figure when nothing is priced", () => {
    expect(costToFinishLabel({ missing: 1, priced: 0, total: 0 })).toBe(
      "To finish: 1 printing missing, none priced",
    );
  });
});
