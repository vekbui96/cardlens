import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IndexedCard } from "../../scan/cardIndex.ts";
import type { CollectFinish } from "../../models/cards.ts";

const loadPrintings = vi.fn();
vi.mock("../../hooks/useSetPrintings.ts", () => ({
  loadPrintings: (...args: unknown[]) => loadPrintings(...args),
}));

const { useScanPrices } = await import("./useScanPrices.ts");

function card(setId: string, setName: string, number: string): IndexedCard {
  return { id: `${setId}-${number}`, name: `Card ${number}`, number, setId, setName, rarity: "Common" };
}

const OBF = {
  tcgdexSetId: "sv03",
  byNumber: {
    "3": [
      { type: "normal", price: 1.5 },
      { type: "reverse", price: 4.25 },
    ],
  },
};
const PAL = { tcgdexSetId: "sv02", byNumber: { "7": [{ type: "normal", price: 10 }] } };

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  loadPrintings.mockReset();
  localStorage.clear();
});

describe("useScanPrices", () => {
  it("prices each row's picked printing, asking once per set", async () => {
    loadPrintings.mockImplementation(async (setId: string) => (setId === "sv3" ? OBF : PAL));
    const rows = [
      { key: 1, card: card("sv3", "Obsidian Flames", "3"), finish: "normal" as CollectFinish },
      { key: 2, card: card("sv3", "Obsidian Flames", "3"), finish: "reverse" as CollectFinish },
      { key: 3, card: card("sv2", "Paldea Evolved", "7"), finish: "normal" as CollectFinish },
      { key: 4, card: card("sv2", "Paldea Evolved", "99"), finish: "normal" as CollectFinish },
    ];
    const { result } = renderHook(() => useScanPrices(rows), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.priceOf(1)).toBe(1.5);
    expect(result.current.priceOf(2)).toBe(4.25);
    expect(result.current.priceOf(3)).toBe(10);
    // A number the oracle has no row for is unpriced, never guessed.
    expect(result.current.priceOf(4)).toBeUndefined();
    // Two rows from one set cost one request, as the finish chips already do.
    expect(loadPrintings).toHaveBeenCalledTimes(2);
    expect(loadPrintings).toHaveBeenCalledWith("sv3", "Obsidian Flames", expect.anything());
  });

  it("reports loading until every set has answered", async () => {
    // A hanging request, not a rejected one: the footer must not present a
    // partial total as final while a set is still on its way.
    loadPrintings.mockImplementation(() => new Promise(() => {}));
    const rows = [{ key: 1, card: card("sv3", "Obsidian Flames", "3"), finish: "normal" as CollectFinish }];
    const { result } = renderHook(() => useScanPrices(rows), { wrapper: wrapper() });

    expect(result.current.loading).toBe(true);
    expect(result.current.priceOf(1)).toBeUndefined();
  });

  it("stops loading when a set fails, leaving its rows unpriced", async () => {
    loadPrintings.mockRejectedValue(new Error("offline"));
    const rows = [{ key: 1, card: card("sv3", "Obsidian Flames", "3"), finish: "normal" as CollectFinish }];
    const { result } = renderHook(() => useScanPrices(rows), { wrapper: wrapper() });

    // The shared query options retry once (about a second), so allow for it.
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 4000 });
    expect(result.current.priceOf(1)).toBeUndefined();
  });
});
