import {
  countBinder,
  specFor,
  type Binder,
  type BinderCounts,
  type BinderSlot,
  type BinderSpec,
} from "../../../models/binderLayout.ts";
import type { BinderValueSummary } from "../../../models/binderValue.ts";
import { imageSlotSrc } from "../../../services/sync/binderImages.ts";

/**
 * What a binder looks like on the shelf, as decisions rather than as markup.
 *
 * Every one of these was reachable only through a render before, which is why
 * "a full binder reads as empty" shipped twice. They are answers to questions —
 * which page stands for the binder, whether a pocket is empty or merely
 * artless, how wide a page of this format is — and each is wrong in a way you
 * can state, so each is worth a test that does not mount React.
 */

/** What one pocket of the cover mosaic draws. */
export type CoverPocket =
  /** Nothing in it. Drawn as an outline, because the gap is the fact. */
  | { kind: "empty" }
  /**
   * Something in it. `src` may still be absent — binders filled before
   * `imageSmall` was denormalised have slots with no art at all — and that is
   * NOT the same as an empty pocket. Drawn face-down, so a full binder cannot
   * report itself as an empty one.
   */
  | { kind: "card"; src?: string | undefined; name: string; owned: boolean };

/** The chosen cover, once it is known to resolve to something drawable. */
export interface ChosenCover {
  src: string;
  name: string;
  owned: boolean;
}

/** True when the collection holds this slot. Drives the shading only. */
export type Owns = (slot: BinderSlot) => boolean;

/** The art a slot carries, whichever kind of slot it is. No fetch either way. */
function slotSrc(slot: BinderSlot): string | undefined {
  return slot.kind === "card" ? slot.imageSmall : imageSlotSrc(slot);
}

function slotName(slot: BinderSlot): string {
  return (slot.kind === "card" ? slot.name : slot.label) ?? "";
}

/**
 * Which page stands for the binder.
 *
 * The first page that holds ANYTHING, not literally page 1. A binder with 23
 * pages and a card on page 3 would otherwise get a cover of twelve empty
 * pockets, which is both true and useless — every such binder looks identical.
 * Falling back to page 0 keeps a genuinely empty binder looking empty, which is
 * the one case where "nothing in it" is the fact worth showing.
 */
export function coverPageIndex(binder: Binder): number {
  const found = binder.pages.findIndex((page) => Object.keys(page.slots).length > 0);
  return found === -1 ? 0 : found;
}

/**
 * The cover the binder was GIVEN, if it can actually be drawn.
 *
 * Null when there is no cover, and null when the cover slot carries no art —
 * an unresolvable cover has to fall through to the page mosaic rather than
 * leave the tile blank, because the shelf's whole job is to show something.
 */
export function chosenCover(binder: Binder, owns: Owns): ChosenCover | null {
  const slot = binder.cover;
  if (!slot) return null;
  const src = slotSrc(slot);
  if (!src) return null;
  return { src, name: slotName(slot), owned: owns(slot) };
}

/**
 * Every pocket of the page that stands for the binder, in reading order.
 *
 * Always `spec.pockets` long, including the empty ones: a page is a page, and
 * a 12-pocket binder holding two cards has ten gaps that are part of what it
 * looks like.
 */
export function coverPockets(binder: Binder, owns: Owns): CoverPocket[] {
  const spec = specFor(binder.format);
  const page = binder.pages[coverPageIndex(binder)];
  return Array.from({ length: spec.pockets }, (_, index): CoverPocket => {
    const slot = page?.slots[index];
    if (!slot) return { kind: "empty" };
    return { kind: "card", src: slotSrc(slot), name: slotName(slot), owned: owns(slot) };
  });
}

/**
 * The shape of a page of this format, as a CSS aspect ratio.
 *
 * The PAGE carries the ratio, not the pocket. Every cover is drawn at one
 * height, so the shelf is a shelf — real binders stand the same height whatever
 * is filed in them. What differs is the WIDTH, because that is what actually
 * differs between the formats: a 12-pocket page is four cards across and a
 * 9-pocket page is three. Sizing the pocket instead and letting the page fall
 * out of it made a 4-pocket cover taller than a 12-pocket one, which is
 * backwards on a shelf.
 *
 * `cols x 5` by `rows x 7` is the card's 5:7 at page scale.
 */
export function pageAspect(spec: BinderSpec): string {
  return `${spec.cols * 5} / ${spec.rows * 7}`;
}

/**
 * The words the tile's button carries.
 *
 * The art beside it is decorative in full — `alt=""`, `aria-hidden` — so this
 * is the ONLY thing a screen reader gets, and it has to answer the same
 * question the picture does: which binder is this, what shape, and how far
 * along. A name alone would make nine binders nine identical stops.
 *
 * The value is deliberately absent: it arrives from the network some seconds
 * later, and an accessible name that changes under a focused control is read
 * out again as though something happened.
 */
export function tileLabel(binder: Binder, counts: BinderCounts = countBinder(binder)): string {
  const spec = specFor(binder.format);
  const parts = [binder.name, spec.label, `${counts.filled} of ${counts.pockets} pockets filled`];
  if (counts.pockets > 0 && counts.filled === counts.pockets) parts.push("complete");
  if (binder.forTrade) parts.push("for trade");
  return parts.join(", ");
}

/**
 * What shape the binder is, under how full it is.
 *
 * Two lines rather than one that wraps: "167/168 · 12-pocket · 14 pages" does
 * not fit a tile at any column count, and where it broke depended on the name
 * above it — which made a row of tiles ragged for no reason.
 *
 * Copies ride along only for a trade binder whose copies and pockets diverge.
 * Everywhere else the two are the same number and printing it twice says
 * nothing.
 */
export function metaLine(binder: Binder, counts: BinderCounts = countBinder(binder)): string {
  const spec = specFor(binder.format);
  const pages = `${binder.pages.length} page${binder.pages.length === 1 ? "" : "s"}`;
  const line = `${spec.label} · ${pages}`;
  if (binder.forTrade && counts.copies !== counts.cards) return `${line} · ${counts.copies} cards`;
  return line;
}

/**
 * Whether a binder's total is still in flight.
 *
 * The interesting half is the SECOND clause. A binder spans many sets and they
 * answer one at a time, so `isLoading` stays true long after the first prices
 * land. Waiting for all of them would hold "Pricing…" on a tile that already
 * knows most of its answer; showing a running total from zero would print a
 * number that then moves. So: pending only until something has actually been
 * priced, and a partial total afterwards — which is honest, because the
 * unpriced count is printed beside it.
 */
export function valuePending(summary: BinderValueSummary | undefined, loading: boolean): boolean {
  return !summary || (loading && summary.priced === 0);
}

/**
 * What the shelf holds, for the line under the heading.
 *
 * Cards rather than binders is the figure that grows: six binders is a number
 * that stops meaning anything, and the cards are the collection.
 */
export function shelfSummary(binders: Binder[]): string {
  const cards = binders.reduce((sum, b) => sum + countBinder(b).copies, 0);
  const shelf = `${binders.length} binder${binders.length === 1 ? "" : "s"}`;
  return `${shelf} · ${cards} card${cards === 1 ? "" : "s"}`;
}

/**
 * A new binder's id.
 *
 * Unique across DEVICES, not just this one, because the id is the key binders
 * converge on: two phones that both minted "b1" would merge into one binder and
 * the older arrangement would vanish. The clock alone is not enough — two
 * devices creating a binder in the same millisecond is unlikely, but the
 * failure is silent and permanent — so it carries randomness too.
 */
export function newBinderId(now: number = Date.now()): string {
  return `b${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
