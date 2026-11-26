import { describe, expect, it } from "vitest";
import type { Binder } from "./binderLayout.ts";
import {
  backupCounts,
  backupFileName,
  bindersToCsv,
  bindersToJson,
  buildBackupFile,
  ownedToJson,
} from "./backupExport.ts";
import type { OwnedPrintingRow } from "./ownedSort.ts";

const row = (over: Partial<OwnedPrintingRow>): OwnedPrintingRow => ({
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

const binder: Binder = {
  id: "b1",
  name: 'Trades, "hot"',
  format: "9",
  forTrade: true,
  createdAt: 1,
  updatedAt: 1,
  pages: [
    {
      slots: {
        0: { kind: "card", cardId: "sv1-1", finish: "normal", name: "Sprigatito", collectorNumber: "1" },
        4: {
          kind: "card",
          cardId: "sv1-2",
          finish: "reverse",
          name: "Floragato",
          quantity: 3,
          condition: "NM",
        },
      },
    },
    { slots: { 2: { kind: "image", label: "Divider" } } },
  ],
} as Binder;

describe("backup export", () => {
  it("serialises binder pockets with 1-based page and slot, escaping commas and quotes", () => {
    const lines = bindersToCsv([binder]).split("\r\n");
    expect(lines).toHaveLength(5); // header + 3 pockets + trailing empty
    expect(lines[1]).toMatch(/^"Trades, ""hot""",.*,yes,1,1,card,sv1-1,Sprigatito,1,/);
    expect(lines[2]).toContain(",1,5,card,sv1-2,Floragato,,");
    expect(lines[2]).toMatch(/,3,NM,$/);
    expect(lines[3]).toContain(",2,3,image,");
  });

  it("keeps unpriced cards unpriced", () => {
    const text = ownedToJson([row({ price: undefined }), row({ cardId: "sv1-2", price: 10 })]);
    const parsed = JSON.parse(text);
    expect(parsed.cards[0].price).toBeNull();
    expect(parsed.cards[1].price).toBe(10);
    const csv = buildBackupFile("owned-csv", [row({ price: undefined })], [], new Date(2026, 10, 25)).text;
    expect(csv.split("\r\n")[1]).toMatch(/,$/);
  });

  it("round-trips JSON to the same counts", () => {
    const rows = [row({}), row({ cardId: "sv1-2" })];
    expect(JSON.parse(ownedToJson(rows)).count).toBe(2);
    const b = JSON.parse(bindersToJson([binder]));
    expect(b.count).toBe(1);
    expect(b.binders[0].pages[0].slots).toHaveLength(2);
    expect(b.binders[0].pages[1].slots[0].kind).toBe("image");
    expect(backupCounts(rows, [binder])).toEqual({ owned: 2, binders: 1, slots: 3 });
  });

  it("gives empty output for empty inputs", () => {
    expect(bindersToCsv([]).split("\r\n")).toHaveLength(2);
    expect(JSON.parse(ownedToJson([])).cards).toEqual([]);
    expect(JSON.parse(bindersToJson([])).binders).toEqual([]);
    expect(backupCounts([], [])).toEqual({ owned: 0, binders: 0, slots: 0 });
  });

  it("names files with the local date", () => {
    const d = new Date(2026, 10, 5);
    expect(backupFileName("owned-csv", d)).toBe("cardlens-owned-2026-11-05.csv");
    expect(backupFileName("binders-json", d)).toBe("cardlens-binders-2026-11-05.json");
  });
});
