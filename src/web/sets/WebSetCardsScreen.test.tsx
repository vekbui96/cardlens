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
import type { RawCard } from "../../integrations/pokemon/schema.ts";
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

/** Wraps a body in a Response, the shape every fetch stub in this file needs. */
function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Routes by URL — the screen can ask for printings separately as well. */
function serve() {
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

/** Serves a single bespoke card + its printings, for tests that need data
 * MOCK_CARDS/PRINTINGS cannot express (here: a card with no catalog price). */
function serveCustom(
  cards: RawCard[],
  printings: {
    tcgdexSetId: string;
    byNumber: Record<string, { type: string; foil?: string; price?: number }[]>;
  },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/set-information/")) {
        return json({ setId: SET_ID, cards: { data: cards }, printings });
      }
      if (href.includes("/printings/")) return json(printings);
      return Promise.reject(new TypeError(`unexpected fetch: ${href}`));
    }),
  );
}

/**
 * One tile is one printing now, so a tile is identified by BOTH the collector
 * number and the finish. The mark button carries its held state in the name;
 * the number beside it is a separate control that opens the sheet.
 */
// Anchored on the held-state suffix: the details control beside it carries
// the same number and finish, so an unanchored match finds both.
const marked = (number: string, finish: string) => new RegExp(`, ${number}, ${finish}, (not )?owned$`);
const slot = (number: string, finish: string) => screen.getByRole("button", { name: marked(number, finish) });
const findSlot = (number: string, finish: string) =>
  screen.findByRole("button", { name: marked(number, finish) });
/** Every marking control, in render order — both held and unheld end in "owned". */
const allSlots = () => screen.findAllByRole("button", { name: /owned$/ });
const details = (number: string, finish: string) =>
  screen.getByRole("button", { name: new RegExp(`^Details for .*, ${number}, ${finish}$`) });

beforeEach(() => {
  localStorage.clear();
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebSetCardsScreen", () => {
  it("gives every printing its own tile, the way a binder does", async () => {
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    // 125 has two printings, so it occupies two pockets side by side rather
    // than one tile claiming "0 of 2".
    expect(await findSlot("125", "Normal")).toBeInTheDocument();
    expect(slot("125", "Reverse Holo")).toBeInTheDocument();

    // A card that exists in one printing only must not invent a second pocket.
    expect(slot("223", "Holofoil")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: marked("223", "Reverse Holo") })).toBeNull();
  });

  it("marks and unmarks a printing by tapping its tile", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    const reverse = await findSlot("125", "Reverse Holo");
    expect(reverse).toHaveAttribute("aria-pressed", "false");

    await user.click(reverse);
    expect(slot("125", "Reverse Holo")).toHaveAttribute("aria-pressed", "true");
    // The other pocket of the same card is untouched — that is the whole point
    // of splitting them.
    expect(slot("125", "Normal")).toHaveAttribute("aria-pressed", "false");

    // Tapping again removes it: the tile is the whole add/remove affordance.
    await user.click(slot("125", "Reverse Holo"));
    expect(slot("125", "Reverse Holo")).toHaveAttribute("aria-pressed", "false");
  });

  it("hides held printings behind the missing-only filter", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await user.click(await findSlot("125", "Normal"));
    await user.click(screen.getByRole("button", { name: "Missing only" }));

    // Held pocket gone, the still-missing pocket of the SAME card stays.
    expect(screen.queryByRole("button", { name: marked("125", "Normal") })).toBeNull();
    expect(slot("125", "Reverse Holo")).toBeInTheDocument();
  });

  it("opens the sheet from the number, not the art", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(details("125", "Normal"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes every printing of a card in one action", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await user.click(await findSlot("125", "Normal"));
    await user.click(slot("125", "Reverse Holo"));

    await user.click(details("125", "Normal"));
    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: /Remove all 2 printings/ }));

    // The sheet closes and both pockets are empty again.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(slot("125", "Normal")).toHaveAttribute("aria-pressed", "false");
    expect(slot("125", "Reverse Holo")).toHaveAttribute("aria-pressed", "false");
  });

  it("offers no remove action on a card with nothing held", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(details("125", "Normal"));

    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("excludes a printing from the set so it stops reading as missing", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(details("125", "Normal"));

    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Exclude Reverse Holo" }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    // Its own state, not "owned" and not "missing".
    expect(screen.getByRole("button", { name: /, 125, Reverse Holo, excluded$/ })).toBeInTheDocument();

    // And gone from what is still wanted, which is the whole point.
    await user.click(screen.getByRole("button", { name: "Missing only" }));
    expect(screen.queryByRole("button", { name: /, 125, Reverse Holo/ })).toBeNull();
    expect(slot("125", "Normal")).toBeInTheDocument();
  });

  it("puts an excluded printing back", async () => {
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(details("125", "Normal"));
    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Exclude Reverse Holo" }));
    await user.click(within(sheet).getByRole("button", { name: "Include Reverse Holo" }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    expect(slot("125", "Reverse Holo")).toHaveAttribute("aria-pressed", "false");
  });

  it("headlines a card with its dearest printing when the catalog has no price", async () => {
    const user = userEvent.setup();
    // Pitch Black returns prices: {} for all 120 cards, so the catalog price is
    // absent and the sheet used to read "Unavailable" on a card TCGdex prices.
    const card: RawCard = {
      id: "sv3-007",
      name: "Test Card",
      number: "007",
      set: { id: SET_ID, name: SET_NAME },
    };
    const printings = {
      tcgdexSetId: "sv03",
      byNumber: {
        "007": [
          { type: "normal", price: 1.5 },
          { type: "reverse", price: 4.25 },
        ],
      } as Record<string, { type: string; foil?: string; price?: number }[]>,
    };
    serveCustom([card], printings);
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("007", "Normal");
    await user.click(details("007", "Normal"));

    // The reverse printing row also shows $4.25, so scope to the headline specifically.
    expect(await screen.findByTestId("sheet-headline-price")).toHaveTextContent("$4.25");
  });

  it("orders by value when asked, and returns to binder order", async () => {
    const user = userEvent.setup();
    const cards: RawCard[] = [
      {
        id: "sv3-301",
        name: "Cheap Card",
        number: "301",
        set: { id: SET_ID, name: SET_NAME },
        tcgplayer: { prices: { normal: { market: 1 } } },
      },
      {
        id: "sv3-302",
        name: "Dear Card",
        number: "302",
        set: { id: SET_ID, name: SET_NAME },
        tcgplayer: { prices: { normal: { market: 50 } } },
      },
    ];
    const printings = {
      tcgdexSetId: "sv03",
      byNumber: {
        "301": [{ type: "normal", price: 1 }],
        "302": [{ type: "normal", price: 50 }],
      } as Record<string, { type: string; foil?: string; price?: number }[]>,
    };
    serveCustom(cards, printings);
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    const binderOrder = await allSlots();
    expect(binderOrder[0]).toHaveAccessibleName(/Cheap Card/);

    await user.click(screen.getByRole("button", { name: "By value" }));

    const valueOrder = await allSlots();
    expect(valueOrder[0]).toHaveAccessibleName(/Dear Card/);

    await user.click(screen.getByRole("button", { name: "By value" }));

    const restored = await allSlots();
    expect(restored[0]).toHaveAccessibleName(/Cheap Card/);
  });
});
