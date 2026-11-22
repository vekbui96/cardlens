import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { setTiers } from "../../../models/setCompletion.ts";
import { ProgressPanel, type ProgressRow } from "./ProgressPanel.tsx";

function row(finishLine?: string | null): ProgressRow {
  return {
    setId: "sv1",
    setName: "Scarlet & Violet",
    cards: 47,
    total: 60,
    tiers: setTiers({ total: 60 }, 47),
    ...(finishLine !== undefined ? { finishLine } : {}),
  };
}

describe("ProgressPanel finish line", () => {
  it("shows what is left under the progress meter", () => {
    render(<ProgressPanel resume={null} rows={[row("13 cards to go, about $9.00")]} loading={false} />);
    expect(screen.getByText("13 cards to go, about $9.00")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("13 cards to go, about $9.00");
  });

  it("sums the rows into one line under the list", () => {
    const a = { ...row("3 cards to go, about $2.00"), setId: "a", finish: { toGo: 3, priced: 3, total: 2 } };
    const b = { ...row("4 cards to go, about $3.00"), setId: "b", finish: { toGo: 4, priced: 4, total: 3 } };
    render(<ProgressPanel resume={null} rows={[a, b]} loading={false} />);
    expect(screen.getByText("To finish these 2 sets: 7 cards to go, about $5.00")).toBeTruthy();
  });

  it("hides the sum while loading and with no rows", () => {
    render(<ProgressPanel resume={null} rows={[]} loading={false} />);
    render(<ProgressPanel resume={null} rows={[]} loading={true} />);
    expect(screen.queryByText(/To finish these/)).toBeNull();
  });

  it("shows no extra line when nothing is left", () => {
    render(<ProgressPanel resume={null} rows={[row(null)]} loading={false} />);
    expect(screen.queryByText(/to go/)).toBeNull();
  });
});
