import {
  countBinder,
  specFor,
  type Binder,
  type BinderCounts,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import type { BinderValueSummary } from "../../../models/binderValue.ts";
import { imageSlotSrc } from "../../../services/sync/binderImages.ts";

/**
 * What the shelf decides, with no React around it.
 *
 * A shelf answers one question — "which binder is that one" — and every
 * decision here is about answering it by sight. They are pulled out so the ones
 * with a plausible wrong answer can be asserted: which page stands for a
 * binder, what the fill figure counts, and when a total is allowed to be a
 * number at all.
 */

/** The art a slot resolves to, or nothing. Images live on the server, by id. */
export function slotSrc(slot: BinderSlot): string | undefined {
  return slot.kind === "card" ? slot.imageSmall : imageSlotSrc(slot);
}

export type CoverArt =
  /** A cover the owner deliberately put in the window on the front. */
  | { kind: "chosen"; slot: BinderSlot }
  /** A real page from the binder, gaps and all. Sparse: `undefined` is empty. */
  | { kind: "page"; slots: (BinderSlot | undefined)[] };

/**
 * What this binder looks like on the shelf.
 *
 * Two answers, in order of how much they were meant. A chosen cover is a
 * decision made one screen in, and the shelf is where it pays off. Failing
 * that, a real page — because it is the next most identifying thing and needs
 * no decision from anybody.
 *
 * The page is **the first one holding anything**, not literally page 1. A
 * binder with 23 pages and a card on page 3 would otherwise be represented by
 * twelve empty pockets, which is true and useless: every such binder looks
 * identical. Falling back to page 1 keeps a genuinely empty binder looking
 * empty, which is the one case where "nothing in it" is the fact worth showing.
 *
 * A chosen cover with no resolvable art falls back to the mosaic rather than
 * rendering face-down. The point of a cover is recognition, and a blank card is
 * less recognisable than the binder's own contents.
 */
export function coverArt(binder: Binder): CoverArt {
  if (binder.cover && slotSrc(binder.cover)) return { kind: "chosen", slot: binder.cover };

  const spec = specFor(binder.format);
  const page = binder.pages.find((p) => Object.keys(p.slots).length > 0) ?? binder.pages[0];
  return {
    kind: "page",
    slots: Array.from({ length: spec.pockets }, (_, i) => page?.slots[i]),
  };
}

export interface Fill {
  /** 0-1 for the bar. NaN where there are no pockets to fill. */
  ratio: number;
  /** "107 / 168". The exact figure, for when the bar is not enough. */
  text: string;
  complete: boolean;
}

/**
 * How full the binder is.
 *
 * POCKETS, not copies: this is how much of the binder is laid out, and a trade
 * binder with three copies behind one pocket has filled one pocket. The bar is
 * read by length and the number is read when the exact figure matters; neither
 * is decoration for the other.
 */
export function fillOf(counts: BinderCounts): Fill {
  const { filled, pockets } = counts;
  return {
    // NaN rather than 0 for a binder with no pockets at all — `Meter` draws an
    // empty track for "there is nothing to have", where 0 claims "you have none
    // of it". A binder with no pages is the former.
    ratio: pockets > 0 ? filled / pockets : Number.NaN,
    text: `${filled} / ${pockets}`,
    complete: pockets > 0 && filled === pockets,
  };
}

/**
 * What shape the binder is: format and pages, and copies only where they mean
 * something.
 *
 * Copies diverge from pockets only in a trade binder, which is the one place
 * duplicates are stacked behind a pocket. Printing the figure everywhere would
 * make it noise on every binder that is not for trade, where it is always equal
 * to the card count already shown.
 */
export function metaLine(binder: Binder, counts: BinderCounts): string {
  const spec = specFor(binder.format);
  const pages = `${binder.pages.length} page${binder.pages.length === 1 ? "" : "s"}`;
  const copies = binder.forTrade && counts.copies !== counts.cards ? ` · ${counts.copies} cards` : "";
  return `${spec.label} · ${pages}${copies}`;
}

export interface ValueState {
  /** Pass to `Money`. True while there is no total to show yet. */
  loading: boolean;
  total: number | undefined;
  /** "3 unpriced", or "" when everything in the binder has a price. */
  note: string;
}

/**
 * The binder's total, honestly.
 *
 * "Pricing…" rather than a blank or a zero while the sets answer: a total that
 * appears out of nothing looks like a number that changed, and `$0.00` is the
 * one thing this figure must never say when it simply does not know yet. Once
 * anything is priced the running total is shown, because a lower bound that is
 * climbing beats a spinner — as long as the unpriced count rides with it.
 */
export function valueState(summary: BinderValueSummary | undefined, loading: boolean): ValueState {
  if (!summary || (loading && summary.priced === 0)) {
    return { loading: true, total: undefined, note: "" };
  }
  return {
    loading: false,
    total: summary.total,
    note: summary.unpriced > 0 ? `${summary.unpriced} unpriced` : "",
  };
}

/**
 * The binders worth asking the price of.
 *
 * Filtered HERE, and asserted, because the cost is per binder and it is not
 * small: pricing one means a request for every SET it spans, and the Riolu
 * binder alone spans thirty. The shelf otherwise makes no requests at all. A
 * collector wants the total on the two or three binders that represent money,
 * not on every master set they are part-way through — which is why `showValue`
 * is opt-in per binder rather than a preference.
 */
export function pricedBinders(binders: Binder[]): Binder[] {
  return binders.filter((b) => b.showValue);
}

/**
 * What the shelf holds, for the header.
 *
 * Cards rather than pockets: six binders is a number that stops meaning
 * anything, and the cards are the collection.
 */
export function shelfSummary(binders: Binder[]): string {
  const cards = binders.reduce((sum, b) => sum + countBinder(b).copies, 0);
  return `${binders.length} ${binders.length === 1 ? "binder" : "binders"} · ${cards} ${cards === 1 ? "card" : "cards"}`;
}

/**
 * A new binder's id.
 *
 * Unique across DEVICES, not just this one, because the id is what binders
 * converge on during sync: two phones that both minted "b1" would merge into
 * one binder and the older arrangement would vanish silently and permanently.
 * The clock alone is not enough — two devices creating a binder in the same
 * millisecond is unlikely, but the failure has no symptom — so it carries
 * randomness too.
 */
export function newBinderId(now: number = Date.now(), random: () => number = Math.random): string {
  return `b${now.toString(36)}${random().toString(36).slice(2, 10)}`;
}
