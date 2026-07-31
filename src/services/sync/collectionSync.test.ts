import { describe, expect, it } from "vitest";
import { pendingRows } from "./collectionSync.ts";
import type { OwnedPrinting } from "../../storage/printings.ts";

const row = (over: Partial<OwnedPrinting> = {}): OwnedPrinting => ({
  cardId: "base1-4",
  setId: "base1",
  finish: "holofoil",
  at: 100,
  ...over,
});

describe("pendingRows", () => {
  it("returns everything when nothing has synced yet", () => {
    expect(pendingRows([row(), row({ cardId: "b-1" })], 0)).toHaveLength(2);
  });

  it("excludes rows already pushed", () => {
    const rows = [row({ at: 100 }), row({ cardId: "b-1", at: 500 })];
    expect(pendingRows(rows, 200).map((r) => r.cardId)).toEqual(["b-1"]);
  });

  it("includes a deletion made after the last push", () => {
    // The row was pushed as owned, then deleted locally — the tombstone is the
    // change that still needs sending, so `at` alone must not decide this.
    const rows = [row({ at: 100, deletedAt: 900 })];
    expect(pendingRows(rows, 500)).toHaveLength(1);
  });

  it("excludes a row stamped exactly at the watermark", () => {
    expect(pendingRows([row({ at: 300 })], 300)).toHaveLength(0);
  });

  it("returns nothing when everything is current", () => {
    expect(pendingRows([row({ at: 100 })], 1_000)).toEqual([]);
  });
});
