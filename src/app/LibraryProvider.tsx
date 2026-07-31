import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CollectFinish, PokemonCardSummary } from "../models/cards.ts";
import type { TradingCardGame } from "../models/games.ts";
import { useRepositories } from "./contexts.tsx";
import type { FavoriteCard, OwnedCard, RecentSearch, ViewedCard } from "../storage/repositories.ts";

interface LibraryValue {
  favorites: FavoriteCard[];
  recentSearches: RecentSearch[];
  recentlyViewed: ViewedCard[];
  collection: OwnedCard[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (card: PokemonCardSummary, game?: TradingCardGame) => void;
  isOwned: (id: string) => boolean;
  ownedFinishes: (id: string) => CollectFinish[];
  isOwnedFinish: (id: string, finish: CollectFinish) => boolean;
  toggleOwned: (cardId: string, finish?: CollectFinish, setId?: string) => void;
  /** Distinct cards per set. */
  ownedCountsBySet: Record<string, number>;
  /** Printings per set — the master-set numerator. */
  ownedFinishCountsBySet: Record<string, number>;
  /** Total printings held across every set. */
  totalFinishesOwned: number;
  addRecentSearch: (query: string) => void;
  addRecentlyViewed: (card: PokemonCardSummary) => void;
  clearRecentSearches: () => void;
}

const LibraryContext = createContext<LibraryValue | null>(null);

/** Holds favorites / recents in React state, mirrored to localStorage repos, so
 * every screen sees consistent, live data. */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const repo = useRepositories();
  const [favorites, setFavorites] = useState<FavoriteCard[]>(() => repo.getFavorites());
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => repo.getRecentSearches());
  const [recentlyViewed, setRecentlyViewed] = useState<ViewedCard[]>(() => repo.getRecentlyViewed());
  const [collection, setCollection] = useState<OwnedCard[]>(() => repo.getCollection());

  const isFavorite = useCallback((id: string) => favorites.some((c) => c.id === id), [favorites]);

  // A Map keeps the per-row owned lookup O(1): collect mode redraws a whole
  // screen of rows on every single mark, and a collection runs to thousands.
  const byId = useMemo(() => new Map(collection.map((c) => [c.id, c])), [collection]);
  const isOwned = useCallback((id: string) => byId.has(id), [byId]);
  const ownedFinishes = useCallback((id: string) => byId.get(id)?.finishes ?? [], [byId]);
  const isOwnedFinish = useCallback(
    (id: string, finish: CollectFinish) => Boolean(byId.get(id)?.finishes.includes(finish)),
    [byId],
  );

  const toggleOwned = useCallback(
    (cardId: string, finish: CollectFinish = "normal", setId?: string) => {
      setCollection(
        setId ? repo.toggleOwned(cardId, finish, setId) : repo.toggleOwned(cardId, finish),
      );
    },
    [repo],
  );

  const { ownedCountsBySet, ownedFinishCountsBySet, totalFinishesOwned } = useMemo(() => {
    const cards: Record<string, number> = {};
    const finishes: Record<string, number> = {};
    let total = 0;
    for (const card of collection) {
      cards[card.setId] = (cards[card.setId] ?? 0) + 1;
      finishes[card.setId] = (finishes[card.setId] ?? 0) + card.finishes.length;
      total += card.finishes.length;
    }
    return { ownedCountsBySet: cards, ownedFinishCountsBySet: finishes, totalFinishesOwned: total };
  }, [collection]);

  const toggleFavorite = useCallback(
    (card: PokemonCardSummary, game: TradingCardGame = "pokemon") => {
      setFavorites(repo.toggleFavorite(card, game));
    },
    [repo],
  );

  const addRecentSearch = useCallback(
    (query: string) => setRecentSearches(repo.addRecentSearch(query)),
    [repo],
  );

  const addRecentlyViewed = useCallback(
    (card: PokemonCardSummary) => setRecentlyViewed(repo.addRecentlyViewed(card)),
    [repo],
  );

  const clearRecentSearches = useCallback(() => {
    repo.clearRecentSearches();
    setRecentSearches([]);
  }, [repo]);

  const value = useMemo<LibraryValue>(
    () => ({
      favorites,
      recentSearches,
      recentlyViewed,
      collection,
      isFavorite,
      toggleFavorite,
      isOwned,
      ownedFinishes,
      isOwnedFinish,
      toggleOwned,
      ownedCountsBySet,
      ownedFinishCountsBySet,
      totalFinishesOwned,
      addRecentSearch,
      addRecentlyViewed,
      clearRecentSearches,
    }),
    [
      favorites,
      recentSearches,
      recentlyViewed,
      collection,
      isFavorite,
      toggleFavorite,
      isOwned,
      ownedFinishes,
      isOwnedFinish,
      toggleOwned,
      ownedCountsBySet,
      ownedFinishCountsBySet,
      totalFinishesOwned,
      addRecentSearch,
      addRecentlyViewed,
      clearRecentSearches,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}
