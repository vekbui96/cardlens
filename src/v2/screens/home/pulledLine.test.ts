import { describe, expect, it } from "vitest";
import { pulledLine } from "./pulledLine.ts";

describe("pulledLine", () => {
  it("uses the singular for one card", () => {
    expect(pulledLine(1)).toBe("Pulled 1 card from your other device.");
  });
  it("counts many cards with separators", () => {
    expect(pulledLine(1234)).toBe(`Pulled ${(1234).toLocaleString()} cards from your other device.`);
  });
  it("never says 'Pulled 0 cards'", () => {
    expect(pulledLine(0)).toMatch(/nothing has arrived/);
  });
});
