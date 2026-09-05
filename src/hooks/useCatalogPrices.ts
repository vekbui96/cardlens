import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCatalog } from "../app/contexts.tsx";
import { catalogPriceIndex } from "../models/catalogPrice.ts";
import { setCardsCache } from "../storage/caches.ts";
import { companionBase } from "../services/companionApi.ts";
import { shouldUseMocks } from "../integrations/pokemon/index.ts";
import { fetchJson } from "../services/http.ts";
import { settledKey } from "./settledKey.ts";

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
 * **One request for all the sets, not one per set.** Home prices the whole
 * collection, so this is asked for every set held at once — nineteen of them on
 * the author's device. Asking the plain card proxy set by set measured 4.5-6.7
 * seconds per call on the live site, with several failing outright and Home
 * settling on "480 of 973 printings priced". `/api/catalog/prices` answers all
 * of them from a twelve-hour disk cache and sends prices alone, which is a
 * fiftieth of the bytes of the card summaries this used to throw away.
 */
export function useCatalogPrices(setIds: string[]): Map<string, number> {
  const { provider, sourceKey } = useCatalog();
  const key = setIds.join(",");
  /**
   * `sourceKey` alone is not enough. It says "no DevPanel simulation is
   * running", and stays "base" under VITE_USE_MOCKS — where the provider is a
   * mock but this endpoint is a real URL, so the unit tests and the e2e run
   * would reach for the network they are configured never to touch.
   */
  const live = sourceKey === "base" && !shouldUseMocks();

  const batch = useQuery<Map<string, number>>({
    queryKey: ["catalog-prices", key],
    queryFn: ({ signal }) => loadCatalogPrices(setIds, signal),
    // Mocked and simulated catalogs are served by the mock provider, which this
    // endpoint knows nothing about, so the per-set path below is the only one
    // that can answer for them.
    enabled: live && setIds.length > 0,
    staleTime: 30 * 60_000,
    retry: 1,
  });

  /**
   * The old path, per set and through the plain card proxy.
   *
   * Kept, and not only for the mock catalog: Pages and the home server deploy
   * separately, so a client that has shipped against a server that has not is a
   * normal transient state rather than a fault. Without this the collection
   * would read as worth nothing for the length of that window, which is exactly
   * the failure the binder sync's 404 tolerance exists to avoid.
   */
  const fallbackEnabled = !live || (setIds.length > 0 && batch.isError);
  const queries = useQueries({
    queries: setIds.map((setId) => {
      const cached = live ? setCardsCache.get(`${setId}|`) : null;
      return {
        queryKey: ["set-cards", sourceKey, setId, ""],
        queryFn: ({ signal }: { signal?: AbortSignal }) => provider.getCardsBySet(setId, { signal }),
        enabled: fallbackEnabled,
        staleTime: 30 * 60_000,
        retry: 1,
        ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
      };
    }),
  });

  const fallbackStamp = settledKey(queries);

  return useMemo(
    () => {
      // Card ids are globally unique, so one flat index across sets needs no
      // per-set nesting and cannot collide.
      const catalog = catalogPriceIndex(queries.flatMap((q) => q.data ?? []));
      if (!batch.data) return catalog;
      // The batch is authoritative where it has an answer, but a set it could
      // not price (`missing`) may still have been filled by the fallback, so
      // this merges rather than replacing.
      return catalog.size === 0 ? batch.data : new Map([...catalog, ...batch.data]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query array is new each render; its settled data is what matters
    [batch.data, fallbackStamp],
  );
}

/**
 * `<cardId>|<priceKey>` -> USD market price, for every set asked about.
 *
 * Exported so it can be tested directly: the hook switches off under mocks, so
 * driving it through React would never exercise this path at all — the same
 * arrangement fetchSetInformation uses.
 */
export async function loadCatalogPrices(
  setIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const url = `${companionBase()}/catalog/prices?sets=${encodeURIComponent(setIds.join(","))}`;
  // Pricing a whole collection is a bigger job than a card lookup, and the
  // first call after a cache expiry pays for the sets behind it.
  const body = await fetchJson(url, { timeoutMs: 20_000, ...(signal ? { signal } : {}) });
  const prices = (body as { prices?: unknown } | null)?.prices;
  if (!prices || typeof prices !== "object") return new Map();

  const out = new Map<string, number>();
  for (const [key, value] of Object.entries(prices as Record<string, unknown>)) {
    // Only positive prices: absent means unknown, and a zero would total up as
    // though the printing were worthless.
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out.set(key, value);
  }
  return out;
}
