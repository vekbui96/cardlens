import { describe, expect, it } from "vitest";
import { setTiers } from "../../models/setCompletion.ts";
import { compareCompletion, ownedIn, shownRatio, tierLabel, tierRank } from "./completionTier.ts";

const numbers = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

describe("tierLabel", () => {
  it("names each milestone and stays silent about an unfinished set", () => {
    expect(tierLabel("base")).toBe("BASE");
    expect(tierLabel("master")).toBe("MASTER");
    expect(tierLabel("none")).toBeNull();
  });
});

describe("shownRatio", () => {
  it("falls back to master for a set with no separate base tier", () => {
    // Base (102/102): no secrets, so base and master are one achievement.
    const tiers = setTiers({ total: 102, printedTotal: 102 }, numbers(1, 40));
    expect(tiers.baseRatio).toBeUndefined();
    expect(shownRatio(tiers)).toBeCloseTo(40 / 102);
  });

  it("is the base ratio wherever the set has one", () => {
    const tiers = setTiers({ total: 230, printedTotal: 197 }, numbers(1, 100));
    expect(shownRatio(tiers)).toBeCloseTo(100 / 197);
  });
});

describe("compareCompletion", () => {
  const row = (total: number, printedTotal: number, owned: string[]) => ({
    tiers: setTiers({ total, printedTotal }, owned),
    owned: owned.length,
  });

  it("ranks master-complete above base-complete", () => {
    // Both tie at a base ratio of exactly 1.0, which is the whole reason the
    // tier has to lead the comparison rather than the ratio.
    const baseDone = row(230, 197, numbers(1, 197));
    const masterDone = row(80, 73, numbers(1, 80));
    expect(baseDone.tiers.baseRatio).toBe(1);
    expect(masterDone.tiers.baseRatio).toBe(1);
    expect([baseDone, masterDone].sort(compareCompletion)[0]).toBe(masterDone);
  });

  it("does not sink a single-tier set below every set that has a base tier", () => {
    // Base is 40/102 with no base tier; Paldea is 1/193 with one. Ordering on
    // baseRatio alone would put the set at 0.5% above the set at 39%.
    const singleTier = row(102, 102, numbers(1, 40));
    const barelyStarted = row(279, 193, numbers(1, 1));
    expect([barelyStarted, singleTier].sort(compareCompletion)[0]).toBe(singleTier);
  });

  /**
   * The ordering change itself. Ranking on the master tier — which is what
   * every list did before — buries the set that is three commons short of its
   * printed run behind one that is half-finished but has few secrets.
   */
  it("orders unfinished sets by the BASE run, not the master total", () => {
    // 190/193 base (98%), but only 190/900 master (21%).
    const nearlyBaseDone = row(900, 193, numbers(1, 190));
    // 120/240 base (50%), and 120/250 master (48%) — higher on master alone.
    const halfway = row(250, 240, numbers(1, 120));
    expect(nearlyBaseDone.tiers.masterRatio).toBeLessThan(halfway.tiers.masterRatio ?? 0);
    expect([halfway, nearlyBaseDone].sort(compareCompletion)[0]).toBe(nearlyBaseDone);
  });

  it("has master and owned as tie-breaks under a shared base ratio", () => {
    const fewerSecrets = row(230, 197, numbers(1, 197));
    const moreSecrets = row(230, 197, [...numbers(1, 197), "198", "199"]);
    expect([fewerSecrets, moreSecrets].sort(compareCompletion)[0]).toBe(moreSecrets);
  });
});

describe("tierRank", () => {
  it("is ordered none < base < master", () => {
    expect(tierRank("none")).toBeLessThan(tierRank("base"));
    expect(tierRank("base")).toBeLessThan(tierRank("master"));
  });
});

describe("ownedIn", () => {
  it("hands over the numbers when the library has one for every owned card", () => {
    expect(ownedIn("sv3", { sv3: ["1", "2", "3"] }, 3)).toEqual(["1", "2", "3"]);
  });

  it("falls back to the count when the set has no numbers at all", () => {
    expect(ownedIn("sv3", {}, 12)).toBe(12);
  });

  /**
   * The regression this guard exists for. `ownedNumbersBySet` omits any card
   * whose number is unknown — right, and also the MASTER numerator inside
   * `setTiers`. A collection marked before numbers were recorded would hand over
   * three numbers for a set holding two hundred cards, and the master figure
   * would collapse from 197/230 to 3/230.
   */
  it("refuses a short list rather than shrinking the master figure", () => {
    const short = ownedIn("sv3", { sv3: ["1", "2", "3"] }, 197);
    expect(short).toBe(197);
    const tiers = setTiers({ total: 230, printedTotal: 197 }, short);
    expect(tiers.masterOwned).toBe(197);
    expect(tiers.baseTotal).toBeUndefined();
  });
});
