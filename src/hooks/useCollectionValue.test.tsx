import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCollectionValue } from "./useCollectionValue.ts";
import type { ValuableRow } from "../models/value.ts";

/**
 * A disabled query is not a pending one.
 *
 * `printingsQuery` is `enabled: Boolean(setName)` because the printings
 * endpoint matches TCGdex on a normalised NAME, not on our set id — so a set
 * whose name is not known yet cannot be asked about at all. React Query reports
 * a disabled query as `isPending` forever, which is correct from its point of
 * view and wrong from the screen's: it made every such set read "pricing…"
 * indefinitely, waiting on a request nobody was making, and the total never
 * admitted what it could not include.
 */

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const ROWS: ValuableRow[] = [{ cardId: "base2-4", setId: "base2", finish: "holo" }];

describe("useCollectionValue pricing status", () => {
  it("does not call a set pending when its name is unknown", async () => {
    // The set list has not loaded, so there is no name and no request.
    const { result } = renderHook(() => useCollectionValue(ROWS, {}), { wrapper: wrapper() });

    await waitFor(() => {
      expect(result.current.unaskable).toBe(1);
    });
    expect(result.current.pending).toBe(0);
    expect(result.current.failed).toBe(0);
  });

  it("counts nothing as unaskable once the name is known", async () => {
    const { result } = renderHook(() => useCollectionValue(ROWS, { base2: "Base Set 2" }), {
      wrapper: wrapper(),
    });

    // It may be pending or failed depending on how the fetch resolves in this
    // environment; the point is only that it is no longer "not asked".
    await waitFor(() => {
      expect(result.current.unaskable).toBe(0);
    });
  });

  it("reports nothing outstanding for an empty collection", async () => {
    const { result } = renderHook(() => useCollectionValue([], {}), { wrapper: wrapper() });

    await waitFor(() => {
      expect(result.current.pending).toBe(0);
    });
    expect(result.current.unaskable).toBe(0);
    expect(result.current.failed).toBe(0);
  });
});
