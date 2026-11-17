import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG_SETS_MAX_FILES, CATALOG_SETS_TTL_MS, CatalogSetsStore } from "./catalogSetsStore.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-catalog-sets-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

/** The query the device actually sends (PokemonTcgIoProvider.listSets). */
const PATH = "/sets?orderBy=-releaseDate&pageSize=250&select=id%2Cname%2Cseries";
const LIST = { data: [{ id: "sv3", name: "Obsidian Flames" }], totalCount: 1 };

function upstreamDown(): Promise<unknown> {
  return Promise.reject(new Error("pokemontcg.io 503"));
}

describe("CatalogSetsStore", () => {
  it("serves the last good list after a restart when upstream is failing", async () => {
    // The 60-second memory cache this replaces died with the process, so the
    // first request after every deploy had no fallback at all.
    await new CatalogSetsStore(dir, () => Promise.resolve(LIST)).get(PATH);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CATALOG_SETS_TTL_MS + 60_000);
    const restarted = new CatalogSetsStore(dir, upstreamDown);
    await expect(restarted.get(PATH)).resolves.toEqual(LIST);
  });

  it("does not ask upstream again within 24 hours, even after a restart", async () => {
    await new CatalogSetsStore(dir, () => Promise.resolve(LIST)).get(PATH);

    const fetchCatalog = vi.fn(() => Promise.resolve(LIST));
    const restarted = new CatalogSetsStore(dir, fetchCatalog);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CATALOG_SETS_TTL_MS - 60_000);
    await expect(restarted.get(PATH)).resolves.toEqual(LIST);
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it("refreshes a list older than 24 hours", async () => {
    await new CatalogSetsStore(dir, () => Promise.resolve(LIST)).get(PATH);

    const newer = { data: [...LIST.data, { id: "sv4", name: "Paradox Rift" }], totalCount: 2 };
    const fetchCatalog = vi.fn(() => Promise.resolve(newer));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CATALOG_SETS_TTL_MS + 60_000);
    await expect(new CatalogSetsStore(dir, fetchCatalog).get(PATH)).resolves.toEqual(newer);
    expect(fetchCatalog).toHaveBeenCalledWith(PATH);
  });

  it("never persists an empty or malformed list", async () => {
    // Indistinguishable from a broken response; caching it would blank the set
    // list for a day.
    for (const body of [{ data: [] }, { error: "nope" }, null, "oops"]) {
      await new CatalogSetsStore(dir, () => Promise.resolve(body)).get(PATH);
    }
    expect(readdirSync(dir)).toEqual([]);
    await expect(new CatalogSetsStore(dir, upstreamDown).get(PATH)).rejects.toThrow("503");
  });

  it("throws when upstream fails and nothing was ever stored", async () => {
    await expect(new CatalogSetsStore(dir, upstreamDown).get(PATH)).rejects.toThrow("503");
  });

  it("shares one upstream fetch between concurrent callers", async () => {
    const fetchCatalog = vi.fn(() => Promise.resolve(LIST));
    const store = new CatalogSetsStore(dir, fetchCatalog);
    const results = await Promise.all([store.get(PATH), store.get(PATH), store.get(PATH)]);
    expect(results).toEqual([LIST, LIST, LIST]);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("keeps each query to its own entry", async () => {
    const other = "/sets?orderBy=releaseDate&pageSize=1";
    const store = new CatalogSetsStore(dir, (path) =>
      Promise.resolve(path === PATH ? LIST : { data: [{ id: "base1", name: "Base" }] }),
    );
    await store.get(PATH);
    await store.get(other);

    const restarted = new CatalogSetsStore(dir, upstreamDown);
    await expect(restarted.get(PATH)).resolves.toEqual(LIST);
    await expect(restarted.get(other)).resolves.toEqual({ data: [{ id: "base1", name: "Base" }] });
    // File names come from a hash, never from the request.
    for (const name of readdirSync(dir)) expect(name).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it("stops writing new files past the cap, and still answers from memory", async () => {
    const store = new CatalogSetsStore(dir, () => Promise.resolve(LIST));
    for (let i = 0; i < CATALOG_SETS_MAX_FILES + 5; i++) {
      await expect(store.get(`/sets?pageSize=${i}`)).resolves.toEqual(LIST);
    }
    expect(readdirSync(dir)).toHaveLength(CATALOG_SETS_MAX_FILES);
  });
});
