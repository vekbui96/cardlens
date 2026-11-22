import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useRepositories } from "../app/contexts.tsx";
import { companionBase } from "../services/companionApi.ts";
import { fetchJson } from "../services/http.ts";
import { parseValueHistory, type ValueRow } from "../models/valueHistory.ts";

/**
 * What the Home value chart can say about the collection's past (#117).
 *
 * - `off`: this device has no sync token, so it cannot ask the server — the
 *   history lives there (#112). Said plainly, never as an error.
 * - `loading`: the one request is in flight.
 * - `ready`: the rows, possibly none yet.
 * - `hidden`: the read failed, or came back in a shape this build does not
 *   know. Home draws nothing for it and stays as it was: a chart that could not
 *   load is not worth a red panel on the busiest screen in the app.
 */
export type ValueHistoryState =
  { status: "off" } | { status: "loading" } | { status: "ready"; rows: ValueRow[] } | { status: "hidden" };

/**
 * One `GET /api/value-history` per Home visit, behind the collection token.
 *
 * Lives here rather than in `v2/screens/home/` so Home keeps its rule that no
 * file in that directory opens a request of its own. The server answers
 * `no-store` and the history moves once a day, so a five-minute stale time is
 * plenty and a refocus does not ask again.
 */
export function useValueHistory(): ValueHistoryState {
  const repo = useRepositories();
  // Read once per mount: connecting a device happens in Settings, which
  // unmounts Home, so a mount is exactly the moment to look.
  const [token] = useState(() => repo.getSyncSettings().token);

  const query = useQuery({
    queryKey: ["value-history", token],
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const raw = await fetchJson(`${companionBase()}/value-history`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
        timeoutMs: 15_000,
      });
      return parseValueHistory(raw);
    },
  });

  if (!token) return { status: "off" };
  if (query.isPending) return { status: "loading" };
  if (query.isError || query.data === null || query.data === undefined) return { status: "hidden" };
  return { status: "ready", rows: query.data };
}
