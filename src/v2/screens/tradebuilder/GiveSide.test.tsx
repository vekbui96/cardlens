import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { GiveSide } from "./GiveSide.tsx";

const row = (cardId: string, name: string, price?: number): OwnedPrintingRow => ({
  cardId,
  setId: "sv3",
  setName: "Obsidian Flames",
  name,
  collectorNumber: "125",
  finish: "normal",
  ...(price !== undefined ? { price } : {}),
  at: 1,
});

const rows = [row("a", "Charizard ex", 4.5), row("b", "Pikachu"), row("c", "Charmander", 1)];

describe("the give side", () => {
  it("starts with an explanation and the next step", () => {
    render(<GiveSide rows={rows} loading={0} />);
    expect(screen.getByTestId("give-empty")).toHaveTextContent(/works out what a trade is worth/);
    expect(screen.getByLabelText("Add a card you would give")).toBeInTheDocument();
    expect(screen.queryByTestId("give-total")).not.toBeInTheDocument();
  });

  it("offers a link to Add many cards when nothing is owned", async () => {
    const user = userEvent.setup();
    const onAddCards = vi.fn();
    render(<GiveSide rows={[]} loading={0} onAddCards={onAddCards} />);
    const link = screen.getByRole("link", { name: "Add cards you own" });
    expect(link).toHaveAttribute("href", "#/addmany");
    await user.click(link);
    expect(onAddCards).toHaveBeenCalledTimes(1);
  });

  it("offers no such link while cards are owned or still loading", () => {
    const { unmount } = render(<GiveSide rows={rows} loading={0} />);
    expect(screen.queryByRole("link", { name: "Add cards you own" })).not.toBeInTheDocument();
    unmount();
    render(<GiveSide rows={[]} loading={1} />);
    expect(screen.queryByRole("link", { name: "Add cards you own" })).not.toBeInTheDocument();
  });

  it("adds a card by search and totals it", async () => {
    const user = userEvent.setup();
    render(<GiveSide rows={rows} loading={0} />);
    await user.type(screen.getByLabelText("Add a card you would give"), "charizard");
    await user.click(screen.getByRole("button", { name: /^Add Charizard ex/ }));
    expect(screen.getByTestId("give-total")).toHaveTextContent("1 card · $4.50");
    expect(screen.queryByTestId("give-empty")).not.toBeInTheDocument();
  });

  it("shows Unpriced for a card with no price and leaves it out of the total", async () => {
    const user = userEvent.setup();
    render(<GiveSide rows={rows} loading={0} />);
    const search = screen.getByLabelText("Add a card you would give");
    await user.type(search, "pika");
    await user.click(screen.getByRole("button", { name: /^Add Pikachu/ }));
    await user.clear(search);
    await user.type(search, "charm");
    await user.click(screen.getByRole("button", { name: /^Add Charmander/ }));
    const list = screen.getByTestId("give-list");
    expect(list).toHaveTextContent("Unpriced");
    expect(screen.getByTestId("give-total")).toHaveTextContent("2 cards · $1.00 · 1 unpriced");
  });

  it("caps the quantity at what is owned and removes a card", async () => {
    const user = userEvent.setup();
    render(<GiveSide rows={rows} loading={0} />);
    await user.type(screen.getByLabelText("Add a card you would give"), "charizard");
    await user.click(screen.getByRole("button", { name: /^Add Charizard ex/ }));
    expect(screen.getByRole("button", { name: "More Charizard ex" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove Charizard ex" }));
    expect(screen.getByTestId("give-empty")).toBeInTheDocument();
  });
});
