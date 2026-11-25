import { describe, expect, it } from "vitest";
import { asOwned, planAdd, type AddEntry } from "./applyPlan.ts";

const e = (n: string, finish: AddEntry["finish"] = "normal"): AddEntry => ({
  cardId: `sv3-${n}`,
  finish,
  setId: "sv3",
  number: n,
});

/** A stand-in for the collection: the same on/off semantics as setOwnedMany. */
function fakeCollection(start: string[]) {
  const owned = new Set(start);
  return {
    owned,
    has: (id: string, f: string) => owned.has(`${id}|${f}`),
    apply: (entries: { cardId: string; finish: string; owned: boolean }[]) => {
      for (const x of entries) {
        const k = `${x.cardId}|${x.finish}`;
        if (x.owned) owned.add(k);
        else owned.delete(k);
      }
    },
  };
}

describe("planAdd", () => {
  it("add then Undo returns the collection to its starting state", () => {
    const c = fakeCollection(["sv3-126|normal"]);
    const before = [...c.owned].sort();
    const plan = planAdd([e("125"), e("126"), e("127", "holo")], c.has);
    expect(plan.map((p) => p.number)).toEqual(["125", "127"]);
    c.apply(asOwned(plan, true));
    expect(c.has("sv3-125", "normal")).toBe(true);
    c.apply(asOwned(plan, false));
    expect([...c.owned].sort()).toEqual(before);
  });

  it("adding the same list twice is idempotent", () => {
    const c = fakeCollection([]);
    const list = [e("125"), e("125"), e("126")];
    c.apply(asOwned(planAdd(list, c.has), true));
    const once = [...c.owned].sort();
    expect(planAdd(list, c.has)).toEqual([]);
    c.apply(asOwned(planAdd(list, c.has), true));
    expect([...c.owned].sort()).toEqual(once);
  });
});
