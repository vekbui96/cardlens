import { describe, expect, it } from "vitest";
import type { PokemonSet } from "../../../models/cards.ts";
import { groupSets, matchesQuery, summaryLine } from "./setGroups.ts";

/**
 * The decisions, not the markup.
 *
 * Which group a set lands in, and what "closest to finished" means, are the
 * only things on this screen that can be wrong in a way a reader would not
 * notice. A row's class names cannot.
 */

const set = (over: Partial<PokemonSet> & { id: string }): PokemonSet => ({
  name: over.id.toUpperCase(),
  ...over,
});

const OBF = set({
  id: "sv3",
  name: "Obsidian Flames",
  code: "OBF",
  releaseDate: "2023/08/11",
  total: 230,
  printedTotal: 197,
});
/** 102/102 — no secrets, so there is only one tier to be complete in. */
const BASE = set({
  id: "base1",
  name: "Base",
  code: "BS",
  releaseDate: "1999/01/09",
  total: 102,
  printedTotal: 102,
});
const SIT = set({
  id: "swsh12",
  name: "Silver Tempest",
  code: "SIT",
  releaseDate: "2022/11/11",
  total: 215,
  printedTotal: 195,
});

/** `n` numbered cards, "1".."n" — all inside any printed run at least that big. */
const numbers = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i + 1));

describe("groupSets sort", () => {
  const A = set({ id: "a", name: "Alpha", total: 100, printedTotal: 100 });
  const B = set({ id: "b", name: "bravo", total: 50, printedTotal: 50 });
  const C = set({ id: "c", name: "Charlie", total: 200, printedTotal: 200 });
  /** Size unknown: no total at all. */
  const U = set({ id: "u", name: "Unknown" });
  // a 10/100 (90 missing), b 10/50 (40 missing), c 100/200 (100 missing, 50%), u 5 (unknown)
  const counts = { a: 10, b: 10, c: 100, u: 5 };
  const nums = { a: numbers(10), b: numbers(10), c: numbers(100), u: numbers(5) };
  const ids = (s: "recent" | "complete" | "missing" | "az") =>
    groupSets([A, B, C, U], counts, nums, "", s).inProgress.map((r) => r.set.id);

  it("recent keeps today's order", () => {
    expect(ids("recent")).toEqual(["c", "b", "a", "u"]);
  });

  it("most complete puts the highest ratio first and unknown totals last", () => {
    expect(ids("complete")).toEqual(["c", "b", "a", "u"]);
  });

  it("fewest missing puts the smallest gap first and unknown totals last", () => {
    expect(ids("missing")).toEqual(["b", "a", "c", "u"]);
  });

  it("A to Z ignores case", () => {
    expect(ids("az")).toEqual(["a", "b", "c", "u"]);
  });

  it("keeps catalog order on ties among untouched sets", () => {
    const rest = groupSets([OBF, BASE, SIT], {}, {}, "", "complete").rest;
    expect(rest.map((r) => r.set.id)).toEqual(["sv3", "base1", "swsh12"]);
  });

  it("sorts untouched sets A to Z too", () => {
    const rest = groupSets([OBF, BASE, SIT], {}, {}, "", "az").rest;
    expect(rest.map((r) => r.set.name)).toEqual(["Base", "Obsidian Flames", "Silver Tempest"]);
  });
});

describe("groupSets", () => {
  it("puts a started, unfinished set in progress and leaves untouched sets out of it", () => {
    const groups = groupSets([OBF, BASE], { sv3: 3 }, { sv3: ["1", "2", "3"] });

    expect(groups.inProgress.map((r) => r.set.id)).toEqual(["sv3"]);
    expect(groups.complete).toEqual([]);
    expect(groups.rest.map((r) => r.set.id)).toEqual(["base1"]);
  });

  it("moves a base-complete set out of 'in progress' — a trophy is not work in hand", () => {
    // 197 base cards held out of 197, and none of the 33 secrets.
    const groups = groupSets([OBF], { sv3: 197 }, { sv3: numbers(197) });

    expect(groups.inProgress).toEqual([]);
    expect(groups.complete.map((r) => r.tiers.tier)).toEqual(["base"]);
  });

  it("ranks master-complete above base-complete, since every base-complete set ties at 1.0", () => {
    const groups = groupSets(
      [OBF, SIT],
      { sv3: 197, swsh12: 215 },
      { sv3: numbers(197), swsh12: numbers(215) },
    );

    expect(groups.complete.map((r) => r.set.id)).toEqual(["swsh12", "sv3"]);
    expect(groups.complete.map((r) => r.tiers.tier)).toEqual(["master", "base"]);
  });

  it("never reorders untouched sets — the catalog's order is release order, not value", () => {
    const groups = groupSets([OBF, BASE, SIT], {}, {});
    expect(groups.rest.map((r) => r.set.id)).toEqual(["sv3", "base1", "swsh12"]);
  });

  it("declines the base tier when the library holds a count but not the numbers", () => {
    // A collection marked before collector numbers were recorded. Sizing a base
    // tier off a numerator full of secret rares would report it complete early.
    const groups = groupSets([OBF], { sv3: 200 }, {});
    const row = groups.inProgress[0]!;

    expect(row.tiers.baseTotal).toBeUndefined();
    expect(row.tiers.masterOwned).toBe(200);
  });

  it("reports how many rows the filter removed, so the screen can say which filter", () => {
    const groups = groupSets([OBF, BASE, SIT], {}, {}, "silver");

    expect(groups.rest.map((r) => r.set.id)).toEqual(["swsh12"]);
    expect(groups.hiddenByFilter).toBe(2);
  });
});

describe("matchesQuery", () => {
  it.each([
    ["obsidian", true],
    ["OBF", true],
    ["sv3", true],
    ["2023", true],
    ["  ", true],
    ["charizard", false],
  ])("%s -> %s", (query, expected) => {
    expect(matchesQuery(OBF, query)).toBe(expected);
  });
});

describe("summaryLine", () => {
  it("says nothing is tracked rather than printing zeroes", () => {
    expect(summaryLine(0, 0, { started: [], complete: [] })).toBe("Nothing tracked yet");
  });

  it("counts a master-complete set in BOTH milestones, because master implies base", () => {
    const groups = groupSets(
      [OBF, SIT],
      { sv3: 230, swsh12: 100 },
      { sv3: numbers(230), swsh12: numbers(100) },
    );

    expect(summaryLine(330, 340, groups)).toBe("330 cards · 340 printings · 2 sets · 1 base · 1 master");
  });

  it("omits the milestones entirely when nothing is finished", () => {
    const groups = groupSets([OBF], { sv3: 3 }, { sv3: ["1", "2", "3"] });
    expect(summaryLine(3, 4, groups)).toBe("3 cards · 4 printings · 1 set");
  });
});
