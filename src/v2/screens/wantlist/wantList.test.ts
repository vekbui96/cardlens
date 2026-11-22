import { describe, expect, it } from "vitest";
import type { Printing } from "../../../integrations/tcgdex/client.ts";
import { buildPrintingIndex } from "../../../models/printingIndex.ts";
import { homeFinishParts } from "../home/finishLine.ts";
import { sumWant, wantForSet, wantHeadline, wantSetLine } from "./wantList.ts";

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

const want = (owned: string[], raw: Record<string, Printing[]> | null) =>
  wantForSet(owned, buildPrintingIndex(raw));

describe("wantForSet", () => {
  it("lists a partial set's missing cards at their cheapest printing, unpriced ones apart", () => {
    const set = want(["1"], sv1);
    expect(set?.cards).toEqual([
      { collectorNumber: "2", finish: "normal", price: 2.5 },
      { collectorNumber: "3", finish: "normal", price: null },
      { collectorNumber: "4", finish: "normal", price: 0.4 },
    ]);
    expect(set).toMatchObject({ missing: 3, priced: 2, unpriced: 1, total: 2.9 });
  });

  it("has nothing to list for a finished set", () => {
    expect(want(["1", "2", "3", "4"], sv1)).toMatchObject({ cards: [], missing: 0, total: 0 });
  });

  it("counts a zero price as unpriced and never guesses", () => {
    expect(want(["1", "2"], sv2)).toMatchObject({ missing: 1, priced: 0, unpriced: 1, total: 0 });
  });

  it("matches padded printings against unpadded owned numbers", () => {
    expect(want(["1"], sv2)?.cards.map((c) => c.collectorNumber)).toEqual(["002", "003"]);
  });

  it("returns null, not a guess, when the printings are not known", () => {
    expect(want(["1"], null)).toBeNull();
  });

  it("sums only USD prices: a EUR average on a printing never enters the total", () => {
    const withEur: Record<string, Printing[]> = {
      "1": [{ type: "normal", price: 2, eur: { avg1: 99, avg7: 99, avg30: 99 } } as Printing],
    };
    expect(want(["9"], withEur)?.total).toBe(2);
  });
});

describe("sumWant", () => {
  it("is empty for no sets", () => {
    expect(sumWant([])).toEqual({ sets: 0, missing: 0, priced: 0, unpriced: 0, total: 0 });
  });

  it("leaves out unknown and finished sets", () => {
    const totals = sumWant([null, want(["1", "2", "3", "4"], sv1), want(["1"], sv2)]);
    expect(totals).toEqual({ sets: 1, missing: 2, priced: 1, unpriced: 1, total: 3.1 });
  });

  it("agrees with Home's finishing lines for the same sets", () => {
    const totals = sumWant([want(["1"], sv1), want(["001"], sv2)]);
    const lines = [
      homeFinishParts({ cards: 1, total: 4, ownedNumbers: ["1"], byNumber: sv1 }),
      homeFinishParts({ cards: 1, total: 3, ownedNumbers: ["001"], byNumber: sv2 }),
    ];
    expect(totals.missing).toBe(lines.reduce((n, p) => n + (p?.toGo ?? 0), 0));
    expect(totals.priced).toBe(lines.reduce((n, p) => n + (p?.priced ?? 0), 0));
    expect(totals.total).toBe(Math.round(lines.reduce((n, p) => n + (p?.total ?? 0), 0) * 100) / 100);
  });
});

describe("wording", () => {
  it("says what finishing would take, unpriced cards stated apart", () => {
    expect(wantHeadline({ sets: 2, missing: 5, priced: 4, unpriced: 1, total: 6.2 })).toBe(
      "To finish: 5 cards missing across 2 sets, 4 priced, about $6.20, 1 unpriced",
    );
    expect(wantHeadline({ sets: 1, missing: 1, priced: 1, unpriced: 0, total: 3 })).toBe(
      "To finish: 1 card missing across 1 set, 1 priced, about $3.00",
    );
    expect(wantHeadline({ sets: 1, missing: 2, priced: 0, unpriced: 2, total: 0 })).toBe(
      "To finish: 2 cards missing across 1 set, none priced",
    );
  });

  it("never reads $0.00 for a set nothing prices", () => {
    expect(wantSetLine({ cards: [], missing: 2, priced: 0, unpriced: 2, total: 0 })).toBe(
      "2 missing, none priced",
    );
    expect(wantSetLine({ cards: [], missing: 3, priced: 2, unpriced: 1, total: 2.9 })).toBe(
      "3 missing, about $2.90, 1 unpriced",
    );
  });
});
