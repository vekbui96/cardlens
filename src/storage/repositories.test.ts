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
