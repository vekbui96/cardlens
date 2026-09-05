import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { SetPocket } from "./SetPocket.tsx";
import { buildSlots, type PrintingSlot } from "./slots.ts";

/**
 * One pocket, one printing, one target — and the two things it must never do:
 * render a raw enum at a collector, or price an unpriced card at zero.
 */

const JOLTEON: PokemonCardSummary = {
  id: "sv3-4",
  name: "Jolteon ex",
  setName: "Obsidian Flames",
  setCode: "sv3",
  collectorNumber: "023",
  imageSmall: "https://images.pokemontcg.io/sv3/4.png",
};

function slotFor(finish: string, over: Partial<PrintingSlot> = {}): PrintingSlot {
  const [slot] = buildSlots([JOLTEON], {
    finishesFor: () => [finish],
    ownedFinishes: () => [],
    excludedFinishes: () => [],
  });
  return { ...slot, ...over };
}

describe("SetPocket", () => {
  it("names the card, its number and its printing, so two printings are distinguishable", () => {
    render(<SetPocket slot={slotFor("reverse")} price={2.5} onToggle={() => {}} />);

    expect(
      screen.getByRole("button", { name: "Jolteon ex, 023, Reverse Holo, not owned" }),
    ).toBeInTheDocument();
  });

  it("humanises a foil nobody has taught it, rather than showing the raw key", () => {
    // Sets invent foils — three 2025-26 sets alone introduced nine of them. A
    // hardcoded list is wrong by the next release, so an unknown foil must
    // still read as words and must not throw.
    render(<SetPocket slot={slotFor("reverse:sparkle-crackle")} price={undefined} onToggle={() => {}} />);

    // "Sparkle crackle Reverse" — `finishLabel` capitalises the first word only,
    // which is the shared model's behaviour and not this screen's to change.
    // What matters here is that the key is words rather than `reverse:sparkle-crackle`.
    const button = screen.getByRole("button", { name: /Sparkle crackle Reverse/ });
    expect(button).toBeInTheDocument();
    expect(button.textContent).not.toContain("sparkle-crackle");
  });

  it("humanises an unknown printing TYPE too, not just an unknown foil", () => {
    render(<SetPocket slot={slotFor("staffPromo")} price={undefined} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /Staff Promo/ })).toBeInTheDocument();
  });

  it("says Unavailable rather than $0.00 when the printing has no price", () => {
    // Pitch Black returns no prices for any of its 120 cards. That is normal,
    // and a grid of $0.00 would read as a set of worthless cards.
    render(<SetPocket slot={slotFor("normal")} price={undefined} onToggle={() => {}} />);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("carries held in a word and in aria-pressed, not in colour alone", () => {
    render(<SetPocket slot={slotFor("normal", { held: true })} price={1} onToggle={() => {}} />);

    const button = screen.getByRole("button", { name: /, owned$/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Held")).toBeInTheDocument();
  });

  it("calls its printing's own toggle, once", async () => {
    const onToggle = vi.fn();
    render(<SetPocket slot={slotFor("holo")} price={12} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole("button", { name: /Holofoil/ }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("calls excluded excluded, not 'not owned'", () => {
    // "I still want this" and "this is not part of my set" are different
    // answers, and collapsing them makes a skipped promo read as a gap that
    // never closes.
    render(<SetPocket slot={slotFor("normal", { excluded: true })} price={9} onToggle={() => {}} />);

    expect(screen.getByRole("button", { name: /excluded$/ })).toBeInTheDocument();
    expect(screen.getByText("Not in set")).toBeInTheDocument();
  });

  it("does not read its art aloud — the button already says the card's name", () => {
    render(<SetPocket slot={slotFor("normal")} price={1} onToggle={() => {}} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
