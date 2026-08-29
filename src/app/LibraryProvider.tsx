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
import { BinderSyncClient } from "../services/sync/binderSync.ts";
import { SyncNotFoundError } from "../services/sync/http.ts";
import { pendingBinders } from "../storage/binders.ts";
import type { Binder } from "../models/binderLayout.ts";

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
  /**
   * @param number The card's printed collector number, when the caller holds
   * the catalog card. Recorded on the row so the base/master split is
   * answerable away from the set screen — see `ownedNumbersBySet`.
   */
  toggleOwned: (cardId: string, finish?: CollectFinish, setId?: string, number?: string) => void;
  /** Printings this card has that are deliberately not part of the master set. */
  excludedFinishes: (id: string) => CollectFinish[];
  /** When each owned printing was marked — the growth chart's only input. */
  ownedStamps: number[];
  /** Take a printing out of the master-set target, or put it back. */
  toggleExcluded: (cardId: string, finish: CollectFinish, setId?: string) => void;
  /**
   * Mark owned, idempotently.
   *
   * NOT toggleOwned. A scanner works through a pile that already overlaps the
   * collection, and toggling would un-mark every card already held — silently,
   * and worst on the most complete sets. Two copies of the same card in one
   * batch would cancel out entirely.
   */
  addOwned: (cardId: string, finish?: CollectFinish, setId?: string, number?: string) => void;
  /** Mark a whole batch in one write — see Repositories.addManyOwned. */
  addManyOwned: (
    entries: { cardId: string; finish?: CollectFinish; setId?: string; number?: string }[],
  ) => void;
  /**
   * Set a batch of printings owned or not owned in one write.
   *
   * The bulk mark needs both directions, so addManyOwned cannot serve it — see
   * Repositories.setOwnedMany for why the loop it replaces mattered.
   */
  setOwnedMany: (
    entries: { cardId: string; finish: CollectFinish; setId?: string; number?: string; owned: boolean }[],
  ) => void;
  /**
   * Fill in collector numbers on rows that predate the field, from a set's card
   * list. Cheap and idempotent — see Repositories.backfillNumbers.
   */
  backfillNumbers: (cards: { id: string; collectorNumber: string }[]) => void;
  /** Distinct cards per set. */
  ownedCountsBySet: Record<string, number>;
  /** Printings per set — the master-set numerator. */
  ownedFinishCountsBySet: Record<string, number>;
  /**
   * The collector number of each owned CARD, by set id — the input `setTiers`
   * needs to split a set into its base and master tiers.
   *
   * One entry per card, not per printing, and duplicates are kept: numbers are
   * not unique inside a set (`cel25c` has four cards numbered 15), so deduping
   * would under-count. An absent set id means nothing is owned there.
   *
   * **A card whose number is unknown is omitted, never guessed.** Card ids are
   * not a substitute — `zsv10pt5-80` carries number "60" and collides with that
   * set's real card 60. A short list makes `setTiers` decline the base tier,
   * which is the behaviour to preserve; a guessed one would make it lie.
   */
  ownedNumbersBySet: Record<string, string[]>;
  /** Total printings held across every set. */
  totalFinishesOwned: number;
  /** How many of each finish are held overall. */
  finishTotals: Partial<Record<CollectFinish, number>>;
  /** Per set, how many of each finish are held. */
  finishesBySet: Record<string, Partial<Record<CollectFinish, number>>>;
  /**
   * The device could not save the collection — it is held in memory only.
   *
   * Worth showing, because the alternative is what this replaced: the mark is
   * kept in memory and syncs, but a reload loses anything the server has not
   * taken yet, and nothing on screen would say so.
   */
  storageDegraded: boolean;
  /**
   * Binders that still exist, newest edit first.
   *
   * Held here rather than in each screen's own useState, which is what they did
   * while binders were local-only: a sync that pulled a binder edited on
   * another device had nowhere to deliver it, so the open screen would keep
   * rendering the arrangement it read at mount.
   */
  binders: Binder[];
  saveBinder: (binder: Binder) => void;
  deleteBinder: (id: string) => void;
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
  const [storageDegraded, setStorageDegraded] = useState(false);
  const [binders, setBinders] = useState<Binder[]>(() => repo.getBinders());

  const saveBinder = useCallback((binder: Binder) => setBinders(repo.saveBinder(binder)), [repo]);
  const deleteBinder = useCallback((id: string) => setBinders(repo.deleteBinder(id)), [repo]);

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

  /**
   * Read straight from the repository rather than from the grouped collection
   * state: an excluded printing is deliberately NOT in `collection`, which is
   * the view of what is owned.
   */
  const ownedStamps = useMemo(() => {
    // Read through `collection` so the dependency is real rather than
    // suppressed: this reads STORED rows, which every mark rewrites. Without
    // it the chart keeps rendering the collection as it was at mount.
    void collection;
    return repo.ownedStamps();
  }, [repo, collection]);

  const excludedFinishes = useCallback(
    (id: string) => {
      // Read through `collection` so the dependency is real rather than
      // suppressed: this reads STORED rows, which every collection write
      // rewrites. Without it the callback identity is stable, and the set
      // grid's memo never recomputes after a printing is excluded.
      void collection;
      return repo.excludedFinishes(id);
    },
    [repo, collection],
  );

  const toggleExcluded = useCallback(
    (cardId: string, finish: CollectFinish, setId?: string) => {
      setCollection(setId ? repo.toggleExcluded(cardId, finish, setId) : repo.toggleExcluded(cardId, finish));
    },
    [repo],
  );

  const toggleOwned = useCallback(
    (cardId: string, finish: CollectFinish = "normal", setId?: string, number?: string) => {
      // `undefined` reaches the repository's own defaults, so the two arms this
      // used to have — one with a setId and one without — are the same call.
      setCollection(repo.toggleOwned(cardId, finish, setId ?? undefined, number));
      // Read after the write: the repo only knows whether the device had room
      // once it has tried to use it.
      setStorageDegraded(repo.storageDegraded);
    },
    [repo],
  );

  const addOwned = useCallback(
    (cardId: string, finish: CollectFinish = "normal", setId?: string, number?: string) => {
      setCollection(repo.addOwned(cardId, finish, setId ?? undefined, undefined, number));
      setStorageDegraded(repo.storageDegraded);
    },
    [repo],
  );

  const addManyOwned = useCallback(
    (entries: { cardId: string; finish?: CollectFinish; setId?: string; number?: string }[]) => {
      setCollection(repo.addManyOwned(entries));
      setStorageDegraded(repo.storageDegraded);
    },
    [repo],
  );

  const setOwnedMany = useCallback(
    (
      entries: {
        cardId: string;
        finish: CollectFinish;
        setId?: string;
        number?: string;
        owned: boolean;
      }[],
    ) => {
      setCollection(repo.setOwnedMany(entries));
      setStorageDegraded(repo.storageDegraded);
    },
    [repo],
  );

  /**
   * Teach stored rows their collector numbers as a set's card list arrives.
   *
   * Only sets state when something was actually filled — the repository returns
   * null otherwise. Without that, a screen calling this on every load of an
   * already-migrated set would hand React a fresh collection array each time and
   * re-render everything downstream forever.
   */
  const backfillNumbers = useCallback(
    (cards: { id: string; collectorNumber: string }[]) => {
      const next = repo.backfillNumbers(cards);
      if (next) setCollection(next);
    },
    [repo],
  );

  const {
    ownedCountsBySet,
    ownedFinishCountsBySet,
    ownedNumbersBySet,
    totalFinishesOwned,
    finishTotals,
    finishesBySet,
  } = useMemo(() => {
    const cards: Record<string, number> = {};
    const finishes: Record<string, number> = {};
    const numbers: Record<string, string[]> = {};
    const totals: Partial<Record<CollectFinish, number>> = {};
    const bySet: Record<string, Partial<Record<CollectFinish, number>>> = {};
    let total = 0;
    for (const card of collection) {
      cards[card.setId] = (cards[card.setId] ?? 0) + 1;
      finishes[card.setId] = (finishes[card.setId] ?? 0) + card.finishes.length;
      // One entry per CARD, and only when the number is known. A card that
      // cannot be classified is left out so setTiers declines the base tier
      // rather than reporting one built from a guess.
      if (card.number !== undefined) (numbers[card.setId] ??= []).push(card.number);
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
      ownedNumbersBySet: numbers,
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

  /**
   * Counted separately from card rows, and NOT added to the status line's
   * figure: "3 pending" next to a collection means three cards, and quietly
   * folding a binder into that number would make it lie.
   */
  const pendingBinderCount = useMemo(
    () => pendingBinders(repo.getBinderRecords(), sync.bindersPushedAt).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repo, sync.bindersPushedAt, binders],
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
      // Committed BEFORE the binders are attempted. If the binder half then
      // fails, the collection's work is still banked — otherwise a persistently
      // failing binder sync would make every run re-push the whole collection,
      // which is harmless but slow and hides what is actually broken.
      setSync(
        repo.setSyncSettings({
          lastPushedAt: outgoing.length > 0 ? pushedAt : settings.lastPushedAt,
          lastPulledAt: result.at,
          lastSyncAt: Date.now(),
        }),
      );

      // Binders ride the same run and the same token, against their own
      // endpoint and their own watermarks. Sequenced after the collection
      // rather than in parallel because they share one home server on a
      // residential connection, and because a binder is a view of a collection
      // that should already have landed.
      try {
        const binderClient = new BinderSyncClient(settings.token);
        const outgoingBinders = pendingBinders(repo.getBinderRecords(), settings.bindersPushedAt);
        const bindersPushedAt = Date.now();
        const binderResult =
          outgoingBinders.length > 0
            ? await binderClient.push(outgoingBinders)
            : await binderClient.pull(settings.bindersPulledAt);
        setBinders(repo.mergeIncomingBinders(binderResult.binders));
        setSync(
          repo.setSyncSettings({
            bindersPushedAt: outgoingBinders.length > 0 ? bindersPushedAt : settings.bindersPushedAt,
            bindersPulledAt: binderResult.at,
            lastSyncAt: Date.now(),
          }),
        );
      } catch (err) {
        // Pages and the home server deploy separately, so new code against an
        // older server is a normal transient state. Without this, that state
        // would show as a permanently offline sync, retrying every thirty
        // seconds — and it would say the COLLECTION was not syncing when the
        // collection had just synced fine.
        if (!(err instanceof SyncNotFoundError)) throw err;
        console.info("[cardlens] this server has no binder sync yet — skipping it");
      }
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
    // Binders count here even though they are kept out of the status figure: a
    // rearranged binder with no card marks alongside it must still schedule a
    // run, or it sits on the device until something else happens to sync.
    if (pending === 0 && pendingBinderCount === 0) return;
    const delay = syncState === "offline" ? SYNC_RETRY_MS : SYNC_DEBOUNCE_MS;
    const t = setTimeout(() => void runSync(), delay);
    return () => clearTimeout(t);
  }, [pending, pendingBinderCount, runSync, syncAttempt, syncState]);

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
      excludedFinishes,
      ownedStamps,
      toggleExcluded,
      addOwned,
      addManyOwned,
      setOwnedMany,
      backfillNumbers,
      ownedCountsBySet,
      ownedFinishCountsBySet,
      ownedNumbersBySet,
      totalFinishesOwned,
      finishTotals,
      finishesBySet,
      storageDegraded,
      binders,
      saveBinder,
      deleteBinder,
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
      excludedFinishes,
      ownedStamps,
      toggleExcluded,
      addOwned,
      addManyOwned,
      setOwnedMany,
      backfillNumbers,
      ownedCountsBySet,
      ownedFinishCountsBySet,
      ownedNumbersBySet,
      totalFinishesOwned,
      finishTotals,
      finishesBySet,
      storageDegraded,
      binders,
      saveBinder,
      deleteBinder,
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
