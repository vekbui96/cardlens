import { companionBase } from "./companionApi.ts";
import { fetchJson } from "./http.ts";
import { ProviderError } from "../integrations/providers.ts";

/**
 * Managing the trade link for a binder.
 *
 * Three operations the OWNER performs, all behind the collection token. What
 * the recipient does — reading the link — needs none of this and none of it
 * runs on their device; see models/tradeShare.ts.
 *
 * Kept out of the binder screen so the screen holds no fetch shapes. This is
 * also the boundary where "the server does not have that binder yet" becomes a
 * named error rather than a 409 the UI has to recognise by number.
 */

/** The server holds no copy of this binder, so a link to it would be dead on arrival. */
export class BinderNotSyncedError extends Error {
  constructor() {
    super("This binder has not reached the server yet");
    this.name = "BinderNotSyncedError";
  }
}

export interface TradeLink {
  id: string;
  binderId: string;
  binderName: string;
  createdAt: number;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/**
 * The trade link for a binder, creating it if there is not one already.
 *
 * Reuse is the server's rule, not this one — pressing "Share for trade" twice
 * must not leave a second live link the owner cannot see in order to revoke it.
 */
export async function createTradeLink(token: string, binderId: string): Promise<TradeLink> {
  let raw: unknown;
  try {
    raw = await fetchJson(`${companionBase()}/share/binder`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ binderId }),
    });
  } catch (err) {
    // The one failure with a fix the user can act on, so it gets its own type
    // rather than being flattened into "could not share". Read from the typed
    // status rather than from the message text, which is a format and not an
    // interface — see ProviderError.
    if (err instanceof ProviderError && err.status === 409) throw new BinderNotSyncedError();
    throw err;
  }

  const v = raw as Record<string, unknown>;
  if (typeof v?.id !== "string") throw new Error("The server did not return a link");
  return {
    id: v.id,
    binderId,
    binderName: typeof v.binderName === "string" ? v.binderName : "",
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
  };
}

/**
 * The live trade link for one binder, or null.
 *
 * Read from the general share list rather than a lookup route of its own: the
 * owner has at most a handful of live links, and one endpoint that answers
 * "what am I sharing" is easier to reason about than two that answer halves
 * of it.
 */
export async function findTradeLink(token: string, binderId: string): Promise<TradeLink | null> {
  const raw = (await fetchJson(`${companionBase()}/share`, { headers: authHeaders(token) })) as {
    shares?: unknown;
  };
  if (!Array.isArray(raw?.shares)) return null;

  for (const row of raw.shares as Record<string, unknown>[]) {
    if (row?.kind === "binder" && row.binderId === binderId && typeof row.id === "string") {
      return {
        id: row.id,
        binderId,
        binderName: typeof row.binderName === "string" ? row.binderName : "",
        createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
      };
    }
  }
  return null;
}

/** Kill a link. It stops answering; it does not retract what was already seen. */
export async function revokeTradeLink(token: string, shareId: string): Promise<void> {
  await fetchJson(`${companionBase()}/share/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}
