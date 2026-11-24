import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  InputProvider,
  CatalogProvider,
  RepositoriesProvider,
  LayoutModeProvider,
} from "../../../app/contexts.tsx";
import { NavigationProvider } from "../../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../../integrations/pokemon/index.ts";
import { clearAllStorage } from "../../../storage/versioned.ts";
import {
  emptyBinder,
  placeSlot,
  withCondition,
  withQuantity,
  type Binder,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import { TradeShareScreen } from "./TradeShareScreen.tsx";

/**
 * The page a stranger lands on from a shared binder link: a showcase, card
 * first. Driven with nothing but the share endpoint answering, exactly as a
 * visitor with an empty browser meets it.
 */

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
  imageSmall: `https://images.pokemontcg.io/me5/${n}.png`,
});

function sharedBinder(): Binder {
  let b = emptyBinder("b1", "Eeveelution wall", "9", NOW);
  b = placeSlot(b, 0, 0, withCondition(withQuantity(card("4", "Umbreon VMAX"), 2), "LP"), NOW);
  b = placeSlot(b, 0, 4, card("9", "Sylveon V"), NOW);
  b = placeSlot(b, 1, 2, card("12", "Espeon GX"), NOW);
  return b;
}

/**
 * The share answers; everything else 404s. A unit test has no price data, so
 * every card is unpriced, which is the state the page has to stay honest in.
 */
function serve(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/share/")) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

beforeEach(() => clearAllStorage());
afterEach(() => vi.unstubAllGlobals());

describe("TradeShareScreen, the binder showcase", () => {
  it("leads with the cards: a header with the count, and one big tile per card", async () => {
    serve({ kind: "binder", binder: sharedBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    expect(await screen.findByRole("heading", { name: "Eeveelution wall", level: 1 })).toBeTruthy();
    // Four cards: the stack of two is one pocket but two cards.
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Tap a card to see it larger")).toBeTruthy();

    const grid = screen.getByRole("list", { name: "Cards in this binder" });
    expect(within(grid).getAllByRole("button")).toHaveLength(3);
  });

  it("says the unpriced count in the same line as the card count, with no dangling separator", async () => {
    serve({ kind: "binder", binder: sharedBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    await screen.findByRole("heading", { name: "Eeveelution wall", level: 1 });
    const unpriced = await screen.findByText(/\d+ unpriced/);
    const line = unpriced.closest("p");
    expect(line?.textContent).toMatch(/4 cards · \d+ unpriced/);
    expect(line?.textContent?.trim().endsWith("·")).toBe(false);
  });

  it("opens a card large when tapped, and closes again", async () => {
    const user = userEvent.setup();
    serve({ kind: "binder", binder: sharedBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    const grid = await screen.findByRole("list", { name: "Cards in this binder" });
    await user.click(within(grid).getByRole("button", { name: /Sylveon V/ }));

    const dialog = screen.getByRole("dialog", { name: "Sylveon V" });
    expect(within(dialog).getByRole("img", { name: "Sylveon V" })).toBeTruthy();
    // Where it lives, so the visitor can ask for it by pocket.
    expect(within(dialog).getByText(/Page 1, pocket 5/)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Back to the cards" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * iPhone Safari does not focus a button on tap, so "focus whatever was
   * focused before" sent a visitor back to the top of the page. `fireEvent`
   * clicks without focusing, which is exactly that tap.
   */
  it("hands focus back to the tapped card when the large card closes", async () => {
    serve({ kind: "binder", binder: sharedBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    const grid = await screen.findByRole("list", { name: "Cards in this binder" });
    const tile = within(grid).getByRole("button", { name: /Sylveon V/ });
    fireEvent.click(tile);
    const dialog = screen.getByRole("dialog", { name: "Sylveon V" });
    expect(document.activeElement).not.toBe(tile);

    fireEvent.click(within(dialog).getByRole("button", { name: "Back to the cards" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it("Escape closes the large card and focus lands on the tapped card too", async () => {
    serve({ kind: "binder", binder: sharedBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    const grid = await screen.findByRole("list", { name: "Cards in this binder" });
    const tile = within(grid).getByRole("button", { name: /Espeon GX/ });
    fireEvent.click(tile);
    expect(screen.getByRole("dialog", { name: "Espeon GX" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it("says Unpriced for a card nothing prices, never a made-up zero", async () => {
    serve({ kind: "binder", binder: sharedBinder(), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    const grid = await screen.findByRole("list", { name: "Cards in this binder" });
    expect(await within(grid).findAllByText("Unpriced")).toHaveLength(3);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("an empty binder says so, and what to do about it", async () => {
    serve({ kind: "binder", binder: emptyBinder("b2", "Fresh binder", "9", NOW), at: NOW });
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    expect(await screen.findByText(/This binder has no cards in it yet/)).toBeTruthy();
    expect(screen.getByText(/Ask whoever sent the link/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Cards in this binder" })).toBeNull();
  });

  it("an offline visitor is told to reconnect, not that the link is dead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<TradeShareScreen shareId="abc" />, { wrapper: harness() });

    expect(await screen.findByRole("heading", { name: "You're offline" }, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText("This link doesn't work")).toBeNull();
    vi.restoreAllMocks();
  });
});
