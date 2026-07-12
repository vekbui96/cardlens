import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InputProvider, CatalogProvider, RepositoriesProvider } from "../../app/contexts.tsx";
import { NavigationProvider } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider, type MockBehavior } from "../../integrations/pokemon/index.ts";
import { ResultsScreen } from "./ResultsScreen.tsx";

function harness(behavior?: MockBehavior) {
  const mock = new MockInputAdapter();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const base = new MockPokemonProvider(behavior ?? {});
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
});
