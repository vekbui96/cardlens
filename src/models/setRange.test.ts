import { describe, expect, it } from "vitest";
import { rangeToLines, expandRange } from "./setRange.ts";

describe("expandRange", () => {
  it("expands 1-5", () => {
    expect(expandRange("1-5")).toEqual({ ok: true, numbers: [1, 2, 3, 4, 5] });
  });
  it("accepts a single number and spaces / en dashes", () => {
    expect(expandRange(" 7 ")).toEqual({ ok: true, numbers: [7] });
    expect(expandRange("2 – 4")).toEqual({ ok: true, numbers: [2, 3, 4] });
  });
  it("puts a reversed range in order", () => {
    expect(expandRange("5-3")).toEqual({ ok: true, numbers: [3, 4, 5] });
  });
  it("refuses empty, zero, text and huge ranges", () => {
    expect(expandRange("").ok).toBe(false);
    expect(expandRange("0-5").ok).toBe(false);
    expect(expandRange("a-b").ok).toBe(false);
    expect(expandRange("1-5000").ok).toBe(false);
  });
});

describe("rangeToLines", () => {
  it("makes one set-code line per number", () => {
    expect(rangeToLines("sv3", [1, 2])).toBe("sv3 1\nsv3 2");
  });
});
