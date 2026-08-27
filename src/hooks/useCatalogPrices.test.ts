import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalogPrices } from "./useCatalogPrices.ts";

/**
 * The hook switches off under mocks — deliberately, so unit tests and the e2e
 * run never reach for a home server that is not there. The request and the
 * parsing are the parts worth exercising, so they are driven directly, the same
 * way fetchSetInformation is.
 */
function respondWith(body: unknown, init: { status?: number } = {}) {
  const fetchMock = vi.fn((_url: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadCatalogPrices", () => {
  it("asks for every set in one request", async () => {
    // The whole point. Home prices the whole collection, and asking the card
    // proxy set by set measured 4.5-6.7s per call on the live site, nineteen of
    // them at once, with several never completing.
    const fetchMock = respondWith({ prices: {}, missing: [] });

    await loadCatalogPrices(["sv1", "sv8pt5", "me5"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`sets=${encodeURIComponent("sv1,sv8pt5,me5")}`);
  });

  it("keys prices the way the collection looks them up", async () => {
    respondWith({ prices: { "sv1-1|holofoil": 12.5, "sv1-2|normal": 0.25 } });

    const prices = await loadCatalogPrices(["sv1"]);

    expect(prices.get("sv1-1|holofoil")).toBe(12.5);
    expect(prices.get("sv1-2|normal")).toBe(0.25);
  });

  it("drops zero and non-numeric prices rather than trusting the body", async () => {
    // Absent must mean unknown. A zero sums into the collection total as though
    // the printing were worthless and reads as a real answer.
    respondWith({
      prices: { "sv1-1|holofoil": 0, "sv1-2|normal": "3.00", "sv1-3|normal": null, "sv1-4|normal": 2 },
    });

    const prices = await loadCatalogPrices(["sv1"]);

    expect([...prices.keys()]).toEqual(["sv1-4|normal"]);
  });

  it("returns nothing rather than throwing when the body is the wrong shape", async () => {
    // An older server answers this path with a 404, which fetchJson throws for
    // and the hook falls back on. A 200 carrying something unexpected is the
    // case that would otherwise crash Home.
    respondWith({ unexpected: true });
    expect((await loadCatalogPrices(["sv1"])).size).toBe(0);

    respondWith(null);
    expect((await loadCatalogPrices(["sv1"])).size).toBe(0);
  });

  it("throws when the server has no such endpoint, so the caller can fall back", async () => {
    // Pages and the home server deploy separately, so a client shipped against
    // a server that has not caught up is a normal transient state. It must be
    // an error the hook can see, not an empty answer it would treat as truth.
    respondWith({ error: "not_found" }, { status: 404 });
    await expect(loadCatalogPrices(["sv1"])).rejects.toThrow();
  });
});
