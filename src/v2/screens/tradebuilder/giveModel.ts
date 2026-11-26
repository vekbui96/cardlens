import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";

/**
 * The "I give" side of the Trade builder, as plain data.
 *
 * The give list stores only WHICH printings were chosen and how many; names and
 * prices are read back from the owned rows each render, so a price that arrives
 * late shows up without the list being rebuilt. It lives in component state and
 * is lost on reload (a first version).
 */
export interface GiveChoice {
  cardId: string;
  finish: string;
  qty: number;
}

/**
 * Copies of a printing the collection records. A printing is held or not: there
 * is no per-copy count in storage, so the most anyone can give of one is one.
 */
export const OWNED_COPIES = 1;

export interface GiveLine {
  key: string;
  row: OwnedPrintingRow;
  qty: number;
  /** The most that can be given: what is owned. */
  owned: number;
}

export const giveKey = (cardId: string, finish: string): string => `${cardId}|${finish}`;

/** Add a printing with quantity 1; a printing already chosen is left as it is. */
export function addChoice(choices: readonly GiveChoice[], cardId: string, finish: string): GiveChoice[] {
  if (choices.some((c) => c.cardId === cardId && c.finish === finish)) return [...choices];
  return [...choices, { cardId, finish, qty: 1 }];
}

export function removeChoice(choices: readonly GiveChoice[], cardId: string, finish: string): GiveChoice[] {
  return choices.filter((c) => !(c.cardId === cardId && c.finish === finish));
}

/** Set a quantity, held between 1 and the owned count. */
export function setChoiceQty(
  choices: readonly GiveChoice[],
  cardId: string,
  finish: string,
  qty: number,
  owned: number = OWNED_COPIES,
): GiveChoice[] {
  const next = Math.max(1, Math.min(Math.floor(qty) || 1, Math.max(1, owned)));
  return choices.map((c) => (c.cardId === cardId && c.finish === finish ? { ...c, qty: next } : c));
}

/** The chosen printings that are still owned, with what to show for each, in the order chosen. */
export function giveLines(choices: readonly GiveChoice[], rows: readonly OwnedPrintingRow[]): GiveLine[] {
  const byKey = new Map(rows.map((r) => [giveKey(r.cardId, r.finish), r]));
  const lines: GiveLine[] = [];
  for (const c of choices) {
    const row = byKey.get(giveKey(c.cardId, c.finish));
    if (!row) continue;
    lines.push({
      key: giveKey(c.cardId, c.finish),
      row,
      qty: Math.min(c.qty, OWNED_COPIES),
      owned: OWNED_COPIES,
    });
  }
  return lines;
}

/**
 * What the give side adds up to. A card with no price is left out of the total
 * and counted in `unpriced` (cards, not lines), never counted as zero.
 */
export function giveTotal(lines: readonly GiveLine[]): { total: number; cards: number; unpriced: number } {
  let total = 0;
  let cards = 0;
  let unpriced = 0;
  for (const l of lines) {
    cards += l.qty;
    if (typeof l.row.price === "number" && l.row.price > 0) total += l.row.price * l.qty;
    else unpriced += l.qty;
  }
  return { total, cards, unpriced };
}

/** Rows whose name or set matches every word typed; none typed matches nothing is hidden by the screen. */
export function matchRows(rows: readonly OwnedPrintingRow[], query: string): OwnedPrintingRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return rows.filter((r) => {
    const hay = `${r.name} ${r.setName} ${r.collectorNumber}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
