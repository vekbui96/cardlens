import { afterEach, describe, expect, it, vi } from "vitest";
import { VALUE_RANGE_KEY, readValueRange, storeValueRange } from "./valueRange.ts";

describe("value range memory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(VALUE_RANGE_KEY);
  });

  it("defaults to 30 days when nothing is stored", () => {
    expect(readValueRange()).toBe("30d");
  });

  it("reads back a stored range", () => {
    storeValueRange("90d");
    expect(readValueRange()).toBe("90d");
    storeValueRange("7d");
    expect(readValueRange()).toBe("7d");
  });

  it("stores the default as the absent state", () => {
    storeValueRange("90d");
    storeValueRange("30d");
    expect(window.localStorage.getItem(VALUE_RANGE_KEY)).toBeNull();
  });

  it("falls back to 30 days for garbage or an unknown key", () => {
    window.localStorage.setItem(VALUE_RANGE_KEY, "{nope");
    expect(readValueRange()).toBe("30d");
    window.localStorage.setItem(VALUE_RANGE_KEY, "365d");
    expect(readValueRange()).toBe("30d");
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readValueRange()).toBe("30d");
    expect(() => storeValueRange("90d")).not.toThrow();
    expect(() => storeValueRange("30d")).not.toThrow();
  });
});
