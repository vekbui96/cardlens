import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogProvider, InputProvider, RepositoriesProvider } from "../../app/contexts.tsx";
import { NavigationProvider } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { TextEntryProvider } from "../../app/TextEntryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../integrations/pokemon/index.ts";
import type { PokemonCardSummary } from "../../models/cards.ts";
import { Repositories } from "../../storage/repositories.ts";
import { CardDetailsScreen } from "./CardDetailsScreen.tsx";

/**
 * The Pitch Black shape: pokemontcg.io reports `prices: {}` for all 120 cards
 * of `me5`, so the summary carries no `variants` at all. The mock catalog does
 * not contain this card either, so the summary is all the screen has — which is
 * exactly the case where only the printings oracle knows anything.
 */
const SUMMARY: PokemonCardSummary = {
  id: "me5-1",
  name: "Test Bulbasaur",
  setName: "Pitch Black",
  setCode: "PBL",
  collectorNumber: "1",
};

function harness() {
  const mock = new MockInputAdapter();
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const repos = new Repositories();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: mock, mock }}>
          <RepositoriesProvider value={repos}>
            <CatalogProvider base={new MockPokemonProvider()}>
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

/**
 * `/api/printings/:setId` is our own server and real HTTP even under the mock
 * catalog. Everything else (the direct-to-TCGdex fallback) fails, so a `null`
 * body really does mean "no oracle".
 */
function stubPrintings(byNumber: Record<string, unknown[]> | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/api/printings/") || !byNumber) throw new TypeError("offline");
      return new Response(JSON.stringify({ tcgdexSetId: "me05", byNumber }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function actionLabels(): string[] {
  const list = screen.getByRole("listbox", { name: "Card actions" });
  return within(list)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("card details: the printings a card really has, with prices", () => {
  it("prices each real printing on its own row", async () => {
    stubPrintings({
      "001": [
        { type: "normal", price: 0.08 },
        { type: "reverse", price: 0.22 },
      ],
    });
    render(<CardDetailsScreen cardId={SUMMARY.id} summary={SUMMARY} />, { wrapper: harness() });

    expect(await screen.findByText("＋ Normal · $0.08")).toBeInTheDocument();
    expect(actionLabels().slice(0, 2)).toEqual(["＋ Normal · $0.08", "＋ Reverse Holo · $0.22"]);
    expect(screen.getByText("＋ Normal · $0.08")).toHaveAttribute("data-printing-price", "0.08");
  });

  it("lists the printings the oracle names first, ahead of the padded Normal", async () => {
    stubPrintings({ "1": [{ type: "reverse", price: 0.3 }, { type: "holo" }] });
    render(<CardDetailsScreen cardId={SUMMARY.id} summary={SUMMARY} />, { wrapper: harness() });

    await screen.findByText("＋ Reverse Holo · $0.30");
    const labels = actionLabels();
    expect(labels.slice(0, 2)).toEqual(["＋ Reverse Holo · $0.30", "＋ Holofoil"]);
    // Still reachable — just no longer the first thing under the thumb.
    expect(labels).toContain("＋ Normal");
    // Unpriced means no price text at all, never a guessed or zero figure.
    expect(screen.getByText("＋ Holofoil")).not.toHaveAttribute("data-printing-price");
  });

  it("keeps today's order and labels when the oracle is unavailable", async () => {
    stubPrintings(null);
    render(<CardDetailsScreen cardId={SUMMARY.id} summary={SUMMARY} />, { wrapper: harness() });

    await screen.findByText("＋ Normal");
    expect(actionLabels().slice(0, 5)).toEqual([
      "＋ Normal",
      "＋ Reverse Holo",
      "＋ Holofoil",
      "＋ 1st Edition",
      "＋ Shadowless",
    ]);
  });

  it("selecting a priced row marks that printing", async () => {
    stubPrintings({ "1": [{ type: "reverse", price: 0.22 }] });
    render(<CardDetailsScreen cardId={SUMMARY.id} summary={SUMMARY} />, { wrapper: harness() });

    await userEvent.click(await screen.findByText("＋ Reverse Holo · $0.22"));
    expect(await screen.findByText("✓ Reverse Holo · $0.22")).toBeInTheDocument();
  });
});
