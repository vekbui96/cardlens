import type { CollectFinish } from "../../../models/cards.ts";
import { formatPrice } from "../../../utils/format.ts";

/** One printing a pasted list would mark owned. */
export interface AddEntry {
  cardId: string;
  finish: CollectFinish;
  setId: string;
  number: string;
  /** Unit price in USD as the preview row shows it; absent when unpriced. Never stored. */
  price?: number;
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

/**
 * The preview headline: what the Add button will do, in one line.
 * "2 cards to add · $99.59 · 1 unpriced · 3 not recognised". The value sums
 * only priced cards that would be added; with none priced it is left out.
 */
export function summarisePreview(
  matched: readonly AddEntry[],
  toAdd: readonly AddEntry[],
  notRecognised: number,
): string {
  const parts = [`${toAdd.length} ${toAdd.length === 1 ? "card" : "cards"} to add`];
  const owned = new Set(matched.map((e) => `${e.cardId}|${e.finish}`)).size - toAdd.length;
  if (owned > 0) parts.push(`${owned} already owned`);
  const priced = toAdd.filter((e) => e.price !== undefined);
  if (priced.length > 0) {
    const cents = priced.reduce((sum, e) => sum + Math.round((e.price ?? 0) * 100), 0);
    parts.push(formatPrice(cents / 100));
    if (priced.length < toAdd.length) parts.push(`${toAdd.length - priced.length} unpriced`);
  }
  if (notRecognised > 0) parts.push(`${notRecognised} not recognised`);
  return parts.join(" · ");
}

export const asOwned = (entries: readonly AddEntry[], owned: boolean): OwnedEntry[] =>
  entries.map((e) => ({ ...e, owned }));
