import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeTcgplayerPricing, type RawTcgplayer } from "../src/integrations/pricing/normalize.ts";

/**
 * Server-side cache of pokemontcg.io market prices, one compact index per set.
 *
 * The home dashboard prices the WHOLE collection, so it needs the second
 * pricing oracle for every set held at once — nineteen of them on the author's
 * device. It used to get them by asking `/api/catalog/cards` once per set, and
 * that proxy is a pass-through with a 60-second memory cache: measured on the
 * live site, nineteen concurrent calls, **4.5 to 6.7 seconds each**, several
 * failing outright and retrying at 9s and 18s. Home reported "480 of 973
 * printings priced" because half of them never arrived.
 *
 * Two things were wrong and this fixes both.
 *
 * **The payload.** Home wants `cardId -> market price`. It was being sent full
 * card summaries — name, artist, rarity, images, the whole embedded set object,
 * cardmarket — 250 cards at a time, and throwing all of it away. An index of
 * the prices alone is roughly a fiftieth of the bytes.
 *
 * **The lifetime.** A 60-second TTL means every visit is a fresh upstream run
 * against an API measured at ~25% failure in bursts, on a residential uplink.
 * Market prices move daily at most, so they are cached for twelve hours and
 * written to disk — a restart no longer refetches, and a set stays priced while
 * upstream is down.
 */

/** Market prices move daily at most; a stale-by-hours total is not a wrong one. */
export const CATALOG_PRICE_TTL_MS = 12 * 60 * 60_000;

/**
 * How long an EMPTY answer is remembered, in memory only.
 *
 * Empty is a real answer for several modern sets (pokemontcg.io prices 0/120
 * Pitch Black) and is never persisted, because it cannot be told apart from a
 * response that arrived malformed. Forgetting it entirely, though, sent every
 * Home visit back upstream for that set, and the route awaits every set — one
 * unpriceable set held the whole answer to a fresh run against an API that
 * fails a quarter of the time. An hour bounds the malformed case and a restart
 * clears it.
 */
export const CATALOG_PRICE_EMPTY_TTL_MS = 60 * 60_000;

/**
 * Bump when the cached SHAPE changes, or when a value callers already read
 * starts meaning something different. Entries live for half a day and are
 * treated as fresh, so a TTL alone cannot retire a bad shape — the same hazard
 * PRINTINGS_CACHE_VERSION exists for.
 */
export const CATALOG_PRICE_CACHE_VERSION = 1;

/**
 * `<cardId>|<priceKey>` -> USD market price.
 *
 * Exactly the keys `models/catalogPrice.ts` builds on the device, because the
 * device drops this straight into the same Map. Two spellings of one key is a
 * silently unpriced collection.
 */
export type SetPriceIndex = Record<string, number>;

interface CacheEntry {
  at: number;
  v: number;
  prices: SetPriceIndex;
}

interface RawPricedCard {
  id?: unknown;
  tcgplayer?: RawTcgplayer;
}

/**
 * Index one `/cards` response by `<cardId>|<priceKey>`.
 *
 * Reuses the client's normaliser rather than reading `tcgplayer.prices`
 * directly: that mapping folds `unlimited` onto `normal` and `1stEdition*` onto
 * the first-edition keys, and a second copy of it here would drift from the one
 * the device looks prices up with.
 *
 * Only positive market prices are kept. Absent must mean unknown — a stored
 * zero would sum into the collection total as though the printing were
 * worthless, which reads as a real number and is not one.
 */
export function indexSetPrices(body: unknown): SetPriceIndex {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return {};

  const prices: SetPriceIndex = {};
  for (const card of data as RawPricedCard[]) {
    const id = card?.id;
    if (typeof id !== "string" || !id) continue;
    for (const [key, point] of Object.entries(normalizeTcgplayerPricing(card.tcgplayer).variants)) {
      const market = point?.market;
      if (typeof market === "number" && Number.isFinite(market) && market > 0) {
        prices[`${id}|${key}`] = market;
      }
    }
  }
  return prices;
}

/** The upstream maximum. A page shorter than this is the last one. */
const PRICES_PAGE_SIZE = 250;

/**
 * A guard, not a limit: an upstream that kept returning full pages would
 * otherwise loop forever, and no real set is near 2,500 cards. Hitting it logs
 * rather than truncating in silence — the failure paging exists to fix.
 */
const MAX_PRICE_PAGES = 10;

/**
 * The catalog path that answers "prices for this set".
 *
 * `select` is the point of the whole endpoint: `id,tcgplayer` instead of the
 * dozen fields the card list asks for. Deliberately NOT the key the set
 * screen's card list uses — sharing it would mean either sending the set screen
 * a card with no name, or sending Home the images again.
 *
 * Paged, because 250 is the upstream maximum: one page priced Paldea Evolved
 * (279 cards) from 250 of them, and the 29 left out were its secret rares.
 * `orderBy` keeps the order stable across pages; upstream's default is not by
 * number, and paging an unstable order can repeat or skip cards.
 */
export function pricesPath(setId: string, page = 1): string {
  return (
    `/cards?q=${encodeURIComponent(`set.id:${setId}`)}` +
    `&pageSize=${PRICES_PAGE_SIZE}&page=${page}&orderBy=number&select=${encodeURIComponent("id,tcgplayer")}`
  );
}

export class CatalogPriceStore {
  private memory = new Map<string, CacheEntry>();
  /**
   * When each set last answered EMPTY. Memory only, never `write()` — see
   * CATALOG_PRICE_EMPTY_TTL_MS. A failure is never recorded here.
   */
  private emptyAt = new Map<string, number>();
  /** In-flight fetches, so a device holding twenty sets causes one run each. */
  private inFlight = new Map<string, Promise<SetPriceIndex>>();

  /**
   * `fetchCatalog` is injected rather than built here so this store goes through
   * the proxy's retry-and-stale policy instead of owning a second copy of it.
   */
  constructor(
    private readonly dir: string,
    private readonly fetchCatalog: (path: string) => Promise<unknown>,
  ) {}

  private file(setId: string): string {
    // Set ids are alphanumeric with dots; refuse anything else rather than
    // letting a request choose a path.
    const safe = setId.replace(/[^A-Za-z0-9._-]/g, "");
    return join(this.dir, `${safe}.json`);
  }

  private read(setId: string): CacheEntry | null {
    const cached = this.memory.get(setId);
    if (cached) return cached;
    const path = this.file(setId);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheEntry;
      if (!parsed?.prices || typeof parsed.prices !== "object") return null;
      // An older shape is not a usable cache, however recently it was written.
      if (parsed.v !== CATALOG_PRICE_CACHE_VERSION) return null;
      this.memory.set(setId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private write(setId: string, entry: CacheEntry): void {
    this.memory.set(setId, entry);
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      const path = this.file(setId);
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(entry));
      renameSync(tmp, path);
    } catch (err) {
      // A cache that cannot persist is still useful in memory.
      console.warn(`[cardlens] could not persist catalog prices for ${setId}:`, err);
    }
  }

  /**
   * Prices for one set, from cache when fresh.
   *
   * Throws only when there is nothing at all to serve. A stale entry is
   * preferred to an error: a total priced with yesterday's numbers is right to
   * within a rounding error, and the alternative on this upstream is no total.
   */
  async get(setId: string): Promise<SetPriceIndex> {
    const entry = this.read(setId);
    if (entry && Date.now() - entry.at < CATALOG_PRICE_TTL_MS) return entry.prices;

    const empty = this.emptyAt.get(setId);
    if (empty !== undefined && Date.now() - empty < CATALOG_PRICE_EMPTY_TTL_MS) return {};

    // A caller that joins a run already in flight goes through the same
    // stale fallback below. Returning the shared promise directly handed the
    // second caller the rejection while the first was served the stale copy.
    const promise = this.inFlight.get(setId) ?? this.fetch(setId);

    try {
      return await promise;
    } catch (err) {
      if (entry) {
        console.warn(`[cardlens] catalog prices failed for ${setId}, serving stale:`, err);
        return entry.prices;
      }
      throw err;
    }
  }

  /**
   * Every page of a set, until a short page says there are no more.
   *
   * One failed page fails the whole set — the caller then serves the stale
   * copy or names the set in `missing`. Indexing the pages that did arrive
   * would persist a truncated set for twelve hours, which is the bug paging
   * exists to fix.
   */
  private async fetchAllPages(setId: string): Promise<{ data: unknown[] }> {
    const data: unknown[] = [];
    for (let page = 1; page <= MAX_PRICE_PAGES; page++) {
      const body = (await this.fetchCatalog(pricesPath(setId, page))) as { data?: unknown } | null;
      const batch = Array.isArray(body?.data) ? (body.data as unknown[]) : [];
      data.push(...batch);
      if (batch.length < PRICES_PAGE_SIZE) break;
      if (page === MAX_PRICE_PAGES) {
        console.warn(
          `[cardlens] ${setId}: hit the ${MAX_PRICE_PAGES}-page price cap — the set may be truncated`,
        );
      }
    }
    return { data };
  }

  private fetch(setId: string): Promise<SetPriceIndex> {
    const promise = this.fetchAllPages(setId)
      .then((body) => {
        const prices = indexSetPrices(body);
        // An empty index is a legitimate answer — pokemontcg.io prices none of
        // several modern sets (measured: 0/120 Pitch Black) — but it is
        // indistinguishable from a response that arrived malformed, so it is
        // never written. It is remembered in memory for an hour instead, or
        // every request would go back upstream for it.
        if (Object.keys(prices).length > 0) {
          this.emptyAt.delete(setId);
          this.write(setId, { at: Date.now(), v: CATALOG_PRICE_CACHE_VERSION, prices });
        } else {
          this.emptyAt.set(setId, Date.now());
        }
        return prices;
      })
      .finally(() => this.inFlight.delete(setId));

    this.inFlight.set(setId, promise);
    return promise;
  }
}
