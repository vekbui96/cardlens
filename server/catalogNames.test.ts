import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_NAMES_CACHE_VERSION,
  CATALOG_NAMES_TTL_MS,
  CatalogNameStore,
  indexSetNames,
  namesPath,
} from "./catalogNames.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-catalog-names-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

/** One card as pokemontcg.io reports it, trimmed to what `select` asks for. */
function card(id: string, name = `Card ${id}`, number = id.slice(id.lastIndexOf("-") + 1)) {
  return {
    id,
    name,
    number,
    images: { small: `https://img/${id}.png`, large: `https://img/${id}_hires.png` },
  };
}

describe("indexSetNames", () => {
  it("keys name, number and art by card id", () => {
    expect(indexSetNames({ data: [card("sv1-1", "Sprigatito", "1")] })).toEqual({
      "sv1-1": {
        name: "Sprigatito",
        number: "1",
        image: "https://img/sv1-1.png",
        large: "https://img/sv1-1_hires.png",
      },
    });
  });

  it("keeps the catalog's number rather than the id's tail", () => {
    // Ids and numbers disagree: `zsv10pt5-80` is number 60. The number is what
    // the collector-number backfill writes, so it must be upstream's.
    expect(indexSetNames({ data: [card("zsv10pt5-80", "Kyurem", "60")] })["zsv10pt5-80"]?.number).toBe("60");
  });

  it("omits art it was not given, and skips cards with no id or name", () => {
    const index = indexSetNames({
      data: [
        { id: "sv1-2", name: "Floragato", number: "2" },
        { id: "sv1-3", number: "3" },
        { name: "No id", number: "4" },
      ],
    });
    expect(index).toEqual({ "sv1-2": { name: "Floragato", number: "2" } });
  });

  it("survives a body that is not the shape it expects", () => {
    expect(indexSetNames(null)).toEqual({});
    expect(indexSetNames({ data: "nope" })).toEqual({});
  });
});

describe("namesPath", () => {
  it("asks for names and art alone, not prices or the set object", () => {
    const path = namesPath("sv8pt5");
    expect(path).toContain(`select=${encodeURIComponent("id,name,number,images")}`);
    expect(path).toContain(encodeURIComponent("set.id:sv8pt5"));
    expect(path).not.toContain("tcgplayer");
  });

  it("names the page and a stable order", () => {
    expect(namesPath("sv2")).toContain("&page=1&");
    expect(namesPath("sv2", 2)).toContain("&page=2&");
    expect(namesPath("sv2", 2)).toContain("orderBy=number");
  });
});

describe("CatalogNameStore", () => {
  it("fetches once and serves the rest from cache", async () => {
    const fetchCatalog = vi.fn().mockResolvedValue({ data: [card("sv1-1")] });
    const store = new CatalogNameStore(dir, fetchCatalog);

    expect(Object.keys(await store.get("sv1"))).toEqual(["sv1-1"]);
    expect(Object.keys(await store.get("sv1"))).toEqual(["sv1-1"]);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent asks for one set into a single upstream run", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const fetchCatalog = vi.fn().mockReturnValue(pending);
    const store = new CatalogNameStore(dir, fetchCatalog);

    const all = Promise.all([store.get("sv1"), store.get("sv1"), store.get("sv1")]);
    release({ data: [card("sv1-1")] });
    await all;

    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("survives a restart by reading the copy on disk", async () => {
    await new CatalogNameStore(dir, vi.fn().mockResolvedValue({ data: [card("sv1-1", "Sprigatito")] })).get(
      "sv1",
    );

    const fresh = vi.fn();
    expect((await new CatalogNameStore(dir, fresh).get("sv1"))["sv1-1"]?.name).toBe("Sprigatito");
    expect(fresh).not.toHaveBeenCalled();
  });

  it("refetches once the entry is older than the TTL", async () => {
    vi.useFakeTimers();
    const fetchCatalog = vi
      .fn()
      .mockResolvedValueOnce({ data: [card("sv1-1", "Old")] })
      .mockResolvedValueOnce({ data: [card("sv1-1", "New")] });
    const store = new CatalogNameStore(dir, fetchCatalog);

    await store.get("sv1");
    vi.setSystemTime(Date.now() + CATALOG_NAMES_TTL_MS + 1);
    expect((await store.get("sv1"))["sv1-1"]?.name).toBe("New");
  });

  it("serves a stale copy to every caller when upstream is down", async () => {
    writeFileSync(
      join(dir, "sv1.json"),
      JSON.stringify({
        at: Date.now() - CATALOG_NAMES_TTL_MS - 1,
        v: CATALOG_NAMES_CACHE_VERSION,
        cards: { "sv1-1": { name: "Sprigatito", number: "1" } },
      }),
    );
    const fetchCatalog = vi.fn(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("upstream 500")), 0)),
    );
    const store = new CatalogNameStore(dir, fetchCatalog);

    const results = await Promise.allSettled([store.get("sv1"), store.get("sv1")]);

    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    const stale = { "sv1-1": { name: "Sprigatito", number: "1" } };
    expect(results).toEqual([
      { status: "fulfilled", value: stale },
      { status: "fulfilled", value: stale },
    ]);
  });

  it("names every page of a set larger than 250 cards", async () => {
    // Paldea Evolved (sv2) has 279 cards; page 2 holds its secret rares.
    const page1 = Array.from({ length: 250 }, (_, i) => card(`sv2-${i + 1}`));
    const page2 = [card("sv2-277"), card("sv2-278"), card("sv2-279", "Iono")];
    const fetchCatalog = vi.fn((path: string) =>
      Promise.resolve({ data: path.includes("&page=1&") ? page1 : path.includes("&page=2&") ? page2 : [] }),
    );
    const store = new CatalogNameStore(dir, fetchCatalog);

    const cards = await store.get("sv2");

    expect(fetchCatalog.mock.calls.map(([path]) => path)).toEqual([namesPath("sv2", 1), namesPath("sv2", 2)]);
    expect(Object.keys(cards)).toHaveLength(253);
    expect(cards["sv2-279"]?.name).toBe("Iono");
  });

  it("never persists a set named from only some of its pages", async () => {
    const stale = {
      at: Date.now() - CATALOG_NAMES_TTL_MS - 1,
      v: CATALOG_NAMES_CACHE_VERSION,
      cards: { "sv2-279": { name: "Iono", number: "279" } },
    };
    writeFileSync(join(dir, "sv2.json"), JSON.stringify(stale));
    const page1 = Array.from({ length: 250 }, (_, i) => card(`sv2-${i + 1}`));
    const fetchCatalog = vi.fn((path: string) =>
      path.includes("&page=1&")
        ? Promise.resolve({ data: page1 })
        : Promise.reject(new Error("upstream 500")),
    );
    const store = new CatalogNameStore(dir, fetchCatalog);

    expect(await store.get("sv2")).toEqual(stale.cards);
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(join(dir, "sv2.json"), "utf8"))).toEqual(stale);
  });

  it("throws when it has never had an answer to give", async () => {
    const store = new CatalogNameStore(dir, vi.fn().mockRejectedValue(new Error("upstream 500")));
    await expect(store.get("sv1")).rejects.toThrow("upstream 500");
  });

  it("does not persist an empty index", async () => {
    const store = new CatalogNameStore(dir, vi.fn().mockResolvedValue({ data: [] }));
    expect(await store.get("me5")).toEqual({});
    expect(readdirSync(dir)).toEqual([]);
  });

  it("ignores a cache entry written by an older version", async () => {
    writeFileSync(
      join(dir, "sv1.json"),
      JSON.stringify({ at: Date.now(), v: CATALOG_NAMES_CACHE_VERSION - 1, cards: { stale: {} } }),
    );
    const fetchCatalog = vi.fn().mockResolvedValue({ data: [card("sv1-1")] });

    expect(Object.keys(await new CatalogNameStore(dir, fetchCatalog).get("sv1"))).toEqual(["sv1-1"]);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("refuses to let a set id choose a path", async () => {
    const store = new CatalogNameStore(dir, vi.fn().mockResolvedValue({ data: [card("x-1")] }));
    await store.get("../../escape");
    expect(readdirSync(dir)).toEqual(["....escape.json"]);
  });
});
