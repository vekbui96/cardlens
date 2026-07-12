import { describe, expect, it } from "vitest";
import { suggestPokemon, POKEMON_NAMES } from "./pokemonNames.ts";

describe("suggestPokemon", () => {
  it("bundles the full National Dex", () => {
    expect(POKEMON_NAMES.length).toBeGreaterThan(1000);
    expect(POKEMON_NAMES).toContain("Charizard");
    expect(POKEMON_NAMES).toContain("Pikachu");
  });

  it("returns prefix matches for 2+ letters", () => {
    const out = suggestPokemon("cha");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("Charizard");
    expect(out.every((n) => n.toLowerCase().startsWith("cha"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(suggestPokemon("PIKA")).toContain("Pikachu");
  });

  it("returns nothing for fewer than 2 characters", () => {
    expect(suggestPokemon("a")).toEqual([]);
    expect(suggestPokemon("")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(suggestPokemon("ch", 3)).toHaveLength(3);
  });

  it("falls back to substring matches when few names start with the query", () => {
    // Names containing "zard" (Charizard) but not starting with it.
    const out = suggestPokemon("zard");
    expect(out).toContain("Charizard");
  });

  it("returns empty for gibberish", () => {
    expect(suggestPokemon("qxzptv")).toEqual([]);
  });
});
