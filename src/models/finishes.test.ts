import { describe, expect, it } from "vitest";
import {
  canonicalFinish,
  compareFinishes,
  finishLabel,
  finishShort,
  finishToMark,
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

describe("finishToMark", () => {
  it("marks the active printing when the card has it", () => {
    expect(finishToMark(["normal", "reverse", "holo"], "reverse")).toBe("reverse");
  });

  it("never marks a printing the card does not have", () => {
    // The reported bug: sitting on a holo card with the picker on Holofoil,
    // stepping DOWN to a normal/reverse card, and pinching wrote `holo` onto a
    // card with no holo printing. Only ← → re-resolves the picker against the
    // focused card; moving up and down does not.
    expect(finishToMark(["normal", "reverse"], "holo")).not.toBe("holo");
    expect(["normal", "reverse"]).toContain(finishToMark(["normal", "reverse"], "holo"));
  });

  it("falls back to the most basic printing the card has", () => {
    expect(finishToMark(["normal", "reverse"], "holo")).toBe("normal");
    expect(finishToMark(["reverse", "holo"], "firstEdition")).toBe("reverse");
  });

  it("prefers a printing of the same type over the most basic one", () => {
    // Poké Ball Reverse is unavailable, but a plain Reverse is nearer to what
    // was asked for than Normal.
    expect(finishToMark(["normal", "reverse"], "reverse:pokeball")).toBe("reverse");
    expect(finishToMark(["normal", "holo", "holo:tinsel"], "holo:cosmos")).toBe("holo");
  });

  it("marks the only printing of a single-printing card whatever the picker says", () => {
    // ex and full-art cards exist as holo only; this rule predates the bug and
    // must survive the fix.
    expect(finishToMark(["holo"], "reverse")).toBe("holo");
    expect(finishToMark(["normal"], "reverse:masterball")).toBe("normal");
  });

  it("keeps the caller's choice when the card's printings are unknown", () => {
    // Nothing to correct against, and refusing to mark would make the pinch
    // look like hardware that did not register.
    expect(finishToMark([], "reverse:pokeball")).toBe("reverse:pokeball");
  });

  it("takes the picker at its word when nothing vouches for the card", () => {
    // null is NOT the same as ["normal"]. Pitch Black reports no variant data
    // for any card, so before TCGdex printings land every card there looks
    // normal-only. Overriding an explicit "holo" with that padding is what put
    // `normal` on holo-only cards — 7 such rows were found in the live
    // collection, distinct from the picker bug.
    expect(finishToMark(null, "holo")).toBe("holo");
    expect(finishToMark(null, "reverse:masterball")).toBe("reverse:masterball");
    // Contrast: once the card IS known to be normal-only, holo is corrected.
    expect(finishToMark(["normal"], "holo")).toBe("normal");
  });

  it("is stable regardless of the order printings arrive in", () => {
    // TCGdex returns them in its own order; the result must not depend on it.
    expect(finishToMark(["reverse", "normal"], "holo")).toBe("normal");
    expect(finishToMark(["normal", "reverse"], "holo")).toBe("normal");
  });
});
