import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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
import { Repositories } from "../../../storage/repositories.ts";
import { emptyBinder, placeSlot, type Binder, type CardSlot } from "../../../models/binderLayout.ts";
import type { PokemonSet } from "../../../models/cards.ts";
import { BinderScreen } from "./BinderScreen.tsx";

/**
 * The screen, against the real providers.
 *
 * jsdom lays nothing out, so nothing here asserts a pocket's WIDTH — that is
 * the e2e's job, in a browser that actually does layout. What is asserted here
 * is everything that is a decision: what gets counted, what a button does, and
 * how many requests a binder costs.
 *
 * `matchMedia` is stubbed to "no match" by the test setup, so this exercises
 * the PHONE branch: the picker is a bottom sheet that appears with a selection.
 */

const BINDER_ID = "binder-under-test";

function harness(catalog: MockPokemonProvider = new MockPokemonProvider({})) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: new MockInputAdapter(), mock: new MockInputAdapter() }}>
          <RepositoriesProvider>
            <CatalogProvider base={catalog}>
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

/** A handful of real printings, from nine different sets. */
const CARDS: Array<[string, string]> = [
  ["base2-4", "base2"],
  ["ecard3-13", "ecard3"],
  ["ex2-6", "ex2"],
  ["ex10-8", "ex10"],
  ["pop3-3", "pop3"],
  ["dp5-23", "dp5"],
  ["pl2-26", "pl2"],
  ["hgss3-28", "hgss3"],
  ["col1-45", "col1"],
];

function cardSlot(i: number): CardSlot {
  const [cardId] = CARDS[i % CARDS.length];
  return { kind: "card", cardId, finish: "holo", name: "Jolteon", collectorNumber: String(i + 1) };
}

function save(binder: Binder): Binder {
  new Repositories().saveBinder(binder);
  return binder;
}

function stored(): Binder | undefined {
  return new Repositories().getBinders().find((b) => b.id === BINDER_ID);
}

let fetches: string[];

beforeEach(() => {
  clearAllStorage();
  fetches = [];
  /*
   * No printings oracle in a unit test. 404 is the "this set is unknown"
   * answer, which is what stops `loadPrintings` falling through to the real
   * TCGdex and making one request PER CARD.
   */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      fetches.push(String(input));
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("the binder that is not there", () => {
  it("says so, and offers the way back", () => {
    render(<BinderScreen binderId="gone" />, { wrapper: harness() });

    expect(screen.getByRole("heading", { name: "Binder not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to binders" })).toBeInTheDocument();
  });
});

describe("the cover is not a pocket", () => {
  it("is excluded from the filled count", () => {
    // "26 of 28 filled" counts pockets. A cover is part of the binder, not part
    // of the contents — the same way the clear sleeve on a Vault X is.
    let binder = emptyBinder(BINDER_ID, "Jolteon", "9", Date.now());
    binder = placeSlot(binder, 0, 0, cardSlot(0), Date.now());
    save({ ...binder, cover: cardSlot(1) });

    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.getByText("1 of 9 pockets filled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cover, Jolteon/ })).toBeInTheDocument();
  });

  it("survives a change of pocket size, which re-flows everything that IS a pocket", async () => {
    let binder = emptyBinder(BINDER_ID, "Jolteon", "9", Date.now());
    binder = placeSlot(binder, 0, 8, cardSlot(0), Date.now());
    save({ ...binder, cover: cardSlot(1) });

    const user = userEvent.setup();
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "12-pocket" }));

    expect(stored()?.cover).toBeTruthy();
    expect(stored()?.format).toBe("12");
    // Reading order is preserved; positions cannot be. The card was in the last
    // pocket of a 3-wide page and is now in the first of a 4-wide one.
    expect(stored()?.pages[0].slots[0]).toBeTruthy();
  });
});

describe("pages are added and removed on purpose", () => {
  it("keeps a page that was added, because nothing trims trailing empties", async () => {
    // The bug this guards: a trim ran on every commit, so "Add page" grew the
    // binder and the same call dropped the new empty page again. The button did
    // nothing at all, silently, for as long as binders existed.
    save(emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()));
    const user = userEvent.setup();
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Add page" }));

    expect(stored()?.pages).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Page 2" })).toBeInTheDocument();
    expect(screen.getByText(/across 2 pages/)).toBeInTheDocument();
  });

  it("refuses to remove the only page", () => {
    save(emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()));
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.getByRole("button", { name: "Remove page" })).toBeDisabled();
  });

  it("refuses to remove a page that holds cards, because that has no undo", async () => {
    let binder = emptyBinder(BINDER_ID, "Jolteon", "9", Date.now());
    binder = placeSlot(binder, 1, 0, cardSlot(0), Date.now());
    save(binder);
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.getByRole("button", { name: "Remove page" })).toBeDisabled();
  });

  it("removes an empty last page when asked", async () => {
    const user = userEvent.setup();
    save({ ...emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()), pages: [{ slots: {} }, { slots: {} }] });
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Remove page" }));
    expect(stored()?.pages).toHaveLength(1);
  });
});

describe("a card you do not own", () => {
  it("sits in its pocket, shadowed and tagged, and stays placeable", async () => {
    // A binder is a plan, and planning around gaps is the point.
    let binder = emptyBinder(BINDER_ID, "Jolteon", "9", Date.now());
    binder = placeSlot(binder, 0, 0, cardSlot(0), Date.now());
    save(binder);
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.getByRole("button", { name: /^Pocket 1, Jolteon, not owned/ })).toBeInTheDocument();
    expect(screen.getByText("Don’t own")).toBeInTheDocument();
  });
});

describe("choosing a pocket", () => {
  it("opens the picker on it, and choosing it again shuts it", async () => {
    save(emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()));
    const user = userEvent.setup();
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.queryByRole("dialog", { name: "Cards" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pocket 3, empty" }));
    const sheet = await screen.findByRole("dialog", { name: "Cards" });
    expect(sheet).toHaveTextContent("Filling pocket 3 on page 1");

    await user.click(screen.getByRole("button", { name: "Pocket 3, empty" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cards" })).not.toBeInTheDocument());
  });

  it("names the cover rather than a pocket number, because it has none", async () => {
    save(emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()));
    const user = userEvent.setup();
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Cover, empty" }));
    expect(await screen.findByRole("dialog", { name: "Cards" })).toHaveTextContent("Filling the cover");
  });
});

describe("settings", () => {
  it("keeps page actions on the toolbar and settings behind the disclosure", async () => {
    // Things pressed constantly stay out; things decided once move in.
    save(emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()));
    const user = userEvent.setup();
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    const toggle = screen.getByRole("button", { name: "Settings" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "9-pocket" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "9-pocket" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For trade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show value" })).toBeInTheDocument();
    // Add page does not move into the panel; it stays where it was.
    expect(screen.getByRole("button", { name: "Add page" })).toBeInTheDocument();
  });

  it("shows what is switched on without opening the panel", async () => {
    // A binder quietly still on offer is exactly the thing worth noticing from
    // the outside — and it is a word, not just a colour.
    save(emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()));
    const user = userEvent.setup();
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "For trade" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.queryByRole("button", { name: "✓ For trade" })).not.toBeInTheDocument();
    expect(screen.getByText("For trade")).toBeInTheDocument();
  });

  it("counts COPIES on a trade binder, because that is what is being offered", async () => {
    let binder = emptyBinder(BINDER_ID, "Jolteon", "9", Date.now());
    binder = placeSlot(binder, 0, 0, { ...cardSlot(0), quantity: 3 }, Date.now());
    save({ ...binder, forTrade: true });
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.getByText(/3 cards in 1 pocket/)).toBeInTheDocument();
  });
});

describe("the request budget", () => {
  it("asks the printings oracle once per SET, not once per card", async () => {
    /*
     * The measurement this screen exists under: the Riolu binder spans thirty
     * sets across three hundred pockets, and pricing it must cost thirty
     * requests rather than three hundred. Here: 27 pockets, 9 distinct sets.
     *
     * The set list has to be stubbed because `setPrintingsQuery` is disabled
     * until a set's NAME is known — the server matches sets by name, so asking
     * before it is known would ask the wrong question and cache the wrong
     * answer under the right key.
     */
    const catalog = new MockPokemonProvider({});
    const sets = CARDS.map(([, setId]) => ({ id: setId, name: setId.toUpperCase() }) as PokemonSet);
    vi.spyOn(catalog, "listSets").mockResolvedValue(sets);

    let binder = emptyBinder(BINDER_ID, "Jolteon", "9", Date.now());
    for (let page = 0; page < 3; page++) {
      for (let i = 0; i < 9; i++) binder = placeSlot(binder, page, i, cardSlot(page * 9 + i), Date.now());
    }
    save(binder);

    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness(catalog) });

    const printings = () => fetches.filter((url) => url.includes("/printings/"));
    await waitFor(() => expect(printings().length).toBeGreaterThan(0));
    // Settle, so a late request cannot pass the assertion by not having
    // happened yet.
    await waitFor(() => expect(printings()).toHaveLength(9));

    expect(new Set(printings()).size).toBe(9);
    expect(screen.getByText("27 of 27 pockets filled")).toBeInTheDocument();
  });

  it("asks for no set at all until the picker is open", async () => {
    // The picker costs a set of its own. A rail that is shut until asked for
    // should cost nothing, so it is not mounted until it is open — on a phone,
    // that means until a pocket is selected.
    save(emptyBinder(BINDER_ID, "Jolteon", "9", Date.now()));
    const catalog = new MockPokemonProvider({});
    const getCardsBySet = vi.spyOn(catalog, "getCardsBySet");
    const user = userEvent.setup();
    render(<BinderScreen binderId={BINDER_ID} />, { wrapper: harness(catalog) });

    expect(getCardsBySet).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await screen.findByRole("dialog", { name: "Cards" });
    await waitFor(() => expect(getCardsBySet).toHaveBeenCalled());
  });
});
