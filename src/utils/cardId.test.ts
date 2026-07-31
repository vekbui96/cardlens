import { describe, expect, it } from "vitest";
import { setIdFromCardId } from "./cardId.ts";

describe("setIdFromCardId", () => {
  it("splits on the last dash", () => {
    expect(setIdFromCardId("base1-4")).toBe("base1");
    expect(setIdFromCardId("swsh45-1")).toBe("swsh45");
  });

  it("handles collector numbers that contain letters", () => {
    expect(setIdFromCardId("swsh45sv-SV001")).toBe("swsh45sv");
    expect(setIdFromCardId("sv3pt5-TG01")).toBe("sv3pt5");
  });

  it("returns the whole id when there is no dash to split on", () => {
    expect(setIdFromCardId("weird")).toBe("weird");
  });

  it("does not produce an empty set id from a leading dash", () => {
    expect(setIdFromCardId("-5")).toBe("-5");
  });
});
