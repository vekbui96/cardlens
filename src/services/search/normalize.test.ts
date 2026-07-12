import { describe, expect, it } from "vitest";
import { normalizeQuery, stripLeadingZeros } from "./normalize.ts";

describe("normalizeQuery", () => {
  it("normalizes a plain name", () => {
    const q = normalizeQuery("  Charizard  ");
    expect(q.name).toBe("charizard");
    expect(q.collectorNumber).toBeUndefined();
  });

  it("keeps suffix tokens like ex", () => {
    const q = normalizeQuery("Charizard ex");
    expect(q.name).toBe("charizard ex");
    expect(q.suffix).toBe("ex");
  });

  it("recognizes VMAX", () => {
    const q = normalizeQuery("Umbreon VMAX");
    expect(q.name).toBe("umbreon vmax");
    expect(q.suffix).toBe("vmax");
  });

  it("extracts a standalone collector number and strips leading zeros", () => {
    const q = normalizeQuery("Pikachu 025");
    expect(q.name).toBe("pikachu");
    expect(q.collectorNumber).toBe("25");
  });

  it("extracts collector number and set total from n/m form", () => {
    const q = normalizeQuery("Charizard 4/102");
    expect(q.name).toBe("charizard");
    expect(q.collectorNumber).toBe("4");
    expect(q.setTotal).toBe("102");
  });

  it("handles number-only queries", () => {
    const q = normalizeQuery("223/197");
    expect(q.name).toBe("");
    expect(q.collectorNumber).toBe("223");
    expect(q.setTotal).toBe("197");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeQuery("greninja    ex").name).toBe("greninja ex");
  });
});

describe("stripLeadingZeros", () => {
  it("removes leading zeros but keeps a single zero", () => {
    expect(stripLeadingZeros("007")).toBe("7");
    expect(stripLeadingZeros("000")).toBe("0");
    expect(stripLeadingZeros("102")).toBe("102");
  });
});
