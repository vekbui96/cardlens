import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OwnedPrinting } from "../src/storage/printings.ts";
import {
  MAX_ROWS,
  ValueHistoryJob,
  ValueHistoryStore,
  localDay,
  parseValueHistory,
  parseValueRow,
  upsertRow,
  valueHistoryRouter,
  valueSyncedCollection,
  type ValuationSources,
  type ValueRow,
} from "./valueHistory.ts";

// Scratch paths only: never D:\services\data.
let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-value-history-"));
  file = join(dir, "value-history.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 22, 9, 30).getTime();

function row(over: Partial<ValueRow> = {}): ValueRow {
  return {
    day: "2026-11-22",
    total: 123.45,
    priced: 90,
    printings: 100,
    cards: 80,
    currency: "USD",
    at: NOW,
    ...over,
  };
}

describe("parseValueRow", () => {
  it("round-trips a row and drops unknown fields", () => {
    expect(parseValueRow(JSON.parse(JSON.stringify({ ...row(), extra: 1 })))).toEqual(row());
  });

  it.each([
    ["a bad day", { day: "22/11/2026" }],
    ["an impossible day", { day: "2026-13-45" }],
    ["a negative total", { total: -1 }],
    ["a string count", { priced: "90" }],
    ["fractional printings", { printings: 10.5 }],
    ["priced above printings", { priced: 101 }],
    ["no currency", { currency: "" }],
    ["NaN at", { at: Number.NaN }],
  ])("rejects %s", (_n, over) => {
    expect(parseValueRow({ ...row(), ...over })).toBeNull();
  });
});

describe("upsertRow", () => {
  it("adds a new day in date order", () => {
    const { rows, changed } = upsertRow([row({ day: "2026-11-23" })], row());
    expect(changed).toBe(true);
    expect(rows.map((r) => r.day)).toEqual(["2026-11-22", "2026-11-23"]);
  });

  it("replaces the same day only with better coverage", () => {
    const base = [row({ priced: 50 })];
    expect(upsertRow(base, row({ priced: 40 })).changed).toBe(false);
    expect(upsertRow(base, row({ priced: 50, total: 999 })).changed).toBe(false);
    const better = upsertRow(base, row({ priced: 60, total: 200 }));
    expect(better.changed).toBe(true);
    expect(better.rows).toEqual([row({ priced: 60, total: 200 })]);
  });

  it("caps at MAX_ROWS, dropping the oldest", () => {
    const start = Date.UTC(2010, 0, 1);
    const rows = Array.from({ length: MAX_ROWS }, (_, i) =>
      row({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10) }),
    );
    const { rows: next } = upsertRow(rows, row({ day: "2030-01-01" }));
    expect(next).toHaveLength(MAX_ROWS);
    expect(next[0]?.day).toBe("2010-01-02");
    expect(next.at(-1)?.day).toBe("2030-01-01");
  });
});

describe("parseValueHistory", () => {
  it("refuses an unknown version", () => {
    expect(parseValueHistory({ version: 2, rows: [] }).ok).toBe(false);
    expect(parseValueHistory({ rows: [] }).ok).toBe(false);
    expect(parseValueHistory([]).ok).toBe(false);
  });

  it("keeps good rows, drops bad ones and duplicate days (best coverage wins)", () => {
    const parsed = parseValueHistory({
      version: 1,
      rows: [row({ priced: 10 }), { junk: true }, row({ priced: 20 }), row({ day: "2026-11-21" })],
    });
    expect(parsed.ok && parsed.file.rows).toEqual([row({ day: "2026-11-21" }), row({ priced: 20 })]);
    expect(parsed.ok && parsed.dropped).toBe(2);
  });
});

describe("ValueHistoryStore", () => {
  it("starts empty without creating a file, and persists a versioned file on record", () => {
    const store = new ValueHistoryStore(file);
    expect(store.all()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(store.record(row())).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, rows: [row()] });
    expect(existsSync(`${file}.tmp`)).toBe(false);
    expect(new ValueHistoryStore(file).all()).toEqual([row()]);
  });

  it("does not write when the row is malformed or not better", () => {
    const store = new ValueHistoryStore(file);
    store.record(row());
    const before = readFileSync(file, "utf8");
    expect(store.record({ ...row(), priced: -1 })).toBe(false);
    expect(store.record(row({ priced: 10 }))).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it.each([
    ["a future version", JSON.stringify({ version: 2, rows: [] })],
    ["corrupt JSON", "{not json"],
  ])("never overwrites %s", (_n, contents) => {
    writeFileSync(file, contents);
    const store = new ValueHistoryStore(file);
    expect(store.readOnlyReason).not.toBeNull();
    expect(store.record(row())).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(contents);
  });
});

function owned(cardId: string, finish: string, over: Partial<OwnedPrinting> = {}): OwnedPrinting {
  return {
    cardId,
    setId: cardId.slice(0, cardId.lastIndexOf("-")),
    finish,
    at: NOW - 1000,
    ...over,
  } as OwnedPrinting;
}

const sources: ValuationSources = {
  async printings(setId) {
    if (setId === "sv3") {
      return {
        "1": [{ type: "normal", price: 2 }],
        "2": [
          { type: "normal", price: 1 },
          { type: "reverse", price: 3 },
        ],
      } as never;
    }
    return null;
  },
  async catalogPrices(setId): Promise<Record<string, number> | null> {
    if (setId === "smp") return { "smp-SM210|holofoil": 169.02 };
    if (setId === "sv3") return {};
    throw new Error("upstream");
  },
};

describe("valueSyncedCollection", () => {
  it("values live rows by Home's rule: TCGdex first, catalog second; tombstones and exclusions skipped", async () => {
    const rows = [
      owned("sv3-1", "normal"),
      owned("sv3-2", "normal"),
      owned("sv3-2", "reverse"),
      owned("sv3-3", "normal"), // no price anywhere
      owned("smp-SM210", "holo"), // catalog only
      owned("sv3-1", "reverse", { deletedAt: NOW }), // tombstone
      owned("sv3-2", "holo", { excluded: true }), // excluded
      owned("xx-1", "normal"), // both sources fail
    ];
    const { row: r, failedSets } = await valueSyncedCollection(rows, sources, NOW);
    expect(r).toEqual({
      day: localDay(NOW),
      total: 175.02,
      priced: 4,
      printings: 6,
      cards: 5,
      currency: "USD",
      at: NOW,
    });
    expect(failedSets).toBe(2); // smp has no printings, xx has neither
  });
});

describe("ValueHistoryJob", () => {
  it("records once a day when every source answered, and retries a partial day", async () => {
    const store = new ValueHistoryStore(file);
    let now = NOW;
    let rows = [owned("sv3-1", "normal")];
    const job = new ValueHistoryJob(
      store,
      () => rows,
      sources,
      () => now,
    );

    expect(await job.tick()).toBe("recorded");
    expect(await job.tick()).toBe("skipped"); // day finished

    now += 86_400_000;
    rows = [owned("sv3-1", "normal"), owned("xx-1", "normal")];
    expect(await job.tick()).toBe("recorded"); // partial: xx failed
    expect(await job.tick()).toBe("unchanged"); // retried, no better coverage
    expect(store.all().map((r) => r.day)).toEqual([localDay(NOW), localDay(now)]);
  });

  it("records nothing for an empty collection", async () => {
    const store = new ValueHistoryStore(file);
    const job = new ValueHistoryJob(
      store,
      () => [],
      sources,
      () => NOW,
    );
    expect(await job.tick()).toBe("empty");
    expect(existsSync(file)).toBe(false);
  });
});

describe("GET /api/value-history", () => {
  let server: Server;
  let base: string;
  const auth: RequestHandler = (req, res, next) =>
    req.get("authorization") === "Bearer t" ? next() : void res.status(401).json({ error: "unauthorized" });
  const pass: RequestHandler = (_q, _s, next) => next();

  beforeEach(async () => {
    const store = new ValueHistoryStore(file);
    store.record(row());
    const app = express();
    app.use(valueHistoryRouter(store, { auth, limiter: pass }));
    server = await new Promise<Server>((ok) => {
      const s = app.listen(0, () => ok(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((ok) => server.close(() => ok())));

  it("requires the token", async () => {
    expect((await fetch(`${base}/api/value-history`)).status).toBe(401);
  });

  it("returns the versioned file, uncached", async () => {
    const res = await fetch(`${base}/api/value-history`, { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ version: 1, rows: [row()] });
  });

  it("is read-only", async () => {
    const res = await fetch(`${base}/api/value-history`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ version: 1, rows: [] }),
    });
    expect(res.status).toBe(404);
  });
});
