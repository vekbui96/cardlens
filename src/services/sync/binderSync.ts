import type { Binder } from "../../models/binderLayout.ts";
import { apiBaseUrl, syncRequest } from "./http.ts";

/**
 * Client for the binder sync endpoints.
 *
 * Same watermark-not-a-queue design as the collection, for the same reason: a
 * binder's own `updatedAt` already says whether it needs sending, so a failed
 * push needs no cleanup and a device that has been offline for a fortnight
 * works out what to send by looking at its own data.
 *
 * What differs is granularity. Binders converge one whole binder at a time —
 * see storage/binders.ts — so a push is "here are the binders I changed", not
 * "here are the pockets I moved".
 */

export interface BinderSyncResult {
  binders: Binder[];
  /** Server clock, to be stored as the next pull watermark. */
  at: number;
  dropped?: number;
}

export class BinderSyncClient {
  constructor(
    private readonly token: string,
    private readonly base: string = apiBaseUrl(),
  ) {}

  get configured(): boolean {
    return Boolean(this.token && this.base);
  }

  push(binders: Binder[]): Promise<BinderSyncResult> {
    return syncRequest<BinderSyncResult>(this.base, this.token, "/binders/merge", {
      method: "POST",
      body: JSON.stringify({ binders }),
    });
  }

  pull(since: number): Promise<BinderSyncResult> {
    const query = since > 0 ? `?since=${encodeURIComponent(String(since))}` : "";
    return syncRequest<BinderSyncResult>(this.base, this.token, `/binders${query}`);
  }
}
