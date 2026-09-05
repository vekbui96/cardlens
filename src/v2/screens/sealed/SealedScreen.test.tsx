import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
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
import { Repositories } from "../../../storage/repositories.ts";
import { clearAllStorage } from "../../../storage/versioned.ts";
import { SealedScreen } from "./SealedScreen.tsx";

/**
 * Sealed's states, and one rule above all of them: **an unpriced product is
 * never $0.00.**
 *
 * A pack nobody has priced and a pack that is free are not the same pack, and
 * the two absences on this screen are not the same absence either — a set that
 * never had an ETB printed is a fact about the set, and an ETB with no market
 * price is a fact about the price. Merging them into a dash would say neither.
 */

function harness() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
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

/** Answer `/api/sealed/:setId` per set, and 404 anything else. */
function serve(bySet: Record<string, { status: number; body?: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = /\/sealed\/([^?]+)/.exec(url);
      const answer = match ? bySet[decodeURIComponent(match[1])] : undefined;
      if (!answer) return new Response(null, { status: 404 });
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** Mock catalog sets — `sv3` is Obsidian Flames, `sv2` is Paldea Evolved. */
function own(cardId: string, setId: string) {
  new Repositories().addOwned(cardId, "normal", setId);
}

const OBSIDIAN = {
  setId: "sv3",
  updated: "2026-09-01T06:00:00.000Z",
  prices: [
    { kind: "pack", productName: "Obsidian Flames Booster Pack", price: 4.61 },
    // The product exists upstream and nobody has priced it. NOT zero.
    { kind: "etb", productName: "Obsidian Flames Elite Trainer Box" },
    { kind: "box", productName: "Obsidian Flames Booster Box", price: 128.4 },
  ],
};

beforeEach(() => clearAllStorage());
afterEach(() => vi.unstubAllGlobals());

describe("with nothing collected", () => {
  it("says what to do, and does not look broken", async () => {
    serve({});
    render(<SealedScreen />, { wrapper: harness() });

    expect(await screen.findByRole("heading", { name: "Nothing collected yet" })).toBeInTheDocument();
    expect(screen.getByText(/Mark a card as owned/i)).toBeInTheDocument();
    // Sealed prices are public catalog data — it needs no token of its own, and
    // saying so stops "connect something" being the assumed fix.
    expect(screen.getByText(/no token of their own/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed|error/i)).toBeNull();
  });
});

describe("with sets collected", () => {
  it("prices the sets you hold, one panel each", async () => {
    own("sv3-223", "sv3");
    serve({ sv3: { status: 200, body: OBSIDIAN } });
    render(<SealedScreen />, { wrapper: harness() });

    const panel = await screen.findByRole("heading", { name: "Obsidian Flames" });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("$4.61")).toBeInTheDocument();
    expect(screen.getByText("$128.40")).toBeInTheDocument();
  });

  it("shows an unpriced product as Unavailable, never as $0.00", async () => {
    own("sv3-223", "sv3");
    serve({ sv3: { status: 200, body: OBSIDIAN } });
    render(<SealedScreen />, { wrapper: harness() });

    await screen.findByRole("heading", { name: "Obsidian Flames" });
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("tells a product with no price apart from a product that does not exist", async () => {
    own("sv3-223", "sv3");
    serve({ sv3: { status: 200, body: OBSIDIAN } });
    render(<SealedScreen />, { wrapper: harness() });

    await screen.findByRole("heading", { name: "Obsidian Flames" });
    // The ETB is listed upstream with no price; the bundle was never printed.
    // One dash for both would be a smaller screen and a worse answer.
    const etb = screen.getByText("Elite Trainer Box").parentElement as HTMLElement;
    expect(within(etb).getByText("Unavailable")).toBeInTheDocument();
    const bundle = screen.getByText("Booster Bundle").parentElement as HTMLElement;
    expect(within(bundle).getByText("Not sold")).toBeInTheDocument();
  });

  it("counts what is priced against what was asked for, rather than a bare total", async () => {
    own("sv3-223", "sv3");
    own("sv2-106", "sv2");
    // Paldea Evolved has no sealed product upstream — a normal 404 answer.
    serve({ sv3: { status: 200, body: OBSIDIAN } });
    render(<SealedScreen />, { wrapper: harness() });

    expect(await screen.findByText(/1 of 2 sets priced/i)).toBeInTheDocument();
    expect(await screen.findByText(/no sealed product listed/i)).toBeInTheDocument();
  });

  it("says plainly when nothing came back at all, and offers a retry", async () => {
    own("sv2-106", "sv2");
    serve({});
    render(<SealedScreen />, { wrapper: harness() });

    expect(await screen.findByRole("heading", { name: "No sealed prices right now" })).toBeInTheDocument();
    // The screen genuinely cannot tell "promos have no packs" from "the source
    // is down" — `useSealed` reports both as missing — so it says both.
    expect(screen.getByText(/cannot be reached looks the same/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
