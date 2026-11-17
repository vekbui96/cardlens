import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

function harness(base: MockPokemonProvider, mock = new MockInputAdapter()) {
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

describe("SetCardsScreen rarity swipe focus", () => {
  /**
   * Six commons, two IR, two SIR. The fixtures hold only two Obsidian Flames
   * cards, too few for a short filter to sit above a long one.
   */
  const template = setCards[0];
  const card = (number: string, name: string, rarity: string) => ({
    ...template,
    id: `${SET_ID}-${number}`,
    number,
    name,
    rarity,
  });
  const listed = [
    ...["1", "2", "3", "4", "5", "6"].map((n) => card(n, `Common No${n}`, "Common")),
    card("150", "Illustration No150", "Illustration Rare"),
    card("151", "Illustration No151", "Illustration Rare"),
    card("200", "Special No200", "Special Illustration Rare"),
    card("201", "Special No201", "Special Illustration Rare"),
  ];

  function serveSet() {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              setId: SET_ID,
              cards: { data: listed },
              printings: {
                tcgdexSetId: "sv03",
                byNumber: Object.fromEntries(
                  listed.map((c) => [c.number, [{ type: "normal" }, { type: "reverse" }]]),
                ),
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
  }

  function focusedCard(): string {
    const focused = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    return focused?.textContent ?? "(none)";
  }

  async function open() {
    serveSet();
    const mock = new MockInputAdapter();
    render(<SetCardsScreen setId={SET_ID} setName={SET_NAME} />, {
      wrapper: harness(new MockPokemonProvider({}), mock),
    });
    expect(await screen.findByText(/Special No201/, {}, { timeout: 3000 })).toBeInTheDocument();
    return mock;
  }

  it("lands on the first card of a shorter filter, not the clamped last one", async () => {
    const mock = await open();
    // Focus starts on the collect toggle; nine swipes reach the ninth card.
    for (let i = 0; i < 9; i++) act(() => mock.swipeDown());
    expect(focusedCard()).toContain("Special No200");

    act(() => mock.swipeRight()); // All -> IR
    expect(screen.queryByText(/Common No1/)).not.toBeInTheDocument();
    expect(focusedCard()).toContain("Illustration No150");
  });

  it("lands on the first card when swiping back to a longer filter", async () => {
    const mock = await open();
    for (let i = 0; i < 9; i++) act(() => mock.swipeDown());
    act(() => mock.swipeRight()); // All -> IR
    act(() => mock.swipeDown()); // second IR card
    act(() => mock.swipeLeft()); // IR -> All
    expect(screen.getByText(/Special No201/)).toBeInTheDocument();
    expect(focusedCard()).toContain("Common No1");
  });

  it("keeps focus on the card being marked when collect mode's swipes change the printing", async () => {
    const mock = await open();
    act(() => mock.select()); // collect mode on; the printing picker joins the chrome
    expect(screen.getByText(/Marking:/)).toBeInTheDocument();
    for (let i = 0; i < 5; i++) act(() => mock.swipeDown());
    const before = focusedCard();
    expect(before).toContain("Common No4");
    const marking = screen.getByText(/Marking:/).textContent;

    act(() => mock.swipeRight());
    expect(screen.getByText(/Marking:/).textContent).not.toBe(marking);
    expect(focusedCard()).toBe(before);
  });
});
