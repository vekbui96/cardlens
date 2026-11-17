import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { SetPrintings } from "../../integrations/tcgdex/client.ts";
import { buildPrintingIndex, printingPrice, type SetPrintingIndex } from "../../models/printingIndex.ts";
import type { CollectFinish } from "../../models/cards.ts";
import type { IndexedCard } from "../../scan/cardIndex.ts";
import { setPrintingsQuery } from "../../hooks/useBinderValue.ts";
import { settledKey } from "../../hooks/settledKey.ts";

export interface ScanPriceRow {
  key: number;
  card: IndexedCard;
  finish: CollectFinish;
}

export interface ScanPrices {
  /** USD market price of the row's picked printing, or undefined when unknown. */
  priceOf: (key: number) => number | undefined;
  /** True while any set in the batch has not answered yet. */
  loading: boolean;
}

/**
 * Prices for the rows of a scan review.
 *
 * Not a hook per row: hooks cannot be called per item, and the footer needs
 * every row's price at once. This asks once per SET in the batch, with the same
 * query key the finish chips (`ScanFinishes` -> `useSetPrintings`) already use,
 * so showing prices costs no request the review was not already making.
 */
export function useScanPrices(rows: readonly ScanPriceRow[]): ScanPrices {
  const sets = useMemo(() => {
    const names = new Map<string, string>();
    for (const { card } of rows) if (!names.has(card.setId)) names.set(card.setId, card.setName);
    return [...names.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const results = useQueries({
    queries: sets.map(([setId, setName]) => setPrintingsQuery(setId, setName)),
  });

  const indexes = useMemo(() => {
    const map = new Map<string, SetPrintingIndex | null>();
    sets.forEach(([setId], i) => {
      const data = results[i]?.data as SetPrintings | null | undefined;
      map.set(setId, buildPrintingIndex(data?.byNumber));
    });
    return map;
    // Results are a new array each render; the settled data inside is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, settledKey(results)]);

  const prices = useMemo(() => {
    const map = new Map<number, number | undefined>();
    for (const { key, card, finish } of rows) {
      map.set(key, printingPrice(indexes.get(card.setId), card.number, finish));
    }
    return map;
  }, [rows, indexes]);

  const priceOf = useCallback((key: number) => prices.get(key), [prices]);
  const loading = results.some((r) => r.isLoading);

  return { priceOf, loading };
}
