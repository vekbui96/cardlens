import { describe, expect, it } from "vitest";
import type { OwnedPrintingRow } from "./ownedSort.ts";
import { csvFileName, ownedToCsv } from "./ownedCsv.ts";

const row = (over: Partial<OwnedPrintingRow> = {}): OwnedPrintingRow => ({
  cardId: "sv1-1",
  setId: "sv1",
  setName: "Scarlet & Violet",
  name: "Sprigatito",
  collectorNumber: "1",
  finish: "normal",
  price: 2.5,
  at: 1,
  ...over,
});

describe("ownedToCsv", () => {
  it("gives a header only for an empty collection", () => {
    expect(ownedToCsv([])).toBe("name,set,number,finish,price\r\n");
  });

  it("writes one line per row with the price to the cent", () => {
    const csv = ownedToCsv([row(), row({ name: "Floragato", collectorNumber: "2", price: 10 })]);
    expect(csv).toBe(
      "name,set,number,finish,price\r\nSprigatito,Scarlet & Violet,1,Normal,2.50\r\nFloragato,Scarlet & Violet,2,Normal,10.00\r\n",
    );
  });

  it("leaves an unpriced row empty, never 0", () => {
    const { price: _price, ...unpriced } = row();
    const line = ownedToCsv([unpriced]).split("\r\n")[1];
    expect(line.endsWith(",")).toBe(true);
    expect(line).not.toContain("0.00");
  });

  it("quotes commas, double quotes and newlines", () => {
    const csv = ownedToCsv([row({ name: 'Mr. Mime, "Radiant"', setName: "A\nB" })]);
    expect(csv).toContain('"Mr. Mime, ""Radiant""","A\nB",');
  });

  it("prefixes names that a spreadsheet would run as a formula", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      const line = ownedToCsv([row({ name: `${lead}SUM(A1)` })]).split("\r\n")[1];
      expect(line.startsWith(`'${lead}SUM(A1),`)).toBe(true);
    }
  });

  it("keeps the order it was given", () => {
    const csv = ownedToCsv([row({ name: "Zed" }), row({ name: "Abe" })]);
    expect(csv.indexOf("Zed")).toBeLessThan(csv.indexOf("Abe"));
  });
});

describe("csvFileName", () => {
  it("carries the local date", () => {
    expect(csvFileName(new Date(2026, 10, 18, 23, 59))).toBe("cardlens-2026-11-18.csv");
  });
});
