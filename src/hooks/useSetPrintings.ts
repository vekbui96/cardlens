import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { TcgdexClient, type SetPrintings } from "../integrations/tcgdex/client.ts";
import { printingsCache } from "../storage/caches.ts";
import { buildPrintingIndex, type SetPrintingIndex } from "../models/printingIndex.ts";
import { companionBase } from "../services/companionApi.ts";
import {
  isProvisionalCacheControl,
  printingsStaleTime,
  withProvisional,
  type LoadedPrintings,
} from "../models/printingsFreshness.ts";

/** One client per app: it memoises the 218-entry set list across every set view. */
const client = new TcgdexClient();

/**
 * Ask our own server first: it caches printings on disk, so this is ONE request
 * instead of the 120-295 that building a set costs upstream. That difference is
 * the whole point on glasses tethered to a phone.
 *
 * Falls back to fetching TCGdex directly, so the feature still works with the
 * home server switched off — just expensively.
 *
 * Exported because the binder asks the same question of thirty sets at once
 * (see useBinderValue). One definition, or the two paths drift on which server
 * they trust first.
 */
export async function loadPrintings(
  setId: string,
  setName: string,
  signal?: AbortSignal,
): Promise<LoadedPrintings | null> {
  try {
    const url = `${companionBase()}/printings/${encodeURIComponent(setId)}?name=${encodeURIComponent(setName)}`;
    const res = await fetch(url, { ...(signal ? { signal } : {}) });
    if (res.ok) {
      // The server shortens its Cache-Control to an hour when TCGdex skipped
      // cards during the build. A CORS-safelisted header, so it is readable
      // cross-origin with no server change.
      const provisional = isProvisionalCacheControl(res.headers?.get("cache-control"));
      return withProvisional((await res.json()) as SetPrintings, provisional);
    }
    // 404 means the set is genuinely unknown upstream; no point retrying direct.
    if (res.status === 404) return null;
  } catch {
    // Server unreachable — fall through to the direct path.
  }
  const report = await client.buildSetPrintings(setId, setName, { ...(signal ? { signal } : {}) });
  return withProvisional(report?.printings ?? null, (report?.skippedCards ?? 0) > 0);
}

export type { SetPrintingIndex };

/**
 * Printings for a set, from TCGdex, cached for 30 days.
 *
 * Enabled only when asked for, because filling it costs one request per card.
 * pokemontcg.io cannot answer this at all for some sets, so there is no
 * cheaper source to fall back on.
 */
export function useSetPrintings(setId: string, setName: string, enabled = true) {
  const cached = printingsCache.get(setId);

  const query = useQuery<LoadedPrintings | null>({
    queryKey: ["set-printings", setId],
    queryFn: ({ signal }) => loadPrintings(setId, setName, signal),
    enabled: enabled && Boolean(setId && setName),
    // 30 days, or an hour for an answer the server marked incomplete.
    staleTime: printingsStaleTime,
    retry: 1,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
  });

  useEffect(() => {
    // Guard the shape rather than assuming it. The response is untyped JSON from
    // a server that has been out of step with the client before, and reaching
    // into a missing `byNumber` here took the whole screen down rather than
    // degrading to "no printings", which is a state everything else handles.
    const byNumber = query.data?.byNumber;
    // A provisional answer is shown but never stored: the cache would keep the
    // gap for 30 days, long after the server has filled it in.
    if (query.isSuccess && byNumber && Object.keys(byNumber).length > 0 && !query.data?.provisional) {
      printingsCache.set(setId, query.data as SetPrintings);
    }
  }, [setId, query.isSuccess, query.data]);

  const index = useMemo<SetPrintingIndex | null>(
    () => buildPrintingIndex(query.data?.byNumber),
    [query.data],
  );

  return { ...query, index };
}
