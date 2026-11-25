import { describe, expect, it } from "vitest";
import { parseCardList } from "./cardListParse.ts";

describe("parseCardList", () => {
  it("reads set code and number, upper-casing the code", () => {
    const { lines } = parseCardList("sv3 125");
    expect(lines).toEqual([
      { line: 1, raw: "sv3 125", ok: true, setCode: "SV3", number: "125", quantity: 1 },
    ]);
  });

  it("reads a quantity written xN or Nx", () => {
    const { lines } = parseCardList("SV3 125 x2\nsv3 126 3x");
    expect(lines.map((l) => (l.ok ? l.quantity : 0))).toEqual([2, 3]);
  });

  it("reads a printing word in any position after the number", () => {
    const { lines } = parseCardList("sv3 125 holo\nsv3 126 x2 Reverse\nsv3 127 1st");
    expect(lines.map((l) => (l.ok ? l.finish : null))).toEqual(["holo", "reverse", "firstEdition"]);
  });

  it("skips blank lines but keeps real line numbers", () => {
    const { lines } = parseCardList("\n  \nSV3 1\n\nSV3 bad!");
    expect(lines.map((l) => l.line)).toEqual([3, 5]);
  });

  it("keeps letters in collector numbers", () => {
    const { lines } = parseCardList("SWSH TG01\nSV3 101a");
    expect(lines[0]).toMatchObject({ ok: true, setCode: "SWSH", number: "TG01" });
    expect(lines[1]).toMatchObject({ ok: true, number: "101a" });
  });

  it("reports a reason for bad lines and keeps the good ones", () => {
    const { lines } = parseCardList("SV3\nSV3 125 x0\nSV3 125 shiny\nSV3 125 x2 x3\nSV3 126");
    expect(lines.filter((l) => l.ok)).toHaveLength(1);
    const reasons = lines.filter((l) => !l.ok).map((l) => (l.ok ? "" : l.reason));
    expect(reasons).toHaveLength(4);
    expect(reasons.every((r) => r.length > 0)).toBe(true);
    expect(reasons[0]).toMatch(/number/i);
    expect(reasons[1]).toMatch(/quantity/i);
    expect(reasons[2]).toMatch(/shiny/);
  });

  it("reports duplicates of the same card and printing as a count, without merging the lines", () => {
    const parsed = parseCardList("SV3 125\nsv3 125 x2\nSV3 125 holo");
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.duplicates).toEqual(["SV3 125"]);
  });
});
