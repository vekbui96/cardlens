import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { PokemonCardSummary, PokemonSet } from "../models/cards.ts";
import { useCatalog } from "../app/contexts.tsx";
import { setsCache, setCardsCache } from "../storage/caches.ts";

/** All sets, newest first. Cached-first (7 days) since the set list rarely changes. */
export function useSets() {
  const { provider, sourceKey } = useCatalog();
  const cached = sourceKey === "base" ? setsCache.get("all") : null;

  const query = useQuery<PokemonSet[]>({
    queryKey: ["sets", sourceKey],
    queryFn: ({ signal }) => provider.listSets({ signal }),
    staleTime: 24 * 60 * 60_000,
    retry: 1,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
  });

  useEffect(() => {
    if (sourceKey === "base" && query.isSuccess && query.isFetched && query.data.length > 0) {
      setsCache.set("all", query.data);
    }
  }, [sourceKey, query.isSuccess, query.isFetched, query.data]);

  return query;
}

/** Cards in a set (most valuable first), optionally rarity-filtered. Cached-first. */
export function useSetCards(setId: string, rarities?: string[]) {
  const { provider, sourceKey } = useCatalog();
  const rarityKey = rarities && rarities.length > 0 ? rarities.join(",") : "";
  const cacheKey = `${setId}|${rarityKey}`;
  const cached = sourceKey === "base" ? setCardsCache.get(cacheKey) : null;

  const query = useQuery<PokemonCardSummary[]>({
    queryKey: ["set-cards", sourceKey, setId, rarityKey],
    queryFn: ({ signal }) => provider.getCardsBySet(setId, { signal, ...(rarities ? { rarities } : {}) }),
    enabled: Boolean(setId),
    staleTime: 30 * 60_000,
    retry: 1,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
  });

  useEffect(() => {
    if (sourceKey === "base" && query.isSuccess && query.isFetched && query.data.length > 0) {
      setCardsCache.set(cacheKey, query.data);
    }
  }, [sourceKey, cacheKey, query.isSuccess, query.isFetched, query.data]);

  return query;
}
