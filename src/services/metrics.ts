import type { ScreenName } from "../app/navigation.ts";
import { utcDay, type MetricEvent } from "../models/metricsEvents.ts";
import { apiBaseUrl } from "./sync/http.ts";

/**
 * Usage metrics on the device: counters in memory, flushed as daily aggregates.
 *
 * The rules, all of them load-bearing:
 *
 * - **Counts only.** `track` takes a name from the shared vocabulary
 *   (`models/metricsEvents.ts`) and nothing else — there is no argument through
 *   which a card id, set id or any collection content could travel.
 * - **Never in the way.** Every path here swallows its own failures. A metric
 *   must never cause an error, a toast, a status line, a console warning or a
 *   wait: the app worked before this file existed and must work identically if
 *   the endpoint is down, missing, or refusing.
 * - **Bytes, not a log.** The localStorage budget has been exhausted here once,
 *   so the only thing persisted is the pending counter blob — a few hundred
 *   bytes, hard-capped at `MAX_BLOB_CHARS` — so counts survive a reload until
 *   the next flush. It is never an event list.
 * - **No token, no metrics.** A device that does not sync sends nothing, and
 *   keeps nothing either: its counts are dropped at the first flush.
 */

export type DayCounts = Partial<Record<MetricEvent, number>>;
type Pending = Record<string, DayCounts>;

/** Quiet period after the last count before a flush. Batches a scan burst into one request. */
export const FLUSH_DELAY_MS = 15_000;
/** And the most a busy session waits, so a long scanning run still reports. */
export const FLUSH_MAX_WAIT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Days kept on the device. The server ignores anything older than seven. */
const KEEP_DAYS = 7;
export const MAX_BLOB_CHARS = 3_000;
export const METRICS_STORAGE_KEY = "cardlens:v1:metrics";

interface Config {
  getToken: () => string;
  base: string;
  fetch: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now: () => number;
}

let config: Config | null = null;
let pending: Pending = {};
let firstUnsentAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
/** The server refused us in a way that will not change this session (401, 503, 404). */
let halted = false;
let listening = false;

function addInto(into: Pending, from: Pending): void {
  for (const [day, counts] of Object.entries(from)) {
    const bucket = (into[day] ??= {});
    for (const [name, n] of Object.entries(counts) as [MetricEvent, number][]) {
      bucket[name] = (bucket[name] ?? 0) + n;
    }
  }
}

function isEmpty(p: Pending): boolean {
  return Object.keys(p).length === 0;
}

/** Drop days the server would ignore, then the oldest until the blob fits. */
function trimmed(p: Pending, now: number): Pending {
  const oldest = utcDay(now - (KEEP_DAYS - 1) * 86_400_000);
  const days = Object.keys(p)
    .filter((d) => d >= oldest)
    .sort();
  let out: Pending = Object.fromEntries(days.map((d) => [d, p[d]]));
  while (days.length > 1 && JSON.stringify(out).length > MAX_BLOB_CHARS) {
    days.shift();
    out = Object.fromEntries(days.map((d) => [d, p[d]]));
  }
  return JSON.stringify(out).length > MAX_BLOB_CHARS ? {} : out;
}

function persist(): void {
  try {
    if (!config?.storage) return;
    pending = trimmed(pending, config.now());
    if (isEmpty(pending)) config.storage.removeItem(METRICS_STORAGE_KEY);
    else config.storage.setItem(METRICS_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Storage full or blocked. The counts are still in memory; nothing to say.
  }
}

function restore(): void {
  try {
    const raw = config?.storage?.getItem(METRICS_STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    const clean: Pending = {};
    for (const [day, counts] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof counts !== "object" || counts === null) continue;
      for (const [name, n] of Object.entries(counts as Record<string, unknown>)) {
        if (typeof n === "number" && Number.isInteger(n) && n > 0)
          (clean[day] ??= {})[name as MetricEvent] = n;
      }
    }
    addInto(pending, clean);
  } catch {
    // A corrupt blob is just lost history.
  }
}

function schedule(): void {
  if (!config || halted) return;
  const now = config.now();
  if (!firstUnsentAt) firstUnsentAt = now;
  const wait = Math.max(0, Math.min(FLUSH_DELAY_MS, firstUnsentAt + FLUSH_MAX_WAIT_MS - now));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushMetrics();
  }, wait);
}

/** Count one occurrence (or `n`) of an event. Synchronous, cheap, never throws. */
export function track(event: MetricEvent, n = 1): void {
  try {
    if (!Number.isInteger(n) || n <= 0) return;
    const day = utcDay(config ? config.now() : Date.now());
    const bucket = (pending[day] ??= {});
    bucket[event] = (bucket[event] ?? 0) + n;
    schedule();
  } catch {
    // Never.
  }
}

/**
 * One screen view. Typed against the router's `ScreenName`, so a screen added
 * to the app without a matching name in the shared vocabulary fails to compile
 * rather than being counted under a name the server would refuse.
 */
export function trackScreen(name: ScreenName): void {
  // Not counted yet: a new event name needs a server deploy (the shared vocabulary
  // is a server file), which this preview-only screen does not justify.
  if (name === "addmany") return;
  track(`screen.${name}`);
}

/**
 * Send what has been counted. Resolves whatever happens; never rejects.
 *
 * `keepalive` is for page hide: the request is allowed to outlive the page.
 * sendBeacon would be the usual tool, but it cannot carry the bearer token.
 */
export async function flushMetrics(opts: { keepalive?: boolean } = {}): Promise<void> {
  try {
    if (!config || inFlight) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const token = config.getToken();
    if (!token) {
      // No token: this device does not report, and does not hoard either.
      pending = {};
      firstUnsentAt = 0;
      persist();
      return;
    }
    if (halted || isEmpty(pending)) {
      persist();
      return;
    }

    const batch = trimmed(pending, config.now());
    pending = {};
    firstUnsentAt = 0;
    if (isEmpty(batch)) {
      persist();
      return;
    }
    inFlight = true;

    let status = 0;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const abort = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const res = await config.fetch(`${config.base}/metrics`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ days: batch }),
        keepalive: Boolean(opts.keepalive),
        ...(controller ? { signal: controller.signal } : {}),
      });
      status = res.status;
    } catch {
      status = 0;
    } finally {
      if (abort) clearTimeout(abort);
      inFlight = false;
    }

    if (status >= 200 && status < 300) {
      // Sent. Anything counted meanwhile is still pending and still scheduled.
    } else if (status === 400 || status === 413) {
      // The server will never take this batch. Holding it would retry forever.
    } else {
      // Offline, rate-limited, server error — or refused for the session
      // (bad token, sync disabled, an older server with no route). Keep the
      // counts, capped, so they arrive once whatever it was is fixed.
      addInto(pending, batch);
      if (status === 401 || status === 503 || status === 404) halted = true;
    }
    persist();
    if (!isEmpty(pending) && !halted) schedule();
  } catch {
    inFlight = false;
  }
}

/**
 * Wire the module to this app: where to send, and how to read the token.
 *
 * Until this is called nothing is sent, and counts only accumulate in memory —
 * which is what keeps every component test that happens to pass through a
 * tracked code path free of timers and network.
 */
export function configureMetrics(opts: {
  getToken: () => string;
  base?: string;
  fetch?: typeof fetch;
  storage?: Config["storage"];
  now?: () => number;
}): void {
  try {
    const storage =
      opts.storage !== undefined ? opts.storage : typeof localStorage === "undefined" ? null : localStorage;
    config = {
      getToken: opts.getToken,
      base: opts.base ?? apiBaseUrl(),
      fetch: opts.fetch ?? ((...args) => fetch(...args)),
      storage,
      now: opts.now ?? Date.now,
    };
    restore();
    if (!isEmpty(pending)) schedule();

    if (!listening && typeof window !== "undefined" && typeof document !== "undefined") {
      listening = true;
      // The app is closed by swiping it away far more often than by navigating;
      // hidden is the last moment that reliably runs.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void flushMetrics({ keepalive: true });
      });
      window.addEventListener("pagehide", () => void flushMetrics({ keepalive: true }));
    }
  } catch {
    config = null;
  }
}

/** Test-only: what is counted and not yet sent. */
export function pendingMetrics(): Pending {
  return JSON.parse(JSON.stringify(pending)) as Pending;
}

/** Test-only: back to a fresh module. */
export function resetMetricsForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  config = null;
  pending = {};
  firstUnsentAt = 0;
  inFlight = false;
  halted = false;
}
