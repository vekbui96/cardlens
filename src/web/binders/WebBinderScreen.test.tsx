import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
import { Repositories } from "../../storage/repositories.ts";
import { emptyBinder, type CardSlot } from "../../models/binderLayout.ts";
import { WebBinderScreen } from "./WebBinderScreen.tsx";

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

beforeEach(() => {
  clearAllStorage();
  new Repositories().saveBinder(emptyBinder(BINDER_ID, "Favourites", "9", Date.now()));
  // No printings oracle in a unit test. 404 is the "this set is unknown"
  // answer, which stops the hook falling through to the real TCGdex.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function placedCards(): CardSlot[] {
  const binder = new Repositories().getBinders().find((b) => b.id === BINDER_ID);
  return Object.values(binder?.pages[0].slots ?? {}).filter((s): s is CardSlot => s.kind === "card");
}

describe("WebBinderScreen search", () => {
  it("finds a card in a set the picker is not showing, and places it", async () => {
    // The whole point of the search: the binder defaults to Pitch Black, and
    // Umbreon VMAX is in Evolving Skies. Without a name search it is reachable
    // only by remembering that and finding the set among 218 in a dropdown.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Umbreon");
    await user.click(screen.getByRole("button", { name: "Search" }));

    const result = await screen.findByRole("button", { name: /Umbreon VMAX, 215, Evolving Skies/ });
    await user.click(result);

    // Two taps, because a result carries no trustworthy printing list: the
    // second names the printing the pocket holds.
    await user.click(await screen.findByRole("button", { name: "Holofoil" }));

    expect(placedCards()).toEqual([
      expect.objectContaining({ cardId: "swsh7-215", finish: "holo", name: "Umbreon VMAX" }),
    ]);
  });

  it("asks for every match, not the short list a focus ring gets", async () => {
    // The 40-card cap is right for stepping through results one pinch at a
    // time and wrong here: a Charizard missing from the picker is
    // indistinguishable from a Charizard that does not exist.
    const user = userEvent.setup();
    const catalog = new MockPokemonProvider({});
    const searchCards = vi.spyOn(catalog, "searchCards");
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness(catalog) });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Charizard");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findAllByRole("button", { name: /Charizard/ })).not.toHaveLength(0);

    expect(searchCards).toHaveBeenCalledWith("Charizard", expect.objectContaining({ full: true }));
  });

  it("advances to the next pocket, so a second card is added and not swapped in", async () => {
    // The bug this guards: the pocket stayed selected after a place, so every
    // card picked after the first REPLACED it. The binder never grew past one
    // card and nothing said why — it reads exactly like the search refusing to
    // add anything.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Charizard");
    await user.click(screen.getByRole("button", { name: "Search" }));

    const place = async (name: RegExp) => {
      await user.click((await screen.findAllByRole("button", { name }))[0]);
      const chips = await screen.findAllByRole("button", { name: /^(Normal|Reverse Holo|Holofoil)$/ });
      await user.click(chips[0]);
    };

    await place(/^Charizard ex, 125/);
    await place(/^Charizard ex, 223/);

    expect(placedCards()).toHaveLength(2);
  });

  it("offers the printings in a sheet under the results, not in place of them", async () => {
    // The results have to stay on screen: choosing between a card's printings
    // is a comparison, and swapping the list out removes what it is against.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Umbreon");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Umbreon VMAX, 215/ }));

    expect(await screen.findByText(/Which printing goes in pocket 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Umbreon VMAX, 215/ })).toBeInTheDocument();
  });

  it("marks a printing owned from the sheet, without putting it in the binder", async () => {
    // Ownership and arrangement are separate claims. Saying you hold a copy
    // must not fill a pocket with it — the whole point of a binder holding
    // cards you do not own yet is that the two are independent.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Umbreon");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Umbreon VMAX, 215/ }));
    await user.click(await screen.findByRole("button", { name: "Own Holofoil" }));

    expect(new Repositories().isOwnedFinish("swsh7-215", "holo")).toBe(true);
    expect(placedCards()).toEqual([]);
  });

  it("lets a card already in a pocket be marked owned, without finding it again", async () => {
    // The repair path for the common case: you laid the binder out planning
    // it, then pulled the card out of a box. Before this the answer had to be
    // given again on the set screen, from memory.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Umbreon");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Umbreon VMAX, 215/ }));
    await user.click(await screen.findByRole("button", { name: "Holofoil" }));

    // Placing moved the selection on; come back to the pocket it landed in.
    await user.click(screen.getByRole("button", { name: /^Pocket 1, Umbreon VMAX/ }));
    await user.click(await screen.findByRole("button", { name: "Own Holofoil" }));

    expect(new Repositories().isOwnedFinish("swsh7-215", "holo")).toBe(true);
    expect(placedCards()).toHaveLength(1);
  });

  it("says so when nothing matches, rather than showing an empty strip", async () => {
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Zzzzz");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/No cards match/)).toBeInTheDocument();
    expect(placedCards()).toEqual([]);
  });

  it("returns to the set list when the search is cleared", async () => {
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Umbreon");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByRole("button", { name: /Umbreon VMAX/ });

    // The set select is hidden while results are showing — it would otherwise
    // label a list it is not the source of.
    expect(screen.queryByLabelText("Cards from")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Browse sets" }));

    expect(screen.queryByRole("button", { name: /Umbreon VMAX/ })).not.toBeInTheDocument();
    expect(screen.getByText("Cards from")).toBeInTheDocument();
  });
});
