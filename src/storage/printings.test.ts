import { describe, expect, it } from "vitest";
import {
  TOMBSTONE_TTL_MS,
  gamePrintings,
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

describe("rows that belong to different games", () => {
  /**
   * The riskiest property in the whole change. Rows written before games
   * existed have no `game` field; if they keyed differently from a row written
   * now, one printing would become two and BOTH would survive the merge —
   * exactly the bug raw finishes caused when "holofoil" and "holo" were both
   * stored for one printing.
   */
  it("treats an old row and an explicit Pokémon row as the same printing", () => {
    const legacy = row({ at: 100 });
    const explicit = row({ game: "pokemon", at: 200 });

    const merged = mergePrintings([legacy], [explicit]);

    expect(merged).toHaveLength(1);
    expect(merged[0].at).toBe(200);
  });

  it("keeps the same card id in two games apart", () => {
    // Nothing guarantees ids are unique across games — TCGplayer numbers them
    // per category — so this is what stops one game's marks appearing in
    // another's counts.
    const pokemon = row({ cardId: "1-1", at: 100 });
    const lorcana = row({ cardId: "1-1", game: "lorcana", at: 100 });

    expect(mergePrintings([pokemon], [lorcana])).toHaveLength(2);
  });

  it("cannot have one game's deletion tombstone another game's card", () => {
    const pokemon = row({ cardId: "1-1", at: 100 });
    const deletedElsewhere = row({ cardId: "1-1", game: "magic", at: 100, deletedAt: 500 });

    const merged = mergePrintings([pokemon], [deletedElsewhere]);

    expect(livePrintings(merged).map((r) => r.game)).toEqual([undefined]);
  });

  it("stays order-independent and idempotent across games", () => {
    const a = row({ cardId: "1-1", at: 100 });
    const b = row({ cardId: "1-1", game: "magic", at: 300 });
    const c = row({ cardId: "1-1", game: "magic", at: 200 });

    const forward = mergePrintings([a], [b], [c]);
    const backward = mergePrintings([c], [b], [a]);
    const twice = mergePrintings(forward, forward);

    const sortKey = (rows: OwnedPrinting[]) =>
      rows.map((r) => `${r.game ?? "pokemon"}|${r.cardId}|${r.at}`).sort();
    expect(sortKey(forward)).toEqual(sortKey(backward));
    expect(sortKey(twice)).toEqual(sortKey(forward));
    // The newest Magic write wins, and Pokémon is untouched by it.
    expect(forward.find((r) => r.game === "magic")?.at).toBe(300);
  });

  it("reads an unknown game as the default rather than dropping the row", () => {
    // A hostile payload or a newer client must not be able to partition the
    // OR-Set into keys this build will never look under.
    const weird = { ...row({ cardId: "1-1" }), game: "buckets" } as unknown as OwnedPrinting;

    expect(mergePrintings([row({ cardId: "1-1" })], [weird])).toHaveLength(1);
  });
});

describe("gamePrintings", () => {
  it("answers for one game at a time, defaulting to Pokémon", () => {
    const rows = [row({ cardId: "a-1" }), row({ cardId: "b-1", game: "lorcana" })];

    expect(gamePrintings(rows).map((r) => r.cardId)).toEqual(["a-1"]);
    expect(gamePrintings(rows, "lorcana").map((r) => r.cardId)).toEqual(["b-1"]);
  });
});
