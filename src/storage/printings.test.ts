import { describe, expect, it } from "vitest";
import {
  TOMBSTONE_TTL_MS,
  isLive,
  livePrintings,
  mergePrintings,
  pruneTombstones,
  type OwnedPrinting,
} from "./printings.ts";

const row = (over: Partial<OwnedPrinting> = {}): OwnedPrinting => ({
  cardId: "base1-4",
  setId: "base1",
  finish: "holofoil",
  at: 100,
  ...over,
});

function keys(rows: OwnedPrinting[]) {
  return rows.map((r) => `${r.cardId}|${r.finish}`).sort();
}

describe("isLive", () => {
  it("is owned when never deleted", () => {
    expect(isLive(row())).toBe(true);
  });

  it("is not owned when the tombstone is newer", () => {
    expect(isLive(row({ at: 100, deletedAt: 200 }))).toBe(false);
  });

  it("is owned again when re-marked after deletion", () => {
    expect(isLive(row({ at: 300, deletedAt: 200 }))).toBe(true);
  });
});

describe("mergePrintings", () => {
  it("keeps rows from both sides", () => {
    const merged = mergePrintings([row()], [row({ cardId: "base1-5" })]);
    expect(keys(merged)).toEqual(["base1-4|holofoil", "base1-5|holofoil"]);
  });

  it("treats finishes of one card as separate rows", () => {
    const merged = mergePrintings([row({ finish: "holofoil" })], [row({ finish: "reverseHolofoil" })]);
    expect(merged).toHaveLength(2);
  });

  it("lets a newer deletion win over an older mark", () => {
    const merged = mergePrintings([row({ at: 100 })], [row({ at: 100, deletedAt: 200 })]);
    expect(isLive(merged[0])).toBe(false);
  });

  it("lets a newer mark win over an older deletion", () => {
    const merged = mergePrintings([row({ at: 100, deletedAt: 200 })], [row({ at: 300, deletedAt: 200 })]);
    expect(isLive(merged[0])).toBe(true);
  });

  it("resolves a tie in favour of the tombstone", () => {
    const merged = mergePrintings([row({ at: 200 })], [row({ at: 200, deletedAt: 200 })]);
    expect(isLive(merged[0])).toBe(false);
  });

  it("is order-independent", () => {
    const a = [row({ at: 100 }), row({ cardId: "x-1", at: 400 })];
    const b = [row({ at: 100, deletedAt: 300 })];
    const forward = mergePrintings(a, b);
    const backward = mergePrintings(b, a);
    expect(forward.map(isLive)).toEqual(backward.map(isLive));
    expect(keys(forward)).toEqual(keys(backward));
  });

  it("is idempotent", () => {
    const rows = [row({ at: 100, deletedAt: 300 }), row({ cardId: "x-1" })];
    const once = mergePrintings(rows);
    const twice = mergePrintings(once, rows);
    expect(twice).toHaveLength(once.length);
    expect(twice.map(isLive)).toEqual(once.map(isLive));
  });

  it("does not resurrect a deletion the other side never saw", () => {
    // The classic offline case: device A deletes, device B still has the stale
    // owned row and syncs later.
    const deviceA = [row({ at: 100, deletedAt: 500 })];
    const deviceB = [row({ at: 100 })];
    expect(isLive(mergePrintings(deviceA, deviceB)[0])).toBe(false);
  });
});

describe("pruneTombstones", () => {
  it("keeps live rows regardless of age", () => {
    expect(pruneTombstones([row({ at: 1 })], 10 * TOMBSTONE_TTL_MS)).toHaveLength(1);
  });

  it("keeps recent tombstones so they still propagate", () => {
    const rows = [row({ at: 1, deletedAt: 1_000 })];
    expect(pruneTombstones(rows, 1_000 + TOMBSTONE_TTL_MS / 2)).toHaveLength(1);
  });

  it("drops tombstones past the TTL", () => {
    const rows = [row({ at: 1, deletedAt: 1_000 })];
    expect(pruneTombstones(rows, 1_000 + TOMBSTONE_TTL_MS + 1)).toHaveLength(0);
  });
});

describe("livePrintings", () => {
  it("returns only owned rows", () => {
    const rows = [row(), row({ cardId: "x-1", at: 1, deletedAt: 2 })];
    expect(keys(livePrintings(rows))).toEqual(["base1-4|holofoil"]);
  });
});
