import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { createMemoryStorage, VersionedStore } from "./versioned.ts";
import { LAST_LOOK_KEY, readLastLook, writeLastLook } from "./lastLook.ts";
import { useSinceLastLooked } from "../hooks/useSinceLastLooked.ts";
import type { LastLookState } from "../models/lastLook.ts";

const DAY = 24 * 60 * 60_000;

function fresh() {
  const backend = createMemoryStorage();
  return { backend, store: new VersionedStore(backend) };
}

const state: LastLookState = {
  v: 1,
  previous: null,
  latest: { at: Date.now() - 2 * DAY, total: 100, cards: 10, priced: 10, printings: 10, currency: "USD" },
};

describe("last-look storage", () => {
  it("round-trips under a namespaced, versioned key", () => {
    const { backend, store } = fresh();
    expect(writeLastLook(state, store)).toBe(true);
    expect(backend.getItem(`cardlens:v1:${LAST_LOOK_KEY}`)).not.toBeNull();
    expect(readLastLook(store)).toEqual(state);
  });

  it("reads a missing value as no baseline", () => {
    expect(readLastLook(fresh().store)).toBeNull();
  });

  it("reads unparseable JSON as no baseline, without throwing", () => {
    const { backend, store } = fresh();
    backend.setItem(`cardlens:v1:${LAST_LOOK_KEY}`, "{not json");
    expect(readLastLook(store)).toBeNull();
  });

  it("survives a backend that throws on every call", () => {
    const broken = new VersionedStore({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    });
    expect(readLastLook(broken)).toBeNull();
    expect(writeLastLook(state, broken)).toBe(false);
  });
});

describe("useSinceLastLooked", () => {
  const settled = { total: 110, cards: 12, priced: 10, printings: 10, pending: 0 };

  it("says nothing on a clean device, then saves a baseline", () => {
    const { store } = fresh();
    const { result } = renderHook(() => useSinceLastLooked(settled, store));
    expect(result.current).toBeNull();
    expect(readLastLook(store)?.latest.total).toBe(110);
  });

  it("compares with the previous visit once pricing settles", () => {
    const { store } = fresh();
    writeLastLook(state, store);
    const { result, rerender } = renderHook((p) => useSinceLastLooked(p, store), {
      initialProps: { ...settled, pending: 2 },
    });
    // Mid-load: nothing read, nothing written.
    expect(result.current).toBeNull();
    expect(readLastLook(store)).toEqual(state);

    rerender(settled);
    expect(result.current).toEqual({ text: "+10.0% · +2 cards", ago: "2 days ago" });
  });

  it("keeps the comparison across a reload in the same visit", () => {
    const { store } = fresh();
    writeLastLook(state, store);
    renderHook(() => useSinceLastLooked(settled, store)).unmount();
    const { result } = renderHook(() => useSinceLastLooked(settled, store));
    expect(result.current?.text).toBe("+10.0% · +2 cards");
  });
});
