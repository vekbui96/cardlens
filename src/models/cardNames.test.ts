import { describe, expect, it } from "vitest";
import { foldName, parseNameRows, rankNames, type NameRow } from "./cardNames.ts";

/**
 * Every case here is a real name from the shipped index. The catalog is
 * stranger than any invented fixture — thirteen distinct names begin with
 * "Charizard", and two of them carry a delta and a star.
 */
const ROWS: NameRow[] = [
  ["Charizard", 21],
  ["Charizard ex", 9],
  ["Charizard V", 6],
  ["Charizard VMAX", 5],
  ["Charizard VSTAR", 3],
  ["Charizard-EX", 4],
  ["Charizard-GX", 3],
  ["Charizard G", 2],
  ["Charizard δ", 2],
  ["Charizard ★ δ", 1],
  ["Charizard & Braixen-GX", 1],
  ["Charizard Spirit Link", 2],
  ["Charcadet", 4],
  ["Pikachu", 99],
  ["Pikachu V", 4],
  ["Pichu", 12],
  ["Eevee", 65],
  ["Flaaffy", 14],
];

describe("foldName", () => {
  it("folds case", () => {
    expect(foldName("Charizard")).toBe(foldName("CHARIZARD"));
  });

  it("folds punctuation, so a hyphen is not a wall", () => {
    // `Charizard-EX` and `Charizard ex` are two real, different cards whose
    // names differ by one character nobody types deliberately.
    expect(foldName("Charizard-EX")).toBe("charizard ex");
    expect(foldName("Charizard ex")).toBe("charizard ex");
  });

  it("folds an ampersand out of a tag-team name", () => {
    expect(foldName("Charizard & Braixen-GX")).toBe("charizard braixen gx");
  });

  it("strips accents to their base letter", () => {
    expect(foldName("Pokémon")).toBe("pokemon");
  });

  it("does not leave symbols behind as noise", () => {
    // δ and ★ have no letter form; what matters is that they do not survive as
    // characters a query could never match.
    expect(foldName("Charizard ★ δ")).toBe("charizard");
  });
});

describe("rankNames", () => {
  it("says nothing for a single character", () => {
    // One letter matches hundreds of names; a list of eight arbitrary ones is
    // worse than no list.
    expect(rankNames("c", ROWS)).toEqual([]);
  });

  it("puts the plain name first for a prefix", () => {
    // The failure this ranking exists to prevent: alphabetically `Charcadet`
    // comes first, and it is not what somebody typing "char" means.
    expect(rankNames("char", ROWS)[0]?.name).toBe("Charizard");
  });

  it("ranks by printings, not alphabetically", () => {
    // Pikachu has 99 printings and Pichu 12. Alphabetical would flip them.
    const names = rankNames("pi", ROWS).map((s) => s.name);
    expect(names.indexOf("Pikachu")).toBeLessThan(names.indexOf("Pichu"));
  });

  it("prefers a prefix over a word-prefix", () => {
    // "gx" starts `Charizard-GX` once folded, and appears as a later word in
    // `Charizard & Braixen-GX`. The tier decides it, not the printings count —
    // which is the point, since both have three or fewer.
    const names = rankNames("gx", ROWS).map((s) => s.name);
    expect(names.indexOf("Charizard-GX")).toBeLessThan(names.indexOf("Charizard & Braixen-GX"));
  });

  it("finds a word-prefix inside a tag-team name", () => {
    expect(rankNames("brai", ROWS).map((s) => s.name)).toEqual(["Charizard & Braixen-GX"]);
  });

  it("finds a plain substring last, but finds it", () => {
    // "aff" is inside Flaaffy and starts nothing.
    expect(rankNames("aff", ROWS).map((s) => s.name)).toEqual(["Flaaffy"]);
  });

  it("matches across a hyphen the user did not type", () => {
    expect(rankNames("charizard ex", ROWS).map((s) => s.name)).toContain("Charizard-EX");
  });

  it("puts an exact match above a longer name that starts with it", () => {
    const names = rankNames("charizard v", ROWS).map((s) => s.name);
    expect(names[0]).toBe("Charizard V");
  });

  it("caps the list", () => {
    // "char" matches thirteen names here; a list longer than a glance is a list
    // that covers the field it belongs to.
    expect(rankNames("char", ROWS)).toHaveLength(8);
    expect(rankNames("char", ROWS, 3)).toHaveLength(3);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(rankNames("zzzz", ROWS)).toEqual([]);
  });

  it("carries the real name through, not the folded one", () => {
    // The suggestion has to show what the results screen will show.
    expect(rankNames("charizard d", ROWS).map((s) => s.name)).not.toContain("charizard");
  });
});

describe("parseNameRows", () => {
  it("accepts the shipped shape", () => {
    expect(parseNameRows([["Pikachu", 99]])).toEqual([["Pikachu", 99]]);
  });

  it("drops a malformed row rather than the file", () => {
    expect(parseNameRows([["Pikachu", 99], "nope", ["x"], [1, 2]])).toEqual([["Pikachu", 99]]);
  });

  it("refuses something that is not the file at all", () => {
    // Autofill is an enhancement; a bad file must leave the search box working,
    // which means the loader has to be able to tell that it got one.
    for (const bad of [null, undefined, {}, [], 42, [[]]]) {
      expect(parseNameRows(bad)).toBeNull();
    }
  });
});
