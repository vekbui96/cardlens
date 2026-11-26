import { describe, expect, it } from "vitest";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import {
  addChoice,
  giveLines,
  giveTotal,
  matchRows,
  removeChoice,
  setChoiceQty,
  type GiveChoice,
} from "./giveModel.ts";

const row = (cardId: string, finish: string, price?: number, name = cardId): OwnedPrintingRow => ({
  cardId,
  setId: "sv3",
  setName: "Obsidian Flames",
  name,
  collectorNumber: "1",
  finish,
  ...(price !== undefined ? { price } : {}),
  at: 1,
});

const rows = [row("a", "normal", 4.5), row("b", "holo", 10), row("c", "normal")];

describe("give side", () => {
  it("adds a printing once, with quantity 1", () => {
    const once = addChoice([], "a", "normal");
    expect(addChoice(once, "a", "normal")).toEqual([{ cardId: "a", finish: "normal", qty: 1 }]);
  });

  it("removes a printing", () => {
    const list = addChoice(addChoice([], "a", "normal"), "b", "holo");
    expect(removeChoice(list, "a", "normal").map((c) => c.cardId)).toEqual(["b"]);
  });

  it("never lets a quantity pass the owned count, or fall below 1", () => {
    const list = addChoice([], "a", "normal");
    expect(setChoiceQty(list, "a", "normal", 9, 3)[0]?.qty).toBe(3);
    expect(setChoiceQty(list, "a", "normal", 0, 3)[0]?.qty).toBe(1);
    // The collection records a printing as held or not: one copy.
    expect(setChoiceQty(list, "a", "normal", 5)[0]?.qty).toBe(1);
  });

  it("totals priced lines and counts unpriced cards separately, never as zero", () => {
    const choices: GiveChoice[] = [
      { cardId: "a", finish: "normal", qty: 1 },
      { cardId: "b", finish: "holo", qty: 1 },
      { cardId: "c", finish: "normal", qty: 1 },
    ];
    expect(giveTotal(giveLines(choices, rows))).toEqual({ total: 14.5, cards: 3, unpriced: 1 });
  });

  it("multiplies a line's price by its quantity", () => {
    const line = { key: "a|normal", row: row("a", "normal", 2.5), qty: 3, owned: 3 };
    expect(giveTotal([line])).toEqual({ total: 7.5, cards: 3, unpriced: 0 });
  });

  it("drops a choice that is no longer owned", () => {
    expect(giveLines([{ cardId: "gone", finish: "normal", qty: 1 }], rows)).toEqual([]);
  });

  it("finds rows by every typed word, and none for an empty search", () => {
    const named = [row("a", "normal", 1, "Charizard ex"), row("b", "holo", 1, "Pikachu")];
    expect(matchRows(named, "char").map((r) => r.cardId)).toEqual(["a"]);
    expect(matchRows(named, "obsidian pika").map((r) => r.cardId)).toEqual(["b"]);
    expect(matchRows(named, "  ")).toEqual([]);
  });
});
