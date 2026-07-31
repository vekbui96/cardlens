import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InputProvider, CatalogProvider, RepositoriesProvider } from "../../app/contexts.tsx";
import { NavigationProvider } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { TextEntryProvider } from "../../app/TextEntryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../integrations/pokemon/index.ts";
import type * as PokemonCatalog from "../../integrations/pokemon/index.ts";
import { MOCK_CARDS } from "../../integrations/pokemon/fixtures.ts";
import { SetCardsScreen } from "./SetCardsScreen.tsx";

/**
 * The aggregate endpoint switches itself off under mocks, so these tests turn
 * that gate back on and control the server with `fetch` instead. Without this
 * the screen would only ever exercise the fallback.
 */
vi.mock("../../integrations/pokemon/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof PokemonCatalog>()),
  shouldUseMocks: () => false,
}));

const SET_ID = "sv3";
const SET_NAME = "Obsidian Flames";
const setCards = MOCK_CARDS.filter((c) => c.set.id === SET_ID);

function harness(base: MockPokemonProvider) {
  const mock = new MockInputAdapter();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: mock, mock }}>
          <RepositoriesProvider>
            <CatalogProvider base={base}>
              <NavigationProvider>
                <LibraryProvider>
                  <TextEntryProvider>{children}</TextEntryProvider>
                </LibraryProvider>
              </NavigationProvider>
            </CatalogProvider>
          </RepositoriesProvider>
        </InputProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  // Both paths read and write the same TTL caches. A leaked entry from the
  // previous test would seed the next one as if the server had answered.
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SetCardsScreen", () => {
  it("renders the set from a single aggregate request", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            setId: SET_ID,
            cards: { data: setCards },
            printings: { tcgdexSetId: "sv03", byNumber: { "125": [{ type: "holo" }] } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MockPokemonProvider({});
    const getCardsBySet = vi.spyOn(provider, "getCardsBySet");

    render(<SetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness(provider) });

    expect(await screen.findAllByText(/Charizard ex/, {}, { timeout: 3000 })).not.toHaveLength(0);
    // The point of the endpoint: the two per-set card queries never run.
    expect(getCardsBySet).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/set-information"))).toHaveLength(1);
  });

  it("falls back to the catalog when the server is unreachable", async () => {
    // The machine this aggregates on spends days at a time powered off. Losing
    // the set list with it would be worse than the round trips it saves.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const provider = new MockPokemonProvider({});
    const getCardsBySet = vi.spyOn(provider, "getCardsBySet");

    render(<SetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness(provider) });

    expect(await screen.findAllByText(/Charizard ex/, {}, { timeout: 3000 })).not.toHaveLength(0);
    expect(getCardsBySet).toHaveBeenCalled();
  });

  it("falls back when the server answers with an empty set", async () => {
    // A set always has cards, so an empty payload means the proxy served
    // something degenerate — better to ask upstream than to render "No cards".
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ setId: SET_ID, cards: { data: [] }, printings: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const provider = new MockPokemonProvider({});
    const getCardsBySet = vi.spyOn(provider, "getCardsBySet");

    render(<SetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness(provider) });

    expect(await screen.findAllByText(/Charizard ex/, {}, { timeout: 3000 })).not.toHaveLength(0);
    expect(getCardsBySet).toHaveBeenCalled();
  });
});
