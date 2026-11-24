import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { MoversPanel } from "./MoversPanel.tsx";
import { MOVERS_WINDOW_KEY } from "./moversWindow.ts";

const row = (
  cardId: string,
  name: string,
  avg7: number,
  avg1: number,
  avg30: number = avg7,
): OwnedPrintingRow => ({
  cardId,
  setId: cardId.split("-")[0] ?? "",
  setName: "Obsidian Flames",
  name,
  collectorNumber: "1",
  finish: "holo",
  eur: { avg1, avg7, avg30 },
  at: 1,
});

describe("MoversPanel", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(MOVERS_WINDOW_KEY);
  });

  const rows = [
    row("sv3-1", "Charizard ex", 100, 118.4),
    row("sv3-2", "Pidgeot ex", 10, 11),
    row("sv3-3", "Gardevoir ex", 20, 16),
    row("sv3-4", "Mew ex", 10, 9),
    row("sv3-5", "Noise", 0.03, 0.05),
  ];

  it("shows percentages and card links, never an EUR amount", () => {
    const { container } = render(<MoversPanel rows={rows} />);
    expect(screen.getByRole("heading", { name: "Biggest movers" })).toBeTruthy();
    expect(screen.getByText("+18.4% 7d")).toBeTruthy();
    expect(screen.getByText("−20.0% 7d")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Charizard ex/ });
    expect(link.getAttribute("href")).toBe("#/card/sv3-1");
    expect(container.textContent).not.toMatch(/€|EUR|\$/);
    expect(container.textContent).not.toContain("Noise");
  });

  it("shows the current USD price beside the percent, and no amount when unpriced", () => {
    const priced = [
      { ...row("sv3-1", "Charizard ex", 100, 118.4), price: 12.4 },
      row("sv3-2", "Pidgeot ex", 10, 11),
      row("sv3-3", "Gardevoir ex", 20, 16),
      { ...row("sv3-4", "Mew ex", 10, 9), price: 0 },
    ];
    const { container } = render(<MoversPanel rows={priced} />);
    expect(screen.getByText("$12.40")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Charizard ex.*\$12\.40.*\+18\.4% 7d/ })).toBeTruthy();
    // Only the one priced row has an amount: unpriced and zero show nothing, never $0.00.
    expect(container.textContent?.match(/\$/g)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/Unavailable|0\.00/);
    expect(container.textContent).not.toMatch(/€|EUR/);
  });

  it("draws nothing when no card qualifies, or rows are not settled", () => {
    const a = render(<MoversPanel rows={[row("sv3-5", "Noise", 0.03, 0.05)]} />);
    expect(a.container.innerHTML).toBe("");
    const b = render(<MoversPanel rows={null} />);
    expect(b.container.innerHTML).toBe("");
  });

  it("says why it is empty while prices are missing, then shows the rows", () => {
    const a = render(<MoversPanel rows={null} loading />);
    expect(screen.getByRole("heading", { name: "Biggest movers" })).toBeTruthy();
    expect(screen.getByTestId("home-movers-skeleton").querySelectorAll("[data-skeleton]")).toHaveLength(0);
    expect(screen.getByText("Movers need prices; retrying")).toBeTruthy();
    a.unmount();
    render(<MoversPanel rows={rows} loading={false} />);
    expect(screen.queryByTestId("home-movers-skeleton")).toBeNull();
    expect(screen.getByText("+18.4% 7d")).toBeTruthy();
  });

  it("says Unpriced where a mover has no price", () => {
    render(<MoversPanel rows={rows} />);
    expect(screen.getAllByText("Unpriced").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Charizard ex.*unpriced.*\+18\.4% 7d/ })).toBeTruthy();
  });

  describe("window switch", () => {
    // 7 days flat, 30 days: a slow climb for two cards and a drop for two.
    const slow = [
      row("sv4-1", "Slow riser", 10, 10, 8),
      row("sv4-2", "Slow riser two", 10, 10, 5),
      row("sv4-3", "Slow faller", 10, 10, 20),
      row("sv4-4", "Slow faller two", 10, 10, 12.5),
    ];

    it("defaults to 7 days and switches to 30 days, with the window in the text", () => {
      render(<MoversPanel rows={[...rows, ...slow]} />);
      expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.queryByText(/ 30d$/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "30 days" }));
      expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("+100.0% 30d")).toBeTruthy();
      expect(screen.getByText("−50.0% 30d")).toBeTruthy();
      expect(screen.queryByText(/ 7d$/)).toBeNull();
    });

    it("keeps the choice on this device", () => {
      const first = render(<MoversPanel rows={[...rows, ...slow]} />);
      fireEvent.click(screen.getByRole("button", { name: "30 days" }));
      first.unmount();
      render(<MoversPanel rows={[...rows, ...slow]} />);
      expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("still offers the switch when only the other window has movers", () => {
      render(<MoversPanel rows={slow} />);
      expect(screen.getByText("No big movers over 7 days.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "30 days" }));
      expect(screen.getByText("+100.0% 30d")).toBeTruthy();
    });
  });
});
