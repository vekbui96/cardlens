import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InputProvider, CatalogProvider, RepositoriesProvider } from "../../app/contexts.tsx";
import { NavigationProvider } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider, type MockBehavior } from "../../integrations/pokemon/index.ts";
import { ResultsScreen } from "./ResultsScreen.tsx";

function harness(
  behavior?: MockBehavior,
  base = new MockPokemonProvider(behavior ?? {}),
  mock = new MockInputAdapter(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: mock, mock }}>
          <RepositoriesProvider>
            <CatalogProvider base={base}>
              <NavigationProvider>
                <LibraryProvider>{children}</LibraryProvider>
              </NavigationProvider>
            </CatalogProvider>
          </RepositoriesProvider>
        </InputProvider>
      </QueryClientProvider>
    );
  };
}

describe("ResultsScreen", () => {
  it("shows matching cards for a query", async () => {
    const Wrapper = harness();
    render(<ResultsScreen query="Charizard" />, { wrapper: Wrapper });
    const options = await screen.findAllByRole("option", {}, { timeout: 3000 });
    expect(options.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Obsidian Flames").length).toBeGreaterThan(0);
  });

  it("shows the network-error state when the provider fails", async () => {
    const Wrapper = harness({ failNetwork: true });
    render(<ResultsScreen query="Charizard" />, { wrapper: Wrapper });
    expect(await screen.findByText(/Couldn’t load cards/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Try again/i)).toBeInTheDocument();
  });

  it("shows the empty state when there are no matches", async () => {
    const Wrapper = harness({ forceEmpty: true });
    render(<ResultsScreen query="Charizard" />, { wrapper: Wrapper });
    expect(await screen.findByText(/No cards found/i, {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("lands on the first result when a rarity swipe returns to a cached filter", async () => {
    // A filter seen before is served from the query cache without a loading
    // state, so the list is swapped without passing through zero and focus
    // used to keep its row number.
    const base = new MockPokemonProvider({});
    const original = base.searchCards.bind(base);
    vi.spyOn(base, "searchCards").mockImplementation(async (q, opts) => {
      const all = await original(q);
      return opts?.rarities ? all.slice(0, 2) : all;
    });
    const mock = new MockInputAdapter();
    render(<ResultsScreen query="Charizard" />, { wrapper: harness(undefined, base, mock) });

    const focusedIndex = () =>
      screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(3), { timeout: 3000 });
    const allCount = screen.getAllByRole("option").length;
    expect(focusedIndex()).toBe(0);
    for (let i = 0; i < 3; i++) act(() => mock.swipeDown());
    expect(focusedIndex()).toBe(3);

    act(() => mock.swipeRight()); // All -> IR, fetched for the first time
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2), { timeout: 3000 });
    expect(focusedIndex()).toBe(0);
    act(() => mock.swipeDown());
    expect(focusedIndex()).toBe(1);

    act(() => mock.swipeLeft()); // IR -> All, straight from the cache
    expect(screen.getAllByRole("option")).toHaveLength(allCount);
    expect(focusedIndex()).toBe(0);
  });
});
