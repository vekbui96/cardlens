/**
 * A new binder's id, for the web shell.
 *
 * Ids must be unique across DEVICES, not just this one, because they are the
 * key binders converge on: two phones that both minted "b1" would merge into
 * one binder and the older arrangement would vanish. The clock alone is not
 * enough — two devices creating a binder in the same millisecond is unlikely
 * but the failure is silent and permanent — so it carries randomness too.
 *
 * Its own file so the shelf (new binder) and Settings (duplicate) mint ids the
 * same way. v2 has its own in `v2/screens/binders/shelf.ts`; v1 must not
 * import from `src/v2/` (see `e2e/v2/bundle.spec.ts`).
 */
export function newBinderId(now: number = Date.now()): string {
  return `b${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
