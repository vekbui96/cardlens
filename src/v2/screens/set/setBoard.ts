import type { CardVariants, PokemonCardSummary } from "../../../models/cards.ts";
import { binderPages, type BinderPage } from "../../../models/binder.ts";
import { compareFinishes, finishLabel, type Finish } from "../../../models/finishes.ts";
import type { SetTiers } from "../../../models/setCompletion.ts";

/**
 * The decisions the set screen makes, with no React around them.
 *
 * Every one of these has an answer that looks perfectly fine on a modern,
 * fully-priced set and lies on an old one: a page marker drawn over a filtered
 * subset, a `$0.00` where the provider simply said nothing, a printing quietly
 * dropped because the set data has never heard of the foil somebody actually
 * owns. Pulled out here so those lies can be asserted rather than noticed.
 */

/* --- Pockets -------------------------------------------------------------- */

/**
 * One PRINTING, in one pocket. Not one card.
 *
 * A master set lives in a binder with the normal and the reverse in their own
 * pockets, so a single tile marked "1 of 2 printings" describes a pocket that
 * does not exist. Two pockets side by side is what is actually in front of you,
 * and it makes the missing one visible without opening anything.
 */
export interface Pocket {
  /** Stable across re-renders and unique within the set. */
  key: string;
  card: PokemonCardSummary;
  finish: Finish;
  /** Lifted off the card so `binderPages` can read it structurally. */
  collectorNumber: string;
  held: boolean;
  /** Deliberately left out of this master set — not the same as "not owned". */
  excluded: boolean;
  /**
   * Held, but not among the printings the set is known to have. Usually a foil
   * the catalog has not caught up with; occasionally a mistake. Either way it
   * gets a pocket, because a printing you cannot see is one you cannot unmark.
   */
  extra: boolean;
  /**
   * Nothing on this pocket is still wanted. An excluded printing counts:
   * a page is finished when there is nothing left to put in it, and a promo you
   * have opted out of is not something you are waiting for.
   */
  complete: boolean;
  price: number | undefined;
}

export interface PocketSource {
  /** Printings to DISPLAY for a card — padded, so a card always shows one. */
  finishesFor: (collectorNumber: string, variants?: CardVariants) => Finish[];
  heldFor: (cardId: string) => Finish[];
  excludedFor: (cardId: string) => Finish[];
  priceFor: (collectorNumber: string, finish: Finish) => number | undefined;
}

/**
 * Turn cards into pockets, in collector order, one per printing.
 *
 * Two fallbacks matter here and neither is hypothetical:
 *
 * - A set with no variant data at all (Pitch Black reports nothing for all 120
 *   of its cards) yields no printings, so the card would produce zero pockets
 *   and disappear from its own set. It falls back to whatever is held, and then
 *   to a single bare `normal` pocket, so the grid degrades to "the cards in
 *   this set" rather than to nothing.
 * - A printing held but not listed becomes an `extra` pocket rather than being
 *   dropped. Sets keep inventing foils; the collection is allowed to know about
 *   one before the catalog does.
 */
export function buildPockets(cards: PokemonCardSummary[], source: PocketSource): Pocket[] {
  return cards.flatMap((card) => {
    const available = source.finishesFor(card.collectorNumber, card.variants);
    const held = source.heldFor(card.id);
    const skipped = source.excludedFor(card.id);
    const extras = held.filter((f) => !available.includes(f)).sort(compareFinishes);
    const finishes = [...available, ...extras];
    const shown = finishes.length > 0 ? finishes : ["normal"];

    return shown.map((finish) => ({
      key: `${card.id}:${finish}`,
      card,
      finish,
      collectorNumber: card.collectorNumber,
      held: held.includes(finish),
      excluded: skipped.includes(finish),
      extra: extras.includes(finish),
      complete: held.includes(finish) || skipped.includes(finish),
      price: source.priceFor(card.collectorNumber, finish),
    }));
  });
}

/* --- The board ------------------------------------------------------------ */

export interface Filters {
  /**
   * The exact rarity strings a filter matches, or `null` for every rarity. The
   * screen filters in memory rather than asking upstream: the whole set is
   * already in hand, and a request per rarity would break the one-request
   * budget the set is measured against.
   */
  rarities: string[] | null;
  /** Master-setting is mostly "what am I still missing", so it gets a control. */
  missingOnly: boolean;
}

export type Board = { kind: "pages"; pages: BinderPage<Pocket>[] } | { kind: "grid"; pockets: Pocket[] };

/** Is any filter narrowing what is on screen? */
export function isFiltered(filters: Filters): boolean {
  return filters.rarities !== null || filters.missingOnly;
}

/**
 * Hide what the filters exclude.
 *
 * "Missing only" drops excluded printings as well as held ones. An excluded
 * printing is not missing — it is one you have decided is not part of this set
 * — so leaving it in a list of things still to find is clutter that never
 * resolves, and it would make "nothing missing" unreachable for anyone who has
 * ever used the feature.
 */
export function visiblePockets(pockets: Pocket[], filters: Filters): Pocket[] {
  if (!filters.missingOnly) return pockets;
  return pockets.filter((p) => !p.held && !p.excluded);
}

/**
 * Pages, or a flat grid.
 *
 * **A filtered view is not a binder page.** Binder pages are only honest over an
 * unbroken run in collector order: a "Page 3" drawn over a rarity-filtered
 * subset or a missing-only list names a physical object that does not exist,
 * and its 4/9 marker counts pockets that were never on that sheet. So a filter
 * gets a flat grid and a plain count instead, and clearing it puts the pages
 * back.
 */
export function board(pockets: Pocket[], filters: Filters): Board {
  if (isFiltered(filters)) return { kind: "grid", pockets };
  return { kind: "pages", pages: binderPages(pockets) };
}

/* --- Words ---------------------------------------------------------------- */

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export interface FilterSummary {
  /** The heading over the flat grid, or the title of the empty state. */
  title: string;
  /** Present only when nothing survived — what to do about it. */
  hint?: string;
  /** Nothing matched. The caller draws an empty state rather than a count. */
  empty: boolean;
}

/**
 * What a filtered view calls itself.
 *
 * Null when no filter is active, because an unfiltered set is drawn as pages and
 * every page already carries its own range and count — a second total above them
 * would be a number with no page to check it against.
 *
 * The empty wording splits on WHICH filter emptied the list, because the two
 * mean opposite things. "No Illustration Rare cards" is a set that does not
 * contain any; "Nothing missing" is a set you have finished, which is the good
 * news this screen exists to deliver and must never be reported as an error.
 */
export function filterSummary(
  filters: Filters,
  rarityLabel: string | null,
  count: number,
): FilterSummary | null {
  if (!isFiltered(filters)) return null;

  if (count === 0) {
    if (filters.missingOnly) {
      return {
        title: rarityLabel ? `Nothing missing in ${rarityLabel}` : "Nothing missing",
        hint: rarityLabel
          ? "Every printing matching this rarity is already marked. Try another rarity."
          : "Every printing in this set is already marked.",
        empty: true,
      };
    }
    return {
      title: `No ${rarityLabel} cards in this set`,
      hint: "Try another rarity, or clear the filter.",
      empty: true,
    };
  }

  const qualifiers = [rarityLabel, filters.missingOnly ? "missing only" : null].filter(
    (q): q is string => q !== null,
  );
  const tail = qualifiers.length > 0 ? ` · ${qualifiers.join(" · ")}` : "";
  return { title: `${count} ${plural(count, "printing", "printings")}${tail}`, empty: false };
}

export interface PricingCoverage {
  /** Never absent. A grid of prices with no denominator is not an honest grid. */
  line: string;
  /** Reports a problem rather than progress. Paired with words, never colour. */
  warn: boolean;
}

/**
 * How much of this set could be priced.
 *
 * The rule the screen exists to keep: a price is only ever shown next to how
 * many of them there are. A set where the provider returned nothing for every
 * card looks identical, pocket by pocket, to a set of worthless cards — both are
 * a column of grey — and only this line separates them.
 *
 * `Money` refuses to render `$0.00`, so an unpriced printing already says
 * "Unavailable" rather than claiming to be free. This says how many did.
 */
export function pricingCoverage(printings: number, priced: number): PricingCoverage {
  if (printings === 0) return { line: "Nothing to price yet", warn: false };
  if (priced === 0) {
    return {
      line:
        printings === 1
          ? "No price for the one printing in this set"
          : `No prices for any of the ${printings} printings in this set`,
      warn: true,
    };
  }
  if (priced === printings) {
    return {
      line: printings === 1 ? "The one printing here is priced" : `All ${printings} printings priced`,
      warn: false,
    };
  }
  return { line: `${priced} of ${printings} printings priced`, warn: false };
}

/**
 * The figure the header shows, and the bar it draws.
 *
 * Base where the set has a base tier, master otherwise — the same rule the
 * Collection list ranks on and the switcher below draws. The two have to agree:
 * a switcher ordered by how close a set is to its base tier, opening onto a
 * screen showing a master percentage, would read as a sorting bug.
 *
 * A deliberate near-copy of Home's `completionFigure`. The streams that own
 * these two screens cannot import from one another without coupling their
 * release, so the shared thing is `models/setCompletion.ts` — which decides
 * WHETHER a set is complete — and the wording is restated at each call site.
 * Worth hoisting into a shared v2 module once more than two screens want it.
 */
export function completionFigure(tiers: SetTiers, ownedCards: number): { ratio: number; text: string } {
  if (tiers.baseTotal !== undefined) {
    return { ratio: tiers.baseRatio ?? 0, text: `${tiers.baseOwned} / ${tiers.baseTotal} base` };
  }
  if (tiers.masterTotal !== undefined) {
    return { ratio: tiers.masterRatio ?? 0, text: `${tiers.masterOwned} / ${tiers.masterTotal} cards` };
  }
  /*
   * The set's size is unknown, so there is no denominator to divide by. NaN
   * rather than 0 — `Meter` reads a non-finite ratio as "there is nothing to
   * have", where a 0 would say "you have none of it".
   */
  return { ratio: Number.NaN, text: `${ownedCards} ${plural(ownedCards, "card", "cards")}` };
}

/**
 * How a pocket says which printing it is.
 *
 * Straight through to `finishLabel`, which humanises anything it does not
 * recognise — three sets in 2025-26 alone introduced pokeball, masterball,
 * tinsel, cosmos, energy, friendball, loveball, quickball and team-rocket, so a
 * screen that rendered an enum would be wrong by the next release. This exists
 * as its own name so the set screen's use of it is testable: an unknown foil has
 * to arrive here as words, never as a raw key and never as a crash.
 */
export function printingName(finish: Finish): string {
  return finishLabel(finish);
}

/** What a pocket is worth saying to a screen reader, beyond its own caption. */
export function pocketState(pocket: Pocket): "owned" | "not owned" | "excluded" {
  if (pocket.excluded) return "excluded";
  return pocket.held ? "owned" : "not owned";
}
