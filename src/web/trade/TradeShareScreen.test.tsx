import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  InputProvider,
  CatalogProvider,
  RepositoriesProvider,
  LayoutModeProvider,
} from "../../app/contexts.tsx";
import { NavigationProvider } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../integrations/pokemon/index.ts";
import { clearAllStorage } from "../../storage/versioned.ts";
import {
  emptyBinder,
  placeSlot,
  withCondition,
  withQuantity,
  type Binder,
  type CardSlot,
} from "../../models/binderLayout.ts";
import { TradeShareScreen } from "./TradeShareScreen.tsx";

const NOW = 1_800_000_000_000;

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: new MockInputAdapter(), mock: new MockInputAdapter() }}>
          <RepositoriesProvider>
            <CatalogProvider base={new MockPokemonProvider({})}>
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

const card = (n: string, name: string): CardSlot => ({
  kind: "card",
  cardId: `me5-${n}`,
  finish: "normal",
  collectorNumber: n,
  name,
});

/** A binder with three cards, one of them a graded stack of three. */
function tradeBinder(): Binder {
  let b = emptyBinder("b1", "Spares and dupes", "9", NOW);
  b = placeSlot(b, 0, 0, withCondition(withQuantity(card("4", "Umbreon VMAX"), 3), "LP"), NOW);
  b = placeSlot(b, 0, 4, card("9", "Sylveon V"), NOW);
  b = placeSlot(b, 1, 2, card("12", "Espeon GX"), NOW);
  return b;
}

/**
 * Answer the share endpoint and refuse everything else.
 *
 * The printings oracle is deliberately 404ed: a unit test has no price data, so
 * every pocket reads "n/a", which is exactly the state this page has to stay
 * honest in — it is the same thing that happens live for a set nothing prices.
 */
function serve(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/share/")) {
        return new Response(status === 200 ? JSON.stringify(body) : null, {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

beforeEach(() => clearAllStorage());
afterEach(() => vi.unstubAllGlobals());

describe("TradeShareScreen", () => {
  it("shows the binder, and counts copies rather than pockets", async () => {
    serve({ kind: "binder", binder: tradeBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    // Five cards in three pockets: the stack of three is one pocket.
    expect(await screen.findByText(/5 cards in 3 pockets/)).toBeTruthy();
    expect(screen.getByText("Spares and dupes")).toBeTruthy();
    expect(screen.getByText("For trade")).toBeTruthy();
  });

  it("marks a stacked pocket with its count and grade", async () => {
    serve({ kind: "binder", binder: tradeBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    // The pocket carries both facts, and the accessible name spells them out
    // rather than reading "x3 LP" aloud.
    const pocket = await screen.findByLabelText(/Umbreon VMAX.*3 copies.*Lightly played/);
    expect(within(pocket).getByText("×3 LP")).toBeTruthy();
  });

  it("addresses every pocket by page and pocket number", async () => {
    serve({ kind: "binder", binder: tradeBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    await screen.findByText("Spares and dupes");
    // Page 1 pocket 1, page 1 pocket 5, page 2 pocket 3 — the addresses the two
    // collectors will say to each other.
    expect(screen.getByText("1·1")).toBeTruthy();
    expect(screen.getByText("1·5")).toBeTruthy();
    expect(screen.getByText("2·3")).toBeTruthy();
  });

  it("lists every card with its address, and jumps back to the pocket", async () => {
    const user = userEvent.setup();
    serve({ kind: "binder", binder: tradeBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    await screen.findByText("Spares and dupes");
    await user.click(screen.getByRole("button", { name: "List" }));

    const list = screen.getByTestId("trade-list");
    expect(within(list).getByText("Umbreon VMAX")).toBeTruthy();
    // With no price to multiply, the money column still states the count —
    // "3 × Unavailable" would not be a sum, but three of them is still the
    // thing being decided about.
    expect(within(list).getByText("3 copies")).toBeTruthy();
    // The binding between the two views: a row sends you to the pocket it names.
    await user.click(within(list).getByRole("button", { name: /Espeon GX, page 2 pocket 3/ }));
    expect(screen.getByTestId("trade-binder")).toBeTruthy();
  });

  it("never counts an unpriced pocket as worth nothing", async () => {
    serve({ kind: "binder", binder: tradeBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    // With no price data at all the total must read as unmeasured, not as $0.00
    // — whole sets genuinely have no market price, and a binder of them is not
    // worthless.
    await screen.findByText("Spares and dupes");
    expect(await screen.findByText(/0 of 5 cards priced/)).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("says a revoked link is gone, without saying it ever existed", async () => {
    serve(null, 404);
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });
    expect(await screen.findByText("This trade link is no longer shared")).toBeTruthy();
  });

  it("treats a set share opened as a trade link the same as a dead one", async () => {
    // The two kinds share an id space. A set link on this screen is not a trade
    // binder, and there is nothing the visitor could do differently about it.
    serve({ kind: "set", setId: "me5", setName: "Pitch Black", owned: [] });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });
    expect(await screen.findByText("This trade link is no longer shared")).toBeTruthy();
  });
});
