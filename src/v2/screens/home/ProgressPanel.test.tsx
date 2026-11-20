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

  it("shows no extra line when nothing is left", () => {
    render(<ProgressPanel resume={null} rows={[row(null)]} loading={false} />);
    expect(screen.queryByText(/to go/)).toBeNull();
  });
});
