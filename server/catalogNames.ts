import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-side cache of card names, numbers and art, one compact index per set.
 *
 * My cards lists every printing held, and the collection stores ids alone, so
 * it has to learn names and pictures for every set the collection touches —
 * about nineteen on the author's device. It did that the way Home used to price
 * the collection: one `/api/catalog/cards` request per set, through a proxy
 * with a 60-second memory cache, against an upstream measured at ~25% failure
 * in bursts. The device's own card-list cache keeps only eight sets, so nearly
 * every cold open refetched nearly everything, and a set that failed left its
 * rows as bare ids.
 *
 * This is the same fix `catalogPrices.ts` is, applied to the other half of the
 * row: one request for every set, a slim `select`, twelve hours on disk, stale
 * served when upstream is down, and a set that cannot be answered named in
 * `missing` rather than costing the others their names.
 */

/** Names and art do not change; the TTL only bounds how long a correction takes. */
export const CATALOG_NAMES_TTL_MS = 12 * 60 * 60_000;

/**
 * Bump when the cached SHAPE changes. Entries are treated as fresh for half a
 * day, so a TTL alone cannot retire a bad shape.
 */
export const CATALOG_NAMES_CACHE_VERSION = 1;

/** What a My cards row needs from the catalog, and nothing else. */
export interface CardName {
  name: string;
  number: string;
  image?: string;
  large?: string;
}

/** `<cardId>` -> name, collector number and art. Card ids are globally unique. */
export type SetNameIndex = Record<string, CardName>;

interface CacheEntry {
  at: number;
  v: number;
  cards: SetNameIndex;
}

interface RawNamedCard {
  id?: unknown;
  name?: unknown;
  number?: unknown;
  images?: { small?: unknown; large?: unknown } | null;
}

/**
 * Index one `/cards` response by card id.
 *
 * A card with no id or no name is skipped: a row named by an empty string reads
 * worse than one still showing its id. A missing number is kept as "", the same
 * default the client's own `toSummary` uses.
 */
export function indexSetNames(body: unknown): SetNameIndex {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return {};

  const cards: SetNameIndex = {};
  for (const card of data as RawNamedCard[]) {
    const id = card?.id;
    const name = card?.name;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) continue;
    const small = card.images?.small;
    const large = card.images?.large;
    cards[id] = {
      name,
      number: typeof card.number === "string" ? card.number : "",
      ...(typeof small === "string" && small ? { image: small } : {}),
      ...(typeof large === "string" && large ? { large } : {}),
    };
  }
  return cards;
}

/** The upstream maximum. A page shorter than this is the last one. */
const NAMES_PAGE_SIZE = 250;

/** A guard against an upstream that never returns a short page, not a limit. */
const MAX_NAME_PAGES = 10;

/**
 * The catalog path that answers "names for this set".
 *
 * `select=id,name,number,images`, not the set screen's dozen fields: no prices,
 * no embedded set object, no rarity. Paged and ordered for the same reason the
 * price index is — 250 is the upstream maximum, and an unstable order can
 * repeat or skip cards across pages.
 */
export function namesPath(setId: string, page = 1): string {
  return (
    `/cards?q=${encodeURIComponent(`set.id:${setId}`)}` +
    `&pageSize=${NAMES_PAGE_SIZE}&page=${page}&orderBy=number&select=${encodeURIComponent("id,name,number,images")}`
  );
}

export class CatalogNameStore {
  private memory = new Map<string, CacheEntry>();
  /** In-flight fetches, so concurrent asks for one set cause one upstream run. */
  private inFlight = new Map<string, Promise<SetNameIndex>>();

  /** `fetchCatalog` goes through the proxy's retry-and-stale policy. */
  constructor(
    private readonly dir: string,
    private readonly fetchCatalog: (path: string) => Promise<unknown>,
  ) {}

  private file(setId: string): string {
    // Refuse anything that is not a set-id character rather than letting a
    // request choose a path.
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
      if (!parsed?.cards || typeof parsed.cards !== "object") return null;
      if (parsed.v !== CATALOG_NAMES_CACHE_VERSION) return null;
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
      console.warn(`[cardlens] could not persist catalog names for ${setId}:`, err);
    }
  }

  /**
   * Names for one set, from cache when fresh. Throws only when there is nothing
   * at all to serve: a stale name is still the right name.
   */
  async get(setId: string): Promise<SetNameIndex> {
    const entry = this.read(setId);
    if (entry && Date.now() - entry.at < CATALOG_NAMES_TTL_MS) return entry.cards;

    // A caller joining a run in flight goes through the same stale fallback.
    const promise = this.inFlight.get(setId) ?? this.fetch(setId);

    try {
      return await promise;
    } catch (err) {
      if (entry) {
        console.warn(`[cardlens] catalog names failed for ${setId}, serving stale:`, err);
        return entry.cards;
      }
      throw err;
    }
  }

  /**
   * Every page of a set. One failed page fails the whole set, so a truncated
   * index is never persisted for twelve hours.
   */
  private async fetchAllPages(setId: string): Promise<{ data: unknown[] }> {
    const data: unknown[] = [];
    for (let page = 1; page <= MAX_NAME_PAGES; page++) {
      const body = (await this.fetchCatalog(namesPath(setId, page))) as { data?: unknown } | null;
      const batch = Array.isArray(body?.data) ? (body.data as unknown[]) : [];
      data.push(...batch);
      if (batch.length < NAMES_PAGE_SIZE) break;
      if (page === MAX_NAME_PAGES) {
        console.warn(
          `[cardlens] ${setId}: hit the ${MAX_NAME_PAGES}-page names cap — the set may be truncated`,
        );
      }
    }
    return { data };
  }

  private fetch(setId: string): Promise<SetNameIndex> {
    const promise = this.fetchAllPages(setId)
      .then((body) => {
        const cards = indexSetNames(body);
        // Empty is indistinguishable from a malformed response, so it is
        // returned but never written.
        if (Object.keys(cards).length > 0) {
          this.write(setId, { at: Date.now(), v: CATALOG_NAMES_CACHE_VERSION, cards });
        }
        return cards;
      })
      .finally(() => this.inFlight.delete(setId));

    this.inFlight.set(setId, promise);
    return promise;
  }
}
