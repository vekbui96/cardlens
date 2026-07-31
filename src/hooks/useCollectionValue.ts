import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SetPrintings } from "../integrations/tcgdex/client.ts";
import { makeFinish } from "../models/finishes.ts";
import { valueCollection, type CollectionValue, type ValuableRow } from "../models/value.ts";
import { printingsCache } from "../storage/caches.ts";
import { companionBase } from "../services/companionApi.ts";
import { fetchJson } from "../services/http.ts";
import { toSetPrintings } from "./useSetInformation.ts";

/** Price lookup for one set: `<number>|<finish>` -> USD. */
type PriceIndex = Map<string, number>;

function indexPrices(printings: SetPrintings | null): PriceIndex {
  const index: PriceIndex = new Map();
  for (const [number, list] of Object.entries(printings?.byNumber ?? {})) {
    for (const p of list) {
      if (typeof p.price !== "number") continue;
      index.set(`${number}|${makeFinish(p.type, p.foil)}`, p.price);
    }
  }
  return index;
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
 * One request per set held, served from the server's 30-day disk cache, and
 * cached-first on the device so revisiting is instant.
 */
export function useCollectionValue(
  rows: ValuableRow[],
  setNames: Record<string, string>,
): CollectionValueResult {
  const setIds = useMemo(() => [...new Set(rows.map((r) => r.setId))].sort(), [rows]);

  const queries = useQueries({
    queries: setIds.map((setId) => {
      const cached = printingsCache.get(setId);
      return {
        queryKey: ["printings-value", setId],
        queryFn: ({ signal }: { signal?: AbortSignal }) =>
          loadPrintings(setId, setNames[setId] ?? "", signal),
        enabled: Boolean(setNames[setId]),
        staleTime: 30 * 24 * 60 * 60_000,
        retry: 1,
        ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
      };
    }),
  });

  return useMemo(() => {
    const prices = new Map<string, PriceIndex>();
    let pending = 0;
    let failed = 0;

    setIds.forEach((setId, i) => {
      const q = queries[i];
      if (!q) return;
      if (q.isPending) pending += 1;
      if (q.isError) failed += 1;
      prices.set(setId, indexPrices(q.data ?? null));
    });

    const value = valueCollection(rows, (row) => {
      // Collector number is the tail of the card id — the same join the rest of
      // the app makes, because TCGdex keys printings by number, not by card id.
      const number = row.cardId.slice(row.cardId.indexOf("-") + 1);
      const index = prices.get(row.setId);
      if (!index) return undefined;
      return (
        index.get(`${number}|${row.finish}`) ??
        // TCGdex pads modern sets, pokemontcg.io does not, so both forms exist.
        index.get(`${number.replace(/^0+(?=\d)/, "")}|${row.finish}`)
      );
    });

    return { ...value, pending, failed };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queries is a new array each render; its data is what matters
  }, [rows, setIds, queries.map((q) => q.dataUpdatedAt).join(",")]);
}
