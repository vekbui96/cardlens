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

  it("opens on a right-hand page, and pairs the rest facing each other", async () => {
    // A binder opens against its inside front cover, so page 1 is a RIGHT-hand
    // page — the CSS keys the column off these attributes, so they are the
    // contract worth pinning. A trailing even page is NOT marked: it is a lone
    // page on the left, with its facing side still to be added.
    const user = userEvent.setup();
    const { container } = render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    // One page to start; grow to four so the last spread is a lone even page.
    const addPage = screen.getByRole("button", { name: "Add page" });
    for (let i = 0; i < 3; i++) await user.click(addPage);

    const spreads = [...container.querySelectorAll("[data-single], [data-cover]")];
    expect(spreads).toHaveLength(2);
    expect(spreads[0].hasAttribute("data-cover")).toBe(true);
    expect(spreads[1].hasAttribute("data-cover")).toBe(false);
    expect(screen.getByLabelText("Page 2").parentElement).toBe(screen.getByLabelText("Page 3").parentElement);
  });

  it("names the set a placed card came from", async () => {
    // The number alone does not identify a card in a binder like this: a Riolu
    // collection holds four cards numbered 17, from four different sets. The
    // slot does not store the set, so this is recovered from the card id.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Umbreon");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Umbreon VMAX, 215/ }));
    await user.click(await screen.findByRole("button", { name: "Holofoil" }));

    await user.click(screen.getByRole("button", { name: /^Pocket 1, Umbreon VMAX/ }));

    // Scoped to the sheet: the results grid names sets too, so a bare text
    // query would pass on a result tile even if the sheet said nothing.
    const sheet = (await screen.findByRole("button", { name: "Own Holofoil" })).closest("div")?.parentElement;
    expect(sheet?.textContent).toContain("Evolving Skies");
    expect(sheet?.textContent).toContain("215 · Holofoil");
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

describe("WebBinderScreen trading", () => {
  /**
   * Trade is a binder SETTING, so it lives in the Settings panel rather than on
   * the toolbar, and the panel is collapsed by default. The toolbar is for the
   * things you press while laying a binder out; this is decided once.
   */
  async function markForTrade(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "For trade" }));
  }

  /** Put a card in pocket 1 and open the sheet on it. */
  async function seedAndOpen(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Pocket 1, empty" }));
    await user.type(screen.getByLabelText("Search every set"), "Umbreon");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Umbreon VMAX, 215/ }));
    await user.click(await screen.findByRole("button", { name: "Holofoil" }));
    await user.click(screen.getByRole("button", { name: /^Pocket 1, Umbreon VMAX/ }));
  }

  it("offers copies and condition only on a binder marked for trade", async () => {
    // A pocket in a set binder holds one card because that is what a pocket is.
    // "How many?" is a question with no meaning there.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await seedAndOpen(user);
    expect(screen.queryByRole("button", { name: "One more copy" })).not.toBeInTheDocument();

    await markForTrade(user);
    expect(screen.getByRole("button", { name: "One more copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lightly played" })).toBeInTheDocument();
  });

  it("counts copies without moving off the pocket being counted", async () => {
    // Placing a card advances to the next empty pocket, because filling a
    // binder is a sequence. Counting a second copy is an edit to the pocket in
    // front of you — sharing one path would move the sheet off it mid-count.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await seedAndOpen(user);
    await markForTrade(user);
    await user.click(screen.getByRole("button", { name: "One more copy" }));
    await user.click(screen.getByRole("button", { name: "One more copy" }));

    expect(placedCards()[0].quantity).toBe(3);
    // Still on pocket 1. In trade mode the pocket announces its page too, so
    // the address a collector would say out loud is in the accessible name.
    expect(screen.getByRole("button", { name: /^Page 1, Pocket 1, Umbreon VMAX.*3 copies/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("will not count below one copy", async () => {
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await seedAndOpen(user);
    await markForTrade(user);
    expect(screen.getByRole("button", { name: "One fewer copy" })).toBeDisabled();
  });

  it("clears a grade by pressing it again, because unstated is a real answer", async () => {
    // Ungraded is not the same claim as near mint, so it has to be reachable
    // again after a mis-tap.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await seedAndOpen(user);
    await markForTrade(user);

    await user.click(screen.getByRole("button", { name: "Lightly played" }));
    expect(placedCards()[0].condition).toBe("LP");

    await user.click(screen.getByRole("button", { name: "Lightly played" }));
    expect(placedCards()[0].condition).toBeUndefined();
  });

  it("keeps the counts when a binder is taken off trade", async () => {
    // Changing your mind about selling must not silently discard the counting.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await seedAndOpen(user);
    await markForTrade(user);
    await user.click(screen.getByRole("button", { name: "One more copy" }));
    await user.click(screen.getByRole("button", { name: "✓ For trade" }));

    expect(placedCards()[0].quantity).toBe(2);
    expect(screen.queryByRole("button", { name: "One more copy" })).not.toBeInTheDocument();
  });
});

describe("WebBinderScreen settings", () => {
  it("keeps page actions on the toolbar and settings behind the panel", async () => {
    // The split the panel exists for: things pressed constantly stay out,
    // things decided once move in.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.getByRole("button", { name: "Add page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove page" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "9-pocket" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "For trade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show value" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "9-pocket" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For trade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show value" })).toBeInTheDocument();
    // Add page does not move into the panel — it stays where it was.
    expect(screen.getByRole("button", { name: "Add page" })).toBeInTheDocument();
  });

  it("says the panel is a disclosure, so a screen reader can tell it is collapsed", async () => {
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    const toggle = screen.getByRole("button", { name: "Settings" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("changes the pocket size from inside the panel", async () => {
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "4-pocket" }));

    // Four pockets, not nine — the binder actually re-flowed.
    expect(screen.getAllByRole("button", { name: /Pocket \d, empty/ })).toHaveLength(4);
    expect(new Repositories().getBinders().find((b) => b.id === BINDER_ID)?.format).toBe("4");
  });

  it("shows what is switched on without opening the panel", async () => {
    // A binder quietly still on offer is exactly the thing worth noticing from
    // the outside, so the state is legible with the panel shut.
    const user = userEvent.setup();
    render(<WebBinderScreen binderId={BINDER_ID} />, { wrapper: harness() });

    expect(screen.queryByText("For trade")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "For trade" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.queryByRole("button", { name: "✓ For trade" })).not.toBeInTheDocument();
    expect(screen.getByText("For trade")).toBeInTheDocument();
  });
});
