import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PrintingSlot } from "./slots.ts";
import { FinishLine } from "./FinishLine.tsx";

/** The "what would finishing this set cost" line under the printings meter. */

function slot(n: string, over: Partial<PrintingSlot> = {}): PrintingSlot {
  return {
    key: `sv3-${n}:normal`,
    card: {
      id: `sv3-${n}`,
      name: `Card ${n}`,
      setName: "Obsidian Flames",
      setCode: "sv3",
      collectorNumber: n,
    },
    finish: "normal",
    collectorNumber: n,
    held: false,
    excluded: false,
    extra: false,
    complete: false,
    ...over,
  };
}

const prices: Record<string, number> = { "1": 4.5, "2": 1.25 };
const priceFor = (n: string) => prices[n];

describe("FinishLine", () => {
  it("counts missing printings, how many are priced, and the sum of those only", () => {
    render(<FinishLine slots={[slot("1"), slot("2"), slot("3")]} priceFor={priceFor} settled />);
    expect(screen.getByText("To finish: 3 printings missing, 2 priced, about $5.75")).toBeInTheDocument();
  });

  it("says Complete when nothing is missing", () => {
    render(
      <FinishLine
        slots={[slot("1", { held: true }), slot("2", { held: true })]}
        priceFor={priceFor}
        settled
      />,
    );
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("does not count held or excluded printings", () => {
    render(
      <FinishLine
        slots={[slot("1", { held: true }), slot("2", { excluded: true }), slot("3")]}
        priceFor={priceFor}
        settled
      />,
    );
    expect(screen.getByText("To finish: 1 printing missing, none priced")).toBeInTheDocument();
  });

  it("holds its space but says nothing until the set has settled or when there are no printings", () => {
    const { container, rerender } = render(<FinishLine slots={[]} priceFor={priceFor} settled={false} />);
    expect(container.textContent).toBe("");
    expect(container.firstChild).not.toBeNull();
    rerender(<FinishLine slots={[]} priceFor={priceFor} settled />);
    expect(container.textContent).toBe("");
  });
});
