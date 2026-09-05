/**
 * A `useMemo` dependency that changes whenever a batch of queries settles —
 * whether it settled into an answer or into a failure.
 *
 * ## Why this exists
 *
 * `useQueries` returns a new array every render, so its result cannot itself be
 * a dependency. Six hooks worked around that the same way:
 *
 *     queries.map((q) => q.dataUpdatedAt).join(",")
 *
 * which is correct for success and silently wrong for failure. **React Query
 * only moves `dataUpdatedAt` when DATA arrives.** A query that errors leaves it
 * at whatever it was — `0`, for a query that never succeeded — so the memo does
 * not re-run on the pending→error transition, and every value derived inside it
 * freezes at what it was when the last *success* landed.
 *
 * The symptom is never an error. It is a number that stops moving:
 *
 * - `useSealed` reported "1 still loading" forever the moment one set's lookup
 *   failed. Observed live in the sealed e2e with a stubbed 404, which is what
 *   turned this from a code smell into a measurement.
 * - `useCollectionValue` computes `failed` from `q.isError` **inside** the memo,
 *   so that field could never be observed changing at all — Home's "a set the
 *   oracle cannot price is named" path was reading a count that was structurally
 *   incapable of leaving zero.
 *
 * Both were live in v1 too. This is not a v2 bug.
 *
 * Keying on both timestamps fixes it: `errorUpdatedAt` moves when a rejection
 * lands, exactly as `dataUpdatedAt` moves when an answer does.
 */
export function settledKey(queries: readonly { dataUpdatedAt: number; errorUpdatedAt: number }[]): string {
  return queries.map((q) => `${q.dataUpdatedAt}:${q.errorUpdatedAt}`).join(",");
}
