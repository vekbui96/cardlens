import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OwnedPrintingRow } from "../../models/ownedSort.ts";
import { MostValuable } from "./MostValuable.tsx";

const row = (over: Partial<OwnedPrintingRow> = {}): OwnedPrintingRow => ({
  cardId: "sv3-223",
  setId: "sv3",
  setName: "Obsidian Flames",
  name: "Charizard ex",
  collectorNumber: "223",
  finish: "holo",
  price: 58.42,
  imageSmall: "https://images.pokemontcg.io/sv3/223.png",
  at: 1,
  ...over,
});

describe("MostValuable", () => {
  it("lists each printing with its name, finish, set and price, in the order given", () => {
    render(
      <MostValuable
        rows={[row(), row({ cardId: "base1-4", name: "Charizard", setName: "Base", price: 289.99 })]}
        onOpen={() => {}}
      />,
    );

    const strip = screen.getByRole("region", { name: "Most valuable" });
    const cards = within(strip).getAllByRole("button");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Charizard ex");
    expect(cards[0]).toHaveTextContent("Obsidian Flames");
    expect(cards[0]).toHaveTextContent("$58.42");
    expect(cards[1]).toHaveTextContent("$289.99");
  });

  it("opens the tapped printing", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<MostValuable rows={[row(), row({ cardId: "base1-4", name: "Charizard" })]} onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: /^Charizard Holo/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ cardId: "base1-4" });
  });

  it("renders nothing at all when there is nothing priced to show", () => {
    const { container } = render(<MostValuable rows={[]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Most valuable")).toBeNull();
  });
});
