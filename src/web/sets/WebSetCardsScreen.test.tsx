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
import type * as PokemonCatalog from "../../integrations/pokemon/index.ts";
import { MOCK_CARDS } from "../../integrations/pokemon/fixtures.ts";
import { WebSetCardsScreen } from "./WebSetCardsScreen.tsx";

// The aggregate endpoint switches itself off under mocks; these tests drive the
// server with `fetch` instead so the grid gets real printings.
vi.mock("../../integrations/pokemon/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof PokemonCatalog>()),
  shouldUseMocks: () => false,
}));

const SET_ID = "sv3";
const SET_NAME = "Obsidian Flames";
const setCards = MOCK_CARDS.filter((c) => c.set.id === SET_ID);

/** 125 has two printings, 223 only one — the two cases the grid must show apart. */
const PRINTINGS = {
  tcgdexSetId: "sv03",
  byNumber: {
    "125": [{ type: "normal" }, { type: "reverse" }],
    "223": [{ type: "holo" }],
  } as Record<string, { type: string; foil?: string }[]>,
};

function harness() {
  const mock = new MockInputAdapter();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: mock, mock }}>
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

/** Routes by URL — the screen can ask for printings separately as well. */
function serve() {
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/set-information/")) {
        return json({ setId: SET_ID, cards: { data: setCards }, printings: PRINTINGS });
      }
      if (href.includes("/printings/")) return json(PRINTINGS);
      return Promise.reject(new TypeError(`unexpected fetch: ${href}`));
    }),
  );
}

const tileName = (number: string) => new RegExp(`, ${number}, \\d of \\d printings owned`);
/** Waits for the grid to arrive. */
const findTile = (number: string) => screen.findByRole("button", { name: tileName(number) });
const tile = (number: string) => screen.getByRole("button", { name: tileName(number) });

beforeEach(() => {
  localStorage.clear();
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebSetCardsScreen", () => {
  it("shows the set as a grid of cards with their printing counts", async () => {
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    expect(await findTile("125")).toBeInTheDocument();
    expect(tile("125")).toHaveAccessibleName(/0 of 2 printings owned/);
    // A card that exists in one printing only must not claim two.
    expect(tile("223")).toHaveAccessibleName(/0 of 1 printings owned/);
  });

  it("marks a printing by tapping it in the sheet", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await user.click(await findTile("125"));

    const sheet = screen.getByRole("dialog");
    // Tapping the printing itself — no collect mode, no picker. Those exist on
    // the glasses only because a pinch must be told which printing it means.
    await user.click(within(sheet).getByRole("button", { name: "Reverse Holo" }));
    expect(within(sheet).getByRole("button", { name: "Reverse Holo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(tile("125")).toHaveAccessibleName(/1 of 2 printings owned/);
  });

  it("only offers printings the card actually has", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await user.click(await findTile("223"));
    const sheet = screen.getByRole("dialog");

    expect(within(sheet).getByRole("button", { name: "Holofoil" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Reverse Holo" })).toBeNull();
  });

  it("hides completed cards behind the missing-only filter", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    // Complete 223 — its single holo printing.
    await user.click(await findTile("223"));
    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Holofoil" }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(tile("223")).toHaveAccessibleName(/1 of 1 printings owned/);

    await user.click(screen.getByRole("button", { name: "Missing only" }));

    expect(screen.queryByRole("button", { name: /, 223, / })).toBeNull();
    expect(tile("125")).toBeInTheDocument();
  });

  it("closes the sheet on Escape", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await user.click(await findTile("125"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
