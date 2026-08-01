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

  it("gives a desktop or laptop browser the real app, not the preview bezel", () => {
    // Reported: "the webpage seems to lock to the visual of glasses". Every
    // window at or above 720x680 fell through to the 600x600 bezel mock, so
    // opening the site on a laptop showed a picture of the glasses instead of
    // the app. The preview is a development tool and is now opt-in.
    expect(resolveLayoutMode(1440, 900)).toBe("web");
    expect(resolveLayoutMode(1280, 720)).toBe("web");
    expect(resolveLayoutMode(900, 700)).toBe("web");
    expect(resolveLayoutMode(1920, 1080)).toBe("web");
  });

  it("falls back to web on a short desktop window", () => {
    expect(resolveLayoutMode(1200, 500)).toBe("web");
  });

  it("still reaches the preview on request", () => {
    expect(resolveLayoutMode(1440, 900, "preview")).toBe("preview");
  });

  it("honours an explicit override", () => {
    expect(resolveLayoutMode(1440, 900, "glasses")).toBe("glasses");
    expect(resolveLayoutMode(600, 600, "web")).toBe("web");
    expect(resolveLayoutMode(390, 844, "preview")).toBe("preview");
  });

  it("ignores an unknown override", () => {
    expect(resolveLayoutMode(1440, 900, "banana")).toBe("web");
  });
});
