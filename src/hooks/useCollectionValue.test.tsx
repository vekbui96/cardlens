import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const HOUR = 60 * 60_000;

/** Several hooks on ONE client, the way screens share a query cache. */
function shared(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * `/api/printings` with a price for the one row, under the given Cache-Control.
 * `max-age=3600` is how the server says TCGdex skipped cards during the build.
 */
function printingsServer(cacheControl: string) {
  const body = {
    tcgdexSetId: "base2",
    byNumber: { "4": [{ type: "holo", price: 12.5 }] },
  };
  const fetchMock = vi.fn((_url: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": cacheControl },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

  it("refetches a set the server marked incomplete once an hour has passed", async () => {
    const fetchMock = printingsServer("public, max-age=3600");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const first = renderHook(() => useCollectionValue(ROWS, { base2: "Base Set 2" }), {
      wrapper: shared(client),
    });
    await waitFor(() => expect(first.result.current.priced).toBe(1));

    vi.setSystemTime(Date.now() + HOUR + 60_000);
    renderHook(() => useCollectionValue(ROWS, { base2: "Base Set 2" }), { wrapper: shared(client) });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps trusting a complete set after an hour", async () => {
    const fetchMock = printingsServer("public, max-age=2592000");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const first = renderHook(() => useCollectionValue(ROWS, { base2: "Base Set 2" }), {
      wrapper: shared(client),
    });
    await waitFor(() => expect(first.result.current.priced).toBe(1));

    vi.setSystemTime(Date.now() + HOUR + 60_000);
    const second = renderHook(() => useCollectionValue(ROWS, { base2: "Base Set 2" }), {
      wrapper: shared(client),
    });
    await waitFor(() => expect(second.result.current.priced).toBe(1));
    // Give a (wrong) refetch the chance to start before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
