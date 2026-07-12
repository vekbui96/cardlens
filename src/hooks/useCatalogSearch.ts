import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { PokemonCardSummary } from "../models/cards.ts";
import { normalizeQuery } from "../services/search/normalize.ts";
import { useCatalog } from "../app/contexts.tsx";
import { searchCache } from "../storage/caches.ts";

/**
 * Search cards for a chosen query. Cached-first: results persist to localStorage
 * (6h) so repeated searches render instantly and survive reloads, while a fresh
 * fetch revalidates in the background. TanStack Query also gives us in-session
 * caching, request cancellation (stale searches abort via `signal`), and retry.
 * The persisted cache is skipped when the DevPanel is simulating a data source.
 */
export function useCatalogSearch(query: string) {
  const { provider, sourceKey } = useCatalog();
  const normalized = normalizeQuery(query);
  const enabled = Boolean(normalized.name || normalized.collectorNumber);

  const cacheKey = `${normalized.name}|${normalized.collectorNumber ?? ""}`;
  const cached = sourceKey === "base" ? searchCache.get(cacheKey) : null;

  const result = useQuery<PokemonCardSummary[]>({
    queryKey: ["search", sourceKey, normalized.name, normalized.collectorNumber ?? ""],
    queryFn: ({ signal }) => provider.searchCards(query, { signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
  });

  // Persist successful, freshly-fetched results (not the cached seed).
  useEffect(() => {
    if (sourceKey === "base" && result.isSuccess && result.isFetched && result.data.length > 0) {
      searchCache.set(cacheKey, result.data);
    }
  }, [sourceKey, cacheKey, result.isSuccess, result.isFetched, result.data]);

  return result;
}
