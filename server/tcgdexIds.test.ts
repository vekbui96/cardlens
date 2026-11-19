import { describe, expect, it } from "vitest";
import { pokemonTcgCandidates, toPokemonTcgId } from "./tcgdexIds.ts";

/**
 * Every pair here was observed: Mault's TCGdex id on the left, the card's
 * pokemontcg.io id (as CardLens's index files it) on the right.
 */
const OBSERVED: [string, string][] = [
  ["sv01-001", "sv1-1"],
  ["sv02-169", "sv2-169"],
  ["sv03.5-006", "sv3pt5-6"],
  ["sv04.5-232", "sv4pt5-232"],
  ["sv04.5-075", "sv4pt5-75"],
  ["sv08.5-161", "sv8pt5-161"],
  ["swsh3.5-56", "swsh35-56"],
  ["swsh12.5-115", "swsh12pt5-115"],
  ["me01-001", "me1-1"],
  ["ecard2-H01", "ecard2-H1"],
  ["svp-050", "svp-50"],
  ["swshp-SWSH050", "swshp-SWSH050"],
  ["smp-SM60", "smp-SM60"],
  ["xy1-1", "xy1-1"],
  ["lc-3", "base6-3"],
];

/** A stand-in index holding exactly the right-hand ids, plus decoys a sloppy rule would hit. */
const INDEX = new Set([...OBSERVED.map(([, id]) => id), "swsh12-115"]);
const known = (id: string) => INDEX.has(id);

describe("toPokemonTcgId", () => {
  it.each(OBSERVED)("%s → %s", (tcgdex, pokemontcg) => {
    expect(toPokemonTcgId(tcgdex, known)).toBe(pokemontcg);
  });

  it("returns null rather than guessing when no candidate is in the index", () => {
    // A plausible-looking id that does not exist would file the wrong card.
    expect(toPokemonTcgId("sv99-001", known)).toBeNull();
    expect(toPokemonTcgId("2012bw-6", known)).toBeNull();
  });

  it("prefers the literal id when it exists", () => {
    expect(toPokemonTcgId("swshp-SWSH050", () => true)).toBe("swshp-SWSH050");
  });

  it("never drops the .5 and lands on the parent set", () => {
    // swsh12.5-115 must not become swsh12-115, which is a different, real card.
    expect(pokemonTcgCandidates("swsh12.5-115")).not.toContain("swsh12-115");
  });

  it("copes with ids that are not set-number shaped", () => {
    expect(pokemonTcgCandidates("weird")).toEqual(["weird"]);
    expect(pokemonTcgCandidates("trailing-")).toEqual(["trailing-"]);
  });
});
