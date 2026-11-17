import type { SetPrintings } from "../integrations/tcgdex/client.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** How long a complete printings answer is trusted. Released sets do not change. */
export const PRINTINGS_STALE_MS = 30 * DAY;

/**
 * How long a PROVISIONAL answer is trusted: one the server built while TCGdex
 * was skipping cards. An hour, matching the server's own retry window, so the
 * device heals when the server does instead of a month later.
 */
export const PROVISIONAL_STALE_MS = HOUR;

/** The longest `max-age`, in seconds, that still marks an answer provisional. */
const PROVISIONAL_MAX_AGE_S = 60 * 60;

/**
 * Printings as a loader hands them to React Query.
 *
 * `provisional` lives only in memory. A provisional answer is never written to
 * `printingsCache`, so the stored shape is exactly `SetPrintings` and the cache
 * key keeps its version. Defined here rather than on `SetPrintings` because that
 * type sits in a file the server compiles too.
 */
export type LoadedPrintings = SetPrintings & { provisional?: true };

/**
 * Whether the server's `Cache-Control` says the answer is incomplete.
 *
 * `/api/printings` sends `max-age=2592000` for a complete set and
 * `max-age=3600` when TCGdex skipped cards during the build. A missing or
 * unreadable header (an older server) counts as complete: that is what every
 * answer meant before the header existed.
 */
export function isProvisionalCacheControl(header: string | null | undefined): boolean {
  const match = /max-age=(\d+)/i.exec(header ?? "");
  if (!match) return false;
  return Number(match[1]) <= PROVISIONAL_MAX_AGE_S;
}

/** Mark an answer provisional, or return it unchanged. */
export function withProvisional<T extends SetPrintings>(
  printings: T | null,
  provisional: boolean,
): LoadedPrintings | null {
  if (!printings || !provisional) return printings;
  return { ...printings, provisional: true };
}

/**
 * React Query `staleTime` for a printings query: an hour for a provisional
 * answer, 30 days otherwise. Takes the query so it can be passed as-is.
 */
export function printingsStaleTime(query: { state: { data?: unknown } }): number {
  const data = query.state.data as LoadedPrintings | null | undefined;
  return data?.provisional ? PROVISIONAL_STALE_MS : PRINTINGS_STALE_MS;
}
