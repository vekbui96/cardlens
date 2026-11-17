import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { Router, type RequestHandler } from "express";
import { isMetricEvent, utcDay, type MetricEvent } from "../src/models/metricsEvents.ts";

/**
 * Usage metrics: daily aggregate counts, and nothing else.
 *
 * Exists so product decisions can rest on how the app is really used — scan
 * auto-accept rate, manual picks per batch, sync failures, which screens get
 * opened — figures that until now stayed on each device and were unmeasurable.
 *
 * **What is stored is a count per known event name per UTC day.** No card or
 * set id, no collection contents, no IP, no user agent, no device id — the
 * request is reduced to `{ day: { event: n } }` before anything touches disk,
 * and an event name the vocabulary does not list is never stored. Its own file,
 * never collection.json / binders.json / shares.json: losing or deleting it
 * costs nothing but history.
 */

/** Days of history kept. Matches the tombstone horizon; older buckets are pruned on every write. */
export const RETENTION_DAYS = 180;
/** A device holding counts from longer ago than this sends them, and they are ignored. */
export const MAX_BACKDATE_DAYS = 7;
/** Bounds one request: a device batches a few days at most, a few dozen names a day. */
export const MAX_DAYS_PER_REQUEST = 8;
export const MAX_EVENTS_PER_DAY = 120;
/** Per event per day per request. Far above anything real (a scan burst is ~85/min). */
export const MAX_COUNT = 100_000;
/** Bytes. The real payload is a few hundred; the global JSON limit is 4MB for sync. */
export const MAX_BODY_BYTES = 16 * 1024;

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DayCounts = Partial<Record<MetricEvent, number>>;
export type MetricsDays = Record<string, DayCounts>;

export type ParsedBatch = { ok: true; days: MetricsDays; ignored: number } | { ok: false; error: string };

function isDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && utcDay(t) === value;
}

/**
 * Validate one device's flush.
 *
 * Structure is strict — anything that is not `{ days: { "YYYY-MM-DD": { name:
 * positive integer } } }` within the caps is a 400. Unknown event NAMES are
 * counted in `ignored` and not stored, rather than failing the request: Pages
 * and this server deploy separately, and a newer client naming an event this
 * server does not know yet must not lose every other count it carried. Days
 * too old or in the future are ignored the same way.
 */
export function parseMetricsBatch(body: unknown, now = Date.now()): ParsedBatch {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { ok: false, error: "invalid_body" };
  const raw = (body as { days?: unknown }).days;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { ok: false, error: "invalid_days" };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_DAYS_PER_REQUEST) return { ok: false, error: "too_many_days" };

  const tomorrow = utcDay(now + DAY_MS);
  const oldest = utcDay(now - MAX_BACKDATE_DAYS * DAY_MS);

  const days: MetricsDays = {};
  let ignored = 0;
  for (const [day, counts] of entries) {
    if (!isDay(day)) return { ok: false, error: "invalid_day" };
    if (typeof counts !== "object" || counts === null || Array.isArray(counts)) {
      return { ok: false, error: "invalid_counts" };
    }
    const pairs = Object.entries(counts as Record<string, unknown>);
    if (pairs.length > MAX_EVENTS_PER_DAY) return { ok: false, error: "too_many_events" };
    // Clock skew of a day either way is tolerated; beyond that it is ignored.
    const inWindow = day >= oldest && day <= tomorrow;
    const bucket: DayCounts = {};
    for (const [name, n] of pairs) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
        return { ok: false, error: "invalid_count" };
      }
      if (n === 0) continue;
      if (!inWindow || !isMetricEvent(name)) {
        ignored += 1;
        continue;
      }
      bucket[name] = n;
    }
    if (Object.keys(bucket).length > 0) days[day] = bucket;
  }
  return { ok: true, days, ignored };
}

/** Add `b` into `a`, in place. */
function addInto(a: DayCounts, b: DayCounts): void {
  for (const [name, n] of Object.entries(b) as [MetricEvent, number][]) a[name] = (a[name] ?? 0) + n;
}

export class MetricsStore {
  private days: MetricsDays = {};

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { days?: unknown };
      const days = parsed?.days;
      if (typeof days !== "object" || days === null) return;
      for (const [day, counts] of Object.entries(days as Record<string, unknown>)) {
        if (!isDay(day) || typeof counts !== "object" || counts === null) continue;
        const bucket: DayCounts = {};
        for (const [name, n] of Object.entries(counts as Record<string, unknown>)) {
          if (isMetricEvent(name) && typeof n === "number" && Number.isFinite(n) && n > 0) bucket[name] = n;
        }
        this.days[day] = bucket;
      }
    } catch {
      // Metrics are history, not data: an unreadable file starts empty rather
      // than stopping the service that holds the collection.
      console.warn(`[cardlens] metrics file unreadable at ${this.filePath} — starting empty`);
      this.days = {};
    }
  }

  /** Temp → fsync → rename, the same as every other store here. */
  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify({ v: 1, days: this.days }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }

  private prune(now: number): void {
    const cutoff = utcDay(now - (RETENTION_DAYS - 1) * DAY_MS);
    for (const day of Object.keys(this.days)) if (day < cutoff) delete this.days[day];
  }

  add(batch: MetricsDays, now = Date.now()): void {
    for (const [day, counts] of Object.entries(batch)) addInto((this.days[day] ??= {}), counts);
    this.prune(now);
    this.persist();
  }

  /** Buckets for the last `n` UTC days, today included, oldest first. Only days with data. */
  window(
    n: number,
    now = Date.now(),
  ): { from: string; to: string; days: { day: string; counts: DayCounts }[] } {
    const to = utcDay(now);
    const from = utcDay(now - (n - 1) * DAY_MS);
    const days = Object.keys(this.days)
      .filter((d) => d >= from && d <= to)
      .sort()
      .map((day) => ({ day, counts: { ...this.days[day] } }));
    return { from, to, days };
  }
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 10_000) / 10_000 : null;
}

/** Shares of a family of events (`screen.*`, `layout.*`), keyed by the suffix. */
function shares(totals: DayCounts, prefix: string): Record<string, number> {
  const picked = (Object.entries(totals) as [string, number][]).filter(([k]) => k.startsWith(prefix));
  const sum = picked.reduce((s, [, n]) => s + n, 0);
  const out: Record<string, number> = {};
  for (const [k, n] of picked.sort((a, b) => b[1] - a[1])) out[k.slice(prefix.length)] = ratio(n, sum) ?? 0;
  return out;
}

export interface MetricsSummary {
  days: number;
  from: string;
  to: string;
  activeDays: number;
  totals: DayCounts;
  rates: {
    /** scan.accepted / (accepted + ambiguous + unknown). */
    scanAutoAcceptRate: number | null;
    /** Of captures that got an answer, the share the server answered. */
    scanServerShare: number | null;
    /** scan.manual_pick / scan.batch. */
    manualPicksPerBatch: number | null;
    /** scan.batch.cards / scan.batch. */
    avgBatchSize: number | null;
    /** scan.corrected / scan.batch.cards. */
    scanCorrectionRate: number | null;
    /** Failed runs (offline, http, too large, bad token, disabled) over all runs. */
    syncFailureRate: number | null;
    syncRuns: number;
    syncDroppedRows: number;
    syncDroppedBinders: number;
    /** Sum of home.priced / sum of home.printings over every settled Home load. */
    homePriceCoverage: number | null;
    screenViews: number;
    screenViewShares: Record<string, number>;
    layoutShares: Record<string, number>;
  };
  daily: { day: string; counts: DayCounts }[];
  generatedAt: number;
}

export function summarize(
  window: ReturnType<MetricsStore["window"]>,
  n: number,
  now = Date.now(),
): MetricsSummary {
  const totals: DayCounts = {};
  for (const { counts } of window.days) addInto(totals, counts);
  const t = (name: MetricEvent) => totals[name] ?? 0;

  const recognised = t("scan.accepted") + t("scan.ambiguous") + t("scan.unknown");
  const syncFails =
    t("sync.fail.offline") +
    t("sync.fail.http") +
    t("sync.fail.too_large") +
    t("sync.bad_token") +
    t("sync.disabled");
  const syncRuns = t("sync.ok") + syncFails;
  const screenViews = (Object.entries(totals) as [string, number][])
    .filter(([k]) => k.startsWith("screen."))
    .reduce((s, [, v]) => s + v, 0);

  return {
    days: n,
    from: window.from,
    to: window.to,
    activeDays: window.days.length,
    totals,
    rates: {
      scanAutoAcceptRate: ratio(t("scan.accepted"), recognised),
      scanServerShare: ratio(t("scan.via.server"), t("scan.via.server") + t("scan.via.device")),
      manualPicksPerBatch: ratio(t("scan.manual_pick"), t("scan.batch")),
      avgBatchSize: ratio(t("scan.batch.cards"), t("scan.batch")),
      scanCorrectionRate: ratio(t("scan.corrected"), t("scan.batch.cards")),
      syncFailureRate: ratio(syncFails, syncRuns),
      syncRuns,
      syncDroppedRows: t("sync.dropped_rows"),
      syncDroppedBinders: t("sync.dropped_binders"),
      homePriceCoverage: ratio(t("home.priced"), t("home.printings")),
      screenViews,
      screenViewShares: shares(totals, "screen."),
      layoutShares: shares(totals, "layout."),
    },
    daily: window.days,
    generatedAt: now,
  };
}

export const DEFAULT_SUMMARY_DAYS = 30;

/** `?days=` clamped to 1..RETENTION_DAYS; anything unparseable is the default. */
export function summaryDays(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_SUMMARY_DAYS;
  return Math.min(RETENTION_DAYS, Math.max(1, n));
}

/**
 * `POST /api/metrics` and `GET /api/metrics/summary`.
 *
 * The write needs COLLECTION_TOKEN, like sync: only a device that already syncs
 * can contribute, so a stranger on the Funnel cannot fill the file.
 *
 * The summary read is PUBLIC, deliberately. The innovation loop must read it
 * with a plain GET and must never hold the collection token, and a second token
 * would be a new secret for Ve to provision for a page of counts. What it can
 * reveal is the same aggregate a product dashboard would show: how many scans
 * auto-accepted, how often sync failed, which screens are opened — per day, no
 * ids, no contents. It is rate-limited and served as JSON under the
 * service-wide `default-src 'none'` CSP, which is right for it.
 */
export function metricsRouter(
  store: MetricsStore,
  opts: { auth: RequestHandler; writeLimiter: RequestHandler; readLimiter: RequestHandler },
): Router {
  const router = Router();

  router.post("/api/metrics", opts.writeLimiter, opts.auth, (req, res) => {
    const length = Number(req.get("content-length") ?? 0);
    if (length > MAX_BODY_BYTES) {
      res.status(413).json({ error: "too_large", max: MAX_BODY_BYTES });
      return;
    }
    const parsed = parseMetricsBatch(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (Object.keys(parsed.days).length > 0) store.add(parsed.days);
    res.json({ ok: true, ignored: parsed.ignored });
  });

  router.get("/api/metrics/summary", opts.readLimiter, (req, res) => {
    const n = summaryDays(req.query.days);
    res.setHeader("Cache-Control", "no-store");
    res.json(summarize(store.window(n), n));
  });

  return router;
}
