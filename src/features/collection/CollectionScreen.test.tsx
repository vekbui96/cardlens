import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InputProvider, CatalogProvider, RepositoriesProvider } from "../../app/contexts.tsx";
import { NavigationProvider } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { TextEntryProvider } from "../../app/TextEntryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../integrations/pokemon/index.ts";
import type { PokemonSet } from "../../models/cards.ts";
import { CollectionScreen } from "./CollectionScreen.tsx";

/**
 * A catalog whose listSets never settles.
 *
 * This is the state the glasses were actually in: an empty local collection and
 * a set-list request that hangs. The screen used to gate its whole UI on that
 * query and had no error branch, so it sat on "Loading sets…" forever.
 *
 * An ABORTED request cannot reproduce it — that settles the query and lets the
 * empty state through, which is exactly why an earlier e2e attempt at this
 * passed against the bug.
 */
class HangingSetsProvider extends MockPokemonProvider {
  override listSets(): Promise<PokemonSet[]> {
    return new Promise<PokemonSet[]>(() => {
      /* deliberately never resolves */
    });
  }
}

function harness(base = new MockPokemonProvider({})) {
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

describe("CollectionScreen", () => {
  it("shows the empty state even while the set list is still hanging", async () => {
    const Wrapper = harness(new HangingSetsProvider({}));
    render(<CollectionScreen />, { wrapper: Wrapper });

    expect(await screen.findByText(/No cards tracked/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(/Loading sets/i)).toBeNull();
  });

  it("still renders the sync row when the catalog is unavailable", async () => {
    const Wrapper = harness(new HangingSetsProvider({}));
    render(<CollectionScreen />, { wrapper: Wrapper });

    // Sync is local-only configuration; a dead catalog must not hide it.
    expect(await screen.findByText(/Sync:/i, {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
