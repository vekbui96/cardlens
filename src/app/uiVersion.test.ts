import { afterEach, describe, expect, it } from "vitest";
import {
  activeUiVersion,
  readStoredUiVersion,
  resolveUiVersion,
  storeUiVersion,
  uiVersionFromLocation,
  UI_VERSION_KEY,
} from "./uiVersion.ts";

afterEach(() => window.localStorage.removeItem(UI_VERSION_KEY));

describe("uiVersionFromLocation", () => {
  it("takes ?v=2 and ?v=v2 alike", () => {
    // The first is what a person types, the second what they paste back out of
    // a URL that already carried it.
    expect(uiVersionFromLocation("?v=2")).toBe("v2");
    expect(uiVersionFromLocation("?v=v2")).toBe("v2");
    expect(uiVersionFromLocation("?v=1")).toBe("v1");
  });

  it("ignores anything else rather than guessing", () => {
    expect(uiVersionFromLocation("")).toBeNull();
    expect(uiVersionFromLocation("?v=3")).toBeNull();
    expect(uiVersionFromLocation("?v=beta")).toBeNull();
  });
});

describe("resolveUiVersion", () => {
  it("defaults to v1, so an unfinished rebuild is never what a visitor gets", () => {
    expect(resolveUiVersion(null, null)).toBe("v1");
  });

  it("prefers the URL over what was remembered", () => {
    expect(resolveUiVersion("v1", "v2")).toBe("v1");
    expect(resolveUiVersion("v2", null)).toBe("v2");
  });

  it("falls back to storage, and ignores a value it does not recognise", () => {
    expect(resolveUiVersion(null, "v2")).toBe("v2");
    expect(resolveUiVersion(null, "v9")).toBe("v1");
  });
});

describe("storeUiVersion", () => {
  it("writes v2 and REMOVES the key for v1", () => {
    // Absent and default are the same state. Two ways to spell one value is
    // what this codebase avoids everywhere else (quantity, forTrade, cover).
    storeUiVersion("v2");
    expect(readStoredUiVersion()).toBe("v2");
    storeUiVersion("v1");
    expect(window.localStorage.getItem(UI_VERSION_KEY)).toBeNull();
  });
});

describe("activeUiVersion", () => {
  it("never gives the glasses v2, whatever is stored", () => {
    // v2 is a web rebuild. The 600x600 additive display wants the opposite
    // things, and preview deliberately mimics it.
    storeUiVersion("v2");
    expect(activeUiVersion("glasses")).toBe("v1");
    expect(activeUiVersion("preview")).toBe("v1");
    expect(activeUiVersion("web")).toBe("v2");
  });
});
