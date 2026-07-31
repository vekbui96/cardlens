import type { CollectFinish, PokemonCardSummary } from "../models/cards.ts";
import type { TradingCardGame } from "../models/games.ts";
import { setIdFromCardId } from "../utils/cardId.ts";
import { VersionedStore } from "./versioned.ts";

/** Spec limits. */
export const MAX_RECENT_SEARCHES = 20;
export const MAX_RECENTLY_VIEWED = 50;
export const MAX_FAVORITES = 100;
/**
 * Master-setters own thousands of cards, so this cap is far higher than the
 * others. Entries are deliberately tiny (three short fields) — a full English
 * collection lands well under 1MB, leaving room inside the ~5MB localStorage
 * budget shared with the card caches.
 */
export const MAX_COLLECTION = 20_000;

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

/**
 * One owned card. Only the id, its set, the finishes held, and when it was
 * added are stored — the card's name, image and price all come back from the
 * catalog cache, so keeping a copy here would just be a second source of truth
 * that goes stale.
 *
 * `finishes` is the master-set unit: owning the holo and the reverse holo of
 * one card is two entries toward a master set but one card toward the base set,
 * so both numbers are derivable from this shape.
 */
export interface OwnedCard {
  id: string;
  setId: string;
  finishes: CollectFinish[];
  at: number;
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

  // --- Collection (master-set tracking) -------------------------------------
  getCollection(): OwnedCard[] {
    const raw = this.store.read<OwnedCard[]>(
      "collection",
      (v): v is OwnedCard[] =>
        isArray(v) &&
        v.every((x) => {
          const o = x as OwnedCard;
          return typeof o?.id === "string" && typeof o?.setId === "string";
        }),
      [],
    );
    // Entries written before finishes existed carry none; read them as a single
    // normal printing rather than as owning nothing.
    return raw.map((c) => ({
      ...c,
      finishes: isArray(c.finishes) && c.finishes.length > 0 ? c.finishes : ["normal"],
    }));
  }

  isOwned(id: string): boolean {
    return this.getCollection().some((c) => c.id === id);
  }

  ownedFinishes(id: string): CollectFinish[] {
    return this.getCollection().find((c) => c.id === id)?.finishes ?? [];
  }

  isOwnedFinish(id: string, finish: CollectFinish): boolean {
    return this.ownedFinishes(id).includes(finish);
  }

  addOwned(
    cardId: string,
    finish: CollectFinish = "normal",
    setId = setIdFromCardId(cardId),
    now = Date.now(),
  ): OwnedCard[] {
    const current = this.getCollection();
    const existing = current.find((c) => c.id === cardId);
    if (existing) {
      if (existing.finishes.includes(finish)) return current;
      const next = current.map((c) =>
        c.id === cardId ? { ...c, finishes: [...c.finishes, finish] } : c,
      );
      this.store.write("collection", next);
      return next;
    }
    // Oldest-first ordering: a collection is an accumulating record, not a
    // recency list, and stable order keeps set grouping cheap.
    const next = [...current, { id: cardId, setId, finishes: [finish], at: now }].slice(-MAX_COLLECTION);
    this.store.write("collection", next);
    return next;
  }

  /** Removes one finish, or the whole card when `finish` is omitted. */
  removeOwned(cardId: string, finish?: CollectFinish): OwnedCard[] {
    const current = this.getCollection();
    const next =
      finish === undefined
        ? current.filter((c) => c.id !== cardId)
        : current
            .map((c) => (c.id === cardId ? { ...c, finishes: c.finishes.filter((f) => f !== finish) } : c))
            // Dropping the last finish drops the card: an entry with no
            // finishes would count as owned everywhere it is read.
            .filter((c) => c.finishes.length > 0);
    this.store.write("collection", next);
    return next;
  }

  toggleOwned(
    cardId: string,
    finish: CollectFinish = "normal",
    setId = setIdFromCardId(cardId),
  ): OwnedCard[] {
    return this.isOwnedFinish(cardId, finish)
      ? this.removeOwned(cardId, finish)
      : this.addOwned(cardId, finish, setId);
  }

  /** Distinct cards owned per set id — progress against the set's card count. */
  getOwnedCountsBySet(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const card of this.getCollection()) {
      counts[card.setId] = (counts[card.setId] ?? 0) + 1;
    }
    return counts;
  }

  /** Printings owned per set id — progress against a master set. */
  getOwnedFinishCountsBySet(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const card of this.getCollection()) {
      counts[card.setId] = (counts[card.setId] ?? 0) + card.finishes.length;
    }
    return counts;
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
