import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLibrary } from "../app/LibraryProvider.tsx";
import { useSets } from "./useSets.ts";
import type { SetSealed } from "../models/sealed.ts";
import { companionBase } from "../services/companionApi.ts";
import { fetchJson } from "../services/http.ts";

export interface SealedRow extends SetSealed {
  setName: string;
  /** Printings you hold from this set, for ordering by what you actually collect. */
  holdings: number;
}

export interface SealedResult {
  rows: SealedRow[];
  pending: number;
  /** Sets with no sealed product upstream — promos and tins mostly. */
  missing: number;
}

function isSealed(value: unknown): value is SetSealed {
  return Boolean(value && typeof value === "object" && Array.isArray((value as SetSealed).prices));
}

/**
 * Current sealed prices for every set you collect.
 *
 * Scoped to sets you hold rather than all 217, because "current pack price" is
 * a question about what you are working on — and 217 sets would be 217 requests
 * on a screen nobody scrolls to the bottom of.
 *
 * Half-day staleTime against the server's daily refresh: asking more often
 * spends requests to read the same numbers back.
 */
export function useSealed(): SealedResult {
  const { collection, ownedFinishCountsBySet } = useLibrary();
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

  const queries = useQueries({
    queries: setIds.map((setId) => {
      const name = setNames[setId] ?? "";
      return {
        queryKey: ["sealed", setId] as const,
        queryFn: async ({ signal }: { signal?: AbortSignal }) => {
          const url = `${companionBase()}/sealed/${encodeURIComponent(setId)}?name=${encodeURIComponent(name)}`;
          const body = await fetchJson(url, { ...(signal ? { signal } : {}) });
          return isSealed(body) ? body : null;
        },
        enabled: Boolean(name),
        staleTime: 12 * 60 * 60_000,
        // One retry only: a 404 here means the set genuinely has no sealed
        // product, which is a normal answer for promos and not worth retrying.
        retry: 1,
      };
    }),
  });

  return useMemo(() => {
    const rows: SealedRow[] = [];
    let pending = 0;
    let missing = 0;

    setIds.forEach((setId, i) => {
      const q = queries[i];
      if (!q) return;
      if (q.isPending) {
        pending += 1;
        return;
      }
      if (!q.data) {
        missing += 1;
        return;
      }
      rows.push({
        ...q.data,
        setName: setNames[setId] ?? setId,
        holdings: ownedFinishCountsBySet[setId] ?? 0,
      });
    });

    // Most-collected first: the set you are deep in is the one whose pack price
    // you are actually deciding on.
    rows.sort((a, b) => b.holdings - a.holdings || a.setName.localeCompare(b.setName));
    return { rows, pending, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query array is new each render; its settled data is what matters
  }, [setIds, setNames, ownedFinishCountsBySet, queries.map((q) => q.dataUpdatedAt).join(",")]);
}
