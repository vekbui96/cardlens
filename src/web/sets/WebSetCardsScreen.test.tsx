import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import { Repositories } from "../../storage/repositories.ts";
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
 * The set data, plus a /api/share whose answer the test chooses.
 *
 * Sharing is the only path on this screen that talks to the companion server,
 * and how it FAILS is the whole subject of those tests, so the share route is a
 * parameter. The collection and binder routes answer emptily because giving the
 * device a token makes LibraryProvider sync on mount — an unrouted request
 * there would fail these tests for a reason that has nothing to do with sharing.
 */
function serveShare(share: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/share")) return share();
      if (href.includes("/collection")) return json({ rows: [], at: 1 });
      if (href.includes("/binders")) return json({ binders: [], at: 1 });
      if (href.includes("/set-information/")) {
        return json({ setId: SET_ID, cards: { data: setCards }, printings: PRINTINGS });
      }
      if (href.includes("/printings/")) return json(PRINTINGS);
      return Promise.reject(new TypeError(`unexpected fetch: ${href}`));
    }),
  );
}

/** A sync token on this device. Without one the screen never asks the server at all. */
function connect() {
  new Repositories().setSyncSettings({ token: "test-token" });
}

/**
 * A readable clipboard. Called AFTER userEvent.setup(), which installs a stub
 * of its own — the last definition wins, and this is the one the test can read.
 */
function clipboardSpy() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
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

    // Gone from the grid: it is not part of this set, so leaving it visible is
    // clutter that can never resolve.
    expect(screen.queryByRole("button", { name: /, 125, Reverse Holo/ })).toBeNull();
    // The other pocket of the same card is untouched.
    expect(slot("125", "Normal")).toBeInTheDocument();

    // Revealed on demand, and named as excluded rather than as missing.
    await user.click(screen.getByRole("button", { name: "Excluded (1)" }));
    expect(await screen.findByRole("button", { name: /, 125, Reverse Holo, excluded$/ })).toBeInTheDocument();
  });

  it("offers no excluded control until something is excluded", async () => {
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });
    await findSlot("125", "Normal");
    expect(screen.queryByRole("button", { name: /^Excluded \(/ })).toBeNull();
  });

  it("keeps an all-excluded card recoverable", async () => {
    // 223 has a single printing, so excluding it removes the card from the
    // grid entirely. Without the reveal there would be no route back to its
    // sheet, and no way to undo.
    const user = userEvent.setup();
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("223", "Holofoil");
    await user.click(details("223", "Holofoil"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Exclude Holofoil" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("button", { name: /, 223, / })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Excluded (1)" }));
    await user.click(await screen.findByRole("button", { name: /^Details for .*, 223, Holofoil$/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Include Holofoil" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));

    expect(slot("223", "Holofoil")).toHaveAttribute("aria-pressed", "false");
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

    // Back in the grid without needing the reveal, because it is no longer
    // excluded at all.
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

/**
 * Sharing, and the fallback that used to happen silently.
 *
 * The snapshot fallback is deliberate — a shareable link beats an error — but
 * it swaps a live link for a ~2,000-character frozen one, and it used to say so
 * only in a chip that reverted after 2.5 seconds. That is the "silent early
 * return" shape this codebase keeps being bitten by: the action appears to
 * succeed and the collector keeps marking cards into a link that has already
 * stopped listening. These tests pin the three things that fix it — the cause
 * is named, the freeze is stated, and the retry is one tap away.
 */
describe("WebSetCardsScreen sharing", () => {
  it("says the server could not be reached rather than quietly copying a snapshot", async () => {
    const user = userEvent.setup();
    const writeText = clipboardSpy();
    connect();
    serveShare(() => Promise.reject(new TypeError("connection refused")));
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(screen.getByRole("button", { name: "Share" }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/server could not be reached/i);
    // Not just "offline": what was copied is a different object, and saying so
    // is the entire point of the notice.
    expect(notice).toHaveTextContent(/frozen at what you own right now/i);

    // The fallback itself is intact — a link was still produced and copied.
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#/showcase/"));
    expect(await screen.findByRole("button", { name: "Snapshot link copied" })).toBeInTheDocument();
  });

  it("names a missing token instead of blaming the server", async () => {
    // Two different failures with two different fixes: entering a token here,
    // versus waiting for a machine that is switched off. One message for both
    // would send the user to look at the wrong one.
    const user = userEvent.setup();
    clipboardSpy();
    const fetchMock = vi.fn();
    serveShare(() => {
      fetchMock();
      return Promise.reject(new TypeError("should never be asked"));
    });
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(screen.getByRole("button", { name: "Share" }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/not connected to the server/i);
    expect(notice).toHaveTextContent(/Collection screen/);
    // A device with no token cannot mint a link, so it must not pretend to try.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes a rejected token from an unreachable server", async () => {
    // 401 stays broken until someone re-enters the token, exactly as sync
    // treats it. Calling it "offline" would have the user power-cycling a
    // server that is answering perfectly well.
    const user = userEvent.setup();
    clipboardSpy();
    connect();
    serveShare(() => Promise.resolve(new Response(null, { status: 401 })));
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(screen.getByRole("button", { name: "Share" }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/rejected this device's sync token/i);
    expect(notice).not.toHaveTextContent(/could not be reached/i);
  });

  it("says the server has sync switched off rather than calling it unreachable", async () => {
    // 503 is `requireToken` with no COLLECTION_TOKEN set on the server. The
    // machine is up and answering; the fix is in its .env, and no amount of
    // retrying from the device will reach it.
    const user = userEvent.setup();
    clipboardSpy();
    connect();
    serveShare(() => Promise.resolve(new Response(null, { status: 503 })));
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(screen.getByRole("button", { name: "Share" }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/sync switched off/i);
    expect(notice).not.toHaveTextContent(/could not be reached/i);
  });

  it("gets a live link from the notice, one tap after the failure", async () => {
    const user = userEvent.setup();
    const writeText = clipboardSpy();
    connect();
    let up = false;
    serveShare(() => (up ? json({ id: "abc123" }) : Promise.reject(new TypeError("connection refused"))));
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByRole("alert");

    up = true;
    await user.click(screen.getByRole("button", { name: "Try live link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#/live/abc123")));
    // The notice clears on success, which is what makes the retry visibly
    // resolve rather than leaving a warning standing over a working link.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByRole("button", { name: "Live link copied" })).toBeInTheDocument();
  });

  it("says nothing extra when the live link works", async () => {
    const user = userEvent.setup();
    const writeText = clipboardSpy();
    connect();
    serveShare(() => json({ id: "abc123" }));
    render(<WebSetCardsScreen setId={SET_ID} setName={SET_NAME} />, { wrapper: harness() });

    await findSlot("125", "Normal");
    await user.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#/live/abc123")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
