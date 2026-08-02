import type { CollectFinish, PokemonCardSummary } from "../models/cards.ts";
import type { TradingCardGame } from "../models/games.ts";
import { canonicalFinish } from "../models/finishes.ts";
import { setIdFromCardId } from "../utils/cardId.ts";
import { livePrintings, mergePrintings, pruneTombstones, type OwnedPrinting } from "./printings.ts";
import { evictCaches, VersionedStore } from "./versioned.ts";

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
 * A card grouped with the finishes held — the shape the UI reads.
 *
 * This is a VIEW over the stored (card, finish) rows, not the storage format.
 * Storage is per-printing with tombstones so that offline devices can merge
 * (see printings.ts); grouping happens on read because screens think in cards.
 */
export interface OwnedCard {
  id: string;
  setId: string;
  finishes: CollectFinish[];
  at: number;
}

/**
 * Per-device sync configuration.
 *
 * The token lives here, in localStorage, and NOT in a VITE_ build variable:
 * this app ships as a static bundle on GitHub Pages, so anything baked in at
 * build time is readable by anyone who views source. It is entered once per
 * device instead (companion phone, or the on-glasses picker).
 *
 * Watermarks are split because they measure different clocks. `lastPushedAt`
 * is local time — it selects local rows to send. `lastPulledAt` is the
 * server's own timestamp, echoed back, so device clock skew cannot cause a
 * device to skip rows it has never seen.
 */
export interface SyncSettings {
  token: string;
  lastPushedAt: number;
  lastPulledAt: number;
  lastSyncAt: number;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  token: "",
  lastPushedAt: 0,
  lastPulledAt: 0,
  lastSyncAt: 0,
};

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
 * Read one stored entry as printing rows, accepting both the current
 * per-printing shape and the earlier per-card `{ id, setId, finishes[] }` one.
 *
 * Migration happens on read rather than as a one-shot upgrade step: it is
 * total, idempotent, and cannot half-apply if the app is closed mid-write.
 * Anything unrecognisable yields no rows, so corrupt data degrades to "not
 * owned" instead of throwing.
 */
function toPrintings(value: unknown): OwnedPrinting[] {
  if (typeof value !== "object" || value === null) return [];
  const v = value as Record<string, unknown>;

  // Current shape: one row per (card, finish).
  if (typeof v.cardId === "string" && typeof v.finish === "string") {
    const row: OwnedPrinting = {
      cardId: v.cardId,
      setId: typeof v.setId === "string" ? v.setId : setIdFromCardId(v.cardId),
      // Legacy values (holofoil, pokeBall, ...) migrate to type:foil keys here,
      // so no stored row ever has to be rewritten.
      finish: canonicalFinish(v.finish),
      at: typeof v.at === "number" ? v.at : 0,
      ...(typeof v.deletedAt === "number" ? { deletedAt: v.deletedAt } : {}),
    };
    return [row];
  }

  // Legacy shape: one entry per card, finishes as an array. Pre-finish entries
  // carried no `finishes` at all and mean a single normal printing.
  if (typeof v.id === "string") {
    const setId = typeof v.setId === "string" ? v.setId : setIdFromCardId(v.id);
    const at = typeof v.at === "number" ? v.at : 0;
    const finishes = isArray(v.finishes) && v.finishes.length > 0 ? v.finishes : ["normal"];
    return finishes
      .filter((f): f is string => typeof f === "string")
      .map((finish) => ({ cardId: v.id as string, setId, finish: canonicalFinish(finish), at }));
  }

  return [];
}

/**
 * Repositories over a single VersionedStore. Each is a thin, well-typed CRUD list
 * with dedup + cap + most-recent-first ordering. All reads are corruption-safe.
 */
export class Repositories {
  /**
   * Rows held only in memory, because the last write to disk failed.
   *
   * Without this, a failed write is invisible: `addOwned` re-reads storage to
   * build its return value, gets the rows from before the mark, and hands React
   * a state identical to the one it already had. The tap does nothing, says
   * nothing, and looks like the app ignoring you. Holding the rows here keeps
   * the session honest and — more importantly — keeps them syncable, so the
   * marks still reach the server even on a device that cannot save them.
   */
  private memoryRows: OwnedPrinting[] | null = null;

  /** True once a collection write has failed and stayed failed. */
  storageDegraded = false;

  constructor(
    private readonly store: VersionedStore = new VersionedStore(),
    /** Injectable so a test can prove the retry buys space before giving up. */
    private readonly evict: () => number = evictCaches,
  ) {}

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
  /**
   * Raw rows including tombstones. This is what syncs; screens want
   * getCollection() instead.
   */
  getPrintings(): OwnedPrinting[] {
    if (this.memoryRows) return this.memoryRows;
    const rows = this.store.read<unknown[]>("collection", isArray, []);
    return rows.flatMap(toPrintings);
  }

  private writePrintings(rows: OwnedPrinting[]): OwnedPrinting[] {
    const pruned = pruneTombstones(rows).slice(-MAX_COLLECTION);
    if (this.store.write("collection", pruned)) {
      this.memoryRows = null;
      this.storageDegraded = false;
      return pruned;
    }
    // Out of space. The caches cost one request each to rebuild; the collection
    // cannot be rebuilt at all, so it wins the argument.
    this.evict();
    if (this.store.write("collection", pruned)) {
      this.memoryRows = null;
      this.storageDegraded = false;
      return pruned;
    }
    this.memoryRows = pruned;
    this.storageDegraded = true;
    return pruned;
  }

  /** Cards owned, each with its held finishes — most recently started last. */
  getCollection(): OwnedCard[] {
    const byCard = new Map<string, OwnedCard>();
    for (const row of livePrintings(this.getPrintings())) {
      const existing = byCard.get(row.cardId);
      if (existing) {
        if (!existing.finishes.includes(row.finish)) existing.finishes.push(row.finish);
        existing.at = Math.min(existing.at, row.at);
      } else {
        byCard.set(row.cardId, {
          id: row.cardId,
          setId: row.setId,
          finishes: [row.finish],
          at: row.at,
        });
      }
    }
    return [...byCard.values()];
  }

  isOwned(id: string): boolean {
    return livePrintings(this.getPrintings()).some((r) => r.cardId === id);
  }

  ownedFinishes(id: string): CollectFinish[] {
    return livePrintings(this.getPrintings())
      .filter((r) => r.cardId === id)
      .map((r) => r.finish);
  }

  isOwnedFinish(id: string, finish: CollectFinish): boolean {
    return this.ownedFinishes(id).includes(canonicalFinish(finish));
  }

  addOwned(
    cardId: string,
    rawFinish: CollectFinish = "normal",
    setId = setIdFromCardId(cardId),
    now = Date.now(),
  ): OwnedCard[] {
    // Canonicalise on WRITE as well as read. Reads migrate legacy values, so a
    // raw write would put "holofoil" and "holo" in the store as two rows for
    // one printing — they are different OR-Set keys and both survive the merge.
    const finish = canonicalFinish(rawFinish);
    // Re-marking clears any tombstone by writing a newer `at`, which is exactly
    // how the merge rule expects a resurrection to be expressed.
    this.writePrintings(mergePrintings(this.getPrintings(), [{ cardId, setId, finish, at: now }]));
    return this.getCollection();
  }

  /** Removes one finish, or every finish of the card when `finish` is omitted. */
  removeOwned(cardId: string, rawFinish?: CollectFinish, now = Date.now()): OwnedCard[] {
    const finish = rawFinish === undefined ? undefined : canonicalFinish(rawFinish);
    const targets = livePrintings(this.getPrintings()).filter(
      (r) => r.cardId === cardId && (finish === undefined || r.finish === finish),
    );
    const tombstones = targets.map((r) => ({ ...r, deletedAt: now }));
    this.writePrintings(mergePrintings(this.getPrintings(), tombstones));
    return this.getCollection();
  }

  toggleOwned(
    cardId: string,
    rawFinish: CollectFinish = "normal",
    setId = setIdFromCardId(cardId),
  ): OwnedCard[] {
    const finish = canonicalFinish(rawFinish);
    return this.isOwnedFinish(cardId, finish)
      ? this.removeOwned(cardId, finish)
      : this.addOwned(cardId, finish, setId);
  }

  /** Merge rows from elsewhere (a sync peer) into local state. */
  mergeIncoming(rows: OwnedPrinting[]): OwnedCard[] {
    this.writePrintings(mergePrintings(this.getPrintings(), rows));
    return this.getCollection();
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

  // --- Sync settings --------------------------------------------------------
  getSyncSettings(): SyncSettings {
    const stored = this.store.read<Partial<SyncSettings>>(
      "sync-settings",
      (v): v is Partial<SyncSettings> => typeof v === "object" && v !== null,
      {},
    );
    return { ...DEFAULT_SYNC_SETTINGS, ...stored };
  }

  setSyncSettings(patch: Partial<SyncSettings>): SyncSettings {
    const next = { ...this.getSyncSettings(), ...patch };
    this.store.write("sync-settings", next);
    return next;
  }

  /** Forget the token and every watermark — the "disconnect this device" path. */
  clearSync(): SyncSettings {
    this.store.write("sync-settings", DEFAULT_SYNC_SETTINGS);
    return DEFAULT_SYNC_SETTINGS;
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
