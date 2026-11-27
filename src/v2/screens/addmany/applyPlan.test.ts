import { describe, expect, it } from "vitest";
import { asOwned, planAdd, summarisePreview, type AddEntry } from "./applyPlan.ts";

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

describe("summarisePreview", () => {
  const p = (n: string, price?: number): AddEntry => ({ ...e(n), ...(price === undefined ? {} : { price }) });
  const none = () => false;

  it("counts cards to add, their value and the lines not recognised", () => {
    const list = [p("125", 90.1), p("126", 9.49)];
    expect(summarisePreview(list, planAdd(list, none), 3)).toBe("2 cards to add · $99.59 · 3 not recognised");
  });

  it("leaves an unpriced card out of the sum and says so", () => {
    const list = [p("125", 90.1), p("126")];
    expect(summarisePreview(list, planAdd(list, none), 0)).toBe("2 cards to add · $90.10 · 1 unpriced");
  });

  it("shows no value when nothing is priced, and counts owned cards apart", () => {
    const list = [p("125"), p("126", 5)];
    const owned = (id: string) => id === "sv3-126";
    expect(summarisePreview(list, planAdd(list, owned), 0)).toBe("1 card to add · 1 already owned");
  });
});

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
