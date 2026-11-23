import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { clearAllStorage } from "../../../storage/versioned.ts";
import { SetCardsError, SetCardsScreen } from "./SetCardsScreen.tsx";

describe("SetCardsError uses the shared ErrorNotice", () => {
  it("announces what failed, under its heading, and keeps the retry outside the alert", async () => {
    const onRetry = vi.fn();
    render(<SetCardsError setName="Obsidian Flames" onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "The card catalog could not be reached" }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent("Obsidian Flames could not be loaded.");
    expect(alert).toHaveTextContent("Anything already marked is safe");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

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

describe("SetCardsScreen when the catalog cannot be reached", () => {
  beforeEach(() => {
    clearAllStorage();
    // No server aggregate either: the screen falls back to the catalog, which fails.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows only the error: no printings count and no filter chips", async () => {
    const provider = new MockPokemonProvider({ failNetwork: true });
    render(<SetCardsScreen setId="sv3" setName="Obsidian Flames" />, { wrapper: harness(provider) });

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByTestId("set-cards-error-only")).toBeInTheDocument();
    expect(screen.queryByText(/printings/i)).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter by rarity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Missing only" })).toBeNull();
  });

  it("keeps the notice and its Try again button while the retry is in flight", async () => {
    const provider = new MockPokemonProvider({ failNetwork: true });
    render(<SetCardsScreen setId="sv3" setName="Obsidian Flames" />, { wrapper: harness(provider) });

    const retry = await screen.findByRole("button", { name: "Try again" });
    // A retry that never answers: the screen must not fall back to its skeleton.
    provider.setBehavior({ latencyMs: 60_000 });
    await userEvent.click(retry);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByTestId("set-cards-error-only")).toBeInTheDocument();
  });
});
