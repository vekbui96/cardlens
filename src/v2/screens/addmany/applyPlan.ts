import type { CollectFinish } from "../../../models/cards.ts";

/** One printing a pasted list would mark owned. */
export interface AddEntry {
  cardId: string;
  finish: CollectFinish;
  setId: string;
  number: string;
}

export interface OwnedEntry extends AddEntry {
  owned: boolean;
}

/**
 * What an add would actually turn on: each distinct printing once, and only
 * those the collection does not already hold. Undo reverses exactly this list,
 * so a card owned before the add is never switched off by it. Running the same
 * list again plans nothing, which makes the add idempotent.
 */
export function planAdd(
  entries: readonly AddEntry[],
  isOwnedFinish: (cardId: string, finish: CollectFinish) => boolean,
): AddEntry[] {
  const seen = new Set<string>();
  const out: AddEntry[] = [];
  for (const e of entries) {
    const key = `${e.cardId}|${e.finish}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isOwnedFinish(e.cardId, e.finish)) out.push(e);
  }
  return out;
}

export const asOwned = (entries: readonly AddEntry[], owned: boolean): OwnedEntry[] =>
  entries.map((e) => ({ ...e, owned }));
