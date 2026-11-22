/** The parts of a React Query result `failedOrRetrying` reads. */
interface QueryState {
  isError: boolean;
  isFetching: boolean;
  errorUpdateCount: number;
  data?: unknown;
}

/**
 * Whether a screen should show its ErrorNotice: the query failed, OR it failed
 * and a retry is now in flight.
 *
 * React Query puts a query with no data back to `pending` the moment a refetch
 * starts, so `isError` goes false on Try again. A screen that branched on
 * `isError` alone swapped the notice for its loading skeleton mid-press: the
 * focused button was removed, focus fell to `<body>`, and "Trying again…" was
 * never seen. Keeping the notice up for the retry keeps focus on the button and
 * lets the notice re-announce if the retry fails too.
 */
export function failedOrRetrying(query: QueryState): boolean {
  return query.isError || (query.isFetching && query.errorUpdateCount > 0 && query.data === undefined);
}
