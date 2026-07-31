import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TcgdexClient, type SetPrintings } from "../src/integrations/tcgdex/client.ts";

/**
 * Server-side cache of TCGdex printings.
 *
 * Assembling one set costs a request per card — 120 for Pitch Black, 295 for
 * Ascended Heroes — because TCGdex only exposes variants on the individual card
 * endpoint. Paying that on every device, and especially on glasses tethered to
 * a phone, is the expensive part. The server pays it once and every device gets
 * a single request instead.
 *
 * Cached to disk so a restart does not re-fetch, and so a set stays available
 * even when TCGdex is down.
 */

/** Printings for a released set do not change. */
export const PRINTINGS_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * Bump whenever the cached SHAPE gains something callers read.
 *
 * The TTL alone cannot do this job: entries are held for 30 days and treated as
 * fresh, so adding per-printing prices would have served priceless entries for a
 * month with no way to tell them apart from complete ones. A version mismatch
 * makes them stale immediately.
 *
 * v2 — printings carry a `price`.
 */
export const PRINTINGS_CACHE_VERSION = 2;

interface CacheEntry {
  at: number;
  /** Absent on v1 entries written before this existed. */
  v?: number;
  value: SetPrintings;
}

export class PrintingsStore {
  private memory = new Map<string, CacheEntry>();
  /** In-flight fetches, so ten devices opening a set cause one upstream run. */
  private inFlight = new Map<string, Promise<SetPrintings | null>>();

  constructor(
    private readonly dir: string,
    private readonly client = new TcgdexClient(),
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
      if (!parsed?.value?.byNumber) return null;
      // An older shape is not a usable cache, however recently it was written.
      if (parsed.v !== PRINTINGS_CACHE_VERSION) return null;
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
      console.warn(`[cardlens] could not persist printings for ${setId}:`, err);
    }
  }

  /**
   * Printings for a set, from cache when fresh.
   *
   * A stale entry is returned rather than refetched on the spot: the data is
   * effectively immutable once a set ships, and making a device wait ~2s to
   * confirm that is a bad trade.
   */
  async get(setId: string, setName: string): Promise<{ value: SetPrintings | null; cached: boolean }> {
    const entry = this.read(setId);
    if (entry && Date.now() - entry.at < PRINTINGS_TTL_MS) {
      return { value: entry.value, cached: true };
    }

    const existing = this.inFlight.get(setId);
    if (existing) return { value: await existing, cached: false };

    const promise = this.client
      .getSetPrintings(setId, setName)
      .then((value) => {
        if (value && Object.keys(value.byNumber).length > 0) {
          this.write(setId, { at: Date.now(), v: PRINTINGS_CACHE_VERSION, value });
        }
        return value;
      })
      .finally(() => this.inFlight.delete(setId));

    this.inFlight.set(setId, promise);

    try {
      return { value: await promise, cached: false };
    } catch (err) {
      // Serving a stale copy beats failing when upstream is down.
      if (entry) {
        console.warn(`[cardlens] printings fetch failed for ${setId}, serving stale:`, err);
        return { value: entry.value, cached: true };
      }
      throw err;
    }
  }
}
