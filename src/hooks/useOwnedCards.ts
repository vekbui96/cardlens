import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCatalog } from "../app/contexts.tsx";
import { useLibrary } from "../app/LibraryProvider.tsx";
import { useSets } from "./useSets.ts";
import { printingsQuery } from "./useCollectionValue.ts";
import { buildPrintingIndex, printingPrice } from "../models/printingIndex.ts";
import { catalogPrice } from "../models/catalogPrice.ts";
import { useCatalogPrices } from "./useCatalogPrices.ts";
import type { OwnedPrintingRow } from "../models/ownedSort.ts";
import { setCardsCache } from "../storage/caches.ts";

/**
 * Every printing you hold, as a flat list with names, art and prices.
 *
 * The collection stores (card, finish) rows and nothing else — no name, no
 * image, no price — because those all belong to upstream and change without us.
 * This joins them back together: card details from the catalog, prices from the
 * TCGdex printings the value total already uses.
 *
 * Two requests per set held, both already cached by other screens: the card list
 * shares setCardsCache with the set screen, and the printings share a queryKey
 * with useCollectionValue so a set is never fetched twice.
 */
export function useOwnedCards(): { rows: OwnedPrintingRow[]; pending: number } {
  const { collection } = useLibrary();
  const { provider, sourceKey } = useCatalog();
  const { data: sets } = useSets();

  const setIds = useMemo(
    () => [...new Set(collection.map((c) => c.setId ?? c.id.slice(0, c.id.lastIndexOf("-"))))].sort(),
    [collection],
  );

  const setNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const s of sets ?? []) names[s.id] = s.name;
    return names;
  }, [sets]);

  const cardQueries = useQueries({
    queries: setIds.map((setId) => {
      const cached = sourceKey === "base" ? setCardsCache.get(`${setId}|`) : null;
      return {
        // The same key the set screen's unfiltered query uses, so opening a set
        // and opening this list do not each pay for the catalog.
        queryKey: ["set-cards", sourceKey, setId, ""],
        queryFn: ({ signal }: { signal?: AbortSignal }) => provider.getCardsBySet(setId, { signal }),
        staleTime: 30 * 60_000,
        retry: 1,
        ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
      };
    }),
  });

  const priceQueries = useQueries({
    queries: setIds.map((setId) => printingsQuery(setId, setNames[setId] ?? "")),
  });

  const catalogPrices = useCatalogPrices(setIds);

  return useMemo(() => {
    const cardsBySet = new Map<
      string,
      Map<string, { name: string; number: string; image?: string; large?: string }>
    >();
    const pricesBySet = new Map<string, ReturnType<typeof buildPrintingIndex>>();
    let pending = 0;

    setIds.forEach((setId, i) => {
      if (cardQueries[i]?.isPending) pending += 1;
      const byId = new Map<string, { name: string; number: string; image?: string; large?: string }>();
      for (const c of cardQueries[i]?.data ?? []) {
        byId.set(c.id, {
          name: c.name,
          number: c.collectorNumber,
          ...(c.imageSmall ? { image: c.imageSmall } : {}),
          ...(c.imageLarge ? { large: c.imageLarge } : {}),
        });
      }
      cardsBySet.set(setId, byId);
      pricesBySet.set(setId, buildPrintingIndex(priceQueries[i]?.data?.byNumber));
    });

    const rows: OwnedPrintingRow[] = [];
    for (const card of collection) {
      const setId = card.setId ?? card.id.slice(0, card.id.lastIndexOf("-"));
      const info = cardsBySet.get(setId)?.get(card.id);
      // Collector number is the tail of the card id when the catalog has not
      // answered yet, so a row can list before its name arrives.
      const number = info?.number ?? card.id.slice(card.id.indexOf("-") + 1);
      for (const finish of card.finishes) {
        // TCGdex first, pokemontcg.io second. Neither covers this collection
        // alone: TCGdex has no tcgplayer block for promos and older cards,
        // pokemontcg.io prices none of the modern sets. Both are TCGplayer
        // market prices in USD, so mixing them in one total is sound.
        const price =
          printingPrice(pricesBySet.get(setId), number, finish) ??
          catalogPrice(catalogPrices, card.id, finish);
        rows.push({
          cardId: card.id,
          setId,
          setName: setNames[setId] ?? setId,
          name: info?.name ?? card.id,
          collectorNumber: number,
          finish,
          ...(info?.image ? { imageSmall: info.image } : {}),
          ...(info?.large ? { imageLarge: info.large } : {}),
          ...(price !== undefined ? { price } : {}),
          at: card.at ?? 0,
        });
      }
    }

    return { rows, pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query arrays are new each render; their settled data is what matters
  }, [
    collection,
    setIds,
    setNames,
    catalogPrices,
    cardQueries.map((q) => q.dataUpdatedAt).join(","),
    priceQueries.map((q) => q.dataUpdatedAt).join(","),
  ]);
}
