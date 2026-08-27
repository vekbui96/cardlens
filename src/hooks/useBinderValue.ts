import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { SetPrintings } from "../integrations/tcgdex/client.ts";
import { buildPrintingIndex, printingPrice, type SetPrintingIndex } from "../models/printingIndex.ts";
import type { Binder, BinderSlot, CardSlot } from "../models/binderLayout.ts";
import { setIdFromCardId } from "../utils/cardId.ts";
import { printingsCache } from "../storage/caches.ts";
import { loadPrintings } from "./useSetPrintings.ts";
import { useSets } from "./useSets.ts";

export interface BinderValue {
  /** USD market price for one pocket, or undefined when nothing prices it. */
  priceFor: (slot: BinderSlot) => number | undefined;
  /** Summed market price of the pockets that have one. */
  total: number;
  /** How many cards carry a price, and how many do not. */
  priced: number;
  unpriced: number;
  /** True while any set is still being asked about. */
  isLoading: boolean;
}

const EMPTY: BinderValue = {
  priceFor: () => undefined,
  total: 0,
  priced: 0,
  unpriced: 0,
  isLoading: false,
};

/** Every card slot in the binder, in page order. */
function cardSlots(binder: Binder | null): CardSlot[] {
  if (!binder) return [];
  return binder.pages.flatMap((page) =>
    Object.values(page.slots).filter((s): s is CardSlot => s.kind === "card"),
  );
}

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
 */
export function useBinderValue(binder: Binder | null): BinderValue {
  const { data: allSets } = useSets();

  const setNames = useMemo(() => new Map((allSets ?? []).map((s) => [s.id, s.name] as const)), [allSets]);

  const slots = useMemo(() => cardSlots(binder), [binder]);
  const setIds = useMemo(() => [...new Set(slots.map((s) => setIdFromCardId(s.cardId)))].sort(), [slots]);

  const results = useQueries({
    queries: setIds.map((setId) => {
      const name = setNames.get(setId);
      const cached = printingsCache.get(setId);
      return {
        queryKey: ["set-printings", setId],
        queryFn: ({ signal }: { signal?: AbortSignal }) => loadPrintings(setId, name ?? setId, signal),
        // Held until the set list answers. The server matches sets by NAME, so
        // asking before the name is known would ask the wrong question — and
        // cache the wrong answer under the right key.
        enabled: Boolean(name),
        staleTime: 30 * 24 * 60 * 60_000,
        retry: 1,
        ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
      };
    }),
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
  }, [setIds, results.map((r) => r.dataUpdatedAt).join(",")]);

  const priceFor = useCallback(
    (slot: BinderSlot) => {
      if (slot.kind !== "card" || !slot.collectorNumber) return undefined;
      return printingPrice(indexes.get(setIdFromCardId(slot.cardId)), slot.collectorNumber, slot.finish);
    },
    [indexes],
  );

  const { total, priced } = useMemo(() => {
    let sum = 0;
    let n = 0;
    for (const slot of slots) {
      const price = priceFor(slot);
      if (price !== undefined) {
        sum += price;
        n += 1;
      }
    }
    return { total: sum, priced: n };
  }, [slots, priceFor]);

  if (!binder) return EMPTY;

  return {
    priceFor,
    total,
    priced,
    unpriced: slots.length - priced,
    isLoading: results.some((r) => r.isLoading),
  };
}
