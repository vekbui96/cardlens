import { describe, expect, it } from "vitest";
import { settledKey } from "./settledKey.ts";

/**
 * The whole point of this helper is the failure transition, so that is what is
 * asserted. A key that only tracks `dataUpdatedAt` passes every test below
 * except the second — which is exactly the bug that shipped in six hooks.
 */
describe("settledKey", () => {
  it("changes when an answer arrives", () => {
    const before = settledKey([{ dataUpdatedAt: 0, errorUpdatedAt: 0 }]);
    const after = settledKey([{ dataUpdatedAt: 1700, errorUpdatedAt: 0 }]);
    expect(after).not.toBe(before);
  });

  it("changes when a FAILURE arrives, which is the case that was missed", () => {
    // React Query leaves `dataUpdatedAt` at 0 for a query that never succeeded,
    // so a key built from it alone cannot see this transition at all — and every
    // count derived in the memo freezes at its pending value.
    const pending = settledKey([{ dataUpdatedAt: 0, errorUpdatedAt: 0 }]);
    const failed = settledKey([{ dataUpdatedAt: 0, errorUpdatedAt: 1700 }]);
    expect(failed).not.toBe(pending);
  });

  it("changes when a query that HAD data then fails", () => {
    // A refetch that rejects. The stale data is still there, so `dataUpdatedAt`
    // does not move; only the error timestamp does.
    const ok = settledKey([{ dataUpdatedAt: 1700, errorUpdatedAt: 0 }]);
    const stale = settledKey([{ dataUpdatedAt: 1700, errorUpdatedAt: 1800 }]);
    expect(stale).not.toBe(ok);
  });

  it("is stable across renders while nothing has settled", () => {
    // The reason a key is used at all: `useQueries` hands back a new array every
    // render, and recomputing on each one would defeat the memo.
    const q = [
      { dataUpdatedAt: 1700, errorUpdatedAt: 0 },
      { dataUpdatedAt: 0, errorUpdatedAt: 1750 },
    ];
    expect(settledKey(q)).toBe(settledKey([...q.map((x) => ({ ...x }))]));
  });

  it("distinguishes which query in the batch settled, not just how many", () => {
    const a = settledKey([
      { dataUpdatedAt: 1700, errorUpdatedAt: 0 },
      { dataUpdatedAt: 0, errorUpdatedAt: 0 },
    ]);
    const b = settledKey([
      { dataUpdatedAt: 0, errorUpdatedAt: 0 },
      { dataUpdatedAt: 1700, errorUpdatedAt: 0 },
    ]);
    expect(a).not.toBe(b);
  });

  it("has a stable answer for no queries at all", () => {
    expect(settledKey([])).toBe("");
  });
});
