import { describe, expect, it } from "vitest";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { mostValuable, valueBySet } from "./insights.ts";

const row = (n: number, price?: number, finish = "normal", setId = "s1"): OwnedPrintingRow => ({
  cardId: `${setId}-${n}`,
  setId,
  setName: `Set ${setId}`,
  name: `Card ${n}`,
  collectorNumber: String(n),
  finish,
  at: 0,
  ...(price !== undefined ? { price } : {}),
});

describe("mostValuable", () => {
  it("ranks priced printings by price, highest first, and caps the list", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, (i + 1) * 10));
    const { top } = mostValuable(rows);
    expect(top).toHaveLength(10);
    expect(top[0]?.row.cardId).toBe("s1-12");
    expect(top[9]?.row.cardId).toBe("s1-3");
  });

  it("leaves unpriced printings out of the ranking and the total, and counts them", () => {
    const result = mostValuable([row(1, 100), row(2), row(3, 0), row(4, 100)]);
    expect(result.top.map((t) => t.row.cardId)).toEqual(["s1-1", "s1-4"]);
    expect(result.unpriced).toBe(2);
    expect(result.priced).toBe(2);
    expect(result.top[0]?.sharePct).toBe(50);
  });

  it("states the top cards' share of the total value", () => {
    // 10 cards of 10 plus two of 1: top 10 = 100 of 102.
    const rows = [...Array.from({ length: 10 }, (_, i) => row(i + 1, 10)), row(11, 1), row(12, 1)];
    expect(mostValuable(rows).concentrationPct).toBe(98);
  });

  it("is 100% when everything fits in the list", () => {
    expect(mostValuable([row(1, 5), row(2, 5)]).concentrationPct).toBe(100);
  });

  it("has no concentration when nothing is priced, and none for an empty collection", () => {
    expect(mostValuable([row(1)])).toMatchObject({ top: [], concentrationPct: null, unpriced: 1 });
    expect(mostValuable([])).toMatchObject({ top: [], concentrationPct: null, unpriced: 0, priced: 0 });
  });

  it("breaks price ties by collector number so the order is stable", () => {
    const { top } = mostValuable([row(10, 5), row(2, 5), row(1, 5)]);
    expect(top.map((t) => t.row.collectorNumber)).toEqual(["1", "2", "10"]);
  });
});

describe("valueBySet", () => {
  it("groups priced printings by set, biggest first, with whole-percent shares", () => {
    const rows = [row(1, 60, "normal", "a"), row(2, 20, "normal", "a"), row(1, 20, "normal", "b")];
    const { sets } = valueBySet(rows);
    expect(sets.map((s) => [s.setId, s.worth, s.sharePct])).toEqual([
      ["a", 80, 80],
      ["b", 20, 20],
    ]);
  });

  it("counts unpriced printings per set without valuing them", () => {
    const rows = [row(1, 10, "normal", "a"), row(2, undefined, "normal", "a"), row(3, 0, "normal", "a")];
    const { sets, unpriced } = valueBySet(rows);
    expect(sets[0]).toMatchObject({ worth: 10, unpriced: 2, priced: 1 });
    expect(unpriced).toBe(2);
  });

  it("keeps a set with only unpriced cards, at the end, with no share", () => {
    const { sets } = valueBySet([row(1, 5, "normal", "a"), row(1, undefined, "normal", "z")]);
    expect(sets.map((s) => s.setId)).toEqual(["a", "z"]);
    expect(sets[1]).toMatchObject({ worth: 0, sharePct: 0, unpriced: 1 });
  });

  it("states the top three sets' share, and is 100% with one set", () => {
    const rows = [10, 10, 10, 10].map((p, i) => row(1, p, "normal", `s${i}`));
    expect(valueBySet(rows).topShare).toEqual({ count: 3, pct: 75 });
    expect(valueBySet([row(1, 4, "normal", "a")]).topShare).toEqual({ count: 1, pct: 100 });
  });

  it("has no top share when nothing is priced", () => {
    expect(valueBySet([row(1)]).topShare).toBeNull();
    expect(valueBySet([]).sets).toEqual([]);
  });

  it("breaks worth ties by set id", () => {
    const { sets } = valueBySet([row(1, 5, "normal", "b"), row(1, 5, "normal", "a")]);
    expect(sets.map((s) => s.setId)).toEqual(["a", "b"]);
  });
});
