import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CollectFinish, PokemonCardSummary } from "../models/cards.ts";
import type { TradingCardGame } from "../models/games.ts";
import { useRepositories } from "./contexts.tsx";
import type {
  FavoriteCard,
  OwnedCard,
  RecentSearch,
  SyncSettings,
  ViewedCard,
} from "../storage/repositories.ts";
import {
  CollectionSyncClient,
  SyncAuthError,
  SyncDisabledError,
  pendingRows,
} from "../services/sync/collectionSync.ts";

/**
 * What the Collection screen shows about sync. Deliberately a status, never a
 * toast: a failed sync is not an error the user must act on — the local write
 * already succeeded and the next attempt recovers. Only `bad-token` and
 * `disabled` need attention, because those stay broken until someone acts.
 */
export type SyncState = "off" | "idle" | "syncing" | "offline" | "bad-token" | "disabled";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt: number;
}

/** Debounce after an edit: long enough to batch a burst of collect-mode marks. */
const SYNC_DEBOUNCE_MS = 10_000;
/** How soon to try again after a failed sync. */
const SYNC_RETRY_MS = 30_000;
/**
 * A run older than this is treated as dead and a new one may start. Belt and
 * braces alongside the client's own request timeout: without it, one wedged
 * promise disables sync for the lifetime of the app.
 */
const SYNC_STUCK_MS = 60_000;

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
  /** How many of each finish are held overall. */
  finishTotals: Partial<Record<CollectFinish, number>>;
  /** Per set, how many of each finish are held. */
  finishesBySet: Record<string, Partial<Record<CollectFinish, number>>>;
  addRecentSearch: (query: string) => void;
  addRecentlyViewed: (card: PokemonCardSummary) => void;
  clearRecentSearches: () => void;
  syncStatus: SyncStatus;
  syncNow: () => void;
  setSyncToken: (token: string) => void;
  disconnectSync: () => void;
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
      setCollection(setId ? repo.toggleOwned(cardId, finish, setId) : repo.toggleOwned(cardId, finish));
    },
    [repo],
  );

  const { ownedCountsBySet, ownedFinishCountsBySet, totalFinishesOwned, finishTotals, finishesBySet } =
    useMemo(() => {
      const cards: Record<string, number> = {};
      const finishes: Record<string, number> = {};
      const totals: Partial<Record<CollectFinish, number>> = {};
      const bySet: Record<string, Partial<Record<CollectFinish, number>>> = {};
      let total = 0;
      for (const card of collection) {
        cards[card.setId] = (cards[card.setId] ?? 0) + 1;
        finishes[card.setId] = (finishes[card.setId] ?? 0) + card.finishes.length;
        total += card.finishes.length;
        const set = (bySet[card.setId] ??= {});
        for (const finish of card.finishes) {
          totals[finish] = (totals[finish] ?? 0) + 1;
          set[finish] = (set[finish] ?? 0) + 1;
        }
      }
      return {
        ownedCountsBySet: cards,
        ownedFinishCountsBySet: finishes,
        totalFinishesOwned: total,
        finishTotals: totals,
        finishesBySet: bySet,
      };
    }, [collection]);

  // --- Sync ------------------------------------------------------------------
  const [sync, setSync] = useState<SyncSettings>(() => repo.getSyncSettings());
  const [syncState, setSyncState] = useState<SyncState>(() =>
    repo.getSyncSettings().token ? "idle" : "off",
  );
  // Guards against overlapping runs: the mount effect, the online listener and
  // the debounce can all fire within the same second. Holds the start time
  // rather than a boolean so a wedged run can expire instead of blocking
  // everything forever.
  const syncingSince = useRef(0);
  // Bumped on every failure to re-arm the retry effect, which otherwise never
  // fires again: pending and runSync both stay identical after a failure.
  const [syncAttempt, setSyncAttempt] = useState(0);

  const pending = useMemo(
    () => pendingRows(repo.getPrintings(), sync.lastPushedAt).length,
    // Recomputed whenever the collection changes, which is what `collection` tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repo, sync.lastPushedAt, collection],
  );

  const runSync = useCallback(async () => {
    const settings = repo.getSyncSettings();
    if (!settings.token) return;
    const inFlightFor = syncingSince.current ? Date.now() - syncingSince.current : 0;
    if (syncingSince.current && inFlightFor < SYNC_STUCK_MS) return;

    const client = new CollectionSyncClient(settings.token);
    syncingSince.current = Date.now();
    setSyncState("syncing");
    try {
      // Push before pull so a device that has been offline contributes its work
      // before adopting the server's view — otherwise a slow round trip could
      // make its own edits look like the stale side.
      const local = repo.getPrintings();
      const outgoing = pendingRows(local, settings.lastPushedAt);
      const pushedAt = Date.now();

      const result =
        outgoing.length > 0 ? await client.push(outgoing) : await client.pull(settings.lastPulledAt);

      setCollection(repo.mergeIncoming(result.rows));
      setSync(
        repo.setSyncSettings({
          lastPushedAt: outgoing.length > 0 ? pushedAt : settings.lastPushedAt,
          lastPulledAt: result.at,
          lastSyncAt: Date.now(),
        }),
      );
      setSyncState("idle");
    } catch (err) {
      // A wrong token or a server with sync switched off stays broken until
      // someone acts, so those are surfaced distinctly from being offline.
      if (err instanceof SyncAuthError) setSyncState("bad-token");
      else if (err instanceof SyncDisabledError) setSyncState("disabled");
      else setSyncState("offline");
      // Surfaced for diagnosis: the status line deliberately says little, which
      // previously made a failing sync impossible to investigate.
      console.warn("[cardlens] sync failed:", err);
      setSyncAttempt((n) => n + 1);
    } finally {
      syncingSince.current = 0;
    }
  }, [repo]);

  const syncNow = useCallback(() => void runSync(), [runSync]);

  const setSyncToken = useCallback(
    (token: string) => {
      const trimmed = token.trim();
      setSync(repo.setSyncSettings({ token: trimmed }));
      setSyncState(trimmed ? "idle" : "off");
      if (trimmed) void runSync();
    },
    [repo, runSync],
  );

  const disconnectSync = useCallback(() => {
    setSync(repo.clearSync());
    setSyncState("off");
  }, [repo]);

  // Sync on start and whenever the device comes back online.
  useEffect(() => {
    void runSync();
    const onOnline = () => void runSync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [runSync]);

  // Debounced after edits, and re-armed after a failure. syncAttempt is in the
  // deps precisely so a failed run schedules the next one — without it, pending
  // and runSync are unchanged after a failure and the timer never fires again.
  useEffect(() => {
    if (pending === 0) return;
    const delay = syncState === "offline" ? SYNC_RETRY_MS : SYNC_DEBOUNCE_MS;
    const t = setTimeout(() => void runSync(), delay);
    return () => clearTimeout(t);
  }, [pending, runSync, syncAttempt, syncState]);

  const syncStatus = useMemo<SyncStatus>(
    () => ({ state: syncState, pending, lastSyncAt: sync.lastSyncAt }),
    [syncState, pending, sync.lastSyncAt],
  );

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
      finishTotals,
      finishesBySet,
      addRecentSearch,
      addRecentlyViewed,
      clearRecentSearches,
      syncStatus,
      syncNow,
      setSyncToken,
      disconnectSync,
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
      finishTotals,
      finishesBySet,
      addRecentSearch,
      addRecentlyViewed,
      clearRecentSearches,
      syncStatus,
      syncNow,
      setSyncToken,
      disconnectSync,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}
