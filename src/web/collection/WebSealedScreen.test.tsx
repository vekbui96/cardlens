import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CatalogProvider,
  InputProvider,
  LayoutModeProvider,
  RepositoriesProvider,
} from "../../app/contexts.tsx";
import { NavigationProvider, useNavigation } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../integrations/pokemon/index.ts";
import { clearAllStorage } from "../../storage/versioned.ts";
import { WebSealedScreen } from "./WebSealedScreen.tsx";

function Where() {
  return <span data-testid="where">{useNavigation().screen.name}</span>;
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <InputProvider value={{ adapter: new MockInputAdapter(), mock: new MockInputAdapter() }}>
        <RepositoriesProvider>
          <CatalogProvider base={new MockPokemonProvider({})}>
            <LayoutModeProvider mode="web">
              <NavigationProvider>
                <LibraryProvider>
                  <Where />
                  {children}
                </LibraryProvider>
              </NavigationProvider>
            </LayoutModeProvider>
          </CatalogProvider>
        </RepositoriesProvider>
      </InputProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => clearAllStorage());
afterEach(() => vi.unstubAllGlobals());

describe("WebSealedScreen with nothing collected", () => {
  it("shows the empty copy and a Browse sets button instead of a blank screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    render(<WebSealedScreen />, { wrapper: Wrapper });

    expect(screen.getByRole("heading", { name: "Sealed prices" })).toBeInTheDocument();
    expect(
      screen.getByText(/Mark a card as owned and its set.s sealed prices show up here/i),
    ).toBeInTheDocument();
    // The "Pack and box prices for the N sets" summary is for a collector with sets.
    expect(screen.queryByText(/Pack and box prices for the/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Browse sets" }));
    expect(screen.getByTestId("where")).toHaveTextContent("sets");
  });
});
