import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { companionBase } from "../../../services/companionApi.ts";
import { fetchJson } from "../../../services/http.ts";
import { canonicalFinish } from "../../../models/finishes.ts";
import { parseTradeShare, type TradeShare } from "../../../models/tradeShare.ts";
import type { ShowcasePrinting } from "../../../models/showcase.ts";

/**
 * Reading a share link, for someone who has nothing.
 *
 * No token and no account: the id IS the credential — sixteen random bytes,
 * see `server/shareStore.ts` — because the recipient is by definition somebody
 * with no login here. Every screen in this directory is built for a stranger.
 */

/**
 * Polled, not pushed.
 *
 * A share changes when a human marks a card or moves one, which is minutes
 * apart at best. A socket would hold an open connection per viewer, through a
 * Tailscale Funnel, to answer "nothing yet" all day. Refetching on focus is
 * what actually makes it feel live: you look at the page, it is current.
 */
const POLL_MS = 60_000;

export interface SetShare {
  kind: "set";
  setId: string;
  setName: string;
  /** The SHARER's printings. Never the viewer's — see `owns` in the screens. */
  owned: ShowcasePrinting[];
  at: number;
}

export type Share = SetShare | ({ kind: "binder" } & TradeShare);

/**
 * A share the server would not give us.
 *
 * Revoked and never-existed are deliberately the same value. The server does
 * not distinguish them, and neither should this: telling a visitor that an id
 * "used to exist" leaks that it was once real.
 */
export const SHARE_GONE = "share_gone";

function parseSetShare(value: unknown): SetShare | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.setId !== "string" || typeof v.setName !== "string") return null;
  if (!Array.isArray(v.owned)) return null;

  const owned = v.owned.flatMap((row): ShowcasePrinting[] => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.collectorNumber !== "string" || typeof r.finish !== "string") return [];
    // Canonicalised here as everywhere else, so a legacy finish from an old
    // client does not become a second key the UI never looks under.
    return [
      {
        collectorNumber: r.collectorNumber,
        finish: canonicalFinish(r.finish),
        ...(typeof r.at === "number" ? { at: r.at } : {}),
      },
    ];
  });

  return {
    kind: "set",
    setId: v.setId,
    setName: v.setName,
    owned,
    at: typeof v.at === "number" ? v.at : Date.now(),
  };
}

/**
 * Which kind of share this row is.
 *
 * **A row with no `kind` is a SET share.** `shares.json` on the live server is
 * full of untagged rows minted before trade shares existed, and every one of
 * them is a set share. Treating an absent tag as unknown would 404 links that
 * people have already sent to other people.
 */
export function parseShare(value: unknown): Share | null {
  if (!value || typeof value !== "object") return null;
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "binder") {
    const trade = parseTradeShare(value);
    return trade ? { kind: "binder", ...trade } : null;
  }
  return parseSetShare(value);
}

export function useShare(shareId: string): UseQueryResult<Share> {
  const base = companionBase();
  return useQuery<Share>({
    queryKey: ["v2-share", shareId],
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    /*
     * A revoked or mistyped link is a permanent answer, not a blip worth
     * retrying three times while somebody waits on a page that says nothing.
     */
    retry: (count, err) => !(err instanceof Error && err.message === SHARE_GONE) && count < 1,
    queryFn: async ({ signal }) => {
      let raw: unknown;
      try {
        raw = await fetchJson(`${base}/share/${encodeURIComponent(shareId)}`, { signal });
      } catch (err) {
        // 404 and 410 are both "this link does not answer any more".
        const message = err instanceof Error ? err.message : "";
        if (/\b(404|410)\b/.test(message) || /not found/i.test(message)) throw new Error(SHARE_GONE);
        throw err;
      }
      const parsed = parseShare(raw);
      // A payload we cannot read is indistinguishable, to the visitor, from one
      // that is no longer there. Both mean: this link does not work.
      if (!parsed) throw new Error(SHARE_GONE);
      return parsed;
    },
  });
}
