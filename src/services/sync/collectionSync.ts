import type { OwnedPrinting } from "../../storage/printings.ts";
import { rowStamp } from "../../storage/printings.ts";

/**
 * Client for the collection sync endpoints.
 *
 * There is no outbox queue. Because the collection is an OR-Set, "what still
 * needs sending" is derivable: every local row stamped after the last
 * successful push. That is self-healing in a way a queue is not — a queue can
 * be lost, double-applied, or drift out of step with the data it describes,
 * whereas a watermark recomputes the truth from the rows themselves. A failed
 * sync therefore needs no cleanup at all; the next attempt simply recomputes.
 */

export interface SyncResult {
  rows: OwnedPrinting[];
  /** Server clock, to be stored as the next pull watermark. */
  at: number;
  dropped?: number;
}

/** Long enough for a big first push over a relayed tunnel, short enough to fail. */
export const REQUEST_TIMEOUT_MS = 20_000;

export class SyncDisabledError extends Error {
  constructor() {
    super("collection sync is not configured on the server");
    this.name = "SyncDisabledError";
  }
}

export class SyncAuthError extends Error {
  constructor() {
    super("collection sync token was rejected");
    this.name = "SyncAuthError";
  }
}

function baseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_COMPANION_API_BASE_URL ?? "/api").replace(/\/$/, "");
}

/** Rows that changed locally since the last successful push. */
export function pendingRows(rows: OwnedPrinting[], lastPushedAt: number): OwnedPrinting[] {
  return rows.filter((r) => rowStamp(r) > lastPushedAt);
}

export class CollectionSyncClient {
  constructor(
    private readonly token: string,
    private readonly base: string = baseUrl(),
  ) {}

  get configured(): boolean {
    return Boolean(this.token && this.base);
  }

  private async request(path: string, init: RequestInit = {}): Promise<SyncResult> {
    // A hung fetch never settles, which previously left the caller's in-flight
    // guard stuck true forever — sync would sit on "syncing" and silently
    // swallow every later attempt, including a manual one. Always time out.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${this.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }

    // These two are worth distinguishing from a generic failure: they are
    // permanent until the user acts, so retrying silently forever would hide a
    // wrong token behind an "offline" label.
    if (res.status === 401) throw new SyncAuthError();
    if (res.status === 503) throw new SyncDisabledError();
    if (!res.ok) throw new Error(`sync failed (HTTP ${res.status})`);

    return (await res.json()) as SyncResult;
  }

  /** Send local changes and receive the converged set back. */
  push(rows: OwnedPrinting[]): Promise<SyncResult> {
    return this.request("/collection/merge", {
      method: "POST",
      body: JSON.stringify({ rows }),
    });
  }

  /** Fetch rows the server has seen since a watermark. */
  pull(since: number): Promise<SyncResult> {
    const query = since > 0 ? `?since=${encodeURIComponent(String(since))}` : "";
    return this.request(`/collection${query}`);
  }
}
