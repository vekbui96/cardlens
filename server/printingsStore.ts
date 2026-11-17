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
 * How long a build with skipped cards counts as fresh.
 *
 * Only a COMPLETE set earns the 30 days above. A card skipped during a TCGdex
 * 503 burst is not a card without printings, and caching the gap for a month
 * hid it: live, Fates Collide (xy10) served 119 of 125 numbers while TCGdex had
 * all six missing cards with variants. An hour is long enough not to hammer
 * TCGdex mid-burst and short enough that the gap heals the same day. The
 * incomplete entry keeps serving meanwhile, and as the stale fallback.
 */
export const PARTIAL_PRINTINGS_TTL_MS = 60 * 60_000;

/**
 * Bump whenever the cached SHAPE gains something callers read.
 *
 * The TTL alone cannot do this job: entries are held for 30 days and treated as
 * fresh, so adding per-printing prices would have served priceless entries for a
 * month with no way to tell them apart from complete ones. A version mismatch
 * makes them stale immediately.
 *
 * v2 — printings carry a `price`.
 * v3 — printings carry `eur` rolling averages for movement.
 * v4 — cards whose variants TCGdex generated take their lone market price.
 *
 * Bump for a SHAPE change, or when a field callers already read starts holding
 * a materially different VALUE — v4 is the second kind. It is the same hazard
 * the version guard exists for: without it, sets cached before the fix would
 * keep serving the missing prices for up to 30 days and look correct doing it.
 * Do not bump when the output is byte-identical; a full refetch costs 120-295
 * upstream requests per set and buys nothing.
 */
export const PRINTINGS_CACHE_VERSION = 4;

interface CacheEntry {
  at: number;
  /** Absent on v1 entries written before this existed. */
  v?: number;
  value: SetPrintings;
  /**
   * Cards the build could not fetch. Absent means complete — every entry
   * written before this existed reads that way, which is what they were
   * treated as, so no version bump (and no set-wide refetch) is needed.
   */
  skippedCards?: number;
}

/** What one upstream run produced, after the cache has had its say. */
interface Built {
  value: SetPrintings | null;
  complete: boolean;
}

function isComplete(entry: CacheEntry): boolean {
  return !entry.skippedCards;
}

function freshFor(entry: CacheEntry): number {
  return isComplete(entry) ? PRINTINGS_TTL_MS : PARTIAL_PRINTINGS_TTL_MS;
}

export class PrintingsStore {
  private memory = new Map<string, CacheEntry>();
  /** In-flight fetches, so ten devices opening a set cause one upstream run. */
  private inFlight = new Map<string, Promise<Built>>();

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
   *
   * `complete` is false when the answer is missing cards TCGdex failed to
   * serve, so the route can tell browsers not to hold it for a month.
   */
  async get(
    setId: string,
    setName: string,
  ): Promise<{ value: SetPrintings | null; cached: boolean; complete: boolean }> {
    const entry = this.read(setId);
    if (entry && Date.now() - entry.at < freshFor(entry)) {
      return { value: entry.value, cached: true, complete: isComplete(entry) };
    }

    // A caller that joins a run already in flight goes through the same
    // stale fallback below. Awaiting the shared promise outside the try handed
    // the second caller the rejection while the first was served the stale copy.
    const promise = this.inFlight.get(setId) ?? this.fetch(setId, setName);

    try {
      const built = await promise;
      return { value: built.value, cached: false, complete: built.complete };
    } catch (err) {
      // Serving a stale copy beats failing when upstream is down.
      if (entry) {
        console.warn(`[cardlens] printings fetch failed for ${setId}, serving stale:`, err);
        return { value: entry.value, cached: true, complete: isComplete(entry) };
      }
      throw err;
    }
  }

  private fetch(setId: string, setName: string): Promise<Built> {
    const promise = this.client
      .buildSetPrintings(setId, setName)
      .then((report): Built => {
        if (!report) return { value: null, complete: true };
        const { printings: value, skippedCards } = report;
        const numbers = Object.keys(value.byNumber).length;
        if (numbers === 0) return { value, complete: skippedCards === 0 };

        if (skippedCards > 0) {
          // A rebuild that lands inside the next burst must not make the set
          // worse. Keep the fuller entry, re-stamped so it waits out another
          // short window rather than rebuilding on every request.
          const previous = this.read(setId);
          if (previous && Object.keys(previous.value.byNumber).length >= numbers) {
            this.write(setId, { ...previous, at: Date.now() });
            return { value: previous.value, complete: isComplete(previous) };
          }
          console.warn(`[cardlens] printings for ${setId} skipped ${skippedCards} card(s); caching for 1h`);
        }

        this.write(setId, {
          at: Date.now(),
          v: PRINTINGS_CACHE_VERSION,
          value,
          ...(skippedCards > 0 ? { skippedCards } : {}),
        });
        return { value, complete: skippedCards === 0 };
      })
      .finally(() => this.inFlight.delete(setId));

    this.inFlight.set(setId, promise);
    return promise;
  }
}
