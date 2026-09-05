import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogProvider, RepositoriesProvider } from "../../../app/contexts.tsx";
import { NavigationProvider, useNavigation } from "../../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../../app/LibraryProvider.tsx";
import { MockPokemonProvider } from "../../../integrations/pokemon/index.ts";
import { ProviderError, type SearchOpts } from "../../../integrations/providers.ts";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { Repositories } from "../../../storage/repositories.ts";
import { SearchScreen } from "./SearchScreen.tsx";

/**
 * The decisions, not the markup.
 *
 * The first two are the whole screen: a keystroke must not cost a request, and
 * a submit must cost exactly one. Everything else on this page is arrangement;
 * that is the part that determines whether the catalog answers at all.
 */

/** Counts what actually reached the provider, which is the only honest measure. */
class CountingProvider extends MockPokemonProvider {
  readonly searches: string[] = [];

  override async searchCards(query: string, opts?: SearchOpts): Promise<PokemonCardSummary[]> {
    this.searches.push(query);
    return super.searchCards(query, opts);
  }
}

/** Fails the first `failures` attempts, then behaves. A burst, not an outage. */
class FlakyProvider extends MockPokemonProvider {
  attempts = 0;

  constructor(private readonly failures: number) {
    super();
  }

  override async searchCards(query: string, opts?: SearchOpts): Promise<PokemonCardSummary[]> {
    this.attempts += 1;
    if (this.attempts <= this.failures) throw new ProviderError("burst", "network");
    return super.searchCards(query, opts);
  }
}

function harness(provider: MockPokemonProvider, repos = new Repositories()) {
  // retryDelay 0 so the hook's own `retry: 1` does not add a second of backoff
  // to every failure test. The retry itself is left alone — it is real behaviour.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <RepositoriesProvider value={repos}>
          <CatalogProvider base={provider}>
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
 * What the router does: the screen is handed the query the navigation stack
 * names. Rendering `<SearchScreen query="..." />` on its own would test a
 * component that can never change its own query, which is precisely the
 * behaviour under examination.
 */
function Routed() {
  const { screen: current } = useNavigation();
  return <SearchScreen query={current.name === "results" ? current.query : ""} />;
}

const input = () => screen.getByRole("searchbox", { name: /card name or number/i });
const submit = () => screen.getByRole("button", { name: "Search" });

describe("typing versus submitting", () => {
  it("issues no request while eight characters are typed, and exactly one on submit", async () => {
    // pokemontcg.io fails ~25% of the time in bursts and rate-limits. A request
    // per keystroke spends eight of them, and the budget, on prefixes nobody
    // asked about — and the ninth, the one that mattered, is the one refused.
    const provider = new CountingProvider();
    render(<Routed />, { wrapper: harness(provider) });

    await userEvent.type(input(), "charizar");
    expect(input()).toHaveValue("charizar");
    expect(provider.searches).toEqual([]);

    await userEvent.click(submit());

    expect(await screen.findByRole("heading", { name: /cards for “charizar”/i })).toBeInTheDocument();
    expect(provider.searches).toEqual(["charizar"]);
  });

  it("issues nothing at all with an empty query", async () => {
    const provider = new CountingProvider();
    render(<Routed />, { wrapper: harness(provider) });

    expect(await screen.findByRole("heading", { name: /nothing searched yet/i })).toBeInTheDocument();
    expect(provider.searches).toEqual([]);
  });

  it("ignores a submit with nothing in the field", async () => {
    const provider = new CountingProvider();
    render(<Routed />, { wrapper: harness(provider) });

    await userEvent.type(input(), "   ");
    await userEvent.click(submit());

    expect(provider.searches).toEqual([]);
  });
});

describe("results", () => {
  it("states the set and collector number on every card, because the name does not", async () => {
    // "charizard" returns 108 cards and most of them are called Charizard.
    render(<SearchScreen query="charizard" />, { wrapper: harness(new MockPokemonProvider()) });

    const tiles = await screen.findAllByRole("button", { name: /charizard/i });
    expect(tiles.length).toBeGreaterThan(1);
    for (const tile of tiles) {
      // Every tile carries a set name and a #number in its accessible name.
      expect(tile).toHaveAccessibleName(/#\d/);
    }
    // Two of these results are from the same set; only the number tells them apart.
    expect(screen.getAllByRole("button", { name: /obsidian flames/i })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /obsidian flames.*#223/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /obsidian flames.*#125/i })).toBeInTheDocument();
  });

  it("says nothing matched rather than showing an empty strip", async () => {
    render(<SearchScreen query="charizard" />, {
      wrapper: harness(new MockPokemonProvider({ forceEmpty: true })),
    });

    expect(await screen.findByRole("heading", { name: /nothing matched/i })).toBeInTheDocument();
  });
});

describe("a flaky catalog", () => {
  it("blames the catalog, not the query, and retrying actually works", async () => {
    // Two failures, because the hook already retries once on its own — so the
    // error state only appears when a genuine burst is under way.
    const provider = new FlakyProvider(2);
    render(<SearchScreen query="charizard" />, { wrapper: harness(provider) });

    expect(
      await screen.findByRole("heading", { name: /the card catalog did not answer/i }),
    ).toBeInTheDocument();
    // Not "check your spelling": the query was fine and sending someone to
    // correct a correct word is worse than saying nothing.
    expect(screen.getByText(/nothing wrong with “charizard”/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: /cards for “charizard”/i })).toBeInTheDocument();
  });
});

describe("recent searches", () => {
  it("offers what was searched before, and running one issues one request", async () => {
    const repos = new Repositories();
    repos.addRecentSearch("Umbreon VMAX");
    const provider = new CountingProvider();
    render(<Routed />, { wrapper: harness(provider, repos) });

    const recent = await screen.findByRole("button", { name: "Umbreon VMAX" });
    expect(provider.searches).toEqual([]);

    await userEvent.click(recent);

    expect(await screen.findByRole("heading", { name: /for “Umbreon VMAX”/i })).toBeInTheDocument();
    expect(provider.searches).toEqual(["Umbreon VMAX"]);
  });

  it("records a submitted search so it is there next time", async () => {
    const repos = new Repositories();
    render(<Routed />, { wrapper: harness(new CountingProvider(), repos) });

    await userEvent.type(input(), "greninja");
    await userEvent.click(submit());
    await screen.findByRole("heading", { name: /for “greninja”/i });

    expect(repos.getRecentSearches().map((r) => r.query)).toEqual(["greninja"]);
  });
});
