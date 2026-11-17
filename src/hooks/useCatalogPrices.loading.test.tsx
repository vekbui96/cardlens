import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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

const { useCatalogPrices } = await import("./useCatalogPrices.ts");

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
