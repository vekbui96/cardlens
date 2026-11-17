import type { CollectFinish } from "../../models/cards.ts";

/**
 * Whether a scanned row is something the collection already holds.
 *
 * Per PRINTING, because that is what a scan adds: owning the Normal says
 * nothing about the Reverse, and a collector sorting a pile wants to know which
 * of the two is the new one. Read-only. The scanner still adds every kept row
 * exactly as before; adding a printing that is already held changes nothing,
 * which is why this only informs and never filters.
 */
export type ScanOwnership = "this-printing" | "other-printing" | "new";

export interface OwnershipLookup {
  isOwned: (id: string) => boolean;
  isOwnedFinish: (id: string, finish: CollectFinish) => boolean;
}

export function scanOwnership(
  cardId: string,
  finish: CollectFinish,
  library: OwnershipLookup,
): ScanOwnership {
  if (library.isOwnedFinish(cardId, finish)) return "this-printing";
  return library.isOwned(cardId) ? "other-printing" : "new";
}

export function ownedNote(state: ScanOwnership): string | null {
  switch (state) {
    case "this-printing":
      return "Already in your collection";
    case "other-printing":
      return "You have this card in another printing";
    case "new":
      return null;
  }
}

/** The review footer's line; nothing when none of the batch is held. */
export function alreadyOwnedSummary(owned: number, adding: number): string | null {
  if (owned <= 0) return null;
  return `${owned} of ${adding} already in your collection`;
}
