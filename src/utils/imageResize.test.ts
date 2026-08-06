import { describe, expect, it } from "vitest";
import { fitWithin } from "./imageResize.ts";

describe("fitWithin", () => {
  it("fits a landscape photo by its long edge", () => {
    expect(fitWithin(4000, 3000, 900)).toEqual({ width: 900, height: 675 });
  });

  it("fits a portrait photo by its long edge", () => {
    expect(fitWithin(3000, 4000, 900)).toEqual({ width: 675, height: 900 });
  });

  it("never scales a small image up", () => {
    // Blowing a 120px divider up to 900px at upload time would cost bytes and
    // buy blur.
    expect(fitWithin(120, 90, 900)).toEqual({ width: 120, height: 90 });
  });

  it("reports zero for a zero-dimension source instead of dividing by it", () => {
    expect(fitWithin(0, 100, 900)).toEqual({ width: 0, height: 0 });
  });
});
