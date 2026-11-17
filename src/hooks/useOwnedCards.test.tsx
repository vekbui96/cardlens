import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PokemonCardSummary as CardSummary } from "../models/cards.ts";

/**
 * My cards names every row from ONE `/api/catalog/names` request.
 *
 * It used to ask the catalog once per owned set — nineteen at once on the
 * author's device, through a 60-second proxy cache, against an upstream that
 * fails a quarter of the time. These tests count the provider's calls: the
 * per-set path may run only for a set the server named in `missing`, or for
 * every set when the endpoint itself is unavailable (an older server).
 */

const getCardsBySet = vi.fn((setId: string): Promise<CardSummary[]> =>
  Promise.resolve([
    {
      id: `${setId}-1`,
      name: `Provider ${setId}`,
      setName: setId,
      setCode: setId,
      collectorNumber: "1",
    } as CardSummary,
  ]),
);
const backfillNumbers = vi.fn();
const COLLECTION = [
  { id: "sv1-1", setId: "sv1", finishes: ["normal"] },
  { id: "sv2-1", setId: "sv2", finishes: ["holo"] },
  { id: "sv3-1", setId: "sv3", finishes: ["reverse"] },
];
const NO_PRICES = new Map<string, number>();

vi.mock("../app/contexts.tsx", () => ({
  useCatalog: () => ({ provider: { getCardsBySet }, sourceKey: "base" }),
}));
vi.mock("../app/LibraryProvider.tsx", () => ({
  useLibrary: () => ({ collection: COLLECTION, backfillNumbers }),
}));
// No set names by default, so the printings oracle is never asked: only names
// are under test. The pricing tests name the sets they want priced.
let SETS: { id: string; name: string }[] = [];
vi.mock("./useSets.ts", () => ({ useSets: () => ({ data: SETS }) }));
// Whether the market-price batch is still in flight; see the pricing tests.
let CATALOG_LOADING = false;
vi.mock("./useCatalogPrices.ts", () => ({
  useCatalogPrices: () => ({ prices: NO_PRICES, pricesLoading: CATALOG_LOADING }),
}));
// The live catalog, which is the only configuration the batch endpoint serves.
vi.mock("../integrations/pokemon/index.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shouldUseMocks: () => false,
}));

const { useOwnedCards } = await import("./useOwnedCards.ts");

function namesServer(body: unknown, status = 200) {
  const fetchMock = vi.fn((_url: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function named(id: string, name: string) {
  return { [id]: { name, number: "1", image: `https://img/${id}.png` } };
}

beforeEach(() => {
  localStorage.clear();
  getCardsBySet.mockClear();
  backfillNumbers.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  SETS = [];
  CATALOG_LOADING = false;
});

describe("useOwnedCards names", () => {
  it("names three sets from one request and never asks the catalog set by set", async () => {
    const fetchMock = namesServer({
      cards: { ...named("sv1-1", "Sprigatito"), ...named("sv2-1", "Iono"), ...named("sv3-1", "Charizard") },
      missing: [],
    });

    const { result } = renderHook(() => useOwnedCards(), { wrapper: wrapper() });

    await waitFor(() =>
      expect(result.current.rows.map((r) => r.name)).toEqual(["Sprigatito", "Iono", "Charizard"]),
    );
    const namesCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/catalog/names"));
    expect(namesCalls).toHaveLength(1);
    expect(String(namesCalls[0]?.[0])).toContain(`sets=${encodeURIComponent("sv1,sv2,sv3")}`);
    expect(getCardsBySet).not.toHaveBeenCalled();
    expect(result.current.rows[0]?.imageSmall).toBe("https://img/sv1-1.png");
    expect(result.current.pending).toBe(0);
    // The collector-number backfill is fed from the batch too.
    await waitFor(() =>
      expect(backfillNumbers).toHaveBeenCalledWith(
        expect.arrayContaining([{ id: "sv2-1", collectorNumber: "1" }]),
      ),
    );
  });

  it("asks set by set only for a set the server could not name", async () => {
    namesServer({
      cards: { ...named("sv1-1", "Sprigatito"), ...named("sv3-1", "Charizard") },
      missing: ["sv2"],
    });

    const { result } = renderHook(() => useOwnedCards(), { wrapper: wrapper() });

    await waitFor(() =>
      expect(result.current.rows.map((r) => r.name)).toEqual(["Sprigatito", "Provider sv2", "Charizard"]),
    );
    expect(getCardsBySet.mock.calls.map(([setId]) => setId)).toEqual(["sv2"]);
  });

  it("falls back to every set when the server has no names endpoint", async () => {
    // Pages and the home server deploy separately; until the server catches up
    // this 404s, and the list must still fill in rather than show bare ids.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    namesServer({ error: "not_found" }, 404);

    const { result } = renderHook(() => useOwnedCards(), { wrapper: wrapper() });

    // The batch retries once (~1s) before it reports the error that falls back.
    await waitFor(
      () =>
        expect(result.current.rows.map((r) => r.name)).toEqual([
          "Provider sv1",
          "Provider sv2",
          "Provider sv3",
        ]),
      { timeout: 5000 },
    );
    expect(getCardsBySet).toHaveBeenCalledTimes(3);
  });
});

/**
 * "pricing N sets…" must mean prices, not names.
 *
 * Names arrive in one batch while each set's printings (the prices) are still
 * on their way. Counting only the names made the line read as finished with a
 * partial total, and called cards "unpriced" that were merely not priced yet.
 */
describe("useOwnedCards pricing status", () => {
  const ALL_NAMED = {
    cards: { ...named("sv1-1", "Sprigatito"), ...named("sv2-1", "Iono"), ...named("sv3-1", "Charizard") },
    missing: [],
  };

  function jsonResponse(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  /** Names answer at once; every printings request waits on `printings`. */
  function serverWithPrintings(printings: Promise<Response>) {
    const fetchMock = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/printings/") ? printings : Promise.resolve(jsonResponse(ALL_NAMED)),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("counts a set as pricing while its printings are still loading, after names have arrived", async () => {
    SETS = [{ id: "sv1", name: "Scarlet & Violet" }];
    // A hang, not an abort: an abort settles the query and hides the bug.
    let answer: (res: Response) => void = () => {};
    serverWithPrintings(new Promise<Response>((resolve) => (answer = resolve)));

    const { result } = renderHook(() => useOwnedCards(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.rows[0]?.name).toBe("Sprigatito"));
    expect(result.current.pending).toBe(0);
    // sv2 and sv3 have no known name, so nothing is asking for their prices
    // (a disabled query is isPending forever) — they are not "pricing".
    expect(result.current.pricing).toBe(1);

    answer(jsonResponse({ tcgdexSetId: "sv01", byNumber: {} }));
    await waitFor(() => expect(result.current.pricing).toBe(0));
  });

  it("keeps pricing while only the market-price batch is still loading", async () => {
    // Names answered, and no set name is known, so no printings are asked for
    // (and none can count). The second oracle has not answered: for promos and
    // older cards it is the only price, so the total is not final yet.
    CATALOG_LOADING = true;
    serverWithPrintings(new Promise<Response>(() => {}));

    const { result } = renderHook(() => useOwnedCards(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.rows[0]?.name).toBe("Sprigatito"));
    expect(result.current.pending).toBe(0);
    expect(result.current.pricing).toBe(1);
  });

  it("never counts a set it cannot ask about as pricing", async () => {
    const fetchMock = serverWithPrintings(new Promise<Response>(() => {}));

    const { result } = renderHook(() => useOwnedCards(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.pending).toBe(0));
    expect(result.current.pricing).toBe(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/printings/"))).toBe(false);
  });
});
