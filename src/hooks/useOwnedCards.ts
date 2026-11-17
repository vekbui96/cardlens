import { settledKey } from "./settledKey.ts";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useCatalog } from "../app/contexts.tsx";
import { useLibrary } from "../app/LibraryProvider.tsx";
import { useSets } from "./useSets.ts";
import { printingsQuery } from "./useCollectionValue.ts";
import { buildPrintingIndex } from "../models/printingIndex.ts";
import { collectorNumberFromCardId, marketPrice } from "../models/marketPrice.ts";
import { useCatalogPrices } from "./useCatalogPrices.ts";
import { useCatalogNames } from "./useCatalogNames.ts";
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
 * Names and art for every set in one `/api/catalog/names` request, and the
 * printings per set on a queryKey shared with useCollectionValue so a set is
 * never fetched twice. The per-set card list (shared with the set screen and
 * setCardsCache) runs only for sets the batch cannot answer for.
 *
 * Two counts, because names and prices arrive separately: `pending` is sets
 * still waiting on names, `pricing` sets still waiting on their printings. Names
 * come back in one batch while the printings are still on their way, so a
 * screen that read "pricing" off the names alone called the total final — and
 * cards "unpriced" — while prices were still loading.
 */
export function useOwnedCards(): { rows: OwnedPrintingRow[]; pending: number; pricing: number } {
  const { collection, backfillNumbers } = useLibrary();
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

  /**
   * Names, numbers and art for every set in ONE request (`/api/catalog/names`),
   * instead of one catalog call per owned set — nineteen at once on the
   * author's device, against an upstream that fails a quarter of the time.
   */
  const { live: namesLive, query: names } = useCatalogNames(setIds);

  /**
   * A set is asked for on its own only when the batch cannot answer for it: a
   * mocked or simulated catalog, an older server without the endpoint (an
   * error), or a set the server named in `missing`.
   */
  const perSet = (setId: string) => !namesLive || names.isError || (names.data?.missing.has(setId) ?? false);

  useEffect(() => {
    if (names.isError) {
      console.warn("[cardlens] owned names unavailable, naming set by set:", names.error);
    }
  }, [names.isError, names.error]);

  const cardQueries = useQueries({
    queries: setIds.map((setId) => {
      const cached = sourceKey === "base" ? setCardsCache.get(`${setId}|`) : null;
      return {
        // The same key the set screen's unfiltered query uses, so opening a set
        // and opening this list do not each pay for the catalog.
        queryKey: ["set-cards", sourceKey, setId, ""],
        queryFn: ({ signal }: { signal?: AbortSignal }) => provider.getCardsBySet(setId, { signal }),
        enabled: perSet(setId),
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

  /**
   * When each query set last settled, as one string apiece.
   *
   * The query arrays are new objects every render, so they cannot be
   * dependencies themselves — only the data inside them matters. Named here
   * rather than computed inline in the dependency array because a dependency
   * ESLint cannot read statically is one it cannot check, and an unchecked
   * dependency list is exactly where a stale memo hides.
   */
  const cardsSettledAt = settledKey(cardQueries);
  const pricesSettledAt = settledKey(priceQueries);
  // Settling is not the only change `pricing` must see: a set whose name just
  // arrived goes from never-asked to in flight without settling anything.
  const pricesFetching = priceQueries.map((q) => q.fetchStatus).join(",");

  /**
   * Teach the stored rows their collector numbers, from the card lists this
   * hook has already fetched.
   *
   * The migration for every row written before the field existed — there are
   * roughly 973 of them and none can be repaired from its card id, because ids
   * and numbers disagree (`zsv10pt5-80` is number 60, and `cel25c` has four
   * cards numbered 15). This is the one place that already holds the card list
   * of EVERY set the collection touches, so opening this screen once migrates
   * the whole collection rather than a set at a time.
   *
   * Free: the lists are fetched for the rows below either way. Idempotent: the
   * repository fills only absent numbers, never touches `at`, and reports back
   * that it wrote nothing on the second pass, so this cannot loop.
   */
  const namesSettledAt = names.dataUpdatedAt;

  useEffect(() => {
    const known: { id: string; collectorNumber: string }[] = [];
    for (const [id, card] of names.data?.cards ?? []) {
      if (card.number) known.push({ id, collectorNumber: card.number });
    }
    for (const query of cardQueries) {
      for (const card of query.data ?? []) known.push({ id: card.id, collectorNumber: card.collectorNumber });
    }
    if (known.length > 0) backfillNumbers(known);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query array is new each render; cardsSettledAt / namesSettledAt are when their data actually changed
  }, [backfillNumbers, cardsSettledAt, namesSettledAt]);

  return useMemo(() => {
    const cardsBySet = new Map<
      string,
      Map<string, { name: string; number: string; image?: string; large?: string }>
    >();
    const pricesBySet = new Map<string, ReturnType<typeof buildPrintingIndex>>();
    let pending = 0;
    let pricing = 0;

    setIds.forEach((setId, i) => {
      // A disabled query reports isPending forever, so a set counts as pending
      // only on the path actually asking for it.
      const fromBatch = !perSet(setId);
      if (fromBatch ? names.isPending && !cardQueries[i]?.data : cardQueries[i]?.isPending) pending += 1;
      // The same trap for prices: a set with no known name is never asked
      // (`fetchStatus` "idle"), and waiting on it would read "pricing…" forever.
      const price = priceQueries[i];
      if (price?.isPending && price.fetchStatus !== "idle") pricing += 1;
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
      // The batch where it answered; the per-set list (or its device cache) for
      // a set it could not name.
      const info = names.data?.cards.get(card.id) ?? cardsBySet.get(setId)?.get(card.id);
      // The catalog's own number when it has answered, and the card id's tail
      // until then, so a row can list before its name arrives.
      const number = info?.number ?? collectorNumberFromCardId(card.id);
      for (const finish of card.finishes) {
        // TCGdex first, pokemontcg.io second — the one rule, shared with
        // Home's total rather than restated here. See models/marketPrice.ts.
        const price = marketPrice(pricesBySet.get(setId), catalogPrices, card.id, number, finish);
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

    return { rows, pending, pricing };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query arrays are new each render; their settled data is what matters
  }, [
    collection,
    setIds,
    setNames,
    catalogPrices,
    cardsSettledAt,
    pricesSettledAt,
    pricesFetching,
    namesSettledAt,
    names.status,
    namesLive,
  ]);
}
