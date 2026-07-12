import { describe, expect, it, beforeEach } from "vitest";
import {
  VersionedStore,
  createMemoryStorage,
  clearAllStorage,
  migrateStorage,
  STORAGE_VERSION,
} from "./versioned.ts";

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

describe("VersionedStore", () => {
  it("round-trips values through a validator", () => {
    const store = new VersionedStore(createMemoryStorage());
    store.write("k", ["a", "b"]);
    expect(store.read("k", isStringArray, [])).toEqual(["a", "b"]);
  });

  it("returns the fallback when data is missing", () => {
    const store = new VersionedStore(createMemoryStorage());
    expect(store.read("missing", isStringArray, ["fallback"])).toEqual(["fallback"]);
  });

  it("returns the fallback for corrupt JSON", () => {
    const backend = createMemoryStorage();
    backend.setItem(`cardlens:v${STORAGE_VERSION}:k`, "{not json");
    const store = new VersionedStore(backend);
    expect(store.read("k", isStringArray, [])).toEqual([]);
  });

  it("returns the fallback when the guard rejects the shape", () => {
    const store = new VersionedStore(createMemoryStorage());
    store.write("k", { not: "an array" });
    expect(store.read("k", isStringArray, ["safe"])).toEqual(["safe"]);
  });
});

describe("localStorage migration & clearing", () => {
  beforeEach(() => localStorage.clear());

  it("drops keys from older namespace versions", () => {
    localStorage.setItem("cardlens:v0:favorites", "[]");
    localStorage.setItem(`cardlens:v${STORAGE_VERSION}:favorites`, "[]");
    migrateStorage();
    expect(localStorage.getItem("cardlens:v0:favorites")).toBeNull();
    expect(localStorage.getItem(`cardlens:v${STORAGE_VERSION}:favorites`)).not.toBeNull();
  });

  it("clearAllStorage removes every cardlens key", () => {
    localStorage.setItem("cardlens:v1:favorites", "[]");
    localStorage.setItem("cardlens:v1:recent-searches", "[]");
    localStorage.setItem("other-app:data", "keep");
    clearAllStorage();
    expect(localStorage.getItem("cardlens:v1:favorites")).toBeNull();
    expect(localStorage.getItem("other-app:data")).toBe("keep");
  });
});
