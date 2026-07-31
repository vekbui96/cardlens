import { describe, expect, it } from "vitest";
import { continueTarget, topProgress } from "./continueSet.ts";
import type { OwnedCard } from "../../storage/repositories.ts";
import type { PokemonSet } from "../../models/cards.ts";

const owned = (id: string, setId: string, at: number): OwnedCard => ({
  id,
  setId,
  finishes: ["normal"],
  at,
});

const sets: PokemonSet[] = [
  { id: "me5", name: "Pitch Black", total: 120 },
  { id: "sv1", name: "Scarlet & Violet", total: 250 },
];

describe("continueTarget", () => {
  it("returns nothing when nothing is collected", () => {
    expect(continueTarget([], sets, {}, {})).toBeNull();
  });

  it("picks the most recently marked set", () => {
    const target = continueTarget(
      [owned("sv1-1", "sv1", 100), owned("me5-1", "me5", 900)],
      sets,
      { me5: 5, sv1: 2 },
      { me5: 9, sv1: 2 },
    );
    expect(target?.setId).toBe("me5");
    expect(target?.setName).toBe("Pitch Black");
    expect(target?.cards).toBe(5);
    expect(target?.printings).toBe(9);
    expect(target?.total).toBe(120);
  });

  it("falls back to the set id when the set list has not loaded", () => {
    // Hiding the row would be worse: the resume action still works.
    const target = continueTarget([owned("me5-1", "me5", 1)], undefined, { me5: 1 }, { me5: 1 });
    expect(target?.setName).toBe("me5");
    expect(target?.total).toBeUndefined();
  });
});

describe("topProgress", () => {
  it("orders by completion, not by count", () => {
    const rows = topProgress({ me5: 60, sv1: 100 }, sets);
    expect(rows.map((r) => r.setId)).toEqual(["me5", "sv1"]);
  });

  it("skips sets whose size is unknown", () => {
    const rows = topProgress({ mystery: 40, me5: 1 }, sets);
    expect(rows.map((r) => r.setId)).toEqual(["me5"]);
  });

  it("caps the list", () => {
    expect(topProgress({ me5: 5, sv1: 5 }, sets, 1)).toHaveLength(1);
  });
});
