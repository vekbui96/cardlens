import type { CollectFinish } from "../models/cards.ts";

/**
 * The collection as an OR-Set of (card, finish) rows.
 *
 * Why not a plain list of owned cards: two devices editing while offline must
 * converge without a server arbitrating, and "I deleted this" has to outrank a
 * stale "I own this" regardless of which order the two arrive in. A removal is
 * therefore a tombstone (`deletedAt`), never a missing row — a missing row is
 * indistinguishable from "never seen", which would let a deletion silently
 * resurrect on the next sync.
 *
 * The merge is order-independent and idempotent, so syncing twice, out of
 * order, or after a fortnight offline all reach the same state.
 */
export interface OwnedPrinting {
  cardId: string;
  setId: string;
  finish: CollectFinish;
  /** When this printing was marked owned. */
  at: number;
  /** When it was un-marked. Present means "not owned", not "never owned". */
  deletedAt?: number;
}

/** Tombstones older than this are dropped — see pruneTombstones. */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60_000;

export function printingKey(cardId: string, finish: CollectFinish): string {
  return `${cardId}|${finish}`;
}

export function isLive(row: OwnedPrinting): boolean {
  return row.at > (row.deletedAt ?? 0);
}

/** The row's last write, whichever kind it was. */
function stamp(row: OwnedPrinting): number {
  return Math.max(row.at, row.deletedAt ?? 0);
}

/**
 * Pick the winner between two versions of the same (card, finish).
 *
 * Ties go to the tombstone: if a mark and an un-mark carry the same timestamp
 * the user's last intent is unknowable, and re-adding a card is a one-gesture
 * fix whereas silently resurrecting a deleted one is invisible.
 */
function pickWinner(a: OwnedPrinting, b: OwnedPrinting): OwnedPrinting {
  const sa = stamp(a);
  const sb = stamp(b);
  if (sa !== sb) return sa > sb ? a : b;
  if (isLive(a) !== isLive(b)) return isLive(a) ? b : a;
  return a;
}

/**
 * Merge row sets into one convergent set. Pure and commutative: callers can
 * merge local-into-remote or remote-into-local and get the same answer.
 */
export function mergePrintings(...sets: OwnedPrinting[][]): OwnedPrinting[] {
  const winners = new Map<string, OwnedPrinting>();
  for (const rows of sets) {
    for (const row of rows) {
      const key = printingKey(row.cardId, row.finish);
      const existing = winners.get(key);
      winners.set(key, existing ? pickWinner(existing, row) : row);
    }
  }
  return [...winners.values()];
}

/**
 * Drop tombstones that are old enough that every device has certainly seen
 * them. Keeping them forever would grow the payload without bound; dropping
 * them too early would let a long-offline device resurrect a deleted card.
 */
export function pruneTombstones(rows: OwnedPrinting[], now = Date.now()): OwnedPrinting[] {
  return rows.filter((r) => isLive(r) || now - (r.deletedAt ?? 0) < TOMBSTONE_TTL_MS);
}

/** Rows the user currently owns, tombstones excluded. */
export function livePrintings(rows: OwnedPrinting[]): OwnedPrinting[] {
  return rows.filter(isLive);
}
