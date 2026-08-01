import { useMemo } from "react";
import type { PokemonCardSummary } from "../models/cards.ts";
import { availableFinishes, knownFinishes, type CardVariants, type CollectFinish } from "../models/cards.ts";
import { printingPrice, type SetPrintingIndex } from "../models/printingIndex.ts";
import type { Finish } from "../models/finishes.ts";
import { byCollectorNumber } from "../integrations/pokemon/sort.ts";
import { filterByRarity } from "../features/results/rarityFilters.ts";
import { useSetCards } from "./useSets.ts";
import { useSetInformation } from "./useSetInformation.ts";
import { useSetPrintings } from "./useSetPrintings.ts";

export interface SetView {
  /** The visible list: rarity-filtered, in collector-number (binder) order. */
  cards: PokemonCardSummary[];
  /** Every card in the set, unfiltered — the master-set denominator works off this. */
  allCards: PokemonCardSummary[] | undefined;
  printings: SetPrintingIndex | null;
  /** Total printings counted toward completion, or undefined while unknown. */
  masterTotal: number | undefined;
  /** Printings a card is KNOWN to have, or null. Use this to decide what a mark writes. */
  knownFinishesFor: (collectorNumber: string, variants?: CardVariants) => CollectFinish[] | null;
  /** Printings to DISPLAY for a card — padded, so a row always shows something. */
  finishesFor: (collectorNumber: string, variants?: CardVariants) => CollectFinish[];
  /** USD market price for one printing of one card, or undefined when unpriced. */
  priceFor: (collectorNumber: string, finish: Finish) => number | undefined;
  /** Best single price to headline a card: catalog price, else the dearest known printing. */
  headlinePriceFor: (card: PokemonCardSummary) => number | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * The single price to headline a card with.
 *
 * The catalog price wins when present: it is what search results already sort
 * by, and two different headline numbers for one card would be worse than a
 * missing one. Otherwise the dearest known printing stands in — measured live,
 * pokemontcg.io prices 0/120 Pitch Black and 0/124 Perfect Order cards while
 * TCGdex prices both, so without this whole sets read "Unavailable".
 *
 * Dearest rather than cheapest because the headline answers "what is this card
 * worth", and a collector reads that as the good copy.
 */
export function headlinePrice(
  card: PokemonCardSummary,
  index: SetPrintingIndex | null | undefined,
): number | undefined {
  const catalog = card.marketPrice;
  if (typeof catalog === "number" && Number.isFinite(catalog) && catalog > 0) return catalog;

  const finishes = index?.byNumber[card.collectorNumber] ?? [];
  let best: number | undefined;
  for (const finish of finishes) {
    const price = printingPrice(index, card.collectorNumber, finish);
    if (price !== undefined && (best === undefined || price > best)) best = price;
  }
  return best;
}

/**
 * Everything a set screen needs, independent of how it is presented.
 *
 * Extracted because the glasses and the web shell now render sets completely
 * differently — a focus-ring list against a tappable image grid — while asking
 * the identical questions of the identical data. Keeping the loading, the
 * fallback and the printing rules here is what stops the two shells drifting
 * into two subtly different answers to "which printings does this card have",
 * which is the mistake the shared-screens design was originally guarding against.
 */
export function useSetView(
  setId: string,
  setName: string,
  opts: { rarities?: string[] | null; wantPrintings?: boolean } = {},
): SetView {
  const { rarities = null, wantPrintings = true } = opts;

  /** One request for the whole screen: every card in the set plus its printings. */
  const info = useSetInformation(setId, setName);
  /**
   * The path this screen used before that endpoint existed, held in reserve.
   *
   * Not optional: the server it aggregates on is a home machine that spends days
   * at a time powered off, and the catalog provider still degrades to the public
   * API on its own.
   */
  const viaCatalog = info.isUnavailable;
  const fallback = useSetCards(setId, rarities ?? undefined, { enabled: viaCatalog });
  const fallbackAll = useSetCards(setId, undefined, { enabled: viaCatalog });

  const allCards = info.cards ?? fallbackAll.data;

  /**
   * Real printings from TCGdex. They ride along with the aggregate response, so
   * this only fires when that could not supply them — on its own it costs one
   * request per card. pokemontcg.io cannot answer this at all for some sets
   * (Pitch Black returns no variant data whatsoever).
   */
  const { index: fallbackPrintings } = useSetPrintings(setId, setName, wantPrintings && !info.printings);
  const printings = info.printings ?? fallbackPrintings;

  const visible = useMemo(
    () => (info.cards ? filterByRarity(info.cards, rarities) : fallback.data),
    [info.cards, fallback.data, rarities],
  );

  // Always binder order: a set is worked through by number. Value ordering is a
  // browsing concern and lives on the search results screen.
  const cards = useMemo(() => [...(visible ?? [])].sort(byCollectorNumber), [visible]);

  const masterTotal = useMemo(() => {
    if (printings) return printings.packTotal;
    // Fallback: what the pricing payload implies. Undercounts badly — it knows
    // nothing about pattern reverses.
    return allCards?.reduce((sum, c) => sum + availableFinishes(c.variants).length, 0);
  }, [printings, allCards]);

  /**
   * Real TCGdex printings first, then what pricing implies, then nothing.
   * The third case is not hypothetical: on the fallback path printings are a
   * separate request, so there is a window where a Pitch Black card looks
   * normal-only because pricing reports nothing for that set.
   */
  const knownFinishesFor = useMemo(() => {
    return (collectorNumber: string, variants?: CardVariants) => {
      const real = printings?.byNumber[collectorNumber];
      if (real && real.length > 0) return real;
      return knownFinishes(variants);
    };
  }, [printings]);

  const finishesFor = useMemo(() => {
    return (collectorNumber: string, variants?: CardVariants) =>
      knownFinishesFor(collectorNumber, variants) ?? availableFinishes(variants);
  }, [knownFinishesFor]);

  const priceFor = useMemo(() => {
    return (collectorNumber: string, finish: Finish) => printingPrice(printings, collectorNumber, finish);
  }, [printings]);

  const headlinePriceFor = useMemo(() => {
    return (card: PokemonCardSummary) => headlinePrice(card, printings);
  }, [printings]);

  return {
    cards,
    allCards,
    printings,
    masterTotal,
    knownFinishesFor,
    finishesFor,
    priceFor,
    headlinePriceFor,
    isLoading: viaCatalog ? fallback.isLoading : info.isLoading,
    // Only the fallback can put a screen in an error state — an aggregate
    // failure is not an error, it is the reason the fallback is running.
    isError: viaCatalog && fallback.isError,
    refetch: () => {
      if (viaCatalog) void fallback.refetch();
      else info.refetch();
    },
  };
}
