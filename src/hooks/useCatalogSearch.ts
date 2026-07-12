import { useQuery } from "@tanstack/react-query";
import type { PokemonCardSummary } from "../models/cards.ts";
import { normalizeQuery } from "../services/search/normalize.ts";
import { useCatalog } from "../app/contexts.tsx";

/**
 * Search cards for a chosen query. TanStack Query gives us caching of repeated
 * searches, request cancellation (stale searches abort via `signal`), and retry.
 */
export function useCatalogSearch(query: string) {
  const { provider, sourceKey } = useCatalog();
  const normalized = normalizeQuery(query);
  const enabled = Boolean(normalized.name || normalized.collectorNumber);

  return useQuery<PokemonCardSummary[]>({
    queryKey: ["search", sourceKey, normalized.name, normalized.collectorNumber ?? ""],
    queryFn: ({ signal }) => provider.searchCards(query, { signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
