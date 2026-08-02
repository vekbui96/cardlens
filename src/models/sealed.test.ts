import { describe, expect, it } from "vitest";
import { classifySealed, normalizeSetName } from "./sealed.ts";

describe("classifySealed", () => {
  // Product names taken verbatim from the live tcgcsv dump for ME05.
  it("recognises the units people actually quote", () => {
    expect(classifySealed("Pitch Black Booster Pack")).toBe("pack");
    expect(classifySealed("Pitch Black Elite Trainer Box")).toBe("etb");
    expect(classifySealed("Pitch Black Booster Box")).toBe("box");
    expect(classifySealed("Pitch Black Booster Bundle")).toBe("bundle");
  });

  it("does not let a case masquerade as the unit inside it", () => {
    // "Booster Box Case" contains "Booster Box"; a substring test in the wrong
    // order would price a set's box at $1175.
    expect(classifySealed("Pitch Black Booster Box Case")).toBeUndefined();
    expect(classifySealed("Pitch Black Booster Bundle Case")).toBeUndefined();
    expect(classifySealed("Pitch Black Half Booster Boxes")).toBeUndefined();
  });

  it("ignores the bundles and blisters that are not a set's price", () => {
    expect(classifySealed("Pitch Black Booster Pack Art Bundle [Set of 4]")).toBeUndefined();
    expect(classifySealed("Pitch Black 3-Pack Blister [Binacle]")).toBeUndefined();
  });

  it("will not pass a store exclusive off as the set's ETB", () => {
    // Live miss: this is listed before the standard ETB in Phantasmal Flames,
    // and taking the first match priced the set's ETB at $311.34 against ~$78.
    expect(classifySealed("Phantasmal Flames Pokemon Center Elite Trainer Box (Exclusive)")).toBeUndefined();
    expect(classifySealed("Scarlet & Violet Ultra Premium Collection")).toBeUndefined();
    // The plain one still counts.
    expect(classifySealed("Phantasmal Flames Elite Trainer Box")).toBe("etb");
  });

  it("has no opinion on singles or anything else", () => {
    expect(classifySealed("Pitch Black Build & Battle Box")).toBeUndefined();
    expect(classifySealed("Charizard ex")).toBeUndefined();
  });
});

describe("normalizeSetName", () => {
  it("matches the catalog name through tcgcsv's code prefix", () => {
    expect(normalizeSetName("ME05: Pitch Black")).toBe(normalizeSetName("Pitch Black"));
    expect(normalizeSetName("SV: Black Bolt")).toBe(normalizeSetName("Black Bolt"));
    expect(normalizeSetName("ME03: Perfect Order")).toBe(normalizeSetName("Perfect Order"));
  });

  it("survives punctuation and the ampersand", () => {
    expect(normalizeSetName("Scarlet & Violet")).toBe(normalizeSetName("Scarlet and Violet"));
  });

  it("does not eat a colon that is part of the name", () => {
    // The prefix rule is bounded to a short code, so a long lead-in is kept.
    expect(normalizeSetName("Sword & Shield: Astral Radiance")).toContain("swordandshield");
  });
});
