import type {
  PokemonCardDetails,
  PokemonCardSummary,
  PokemonSet,
  PriceFinishKey,
} from "../../../models/cards.ts";
import {
  compareFinishes,
  finishLabel,
  parseFinish,
  pricesAsBaseType,
  type Finish,
} from "../../../models/finishes.ts";
import { formatCollector } from "../../../utils/format.ts";

/**
 * The decisions the card-details screen makes, with no React around them.
 *
 * Details is the screen where a wrong answer is least visible: one card, a
 * handful of rows, all of them plausible. A printing quietly dropped because the
 * catalog has not heard of the foil you own, a `$0.00` where a provider simply
 * said nothing, a "223" where the card itself says "223/197" — none of those
 * look like bugs. They are pulled out here so they can be asserted.
 */

/* --- Printings ------------------------------------------------------------ */

export interface Printing {
  /** Stable within the card, and unique. */
  key: string;
  finish: Finish;
  /** Words, always. Sets keep inventing foils; a raw key must never reach a screen. */
  label: string;
  held: boolean;
  /** Deliberately left out of this master set — not the same as "not owned". */
  excluded: boolean;
  /**
   * Held, but not among the printings this card is known to have. Usually a foil
   * the catalog has not caught up with; occasionally a mistake. Either way it
   * gets a row, because a printing you cannot see is one you cannot unmark.
   */
  extra: boolean;
  price: number | undefined;
}

export interface PrintingSource {
  /** Printings the card is known to exist in, from the set's printing index. */
  available: Finish[];
  held: Finish[];
  excluded: Finish[];
  priceFor: (finish: Finish) => number | undefined;
}

/**
 * Every printing of this card, each one its own row.
 *
 * Two fallbacks matter here and neither is hypothetical:
 *
 * - A card whose set reports no variant data at all (Pitch Black reports
 *   nothing for all 120 of its cards) yields no printings, so the card would
 *   render with nothing to mark — a details screen you cannot collect from.
 *   It falls back to whatever is held, and then to a single bare `normal` row.
 * - A printing held but not listed becomes an `extra` row rather than being
 *   dropped. Sets keep inventing foils; the collection is allowed to know about
 *   one before the catalog does, and dropping it would make it permanent.
 */
export function cardPrintings(source: PrintingSource): Printing[] {
  const extras = source.held.filter((f) => !source.available.includes(f)).sort(compareFinishes);
  const all = [...source.available, ...extras];
  const shown = all.length > 0 ? all : ["normal"];

  return shown.map((finish) => ({
    key: finish,
    finish,
    label: finishLabel(finish),
    held: source.held.includes(finish),
    excluded: source.excluded.includes(finish),
    extra: extras.includes(finish),
    price: source.priceFor(finish),
  }));
}

/**
 * What a printing row says to a screen reader beyond its own contents.
 *
 * Ownership only. Exclusion is carried by a visible "Not in this set" chip
 * inside the same control, so it is already part of the accessible name — and
 * saying it twice would make the two states sound like one.
 */
export function printingState(printing: Printing): "owned" | "not owned" {
  return printing.held ? "owned" : "not owned";
}

/**
 * The exclusion control's words.
 *
 * An ACTION, not a state toggle: the label says what pressing it will do, which
 * is why it carries no `aria-pressed`. A control labelled "Exclude" that also
 * reports itself as pressed is announcing two contradictory things — and the
 * row's own "Not in this set" chip already carries the state.
 *
 * The printing's name is in the accessible label because there are up to six of
 * these on a card and "Exclude" on its own names none of them.
 */
export function exclusionAction(printing: Printing): { text: string; label: string } {
  return printing.excluded
    ? { text: "Include", label: `Include ${printing.label} in this set` }
    : { text: "Exclude", label: `Exclude ${printing.label} from this set` };
}

/* --- Prices --------------------------------------------------------------- */

/**
 * pokemontcg.io's price keys, per printing type.
 *
 * The two vocabularies do not line up: the collection models a printing as
 * `type` or `type:foil` (`holo`, `reverse:pokeball`), while pricing reports
 * `holofoil`, `reverseHolofoil`, and two separate first-edition keys. First
 * edition gets both of its keys because the payload splits holo and non-holo
 * and the collection does not — either is a better answer than none.
 */
const PRICE_KEYS: Record<string, PriceFinishKey[]> = {
  normal: ["normal"],
  holo: ["holofoil"],
  reverse: ["reverseHolofoil"],
  firstEdition: ["firstEditionHolofoil", "firstEditionNormal"],
};

/**
 * A printing's price from the search payload, when the printing index has none.
 *
 * This exists so that card details can price its rows with ZERO extra requests.
 * The set's printing index is the better source and is asked first; this is the
 * number that already rode in on the summary that opened this screen, and it is
 * the difference between a column of prices and a column of "n/a" whenever our
 * own server is unreachable.
 *
 * A PATTERN foil may borrow its base type's number — a Poké Ball reverse and a
 * plain reverse are the same print run pressed differently, and no provider
 * models them separately. A STAMP may not: a staff promo shares its collector
 * number with the card underneath and nothing else, and pricing it at the base
 * card's number is not an approximation but an invented figure. That rule lives
 * in `models/finishes.ts`, so both price paths obey the same one.
 */
export function variantPrice(
  finish: Finish,
  variantPrices: Partial<Record<PriceFinishKey, number>> | undefined,
): number | undefined {
  if (!variantPrices) return undefined;
  const { type } = parseFinish(finish);
  if (type !== finish && !pricesAsBaseType(finish)) return undefined;
  for (const key of PRICE_KEYS[type] ?? []) {
    const price = variantPrices[key];
    if (typeof price === "number" && Number.isFinite(price) && price > 0) return price;
  }
  return undefined;
}

export interface PricingCoverage {
  /** Never absent. A column of prices with no denominator is not an honest one. */
  line: string;
  /** Reports a problem rather than progress. Paired with words, never colour. */
  warn: boolean;
}

/**
 * How many of this card's printings could be priced.
 *
 * The rule the screen exists to keep: a price is only ever shown next to how
 * many of them there are. A card whose providers returned nothing looks
 * identical, row by row, to a worthless card — both are a column of grey — and
 * only this line separates them.
 */
export function pricingCoverage(printings: number, priced: number): PricingCoverage {
  if (printings === 0) return { line: "Nothing to price yet", warn: false };
  if (priced === 0) {
    return {
      line: printings === 1 ? "No price for this printing" : `No prices for any of these ${printings}`,
      warn: true,
    };
  }
  if (priced === printings) {
    return { line: printings === 1 ? "Priced" : `All ${printings} priced`, warn: false };
  }
  return { line: `${priced} of ${printings} priced`, warn: false };
}

/* --- Facts ---------------------------------------------------------------- */

/**
 * The collector number as it is printed on the card.
 *
 * "223/197" is what is in the corner of the card in your hand, and it is how a
 * collector says it out loud. The printed total — not the set's real total —
 * because 223/230 is a number that appears nowhere: the set has 230 cards but
 * the cards themselves are numbered out of 197, and the ones past it are the
 * secrets. Falls back to the bare number when the set list has not arrived, so
 * the line never waits on a request to say something true.
 */
export function collectorLine(collectorNumber: string, printedTotal?: number): string {
  return printedTotal ? formatCollector(collectorNumber, String(printedTotal)) : collectorNumber;
}

export interface Fact {
  term: string;
  value: string;
}

/**
 * What this screen renders from, whichever half of it has arrived.
 *
 * A summary handed over by whatever opened the screen, or the full details once
 * the catalog answers — the extra fields are simply absent until then, so the
 * facts list grows rather than the screen waiting to draw any of it.
 */
export type CardFacts = PokemonCardSummary & Partial<PokemonCardDetails>;

/**
 * The identifying facts, in the order a collector checks them.
 *
 * Set and number first because those are what tell two cards with one name
 * apart; rarity next because it is what a search filter is about; artist and
 * release date last because they are the ones you look up rather than the ones
 * you check. Anything absent is omitted rather than shown empty — a `<dt>` with
 * nothing under it reads as data that failed to load.
 */
export function factRows(card: CardFacts, set?: PokemonSet): Fact[] {
  const facts: Fact[] = [
    { term: "Set", value: set?.name ?? card.setName },
    { term: "Number", value: collectorLine(card.collectorNumber, set?.printedTotal) },
  ];
  if (card.rarity) facts.push({ term: "Rarity", value: card.rarity });
  const code = set?.code ?? card.setCode;
  if (code) facts.push({ term: "Set code", value: code });
  if (card.subtypes?.length) facts.push({ term: "Type", value: card.subtypes.join(" · ") });
  if (card.artist) facts.push({ term: "Artist", value: card.artist });
  if (card.releaseDate) facts.push({ term: "Released", value: card.releaseDate });
  return facts;
}
