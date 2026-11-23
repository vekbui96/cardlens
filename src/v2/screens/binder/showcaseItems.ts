import type { Binder, BinderSlot } from "../../../models/binderLayout.ts";

/** One thing to show, and where it lives — the address is for the caption. */
export interface ShowcaseItem {
  slot: BinderSlot;
  /** 1-based page number, or null for the cover. */
  page: number | null;
}

/**
 * What "Show off" walks through: the binder's filled pockets in reading order.
 *
 * The cover first, because it is what you see when a binder is handed over;
 * then each page's pockets by index. Empty pockets are skipped — a showcase is
 * the cards, and swiping past blanks is the binder screen's job, not this one.
 * Read-only: nothing here writes, trims or reorders the binder itself.
 */
export function showcaseItems(binder: Binder): ShowcaseItem[] {
  const items: ShowcaseItem[] = [];
  if (binder.cover) items.push({ slot: binder.cover, page: null });
  binder.pages.forEach((page, p) => {
    const indexes = Object.keys(page.slots)
      .map(Number)
      .filter((i) => Number.isInteger(i))
      .sort((a, b) => a - b);
    for (const i of indexes) {
      const slot = page.slots[i];
      if (slot) items.push({ slot, page: p + 1 });
    }
  });
  return items;
}

/**
 * How far a finger must travel sideways before a swipe turns the card.
 *
 * Small enough for a thumb flick, large enough that a tap that wobbles is still
 * a tap. In CSS pixels, as `clientX` reports them.
 */
export const SWIPE_MIN = 40;

/** A horizontal drag, as a step: left swipe = next (+1), right = previous (-1). */
export function swipeStep(dx: number, dy = 0): -1 | 0 | 1 {
  // Mostly vertical is a scroll attempt, not a swipe.
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dy) > Math.abs(dx)) return 0;
  return dx < 0 ? 1 : -1;
}
