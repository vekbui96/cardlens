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
