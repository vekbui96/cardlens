import { settledKey } from "./settledKey.ts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCatalog } from "../app/contexts.tsx";
import { catalogPriceIndex } from "../models/catalogPrice.ts";
import { setCardsCache } from "../storage/caches.ts";
import { companionBase } from "../services/companionApi.ts";
import { shouldUseMocks } from "../integrations/pokemon/index.ts";
import { fetchJson } from "../services/http.ts";

export interface CatalogPrices {
  prices: Map<string, number>;
  /**
   * True while an enabled request is in flight with no answer yet: the batch,
   * or any per-set fallback query. A disabled query is `isPending` forever, so
   * only `fetchStatus !== "idle"` counts — otherwise "pricing…" never ends.
   */
  pricesLoading: boolean;
}

/** One `/api/catalog/prices` answer: what it priced, and the sets it could not. */
export interface CatalogPriceBatch {
  prices: Map<string, number>;
  missing: string[];
}

/**
 * How long the follow-up for `missing` sets waits. pokemontcg.io's failures
 * cluster in time, and the server proxy already retries across ~4s, so an
 * immediate second ask would land in the same burst.
 */
export const MISSING_RETRY_DELAY_MS = 5_000;

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
 *
 * **It says when it is still loading.** That request is the slow one on a cold
 * cache (8669ms measured, 97ms warm), and for promos and older cards it is the
 * only price. A bare map hid that, so callers counted only the printings and
 * called those cards "unpriced" in a total that read as final mid-request.
 */
export function useCatalogPrices(setIds: string[]): CatalogPrices {
  const { provider, sourceKey } = useCatalog();
  const key = setIds.join(",");
  /**
   * `sourceKey` alone is not enough. It says "no DevPanel simulation is
   * running", and stays "base" under VITE_USE_MOCKS — where the provider is a
   * mock but this endpoint is a real URL, so the unit tests and the e2e run
   * would reach for the network they are configured never to touch.
   */
  const live = sourceKey === "base" && !shouldUseMocks();

  const batch = useQuery<CatalogPriceBatch>({
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
   * One more ask for the sets the batch named `missing`, and only those.
   *
   * pokemontcg.io fails in bursts and the server does not cache a failure, so a
   * set missed in one burst is usually there seconds later — measured
   * 2026-11-16: a five-set batch came back `missing: ["sv3"]`, and `sv3` alone
   * a moment later priced 406 printings. `retry` cannot see this: the batch
   * SUCCEEDED, so without a second ask the gap stood for the whole staleTime.
   *
   * The wait puts it outside the burst (the server already retries across ~4s).
   * Its own `missing` is ignored and it never retries, so a set the server can
   * never price costs exactly one extra request, not a loop. It is left out of
   * `pricesLoading` for the same reason: the first answer is already a usable
   * total, and holding "pricing…" over an unpriceable promo set on every visit
   * would say the total is unfinished when it is as finished as it gets.
   */
  const missing = batch.data?.missing ?? [];
  const followUp = useQuery<CatalogPriceBatch>({
    queryKey: ["catalog-prices-retry-missing", missing.join(",")],
    queryFn: async ({ signal }) => {
      await abortableDelay(MISSING_RETRY_DELAY_MS, signal);
      return loadCatalogPrices(missing, signal);
    },
    enabled: live && missing.length > 0,
    staleTime: 30 * 60_000,
    retry: 0,
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

  const pricesLoading =
    (batch.isPending && batch.fetchStatus !== "idle") ||
    queries.some((q) => q.isPending && q.fetchStatus !== "idle");

  const prices = useMemo(
    () => {
      // Card ids are globally unique, so one flat index across sets needs no
      // per-set nesting and cannot collide.
      const catalog = catalogPriceIndex(queries.flatMap((q) => q.data ?? []));
      const batchPrices = batch.data?.prices;
      const retried = followUp.data?.prices;
      if (!batchPrices) return catalog;
      // The batch is authoritative where it has an answer. The per-set fallback
      // only runs when the whole batch failed, so a set the batch named
      // `missing` is filled by the follow-up ask or not at all.
      if (catalog.size === 0 && !retried?.size) return batchPrices;
      return new Map([...catalog, ...batchPrices, ...(retried ?? [])]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query array is new each render; its settled data is what matters
    [batch.data, followUp.data, fallbackStamp],
  );

  return useMemo(() => ({ prices, pricesLoading }), [prices, pricesLoading]);
}

/**
 * `<cardId>|<priceKey>` -> USD market price, for every set asked about.
 *
 * Exported so it can be tested directly: the hook switches off under mocks, so
 * driving it through React would never exercise this path at all — the same
 * arrangement fetchSetInformation uses.
 */
export async function loadCatalogPrices(setIds: string[], signal?: AbortSignal): Promise<CatalogPriceBatch> {
  const url = `${companionBase()}/catalog/prices?sets=${encodeURIComponent(setIds.join(","))}`;
  // Pricing a whole collection is a bigger job than a card lookup, and the
  // first call after a cache expiry pays for the sets behind it.
  const body = (await fetchJson(url, { timeoutMs: 20_000, ...(signal ? { signal } : {}) })) as {
    prices?: unknown;
    missing?: unknown;
  } | null;

  // Only sets that were actually asked about: the follow-up request is built
  // from this list, and an odd body must not make the client ask for others.
  const asked = new Set(setIds);
  const missing = Array.isArray(body?.missing)
    ? body.missing.filter((id): id is string => typeof id === "string" && asked.has(id))
    : [];

  const prices = body?.prices;
  const out = new Map<string, number>();
  if (!prices || typeof prices !== "object") return { prices: out, missing };

  for (const [key, value] of Object.entries(prices as Record<string, unknown>)) {
    // Only positive prices: absent means unknown, and a zero would total up as
    // though the printing were worthless.
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out.set(key, value);
  }
  return { prices: out, missing };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}
