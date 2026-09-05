import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogProvider, RepositoriesProvider } from "../../../app/contexts.tsx";
import { NavigationProvider } from "../../../app/NavigationProvider.tsx";
import { LibraryProvider, useLibrary } from "../../../app/LibraryProvider.tsx";
import { MockPokemonProvider } from "../../../integrations/pokemon/index.ts";
import { Repositories } from "../../../storage/repositories.ts";
import { CardDetailsScreen } from "./CardDetailsScreen.tsx";

/**
 * `sv3-223` — Charizard ex, Obsidian Flames 223. Its pricing payload carries a
 * holofoil market of $58.42 and nothing else, which is exactly the shape the
 * two-oracle price lookup exists for.
 */
const CARD_ID = "sv3-223";

/**
 * Three printings with three different price provenances, on purpose:
 *
 * - `normal` — priced by TCGdex.
 * - `holo` — no TCGdex price; falls back to the catalog's holofoil market.
 * - `reverse:pokeball` — priced by neither. Pattern foils are absent from
 *   pokemontcg.io entirely, and a patterned reverse must never borrow a plain
 *   reverse's price across a stamp, so this one is genuinely unknown.
 */
const PRINTINGS = {
  tcgdexSetId: "sv03",
  byNumber: {
    "223": [{ type: "normal", price: 1.5 }, { type: "holo" }, { type: "reverse", foil: "pokeball" }],
  },
};

/** `<collection>` as the rest of the app sees it, rendered beside the screen. */
function CollectionProbe() {
  const { collection } = useLibrary();
  return <output data-testid="collection">{JSON.stringify(collection)}</output>;
}

function harness(repos = new Repositories()) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <RepositoriesProvider value={repos}>
          <CatalogProvider base={new MockPokemonProvider()}>
            <NavigationProvider>
              <LibraryProvider>{children}</LibraryProvider>
            </NavigationProvider>
          </CatalogProvider>
        </RepositoriesProvider>
      </QueryClientProvider>
    );
  };
}

/**
 * `/api/printings/:setId` is real HTTP even under the mock catalog — it is our
 * own server, not pokemontcg.io — so it is stubbed here rather than mocked away,
 * which is what lets the failure test exercise the actual retry path.
 */
function stubPrintings(options: { failFirst?: number } = {}) {
  let calls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // The direct-to-TCGdex fallback `loadPrintings` takes when our server is
    // unreachable. Failing it too is what makes a failure actually fail.
    if (!url.includes("/api/printings/")) throw new TypeError("offline");
    calls += 1;
    if (calls <= (options.failFirst ?? 0)) throw new TypeError("network");
    return new Response(JSON.stringify(PRINTINGS), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls: () => calls };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every printing, each markable on its own", () => {
  it("shows one row per printing with its own price, and n/a where there is none", async () => {
    stubPrintings();
    render(<CardDetailsScreen cardId={CARD_ID} />, { wrapper: harness() });

    expect(await screen.findByRole("heading", { name: "Charizard ex", level: 1 })).toBeInTheDocument();

    const normal = await screen.findByRole("button", { name: /^Normal/ });
    expect(normal).toHaveAccessibleName(/\$1\.50/);

    // No TCGdex price for the holo, so the catalog's own market price answers.
    expect(screen.getByRole("button", { name: /^Holofoil/ })).toHaveAccessibleName(/\$58\.42/);

    // Priced by neither source. A blank here would read as loading forever and
    // $0.00 would read as free, so it says so in words.
    const pokeball = screen.getByRole("button", { name: /Poké Ball Reverse/ });
    expect(pokeball).toHaveAccessibleName(/n\/a/);
    expect(pokeball).not.toHaveAccessibleName(/\$0\.00/);
  });

  it("states the set, the collector number and the printed denominator", async () => {
    stubPrintings();
    render(<CardDetailsScreen cardId={CARD_ID} />, { wrapper: harness() });

    await screen.findByRole("heading", { name: "Charizard ex", level: 1 });
    expect(screen.getByText(/Obsidian Flames/)).toBeInTheDocument();
    // 223 is past the printed 197 — a secret, and the denominator is what says so.
    expect(await screen.findByText("223/197")).toBeInTheDocument();
    expect(screen.getByText("Special Illustration Rare")).toBeInTheDocument();
  });

  it("marks one printing without touching the others", async () => {
    stubPrintings();
    render(<CardDetailsScreen cardId={CARD_ID} />, { wrapper: harness() });

    const normal = await screen.findByRole("button", { name: /^Normal/ });
    expect(normal).toHaveAccessibleName(/Not owned/);

    await userEvent.click(normal);

    // `Card` only emits aria-pressed once selected, so the WORD is what carries
    // the off state — which is what the no-colour-alone rule wanted anyway.
    expect(await screen.findByRole("button", { name: /^Normal Owned/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Holofoil/ })).toHaveAccessibleName(/Not owned/);
  });
});

describe("marking is shared state", () => {
  it("reaches every other screen with no reload, carrying the set and number", async () => {
    // The set screen reads the same `collection` array out of the same provider,
    // so this probe standing in for it is the actual mechanism, not a proxy for
    // one. The setId and number are what let that screen place the row.
    stubPrintings();
    render(
      <>
        <CardDetailsScreen cardId={CARD_ID} />
        <CollectionProbe />
      </>,
      { wrapper: harness() },
    );

    await userEvent.click(await screen.findByRole("button", { name: /^Normal/ }));

    const probe = screen.getByTestId("collection");
    expect(JSON.parse(probe.textContent ?? "[]")).toEqual([
      expect.objectContaining({ id: CARD_ID, setId: "sv3", number: "223", finishes: ["normal"] }),
    ]);
  });
});

describe("a flaky printing list", () => {
  it("offers a retry that works, and does not blame the card", async () => {
    // Two failures: the hook retries once by itself, so the error state only
    // shows when a real burst is under way.
    const stub = stubPrintings({ failFirst: 2 });
    render(<CardDetailsScreen cardId={CARD_ID} />, { wrapper: harness() });

    expect(
      await screen.findByText(/printing list could not be reached/i, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing here is wrong with the card/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: /Poké Ball Reverse/ })).toBeInTheDocument();
    expect(screen.queryByText(/printing list could not be reached/i)).not.toBeInTheDocument();
    expect(stub.calls()).toBe(3);
  });

  it("falls back to the printings pricing implies, and warns that patterns are missing", async () => {
    stubPrintings({ failFirst: Number.MAX_SAFE_INTEGER });
    render(<CardDetailsScreen cardId={CARD_ID} />, { wrapper: harness() });

    // The card's own payload vouches for a holofoil, so there is still something
    // to mark — but it cannot know about the Poké Ball reverse.
    expect(await screen.findByRole("button", { name: /^Holofoil/ }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/never reports pattern foils/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Poké Ball Reverse/ })).not.toBeInTheDocument();
  });
});
