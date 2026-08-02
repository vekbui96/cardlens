import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCatalog } from "../app/contexts.tsx";
import { catalogPriceIndex } from "../models/catalogPrice.ts";
import { setCardsCache } from "../storage/caches.ts";

/**
 * pokemontcg.io market prices for every card in the given sets, as one index.
 *
 * The second pricing oracle, behind TCGdex. It exists because neither source
 * covers this collection on its own: TCGdex returns an empty tcgplayer block
 * for promos and older cards, and pokemontcg.io prices none of the modern sets
 * (0/120 Pitch Black, 0/124 Perfect Order). See models/catalogPrice.ts.
 *
 * One hook rather than a copy in each caller, so the owned-cards list and the
 * collection total cannot end up disagreeing about what a printing is worth —
 * the same reason printingsQuery is shared.
 *
 * Costs nothing extra: the queryKey is the one the set screen's unfiltered card
 * list already uses, so these resolve from cache whenever a set has been opened.
 */
export function useCatalogPrices(setIds: string[]): Map<string, number> {
  const { provider, sourceKey } = useCatalog();

  const queries = useQueries({
    queries: setIds.map((setId) => {
      const cached = sourceKey === "base" ? setCardsCache.get(`${setId}|`) : null;
      return {
        queryKey: ["set-cards", sourceKey, setId, ""],
        queryFn: ({ signal }: { signal?: AbortSignal }) => provider.getCardsBySet(setId, { signal }),
        staleTime: 30 * 60_000,
        retry: 1,
        ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
      };
    }),
  });

  return useMemo(
    // Card ids are globally unique, so one flat index across sets needs no
    // per-set nesting and cannot collide.
    () => catalogPriceIndex(queries.flatMap((q) => q.data ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query array is new each render; its settled data is what matters
    [queries.map((q) => q.dataUpdatedAt).join(",")],
  );
}
