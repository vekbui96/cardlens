import { describe, expect, it } from "vitest";
import { METRIC_SCREENS } from "../models/metricsEvents.ts";
import { screenTitle } from "./documentTitle.ts";

describe("screenTitle", () => {
  it("names every screen the router knows", () => {
    for (const name of METRIC_SCREENS) {
      const title = screenTitle(name);
      expect(title.endsWith(" · CardLens")).toBe(true);
      expect(title.length).toBeGreaterThan(" · CardLens".length);
    }
  });

  it("uses plain labels", () => {
    expect(screenTitle("results")).toBe("Search · CardLens");
    expect(screenTitle("binders")).toBe("Binders · CardLens");
    expect(screenTitle("home")).toBe("Home · CardLens");
    expect(screenTitle("wantlist")).toBe("Want list · CardLens");
    expect(screenTitle("collection")).toBe("My cards · CardLens");
  });

  it("names a shared binder for what a visitor sees: a showcase", () => {
    expect(screenTitle("trade")).toBe("Showcase · CardLens");
  });

  it("falls back to plain CardLens for anything unmapped", () => {
    expect(screenTitle("nope" as never)).toBe("CardLens");
  });
});
