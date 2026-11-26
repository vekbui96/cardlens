import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeActions } from "./TradeActions.tsx";
import type { TradeLine } from "./summaryText.ts";

const card = (name: string, price?: number): TradeLine => ({
  name,
  setName: "Base Set",
  collectorNumber: "4",
  qty: 1,
  price,
});

afterEach(() => vi.unstubAllGlobals());

describe("TradeActions", () => {
  it("is disabled with a hint until both sides have a card", () => {
    render(<TradeActions give={[card("A", 1)]} get={[]} />);
    expect(screen.getByRole("button", { name: "Copy as text" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save as image" })).toBeDisabled();
    expect(screen.getByText(/Add a card to both sides/)).toBeInTheDocument();
  });

  it("copies the summary text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TradeActions give={[card("Charizard", 10)]} get={[card("Mew")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text).toContain("1 x Charizard (Base Set 4) - $10.00");
    expect(text).toContain("1 x Mew (Base Set 4) - unpriced");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shows the text in a box when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {});
    render(<TradeActions give={[card("A", 1)]} get={[card("B", 1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    const box = await screen.findByLabelText<HTMLTextAreaElement>("Trade summary");
    expect(box.value).toContain("I give:");
  });
});
