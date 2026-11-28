import { describe, expect, it } from "vitest";
import type { AddEntry } from "../addmany/applyPlan.ts";
import { planTrade } from "./tradeModel.ts";

const e = (cardId: string, finish = "normal"): AddEntry => ({ cardId, finish, setId: "s", number: "1" });
const ownedSet =
  (...keys: string[]) =>
  (cardId: string, finish: string) =>
    keys.includes(`${cardId}|${finish}`);

describe("planTrade", () => {
  it("removes owned given printings and adds unowned received ones", () => {
    const plan = planTrade([e("a")], [e("b")], ownedSet("a|normal"));
    expect(plan.remove.map((x) => x.cardId)).toEqual(["a"]);
    expect(plan.add.map((x) => x.cardId)).toEqual(["b"]);
  });

  it("does not remove a given printing that is not owned, nor add an owned received one", () => {
    const plan = planTrade([e("a")], [e("b")], ownedSet("b|normal"));
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([]);
  });

  it("lists each printing once", () => {
    const plan = planTrade([e("a"), e("a")], [e("b"), e("b")], ownedSet("a|normal"));
    expect(plan.remove).toHaveLength(1);
    expect(plan.add).toHaveLength(1);
  });

  it("leaves a printing on both sides alone", () => {
    const plan = planTrade([e("a")], [e("a")], ownedSet("a|normal"));
    expect(plan).toEqual({ remove: [], add: [] });
  });

  it("treats finishes as separate printings", () => {
    const plan = planTrade([e("a", "holo")], [e("a", "normal")], ownedSet("a|holo"));
    expect(plan.remove).toHaveLength(1);
    expect(plan.add).toHaveLength(1);
  });
});
