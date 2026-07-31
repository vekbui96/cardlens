import { describe, expect, it } from "vitest";
import { Repositories, MAX_RECENT_SEARCHES, MAX_FAVORITES } from "./repositories.ts";
import { VersionedStore, createMemoryStorage } from "./versioned.ts";
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
    r.addOwned("base1-4", "holofoil");
    r.addOwned("base1-4", "holofoil");
    expect(r.getCollection()).toHaveLength(1);
    expect(r.ownedFinishes("base1-4")).toEqual(["holofoil"]);
  });

  it("accumulates finishes on one card entry", () => {
    const r = repo();
    r.addOwned("base1-4", "holofoil");
    r.addOwned("base1-4", "reverseHolofoil");
    expect(r.getCollection()).toHaveLength(1);
    expect(r.ownedFinishes("base1-4")).toEqual(["holofoil", "reverseHolofoil"]);
  });

  it("toggles a single finish both ways", () => {
    const r = repo();
    r.toggleOwned("base1-4", "holofoil");
    expect(r.isOwnedFinish("base1-4", "holofoil")).toBe(true);
    r.toggleOwned("base1-4", "holofoil");
    expect(r.isOwnedFinish("base1-4", "holofoil")).toBe(false);
  });

  it("keeps the card when only one of several finishes is removed", () => {
    const r = repo();
    r.addOwned("base1-4", "holofoil");
    r.addOwned("base1-4", "reverseHolofoil");
    r.removeOwned("base1-4", "holofoil");
    expect(r.isOwned("base1-4")).toBe(true);
    expect(r.ownedFinishes("base1-4")).toEqual(["reverseHolofoil"]);
  });

  it("drops the card once its last finish is removed", () => {
    const r = repo();
    r.addOwned("base1-4", "holofoil");
    r.removeOwned("base1-4", "holofoil");
    expect(r.isOwned("base1-4")).toBe(false);
    expect(r.getCollection()).toHaveLength(0);
  });

  it("removes every finish when no finish is given", () => {
    const r = repo();
    r.addOwned("base1-4", "holofoil");
    r.addOwned("base1-4", "reverseHolofoil");
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
    r.addOwned("base1-2", "holofoil");
    r.addOwned("base1-2", "reverseHolofoil");
    r.addOwned("swsh1-3");
    expect(r.getOwnedCountsBySet()).toEqual({ base1: 2, swsh1: 1 });
  });

  it("counts printings per set separately from cards", () => {
    const r = repo();
    r.addOwned("base1-2", "holofoil");
    r.addOwned("base1-2", "reverseHolofoil");
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
