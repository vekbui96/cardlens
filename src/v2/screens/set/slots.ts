import type { PokemonCardSummary } from "../../../models/cards.ts";
import type { CardVariants, CollectFinish } from "../../../models/cards.ts";
import { binderPages, type BinderPage } from "../../../models/binder.ts";

/**
 * The decisions this screen makes, as plain functions.
 *
 * Everything here is testable without a DOM, a provider or a network — which is
 * the point. The two rules that have actually bitten this screen (a filtered
 * view drawn as binder pages, and a card marked per-card instead of
 * per-printing) are decisions, not markup, so they live where a unit test can
 * reach them.
 */

/** One pocket: exactly one printing of one card. */
export interface PrintingSlot {
  /** Stable across re-renders; a card contributes one slot per printing. */
  key: string;
  card: PokemonCardSummary;
  finish: CollectFinish;
  /** Denormalised so `binderPages` can read it without knowing about cards. */
  collectorNumber: string;
  held: boolean;
  /** Deliberately not part of this master set — a promo, a box topper. */
  excluded: boolean;
  /** Held, but the set data does not list this printing. Must stay reachable. */
  extra: boolean;
  /**
   * Nothing on this page still wants it. An excluded printing counts as done:
   * a page is complete when nothing on it is outstanding, and a promo you have
   * opted out of is not outstanding.
   */
  complete: boolean;
}

export interface SlotSources {
  /** Printings to DISPLAY for a card — padded, so a card always shows a pocket. */
  finishesFor: (collectorNumber: string, variants?: CardVariants) => CollectFinish[];
  ownedFinishes: (cardId: string) => CollectFinish[];
  excludedFinishes: (cardId: string) => CollectFinish[];
}

/**
 * One slot per PRINTING, not per card.
 *
 * A master set lives in a binder with the normal and the reverse in their own
 * pockets, so a single tile marked "1 of 2 printings" describes a pocket that
 * does not exist. Two pockets side by side is what is actually in front of you,
 * and it makes the missing one visible without opening anything.
 *
 * Extras — a hand-marked finish the set data does not know about — get a slot
 * too. Without one, a printing already held becomes invisible and therefore
 * impossible to un-mark.
 */
export function buildSlots(cards: PokemonCardSummary[], sources: SlotSources): PrintingSlot[] {
  const { finishesFor, ownedFinishes, excludedFinishes } = sources;

  return cards.flatMap((card) => {
    const available = finishesFor(card.collectorNumber, card.variants);
    const held = ownedFinishes(card.id);
    const skipped = excludedFinishes(card.id);
    const extras = held.filter((f) => !available.includes(f));
    const finishes = [...available, ...extras];

    // No printings data at all: fall back to what is held, so the grid degrades
    // to "the cards you have" rather than to nothing.
    return (finishes.length > 0 ? finishes : held).map((finish) => ({
      key: `${card.id}:${finish}`,
      card,
      finish,
      collectorNumber: card.collectorNumber,
      held: held.includes(finish),
      excluded: skipped.includes(finish),
      extra: extras.includes(finish),
      complete: held.includes(finish) || skipped.includes(finish),
    }));
  });
}

export interface FilterState {
  /** A key from `RARITY_FILTERS`; "all" is the unfiltered state. */
  rarityKey: string;
  /** Master-setting is mostly "what am I still missing". */
  missingOnly: boolean;
  /** Reveal printings taken out of the master set, so they can be put back. */
  showExcluded: boolean;
}

export const NO_FILTERS: FilterState = { rarityKey: "all", missingOnly: false, showExcluded: false };

/**
 * **A filtered view is not a binder page.**
 *
 * Binder pages are only honest over an unbroken run in collector order. "Page 3"
 * drawn over a rarity-filtered subset, or over a missing-only list, names
 * something that does not exist — its range lies and its 4/9 counts pockets that
 * are not next to each other in any binder. Those views get a flat grid and a
 * plain count instead.
 *
 * Hiding EXCLUDED printings does not break the run, and that is deliberate: a
 * printing you have opted out of is not part of the set you are building, so the
 * pages without it are the pages you are actually filling.
 */
export function isBinderOrder(filters: FilterState): boolean {
  return filters.rarityKey === "all" && !filters.missingOnly;
}

/** Apply the filters that are not already applied upstream by rarity. */
export function visibleSlots(slots: PrintingSlot[], filters: FilterState): PrintingSlot[] {
  const shown = filters.showExcluded ? slots : slots.filter((s) => !s.excluded);
  return filters.missingOnly ? shown.filter((s) => !s.held && !s.excluded) : shown;
}

/** Nine-pocket pages, but only where drawing them is honest. */
export function pagesFor(slots: PrintingSlot[], filters: FilterState): BinderPage<PrintingSlot>[] {
  return isBinderOrder(filters) ? binderPages(slots) : [];
}

/**
 * How many of these pockets carry a price, and how many could.
 *
 * The honest form of a total. Pitch Black returns `prices: {}` for all 120 of
 * its cards, so a screen that shows only a set value reports a confident number
 * built from nothing; this is what lets it say "0 of 360 printings priced"
 * instead.
 */
export function pricedCount(
  slots: PrintingSlot[],
  priceFor: (collectorNumber: string, finish: CollectFinish) => number | undefined,
): number {
  return slots.filter((s) => priceFor(s.collectorNumber, s.finish) !== undefined).length;
}
