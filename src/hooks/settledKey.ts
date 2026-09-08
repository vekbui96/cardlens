/**
 * A dependency key that changes when a set of queries SETTLES — either way.
 *
 * The bug this replaces was everywhere and invisible. Seven `useMemo`s across
 * six hooks depended on `queries.map((q) => q.dataUpdatedAt).join(",")`, and
 * React Query only moves `dataUpdatedAt` when DATA arrives. A query that fails
 * never changes it, so the memo never re-runs, and every value derived inside
 * it freezes at whatever the last success said.
 *
 * Two confirmed symptoms, both of which look like the app hanging rather than
 * like an error:
 *
 * - `useSealed` reports "1 still loading" forever after a single 404. Nothing
 *   is loading; the memo simply cannot see that the request is over.
 * - `useCollectionValue.failed` is counted from `q.isError` INSIDE such a memo,
 *   so it is structurally incapable of leaving zero. Every "this set could not
 *   be priced" branch reading it was dead code.
 *
 * `errorUpdatedAt` is the other half of the pair, and including it is the whole
 * fix: a failure now moves the key exactly as a success does.
 *
 * This is shared code, so v1 gets it too — both versions had the bug.
 */
export function settledKey(queries: readonly { dataUpdatedAt: number; errorUpdatedAt: number }[]): string {
  return queries.map((q) => `${q.dataUpdatedAt}:${q.errorUpdatedAt}`).join(",");
}
