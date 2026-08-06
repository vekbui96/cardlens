import { describe, expect, it } from "vitest";
import {
  binderStamp,
  binderTombstone,
  isLiveBinder,
  liveBinders,
  mergeBinders,
  pendingBinders,
  pruneBinderTombstones,
  referencedImageIds,
} from "./binders.ts";
import { TOMBSTONE_TTL_MS } from "./printings.ts";
import type { Binder } from "../models/binderLayout.ts";

const binder = (over: Partial<Binder> = {}): Binder => ({
  id: "b1",
  name: "Masters",
  format: "9",
  pages: [{ slots: {} }],
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

describe("mergeBinders", () => {
  it("keeps the newer edit of one binder", () => {
    const older = binder({ name: "Old", updatedAt: 100 });
    const newer = binder({ name: "New", updatedAt: 200 });
    expect(mergeBinders([older], [newer])[0].name).toBe("New");
    // Commutative: the caller must not have to know which side is local.
    expect(mergeBinders([newer], [older])[0].name).toBe("New");
  });

  it("keeps both when two devices edit DIFFERENT binders", () => {
    // The case that actually happens, and the reason granularity is per binder
    // rather than per collection-of-binders.
    const mine = binder({ id: "b1", updatedAt: 200 });
    const theirs = binder({ id: "b2", updatedAt: 300 });
    expect(
      mergeBinders([mine], [theirs])
        .map((b) => b.id)
        .sort(),
    ).toEqual(["b1", "b2"]);
  });

  it("lets a deletion outrank a stale edit", () => {
    const deleted = binderTombstone(binder({ updatedAt: 100 }), 500);
    const stale = binder({ name: "Still here", updatedAt: 300 });
    expect(isLiveBinder(mergeBinders([stale], [deleted])[0])).toBe(false);
  });

  it("lets an edit made after a deletion bring the binder back", () => {
    const deleted = binderTombstone(binder({ updatedAt: 100 }), 500);
    const revived = binder({ name: "Rebuilt", updatedAt: 900 });
    const [winner] = mergeBinders([deleted], [revived]);
    expect(isLiveBinder(winner)).toBe(true);
    expect(winner.name).toBe("Rebuilt");
  });

  it("gives a same-millisecond tie to the tombstone", () => {
    // Not hypothetical: deleting writes the tombstone in the same tick the
    // screen last saved the binder. Without a rule the winner depended on map
    // order, which is exactly the bug the collection already had.
    const edited = binder({ updatedAt: 400 });
    const deleted = binderTombstone(binder({ updatedAt: 100 }), 400);
    expect(isLiveBinder(mergeBinders([edited], [deleted])[0])).toBe(false);
    expect(isLiveBinder(mergeBinders([deleted], [edited])[0])).toBe(false);
  });

  it("is idempotent", () => {
    const rows = [binder({ updatedAt: 200 }), binder({ id: "b2", updatedAt: 300 })];
    const once = mergeBinders(rows);
    expect(mergeBinders(once, once)).toEqual(once);
  });
});

describe("binderStamp", () => {
  it("reports the deletion, not the last edit", () => {
    // The watermark has to move when a binder is DELETED, or the tombstone is
    // never pushed and the deletion only ever exists on one device.
    expect(binderStamp(binderTombstone(binder({ updatedAt: 100 }), 900))).toBe(900);
  });
});

describe("binderTombstone", () => {
  it("drops the pages", () => {
    const full = binder({ pages: [{ slots: { 0: { kind: "image", imageId: "x" } } }] });
    expect(binderTombstone(full, 500).pages).toEqual([]);
  });
});

describe("pruneBinderTombstones", () => {
  it("keeps recent deletions and drops ancient ones", () => {
    // A plausible epoch, not a small number: TOMBSTONE_TTL_MS is 180 days, so
    // `now - TTL` on a toy clock is negative and the tombstone reads as live.
    // The collection tests were bitten by exactly this.
    const now = Date.UTC(2026, 0, 1);
    const recent = binderTombstone(binder({ id: "recent" }), now - 1000);
    const ancient = binderTombstone(binder({ id: "ancient" }), now - TOMBSTONE_TTL_MS - 1);
    const kept = pruneBinderTombstones([recent, ancient, binder({ id: "live" })], now);
    expect(kept.map((b) => b.id).sort()).toEqual(["live", "recent"]);
  });
});

describe("liveBinders", () => {
  it("hides tombstones and orders by most recent edit", () => {
    const rows = [
      binder({ id: "old", updatedAt: 100 }),
      binderTombstone(binder({ id: "gone" }), 400),
      binder({ id: "fresh", updatedAt: 300 }),
    ];
    expect(liveBinders(rows).map((b) => b.id)).toEqual(["fresh", "old"]);
  });
});

describe("pendingBinders", () => {
  it("includes a deletion made after the last push", () => {
    const rows = [binderTombstone(binder({ updatedAt: 100 }), 900)];
    expect(pendingBinders(rows, 500)).toHaveLength(1);
  });

  it("excludes a binder stamped exactly at the watermark", () => {
    expect(pendingBinders([binder({ updatedAt: 300 })], 300)).toHaveLength(0);
  });
});

describe("referencedImageIds", () => {
  it("collects ids across pages and binders, ignoring cards", () => {
    const rows = [
      binder({
        id: "b1",
        pages: [
          {
            slots: {
              0: { kind: "image", imageId: "img-a" },
              1: { kind: "card", cardId: "me5-1", finish: "normal" },
            },
          },
          { slots: { 3: { kind: "image", imageId: "img-b" } } },
        ],
      }),
      // Shared between binders — an id is wanted while ANY live binder points at it.
      binder({ id: "b2", pages: [{ slots: { 0: { kind: "image", imageId: "img-a" } } }] }),
    ];
    expect([...referencedImageIds(rows)].sort()).toEqual(["img-a", "img-b"]);
  });

  it("ignores images in a deleted binder", () => {
    const gone = binderTombstone(
      binder({ pages: [{ slots: { 0: { kind: "image", imageId: "img-a" } } }] }),
      500,
    );
    expect(referencedImageIds([gone]).size).toBe(0);
  });
});
