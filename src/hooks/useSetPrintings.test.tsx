import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSetPrintings } from "./useSetPrintings.ts";
import { printingsCache } from "../storage/caches.ts";

/**
 * A printings answer the server marks as incomplete must not stick for a month.
 *
 * `/api/printings` answers `max-age=3600` when TCGdex skipped cards while the
 * server built the set, and `max-age=2592000` when the set is complete. The
 * device used to keep either for 30 days — in `printingsCache` and in React
 * Query's `staleTime` — so a half-built set stayed half-priced long after the
 * server healed. Live, Fates Collide sat at 119 of 125 numbers that way.
 */

const HOUR = 60 * 60_000;
const SET_ID = "xy10";
const SET_NAME = "Fates Collide";
const PRINTINGS = { tcgdexSetId: "xy10", byNumber: { "1": [{ type: "normal" }] } };

function serverAnswers(cacheControl: string) {
  const fetchMock = vi.fn((_url: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(PRINTINGS), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": cacheControl },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  localStorage.clear();
  // Only the clock: React Query and waitFor still need real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useSetPrintings and an incomplete server answer", () => {
  it("does not store a provisional answer, and refetches it after an hour", async () => {
    const fetchMock = serverAnswers("public, max-age=3600");
    const { wrapper } = harness();

    const first = renderHook(() => useSetPrintings(SET_ID, SET_NAME), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    // Still shown: a partial answer beats none.
    expect(first.result.current.index).not.toBeNull();
    expect(printingsCache.get(SET_ID)).toBeNull();

    vi.setSystemTime(Date.now() + HOUR + 60_000);
    renderHook(() => useSetPrintings(SET_ID, SET_NAME), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("stores a complete answer and keeps trusting it after an hour", async () => {
    const fetchMock = serverAnswers("public, max-age=2592000");
    const { wrapper } = harness();

    const first = renderHook(() => useSetPrintings(SET_ID, SET_NAME), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(printingsCache.get(SET_ID)?.value).toEqual(PRINTINGS));

    vi.setSystemTime(Date.now() + HOUR + 60_000);
    const second = renderHook(() => useSetPrintings(SET_ID, SET_NAME), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(second.result.current.isStale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a direct-TCGdex build that skipped cards as provisional", async () => {
    // Server down, so the device builds the set itself; one card fails twice.
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      if (url.includes("/printings/")) return Promise.reject(new TypeError("server off"));
      if (url.endsWith("/sets")) return json([{ id: "xy10", name: SET_NAME }]);
      if (url.endsWith("/sets/xy10")) {
        return json({
          id: "xy10",
          name: SET_NAME,
          cards: [
            { id: "xy10-1", localId: "1", name: "Bulbasaur" },
            { id: "xy10-2", localId: "2", name: "Ivysaur" },
          ],
        });
      }
      if (url.endsWith("/cards/xy10-1")) {
        return json({ id: "xy10-1", localId: "1", variants_detailed: [{ type: "normal" }] });
      }
      return Promise.resolve(new Response("{}", { status: 503 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = harness();

    const { result } = renderHook(() => useSetPrintings(SET_ID, SET_NAME), { wrapper });
    // The skipped card is retried once after the client's 1.5s pause.
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5000 });
    expect(result.current.index).not.toBeNull();
    expect(printingsCache.get(SET_ID)).toBeNull();
  });
});
