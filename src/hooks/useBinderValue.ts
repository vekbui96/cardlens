import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { SetPrintings } from "../integrations/tcgdex/client.ts";
import { buildPrintingIndex, printingPrice, type SetPrintingIndex } from "../models/printingIndex.ts";
import type { Binder, BinderSlot } from "../models/binderLayout.ts";
import { cardSlotsOf, lineTotal, summariseBinderValue } from "../models/binderValue.ts";
import { setIdFromCardId } from "../utils/cardId.ts";
import { printingsCache } from "../storage/caches.ts";
import { loadPrintings } from "./useSetPrintings.ts";
import { useSets } from "./useSets.ts";
import { settledKey } from "./settledKey.ts";

/**
 * Query options for one set's printings.
 *
 * Exported so every binder screen uses the SAME queryKey — the one
 * `useSetPrintings` uses — and so the list screen and the binder screen cannot
 * drift into two shapes for one question. A second key would mean re-fetching a
 * 120-295 card set and two caches that can disagree about what a printing costs.
 * `useCollectionValue.printingsQuery` exists for the same reason on its side.
 */
export function setPrintingsQuery(setId: string, setName: string | undefined) {
  const cached = printingsCache.get(setId);
  return {
    queryKey: ["set-printings", setId] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }) => loadPrintings(setId, setName ?? setId, signal),
    // Held until the set list answers. The server matches sets by NAME, so
    // asking before the name is known would ask the wrong question — and cache
    // the wrong answer under the right key.
    enabled: Boolean(setName),
    staleTime: 30 * 24 * 60 * 60_000,
    retry: 1,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
  };
}

export interface BinderValue {
  /**
   * USD market price for ONE copy of what a pocket holds, or undefined when
   * nothing prices it.
   *
   * Per copy rather than per pocket, because this is what the pocket badge
   * shows and a badge reading "$180" beside "x2" is the arithmetic the viewer
   * can check. `lineTotalFor` is the multiplied figure.
   */
  priceFor: (slot: BinderSlot) => number | undefined;
  /** Unit price times the copies behind the pocket. */
  lineTotalFor: (slot: BinderSlot) => number | undefined;
  /** Summed line totals of the pockets that carry a price. */
  total: number;
  /** How many POCKETS carry a price, and how many do not. */
  priced: number;
  unpriced: number;
  /** Copies behind the priced pockets — what `total` is actually the sum over. */
  pricedCopies: number;
  /** True while any set is still being asked about. */
  isLoading: boolean;
}

const EMPTY: BinderValue = {
  priceFor: () => undefined,
  lineTotalFor: () => undefined,
  total: 0,
  priced: 0,
  unpriced: 0,
  pricedCopies: 0,
  isLoading: false,
};

/**
 * What a binder is worth, priced per PRINTING.
 *
 * A binder spans sets the way a set screen never does — the Riolu one touches
 * thirty of them — so this asks the printings oracle once per set rather than
 * once per card, which is the difference between thirty requests and ninety.
 * The query key is the one `useSetPrintings` uses, so a set already fetched for
 * a set screen costs nothing here and vice versa.
 *
 * Priced per printing rather than per card because that is what a binder holds:
 * the reverse and the holo of one card are different pockets and different
 * money, and pricing both at the card's headline would count a number the data
 * never claimed.
 *
 * **A missing price is not zero.** Whole categories here cannot be priced at
 * all — stamps and promos ride on finishes the oracle has never heard of
 * (`holo:staff`, `normal:comic-con-2009`), and pokemontcg.io prices no card in
 * some sets. Those pockets read "n/a" and are counted separately, so a total is
 * always "the part we know", never a guess presented as a fact.
 *
 * Copies multiply. A trade binder stacks duplicates behind one pocket, so the
 * total is over COPIES while `priced` and `unpriced` count POCKETS — the two
 * genuinely differ there, and reporting "23 of 24 priced" against a total that
 * summed forty cards would be a quiet lie about what was measured.
 */
export function useBinderValue(binder: Binder | null): BinderValue {
  const { data: allSets } = useSets();

  const setNames = useMemo(() => new Map((allSets ?? []).map((s) => [s.id, s.name] as const)), [allSets]);

  const slots = useMemo(() => cardSlotsOf(binder), [binder]);
  const setIds = useMemo(() => [...new Set(slots.map((s) => setIdFromCardId(s.cardId)))].sort(), [slots]);

  const results = useQueries({
    queries: setIds.map((setId) => setPrintingsQuery(setId, setNames.get(setId))),
  });
  const indexes = useMemo(() => {
    const map = new Map<string, SetPrintingIndex | null>();
    setIds.forEach((setId, i) => {
      const data = results[i]?.data as SetPrintings | null | undefined;
      map.set(setId, buildPrintingIndex(data?.byNumber));
    });
    return map;
    // Results are a new array each render; the data inside is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setIds, settledKey(results)]);

  const priceFor = useCallback(
    (slot: BinderSlot) => {
      if (slot.kind !== "card" || !slot.collectorNumber) return undefined;
      return printingPrice(indexes.get(setIdFromCardId(slot.cardId)), slot.collectorNumber, slot.finish);
    },
    [indexes],
  );

  /** Unit price times the copies behind the pocket. See models/binderValue.ts. */
  const lineTotalFor = useCallback((slot: BinderSlot) => lineTotal(slot, priceFor(slot)), [priceFor]);

  // The arithmetic is pure and lives in the model, where it can be tested
  // without react-query, nineteen set fetches and a React render.
  const { total, priced, unpriced, pricedCopies } = useMemo(
    () => summariseBinderValue(slots, priceFor),
    [slots, priceFor],
  );
  if (!binder) return EMPTY;

  return {
    priceFor,
    lineTotalFor,
    total,
    priced,
    unpriced,
    pricedCopies,
    isLoading: results.some((r) => r.isLoading),
  };
}
