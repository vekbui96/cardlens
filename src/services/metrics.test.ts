import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLUSH_DELAY_MS,
  FLUSH_MAX_WAIT_MS,
  MAX_BLOB_CHARS,
  METRICS_STORAGE_KEY,
  configureMetrics,
  flushMetrics,
  pendingMetrics,
  resetMetricsForTests,
  track,
  trackScreen,
} from "./metrics.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const TODAY = "2026-11-17";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function reply(status: number) {
  return vi.fn<typeof fetch>(async () => new Response("{}", { status }));
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetMetricsForTests();
  storage = memoryStorage();
});

afterEach(() => {
  resetMetricsForTests();
  vi.useRealTimers();
});

function configure(fetchImpl: typeof fetch, token = "t0ken") {
  configureMetrics({ getToken: () => token, base: "/api", fetch: fetchImpl, storage, now: () => Date.now() });
}

function sentBody(f: ReturnType<typeof reply>, call = 0): unknown {
  const init = f.mock.calls[call]?.[1] ?? {};
  return JSON.parse(String(init.body));
}

describe("track", () => {
  it("counts in memory, bucketed by UTC day", () => {
    track("scan.accepted");
    track("scan.accepted");
    track("home.priced", 40);
    trackScreen("scan");
    expect(pendingMetrics()).toEqual({
      [TODAY]: { "scan.accepted": 2, "home.priced": 40, "screen.scan": 1 },
    });
  });

  it("ignores non-positive and fractional amounts", () => {
    track("home.priced", 0);
    track("home.priced", -3);
    track("home.priced", 1.5);
    expect(pendingMetrics()).toEqual({});
  });

  it("sends nothing until configured", async () => {
    track("sync.ok");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_WAIT_MS * 2);
    expect(pendingMetrics()).toEqual({ [TODAY]: { "sync.ok": 1 } });
  });
});

describe("flush", () => {
  it("batches a burst into ONE debounced request with aggregate counts and the token", async () => {
    const f = reply(200);
    configure(f);
    for (let i = 0; i < 25; i++) track("scan.accepted");
    track("scan.via.server", 25);

    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS - 1);
    expect(f).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]?.[0]).toBe("/api/metrics");
    const init = f.mock.calls[0]?.[1] ?? {};
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t0ken");
    expect(sentBody(f)).toEqual({ days: { [TODAY]: { "scan.accepted": 25, "scan.via.server": 25 } } });
    expect(pendingMetrics()).toEqual({});
    expect(storage.map.has(METRICS_STORAGE_KEY)).toBe(false);
  });

  it("does not let constant activity postpone a flush forever", async () => {
    const f = reply(200);
    configure(f);
    for (let t = 0; t < FLUSH_MAX_WAIT_MS; t += 5_000) {
      track("screen.home");
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(f).toHaveBeenCalled();
  });

  it("with no token, sends nothing and keeps nothing", async () => {
    const f = reply(200);
    configure(f, "");
    track("scan.accepted");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_WAIT_MS);
    expect(f).not.toHaveBeenCalled();
    expect(pendingMetrics()).toEqual({});
    expect(storage.map.has(METRICS_STORAGE_KEY)).toBe(false);
  });

  it("swallows a network failure, keeps the counts and persists them", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    configure(f);
    track("sync.fail.offline");
    await expect(flushMetrics()).resolves.toBeUndefined();
    expect(pendingMetrics()).toEqual({ [TODAY]: { "sync.fail.offline": 1 } });
    expect(JSON.parse(storage.map.get(METRICS_STORAGE_KEY) ?? "{}")).toEqual({
      [TODAY]: { "sync.fail.offline": 1 },
    });
  });

  it("drops a batch the server says is malformed, rather than retrying it forever", async () => {
    const f = reply(400);
    configure(f);
    track("scan.unknown");
    await flushMetrics();
    expect(pendingMetrics()).toEqual({});
  });

  it("stops sending for the session on a refused token, but keeps the counts", async () => {
    const f = reply(401);
    configure(f);
    track("sync.bad_token");
    await flushMetrics();
    track("sync.bad_token");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_WAIT_MS * 2);
    await flushMetrics();
    expect(f).toHaveBeenCalledTimes(1);
    expect(pendingMetrics()).toEqual({ [TODAY]: { "sync.bad_token": 2 } });
  });

  it("merges counts restored from a previous page load", async () => {
    storage.setItem(METRICS_STORAGE_KEY, JSON.stringify({ [TODAY]: { "scan.batch": 2 } }));
    const f = reply(200);
    configure(f);
    track("scan.batch");
    await flushMetrics();
    expect(sentBody(f)).toEqual({ days: { [TODAY]: { "scan.batch": 3 } } });
  });

  it("ignores a corrupt stored blob", async () => {
    storage.setItem(METRICS_STORAGE_KEY, "{nope");
    const f = reply(200);
    expect(() => configure(f)).not.toThrow();
    expect(pendingMetrics()).toEqual({});
  });

  it("keeps the persisted blob small: old days dropped, size capped", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("offline");
    });
    configure(f);
    // Ten days of counts on a device that never reaches the server.
    for (let d = 0; d < 10; d++) {
      vi.setSystemTime(NOW + d * 86_400_000);
      track("screen.home");
      track("screen.set");
      track("sync.fail.offline");
    }
    await flushMetrics();
    const blob = storage.map.get(METRICS_STORAGE_KEY) ?? "";
    expect(blob.length).toBeLessThanOrEqual(MAX_BLOB_CHARS);
    expect(Object.keys(JSON.parse(blob) as object)).toHaveLength(7);
  });

  it("never throws from track even if storage itself throws", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("offline");
    });
    configureMetrics({
      getToken: () => "t",
      fetch: f,
      storage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
      now: () => Date.now(),
    });
    expect(() => track("scan.accepted")).not.toThrow();
    await expect(flushMetrics()).resolves.toBeUndefined();
  });
});
