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

/**
 * The catalog path that answers "prices for this set".
 *
 * `select` is the point of the whole endpoint: `id,tcgplayer` instead of the
 * dozen fields the card list asks for. Deliberately NOT the key the set
 * screen's card list uses — sharing it would mean either sending the set screen
 * a card with no name, or sending Home the images again.
 */
export function pricesPath(setId: string): string {
  return (
    `/cards?q=${encodeURIComponent(`set.id:${setId}`)}` +
    `&pageSize=250&select=${encodeURIComponent("id,tcgplayer")}`
  );
}

export class CatalogPriceStore {
  private memory = new Map<string, CacheEntry>();
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

    const existing = this.inFlight.get(setId);
    if (existing) return existing;

    const promise = this.fetchCatalog(pricesPath(setId))
      .then((body) => {
        const prices = indexSetPrices(body);
        // An empty index is a legitimate answer — pokemontcg.io prices none of
        // several modern sets (measured: 0/120 Pitch Black) — but it is
        // indistinguishable from a response that arrived malformed, so it is
        // not written. Re-asking costs one request every twelve hours.
        if (Object.keys(prices).length > 0) {
          this.write(setId, { at: Date.now(), v: CATALOG_PRICE_CACHE_VERSION, prices });
        }
        return prices;
      })
      .finally(() => this.inFlight.delete(setId));

    this.inFlight.set(setId, promise);

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
}
