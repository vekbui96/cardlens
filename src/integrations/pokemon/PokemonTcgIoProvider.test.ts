import { afterEach, describe, expect, it, vi } from "vitest";
import { PokemonTcgIoProvider } from "./PokemonTcgIoProvider.ts";
import { MOCK_CARDS } from "./fixtures.ts";

/** 60 cards of one Pokémon — more than the short search returns, fewer than a full page. */
const TEMPLATE = MOCK_CARDS.find((c) => c.name === "Charizard")!;
const MANY = Array.from({ length: 60 }, (_, i) => ({
  ...TEMPLATE,
  id: `fake${i}-4`,
  number: String(i + 1),
}));

function stubFetch() {
  const fetchMock = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: MANY }), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("PokemonTcgIoProvider.searchCards", () => {
  it("caps an ordinary search, so a focus ring is not asked to step through hundreds", async () => {
    stubFetch();
    const results = await new PokemonTcgIoProvider().searchCards("charizard");
    expect(results).toHaveLength(40);
  });

  it("returns every match for a full search, and asks the API for one big page", async () => {
    // The binder picker asks "which Charizards exist" — an answer cut at 40 is
    // wrong there, and silently so: the missing ones look like cards that do
    // not exist rather than cards that were not shown.
    const fetchMock = stubFetch();
    const results = await new PokemonTcgIoProvider().searchCards("charizard", { full: true });

    expect(results).toHaveLength(MANY.length);
    expect(String(fetchMock.mock.calls[0][0])).toContain("pageSize=250");
  });
});

describe("PokemonTcgIoProvider.getCardsBySet", () => {
  /** A set of `total` cards, numbered 1..total — Paldea Evolved is 279. */
  function bigSet(total: number) {
    return Array.from({ length: total }, (_, i) => ({
      ...TEMPLATE,
      id: `sv2-${i + 1}`,
      number: String(i + 1),
    }));
  }

  function pageOf(url: string): number {
    return Number(new URL(url).searchParams.get("page") ?? "1");
  }

  it("pages past the API's 250-card maximum, so a big set's chase cards are not cut off", async () => {
    // 250 is the upstream maximum; asking once cut Paldea Evolved at 250 of
    // 279, and the missing 29 are its secret rares.
    const cards = bigSet(279);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const page = pageOf(String(url));
      const data = cards.slice((page - 1) * 250, page * 250);
      return new Response(
        JSON.stringify({ data, page, pageSize: 250, count: data.length, totalCount: 279 }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await new PokemonTcgIoProvider().getCardsBySet("sv2");

    expect(results).toHaveLength(279);
    expect(new Set(results.map((c) => c.id)).size).toBe(279);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("asks once for a set that fits in one page", async () => {
    const cards = bigSet(120);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: cards, page: 1, pageSize: 250, count: 120, totalCount: 120 }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await new PokemonTcgIoProvider().getCardsBySet("sv2");

    expect(results).toHaveLength(120);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops after one extra request against a proxy that ignores `page`", async () => {
    // Pages ships before the server restarts, and an old proxy answers page 1
    // to every request. That must end with today's result, not ten copies.
    const cards = bigSet(279).slice(0, 250);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: cards, page: 1, pageSize: 250, count: 250, totalCount: 279 }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await new PokemonTcgIoProvider().getCardsBySet("sv2");

    expect(results).toHaveLength(250);
    expect(new Set(results.map((c) => c.id)).size).toBe(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails the whole read when a later page fails, rather than returning part of a set as all of it", async () => {
    const cards = bigSet(279);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ data: cards.slice(0, 250), page: 1 }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("upstream", { status: 500 });
      }),
    );

    await expect(new PokemonTcgIoProvider().getCardsBySet("sv2")).rejects.toThrow();
  });
});
