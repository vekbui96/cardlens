import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-side cache of the pokemontcg.io set list, on disk.
 *
 * `/api/catalog/sets` used to go through the proxy's 60-second memory cache,
 * whose stale fallback lived only as long as the process. The service restarts
 * on every deploy, so the first set-list request after one had nothing to fall
 * back on, and pokemontcg.io fails about a quarter of the time, in bursts. Home
 * cannot price a set until it knows the set's name, so a failed set list leaves
 * the whole collection total "unaskable".
 *
 * The list changes on release days only (177 sets live), so a day's lifetime
 * costs at most a day's delay on a new set, the same order as the device's own
 * 7-day copy. Same shape as `CatalogPriceStore` and `PrintingsStore`.
 */

/** Fresh for a day. Sets appear on release days, not by the minute. */
export const CATALOG_SETS_TTL_MS = 24 * 60 * 60_000;

/**
 * Bump when the cached SHAPE changes. Entries are treated as fresh for a day,
 * so a TTL alone cannot retire a bad shape.
 */
export const CATALOG_SETS_CACHE_VERSION = 1;

/**
 * Distinct queries persisted to disk. The device sends exactly one set-list
 * query; the cap only exists so a stream of different `pageSize` / `select`
 * values cannot fill the disk. Past it, entries are memory-only.
 */
export const CATALOG_SETS_MAX_FILES = 16;

/** Same bound for memory, which outlives any one request by weeks. */
const MAX_MEMORY_ENTRIES = 64;

interface CacheEntry {
  at: number;
  v: number;
  /** The upstream path, checked on read so a file can never answer another query. */
  path: string;
  body: unknown;
}

/** A list worth keeping: a body whose `data` is a non-empty array. */
function isUsableList(body: unknown): boolean {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) && data.length > 0;
}

export class CatalogSetsStore {
  private memory = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<unknown>>();

  /**
   * `fetchCatalog` is injected so this goes through the proxy's retry policy
   * rather than owning a second copy of it.
   */
  constructor(
    private readonly dir: string,
    private readonly fetchCatalog: (path: string) => Promise<unknown>,
  ) {}

  /** Named by a hash of the path: no request chooses a file name, and none collide. */
  private file(path: string): string {
    return join(this.dir, `${createHash("sha256").update(path).digest("hex")}.json`);
  }

  private remember(path: string, entry: CacheEntry): void {
    if (this.memory.size >= MAX_MEMORY_ENTRIES && !this.memory.has(path)) {
      const oldest = this.memory.keys().next();
      if (!oldest.done) this.memory.delete(oldest.value);
    }
    this.memory.set(path, entry);
  }

  private read(path: string): CacheEntry | null {
    const cached = this.memory.get(path);
    if (cached) return cached;
    const file = this.file(path);
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
      if (parsed?.v !== CATALOG_SETS_CACHE_VERSION || parsed.path !== path) return null;
      if (typeof parsed.at !== "number" || !isUsableList(parsed.body)) return null;
      this.remember(path, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private write(path: string, entry: CacheEntry): void {
    this.remember(path, entry);
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      const file = this.file(path);
      if (
        !existsSync(file) &&
        readdirSync(this.dir).filter((n) => n.endsWith(".json")).length >= CATALOG_SETS_MAX_FILES
      ) {
        return;
      }
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(entry));
      renameSync(tmp, file);
    } catch (err) {
      // A cache that cannot persist is still useful in memory.
      console.warn(`[cardlens] could not persist the set list:`, err);
    }
  }

  /**
   * The set list for one upstream query, from cache when fresh.
   *
   * Throws only when there is nothing at all to serve: a day-old list is still
   * the right list on every day but a release day, and the alternative on this
   * upstream is no list.
   */
  async get(path: string): Promise<unknown> {
    const entry = this.read(path);
    if (entry && Date.now() - entry.at < CATALOG_SETS_TTL_MS) return entry.body;

    // Joiners go through the same stale fallback below as the first caller.
    const promise = this.inFlight.get(path) ?? this.fetch(path);
    try {
      return await promise;
    } catch (err) {
      if (entry) {
        console.warn(`[cardlens] set list failed for ${path}, serving stale:`, err);
        return entry.body;
      }
      throw err;
    }
  }

  private fetch(path: string): Promise<unknown> {
    const promise = this.fetchCatalog(path)
      .then((body) => {
        // An empty list is never a real answer for this catalog, and is
        // indistinguishable from a malformed one, so it is not written.
        if (isUsableList(body))
          this.write(path, { at: Date.now(), v: CATALOG_SETS_CACHE_VERSION, path, body });
        return body;
      })
      .finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, promise);
    return promise;
  }
}
