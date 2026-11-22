import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * Home's "pricing…" waits on the market-price batch as well as the printings.
 *
 * `useCollectionValue` counts only the per-set printings. The second oracle
 * (`/api/catalog/prices`, 8.7s cold) is the only price for promos and older
 * cards, so while it runs the total is a lower bound and must say so.
 */

let CATALOG_LOADING = false;
const PRICES = new Map<string, number>();

vi.mock("../app/LibraryProvider.tsx", () => ({
  useLibrary: () => ({ collection: [{ id: "sv1-1", setId: "sv1", finishes: ["normal"] }] }),
}));
vi.mock("./useSets.ts", () => ({ useSets: () => ({ data: [{ id: "sv1", name: "Scarlet & Violet" }] }) }));
vi.mock("./useCatalogPrices.ts", () => ({
  useCatalogPrices: () => ({
    prices: PRICES,
    pricesLoading: CATALOG_LOADING,
    pricesRateLimited: 0,
    pricesRetrying: 0,
  }),
}));
const useCollectionValue = vi.fn((..._args: unknown[]) => ({
  total: 0,
  priced: 1,
  unpriced: 0,
  bySet: [],
  pending: 0,
  failed: 0,
  unaskable: 0,
  rateLimited: 0,
  retrying: 0,
  movement: null,
}));
vi.mock("./useCollectionValue.ts", () => ({ useCollectionValue }));

const { useLibraryValue } = await import("./useLibraryValue.ts");

afterEach(() => {
  CATALOG_LOADING = false;
  useCollectionValue.mockClear();
});

describe("useLibraryValue pending", () => {
  it("counts the market-price batch as pending while it is loading", () => {
    CATALOG_LOADING = true;

    const { result } = renderHook(() => useLibraryValue());

    expect(result.current.pending).toBe(1);
  });

  it("is settled once the batch has answered, and hands its prices on", () => {
    const { result } = renderHook(() => useLibraryValue());

    expect(result.current.pending).toBe(0);
    expect(useCollectionValue.mock.calls[0]?.[2]).toBe(PRICES);
  });
});
