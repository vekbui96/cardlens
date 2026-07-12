import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PokemonCardSummary } from "../models/cards.ts";
import type { TradingCardGame } from "../models/games.ts";
import { useRepositories } from "./contexts.tsx";
import type { FavoriteCard, RecentSearch, ViewedCard } from "../storage/repositories.ts";

interface LibraryValue {
  favorites: FavoriteCard[];
  recentSearches: RecentSearch[];
  recentlyViewed: ViewedCard[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (card: PokemonCardSummary, game?: TradingCardGame) => void;
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

  const isFavorite = useCallback((id: string) => favorites.some((c) => c.id === id), [favorites]);

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
      isFavorite,
      toggleFavorite,
      addRecentSearch,
      addRecentlyViewed,
      clearRecentSearches,
    }),
    [
      favorites,
      recentSearches,
      recentlyViewed,
      isFavorite,
      toggleFavorite,
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
