import { nextEmptyPocket, putAt } from "../../models/binderLayout.ts";
import type { Binder, CardSlot, PocketAddress } from "../../models/binderLayout.ts";

/**
 * Put one printing in a binder's first empty pocket, from outside the binder.
 *
 * The card sheet's answer to "I just found the card I want in my Pikachu
 * binder": without it, a card could enter a binder only from inside that
 * binder, by searching for it again by name.
 *
 * Kept here, client-only, over the shared helpers rather than added to
 * `models/binderLayout.ts`: that file is compiled by the server too, and this
 * decides nothing the server needs to agree on. It writes the same `CardSlot`
 * the binder's own search writes, through the same `putAt`.
 *
 * Refuses rather than doing something surprising, and says why:
 *  - a full binder is NOT grown — blank pages are only ever added by the user;
 *  - a printing already in the binder is not placed twice. A second copy is a
 *    quantity on the pocket that holds it, and stacking a silent duplicate
 *    elsewhere would read as the binder miscounting.
 */
export type PutInBinderResult =
  | { ok: true; binder: Binder; at: PocketAddress }
  | { ok: false; reason: "full" | "already"; at?: PocketAddress };

/** Where this exact printing already sits in the binder's pages, if anywhere. */
export function findPrinting(binder: Binder, cardId: string, finish: string): PocketAddress | null {
  for (let page = 0; page < binder.pages.length; page++) {
    const slots = binder.pages[page]?.slots ?? {};
    for (const [key, slot] of Object.entries(slots)) {
      if (slot.kind === "card" && slot.cardId === cardId && slot.finish === finish) {
        return { kind: "pocket", page, index: Number(key) };
      }
    }
  }
  return null;
}

export function putInBinder(binder: Binder, slot: CardSlot, now: number): PutInBinderResult {
  const existing = findPrinting(binder, slot.cardId, slot.finish);
  if (existing) return { ok: false, reason: "already", at: existing };
  // From "just before pocket 0 of page 1", so the search starts AT the first pocket.
  const at = nextEmptyPocket(binder, { page: 0, index: -1 });
  if (!at) return { ok: false, reason: "full" };
  return { ok: true, binder: putAt(binder, at, slot, now), at };
}

/** "page 3, pocket 5" — one-based, the way a collector counts sleeves. */
export function describePocket(at: PocketAddress): string {
  return `page ${at.page + 1}, pocket ${at.index + 1}`;
}
