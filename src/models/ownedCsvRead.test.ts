import { describe, expect, it } from "vitest";
import { ownedToCsv } from "./ownedCsv.ts";
import { readOwnedCsv } from "./ownedCsvRead.ts";
import { parseCardList } from "./cardListParse.ts";
import type { OwnedPrintingRow } from "./ownedSort.ts";

const resolve = (name: string): string | undefined =>
  name.toLowerCase() === "obsidian flames" ? "sv3" : undefined;

const row = (over: Partial<OwnedPrintingRow>): OwnedPrintingRow =>
  ({
    name: "Charizard ex",
    setName: "Obsidian Flames",
    collectorNumber: "125",
    finish: "holo",
    price: 4,
    ...over,
  }) as OwnedPrintingRow;

describe("readOwnedCsv", () => {
  it("round-trips ownedToCsv into lines the list parser reads", () => {
    const csv = ownedToCsv([row({}), row({ collectorNumber: "223", finish: "reverse", price: undefined })]);
    const out = readOwnedCsv(csv, resolve);
    expect(out.problems).toEqual([]);
    expect(out.rows).toBe(2);
    const parsed = parseCardList(out.text);
    expect(parsed.lines.map((l) => (l.ok ? [l.setCode, l.number, l.finish] : null))).toEqual([
      ["SV3", "125", "holo"],
      ["SV3", "223", "reverse"],
    ]);
  });

  it("reads quoted fields with commas and keeps CSV line numbers", () => {
    const csv = 'name,set,number,finish,price\r\n"Pikachu, big","Obsidian Flames",5,Normal,\r\n';
    const out = readOwnedCsv(csv, resolve);
    expect(out.text.split("\n")[1]).toBe("sv3 5 normal");
    expect(out.problems).toEqual([]);
  });

  it("reports bad rows with the reason and still reads the good ones", () => {
    const csv = [
      "name,set,number,finish,price",
      "A,Nowhere,1,Normal,",
      "B,Obsidian Flames,,Normal,",
      "C,Obsidian Flames,9,Weird Foil,",
      "D,Obsidian Flames,10,Normal,",
    ].join("\r\n");
    const out = readOwnedCsv(csv, resolve);
    expect(out.problems.map((p) => p.line)).toEqual([2, 3, 4]);
    expect(out.problems[0]?.reason).toMatch(/No set named Nowhere/);
    expect(out.problems[1]?.reason).toMatch(/number/);
    expect(out.problems[2]?.reason).toMatch(/Weird Foil/);
    expect(out.text.split("\n")[4]).toBe("sv3 10 normal");
  });

  it("refuses a file without the expected columns", () => {
    const out = readOwnedCsv("a,b\r\n1,2", resolve);
    expect(out.rows).toBe(0);
    expect(out.problems[0]?.reason).toMatch(/columns/);
  });
});
