import { VersionedStore } from "./versioned.ts";

/** Milliseconds helpers. */
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Default cache lifetimes (spec: prices 15–60 min, metadata 7 days). */
export const PRICE_TTL_MS = 30 * MINUTE;
export const CARD_TTL_MS = 7 * DAY;

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export interface CacheHit<T> {
  value: T;
  storedAt: number;
  /** True when older than the TTL — show it but mark it as potentially stale. */
  isStale: boolean;
}

type CacheShape<T> = Record<string, CacheEntry<T>>;

function isCacheShape(value: unknown): value is CacheShape<unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A small TTL cache persisted as one JSON blob per storage key. Returns stale
 * entries (for instant cached-first render) but flags them so the UI can show a
 * "may be out of date" marker while a refresh runs. Evicts oldest beyond max.
 */
export class TtlCache<T> {
  constructor(
    private readonly key: string,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly store: VersionedStore = new VersionedStore(),
    private readonly now: () => number = Date.now,
  ) {}

  private readAll(): CacheShape<T> {
    return this.store.read<CacheShape<T>>(this.key, isCacheShape as (v: unknown) => v is CacheShape<T>, {});
  }

  get(id: string): CacheHit<T> | null {
    const entry = this.readAll()[id];
    if (!entry) return null;
    return {
      value: entry.value,
      storedAt: entry.storedAt,
      isStale: this.now() - entry.storedAt > this.ttlMs,
    };
  }

  set(id: string, value: T): void {
    const all = this.readAll();
    all[id] = { value, storedAt: this.now() };

    const ids = Object.keys(all);
    if (ids.length > this.maxEntries) {
      ids
        .map((k) => [k, all[k].storedAt] as const)
        .sort((a, b) => a[1] - b[1])
        .slice(0, ids.length - this.maxEntries)
        .forEach(([k]) => delete all[k]);
    }
    this.store.write(this.key, all);
  }

  clear(): void {
    this.store.remove(this.key);
  }
}
