import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_COUNT,
  MAX_DAYS_PER_REQUEST,
  MetricsStore,
  RETENTION_DAYS,
  metricsRouter,
  parseMetricsBatch,
  summarize,
  summaryDays,
} from "./metricsStore.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const DAY = 86_400_000;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-metrics-"));
  file = join(dir, "metrics.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parseMetricsBatch", () => {
  it("keeps known events with positive integer counts", () => {
    const parsed = parseMetricsBatch(
      { days: { "2026-11-17": { "scan.accepted": 3, "screen.home": 1 } } },
      NOW,
    );
    expect(parsed).toEqual({
      ok: true,
      days: { "2026-11-17": { "scan.accepted": 3, "screen.home": 1 } },
      ignored: 0,
    });
  });

  it("never stores an unknown name â€” that is the privacy boundary", () => {
    // A card id smuggled in as an event name must not reach disk.
    const parsed = parseMetricsBatch({ days: { "2026-11-17": { "sv3-125": 1, "scan.accepted": 2 } } }, NOW);
    expect(parsed).toEqual({ ok: true, days: { "2026-11-17": { "scan.accepted": 2 } }, ignored: 1 });
  });

  it.each([
    ["not an object", "nope"],
    ["an array", []],
    ["no days", {}],
    ["days as array", { days: [] }],
    ["a malformed day", { days: { "17-11-2026": { "scan.accepted": 1 } } }],
    ["an impossible date", { days: { "2026-02-31": { "scan.accepted": 1 } } }],
    ["counts as array", { days: { "2026-11-17": [1] } }],
    ["a string count", { days: { "2026-11-17": { "scan.accepted": "3" } } }],
    ["a fractional count", { days: { "2026-11-17": { "scan.accepted": 1.5 } } }],
    ["a negative count", { days: { "2026-11-17": { "scan.accepted": -1 } } }],
    ["a huge count", { days: { "2026-11-17": { "scan.accepted": MAX_COUNT + 1 } } }],
  ])("rejects %s", (_label, body) => {
    expect(parseMetricsBatch(body, NOW).ok).toBe(false);
  });

  it("caps how many days one request may carry", () => {
    const days: Record<string, Record<string, number>> = {};
    for (let i = 0; i <= MAX_DAYS_PER_REQUEST; i++) {
      days[new Date(NOW - i * DAY).toISOString().slice(0, 10)] = { "sync.ok": 1 };
    }
    expect(parseMetricsBatch({ days }, NOW)).toEqual({ ok: false, error: "too_many_days" });
  });

  it("ignores days too old or in the future rather than storing them", () => {
    const parsed = parseMetricsBatch(
      {
        days: {
          "2026-11-01": { "sync.ok": 1 },
          "2026-11-18": { "sync.ok": 2 }, // tomorrow: clock skew, accepted
          "2026-11-25": { "sync.ok": 3 },
        },
      },
      NOW,
    );
    expect(parsed).toEqual({ ok: true, days: { "2026-11-18": { "sync.ok": 2 } }, ignored: 2 });
  });
});

describe("MetricsStore", () => {
  it("adds into daily buckets and survives a restart", () => {
    const store = new MetricsStore(file);
    store.add({ "2026-11-17": { "scan.accepted": 2 } }, NOW);
    store.add({ "2026-11-17": { "scan.accepted": 3, "sync.ok": 1 } }, NOW);
    const reopened = new MetricsStore(file);
    expect(reopened.window(1, NOW).days).toEqual([
      { day: "2026-11-17", counts: { "scan.accepted": 5, "sync.ok": 1 } },
    ]);
  });

  it("prunes buckets older than the retention window on write", () => {
    const store = new MetricsStore(file);
    const old = new Date(NOW - RETENTION_DAYS * DAY).toISOString().slice(0, 10);
    const kept = new Date(NOW - (RETENTION_DAYS - 1) * DAY).toISOString().slice(0, 10);
    store.add({ [old]: { "sync.ok": 1 }, [kept]: { "sync.ok": 1 } }, NOW);
    const saved = JSON.parse(readFileSync(file, "utf8")) as { days: Record<string, unknown> };
    expect(Object.keys(saved.days)).toEqual([kept]);
  });

  it("starts empty from a corrupt file instead of throwing", () => {
    writeFileSync(file, "{not json");
    expect(new MetricsStore(file).window(30, NOW).days).toEqual([]);
  });

  it("drops unknown names found in the file", () => {
    writeFileSync(file, JSON.stringify({ days: { "2026-11-17": { "scan.accepted": 1, bogus: 9 } } }));
    expect(new MetricsStore(file).window(1, NOW).days[0]?.counts).toEqual({ "scan.accepted": 1 });
  });
});

describe("summarize", () => {
  it("derives the PRODUCT.md rates from the counts", () => {
    const store = new MetricsStore(file);
    store.add(
      {
        "2026-11-16": {
          "scan.accepted": 8,
          "scan.ambiguous": 1,
          "scan.unknown": 1,
          "scan.via.server": 9,
          "scan.via.device": 1,
          "scan.batch": 2,
          "scan.batch.cards": 10,
          "scan.manual_pick": 3,
          "scan.corrected": 1,
          "sync.ok": 3,
          "sync.fail.offline": 1,
          "sync.dropped_rows": 2,
          "screen.home": 3,
          "screen.scan": 1,
          "layout.web": 1,
          "home.load": 2,
          "home.priced": 900,
          "home.printings": 1000,
        },
      },
      NOW,
    );
    const s = summarize(store.window(30, NOW), 30, NOW);
    expect(s.from).toBe("2026-10-19");
    expect(s.to).toBe("2026-11-17");
    expect(s.activeDays).toBe(1);
    expect(s.rates).toEqual({
      scanAutoAcceptRate: 0.8,
      scanServerShare: 0.9,
      manualPicksPerBatch: 1.5,
      avgBatchSize: 5,
      scanCorrectionRate: 0.1,
      syncFailureRate: 0.25,
      syncRuns: 4,
      syncDroppedRows: 2,
      syncDroppedBinders: 0,
      homePriceCoverage: 0.9,
      screenViews: 4,
      screenViewShares: { home: 0.75, scan: 0.25 },
      layoutShares: { web: 1 },
    });
  });

  it("says null, never zero, when a rate has no denominator", () => {
    const s = summarize(new MetricsStore(file).window(7, NOW), 7, NOW);
    expect(s.rates.scanAutoAcceptRate).toBeNull();
    expect(s.rates.syncFailureRate).toBeNull();
    expect(s.rates.homePriceCoverage).toBeNull();
  });

  it("clamps ?days=", () => {
    expect(summaryDays(undefined)).toBe(30);
    expect(summaryDays("abc")).toBe(30);
    expect(summaryDays("0")).toBe(1);
    expect(summaryDays("7")).toBe(7);
    expect(summaryDays("9999")).toBe(RETENTION_DAYS);
  });
});

describe("metricsRouter over HTTP", () => {
  let server: Server;
  let base: string;
  let store: MetricsStore;

  const pass: RequestHandler = (_req, _res, next) => next();
  const auth: RequestHandler = (req, res, next) => {
    if (req.get("authorization") !== "Bearer t0ken") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };

  beforeEach(async () => {
    store = new MetricsStore(file);
    const app = express();
    app.use(express.json({ limit: "4mb" }));
    app.use(metricsRouter(store, { auth, writeLimiter: pass, readLimiter: pass }));
    server = await new Promise<Server>((ok) => {
      const s = app.listen(0, () => ok(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise<void>((ok) => server.close(() => ok())));

  const post = (body: unknown, token = "t0ken") =>
    fetch(`${base}/api/metrics`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  const today = () => new Date().toISOString().slice(0, 10);

  it("refuses a write without the collection token", async () => {
    const res = await post({ days: { [today()]: { "sync.ok": 1 } } }, "wrong");
    expect(res.status).toBe(401);
    expect(existsSync(file)).toBe(false);
  });

  it("stores a valid flush and serves it in the PUBLIC summary", async () => {
    const res = await post({ days: { [today()]: { "scan.accepted": 4, "scan.unknown": 1 } } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: 0 });

    // No authorization header: the loop reads this with a plain GET.
    const summary = await fetch(`${base}/api/metrics/summary?days=7`);
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as { days: number; rates: { scanAutoAcceptRate: number } };
    expect(body.days).toBe(7);
    expect(body.rates.scanAutoAcceptRate).toBe(0.8);
  });

  it("answers 400 to a malformed flush and writes nothing", async () => {
    const res = await post({ days: { [today()]: { "scan.accepted": "lots" } } });
    expect(res.status).toBe(400);
    expect(existsSync(file)).toBe(false);
  });

  it("answers 413 to an oversized body", async () => {
    const padding = "x".repeat(20_000);
    const res = await post({ days: {}, padding });
    expect(res.status).toBe(413);
  });
});
