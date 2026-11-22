import { describe, expect, it } from "vitest";
import type { Printing } from "../../../integrations/tcgdex/client.ts";
import { homeFinishParts } from "../home/finishLine.ts";
import { buildWantList, type WantSetInput } from "./wantList.ts";

const sv1: Record<string, Printing[]> = {
  "1": [{ type: "normal", price: 1 }],
  "2": [
    { type: "normal", price: 2.5 },
    { type: "holo", price: 9 },
  ],
  "3": [{ type: "normal" }],
  "4": [{ type: "normal", price: 0.4 }],
};
const sv2: Record<string, Printing[]> = {
  "001": [{ type: "normal", price: 0.25 }],
  "002": [{ type: "normal", price: 3.1 }],
  "003": [{ type: "normal", price: 0 }],
};

const input = (
  setId: string,
  ownedNumbers: string[],
  byNumber: Record<string, Printing[]> | null,
): WantSetInput => ({
  setId,
  ownedNumbers,
  byNumber,
});

describe("buildWantList", () => {
  it("is empty for an empty collection", () => {
    expect(buildWantList([])).toEqual({
      sets: [],
      missing: 0,
      priced: 0,
      unpriced: 0,
      total: 0,
      unknownSets: [],
    });
  });

  it("skips a set with nothing owned", () => {
    const list = buildWantList([input("sv1", [], sv1), input("sv2", ["1"], sv2)]);
    expect(list.sets.map((s) => s.setId)).toEqual(["sv2"]);
  });

  it("lists a partial set's missing cards at their cheapest printing, unpriced ones apart", () => {
    const list = buildWantList([input("sv1", ["1"], sv1)]);
    expect(list.sets).toHaveLength(1);
    expect(list.sets[0]!.cards).toEqual([
      { collectorNumber: "2", finish: "normal", price: 2.5 },
      { collectorNumber: "3", finish: "normal", price: null },
      { collectorNumber: "4", finish: "normal", price: 0.4 },
    ]);
    expect(list.sets[0]).toMatchObject({ missing: 3, priced: 2, unpriced: 1, total: 2.9 });
  });

  it("leaves a finished set out", () => {
    const list = buildWantList([input("sv1", ["1", "2", "3", "4"], sv1)]);
    expect(list.sets).toEqual([]);
    expect(list.missing).toBe(0);
  });

  it("counts a zero price as unpriced and never guesses", () => {
    const list = buildWantList([input("sv2", ["1", "2"], sv2)]);
    expect(list.sets[0]).toMatchObject({ missing: 1, priced: 0, unpriced: 1, total: 0 });
  });

  it("matches padded owned numbers against unpadded printings", () => {
    const list = buildWantList([input("sv2", ["001"], sv2)]);
    expect(list.sets[0]!.cards.map((c) => c.collectorNumber)).toEqual(["002", "003"]);
  });

  it("reports an owned set whose printings are not cached instead of guessing", () => {
    const list = buildWantList([input("sv1", ["1"], null), input("sv2", ["001"], sv2)]);
    expect(list.unknownSets).toEqual(["sv1"]);
    expect(list.sets.map((s) => s.setId)).toEqual(["sv2"]);
  });

  it("sums only USD prices: a EUR average on a printing never enters the total", () => {
    const withEur: Record<string, Printing[]> = {
      "1": [{ type: "normal", price: 2, eur: { avg1: 99, avg7: 99, avg30: 99 } } as Printing],
    };
    expect(buildWantList([input("x", [], withEur), input("y", ["9"], withEur)]).total).toBe(2);
  });

  it("cross-set total equals the sum of the per-set finishing lines", () => {
    const sets = [input("sv1", ["1"], sv1), input("sv2", ["001"], sv2)];
    const list = buildWantList(sets);
    const lines = [
      homeFinishParts({ cards: 1, total: 4, ownedNumbers: ["1"], byNumber: sv1 }),
      homeFinishParts({ cards: 1, total: 3, ownedNumbers: ["001"], byNumber: sv2 }),
    ];
    expect(list.missing).toBe(lines.reduce((n, p) => n + (p?.toGo ?? 0), 0));
    expect(list.priced).toBe(lines.reduce((n, p) => n + (p?.priced ?? 0), 0));
    expect(list.total).toBe(Math.round(lines.reduce((n, p) => n + (p?.total ?? 0), 0) * 100) / 100);
    expect(list.unpriced).toBe(list.missing - list.priced);
    expect(list.sets.reduce((n, s) => n + s.total, 0)).toBeCloseTo(list.total, 2);
  });
});
