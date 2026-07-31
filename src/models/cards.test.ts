import { describe, expect, it } from "vitest";
import { availableFinishes, knownFinishes, type CardVariants } from "./cards.ts";

describe("availableFinishes", () => {
  it("lists the printings pricing reports", () => {
    expect(availableFinishes({ normal: true, reverseHolofoil: true })).toEqual(["normal", "reverse"]);
  });

  it("pads to normal so a row always has something to show", () => {
    expect(availableFinishes(undefined)).toEqual(["normal"]);
    expect(availableFinishes({})).toEqual(["normal"]);
  });
});

describe("knownFinishes", () => {
  it("agrees with availableFinishes when pricing reported something", () => {
    const variants: CardVariants = { normal: true, holofoil: true };
    expect(knownFinishes(variants)).toEqual(availableFinishes(variants));
  });

  it("reports nothing known when pricing reported nothing", () => {
    // The whole point: availableFinishes pads to ["normal"], which is a display
    // convenience and NOT evidence the card is normal-only. Pitch Black returns
    // no variant data for any of its 120 cards, so treating the padding as
    // knowledge marked `normal` on holo-only cards — 7 such rows were found in
    // the live collection.
    expect(knownFinishes(undefined)).toBeNull();
    expect(availableFinishes(undefined)).toEqual(["normal"]);
  });

  it("treats an all-false record as no data rather than as normal-only", () => {
    expect(knownFinishes({ normal: false, holofoil: false })).toBeNull();
  });
});
