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
export type BinderFormat = "4" | "9" | "12";
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
 * 4-pocket is 2×2. 9-pocket is 3×3. 12-pocket is 4×3 — four across, three down —
 * which is worth stating because a 12-pocket could equally be 3×4 and the
 * difference decides whether a page reads in rows of four or rows of three.
 */
export const BINDER_SPECS: Record<BinderFormat, BinderSpec> = {
  "4": { format: "4", label: "4-pocket", cols: 2, rows: 2, pockets: 4 },
  "9": { format: "9", label: "9-pocket", cols: 3, rows: 3, pockets: 9 },
  "12": { format: "12", label: "12-pocket", cols: 4, rows: 3, pockets: 12 },
};

/** Every format, in the order the pickers offer them. */
export const BINDER_FORMATS: readonly BinderFormat[] = ["4", "9", "12"];

/** Narrows an untrusted value to a known format. The one gate on ingest. */
export function isBinderFormat(value: unknown): value is BinderFormat {
  return typeof value === "string" && (BINDER_FORMATS as readonly string[]).includes(value);
}
/**
 * Whether this format is read as facing pages.
 *
 * 4-pocket is not, and that is a real difference rather than a preference. Its
 * page is two columns wide, so two of them side by side read as one four-across
 * grid — which is precisely what a 12-pocket page looks like, and the two would
 * be indistinguishable at a glance. A 4-pocket binder also holds the big cards
 * (jumbo promos, top-loaders), so halving the width to fit a facing page throws
 * away the one thing the format is for.
 */
export function hasFacingPages(format: BinderFormat): boolean {
  return format !== "4";
}
/**
 * How a card is graded, in the vocabulary a trade is actually negotiated in.
 *
 * Recorded, and deliberately NEVER applied to a price. The oracles publish one
 * market price per printing and say nothing about what condition it assumes, so
 * any multiplier here — "LP is 85% of NM" — would be a number this app invented
 * and then presented beside real ones. The condition is shown next to the price
 * and the two are left to the people trading, which is where that judgement
 * belongs anyway.
 *
 * Absent means unstated, which is not the same as near mint: a binder filled
 * before this existed must not start claiming every card in it is NM.
 */
export type TradeCondition = "NM" | "LP" | "MP" | "HP" | "DMG";

export const TRADE_CONDITIONS: readonly TradeCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

const CONDITION_LABELS: Record<TradeCondition, string> = {
  NM: "Near mint",
  LP: "Lightly played",
  MP: "Moderately played",
  HP: "Heavily played",
  DMG: "Damaged",
};

export function conditionLabel(condition: TradeCondition): string {
  return CONDITION_LABELS[condition] ?? condition;
}

export function isTradeCondition(value: unknown): value is TradeCondition {
  return typeof value === "string" && (TRADE_CONDITIONS as readonly string[]).includes(value);
}

/**
 * Bound on copies in one pocket. Generous against a real bulk pocket, absurd
 * against abuse — the same rule the rest of the sync payload is sized by.
 */
export const MAX_SLOT_QUANTITY = 999;

/** A card from the catalog, owned or not. */
export interface CardSlot {
  kind: "card";
  cardId: string;
  finish: CollectFinish;
  /** Denormalised so a page renders before the catalog answers, and offline. */
  name?: string;
  imageSmall?: string;
  collectorNumber?: string;
  /**
   * Copies of this printing behind the one pocket, for a binder held open to
   * be traded from. Absent means one.
   *
   * Absent rather than defaulted to 1 on write, because every binder that
   * already exists has no quantity at all and re-writing them to say "1" would
   * touch `updatedAt` on all of them and push the lot through sync to record
   * nothing. `slotQuantity` is the only reader.
   */
  quantity?: number;
  /** Unstated when absent. See TradeCondition — it never changes a price. */
  condition?: TradeCondition;
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
  /**
   * This binder is what the owner will trade away, not what they are keeping.
   *
   * A flag on the binder rather than a separate kind of object, because the
   * two are the same artefact: collectors build a trade binder in exactly the
   * way they build any other, and a set binder becomes a trade binder the
   * afternoon they decide to sell it. Making it a type would mean two screens,
   * two sync paths and two merge rules for one thing.
   *
   * It changes what the binder AFFORDS — quantities, conditions, a shareable
   * link priced per copy — never what it can hold.
   */
  forTrade?: boolean;
  /**
   * Show what this binder is worth on the binders list, one screen up.
   *
   * Off by default, and opt-in per binder rather than a global preference,
   * because the cost is per binder and so is the interest. Pricing one binder
   * means asking the printings oracle once for every SET it touches — the Riolu
   * binder alone spans thirty — and the list screen currently asks for nothing
   * at all. A collector wants the total on the two or three binders that
   * represent money, not on the master-set binder they are still filling.
   */
  showValue?: boolean;
  /**
   * What shows through the window on the front of the binder.
   *
   * NOT a page and not a pocket. It holds no position, it is excluded from
   * `countBinder` — a cover is not one of the 28 pockets you are filling — and
   * `reformat` leaves it alone, because moving a binder from 9-pocket to
   * 12-pocket re-flows the contents and a cover is not contents.
   *
   * Any slot, so it can be a card you own or an uploaded photo. See setCover
   * for why it is absent rather than null when empty.
   */
  cover?: BinderSlot;
  createdAt: number; /** Last edit. The sync watermark and the last-write-wins key — see storage/binders.ts. */
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
 * Copies behind a pocket. One unless the pocket says otherwise.
 *
 * The single reader of `quantity`, so "absent means one" is stated once. A
 * fractional or negative count is treated as one rather than dropped: it can
 * only arrive from a hand-edited file or a future client, and a pocket that
 * silently values at zero is the failure this codebase keeps being bitten by.
 */
export function slotQuantity(slot: BinderSlot): number {
  if (slot.kind !== "card") return 1;
  const n = slot.quantity;
  if (typeof n !== "number" || !Number.isFinite(n)) return 1;
  return Math.min(MAX_SLOT_QUANTITY, Math.max(1, Math.floor(n)));
}

/**
 * A pocket holding a different number of copies.
 *
 * One copy is written as no `quantity` at all rather than `quantity: 1`, so
 * counting a pocket back down to one leaves the slot byte-identical to one that
 * never carried a quantity. Two ways to say the same thing is how a merge rule
 * starts producing spurious conflicts.
 */
export function withQuantity(slot: CardSlot, quantity: number): CardSlot {
  const n = Math.min(MAX_SLOT_QUANTITY, Math.max(1, Math.floor(quantity)));
  const { quantity: _dropped, ...rest } = slot;
  return n === 1 ? rest : { ...rest, quantity: n };
}

/** A pocket graded, or ungraded again when passed null. */
export function withCondition(slot: CardSlot, condition: TradeCondition | null): CardSlot {
  const { condition: _dropped, ...rest } = slot;
  return condition ? { ...rest, condition } : rest;
}

/** Turn trading on or off for a whole binder. */
export function setForTrade(binder: Binder, forTrade: boolean, now: number): Binder {
  if (Boolean(binder.forTrade) === forTrade) return binder;
  const { forTrade: _dropped, ...rest } = binder;
  return forTrade ? { ...rest, forTrade: true, updatedAt: now } : { ...rest, updatedAt: now };
}

/**
 * Show or hide this binder's total on the list screen.
 *
 * Returns the binder UNCHANGED when the flag already holds that value, like
 * setForTrade: saving pushes a binder through sync, and toggling to what it
 * already says would manufacture an edit for every other device to pull.
 */
export function setShowValue(binder: Binder, showValue: boolean, now: number): Binder {
  if (Boolean(binder.showValue) === showValue) return binder;
  const { showValue: _dropped, ...rest } = binder;
  return showValue ? { ...rest, showValue: true, updatedAt: now } : { ...rest, updatedAt: now };
} /**
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
export function nextEmptyPocket(binder: Binder, from: { page: number; index: number }): PocketAddress | null {
  const spec = specFor(binder.format);
  for (let page = from.page, index = from.index + 1; page < binder.pages.length; page++, index = 0) {
    for (; index < spec.pockets; index++) {
      if (!binder.pages[page]?.slots[index]) return { kind: "pocket", page, index };
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

/**
 * How a binder's pages are grouped for display, given its format.
 *
 * The one call every screen should make. `toSpreads` answers the harder half —
 * the off-by-one pairing that puts page 1 alone against the inside cover — and
 * is kept separate because that is the part worth testing on its own; this
 * decides whether pairing applies at all.
 *
 * A 4-pocket binder is read one page at a time. See hasFacingPages.
 */
export function pageGroups(pageCount: number, format: BinderFormat): number[][] {
  if (hasFacingPages(format)) return toSpreads(pageCount);
  return Array.from({ length: Math.max(0, pageCount) }, (_, i) => [i]);
}
/**
 * Every place a slot can live: a pocket on a page, or the binder's cover.
 *
 * A tagged address rather than a nullable page number, because the cover is
 * genuinely not a pocket — it has no index, it is not counted in `filled`, and
 * a sentinel like `page: -1` would flow into `placeSlot` and `nextEmptyPocket`
 * as a number those functions would happily do arithmetic on.
 */
export type PocketAddress = { kind: "pocket"; page: number; index: number };
export type BinderAddress = PocketAddress | { kind: "cover" };

export function sameAddress(a: BinderAddress, b: BinderAddress): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "cover" || b.kind === "cover") return true;
  return a.page === b.page && a.index === b.index;
}

/**
 * An address as a DOM attribute value, and back.
 *
 * One string does two jobs that must not disagree: it is what `data-pocket`
 * carries, which is how a drag finds what it is hovering over
 * (`elementFromPoint(...).closest("[data-pocket]")`), and it is how the screen
 * scrolls the selected pocket back into view. Two encodings would mean a drag
 * that lands somewhere the scroller cannot find.
 */
export function addressKey(at: BinderAddress): string {
  return at.kind === "cover" ? "cover" : `${at.page}:${at.index}`;
}

export function parseAddressKey(key: string | null | undefined): BinderAddress | null {
  if (!key) return null;
  if (key === "cover") return { kind: "cover" };
  const [page, index] = key.split(":").map(Number);
  if (!Number.isInteger(page) || !Number.isInteger(index) || page < 0 || index < 0) return null;
  return { kind: "pocket", page, index };
}

/** What is at an address, or null. The one reader of both storage shapes. */
export function slotAt(binder: Binder, at: BinderAddress): BinderSlot | null {
  if (at.kind === "cover") return binder.cover ?? null;
  return binder.pages[at.page]?.slots[at.index] ?? null;
}

/** Write to an address. Dispatches to the cover or to a pocket; nothing else should. */
export function putAt(binder: Binder, at: BinderAddress, slot: BinderSlot | null, now: number): Binder {
  if (at.kind === "cover") return setCover(binder, slot, now);
  return placeSlot(binder, at.page, at.index, slot, now);
}

/**
 * What goes in the display window on the front of the binder.
 *
 * A field on the binder rather than a page, because it is not one: it holds no
 * position, it must not count towards "26/28 filled", and reformatting a binder
 * between 9 and 12 pockets must not re-flow it into the pages. A real binder's
 * cover sleeve works the same way — it is part of the binder, not part of the
 * contents.
 *
 * Absent when empty rather than `null`, so a binder whose cover was cleared is
 * byte-identical to one that never had a cover. Two ways to write the same
 * thing is how last-write-wins starts producing spurious conflicts — the same
 * reason `quantity: 1` and `forTrade: false` are never stored.
 */
export function setCover(binder: Binder, slot: BinderSlot | null, now: number): Binder {
  // Returned UNCHANGED when there is nothing to change, like setForTrade:
  // saving pushes the whole binder through sync, and clearing a cover that was
  // already empty would manufacture an edit for every other device to pull.
  if (!binder.cover && !slot) return binder;
  const { cover: _dropped, ...rest } = binder;
  return slot ? { ...rest, cover: slot, updatedAt: now } : { ...rest, updatedAt: now };
}

/**
 * Move a slot between any two addresses — pocket to pocket, across pages, or
 * on and off the cover. Swaps if the target is full.
 */
export function moveSlot(binder: Binder, from: BinderAddress, to: BinderAddress, now: number): Binder {
  const source = slotAt(binder, from);
  if (!source) return binder;
  // Dropping a card back where it came from is the commonest way a drag ends —
  // a press that moved a few pixels, or a change of mind. Without this the two
  // writes below cancel out to "put it there, then clear where it came from",
  // which is the same address: the card is destroyed by moving it nowhere.
  if (sameAddress(from, to)) return binder;
  const target = slotAt(binder, to);

  // Swap rather than overwrite: dragging onto a full pocket in a real binder
  // means the two change places, and silently destroying the target is the
  // kind of loss that has no undo.
  let next = putAt(binder, to, source, now);
  next = putAt(next, from, target, now);
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
  /**
   * Cards including duplicates, which is what a trade binder is counted in.
   *
   * Kept separate from `cards` rather than replacing it: "12 pockets" and "20
   * cards" answer different questions — how big the binder is, and how much is
   * in it — and a trade binder is the first thing here where they diverge.
   */
  copies: number;
}

export function countBinder(binder: Binder): BinderCounts {
  const spec = specFor(binder.format);
  let cards = 0;
  let images = 0;
  let copies = 0;
  for (const page of binder.pages) {
    for (const slot of Object.values(page.slots)) {
      if (slot.kind === "card") {
        cards++;
        copies += slotQuantity(slot);
      } else images++;
    }
  }
  return { filled: cards + images, pockets: binder.pages.length * spec.pockets, cards, images, copies };
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
