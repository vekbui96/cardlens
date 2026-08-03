import { describe, expect, it } from "vitest";
import { Repositories, MAX_RECENT_SEARCHES, MAX_FAVORITES } from "./repositories.ts";
import { VersionedStore, createMemoryStorage, type StorageLike } from "./versioned.ts";
import type { PokemonCardSummary } from "../models/cards.ts";

function repo() {
  return new Repositories(new VersionedStore(createMemoryStorage()));
}

const card = (id: string, name = "Card"): PokemonCardSummary => ({
  id,
  name,
  setName: "Set",
  setCode: "ST",
  collectorNumber: "1",
});

describe("recent searches", () => {
  it("dedupes case-insensitively and keeps most-recent first", () => {
    const r = repo();
    r.addRecentSearch("Charizard");
    r.addRecentSearch("Pikachu");
    r.addRecentSearch("charizard");
    const recents = r.getRecentSearches();
    expect(recents.map((x) => x.query)).toEqual(["charizard", "Pikachu"]);
  });

  it("caps the list length", () => {
    const r = repo();
    for (let i = 0; i < MAX_RECENT_SEARCHES + 5; i++) r.addRecentSearch(`q${i}`);
    expect(r.getRecentSearches()).toHaveLength(MAX_RECENT_SEARCHES);
  });

  it("ignores empty queries", () => {
    const r = repo();
    r.addRecentSearch("   ");
    expect(r.getRecentSearches()).toHaveLength(0);
  });
});

describe("favorites", () => {
  it("adds, detects, and removes", () => {
    const r = repo();
    r.addFavorite(card("a"));
    expect(r.isFavorite("a")).toBe(true);
    r.removeFavorite("a");
    expect(r.isFavorite("a")).toBe(false);
  });

  it("toggles", () => {
    const r = repo();
    r.toggleFavorite(card("a"));
    expect(r.isFavorite("a")).toBe(true);
    r.toggleFavorite(card("a"));
    expect(r.isFavorite("a")).toBe(false);
  });

  it("does not duplicate and caps at the max", () => {
    const r = repo();
    r.addFavorite(card("a"));
    r.addFavorite(card("a"));
    expect(r.getFavorites()).toHaveLength(1);
    for (let i = 0; i < MAX_FAVORITES + 10; i++) r.addFavorite(card(`c${i}`));
    expect(r.getFavorites().length).toBeLessThanOrEqual(MAX_FAVORITES);
  });
});

describe("collection", () => {
  it("adds, detects, and removes", () => {
    const r = repo();
    r.addOwned("base1-4");
    expect(r.isOwned("base1-4")).toBe(true);
    r.removeOwned("base1-4");
    expect(r.isOwned("base1-4")).toBe(false);
  });

  it("ignores duplicate finishes so re-marking a card is a no-op", () => {
    const r = repo();
    r.addOwned("base1-4", "holo");
    r.addOwned("base1-4", "holo");
    expect(r.getCollection()).toHaveLength(1);
    expect(r.ownedFinishes("base1-4")).toEqual(["holo"]);
  });

  it("accumulates finishes on one card entry", () => {
    const r = repo();
    r.addOwned("base1-4", "holo");
    r.addOwned("base1-4", "reverse");
    expect(r.getCollection()).toHaveLength(1);
    expect(r.ownedFinishes("base1-4")).toEqual(["holo", "reverse"]);
  });

  it("toggles a single finish both ways", () => {
    const r = repo();
    r.toggleOwned("base1-4", "holo");
    expect(r.isOwnedFinish("base1-4", "holo")).toBe(true);
    r.toggleOwned("base1-4", "holo");
    expect(r.isOwnedFinish("base1-4", "holo")).toBe(false);
  });

  it("keeps the card when only one of several finishes is removed", () => {
    const r = repo();
    r.addOwned("base1-4", "holo");
    r.addOwned("base1-4", "reverse");
    r.removeOwned("base1-4", "holo");
    expect(r.isOwned("base1-4")).toBe(true);
    expect(r.ownedFinishes("base1-4")).toEqual(["reverse"]);
  });

  it("drops the card once its last finish is removed", () => {
    const r = repo();
    r.addOwned("base1-4", "holo");
    r.removeOwned("base1-4", "holo");
    expect(r.isOwned("base1-4")).toBe(false);
    expect(r.getCollection()).toHaveLength(0);
  });

  it("removes every finish when no finish is given", () => {
    const r = repo();
    r.addOwned("base1-4", "holo");
    r.addOwned("base1-4", "reverse");
    r.removeOwned("base1-4");
    expect(r.getCollection()).toHaveLength(0);
  });

  it("derives the set id from the card id when not given one", () => {
    const r = repo();
    r.addOwned("swsh45sv-SV001");
    expect(r.getCollection()[0]?.setId).toBe("swsh45sv");
  });

  it("prefers an explicit set id over the derived one", () => {
    const r = repo();
    r.addOwned("weirdcard", "normal", "promo-set");
    expect(r.getCollection()[0]?.setId).toBe("promo-set");
  });

  it("counts distinct cards per set", () => {
    const r = repo();
    r.addOwned("base1-1");
    r.addOwned("base1-2", "holo");
    r.addOwned("base1-2", "reverse");
    r.addOwned("swsh1-3");
    expect(r.getOwnedCountsBySet()).toEqual({ base1: 2, swsh1: 1 });
  });

  it("counts printings per set separately from cards", () => {
    const r = repo();
    r.addOwned("base1-2", "holo");
    r.addOwned("base1-2", "reverse");
    r.addOwned("base1-3", "normal");
    expect(r.getOwnedFinishCountsBySet()).toEqual({ base1: 3 });
    expect(r.getOwnedCountsBySet()).toEqual({ base1: 2 });
  });

  it("keeps insertion order so the record reads oldest-first", () => {
    const r = repo();
    r.addOwned("base1-1");
    r.addOwned("base1-2");
    expect(r.getCollection().map((c) => c.id)).toEqual(["base1-1", "base1-2"]);
  });

  it("treats a legacy finish and its canonical form as one printing", () => {
    // Reads migrate holofoil -> holo, so writing the raw value would leave two
    // OR-Set keys for the same printing and both would survive the merge.
    const r = repo();
    r.addOwned("base1-4", "holofoil");
    r.addOwned("base1-4", "holo");
    expect(r.ownedFinishes("base1-4")).toEqual(["holo"]);
  });

  it("migrates a legacy pattern value to a type:foil key", () => {
    const r = repo();
    r.addOwned("sv08.5-5", "pokeBall");
    expect(r.ownedFinishes("sv08.5-5")).toEqual(["reverse:pokeball"]);
  });

  it("reads pre-variant entries as a single normal printing", () => {
    const store = new VersionedStore(createMemoryStorage());
    store.write("collection", [{ id: "base1-4", setId: "base1", at: 1 }]);
    expect(new Repositories(store).ownedFinishes("base1-4")).toEqual(["normal"]);
  });

  it("survives corrupt stored data", () => {
    const store = new VersionedStore(createMemoryStorage());
    store.write("collection", [{ nope: true }]);
    expect(new Repositories(store).getCollection()).toEqual([]);
  });
});

describe("preferences", () => {
  it("clamps price TTL to 15–60 minutes", () => {
    const r = repo();
    expect(r.setPreferences({ priceTtlMinutes: 5 }).priceTtlMinutes).toBe(15);
    expect(r.setPreferences({ priceTtlMinutes: 999 }).priceTtlMinutes).toBe(60);
  });

  it("returns defaults when unset", () => {
    expect(repo().getPreferences().priceTtlMinutes).toBe(30);
  });
});

describe("target bot settings", () => {
  it("returns an empty token when unset", () => {
    expect(repo().getTargetSettings().token).toBe("");
  });

  it("round-trips a token", () => {
    const r = repo();
    expect(r.setTargetSettings({ token: "abc123" }).token).toBe("abc123");
    expect(r.getTargetSettings().token).toBe("abc123");
  });

  it("keeps the target token out of collection sync, and vice versa", () => {
    // The whole point of the split: this token can drive a Target cart, the
    // sync token cannot. Writing one must never populate the other, or every
    // syncing device silently gains the larger power.
    const r = repo();
    r.setTargetSettings({ token: "target-only" });
    r.setSyncSettings({ token: "collection-only" });

    expect(r.getSyncSettings().token).toBe("collection-only");
    expect(r.getTargetSettings().token).toBe("target-only");

    r.clearSync();
    expect(r.getTargetSettings().token).toBe("target-only");
  });
});

describe("excluding a printing from the master set", () => {
  it("stops it counting as owned without owning it", () => {
    const r = repo();
    r.toggleExcluded("me5-1", "reverse");

    expect(r.excludedFinishes("me5-1")).toEqual(["reverse"]);
    // Not owned - an exclusion is the opposite of a mark, not a kind of one.
    expect(r.getCollection().find((c) => c.id === "me5-1")).toBeUndefined();
  });

  it("drops ownership when a held printing is excluded", () => {
    // Otherwise "held" and "target" disagree: the printing counts toward a set
    // it has just been declared not part of.
    const r = repo();
    r.toggleOwned("me5-1", "reverse");
    expect(r.getCollection()[0].finishes).toContain("reverse");

    r.toggleExcluded("me5-1", "reverse");
    expect(r.getCollection().find((c) => c.id === "me5-1")).toBeUndefined();
    expect(r.excludedFinishes("me5-1")).toEqual(["reverse"]);
  });

  it("puts it back when excluded a second time", () => {
    const r = repo();
    r.toggleExcluded("me5-1", "reverse");
    r.toggleExcluded("me5-1", "reverse");
    expect(r.excludedFinishes("me5-1")).toEqual([]);
  });

  it("survives a reload", () => {
    // The read path is a whitelist, so a field it does not name is silently
    // dropped - which would lose every exclusion on the next page load.
    const storage = createMemoryStorage();
    const first = new Repositories(new VersionedStore(storage));
    first.toggleExcluded("me5-1", "reverse");

    const second = new Repositories(new VersionedStore(storage));
    expect(second.excludedFinishes("me5-1")).toEqual(["reverse"]);
  });

  it("keeps exclusions per printing, not per card", () => {
    const r = repo();
    r.toggleOwned("me5-1", "normal");
    r.toggleExcluded("me5-1", "reverse");

    expect(r.getCollection()[0].finishes).toEqual(["normal"]);
    expect(r.excludedFinishes("me5-1")).toEqual(["reverse"]);
  });
});

describe("a device that has run out of storage", () => {
  /**
   * Reproduced in a real browser before this was written: with the collection
   * write failing, tapping a printing ran the handler, left aria-pressed false,
   * left the tile count unchanged and reported nothing. addOwned re-read
   * storage to build its return value, got the rows from before the mark, and
   * handed React a state identical to the one it already had.
   *
   * A full quota is reachable in normal use — one set costs ~107KB across the
   * card and printing caches, and the collection is written into whatever they
   * leave behind.
   */
  function fullStorage(failFor: RegExp = /collection/) {
    const inner = createMemoryStorage();
    let writes = 0;
    return {
      writes: () => writes,
      storage: {
        getItem: (k: string) => inner.getItem(k),
        removeItem: (k: string) => inner.removeItem(k),
        setItem: (k: string, v: string) => {
          if (failFor.test(k)) {
            writes++;
            const err = new Error("quota");
            err.name = "QuotaExceededError";
            throw err;
          }
          inner.setItem(k, v);
        },
      } satisfies StorageLike,
    };
  }

  it("still marks the card, so the tap is never a silent no-op", () => {
    const full = fullStorage();
    const r = new Repositories(new VersionedStore(full.storage), () => 0);

    r.addOwned("base1-4", "holo");

    expect(r.isOwnedFinish("base1-4", "holo")).toBe(true);
    expect(r.getCollection()).toHaveLength(1);
  });

  it("says so, rather than leaving the failure invisible", () => {
    const full = fullStorage();
    const r = new Repositories(new VersionedStore(full.storage), () => 0);

    expect(r.storageDegraded).toBe(false);
    r.addOwned("base1-4", "holo");
    expect(r.storageDegraded).toBe(true);
  });

  it("keeps the rows syncable, so they still reach the server", () => {
    const full = fullStorage();
    const r = new Repositories(new VersionedStore(full.storage), () => 0);

    r.addOwned("base1-4", "holo");

    // getPrintings is what sync pushes. A device that cannot save must still be
    // able to hand its work to one that can.
    expect(r.getPrintings().map((p) => p.finish)).toEqual(["holo"]);
  });

  it("spends the caches to save the collection before giving up", () => {
    // The caches cost one request each to rebuild; the collection cannot be
    // rebuilt at all, so it wins the argument for the remaining space.
    const inner = createMemoryStorage();
    let full = true;
    const storage: StorageLike = {
      getItem: (k) => inner.getItem(k),
      removeItem: (k) => inner.removeItem(k),
      setItem: (k, v) => {
        if (full && /collection/.test(k)) {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
        inner.setItem(k, v);
      },
    };
    let evictions = 0;
    const r = new Repositories(new VersionedStore(storage), () => {
      evictions++;
      full = false; // freeing the caches made room
      return 3;
    });

    r.addOwned("base1-4", "holo");

    expect(evictions).toBe(1);
    expect(r.storageDegraded).toBe(false);
    // Written for real this time, so a reload keeps it.
    expect(new Repositories(new VersionedStore(storage)).isOwnedFinish("base1-4", "holo")).toBe(true);
  });

  it("recovers once there is room again", () => {
    const inner = createMemoryStorage();
    let full = true;
    const storage: StorageLike = {
      getItem: (k) => inner.getItem(k),
      removeItem: (k) => inner.removeItem(k),
      setItem: (k, v) => {
        if (full && /collection/.test(k)) {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
        inner.setItem(k, v);
      },
    };
    const r = new Repositories(new VersionedStore(storage), () => 0);

    r.addOwned("base1-4", "holo");
    expect(r.storageDegraded).toBe(true);

    full = false;
    r.addOwned("base1-5", "normal");

    expect(r.storageDegraded).toBe(false);
    // Both marks land: the in-memory rows are what the successful write saves.
    const reloaded = new Repositories(new VersionedStore(storage));
    expect(reloaded.isOwnedFinish("base1-4", "holo")).toBe(true);
    expect(reloaded.isOwnedFinish("base1-5", "normal")).toBe(true);
  });
});

describe("more than one game", () => {
  const store = () => new VersionedStore(createMemoryStorage());

  it("does not write the default game onto every row", () => {
    // 20,000 rows is the cap, and this app has already had localStorage run
    // out and silently swallow marks. A redundant field on every row is not
    // free.
    const s = store();
    new Repositories(s).addOwned("base1-4", "holo");

    const raw = s.read<unknown[]>("collection", (v): v is unknown[] => Array.isArray(v), []);
    expect(raw[0]).not.toHaveProperty("game");
  });

  it("stamps a row that is not the default", () => {
    const s = store();
    new Repositories(s, () => 0, "lorcana").addOwned("tfc-1", "normal");

    const raw = s.read<{ game?: string }[]>(
      "collection",
      (v): v is { game?: string }[] => Array.isArray(v),
      [],
    );
    expect(raw[0]?.game).toBe("lorcana");
  });

  it("counts only the game being looked at", () => {
    const s = store();
    new Repositories(s).addOwned("base1-4", "holo");
    new Repositories(s, () => 0, "lorcana").addOwned("tfc-1", "normal");

    expect(new Repositories(s).getCollection().map((c) => c.id)).toEqual(["base1-4"]);
    expect(new Repositories(s, () => 0, "lorcana").getCollection().map((c) => c.id)).toEqual(["tfc-1"]);
  });

  it("will not report another game's card as owned", () => {
    const s = store();
    new Repositories(s, () => 0, "magic").addOwned("shared-1", "normal");

    // Same id, different game: the Pokémon view must not claim it.
    expect(new Repositories(s).isOwned("shared-1")).toBe(false);
    expect(new Repositories(s, () => 0, "magic").isOwned("shared-1")).toBe(true);
  });

  it("will not let one game un-mark another game's identical card", () => {
    const s = store();
    new Repositories(s).addOwned("shared-1", "normal");
    new Repositories(s, () => 0, "magic").addOwned("shared-1", "normal");

    new Repositories(s, () => 0, "magic").removeOwned("shared-1", "normal");

    expect(new Repositories(s).isOwned("shared-1")).toBe(true);
    expect(new Repositories(s, () => 0, "magic").isOwned("shared-1")).toBe(false);
  });

  it("syncs every game's rows, not just the active one", () => {
    // A device that withheld another game's rows would look to the server
    // exactly like a device that had deleted them.
    const s = store();
    new Repositories(s).addOwned("base1-4", "holo");
    new Repositories(s, () => 0, "lorcana").addOwned("tfc-1", "normal");

    expect(new Repositories(s).getPrintings()).toHaveLength(2);
  });
});
