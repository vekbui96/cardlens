import type { OwnedPrinting } from "../../storage/printings.ts";
import { rowStamp } from "../../storage/printings.ts";
import { apiBaseUrl, syncRequest } from "./http.ts";

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

// Re-exported so existing callers keep importing sync errors from one place.
export { REQUEST_TIMEOUT_MS, SyncAuthError, SyncDisabledError, SyncTooLargeError } from "./http.ts";

/** Rows that changed locally since the last successful push. */
export function pendingRows(rows: OwnedPrinting[], lastPushedAt: number): OwnedPrinting[] {
  return rows.filter((r) => rowStamp(r) > lastPushedAt);
}

export class CollectionSyncClient {
  constructor(
    private readonly token: string,
    private readonly base: string = apiBaseUrl(),
  ) {}

  get configured(): boolean {
    return Boolean(this.token && this.base);
  }

  /** Send local changes and receive the converged set back. */
  push(rows: OwnedPrinting[]): Promise<SyncResult> {
    return syncRequest<SyncResult>(this.base, this.token, "/collection/merge", {
      method: "POST",
      body: JSON.stringify({ rows }),
    });
  }

  /** Fetch rows the server has seen since a watermark. */
  pull(since: number): Promise<SyncResult> {
    const query = since > 0 ? `?since=${encodeURIComponent(String(since))}` : "";
    return syncRequest<SyncResult>(this.base, this.token, `/collection${query}`);
  }
}
