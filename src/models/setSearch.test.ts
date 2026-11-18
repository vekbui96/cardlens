import { describe, expect, it } from "vitest";
import { matchesSetQuery } from "./setSearch.ts";

const OBSIDIAN = { id: "sv3", name: "Obsidian Flames", code: "OBF", series: "Scarlet & Violet" };
const PALDEA = { id: "sv2", name: "Paldea Evolved", series: "Scarlet & Violet" };
const POKEMON151 = { id: "sv3pt5", name: "Pokémon 151", series: "Scarlet & Violet" };

describe("matchesSetQuery", () => {
  it("matches everything for an empty or blank query", () => {
    expect(matchesSetQuery(OBSIDIAN, "")).toBe(true);
    expect(matchesSetQuery(OBSIDIAN, "   ")).toBe(true);
  });

  it("matches the set name, ignoring case and surrounding space", () => {
    expect(matchesSetQuery(OBSIDIAN, "obs")).toBe(true);
    expect(matchesSetQuery(OBSIDIAN, "  FLAMES ")).toBe(true);
  });

  it("matches the set id and the set code", () => {
    expect(matchesSetQuery(OBSIDIAN, "sv3")).toBe(true);
    expect(matchesSetQuery(PALDEA, "sv3")).toBe(false);
    expect(matchesSetQuery(OBSIDIAN, "obf")).toBe(true);
  });

  it("matches the series", () => {
    expect(matchesSetQuery(PALDEA, "violet")).toBe(true);
  });

  it("ignores accents in either direction", () => {
    expect(matchesSetQuery(POKEMON151, "pokemon")).toBe(true);
    expect(matchesSetQuery({ id: "x", name: "Pokemon Go" }, "pokémon")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesSetQuery(OBSIDIAN, "paldea")).toBe(false);
  });
});
