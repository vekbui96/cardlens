import type { PokemonCardSummary } from "../models/cards.ts";
import type { TradingCardGame } from "../models/games.ts";
import { VersionedStore } from "./versioned.ts";

/** Spec limits. */
export const MAX_RECENT_SEARCHES = 20;
export const MAX_RECENTLY_VIEWED = 50;
export const MAX_FAVORITES = 100;

export interface RecentSearch {
  query: string;
  at: number;
}

export interface FavoriteCard extends PokemonCardSummary {
  game: TradingCardGame;
  savedAt: number;
}

export interface ViewedCard extends PokemonCardSummary {
  viewedAt: number;
}

export interface Preferences {
  /** Price cache lifetime in minutes (clamped 15–60). */
  priceTtlMinutes: number;
  reducedMotion: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  priceTtlMinutes: 30,
  reducedMotion: false,
};

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isCardSummary(value: unknown): value is PokemonCardSummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string";
}

/**
 * Repositories over a single VersionedStore. Each is a thin, well-typed CRUD list
 * with dedup + cap + most-recent-first ordering. All reads are corruption-safe.
 */
export class Repositories {
  constructor(private readonly store: VersionedStore = new VersionedStore()) {}

  // --- Recent searches ------------------------------------------------------
  getRecentSearches(): RecentSearch[] {
    return this.store.read<RecentSearch[]>(
      "recent-searches",
      (v): v is RecentSearch[] =>
        isArray(v) && v.every((x) => typeof (x as RecentSearch)?.query === "string"),
      [],
    );
  }

  addRecentSearch(query: string, now = Date.now()): RecentSearch[] {
    const trimmed = query.trim();
    if (!trimmed) return this.getRecentSearches();
    const key = trimmed.toLowerCase();
    const next = [
      { query: trimmed, at: now },
      ...this.getRecentSearches().filter((r) => r.query.toLowerCase() !== key),
    ].slice(0, MAX_RECENT_SEARCHES);
    this.store.write("recent-searches", next);
    return next;
  }

  clearRecentSearches(): void {
    this.store.remove("recent-searches");
  }

  // --- Recently viewed ------------------------------------------------------
  getRecentlyViewed(): ViewedCard[] {
    return this.store.read<ViewedCard[]>(
      "recently-viewed",
      (v): v is ViewedCard[] => isArray(v) && v.every(isCardSummary),
      [],
    );
  }

  addRecentlyViewed(card: PokemonCardSummary, now = Date.now()): ViewedCard[] {
    const next = [
      { ...card, viewedAt: now },
      ...this.getRecentlyViewed().filter((c) => c.id !== card.id),
    ].slice(0, MAX_RECENTLY_VIEWED);
    this.store.write("recently-viewed", next);
    return next;
  }

  // --- Favorites ------------------------------------------------------------
  getFavorites(): FavoriteCard[] {
    return this.store.read<FavoriteCard[]>(
      "favorites",
      (v): v is FavoriteCard[] => isArray(v) && v.every(isCardSummary),
      [],
    );
  }

  isFavorite(id: string): boolean {
    return this.getFavorites().some((c) => c.id === id);
  }

  addFavorite(card: PokemonCardSummary, game: TradingCardGame = "pokemon", now = Date.now()): FavoriteCard[] {
    if (this.isFavorite(card.id)) return this.getFavorites();
    const next = [{ ...card, game, savedAt: now }, ...this.getFavorites()].slice(0, MAX_FAVORITES);
    this.store.write("favorites", next);
    return next;
  }

  removeFavorite(id: string): FavoriteCard[] {
    const next = this.getFavorites().filter((c) => c.id !== id);
    this.store.write("favorites", next);
    return next;
  }

  toggleFavorite(card: PokemonCardSummary, game: TradingCardGame = "pokemon"): FavoriteCard[] {
    return this.isFavorite(card.id) ? this.removeFavorite(card.id) : this.addFavorite(card, game);
  }

  // --- Preferences ----------------------------------------------------------
  getPreferences(): Preferences {
    const prefs = this.store.read<Partial<Preferences>>(
      "preferences",
      (v): v is Partial<Preferences> => typeof v === "object" && v !== null,
      {},
    );
    return { ...DEFAULT_PREFERENCES, ...prefs };
  }

  setPreferences(patch: Partial<Preferences>): Preferences {
    const next = { ...this.getPreferences(), ...patch };
    next.priceTtlMinutes = Math.min(60, Math.max(15, next.priceTtlMinutes));
    this.store.write("preferences", next);
    return next;
  }
}
