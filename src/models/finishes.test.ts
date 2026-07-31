import { describe, expect, it } from "vitest";
import {
  canonicalFinish,
  compareFinishes,
  finishLabel,
  finishShort,
  isLikelyPackPrinting,
  makeFinish,
  parseFinish,
} from "./finishes.ts";

describe("finish keys", () => {
  it("round-trips a plain printing", () => {
    expect(parseFinish(makeFinish("holo"))).toEqual({ type: "holo" });
  });

  it("round-trips a patterned printing", () => {
    expect(parseFinish(makeFinish("reverse", "pokeball"))).toEqual({
      type: "reverse",
      foil: "pokeball",
    });
  });

  it("keeps a foil containing a dash intact", () => {
    expect(parseFinish("reverse:team-rocket")).toEqual({ type: "reverse", foil: "team-rocket" });
  });
});

describe("canonicalFinish", () => {
  it.each([
    ["holofoil", "holo"],
    ["reverseHolofoil", "reverse"],
    ["pokeBall", "reverse:pokeball"],
    ["masterBall", "reverse:masterball"],
  ])("migrates the legacy value %s", (legacy, expected) => {
    expect(canonicalFinish(legacy)).toBe(expected);
  });

  it("leaves already-canonical values alone", () => {
    expect(canonicalFinish("reverse:energy")).toBe("reverse:energy");
    expect(canonicalFinish("normal")).toBe("normal");
  });
});

describe("finishLabel", () => {
  it("labels plain printings", () => {
    expect(finishLabel("reverse")).toBe("Reverse Holo");
    expect(finishLabel("firstEdition")).toBe("1st Edition");
  });

  it("reads patterned reverses naturally", () => {
    expect(finishLabel("reverse:pokeball")).toBe("Poké Ball Reverse");
    expect(finishLabel("reverse:masterball")).toBe("Master Ball Reverse");
  });

  it("humanizes a foil it has never seen", () => {
    // New sets invent foils; an unknown one must not render as a raw key.
    expect(finishLabel("reverse:mysteryball")).toBe("Mysteryball Reverse");
    expect(finishLabel("holo:some-new-thing")).toBe("Holofoil — Some new thing");
  });
});

describe("finishShort", () => {
  it("uses known badges", () => {
    expect(finishShort("normal")).toBe("N");
    expect(finishShort("reverse")).toBe("RH");
    expect(finishShort("reverse:masterball")).toBe("MB");
  });

  it("falls back to initials for unknown foils", () => {
    expect(finishShort("reverse:zigzag")).toBe("ZI");
  });
});

describe("compareFinishes", () => {
  it("puts unpatterned printings before patterned ones", () => {
    const sorted = ["reverse:pokeball", "holo", "normal", "reverse"].sort(compareFinishes);
    expect(sorted).toEqual(["normal", "reverse", "holo", "reverse:pokeball"]);
  });

  it("orders patterns stably by name", () => {
    const sorted = ["reverse:pokeball", "reverse:energy", "reverse:masterball"].sort(compareFinishes);
    expect(sorted).toEqual(["reverse:energy", "reverse:masterball", "reverse:pokeball"]);
  });
});

describe("isLikelyPackPrinting", () => {
  it("counts a printing that appears on most of the set", () => {
    // White Flare: reverse+pokeball on 80 of 173.
    expect(isLikelyPackPrinting(80, 173)).toBe(true);
  });

  it("excludes one that appears on a couple of cards", () => {
    // White Flare: holo+tinsel on 2 of 173 — a product exclusive, not a pack pull.
    expect(isLikelyPackPrinting(2, 173)).toBe(false);
  });

  it("is safe when the set size is unknown", () => {
    expect(isLikelyPackPrinting(5, 0)).toBe(false);
  });
});
