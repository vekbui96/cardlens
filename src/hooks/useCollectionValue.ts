import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  buildPrintingIndex,
  printingEur,
  printingPrice,
  type SetPrintingIndex,
} from "../models/printingIndex.ts";
import { catalogPrice } from "../models/catalogPrice.ts";
import { aggregateMovement, type Movement } from "../models/movement.ts";
import { valueCollection, type CollectionValue, type ValuableRow } from "../models/value.ts";
import { printingsCache } from "../storage/caches.ts";
import { companionBase } from "../services/companionApi.ts";
import { fetchJson } from "../services/http.ts";
import { toSetPrintings } from "./useSetInformation.ts";

/**
 * Query options for one set's printings.
 *
 * Exported so every consumer uses the SAME queryKey. useOwnedCards needs the
 * identical data for prices, and a second key would mean a second fetch of a
 * 120-295 card set and two caches that can disagree about what a printing costs.
 */
export function printingsQuery(setId: string, setName: string) {
  return {
    queryKey: ["printings-value", setId] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }) => loadPrintings(setId, setName, signal),
    enabled: Boolean(setName),
    staleTime: 30 * 24 * 60 * 60_000,
    retry: 1,
  };
}

async function loadPrintings(setId: string, setName: string, signal?: AbortSignal) {
  const url = `${companionBase()}/printings/${encodeURIComponent(setId)}?name=${encodeURIComponent(setName)}`;
  return toSetPrintings(await fetchJson(url, { ...(signal ? { signal } : {}) }));
}

export interface CollectionValueResult extends CollectionValue {
  /** Sets still loading. The total is a lower bound until this reaches zero. */
  pending: number;
  /** Sets whose prices could not be loaded at all. */
  failed: number;
  /**
   * Portfolio movement from Cardmarket's EUR averages, as a percentage.
   *
   * A percentage rather than an amount because the series is EUR while the total
   * is USD — a percentage is currency-free, so it can describe the portfolio
   * without either figure being converted. Aggregate only; see models/movement.ts.
   */
  movement: Movement;
}

/**
 * What the collection is worth, priced per printing from TCGdex.
 *
 * TCGdex rather than pokemontcg.io because pokemontcg.io cannot price most of
 * this collection: measured live, it returns pricing for 130/130 Phantasmal
 * Flames cards and 0/120 Pitch Black and 0/124 Perfect Order. Valuing on it
 * would leave roughly four fifths of the rows unpriced. TCGdex has prices for
 * all three, and the server already fetches it for printings — the prices were
 * simply being discarded.
 *
 * TCGdex is not enough on its own either, which is why `catalogPrices` exists:
 * it returns an empty tcgplayer block for promos and older cards that
 * pokemontcg.io prices perfectly well — measured on smp-SM210, TCGdex `{}`
 * against pokemontcg.io holofoil $169.02. Each printing takes TCGdex's price
 * when there is one and the catalog's when there is not. Both are TCGplayer
 * market prices in USD, so the sum is in one currency.
 *
 * One request per set held, served from the server's 30-day disk cache, and
 * cached-first on the device so revisiting is instant.
 */
export function useCollectionValue(
  rows: ValuableRow[],
  setNames: Record<string, string>,
  /**
   * Second-oracle prices, consulted only where TCGdex has none. Optional so the
   * hook stays testable without a catalog; see hooks/useCatalogPrices.ts.
   */
  catalogPrices?: Map<string, number>,
): CollectionValueResult {
  const setIds = useMemo(() => [...new Set(rows.map((r) => r.setId))].sort(), [rows]);

  const queries = useQueries({
    queries: setIds.map((setId) => {
      const cached = printingsCache.get(setId);
      return {
        ...printingsQuery(setId, setNames[setId] ?? ""),
        ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
      };
    }),
  });

  return useMemo(() => {
    const prices = new Map<string, SetPrintingIndex | null>();
    let pending = 0;
    let failed = 0;

    setIds.forEach((setId, i) => {
      const q = queries[i];
      if (!q) return;
      if (q.isPending) pending += 1;
      if (q.isError) failed += 1;
      prices.set(setId, buildPrintingIndex(q.data?.byNumber));
    });

    // Collector number is the tail of the card id — the same join the rest of
    // the app makes, because TCGdex keys printings by number, not by card id.
    const numberOf = (cardId: string) => cardId.slice(cardId.indexOf("-") + 1);

    // Same order of preference as the owned-cards list: TCGdex, then the
    // catalog. If these two ever disagree the Home total and the list of the
    // very printings behind it would stop adding up.
    const value = valueCollection(
      rows,
      (row) =>
        printingPrice(prices.get(row.setId), numberOf(row.cardId), row.finish) ??
        catalogPrice(catalogPrices, row.cardId, row.finish),
    );

    const movement = aggregateMovement(
      rows.map((row) => printingEur(prices.get(row.setId), numberOf(row.cardId), row.finish)),
    );

    return { ...value, pending, failed, movement };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queries is a new array each render; its data is what matters
  }, [rows, setIds, catalogPrices, queries.map((q) => q.dataUpdatedAt).join(",")]);
}
