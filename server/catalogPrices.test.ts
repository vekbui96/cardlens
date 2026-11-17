import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_PRICE_CACHE_VERSION,
  CATALOG_PRICE_EMPTY_TTL_MS,
  CATALOG_PRICE_TTL_MS,
  CatalogPriceStore,
  indexSetPrices,
  pricesPath,
} from "./catalogPrices.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-catalog-prices-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

/** One card as pokemontcg.io reports it, trimmed to what `select` asks for. */
function card(id: string, prices: Record<string, { market: number | null } | null>) {
  return { id, tcgplayer: { prices } };
}

describe("indexSetPrices", () => {
  it("keys prices the way the device looks them up", () => {
    // `<cardId>|<priceKey>` — the same key models/catalogPrice.ts builds. A
    // different spelling here is a collection that silently prices at zero.
    const index = indexSetPrices({
      data: [card("sv1-1", { holofoil: { market: 12.5 }, reverseHolofoil: { market: 3 } })],
    });
    expect(index).toEqual({ "sv1-1|holofoil": 12.5, "sv1-1|reverseHolofoil": 3 });
  });

  it("folds upstream's key aliases the way the client does", () => {
    // `unlimited` is `normal` and `1stEditionHolofoil` is the first-edition
    // holo. Reading tcgplayer.prices directly instead of going through the
    // shared normaliser would leave both unpriced.
    const index = indexSetPrices({
      data: [card("base1-4", { unlimited: { market: 400 }, "1stEditionHolofoil": { market: 9000 } })],
    });
    expect(index).toEqual({ "base1-4|normal": 400, "base1-4|firstEditionHolofoil": 9000 });
  });

  it("drops zero, null and missing prices rather than storing them", () => {
    // Absent must mean unknown. A stored 0 sums into the collection total as
    // though the printing were worthless, and reads as a real answer.
    const index = indexSetPrices({
      data: [
        card("sv1-2", { holofoil: { market: 0 } }),
        card("sv1-3", { holofoil: { market: null } }),
        card("sv1-4", { holofoil: null }),
        { id: "sv1-5" },
      ],
    });
    expect(index).toEqual({});
  });

  it("survives a body that is not the shape it expects", () => {
    expect(indexSetPrices(null)).toEqual({});
    expect(indexSetPrices({ data: "nope" })).toEqual({});
    expect(indexSetPrices({ data: [{ tcgplayer: { prices: { holofoil: { market: 5 } } } }] })).toEqual({});
  });
});

describe("pricesPath", () => {
  it("asks for prices alone, not the card summary", () => {
    // The whole point of the endpoint: `id,tcgplayer` rather than the dozen
    // fields the card list needs. Home was being sent images and set objects
    // for 250 cards a set and discarding every one of them.
    const path = pricesPath("sv8pt5");
    expect(path).toContain(`select=${encodeURIComponent("id,tcgplayer")}`);
    expect(path).toContain(encodeURIComponent("set.id:sv8pt5"));
    expect(path).not.toContain("images");
  });

  it("names the page and a stable order, so pages neither overlap nor skip", () => {
    // 250 is the upstream maximum. Without `orderBy`, pokemontcg.io's order is
    // not by number, and paging an unstable order can repeat or drop cards.
    expect(pricesPath("sv2")).toContain("&page=1&");
    expect(pricesPath("sv2", 2)).toContain("&page=2&");
    expect(pricesPath("sv2", 2)).toContain("orderBy=number");
  });
});

describe("CatalogPriceStore", () => {
  it("fetches once and serves the rest from cache", async () => {
    const fetchCatalog = vi.fn().mockResolvedValue({ data: [card("sv1-1", { holofoil: { market: 12.5 } })] });
    const store = new CatalogPriceStore(dir, fetchCatalog);

    expect(await store.get("sv1")).toEqual({ "sv1-1|holofoil": 12.5 });
    expect(await store.get("sv1")).toEqual({ "sv1-1|holofoil": 12.5 });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent asks for one set into a single upstream run", async () => {
    // Home asks for every set at once, and several devices may load together.
    // Without this, one cold cache is N identical requests to an API measured at
    // ~25% failure.
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const fetchCatalog = vi.fn().mockReturnValue(pending);
    const store = new CatalogPriceStore(dir, fetchCatalog);

    const all = Promise.all([store.get("sv1"), store.get("sv1"), store.get("sv1")]);
    release({ data: [card("sv1-1", { holofoil: { market: 1 } })] });
    await all;

    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("survives a restart by reading the copy on disk", async () => {
    const body = { data: [card("sv1-1", { holofoil: { market: 12.5 } })] };
    await new CatalogPriceStore(dir, vi.fn().mockResolvedValue(body)).get("sv1");

    const fresh = vi.fn();
    expect(await new CatalogPriceStore(dir, fresh).get("sv1")).toEqual({ "sv1-1|holofoil": 12.5 });
    expect(fresh).not.toHaveBeenCalled();
  });

  it("refetches once the entry is older than the TTL", async () => {
    vi.useFakeTimers();
    const fetchCatalog = vi
      .fn()
      .mockResolvedValueOnce({ data: [card("sv1-1", { holofoil: { market: 12.5 } })] })
      .mockResolvedValueOnce({ data: [card("sv1-1", { holofoil: { market: 20 } })] });
    const store = new CatalogPriceStore(dir, fetchCatalog);

    await store.get("sv1");
    vi.setSystemTime(Date.now() + CATALOG_PRICE_TTL_MS + 1);
    expect(await store.get("sv1")).toEqual({ "sv1-1|holofoil": 20 });
  });

  it("serves a stale copy rather than failing when upstream is down", async () => {
    // The alternative is Home reporting no total at all, on an API that fails a
    // quarter of the time. Yesterday's prices are right to a rounding error.
    vi.useFakeTimers();
    const fetchCatalog = vi
      .fn()
      .mockResolvedValueOnce({ data: [card("sv1-1", { holofoil: { market: 12.5 } })] })
      .mockRejectedValue(new Error("upstream 500"));
    const store = new CatalogPriceStore(dir, fetchCatalog);

    await store.get("sv1");
    vi.setSystemTime(Date.now() + CATALOG_PRICE_TTL_MS + 1);
    expect(await store.get("sv1")).toEqual({ "sv1-1|holofoil": 12.5 });
  });

  it("serves the stale copy to every caller of a coalesced fetch that fails", async () => {
    // The caller that joins a run already in flight must get the same fallback
    // as the one that started it. It used to get the rejection instead, and the
    // route dropped the set into `missing` while a usable entry sat in memory.
    writeFileSync(
      join(dir, "sv1.json"),
      JSON.stringify({
        at: Date.now() - CATALOG_PRICE_TTL_MS - 1,
        v: CATALOG_PRICE_CACHE_VERSION,
        prices: { "sv1-1|holofoil": 12.5 },
      }),
    );
    const fetchCatalog = vi.fn(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("upstream 500")), 0)),
    );
    const store = new CatalogPriceStore(dir, fetchCatalog);

    const results = await Promise.allSettled([store.get("sv1"), store.get("sv1")]);

    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: "fulfilled", value: { "sv1-1|holofoil": 12.5 } },
      { status: "fulfilled", value: { "sv1-1|holofoil": 12.5 } },
    ]);
  });

  it("prices every page of a set larger than 250 cards", async () => {
    // Measured live: Paldea Evolved (sv2) has 279 cards and page 2 holds 29 of
    // them, its secret rares among them. One page priced the set from 250.
    const page1 = Array.from({ length: 250 }, (_, i) => card(`sv2-${i + 1}`, { holofoil: { market: 1 } }));
    const page2 = [
      card("sv2-277", { holofoil: { market: 40 } }),
      card("sv2-278", { holofoil: { market: 50 } }),
      card("sv2-279", { holofoil: { market: 60 } }),
    ];
    const fetchCatalog = vi.fn((path: string) =>
      Promise.resolve({ data: path.includes("&page=1&") ? page1 : path.includes("&page=2&") ? page2 : [] }),
    );
    const store = new CatalogPriceStore(dir, fetchCatalog);

    const prices = await store.get("sv2");

    expect(fetchCatalog.mock.calls.map(([path]) => path)).toEqual([
      pricesPath("sv2", 1),
      pricesPath("sv2", 2),
    ]);
    expect(Object.keys(prices)).toHaveLength(253);
    expect(prices["sv2-1|holofoil"]).toBe(1);
    expect(prices["sv2-279|holofoil"]).toBe(60);
  });

  it("never persists a set priced from only some of its pages", async () => {
    // A page-1-only index written to disk would recreate the truncation for
    // twelve hours. A failed page fails the set, and the stale copy stands.
    const stale = {
      at: Date.now() - CATALOG_PRICE_TTL_MS - 1,
      v: CATALOG_PRICE_CACHE_VERSION,
      prices: { "sv2-279|holofoil": 55 },
    };
    writeFileSync(join(dir, "sv2.json"), JSON.stringify(stale));
    const page1 = Array.from({ length: 250 }, (_, i) => card(`sv2-${i + 1}`, { holofoil: { market: 1 } }));
    const fetchCatalog = vi.fn((path: string) =>
      path.includes("&page=1&")
        ? Promise.resolve({ data: page1 })
        : Promise.reject(new Error("upstream 500")),
    );
    const store = new CatalogPriceStore(dir, fetchCatalog);

    expect(await store.get("sv2")).toEqual(stale.prices);
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(join(dir, "sv2.json"), "utf8"))).toEqual(stale);
  });

  it("throws when it has never had an answer to give", async () => {
    const store = new CatalogPriceStore(dir, vi.fn().mockRejectedValue(new Error("upstream 500")));
    await expect(store.get("sv1")).rejects.toThrow("upstream 500");
  });

  it("does not persist an empty index", async () => {
    // pokemontcg.io prices none of several modern sets (0/120 Pitch Black), so
    // empty is a legitimate answer — but it is indistinguishable from a
    // response that arrived malformed, and caching that for twelve hours would
    // strand a set that is simply having a bad minute.
    const store = new CatalogPriceStore(dir, vi.fn().mockResolvedValue({ data: [] }));
    expect(await store.get("me5")).toEqual({});
    expect(readdirSync(dir)).toEqual([]);
  });

  it("remembers an empty answer in memory instead of re-asking upstream on every visit", async () => {
    // Pitch Black prices 0/120 at pokemontcg.io. Home awaits every set, so a
    // set re-fetched on each request held the whole response to an upstream
    // run while every priced set answered from cache.
    const fetchCatalog = vi.fn().mockResolvedValue({ data: [card("me5-1", { holofoil: { market: null } })] });
    const store = new CatalogPriceStore(dir, fetchCatalog);

    expect(await store.get("me5")).toEqual({});
    expect(await store.get("me5")).toEqual({});
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    // Still never on disk: a malformed answer must not strand a set past a restart.
    expect(readdirSync(dir)).toEqual([]);
  });

  it("asks again once the empty answer is an hour old, and keeps prices that appear", async () => {
    vi.useFakeTimers();
    const fetchCatalog = vi
      .fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [card("me5-1", { holofoil: { market: 3 } })] });
    const store = new CatalogPriceStore(dir, fetchCatalog);

    await store.get("me5");
    vi.setSystemTime(Date.now() + CATALOG_PRICE_EMPTY_TTL_MS - 1);
    expect(await store.get("me5")).toEqual({});
    expect(fetchCatalog).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2);
    expect(await store.get("me5")).toEqual({ "me5-1|holofoil": 3 });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(readdirSync(dir)).toEqual(["me5.json"]);
  });

  it("holds an empty answer for far less than the twelve-hour price cache", () => {
    expect(CATALOG_PRICE_EMPTY_TTL_MS).toBeGreaterThan(0);
    expect(CATALOG_PRICE_EMPTY_TTL_MS).toBeLessThanOrEqual(CATALOG_PRICE_TTL_MS / 4);
  });

  it("does not remember a failure as an empty answer", async () => {
    // Empty is an answer; a failed fetch is not. Remembering it as `{}` would
    // turn an outage into an hour of "nothing priced" instead of `missing`.
    const fetchCatalog = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream 500"))
      .mockResolvedValueOnce({ data: [card("sv1-1", { holofoil: { market: 2 } })] });
    const store = new CatalogPriceStore(dir, fetchCatalog);

    await expect(store.get("sv1")).rejects.toThrow("upstream 500");
    expect(await store.get("sv1")).toEqual({ "sv1-1|holofoil": 2 });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it("forgets empty answers on restart", async () => {
    const fetchCatalog = vi.fn().mockResolvedValue({ data: [] });
    await new CatalogPriceStore(dir, fetchCatalog).get("me5");
    await new CatalogPriceStore(dir, fetchCatalog).get("me5");
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it("ignores a cache entry written by an older version", async () => {
    // The TTL cannot retire a bad shape on its own: entries live half a day and
    // are treated as fresh the whole time.
    writeFileSync(
      join(dir, "sv1.json"),
      JSON.stringify({ at: Date.now(), v: CATALOG_PRICE_CACHE_VERSION - 1, prices: { stale: 1 } }),
    );
    const fetchCatalog = vi.fn().mockResolvedValue({ data: [card("sv1-1", { holofoil: { market: 2 } })] });

    expect(await new CatalogPriceStore(dir, fetchCatalog).get("sv1")).toEqual({ "sv1-1|holofoil": 2 });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("refuses to let a set id choose a path", async () => {
    const store = new CatalogPriceStore(
      dir,
      vi.fn().mockResolvedValue({ data: [card("x-1", { holofoil: { market: 1 } })] }),
    );
    await store.get("../../escape");
    expect(readdirSync(dir)).toEqual(["....escape.json"]);
  });
});
