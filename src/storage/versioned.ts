/**
 * Versioned, corruption-safe wrapper over a Storage-like backend (localStorage).
 * Every key is namespaced `cardlens:v{N}:{key}`. Reads validate with a provided
 * guard and silently discard corrupt/outdated values instead of throwing.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_NAMESPACE = "cardlens";
export const STORAGE_VERSION = 1;

export type Validator<T> = (value: unknown) => value is T;

function namespacedKey(key: string): string {
  return `${STORAGE_NAMESPACE}:v${STORAGE_VERSION}:${key}`;
}

/** In-memory fallback used when localStorage is unavailable (SSR/tests/private mode). */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

export function getBackend(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") {
      const probe = `${STORAGE_NAMESPACE}:__probe__`;
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    // localStorage disabled (private mode / no permission) — fall through.
  }
  return createMemoryStorage();
}

export class VersionedStore {
  constructor(private readonly backend: StorageLike = getBackend()) {}

  read<T>(key: string, guard: Validator<T>, fallback: T): T {
    const raw = this.backend.getItem(namespacedKey(key));
    if (raw == null) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      return guard(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  write<T>(key: string, value: T): boolean {
    try {
      this.backend.setItem(namespacedKey(key), JSON.stringify(value));
      return true;
    } catch {
      // Quota exceeded or serialization error — non-fatal.
      return false;
    }
  }

  remove(key: string): void {
    try {
      this.backend.removeItem(namespacedKey(key));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Drop every cache entry, keeping user data. Returns how many keys went.
 *
 * The collection is the one thing here that cannot be refetched, and it is
 * written last — after a browsing session has already filled the quota with
 * set-card lists. When its write fails there is nothing to see: the mark simply
 * does not happen. So a failed collection write buys space from the caches,
 * which cost one request to rebuild, and tries again.
 */
export function evictCaches(backend: StorageLike = getBackend()): number {
  if (typeof localStorage === "undefined" || backend !== localStorage) return 0;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${STORAGE_NAMESPACE}:v${STORAGE_VERSION}:cache:`)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    return doomed.length;
  } catch {
    return 0;
  }
}

/** Remove ALL CardLens data (favorites, recents, caches). Used by DevPanel. */
export function clearAllStorage(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${STORAGE_NAMESPACE}:`)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * One-time migration hook. Removes data written under older namespace versions so
 * stale/incompatible shapes never reach the app. Extend with real transforms when
 * a future version needs to preserve data.
 */
export function migrateStorage(backend: StorageLike = getBackend()): void {
  if (typeof localStorage === "undefined" || backend !== localStorage) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const m = key.match(/^cardlens:v(\d+):/);
      if (m && Number(m[1]) < STORAGE_VERSION) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* ignore migration failures */
  }
}
