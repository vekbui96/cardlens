import { describe, expect, it } from "vitest";
import { TtlCache, MINUTE } from "./cache.ts";
import { VersionedStore, createMemoryStorage } from "./versioned.ts";

function makeCache(now: () => number) {
  const store = new VersionedStore(createMemoryStorage());
  return new TtlCache<string>("test", 30 * MINUTE, 3, store, now);
}

describe("TtlCache", () => {
  it("returns fresh entries as not stale", () => {
    const t = 1000;
    const cache = makeCache(() => t);
    cache.set("a", "hello");
    const hit = cache.get("a");
    expect(hit?.value).toBe("hello");
    expect(hit?.isStale).toBe(false);
  });

  it("flags entries older than the TTL as stale but still returns them", () => {
    let t = 1000;
    const cache = makeCache(() => t);
    cache.set("a", "hello");
    t += 31 * MINUTE;
    const hit = cache.get("a");
    expect(hit?.value).toBe("hello");
    expect(hit?.isStale).toBe(true);
  });

  it("returns null for unknown keys", () => {
    const cache = makeCache(() => 0);
    expect(cache.get("nope")).toBeNull();
  });

  it("evicts the oldest entries beyond the max size", () => {
    let t = 0;
    const cache = makeCache(() => t);
    cache.set("a", "1");
    t += 1;
    cache.set("b", "2");
    t += 1;
    cache.set("c", "3");
    t += 1;
    cache.set("d", "4"); // exceeds max of 3 -> oldest "a" evicted
    expect(cache.get("a")).toBeNull();
    expect(cache.get("d")?.value).toBe("4");
  });
});
