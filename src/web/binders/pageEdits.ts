import type { Binder } from "../../models/binderLayout.ts";

/*
 * Page edits in the middle of a binder.
 *
 * The toolbar's Add page / Remove page only ever touch the END, which is fine
 * for a binder filled front to back and useless for one kept in order: a new
 * set that belongs at page 5 meant adding a page at the end and then dragging
 * every card after the gap down by a page, one pocket at a time. These are the
 * ring-binder move — clip a blank sleeve page in where it belongs.
 *
 * Here rather than in models/binderLayout.ts on purpose: that file is shared
 * with the server (tsconfig.node.json), and nothing here is a rule the server
 * needs. The stored shape is unchanged — still `{ pages: [{ slots }] }`.
 */

/**
 * A blank page at `index`; the page that was there, and every one after it,
 * moves back by one. `index === pages.length` is the same as adding one at the
 * end. Anything outside that range returns the binder unchanged.
 */
export function insertPageBefore(binder: Binder, index: number, now: number): Binder {
  if (!Number.isInteger(index) || index < 0 || index > binder.pages.length) return binder;
  const pages = [...binder.pages.slice(0, index), { slots: {} }, ...binder.pages.slice(index)];
  return { ...binder, pages, updatedAt: now };
}

/**
 * True when page `index` holds nothing and is not the only page.
 *
 * The same rule as canRemoveLastPage, anywhere in the binder: a page with a
 * card in it is never removed, because there is no undo and the card would go
 * with it.
 */
export function canRemovePage(binder: Binder, index: number): boolean {
  const page = Number.isInteger(index) ? binder.pages[index] : undefined;
  return binder.pages.length > 1 && !!page && Object.keys(page.slots).length === 0;
}

/** Drop page `index` if it is empty; later pages move up by one. Refused otherwise. */
export function removePage(binder: Binder, index: number, now: number): Binder {
  if (!canRemovePage(binder, index)) return binder;
  const pages = binder.pages.filter((_, i) => i !== index);
  return { ...binder, pages, updatedAt: now };
}
