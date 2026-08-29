import type { CollectFinish, PokemonCardSummary } from "../models/cards.ts";
import { DEFAULT_GAME, type TradingCardGame } from "../models/games.ts";
import { canonicalFinish } from "../models/finishes.ts";
import { setIdFromCardId } from "../utils/cardId.ts";
import {
  excludedPrintings,
  gamePrintings,
  livePrintings,
  mergePrintings,
  optionalRowFields,
  parseCollectorNumber,
  pruneTombstones,
  type OwnedPrinting,
} from "./printings.ts";
import { evictCaches, VersionedStore } from "./versioned.ts";
import { isBinderFormat, type Binder } from "../models/binderLayout.ts";
import { binderTombstone, liveBinders, mergeBinders, pruneBinderTombstones } from "./binders.ts";

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
  /**
   * The card's printed collector number, when the row knows it.
   *
   * Absent on every row written before the field existed, and never guessed
   * from the id — see `OwnedPrinting.number`. A consumer that cannot classify a
   * card must decline the answer, not approximate it.
   */
  number?: string;
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
  /**
   * Binder watermarks, separate from the collection's.
   *
   * They measure a different stream of writes against a different endpoint. One
   * shared pair would make a collection push move the binder watermark past
   * binder edits that were never sent — they would then never be sent, and the
   * loss would be invisible on the device that made them.
   */
  bindersPushedAt: number;
  bindersPulledAt: number;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  token: "",
  lastPushedAt: 0,
  lastPulledAt: 0,
  lastSyncAt: 0,
  bindersPushedAt: 0,
  bindersPulledAt: 0,
};

/**
 * Token for the Target restock bot — deliberately NOT the collection token.
 *
 * The two guard different blast radii. The collection token is entered on every
 * device that syncs cards and only ever reads or writes card rows. This one
 * drives a real browser on the home server that can put items in a Target cart,
 * so it lives on the one device that manages the watchlist, and losing it does
 * not mean losing the other.
 *
 * Same rule as the sync token: localStorage, never a `VITE_` variable, because
 * this ships as a static bundle and anything baked in at build time is public.
 */
export interface TargetSettings {
  token: string;
}

export const DEFAULT_TARGET_SETTINGS: TargetSettings = { token: "" };

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

function isBinder(value: unknown): value is Binder {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    // The shared guard, NOT a format list written out again. This spelled the
    // formats out for itself and so silently dropped every 4-pocket binder on
    // the read after it was saved — created, gone, with nothing said. It is the
    // third place formats are gated (here, models/binderParse.ts on ingest, and
    // the pickers); only this one could make a binder vanish.
    isBinderFormat(v.format) &&
    Array.isArray(v.pages) && // Both timestamps are required, not cosmetic: they ARE the last-write-wins
    // key. A record missing one would make every merge involving it NaN, which
    // loses whichever side it is compared against.
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number"
  );
}

/**
 * `{ number }` when there is one to write, and `{}` otherwise.
 *
 * Written only when known, exactly like `game` and `excluded`. Storing an empty
 * string for "unknown" would give the field two spellings for one meaning, which
 * is how a convergent store starts ping-ponging between devices that agree.
 */
function numberField(number: string | undefined): { number?: string } {
  const parsed = parseCollectorNumber(number);
  return parsed === undefined ? {} : { number: parsed };
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
      // A whitelist parser drops what it does not name, and this device is only
      // one of the two ends that has to name a field — the server's parseRow is
      // the other. Both spread the SAME list (game, number, excluded) so a new
      // field cannot reach one end and not the other, which is the failure that
      // has cost this repo two bugs. Absent stays absent: a row that never
      // learned its collector number must not acquire a guessed one on read.
      ...optionalRowFields(v),
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
    /**
     * The game every collection read and write is about.
     *
     * One at a time is what the UI actually does — a set screen, a progress
     * bar and a total are all questions about one game — so it belongs here
     * rather than in six call sites that would each have to remember it.
     */
    private readonly game: TradingCardGame = DEFAULT_GAME,
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

  /**
   * Rows for the active game — what every count and list on screen is about.
   *
   * Deliberately NOT what getPrintings returns: sync pushes every row this
   * device holds regardless of game, because a device that quietly withheld
   * another game's rows would look to the server exactly like a device that
   * had deleted them.
   */
  private ownRows(): OwnedPrinting[] {
    return gamePrintings(this.getPrintings(), this.game);
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
    for (const row of livePrintings(this.ownRows())) {
      const existing = byCard.get(row.cardId);
      if (existing) {
        if (!existing.finishes.includes(row.finish)) existing.finishes.push(row.finish);
        existing.at = Math.min(existing.at, row.at);
        // One card's printings all carry the same number, but they were not all
        // written at the same time — a normal marked last year has no number and
        // the reverse marked today does. Any row that knows it answers for the card.
        if (existing.number === undefined && row.number !== undefined) existing.number = row.number;
      } else {
        byCard.set(row.cardId, {
          id: row.cardId,
          setId: row.setId,
          finishes: [row.finish],
          at: row.at,
          ...(row.number === undefined ? {} : { number: row.number }),
        });
      }
    }
    return [...byCard.values()];
  }

  isOwned(id: string): boolean {
    return livePrintings(this.ownRows()).some((r) => r.cardId === id);
  }

  ownedFinishes(id: string): CollectFinish[] {
    return livePrintings(this.ownRows())
      .filter((r) => r.cardId === id)
      .map((r) => r.finish);
  }

  isOwnedFinish(id: string, finish: CollectFinish): boolean {
    return this.ownedFinishes(id).includes(canonicalFinish(finish));
  }

  /**
   * @param number The card's printed collector number, when the caller has the
   * catalog card in hand. Optional and never derived from the id — a mark made
   * without it stores no number and the base tier declines until the set's card
   * list backfills one.
   */
  addOwned(
    cardId: string,
    rawFinish: CollectFinish = "normal",
    setId = setIdFromCardId(cardId),
    now = Date.now(),
    number?: string,
  ): OwnedCard[] {
    // Canonicalise on WRITE as well as read. Reads migrate legacy values, so a
    // raw write would put "holofoil" and "holo" in the store as two rows for
    // one printing — they are different OR-Set keys and both survive the merge.
    const finish = canonicalFinish(rawFinish);
    // Re-marking clears any tombstone by writing a newer `at`, which is exactly
    // how the merge rule expects a resurrection to be expressed.
    this.writePrintings(
      mergePrintings(this.getPrintings(), [
        {
          cardId,
          setId,
          finish,
          at: now,
          ...numberField(number),
          ...(this.game === DEFAULT_GAME ? {} : { game: this.game }),
        },
      ]),
    );
    return this.getCollection();
  }

  /**
   * Mark many printings owned in ONE merge and ONE write.
   *
   * addOwned in a loop is quadratic over a batch: each call re-reads every row,
   * merges, prunes and re-serialises the lot. At a thousand rows that is
   * invisible; a scanner committing two hundred cards against a twenty-thousand
   * row collection would do two hundred full passes and hang the phone.
   *
   * Same canonicalisation and the same merge rule — only the number of times
   * the collection is rewritten changes.
   */
  addManyOwned(
    entries: { cardId: string; finish?: CollectFinish; setId?: string; number?: string }[],
    now = Date.now(),
  ): OwnedCard[] {
    if (entries.length === 0) return this.getCollection();
    const rows: OwnedPrinting[] = entries.map((e) => ({
      cardId: e.cardId,
      setId: e.setId ?? setIdFromCardId(e.cardId),
      finish: canonicalFinish(e.finish ?? "normal"),
      at: now,
      ...numberField(e.number),
      ...(this.game === DEFAULT_GAME ? {} : { game: this.game }),
    }));
    this.writePrintings(mergePrintings(this.getPrintings(), rows));
    return this.getCollection();
  }

  /**
   * Set many printings owned or not owned in ONE merge and ONE write.
   *
   * The symmetric partner to addManyOwned, which can only add. The triple-pinch
   * bulk mark needs both directions — it fills a card, or clears it when it was
   * already complete — and was calling toggleOwned once per printing, so a
   * four-printing card did four full read-merge-prune-serialise-write passes
   * over the entire collection.
   *
   * Measured in the browser on the real collection: one pass is 0.48ms at 973
   * rows, so today this is invisible. At the 20,000-row cap the storage layer
   * allows it is 13ms a pass, and a four-printing burst is **52ms** — on a
   * laptop, for the one gesture that exists to make bulk marking fast, on a
   * device far slower than this one. That is the trade this fixes; it is not
   * worth reaching for at a thousand rows.
   *
   * Semantics are unchanged, deliberately. Same canonicalisation on write, same
   * OR-Set merge, and a removal is still a tombstone built from the row that
   * exists rather than a fresh one — a synthesised tombstone would lose the
   * original `at`, `setId` and `game` that the merge rule resolves against.
   * Only the number of times the collection is rewritten changes.
   */
  setOwnedMany(
    entries: { cardId: string; finish: CollectFinish; setId?: string; number?: string; owned: boolean }[],
    now = Date.now(),
  ): OwnedCard[] {
    if (entries.length === 0) return this.getCollection();
    const game = this.game;
    // Read the live rows ONCE. removeOwned re-derives this per call, which is
    // most of what made the loop quadratic.
    const liveByKey = new Map(
      livePrintings(this.ownRows()).map((r) => [`${r.cardId}|${r.finish}`, r] as const),
    );

    const rows: OwnedPrinting[] = [];
    for (const entry of entries) {
      const finish = canonicalFinish(entry.finish);
      if (entry.owned) {
        rows.push({
          cardId: entry.cardId,
          setId: entry.setId ?? setIdFromCardId(entry.cardId),
          finish,
          // Re-marking clears any tombstone by writing a newer `at`, which is
          // how the merge rule expects a resurrection to be expressed.
          at: now,
          ...numberField(entry.number),
          ...(game === DEFAULT_GAME ? {} : { game }),
        });
        continue;
      }
      // Nothing live to tombstone means it is not owned, which is the state
      // being asked for — writing a tombstone anyway would resurrect-then-kill
      // a row that never existed.
      const existing = liveByKey.get(`${entry.cardId}|${finish}`);
      if (existing) rows.push({ ...existing, deletedAt: now });
    }

    if (rows.length === 0) return this.getCollection();
    this.writePrintings(mergePrintings(this.getPrintings(), rows));
    return this.getCollection();
  }

  /** Removes one finish, or every finish of the card when `finish` is omitted. */
  removeOwned(cardId: string, rawFinish?: CollectFinish, now = Date.now()): OwnedCard[] {
    const finish = rawFinish === undefined ? undefined : canonicalFinish(rawFinish);
    const targets = livePrintings(this.ownRows()).filter(
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
    number?: string,
  ): OwnedCard[] {
    const finish = canonicalFinish(rawFinish);
    return this.isOwnedFinish(cardId, finish)
      ? this.removeOwned(cardId, finish)
      : this.addOwned(cardId, finish, setId, Date.now(), number);
  }

  /** Printings this card has that are deliberately not part of the master set. */
  excludedFinishes(cardId: string): CollectFinish[] {
    return excludedPrintings(this.ownRows())
      .filter((r) => r.cardId === cardId)
      .map((r) => r.finish);
  }

  /**
   * Take a printing out of the master set, or put it back.
   *
   * Excluding also drops ownership: a promo you have decided is not part of
   * this set should stop counting toward it either way, and leaving a row that
   * is both owned and excluded would make "held" and "target" disagree.
   */
  toggleExcluded(
    cardId: string,
    rawFinish: CollectFinish,
    setId = setIdFromCardId(cardId),
    now = Date.now(),
  ): OwnedCard[] {
    const finish = canonicalFinish(rawFinish);
    const already = this.excludedFinishes(cardId).includes(finish);
    const game = this.game;

    const row: OwnedPrinting = already
      ? { cardId, setId, finish, at: now, deletedAt: now, ...(game === DEFAULT_GAME ? {} : { game }) }
      : { cardId, setId, finish, at: now, excluded: true, ...(game === DEFAULT_GAME ? {} : { game }) };

    this.writePrintings(mergePrintings(this.getPrintings(), [row]));
    return this.getCollection();
  }

  /**
   * When each owned printing was marked, one entry per printing.
   *
   * Just the timestamps: the growth chart needs no card identity, and handing
   * the UI whole rows would leak the storage shape into a component.
   */
  ownedStamps(): number[] {
    return livePrintings(this.ownRows()).map((r) => r.at);
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

  /**
   * The collector number of each owned CARD, grouped by set id.
   *
   * One entry per card, not per printing — the base/master split is a question
   * about cards. Duplicates are kept: numbers are NOT unique inside a set
   * (`cel25c` has four cards numbered 15), so deduping would under-count a real
   * collection.
   *
   * A card whose number is unknown is OMITTED rather than guessed. The consumer
   * (`setTiers`) declines a base tier rather than reporting a wrong one, and a
   * short list is the input that makes it decline; an invented one is the input
   * that makes it lie.
   */
  getOwnedNumbersBySet(): Record<string, string[]> {
    const numbers: Record<string, string[]> = {};
    for (const card of this.getCollection()) {
      if (card.number === undefined) continue;
      (numbers[card.setId] ??= []).push(card.number);
    }
    return numbers;
  }

  /**
   * Fill in collector numbers on rows that never had one, from a set's card list.
   *
   * The migration for the rows that predate the field. Lazy rather than a
   * one-shot upgrade because the numbers are not on the device to begin with —
   * they arrive with a set's card list, one set at a time, and the alternatives
   * are both worse: guessing from the card id is wrong (`zsv10pt5-80` is number
   * 60), and downloading the whole 20,205-card index to Home to fix 973 rows
   * costs 2.3MB for a progress bar.
   *
   * Two rules make this safe to call on every load:
   *
   * - **Stamps are never touched.** `at` is when the card was collected — the
   *   growth chart's only input — and bumping it would both falsify that and
   *   push the entire collection through sync to report nothing new.
   * - **Only absent numbers are filled.** A row that already has one is left
   *   exactly as it was, so this cannot overwrite what a mark recorded, and it
   *   is idempotent: the second call writes nothing at all.
   *
   * Returns `null` when there was nothing to fill, so a caller can skip a React
   * state update rather than re-render on every set load.
   */
  backfillNumbers(cards: { id: string; collectorNumber: string }[]): OwnedCard[] | null {
    if (cards.length === 0) return null;
    const byId = new Map<string, string>();
    for (const c of cards) {
      const number = parseCollectorNumber(c.collectorNumber);
      if (number !== undefined) byId.set(c.id, number);
    }
    if (byId.size === 0) return null;

    const rows = this.getPrintings();
    let filled = 0;
    const next = rows.map((row) => {
      if (row.number !== undefined) return row;
      const number = byId.get(row.cardId);
      if (number === undefined) return row;
      filled += 1;
      return { ...row, number };
    });
    if (filled === 0) return null;

    // Written straight through rather than merged: these are the same rows with
    // one field added, so there is no second version to converge with.
    this.writePrintings(next);
    return this.getCollection();
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

  // --- Target restock bot ---------------------------------------------------
  getTargetSettings(): TargetSettings {
    const stored = this.store.read<Partial<TargetSettings>>(
      "target-settings",
      (v): v is Partial<TargetSettings> => typeof v === "object" && v !== null,
      {},
    );
    return { ...DEFAULT_TARGET_SETTINGS, ...stored };
  }

  setTargetSettings(patch: Partial<TargetSettings>): TargetSettings {
    const next = { ...this.getTargetSettings(), ...patch };
    this.store.write("target-settings", next);
    return next;
  }

  // --- Custom binders -------------------------------------------------------
  /**
   * Binders the user laid out by hand.
   *
   * These sync, per binder, last write wins — see storage/binders.ts for why
   * that granularity rather than the collection's per-printing OR-Set. The
   * consequence here is that a delete must be a TOMBSTONE, exactly as it is for
   * printings: dropping the row would make a deleted binder indistinguishable
   * from one this device has never seen, and the next sync would bring it back.
   *
   * Image slots carry an `imageId` and the bytes live on the server. A data URI
   * would be re-serialised into localStorage on every pocket move and pushed
   * whole on every sync — this app has already had localStorage run out once.
   */
  private allBinders(): Binder[] {
    const rows = this.store.read<unknown[]>("binders", isArray, []);
    return rows.flatMap((row) => (isBinder(row) ? [row] : []));
  }

  /** Binders that still exist, newest edit first — what the screens show. */
  getBinders(): Binder[] {
    return liveBinders(this.allBinders());
  }

  /** Raw records including tombstones. This is what syncs. */
  getBinderRecords(): Binder[] {
    return this.allBinders();
  }

  private writeBinders(binders: Binder[]): Binder[] {
    this.store.write("binders", pruneBinderTombstones(binders));
    return this.getBinders();
  }

  saveBinder(binder: Binder): Binder[] {
    // Merged rather than replaced, so a save racing an incoming sync cannot
    // clobber a binder this device was not editing.
    return this.writeBinders(mergeBinders(this.allBinders(), [binder]));
  }

  deleteBinder(id: string, now = Date.now()): Binder[] {
    const existing = this.allBinders().find((b) => b.id === id);
    if (!existing) return this.getBinders();
    return this.writeBinders(mergeBinders(this.allBinders(), [binderTombstone(existing, now)]));
  }

  /** Merge binders from a sync peer into local state. */
  mergeIncomingBinders(incoming: Binder[]): Binder[] {
    return this.writeBinders(mergeBinders(this.allBinders(), incoming));
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
