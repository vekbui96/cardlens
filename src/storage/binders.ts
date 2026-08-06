import type { Binder } from "../models/binderLayout.ts";
import { TOMBSTONE_TTL_MS } from "./printings.ts";

/**
 * Binders converge per BINDER, last write wins.
 *
 * Deliberately NOT the OR-Set the collection uses. The collection merges per
 * (card, finish) because the two devices are making independent statements
 * about independent things — marking a card on the phone and another on the
 * glasses should both survive. A binder is one artefact: pocket 4 of page 2
 * holds exactly one card, and two devices that disagree about it are not both
 * right. Merging pocket by pocket would produce a page neither person laid out,
 * which is worse than losing the older of two edits.
 *
 * Granularity is the whole point of doing it per binder rather than per
 * collection: editing DIFFERENT binders on two devices never conflicts at all,
 * which is the case that actually happens. Only concurrent edits to the SAME
 * binder lose, and there the newer arrangement is the one the user last meant.
 *
 * Same file is used by the server (see tsconfig.node.json) rather than
 * reimplemented there — two copies of a convergence rule that drift is how a
 * sync system starts losing data.
 */

/** The binder's last write, whichever kind it was. Also the sync watermark. */
export function binderStamp(binder: Binder): number {
  return Math.max(binder.updatedAt, binder.deletedAt ?? 0);
}

export function isLiveBinder(binder: Binder): boolean {
  return binder.updatedAt > (binder.deletedAt ?? 0);
}

/**
 * A deletion, carrying no pages.
 *
 * The record survives so the id can never be reissued and a stale device cannot
 * resurrect it, but its contents do not: a tombstone that kept its pages would
 * hold every deleted binder in the sync payload forever, and the pages are the
 * expensive part.
 */
export function binderTombstone(binder: Binder, now: number): Binder {
  return { ...binder, pages: [], deletedAt: now };
}

/**
 * Pick between two versions of one binder.
 *
 * Ties go to the tombstone, matching the collection's rule and for the same
 * reason: when a delete and an edit carry the same millisecond the user's last
 * intent is unknowable, and re-creating a binder is visible work whereas
 * silently resurrecting a deleted one is invisible. Same-millisecond ties are
 * not hypothetical here — deleting a binder writes its tombstone in the same
 * tick the screen last saved it.
 */
function pickWinner(a: Binder, b: Binder): Binder {
  const sa = binderStamp(a);
  const sb = binderStamp(b);
  if (sa !== sb) return sa > sb ? a : b;
  if (isLiveBinder(a) !== isLiveBinder(b)) return isLiveBinder(a) ? b : a;
  return a;
}

/** Merge binder sets into one convergent set. Pure, commutative, idempotent. */
export function mergeBinders(...sets: Binder[][]): Binder[] {
  const winners = new Map<string, Binder>();
  for (const binders of sets) {
    for (const binder of binders) {
      const existing = winners.get(binder.id);
      winners.set(binder.id, existing ? pickWinner(existing, binder) : binder);
    }
  }
  return [...winners.values()];
}

/**
 * Drop tombstones old enough that every device has certainly seen them. Same
 * 180 days as the collection, for the same reason — dropping them earlier lets
 * a long-offline device bring a deleted binder back.
 */
export function pruneBinderTombstones(binders: Binder[], now = Date.now()): Binder[] {
  return binders.filter((b) => isLiveBinder(b) || now - (b.deletedAt ?? 0) < TOMBSTONE_TTL_MS);
}

/** Binders that still exist, newest edit first — the order the list screen shows. */
export function liveBinders(binders: Binder[]): Binder[] {
  return binders.filter(isLiveBinder).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Binders changed locally since the last successful push. */
export function pendingBinders(binders: Binder[], lastPushedAt: number): Binder[] {
  return binders.filter((b) => binderStamp(b) > lastPushedAt);
}

/**
 * Every server-held image referenced by these binders.
 *
 * The uploader is not the owner: an image lands on the server before the binder
 * that points at it is ever pushed, and the same image can sit in two binders.
 * So "is this image still wanted" is only answerable from the binders, which is
 * why this lives beside the merge rule rather than in the image store.
 */
export function referencedImageIds(binders: Binder[]): Set<string> {
  const ids = new Set<string>();
  for (const binder of binders) {
    if (!isLiveBinder(binder)) continue;
    for (const page of binder.pages) {
      for (const slot of Object.values(page.slots)) {
        if (slot.kind === "image" && slot.imageId) ids.add(slot.imageId);
      }
    }
  }
  return ids;
}
