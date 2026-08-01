/** How many cards fit on one physical binder page. */
export const BINDER_PAGE_SIZE = 9;

export interface BinderCard {
  collectorNumber: string;
  /** Every printing of this card is held. */
  complete: boolean;
}

export interface BinderPage<T extends BinderCard> {
  /** 1-based, as a collector would say it. */
  index: number;
  cards: T[];
  /** Collector number of the first and last card, as given. */
  from: string;
  to: string;
  /** Cards on this page with every printing held. */
  complete: number;
  /** True when every card on the page is complete — including a short last page. */
  full: boolean;
}

/**
 * Group cards into nine-pocket binder pages.
 *
 * Nine because that is the page, not because it is a tidy number: a set is
 * worked through in collector-number order and physically lives in nine-pocket
 * sheets. Measured against real sets — Pitch Black is 13 pages and 3 over,
 * Perfect Order 13 and 7, Phantasmal Flames 14 and 4 — so the rhythm is the
 * hobby's, not an imposition.
 *
 * Only meaningful over an unbroken run in collector order. A filtered subset is
 * not a binder page and callers must not draw one; see WebSetCardsScreen, which
 * falls back to a flat grid whenever a filter is active.
 */
export function binderPages<T extends BinderCard>(
  cards: T[],
  size: number = BINDER_PAGE_SIZE,
): BinderPage<T>[] {
  if (size < 1) return [];
  const pages: BinderPage<T>[] = [];

  for (let start = 0; start < cards.length; start += size) {
    const slice = cards.slice(start, start + size);
    const complete = slice.filter((c) => c.complete).length;
    pages.push({
      index: pages.length + 1,
      cards: slice,
      from: slice[0].collectorNumber,
      to: slice[slice.length - 1].collectorNumber,
      complete,
      // Against the cards actually on the page, not against `size`. A set that
      // ends mid-page still finishes, and refusing to mark that page full would
      // make the last page of every set permanently incomplete.
      full: complete === slice.length,
    });
  }

  return pages;
}
