import type { CollectFinish } from "./cards.ts";

/**
 * A binder you arrange yourself.
 *
 * Distinct from `models/binder.ts`, which pages the WHOLE set in collector
 * order — that answers "how far through this set am I". This answers "what do
 * I want in my Vault X, in what order", which is a different object: it holds
 * cards from any set, in any position, including empty pockets kept on purpose
 * and cards you do not own yet.
 *
 * Positions are explicit and sparse. A slot is addressed by page and index, so
 * moving one card never renumbers the others — the thing that makes an
 * array-of-cards model fall apart the moment you insert in the middle.
 */

/** The Vault X formats, as pockets per page side. */
export type BinderFormat = "9" | "12";

export interface BinderSpec {
  format: BinderFormat;
  label: string;
  cols: number;
  rows: number;
  pockets: number;
}

/**
 * Columns × rows per page side.
 *
 * 9-pocket is 3×3. 12-pocket is 4×3 — four across, three down — which is worth
 * stating because a 12-pocket could equally be 3×4 and the difference decides
 * whether a page reads in rows of four or rows of three.
 */
export const BINDER_SPECS: Record<BinderFormat, BinderSpec> = {
  "9": { format: "9", label: "9-pocket", cols: 3, rows: 3, pockets: 9 },
  "12": { format: "12", label: "12-pocket", cols: 4, rows: 3, pockets: 12 },
};

/** A card from the catalog, owned or not. */
export interface CardSlot {
  kind: "card";
  cardId: string;
  finish: CollectFinish;
  /** Denormalised so a page renders before the catalog answers, and offline. */
  name?: string;
  imageSmall?: string;
  collectorNumber?: string;
}

/** Anything that is not a catalog card — a photo, a divider, a proxy. */
export interface ImageSlot {
  kind: "image";
  /**
   * A server-held image, by id. Resolved to a URL at render time rather than
   * stored as one: the binder syncs between devices that reach the server on
   * different origins (a phone on the funnel, a dev build on localhost), and a
   * baked-in absolute URL would break on all but the device that uploaded it.
   *
   * It is also what keeps binder sync small. A binder is pushed whole on every
   * edit, so an inline data URI would put megabytes through an endpoint sized
   * for card rows — and into a localStorage budget this app has already
   * exhausted once.
   */
  imageId?: string;
  /** A URL or data URI, for an image the server does not hold. */
  src?: string;
  label?: string;
}

export type BinderSlot = CardSlot | ImageSlot;

export interface BinderPage {
  /** Sparse: index -> slot. A missing index is an empty pocket, kept on purpose. */
  slots: Record<number, BinderSlot>;
}

export interface Binder {
  id: string;
  name: string;
  format: BinderFormat;
  pages: BinderPage[];
  createdAt: number;
  /** Last edit. The sync watermark and the last-write-wins key — see storage/binders.ts. */
  updatedAt: number;
  /**
   * When it was deleted. Present means gone, not "never existed".
   *
   * Same reasoning as the collection's tombstones: an absent binder is
   * indistinguishable from one this device has never seen, so deleting on the
   * phone and then syncing from the laptop would bring it straight back.
   */
  deletedAt?: number;
}

export function specFor(format: BinderFormat): BinderSpec {
  return BINDER_SPECS[format] ?? BINDER_SPECS["9"];
}

export function emptyBinder(id: string, name: string, format: BinderFormat, now: number): Binder {
  return { id, name, format, pages: [{ slots: {} }], createdAt: now, updatedAt: now };
}

/** Key for a card slot, matching the collection's (card, finish) identity. */
export function slotKey(slot: BinderSlot): string {
  if (slot.kind === "card") return `${slot.cardId}|${slot.finish}`;
  return `img|${slot.imageId ?? slot.src?.slice(0, 64) ?? ""}`;
}

/**
 * Put a slot at a position, growing the binder if the page does not exist yet.
 *
 * Pure: returns a new binder. Placing onto an occupied pocket REPLACES it,
 * because that is what dropping a card into a full pocket means physically —
 * there is no third state where two cards share one.
 */
export function placeSlot(
  binder: Binder,
  page: number,
  index: number,
  slot: BinderSlot | null,
  now: number,
): Binder {
  const spec = specFor(binder.format);
  if (page < 0 || index < 0 || index >= spec.pockets) return binder;

  const pages = binder.pages.map((p) => ({ slots: { ...p.slots } }));
  while (pages.length <= page) pages.push({ slots: {} });

  if (slot === null) delete pages[page].slots[index];
  else pages[page].slots[index] = slot;

  return { ...binder, pages, updatedAt: now };
}

/**
 * The first empty pocket AFTER a position, or null once the binder is full.
 *
 * Filling a binder is a sequence, not a series of unrelated edits: the pocket
 * stayed selected after a place, so every card picked after the first replaced
 * the one before it and the binder never grew past a single card. Nothing said
 * so, which reads exactly like the picker refusing to add anything.
 *
 * Forward only — never wrapping to the start. A pocket left empty behind the
 * cursor was skipped on purpose as often as by accident (a card being chased,
 * a run kept together), and jumping backwards would drop the next card
 * somewhere the user is not looking.
 */
export function nextEmptyPocket(
  binder: Binder,
  from: { page: number; index: number },
): { page: number; index: number } | null {
  const spec = specFor(binder.format);
  for (let page = from.page, index = from.index + 1; page < binder.pages.length; page++, index = 0) {
    for (; index < spec.pockets; index++) {
      if (!binder.pages[page]?.slots[index]) return { page, index };
    }
  }
  return null;
}

/**
 * Group page indices the way a physical binder falls open.
 *
 * Page 1 is alone: opening the cover shows one page, because there is nothing
 * to its left. After that pages come in twos — 2|3, 4|5 — so a spread is always
 * an EVEN page on the left and the ODD one that follows on its right. A binder
 * with an even number of pages therefore ends on a half spread, the last page
 * sitting on the left with its right side still to be filled.
 *
 * Returned as index pairs rather than rendered directly because the pairing is
 * the part worth testing: it is off-by-one in three places at once, and getting
 * it wrong shows a binder that reads 1|2, 3|4 — which is every page facing the
 * wrong neighbour.
 */
export function toSpreads(pageCount: number): number[][] {
  if (pageCount <= 0) return [];
  const spreads: number[][] = [[0]];
  for (let i = 1; i < pageCount; i += 2) {
    spreads.push(i + 1 < pageCount ? [i, i + 1] : [i]);
  }
  return spreads;
}

/** Move a slot between pockets, including across pages. Swaps if the target is full. */
export function moveSlot(
  binder: Binder,
  from: { page: number; index: number },
  to: { page: number; index: number },
  now: number,
): Binder {
  const source = binder.pages[from.page]?.slots[from.index];
  if (!source) return binder;
  const target = binder.pages[to.page]?.slots[to.index];

  // Swap rather than overwrite: dragging onto a full pocket in a real binder
  // means the two change places, and silently destroying the target is the
  // kind of loss that has no undo.
  let next = placeSlot(binder, to.page, to.index, source, now);
  next = placeSlot(next, from.page, from.index, target ?? null, now);
  return next;
}

/**
 * Append an empty page.
 *
 * Its own function rather than `placeSlot(binder, pages.length, 0, null)`,
 * which is what the screen used to do: that grows the binder and then writes
 * nothing into it, so the page is empty and indistinguishable from one left
 * over — and a trailing-empty-page trim removed it again on the very same commit.
 * The button did nothing at all, silently. An intent the user pressed a button
 * for has to be expressible.
 */
export function addPage(binder: Binder, now: number): Binder {
  return { ...binder, pages: [...binder.pages, { slots: {} }], updatedAt: now };
}

/** True when the last page holds nothing and is not the only page. */
export function canRemoveLastPage(binder: Binder): boolean {
  const last = binder.pages[binder.pages.length - 1];
  return binder.pages.length > 1 && !!last && Object.keys(last.slots).length === 0;
}

/**
 * Drop the last page, if it is empty.
 *
 * The inverse of addPage, and the reason trimming is no longer automatic: a
 * blank page kept on purpose and a blank page left over look identical, so the
 * app cannot tell them apart and must not guess. Deciding is one button press.
 */
export function removeLastPage(binder: Binder, now: number): Binder {
  if (!canRemoveLastPage(binder)) return binder;
  return { ...binder, pages: binder.pages.slice(0, -1), updatedAt: now };
}

/**
 * One printing per card, for filling a binder with a single copy of each.
 *
 * Reverse holo first: in a modern set almost every ordinary card has one, and
 * a reverse-holo run is the usual way a master-setter sleeves a binder. The
 * cards that have no reverse are the ex / full-art tier, which come holo — so
 * holo is the fallback, and plain normal only when a card has neither.
 */
export function preferredFinish(available: CollectFinish[]): CollectFinish | null {
  if (available.length === 0) return null;
  return (
    available.find((f) => f === "reverse") ??
    available.find((f) => f.startsWith("reverse")) ??
    available.find((f) => f === "holo") ??
    available.find((f) => f.startsWith("holo")) ??
    available[0]
  );
}

/**
 * Lay slots into pockets in order, page after page, from pocket zero.
 *
 * Replaces the binder's pages rather than appending: "fill from this set" is a
 * statement about the whole binder, and merging into whatever was there would
 * make the result depend on history the user cannot see.
 */
export function fillSequential(binder: Binder, slots: BinderSlot[], now: number): Binder {
  const spec = specFor(binder.format);
  const pages: BinderPage[] = [];
  slots.forEach((slot, i) => {
    const page = Math.floor(i / spec.pockets);
    while (pages.length <= page) pages.push({ slots: {} });
    pages[page].slots[i % spec.pockets] = slot;
  });
  if (pages.length === 0) pages.push({ slots: {} });
  return { ...binder, pages, updatedAt: now };
}

export interface BinderCounts {
  filled: number;
  pockets: number;
  cards: number;
  images: number;
}

export function countBinder(binder: Binder): BinderCounts {
  const spec = specFor(binder.format);
  let cards = 0;
  let images = 0;
  for (const page of binder.pages) {
    for (const slot of Object.values(page.slots)) {
      if (slot.kind === "card") cards++;
      else images++;
    }
  }
  return { filled: cards + images, pockets: binder.pages.length * spec.pockets, cards, images };
}

/**
 * Re-flow a binder into a different format.
 *
 * Reading order is preserved — page by page, pocket by pocket — because that
 * is the one property a collector actually cares about when they move a
 * collection between binders. Positions cannot be kept: a 4-wide page has no
 * pocket that corresponds to the 9th of a 3-wide one.
 */
export function reformat(binder: Binder, format: BinderFormat, now: number): Binder {
  if (format === binder.format) return binder;
  const spec = specFor(binder.format);
  const next = specFor(format);

  const ordered: BinderSlot[] = [];
  for (const page of binder.pages) {
    for (let i = 0; i < spec.pockets; i++) {
      const slot = page.slots[i];
      if (slot) ordered.push(slot);
    }
  }

  const pages: BinderPage[] = [];
  ordered.forEach((slot, i) => {
    const page = Math.floor(i / next.pockets);
    while (pages.length <= page) pages.push({ slots: {} });
    pages[page].slots[i % next.pockets] = slot;
  });
  if (pages.length === 0) pages.push({ slots: {} });

  return { ...binder, format, pages, updatedAt: now };
}
