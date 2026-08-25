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
export function useCatalogSearch(query: string, rarities?: string[], opts?: { full?: boolean }) {
  const { provider, sourceKey } = useCatalog();
  const normalized = normalizeQuery(query);
  const enabled = Boolean(normalized.name || normalized.collectorNumber);

  const rarityKey = rarities && rarities.length > 0 ? rarities.join(",") : "";
  const full = opts?.full === true;
  // `full` is part of the key, not a detail of the request: a 40-row answer
  // seeded into a full search would look complete and quietly hide 68 Charizards.
  const cacheKey = `${normalized.name}|${normalized.collectorNumber ?? ""}|${rarityKey}${full ? "|full" : ""}`;
  const cached = sourceKey === "base" ? searchCache.get(cacheKey) : null;

  const result = useQuery<PokemonCardSummary[]>({
    queryKey: ["search", sourceKey, normalized.name, normalized.collectorNumber ?? "", rarityKey, full],
    queryFn: ({ signal }) =>
      provider.searchCards(query, { signal, ...(rarities ? { rarities } : {}), ...(full ? { full } : {}) }),
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
