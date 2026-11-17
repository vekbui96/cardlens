import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PokemonCardSummary as CardSummary } from "../models/cards.ts";

/**
 * "pricing…" must also wait for the market-price batch.
 *
 * `/api/catalog/prices` is the slow request on a cold cache (8.7s measured),
 * and for promos and older cards it is the ONLY price. The hook used to hide
 * its loading state, so Home and My cards called those cards "unpriced" in a
 * total that read as final while the request was still running.
 */

let MOCKS = false;
let pendingFallback: Promise<CardSummary[]> | null = null;
const getCardsBySet = vi.fn(
  (setId: string): Promise<CardSummary[]> =>
    pendingFallback ?? Promise.resolve([{ id: `${setId}-1`, collectorNumber: "1" } as CardSummary]),
);

vi.mock("../app/contexts.tsx", () => ({
  useCatalog: () => ({ provider: { getCardsBySet }, sourceKey: "base" }),
}));
vi.mock("../integrations/pokemon/index.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shouldUseMocks: () => MOCKS,
}));

const { useCatalogPrices, MISSING_RETRY_DELAY_MS } = await import("./useCatalogPrices.ts");

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  localStorage.clear();
  getCardsBySet.mockClear();
  MOCKS = false;
  pendingFallback = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useCatalogPrices loading state", () => {
  it("is loading while the batch is in flight, and not once it answers", async () => {
    // A hang, not an abort: an abort settles the query and hides the bug.
    let answer: (res: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );

    const { result } = renderHook(() => useCatalogPrices(["sv1"]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.pricesLoading).toBe(true));
    expect(result.current.prices.size).toBe(0);

    answer(jsonResponse({ prices: { "sv1-1|holofoil": 12.5 }, missing: [] }));
    await waitFor(() => expect(result.current.pricesLoading).toBe(false));
    expect(result.current.prices.get("sv1-1|holofoil")).toBe(12.5);
  });

  it("never loads when there is nothing to ask about", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCatalogPrices([]), { wrapper: wrapper() });

    // A disabled query is isPending forever; counting it would read "pricing…" for good.
    expect(result.current.pricesLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows the per-set queries when the batch is switched off (mocked catalog)", async () => {
    MOCKS = true;
    let answer: (cards: CardSummary[]) => void = () => {};
    pendingFallback = new Promise<CardSummary[]>((resolve) => (answer = resolve));

    const { result } = renderHook(() => useCatalogPrices(["sv1"]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.pricesLoading).toBe(true));
    expect(getCardsBySet).toHaveBeenCalled();

    answer([{ id: "sv1-1", collectorNumber: "1" } as CardSummary]);
    await waitFor(() => expect(result.current.pricesLoading).toBe(false));
  });
});

/**
 * A set the batch names in `missing` is asked about once more, on its own.
 *
 * pokemontcg.io fails in bursts, and the server does not cache a failure.
 * Measured 2026-11-16: a five-set batch came back `missing: ["sv3"]`, and
 * `?sets=sv3` alone a moment later priced 406 printings. Without a second ask
 * the client held the gap for the whole 30-minute staleTime.
 */
describe("useCatalogPrices follow-up for missing sets", () => {
  function setsAsked(fetchMock: ReturnType<typeof vi.fn>): string[] {
    return fetchMock.mock.calls.map((call) =>
      decodeURIComponent(new URL(String(call[0]), "http://x").searchParams.get("sets") ?? ""),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks once more for just the missing sets, and merges what comes back", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url).includes(`sets=${encodeURIComponent("sv1,sv3")}`)
          ? jsonResponse({ prices: { "sv1-1|holofoil": 12.5 }, missing: ["sv3"] })
          : jsonResponse({ prices: { "sv3-7|normal": 4 }, missing: [] }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCatalogPrices(["sv1", "sv3"]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.prices.get("sv1-1|holofoil")).toBe(12.5));
    // The first answer is a usable total; the follow-up must not hold "pricing…".
    expect(result.current.pricesLoading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(MISSING_RETRY_DELAY_MS + 100));

    await waitFor(() => expect(result.current.prices.get("sv3-7|normal")).toBe(4));
    expect(result.current.prices.get("sv1-1|holofoil")).toBe(12.5);
    expect(setsAsked(fetchMock)).toEqual(["sv1,sv3", "sv3"]);
  });

  it("asks only once more, even when the follow-up names the set missing again", async () => {
    // A set the server can never price (an empty index is named missing) must
    // cost exactly one extra request, never a loop.
    const fetchMock = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url).includes(`sets=${encodeURIComponent("sv1,sv3")}`)
          ? jsonResponse({ prices: { "sv1-1|holofoil": 12.5 }, missing: ["sv3"] })
          : jsonResponse({ prices: {}, missing: ["sv3"] }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCatalogPrices(["sv1", "sv3"]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.prices.get("sv1-1|holofoil")).toBe(12.5));
    await act(() => vi.advanceTimersByTimeAsync(MISSING_RETRY_DELAY_MS + 100));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(() => vi.advanceTimersByTimeAsync(MISSING_RETRY_DELAY_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.prices.get("sv1-1|holofoil")).toBe(12.5);
  });

  it("makes no second request when nothing is missing", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ prices: { "sv1-1|holofoil": 12.5 }, missing: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCatalogPrices(["sv1"]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.prices.get("sv1-1|holofoil")).toBe(12.5));
    await act(() => vi.advanceTimersByTimeAsync(MISSING_RETRY_DELAY_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
