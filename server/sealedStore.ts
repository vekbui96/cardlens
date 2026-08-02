import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { classifySealed, normalizeSetName, type SealedPrice, type SetSealed } from "../src/models/sealed.ts";

const BASE = "https://tcgcsv.com/tcgplayer";
/** TCGplayer's category id for Pokemon (English). Japan is 85. */
const POKEMON = 3;

/**
 * Sealed prices are refreshed daily, because that is how often the source is.
 *
 * tcgcsv republishes TCGplayer's dump once a day, so a shorter TTL would spend
 * requests to read the same numbers back. A longer one would make "current
 * pack price" a claim the data no longer supports — this is the one figure in
 * the app that is expected to move day to day.
 */
const TTL_MS = 20 * 60 * 60_000;

interface CacheEntry {
  at: number;
  v: number;
  value: SetSealed | null;
}

const CACHE_VERSION = 1;

/**
 * `unknown` results, narrowed at each use. tcgcsv adds fields as TCGplayer
 * does, so a schema here would reject a payload that is merely newer.
 */
async function getJson(url: string, signal?: AbortSignal): Promise<{ results?: unknown[] }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "cardlens" },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as { results?: unknown[] };
}

export class SealedStore {
  private groups: { at: number; byName: Map<string, number> } | null = null;

  constructor(private readonly dir: string) {}

  private file(setId: string): string {
    return join(this.dir, `${setId.replace(/[^a-z0-9._-]/gi, "_")}.json`);
  }

  private read(setId: string): CacheEntry | null {
    try {
      const parsed = JSON.parse(readFileSync(this.file(setId), "utf8")) as CacheEntry;
      if (parsed.v !== CACHE_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private write(setId: string, entry: CacheEntry): void {
    try {
      mkdirSync(dirname(this.file(setId)), { recursive: true });
      writeFileSync(this.file(setId), JSON.stringify(entry));
    } catch (err) {
      // A cache that cannot be written is slow, not broken.
      console.warn(`[cardlens] could not persist sealed for ${setId}:`, err);
    }
  }

  /**
   * tcgcsv's group id for a catalog set name.
   *
   * The group list is one request covering every set, held in memory for the
   * same day as the prices — looking it up per set would fetch 217 groups to
   * answer one question.
   */
  private async groupFor(setName: string, signal?: AbortSignal): Promise<number | undefined> {
    if (!this.groups || Date.now() - this.groups.at > TTL_MS) {
      const body = await getJson(`${BASE}/${POKEMON}/groups`, signal);
      const byName = new Map<string, number>();
      for (const raw of body?.results ?? []) {
        const g = raw as { name?: unknown; groupId?: unknown };
        if (typeof g.name === "string" && typeof g.groupId === "number") {
          // First writer wins: promo and energy sub-groups repeat a base name
          // and the main set is listed first.
          const key = normalizeSetName(g.name);
          if (!byName.has(key)) byName.set(key, g.groupId);
        }
      }
      this.groups = { at: Date.now(), byName };
    }
    return this.groups.byName.get(normalizeSetName(setName));
  }

  private async build(setId: string, setName: string, signal?: AbortSignal): Promise<SetSealed | null> {
    const groupId = await this.groupFor(setName, signal);
    if (groupId === undefined) return null;

    const [products, prices] = await Promise.all([
      getJson(`${BASE}/${POKEMON}/${groupId}/products`, signal),
      getJson(`${BASE}/${POKEMON}/${groupId}/prices`, signal),
    ]);

    const market = new Map<number, number>();
    for (const raw of prices?.results ?? []) {
      const p = raw as { subTypeName?: unknown; marketPrice?: unknown; productId?: unknown };
      // Sealed product carries the "Normal" subtype; the others are card
      // printings sharing the same feed.
      if (p.subTypeName !== "Normal" || typeof p.productId !== "number") continue;
      const value = Number(p.marketPrice);
      if (Number.isFinite(value) && value > 0) market.set(p.productId, value);
    }

    const out: SealedPrice[] = [];
    const seen = new Set<string>();
    for (const raw of products?.results ?? []) {
      const p = raw as { name?: unknown; productId?: unknown };
      const kind = typeof p.name === "string" ? classifySealed(p.name) : undefined;
      // One product per kind. A set occasionally lists a second edition of the
      // same unit, and two "Booster Pack" rows would read as a contradiction.
      if (!kind || seen.has(kind) || typeof p.productId !== "number") continue;
      seen.add(kind);
      const price = market.get(p.productId);
      out.push({ kind, productName: String(p.name), ...(price !== undefined ? { price } : {}) });
    }

    if (out.length === 0) return null;
    return { setId, prices: out, updated: new Date().toISOString() };
  }

  async get(setId: string, setName: string, signal?: AbortSignal) {
    const cached = this.read(setId);
    if (cached && Date.now() - cached.at < TTL_MS) return { value: cached.value, cached: true };
    try {
      const value = await this.build(setId, setName, signal);
      this.write(setId, { at: Date.now(), v: CACHE_VERSION, value });
      return { value, cached: false };
    } catch (err) {
      // Yesterday's price beats no price: this is a figure that moves slowly
      // enough that a stale number still answers the question.
      if (cached) return { value: cached.value, cached: true };
      throw err;
    }
  }
}
