import { describe, expect, it } from "vitest";
import { resolveLayoutMode } from "./layoutMode.ts";

describe("resolveLayoutMode", () => {
  it("treats the 600x600 device viewport as glasses", () => {
    expect(resolveLayoutMode(600, 600)).toBe("glasses");
  });

  it("treats a tall phone as web, not glasses", () => {
    // Both are small; only the aspect distinguishes them. Getting this wrong
    // put phones in the fixed 600x600 shell, which overflows a narrow screen.
    expect(resolveLayoutMode(390, 844)).toBe("web");
    expect(resolveLayoutMode(414, 896)).toBe("web");
  });

  it("treats a landscape phone as web", () => {
    expect(resolveLayoutMode(844, 390)).toBe("web");
  });

  it("uses the desktop preview on a large window", () => {
    expect(resolveLayoutMode(1440, 900)).toBe("preview");
  });

  it("falls back to web on a short desktop window", () => {
    expect(resolveLayoutMode(1200, 500)).toBe("web");
  });

  it("honours an explicit override", () => {
    expect(resolveLayoutMode(1440, 900, "glasses")).toBe("glasses");
    expect(resolveLayoutMode(600, 600, "web")).toBe("web");
    expect(resolveLayoutMode(390, 844, "preview")).toBe("preview");
  });

  it("ignores an unknown override", () => {
    expect(resolveLayoutMode(1440, 900, "banana")).toBe("preview");
  });
});
