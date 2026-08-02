import { judge, search, type Verdict } from "./phash.ts";

/**
 * Loading the artwork index.
 *
 * Two static assets shipped from Pages, not the companion server: the CDN is
 * free, it is the same origin as the app (so no CORS on a hot path), and
 * SERVER-PC has been found powered off twice. Scanning has to work when the
 * house does not.
 */

export interface IndexedCard {
  id: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
  rarity: string | null;
}

export interface CardIndex {
  version: string;
  /** Two uint32 per card, parallel to `cards`. */
  hashes: Uint32Array;
  cards: IndexedCard[];
}

export interface ScanResult extends Verdict {
  /** Candidates resolved to cards, nearest first. */
  candidates: { card: IndexedCard; distance: number }[];
}

function base(): string {
  // Vite's base is "/cardlens/" in production and "/" in dev; assets under
  // public/ land beside it either way.
  return import.meta.env.BASE_URL;
}

let pending: Promise<CardIndex> | null = null;

/**
 * Fetch and decode the index, once per session.
 *
 * Cached as a promise rather than a value so two screens mounting together
 * share one download instead of racing to start two.
 */
export function loadCardIndex(): Promise<CardIndex> {
  pending ??= (async () => {
    const latest = (await fetch(`${base()}card-index/latest.json`).then((r) => {
      if (!r.ok) throw new Error(`index manifest ${r.status}`);
      return r.json();
    })) as { version: string };

    const [buffer, cards] = await Promise.all([
      fetch(`${base()}card-index/index-${latest.version}.bin`).then((r) => {
        if (!r.ok) throw new Error(`index ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(`${base()}card-index/cards-${latest.version}.json`).then((r) => {
        if (!r.ok) throw new Error(`index metadata ${r.status}`);
        return r.json() as Promise<IndexedCard[]>;
      }),
    ]);

    const hashes = new Uint32Array(buffer);
    if (hashes.length !== cards.length * 2) {
      // The two files are written together and named by the same content hash,
      // so this can only mean a half-updated cache. Failing loudly beats
      // matching against metadata that is off by one and silently naming the
      // wrong card for every scan.
      throw new Error(`index is ${hashes.length / 2} hashes but ${cards.length} cards`);
    }
    return { version: latest.version, hashes, cards };
  })();
  return pending;
}

/** Reset between tests. */
export function resetCardIndex(): void {
  pending = null;
}

/** Identify a hashed capture against the index. */
export function identify(index: CardIndex, hash: Uint32Array, k = 3): ScanResult {
  const matches = search(index.hashes, hash, k);
  return {
    ...judge(matches),
    candidates: matches.map((m) => ({ card: index.cards[m.ordinal], distance: m.distance })),
  };
}
