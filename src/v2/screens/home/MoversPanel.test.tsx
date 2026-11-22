import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { topMovers } from "../../../models/movement.ts";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { MoversPanel } from "./MoversPanel.tsx";

const row = (cardId: string, name: string, avg7: number, avg1: number): OwnedPrintingRow => ({
  cardId,
  setId: cardId.split("-")[0] ?? "",
  setName: "Obsidian Flames",
  name,
  collectorNumber: "1",
  finish: "holo",
  eur: { avg1, avg7, avg30: avg7 },
  at: 1,
});

describe("MoversPanel", () => {
  const rows = [
    row("sv3-1", "Charizard ex", 100, 118.4),
    row("sv3-2", "Pidgeot ex", 10, 11),
    row("sv3-3", "Gardevoir ex", 20, 16),
    row("sv3-4", "Mew ex", 10, 9),
    row("sv3-5", "Noise", 0.03, 0.05),
  ];

  it("shows percentages and card links, never an EUR amount", () => {
    const { container } = render(<MoversPanel movers={topMovers(rows)} />);
    expect(screen.getByRole("heading", { name: "Biggest movers" })).toBeTruthy();
    expect(screen.getByText("+18.4% 7d")).toBeTruthy();
    expect(screen.getByText("−20.0% 7d")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Charizard ex/ });
    expect(link.getAttribute("href")).toBe("#/card/sv3-1");
    expect(container.textContent).not.toMatch(/€|EUR|\$/);
    expect(container.textContent).not.toContain("Noise");
  });

  it("draws nothing when no card qualifies", () => {
    const { container } = render(<MoversPanel movers={topMovers([row("sv3-5", "Noise", 0.03, 0.05)])} />);
    expect(container.innerHTML).toBe("");
  });
});
