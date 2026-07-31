import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { PokemonCardSummary } from "../models/cards.ts";
import type { Printing, SetPrintings } from "../integrations/tcgdex/client.ts";
import { CardListResponseSchema } from "../integrations/pokemon/schema.ts";
import { toSummary } from "../integrations/pokemon/map.ts";
import { byPriceDesc } from "../integrations/pokemon/sort.ts";
import { shouldUseMocks } from "../integrations/pokemon/index.ts";
import { ProviderError } from "../integrations/providers.ts";
import { useCatalog } from "../app/contexts.tsx";
import { setCardsCache, printingsCache } from "../storage/caches.ts";
import { buildPrintingIndex, type SetPrintingIndex } from "../models/printingIndex.ts";
import { companionBase } from "../services/companionApi.ts";
import { fetchJson } from "../services/http.ts";

export interface SetInformation {
  /** Every card in the set, unfiltered — rarity filtering happens in memory. */
  cards: PokemonCardSummary[];
  /** Raw TCGdex printings, or null when the server could not supply them. */
  printings: SetPrintings | null;
}

/**
 * Normalise the `printings` half of the payload.
 *
 * The endpoint has shipped in two shapes: the bare `byNumber` map, and the whole
 * `SetPrintings` record that `/api/printings` already returns. Accepting both
 * means the client and the server can deploy in either order — this server has
 * been silently stale before, and that failure was invisible until rows started
 * disappearing.
 */
export function toSetPrintings(raw: unknown): SetPrintings | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as { tcgdexSetId?: unknown; byNumber?: unknown };
  const byNumber = record.byNumber ?? raw;
  if (!byNumber || typeof byNumber !== "object") return null;
  return {
    // Empty when the payload did not say. Deliberately not invented: the cache
    // write below skips entries that cannot name where the data came from.
    tcgdexSetId: typeof record.tcgdexSetId === "string" ? record.tcgdexSetId : "",
    byNumber: byNumber as Record<string, Printing[]>,
  };
}

/**
 * Everything the set screen needs, in one request.
 *
 * Exported for tests, which drive it directly rather than through the hook —
 * the hook deliberately switches itself off under mocks.
 */
export async function fetchSetInformation(
  setId: string,
  setName: string,
  signal?: AbortSignal,
): Promise<SetInformation> {
  const url =
    `${companionBase()}/set-information/${encodeURIComponent(setId)}` +
    `?name=${encodeURIComponent(setName)}`;
  const json = (await fetchJson(url, { ...(signal ? { signal } : {}) })) as {
    cards?: unknown;
    printings?: unknown;
  };

  const parsed = CardListResponseSchema.safeParse(json.cards);
  if (!parsed.success) {
    throw new ProviderError("Unexpected set-information response", "validation", { cause: parsed.error });
  }

  return {
    // Same order the provider produces, so the cache entry this warms is
    // indistinguishable from one the per-set query wrote.
    cards: parsed.data.data.map(toSummary).sort(byPriceDesc),
    printings: toSetPrintings(json.printings),
  };
}

export interface SetInformationResult {
  /** Every card in the set, or null when the aggregate could not answer. */
  cards: PokemonCardSummary[] | null;
  printings: SetPrintingIndex | null;
  isLoading: boolean;
  /** True when the caller must use the per-query fallback path instead. */
  isUnavailable: boolean;
  refetch: () => void;
}

/**
 * Cards + printings for a set in a single request, from our own server.
 *
 * The set screen otherwise makes three: rarity-filtered cards for the list,
 * unfiltered cards for the master-set denominator, and printings. The server
 * holds all three, so composing them there removes two round trips from a device
 * reaching the network through a tethered phone.
 *
 * It can always decline. `isUnavailable` means "ask the catalog provider
 * yourself" — the home server spends days at a time powered off, and losing the
 * catalog with it would be a worse failure than the one being fixed.
 */
export function useSetInformation(setId: string, setName: string): SetInformationResult {
  const { sourceKey } = useCatalog();
  /**
   * Only when the real catalog is in play. A DevPanel simulation (`?sim=fail`)
   * swaps the provider, and an aggregate endpoint that went around it would
   * quietly defeat the simulation; under mocks there is no server to ask.
   */
  const enabled = Boolean(setId && setName) && sourceKey === "base" && !shouldUseMocks();

  // Cached-first, from the same entries the fallback path reads and writes, so a
  // revisited set paints before the request lands and the two paths cannot
  // disagree about what is cached.
  const cachedCards = enabled ? setCardsCache.get(`${setId}|`) : null;
  const cachedPrintings = enabled ? printingsCache.get(setId) : null;

  const query = useQuery<SetInformation>({
    queryKey: ["set-information", setId, setName],
    queryFn: ({ signal }) => fetchSetInformation(setId, setName, signal),
    enabled,
    staleTime: 30 * 60_000,
    /**
     * No retry. The fallback IS the retry, and a second attempt only lengthens
     * the stall on the common failure — the machine being switched off, which
     * fails fast the first time.
     */
    retry: false,
    ...(cachedCards
      ? {
          initialData: { cards: cachedCards.value, printings: cachedPrintings?.value ?? null },
          initialDataUpdatedAt: cachedCards.storedAt,
        }
      : {}),
  });

  useEffect(() => {
    if (!query.isSuccess || !query.data) return;
    const { cards, printings } = query.data;
    if (cards.length > 0) setCardsCache.set(`${setId}|`, cards);
    // Only when the payload named its TCGdex set. A SetPrintings records where
    // the data came from, and fabricating that to satisfy the cache would put a
    // lie in storage for 30 days.
    if (printings?.tcgdexSetId && Object.keys(printings.byNumber).length > 0) {
      printingsCache.set(setId, printings);
    }
  }, [setId, query.isSuccess, query.data]);

  const printings = useMemo(() => buildPrintingIndex(query.data?.printings?.byNumber), [query.data]);

  /**
   * An empty card list counts as no answer. A set always has cards, so an empty
   * one means the proxy served something degenerate — falling back beats
   * rendering "No cards" over a set that plainly has some.
   */
  const cards = query.data?.cards ?? null;
  const isUnavailable = !enabled || query.isError || (query.isSuccess && (cards?.length ?? 0) === 0);

  return {
    cards: isUnavailable ? null : cards,
    printings: isUnavailable ? null : printings,
    isLoading: query.isLoading,
    isUnavailable,
    refetch: () => void query.refetch(),
  };
}
