import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { TcgdexClient, type SetPrintings } from "../integrations/tcgdex/client.ts";
import { printingsCache } from "../storage/caches.ts";
import { isLikelyPackPrinting, type Finish } from "../models/finishes.ts";
import { makeFinish } from "../models/finishes.ts";

/** One client per app: it memoises the 218-entry set list across every set view. */
const client = new TcgdexClient();

export interface SetPrintingIndex {
  /** Collector number -> the printings that card exists in. */
  byNumber: Record<string, Finish[]>;
  /** Every printing seen in the set, ordered for pickers. */
  all: Finish[];
  /**
   * Total printings counted toward completion — the master-set denominator
   * under the rule "if you can pull it from a standard pack it counts".
   */
  packTotal: number;
  /** Printings excluded as product exclusives, with the card counts that got them excluded. */
  excluded: { finish: Finish; cards: number }[];
}

/**
 * Printings for a set, from TCGdex, cached for 30 days.
 *
 * Enabled only when asked for, because filling it costs one request per card.
 * pokemontcg.io cannot answer this at all for some sets, so there is no
 * cheaper source to fall back on.
 */
export function useSetPrintings(setId: string, setName: string, enabled = true) {
  const cached = printingsCache.get(setId);

  const query = useQuery<SetPrintings | null>({
    queryKey: ["set-printings", setId],
    queryFn: ({ signal }) => client.getSetPrintings(setId, setName, { signal }),
    enabled: enabled && Boolean(setId && setName),
    staleTime: 30 * 24 * 60 * 60_000,
    retry: 1,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
  });

  useEffect(() => {
    if (query.isSuccess && query.data && Object.keys(query.data.byNumber).length > 0) {
      printingsCache.set(setId, query.data);
    }
  }, [setId, query.isSuccess, query.data]);

  const index = useMemo<SetPrintingIndex | null>(() => {
    const data = query.data;
    if (!data) return null;

    const byNumber: Record<string, Finish[]> = {};
    const cardsPerFinish = new Map<Finish, number>();
    // Count by card, not by index entry: numbers are indexed twice (padded and
    // unpadded), so counting entries would double every total.
    const counted = new Set<string>();

    for (const [number, printings] of Object.entries(data.byNumber)) {
      const finishes = printings.map((p) => makeFinish(p.type, p.foil));
      byNumber[number] = finishes;
      const canonicalKey = number.replace(/^0+(?=\d)/, "");
      if (counted.has(canonicalKey)) continue;
      counted.add(canonicalKey);
      for (const f of finishes) cardsPerFinish.set(f, (cardsPerFinish.get(f) ?? 0) + 1);
    }

    const cardsInSet = counted.size;
    const all: Finish[] = [];
    const excluded: { finish: Finish; cards: number }[] = [];
    let packTotal = 0;

    for (const [finish, cards] of cardsPerFinish) {
      all.push(finish);
      if (isLikelyPackPrinting(cards, cardsInSet)) packTotal += cards;
      else excluded.push({ finish, cards });
    }

    return { byNumber, all, packTotal, excluded };
  }, [query.data]);

  return { ...query, index };
}
