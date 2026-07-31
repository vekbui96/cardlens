import { describe, expect, it } from "vitest";
import { valueCollection, type ValuableRow } from "./value.ts";

const row = (cardId: string, finish: string, setId = "me5"): ValuableRow => ({ cardId, setId, finish });

describe("valueCollection", () => {
  it("values each printing separately, not each card", () => {
    // A reverse is routinely worth several times the normal of the same card,
    // so one headline price per card would be wrong in both directions.
    const rows = [row("me5-1", "normal"), row("me5-1", "reverse")];
    const prices: Record<string, number> = { normal: 0.09, reverse: 0.18 };

    const v = valueCollection(rows, (r) => prices[r.finish]);

    expect(v.total).toBeCloseTo(0.27);
    expect(v.printings).toBe(2);
  });

  it("counts unpriced printings rather than treating them as free", () => {
    // Pattern foils have no separate price upstream. Counting them as 0 would
    // read as "worthless" when it means "unknown".
    const rows = [row("me5-1", "normal"), row("me5-2", "reverse:pokeball")];

    const v = valueCollection(rows, (r) => (r.finish === "normal" ? 1.5 : undefined));

    expect(v.total).toBe(1.5);
    expect(v.priced).toBe(1);
    expect(v.unpriced).toBe(1);
  });

  it("ignores a zero or negative price rather than banking it", () => {
    const v = valueCollection([row("me5-1", "normal"), row("me5-2", "normal")], (r) =>
      r.cardId === "me5-1" ? 0 : -3,
    );
    expect(v.total).toBe(0);
    expect(v.priced).toBe(0);
    expect(v.unpriced).toBe(2);
  });

  it("splits by set and orders most valuable first", () => {
    const rows = [
      row("me5-1", "normal", "me5"),
      row("me2-1", "normal", "me2"),
      row("me2-2", "normal", "me2"),
    ];
    const v = valueCollection(rows, (r) => (r.setId === "me2" ? 10 : 1));

    expect(v.bySet.map((s) => s.setId)).toEqual(["me2", "me5"]);
    expect(v.bySet[0]).toEqual({ setId: "me2", printings: 2, priced: 2, value: 20 });
    expect(v.total).toBe(21);
  });

  it("reports a set with no pricing at all without hiding what is held", () => {
    // Pitch Black returns no pricing from pokemontcg.io whatsoever, so this is
    // the normal case for a whole set, not an edge case.
    const rows = [row("me5-1", "normal"), row("me5-2", "reverse")];

    const v = valueCollection(rows, () => undefined);

    expect(v.total).toBe(0);
    expect(v.bySet[0]).toEqual({ setId: "me5", printings: 2, priced: 0, value: 0 });
    expect(v.unpriced).toBe(2);
  });

  it("is empty-safe", () => {
    expect(valueCollection([], () => 1)).toEqual({
      total: 0,
      bySet: [],
      printings: 0,
      priced: 0,
      unpriced: 0,
    });
  });
});
