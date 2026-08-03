import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollectionStore, parseRow } from "./collectionStore.ts";
import type { OwnedPrinting } from "../src/storage/printings.ts";

let dir: string;
let file: string;

/**
 * Tombstones are pruned relative to the real clock, so tests that exercise them
 * need plausible epoch timestamps — a `deletedAt` of 300 is 1970 and gets
 * pruned as ancient before any assertion can see it.
 */
const NOW = Date.now();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-test-"));
  file = join(dir, "collection.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const row = (over: Partial<OwnedPrinting> = {}): OwnedPrinting => ({
  cardId: "base1-4",
  setId: "base1",
  finish: "holo",
  at: 100,
  ...over,
});

describe("parseRow", () => {
  it("accepts a well-formed row", () => {
    expect(parseRow(row())).toEqual(row());
  });

  it("keeps a tombstone", () => {
    expect(parseRow(row({ deletedAt: 200 }))?.deletedAt).toBe(200);
  });

  it.each([
    ["not an object", 42],
    ["null", null],
    ["missing cardId", { setId: "base1", finish: "normal", at: 1 }],
    ["empty cardId", { cardId: "", setId: "base1", finish: "normal", at: 1 }],
    ["finish with illegal characters", { cardId: "a-1", setId: "a", finish: "bad finish!", at: 1 }],
    ["empty finish", { cardId: "a-1", setId: "a", finish: "", at: 1 }],
    ["missing at", { cardId: "a-1", setId: "a", finish: "normal" }],
    ["negative at", { cardId: "a-1", setId: "a", finish: "normal", at: -5 }],
  ])("rejects %s", (_label, value) => {
    expect(parseRow(value)).toBeNull();
  });

  it("rejects a non-finite timestamp", () => {
    // A row with at=Infinity would win every future merge for that card,
    // permanently — the endpoint is public, so this must not be storable.
    expect(parseRow(row({ at: Infinity }))).toBeNull();
    expect(parseRow({ ...row(), at: 1, deletedAt: Infinity })).toBeNull();
  });

  it("canonicalises a legacy finish so it cannot become a second row", () => {
    // The client migrated holofoil -> holo; if the server kept the old key,
    // one printing would exist twice across the sync boundary.
    expect(parseRow({ ...row(), finish: "holofoil" })?.finish).toBe("holo");
    expect(parseRow({ ...row(), finish: "pokeBall" })?.finish).toBe("reverse:pokeball");
  });

  it("accepts a foil it has never heard of", () => {
    // Sets keep inventing foils; an allow-list here would silently drop rows on
    // sync, which looks like nothing happened.
    expect(parseRow({ ...row(), finish: "reverse:brandnewball" })?.finish).toBe("reverse:brandnewball");
  });

  it("rejects absurdly long ids", () => {
    expect(parseRow(row({ cardId: "x".repeat(101) }))).toBeNull();
  });
});

describe("CollectionStore", () => {
  it("starts empty when no file exists", () => {
    expect(new CollectionStore(file).all()).toEqual([]);
  });

  it("persists merged rows to disk", () => {
    new CollectionStore(file).merge([row()]);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(1);
  });

  it("reloads what it persisted", () => {
    new CollectionStore(file).merge([row()]);
    expect(new CollectionStore(file).all()).toHaveLength(1);
  });

  it("leaves no temp file behind", () => {
    new CollectionStore(file).merge([row()]);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("applies the merge rule rather than appending", () => {
    const store = new CollectionStore(file);
    store.merge([row({ at: NOW - 1_000 })]);
    store.merge([row({ at: NOW - 1_000, deletedAt: NOW })]);
    const all = store.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.deletedAt).toBe(NOW);
  });

  it("prunes tombstones old enough that every device has seen them", () => {
    const store = new CollectionStore(file);
    const ancient = NOW - 200 * 24 * 60 * 60_000; // 200 days, past the 180-day TTL
    store.merge([row({ at: ancient - 1_000, deletedAt: ancient })]);
    expect(store.all()).toHaveLength(0);
  });

  it("starts empty rather than throwing on a corrupt file", () => {
    writeFileSync(file, "{ this is not json");
    expect(new CollectionStore(file).all()).toEqual([]);
  });

  it("drops invalid rows found in the file", () => {
    writeFileSync(file, JSON.stringify([row(), { nope: true }]));
    expect(new CollectionStore(file).all()).toHaveLength(1);
  });

  it("creates the directory when it does not exist", () => {
    const nested = join(dir, "deep", "nested", "collection.json");
    new CollectionStore(nested).merge([row()]);
    expect(existsSync(nested)).toBe(true);
  });

  describe("since", () => {
    it("returns only rows written after the watermark", () => {
      const store = new CollectionStore(file);
      store.merge([row({ cardId: "a-1", at: 100 }), row({ cardId: "b-1", at: 500 })]);
      expect(store.since(200).map((r) => r.cardId)).toEqual(["b-1"]);
    });

    it("counts a tombstone by its deletion time, not its original at", () => {
      const store = new CollectionStore(file);
      store.merge([row({ cardId: "a-1", at: NOW - 10_000, deletedAt: NOW })]);
      // The client deleted it after its last sync, so it must come back.
      expect(store.since(NOW - 5_000)).toHaveLength(1);
    });

    it("excludes rows exactly at the watermark so nothing repeats", () => {
      const store = new CollectionStore(file);
      store.merge([row({ at: 300 })]);
      expect(store.since(300)).toHaveLength(0);
    });
  });
});

describe("rows that name a game", () => {
  it("keeps a game the client sent", () => {
    // parseRow is a whitelist: a field it does not name is dropped. Without
    // this the server would hand a second game's rows back as Pokémon, which
    // is the same class of failure as the stale finish validation that once
    // dropped rows on sync and looked like nothing had happened.
    expect(parseRow(row({ game: "lorcana" }))?.game).toBe("lorcana");
  });

  it("does not add the default to rows that never carried it", () => {
    expect(parseRow(row())).not.toHaveProperty("game");
    expect(parseRow(row({ game: "pokemon" }))).not.toHaveProperty("game");
  });

  it("refuses to store an unrecognised game", () => {
    // The endpoint is public. An arbitrary string here would partition the
    // OR-Set into keys no client will ever look under.
    const parsed = parseRow({ ...row(), game: "'; DROP TABLE" });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("game");
  });

  it("round-trips a second game through the store", () => {
    const store = new CollectionStore(file);
    store.merge([row({ cardId: "tfc-1", game: "lorcana" }), row({ cardId: "base1-4" })]);

    const reloaded = new CollectionStore(file);
    const byId = Object.fromEntries(reloaded.all().map((r) => [r.cardId, r.game]));
    expect(byId).toEqual({ "tfc-1": "lorcana", "base1-4": undefined });
  });
});

describe("excluded printings", () => {
  it("preserves the flag, so exclusions reach other devices", () => {
    // parseRow is a whitelist: a field it does not name is dropped silently,
    // which would let every device disagree about the master-set target.
    const row = parseRow({
      cardId: "me5-1",
      setId: "me5",
      finish: "reverse",
      at: 1_700_000_000_000,
      excluded: true,
    });
    expect(row?.excluded).toBe(true);
  });

  it("treats anything other than true as not excluded", () => {
    // "false" and absent already mean the same thing; storing a falsy value
    // would add a field to rows that do not need one.
    for (const value of [false, "true", 1, null]) {
      const row = parseRow({
        cardId: "me5-1",
        setId: "me5",
        finish: "reverse",
        at: 1_700_000_000_000,
        excluded: value,
      });
      expect(row).not.toBeNull();
      expect(row?.excluded).toBeUndefined();
    }
  });
});
