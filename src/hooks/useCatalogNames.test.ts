import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalogNames } from "./useCatalogNames.ts";

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

describe("loadCatalogNames", () => {
  it("asks for every set in one request", async () => {
    const fetchMock = respondWith({ cards: {}, missing: [] });

    await loadCatalogNames(["sv1", "sv8pt5", "me5"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/catalog/names?sets=${encodeURIComponent("sv1,sv8pt5,me5")}`,
    );
  });

  it("reads names, numbers, art and the sets the server could not name", async () => {
    respondWith({
      cards: {
        "sv1-1": { name: "Sprigatito", number: "1", image: "https://img/s.png", large: "https://img/l.png" },
        "sv1-2": { name: "Floragato", number: "2" },
      },
      missing: ["sv2"],
    });

    const { cards, missing } = await loadCatalogNames(["sv1", "sv2"]);

    expect(cards.get("sv1-1")).toEqual({
      name: "Sprigatito",
      number: "1",
      image: "https://img/s.png",
      large: "https://img/l.png",
    });
    expect(cards.get("sv1-2")).toEqual({ name: "Floragato", number: "2" });
    expect([...missing]).toEqual(["sv2"]);
  });

  it("drops entries with no usable name rather than trusting the body", async () => {
    respondWith({ cards: { "sv1-1": { number: "1" }, "sv1-2": null, "sv1-3": { name: 7 } }, missing: [] });
    expect((await loadCatalogNames(["sv1"])).cards.size).toBe(0);
  });

  it("treats a 200 of the wrong shape as every set missing, so the caller falls back", async () => {
    respondWith({ unexpected: true });
    const { cards, missing } = await loadCatalogNames(["sv1", "sv2"]);
    expect(cards.size).toBe(0);
    expect([...missing]).toEqual(["sv1", "sv2"]);
  });

  it("throws when the server has no such endpoint, so the caller can fall back", async () => {
    respondWith({ error: "not_found" }, { status: 404 });
    await expect(loadCatalogNames(["sv1"])).rejects.toThrow();
  });
});
