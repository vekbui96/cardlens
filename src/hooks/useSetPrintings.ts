import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { TcgdexClient, type SetPrintings } from "../integrations/tcgdex/client.ts";
import { printingsCache } from "../storage/caches.ts";
import { buildPrintingIndex, type SetPrintingIndex } from "../models/printingIndex.ts";
import { companionBase } from "../services/companionApi.ts";

/** One client per app: it memoises the 218-entry set list across every set view. */
const client = new TcgdexClient();

/**
 * Ask our own server first: it caches printings on disk, so this is ONE request
 * instead of the 120-295 that building a set costs upstream. That difference is
 * the whole point on glasses tethered to a phone.
 *
 * Falls back to fetching TCGdex directly, so the feature still works with the
 * home server switched off — just expensively.
 */
async function loadPrintings(
  setId: string,
  setName: string,
  signal?: AbortSignal,
): Promise<SetPrintings | null> {
  try {
    const url = `${companionBase()}/printings/${encodeURIComponent(setId)}?name=${encodeURIComponent(setName)}`;
    const res = await fetch(url, { ...(signal ? { signal } : {}) });
    if (res.ok) return (await res.json()) as SetPrintings;
    // 404 means the set is genuinely unknown upstream; no point retrying direct.
    if (res.status === 404) return null;
  } catch {
    // Server unreachable — fall through to the direct path.
  }
  return client.getSetPrintings(setId, setName, { ...(signal ? { signal } : {}) });
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

  const query = useQuery<SetPrintings | null>({
    queryKey: ["set-printings", setId],
    queryFn: ({ signal }) => loadPrintings(setId, setName, signal),
    enabled: enabled && Boolean(setId && setName),
    staleTime: 30 * 24 * 60 * 60_000,
    retry: 1,
    ...(cached ? { initialData: cached.value, initialDataUpdatedAt: cached.storedAt } : {}),
  });

  useEffect(() => {
    // Guard the shape rather than assuming it. The response is untyped JSON from
    // a server that has been out of step with the client before, and reaching
    // into a missing `byNumber` here took the whole screen down rather than
    // degrading to "no printings", which is a state everything else handles.
    const byNumber = query.data?.byNumber;
    if (query.isSuccess && byNumber && Object.keys(byNumber).length > 0) {
      printingsCache.set(setId, query.data as SetPrintings);
    }
  }, [setId, query.isSuccess, query.data]);

  const index = useMemo<SetPrintingIndex | null>(
    () => buildPrintingIndex(query.data?.byNumber),
    [query.data],
  );

  return { ...query, index };
}
