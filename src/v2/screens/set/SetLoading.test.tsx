import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CatalogProvider,
  InputProvider,
  LayoutModeProvider,
  RepositoriesProvider,
} from "../../../app/contexts.tsx";
import { NavigationProvider } from "../../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../../integrations/pokemon/index.ts";
import { BINDER_PAGE_SIZE } from "../../../models/binder.ts";
import { clearAllStorage } from "../../../storage/versioned.ts";
import { SetCardsScreen } from "./SetCardsScreen.tsx";

function harness(provider: MockPokemonProvider) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: new MockInputAdapter(), mock: new MockInputAdapter() }}>
          <RepositoriesProvider>
            <CatalogProvider base={provider}>
              <LayoutModeProvider mode="web">
                <NavigationProvider>
                  <LibraryProvider>{children}</LibraryProvider>
                </NavigationProvider>
              </LayoutModeProvider>
            </CatalogProvider>
          </RepositoriesProvider>
        </InputProvider>
      </QueryClientProvider>
    );
  };
}

describe("SetCardsScreen while the set loads", () => {
  beforeEach(() => {
    clearAllStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows shared skeleton pockets, says it is loading, and has no page heading", async () => {
    const provider = new MockPokemonProvider({ latencyMs: 60_000 });
    const { container } = render(<SetCardsScreen setId="sv3" setName="Obsidian Flames" />, {
      wrapper: harness(provider),
    });

    const busy = await screen.findByText("Loading the set's cards");
    expect(busy).toBeInTheDocument();
    const region = container.querySelector('[aria-busy="true"]');
    expect(region).not.toBeNull();
    // Two pages of nine pockets, plus a title bar per page, all the shared primitive.
    expect(region!.querySelectorAll("[data-skeleton]")).toHaveLength(2 * (BINDER_PAGE_SIZE + 1));
    expect(screen.queryByRole("heading", { name: /Page 1/ })).toBeNull();
    // Sighted readers get the same words as a visible line above the first page.
    const line = screen.getByText("Loading cards…");
    expect(line).toBeInTheDocument();
    // The shared status-line look: a small icon in front of the words, hidden from assistive tech.
    expect(line.querySelector("[data-loading-icon]")).not.toBeNull();
    // The skeleton pages use the same grid wrapper as the loaded binder.
    expect(region!.querySelector('[data-testid="binder-pages-loading"]')).not.toBeNull();
  });
});
