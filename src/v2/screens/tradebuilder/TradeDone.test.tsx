import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TradeLine } from "./summaryText.ts";
import { TradeDone } from "./TradeDone.tsx";

const line = (name: string, cardId: string): TradeLine => ({
  name,
  setName: "Base Set",
  collectorNumber: "4",
  qty: 1,
  price: 1,
  entry: { cardId, finish: "normal", setId: "base1", number: "4" },
});

const setup = (owned: string[] = ["a"]) => {
  const setOwnedMany = vi.fn();
  const onApplied = vi.fn();
  render(
    <TradeDone
      give={[line("Charizard", "a")]}
      get={[line("Mew", "b")]}
      isOwnedFinish={(id) => owned.includes(id)}
      setOwnedMany={setOwnedMany}
      onApplied={onApplied}
    />,
  );
  return { setOwnedMany, onApplied };
};

describe("TradeDone", () => {
  it("is disabled with nothing on either side", () => {
    render(<TradeDone give={[]} get={[]} isOwnedFinish={() => false} setOwnedMany={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Mark trade done" })).toBeDisabled();
  });

  it("confirms with both sides listed and writes nothing until confirmed", () => {
    const { setOwnedMany } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Mark trade done" }));
    expect(screen.getByLabelText("Leaving your collection")).toHaveTextContent("1 x Charizard");
    expect(screen.getByLabelText("Added to your collection")).toHaveTextContent("1 x Mew");
    expect(setOwnedMany).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setOwnedMany).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark trade done" })).toBeInTheDocument();
  });

  it("removes what is given, adds what is received, and Undo reverses both", () => {
    const { setOwnedMany, onApplied } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Mark trade done" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm trade done" }));
    expect(setOwnedMany.mock.calls[0]?.[0]).toEqual([
      { cardId: "a", finish: "normal", setId: "base1", number: "4", owned: false },
    ]);
    expect(setOwnedMany.mock.calls[1]?.[0]).toEqual([
      { cardId: "b", finish: "normal", setId: "base1", number: "4", owned: true },
    ]);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Trade done: 1 card left your collection, 1 card added.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(setOwnedMany.mock.calls[2]?.[0]).toEqual([
      { cardId: "b", finish: "normal", setId: "base1", number: "4", owned: false },
    ]);
    expect(setOwnedMany.mock.calls[3]?.[0]).toEqual([
      { cardId: "a", finish: "normal", setId: "base1", number: "4", owned: true },
    ]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never removes a given card that is not owned", () => {
    const { setOwnedMany } = setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Mark trade done" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm trade done" }));
    expect(setOwnedMany).toHaveBeenCalledTimes(1);
    expect(setOwnedMany.mock.calls[0]?.[0][0]).toMatchObject({ cardId: "b", owned: true });
  });
});
