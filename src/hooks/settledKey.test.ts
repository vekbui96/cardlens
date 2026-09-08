import { describe, expect, it } from "vitest";
import { settledKey } from "./settledKey.ts";

/**
 * The behaviour these hooks needed and did not have: a key that moves when a
 * query FAILS, not only when it succeeds.
 */
describe("settledKey", () => {
  it("changes when a query starts failing", () => {
    // The whole bug. With `dataUpdatedAt` alone these two are identical, the
    // memo never re-runs, and the failure is invisible to everything computed
    // inside it.
    const before = settledKey([{ dataUpdatedAt: 100, errorUpdatedAt: 0 }]);
    const after = settledKey([{ dataUpdatedAt: 100, errorUpdatedAt: 200 }]);
    expect(after).not.toBe(before);
  });

  it("changes when data arrives", () => {
    expect(settledKey([{ dataUpdatedAt: 0, errorUpdatedAt: 0 }])).not.toBe(
      settledKey([{ dataUpdatedAt: 100, errorUpdatedAt: 0 }]),
    );
  });

  it("changes when a retry fails again", () => {
    // A second failure is news too: it is what turns "retrying" into "still
    // broken", and a screen offering a retry has to be able to see it.
    expect(settledKey([{ dataUpdatedAt: 0, errorUpdatedAt: 100 }])).not.toBe(
      settledKey([{ dataUpdatedAt: 0, errorUpdatedAt: 200 }]),
    );
  });

  it("is stable while nothing settles", () => {
    // Otherwise every render recomputes, which is what the memo exists to stop.
    const queries = [
      { dataUpdatedAt: 1, errorUpdatedAt: 2 },
      { dataUpdatedAt: 3, errorUpdatedAt: 0 },
    ];
    expect(settledKey(queries)).toBe(settledKey([...queries]));
  });

  it("distinguishes queries settling in a different order", () => {
    expect(
      settledKey([
        { dataUpdatedAt: 1, errorUpdatedAt: 0 },
        { dataUpdatedAt: 2, errorUpdatedAt: 0 },
      ]),
    ).not.toBe(
      settledKey([
        { dataUpdatedAt: 2, errorUpdatedAt: 0 },
        { dataUpdatedAt: 1, errorUpdatedAt: 0 },
      ]),
    );
  });

  it("handles an empty list", () => {
    expect(settledKey([])).toBe("");
  });
});
