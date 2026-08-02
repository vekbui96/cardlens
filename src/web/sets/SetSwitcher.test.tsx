import { beforeEach, describe, expect, it } from "vitest";
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
import { NavigationProvider, useNavigation } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../integrations/pokemon/index.ts";
import { Repositories } from "../../storage/repositories.ts";
import { SetSwitcher } from "./SetSwitcher.tsx";

/**
 * Both sets exist in the mock fixtures. Obsidian Flames (sv3) is the set being
 * viewed; Base (base1) is the one to jump to.
 */
function seed() {
  const repo = new Repositories();
  repo.addOwned("sv3-125", "normal", "sv3");
  repo.addOwned("base1-58", "normal", "base1");
  repo.addOwned("base1-4", "holo", "base1");
  return repo;
}

/** Renders the current screen, so a switch is observable as navigation. */
function Where() {
  const { screen: current } = useNavigation();
  return <p>{current.name === "set" ? `at ${current.setId}` : `at ${current.name}`}</p>;
}

function harness(repo: Repositories) {
  const mock = new MockInputAdapter();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <InputProvider value={{ adapter: mock, mock }}>
          <RepositoriesProvider value={repo}>
            <CatalogProvider base={new MockPokemonProvider({})}>
              <LayoutModeProvider mode="web">
                <NavigationProvider>
                  <LibraryProvider>
                    {children}
                    <Where />
                  </LibraryProvider>
                </NavigationProvider>
              </LayoutModeProvider>
            </CatalogProvider>
          </RepositoriesProvider>
        </InputProvider>
      </QueryClientProvider>
    );
  };
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /Switch set/ }));
  return screen.getByRole("menu", { name: "Switch set" });
};

beforeEach(() => {
  localStorage.clear();
});

describe("SetSwitcher", () => {
  it("offers the sets you own cards from", async () => {
    const user = userEvent.setup();
    render(<SetSwitcher setId="sv3" setName="Obsidian Flames" />, { wrapper: harness(seed()) });

    const menu = await open(user);
    expect(within(menu).getByRole("menuitem", { name: /Obsidian Flames/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Base/ })).toBeInTheDocument();
    // Sets you have not started are not here — that is what All sets is for.
    expect(within(menu).queryByRole("menuitem", { name: /Evolving Skies/ })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: /^All sets/ })).toBeInTheDocument();
  });

  it("marks the set you are already in", async () => {
    const user = userEvent.setup();
    render(<SetSwitcher setId="sv3" setName="Obsidian Flames" />, { wrapper: harness(seed()) });

    const menu = await open(user);
    expect(within(menu).getByRole("menuitem", { name: /Obsidian Flames/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(menu).getByRole("menuitem", { name: /^Base/ })).not.toHaveAttribute("aria-current");
  });

  it("switches the screen to the set chosen", async () => {
    const user = userEvent.setup();
    render(<SetSwitcher setId="sv3" setName="Obsidian Flames" />, { wrapper: harness(seed()) });

    const menu = await open(user);
    await user.click(within(menu).getByRole("menuitem", { name: /^Base/ }));

    expect(screen.getByText("at base1")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the set being viewed even when nothing in it is owned", async () => {
    const user = userEvent.setup();
    // Opened straight from the full set list: no rows, but it is still where
    // you are, and a switcher missing its own set reads as a bug.
    render(<SetSwitcher setId="swsh7" setName="Evolving Skies" />, { wrapper: harness(seed()) });

    const menu = await open(user);
    expect(within(menu).getByRole("menuitem", { name: /Evolving Skies/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("closes on Escape without navigating", async () => {
    const user = userEvent.setup();
    render(<SetSwitcher setId="sv3" setName="Obsidian Flames" />, { wrapper: harness(seed()) });

    await open(user);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByText("at home")).toBeInTheDocument();
  });
});
