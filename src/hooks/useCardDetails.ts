import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CardPriceResult, PokemonCardDetails } from "../models/cards.ts";
import { useCatalog } from "../app/contexts.tsx";
import { cardCache, priceCache } from "../storage/caches.ts";

/** Card metadata, cached-first (7-day TTL) for instant render. */
export function useCardDetails(cardId: string) {
  const { provider, sourceKey } = useCatalog();
  const cached = cardCache.get(cardId);

  const query = useQuery<PokemonCardDetails>({
    queryKey: ["card", sourceKey, cardId],
    queryFn: async ({ signal }) => provider.getCard(cardId, { signal }),
    enabled: Boolean(cardId),
    staleTime: 60 * 60_000,
    ...(cached ? { initialData: cached.value } : {}),
    retry: 1,
  });

  useEffect(() => {
    if (query.data) cardCache.set(cardId, query.data);
  }, [cardId, query.data]);

  return query;
}

export interface PricesResult {
  prices?: CardPriceResult;
  /** True when the shown price came from cache and is older than the TTL. */
  isStale: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Prices, cached-first (30-min TTL). Cached values render immediately and are
 * flagged stale while a refresh runs. */
export function useCardPrices(cardId: string): PricesResult {
  const { provider, sourceKey } = useCatalog();
  const cached = priceCache.get(cardId);

  const query = useQuery<CardPriceResult>({
    queryKey: ["prices", sourceKey, cardId],
    queryFn: async ({ signal }) => provider.getPrices(cardId, { signal }),
    enabled: Boolean(cardId),
    staleTime: 30 * 60_000,
    ...(cached ? { initialData: cached.value } : {}),
    retry: 1,
  });

  useEffect(() => {
    if (query.data && query.isFetched) priceCache.set(cardId, query.data);
  }, [cardId, query.data, query.isFetched]);

  const isStaleCache = Boolean(cached?.isStale && query.isFetching);
  return {
    ...(query.data ? { prices: query.data } : {}),
    isStale: isStaleCache,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
