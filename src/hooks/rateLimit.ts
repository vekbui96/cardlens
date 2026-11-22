import { ProviderError } from "../integrations/providers.ts";

/** The slice of a React Query result this reads. Nothing here changes a query. */
export interface RateLimitProbe {
  failureReason: unknown;
  fetchStatus: string;
}

export interface RateLimitCount {
  /** Requests whose latest failure was a 429 and that have not succeeded since. */
  limited: number;
  /** Of those, how many are still being tried again. */
  retrying: number;
}

/**
 * How many price requests are being rate limited right now.
 *
 * React Query keeps the last failure on `failureReason` until the query next
 * succeeds or starts a fresh fetch, and keeps `fetchStatus` at "fetching" for
 * the whole retry window. So a 429 with its retry still to come reads as
 * limited AND retrying; a 429 that used up its retry reads as limited only.
 *
 * Read-only on purpose: Home says how far along a rate-limited batch is, it
 * does not change when or how often anything is asked again.
 */
export function countRateLimited(queries: readonly RateLimitProbe[]): RateLimitCount {
  let limited = 0;
  let retrying = 0;
  for (const q of queries) {
    if (!(q.failureReason instanceof ProviderError) || q.failureReason.kind !== "rate-limit") continue;
    limited += 1;
    if (q.fetchStatus === "fetching") retrying += 1;
  }
  return { limited, retrying };
}
