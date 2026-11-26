import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogProvider } from "../../../app/contexts.tsx";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { MockPokemonProvider } from "../../../integrations/pokemon/index.ts";
import { GetSide } from "./GetSide.tsx";

const card = (id: string, name: string, marketPrice?: number): PokemonCardSummary => ({
  id,
  name,
  setName: "Obsidian Flames",
  setCode: "sv3",
  collectorNumber: "125",
  ...(marketPrice !== undefined ? { marketPrice } : {}),
});

const CARDS = [card("a", "Charizard ex", 4.5), card("b", "Charmander")];

function wrap() {
  const catalog = new MockPokemonProvider({});
  catalog.searchCards = vi.fn(async () => CARDS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <CatalogProvider base={catalog}>{children}</CatalogProvider>
      </QueryClientProvider>
    );
  };
}

async function find(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Add a card you would get"), "char{Enter}");
}

describe("the get side", () => {
  it("starts with an explanation and a search field", () => {
    render(<GetSide />, { wrapper: wrap() });
    expect(screen.getByTestId("get-empty")).toHaveTextContent(/cards you would get/);
    expect(screen.getByLabelText("Add a card you would get")).toBeInTheDocument();
    expect(screen.queryByTestId("get-total")).not.toBeInTheDocument();
  });

  it("adds a card, changes the quantity and removes it", async () => {
    const user = userEvent.setup();
    const onTotal = vi.fn();
    render(<GetSide onTotal={onTotal} />, { wrapper: wrap() });
    await find(user);
    await user.click(await screen.findByRole("button", { name: /^Get Charizard ex/ }));
    expect(screen.getByTestId("get-total")).toHaveTextContent("1 card · $4.50");
    await user.click(screen.getByRole("button", { name: "More Charizard ex" }));
    expect(screen.getByTestId("get-total")).toHaveTextContent("2 cards · $9.00");
    expect(screen.getByRole("button", { name: "Fewer Charizard ex" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Fewer Charizard ex" }));
    expect(screen.getByRole("button", { name: "Fewer Charizard ex" })).toBeDisabled();
    expect(onTotal).toHaveBeenLastCalledWith({ total: 4.5, cards: 1, unpriced: 0 });
    await user.click(screen.getByRole("button", { name: /^Remove Charizard ex/ }));
    expect(screen.getByTestId("get-empty")).toBeInTheDocument();
  });

  it("shows Unpriced and leaves the card out of the total", async () => {
    const user = userEvent.setup();
    render(<GetSide />, { wrapper: wrap() });
    await find(user);
    await user.click(await screen.findByRole("button", { name: /^Get Charmander/ }));
    expect(screen.getByTestId("get-list")).toHaveTextContent("Unpriced");
    expect(screen.getByTestId("get-total")).toHaveTextContent("1 card · No price yet · 1 unpriced");
  });
});
