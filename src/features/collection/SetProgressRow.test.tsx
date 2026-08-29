import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { setTiers } from "../../models/setCompletion.ts";
import { SetProgressRow } from "./SetProgressRow.tsx";

const numbers = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

function row(tiers: ReturnType<typeof setTiers>, owned: number) {
  render(
    <SetProgressRow name="Obsidian Flames" owned={owned} printings={owned} finishes={{}} tiers={tiers} />,
  );
}

describe("SetProgressRow", () => {
  /**
   * The bug this whole feature was named after. A set three cards short of its
   * total rounded to "100%" and drew no star, so the number said finished and
   * the glyph said otherwise. `completionPercent` floors for this reason.
   */
  it("never prints 100% for a set that is not finished", () => {
    // 296/297 = 99.66%, which Math.round takes to 100.
    const tiers = setTiers({ total: 400, printedTotal: 297 }, numbers(1, 296));
    row(tiers, 296);

    expect(screen.getByText(/99%/)).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).toBeNull();
    expect(screen.queryByText("★ ")).toBeNull();
    expect(screen.queryByText("BASE")).toBeNull();
    expect(screen.queryByText("MASTER")).toBeNull();
  });

  /**
   * Colour is not available on the glasses and is not sufficient anywhere:
   * green and gold read as one hue under the common red-green deficiencies. The
   * word is the signal.
   */
  it("says BASE, in words, when the printed run is complete", () => {
    const tiers = setTiers({ total: 230, printedTotal: 197 }, numbers(1, 197));
    row(tiers, 197);

    expect(screen.getByText("BASE")).toBeInTheDocument();
    expect(screen.getByText("★")).toBeInTheDocument();
    // The figure names the same tier as the word: base run over base total.
    expect(screen.getByText("197/197")).toBeInTheDocument();
  });

  it("says MASTER, and shows the master pair, once the whole set is held", () => {
    const tiers = setTiers({ total: 80, printedTotal: 73 }, numbers(1, 80));
    row(tiers, 80);

    expect(screen.getByText("MASTER")).toBeInTheDocument();
    // Not 73/73: a `73/73` figure under a `MASTER` word is the two-denominator
    // confusion this work exists to end, reproduced inside one row.
    expect(screen.getByText("80/80")).toBeInTheDocument();
  });

  it("labels which set size the percentage is of while a set is unfinished", () => {
    const tiers = setTiers({ total: 279, printedTotal: 193 }, numbers(1, 100));
    row(tiers, 100);

    expect(screen.getByText("100/193")).toBeInTheDocument();
    expect(screen.getByText("base")).toBeInTheDocument();
  });

  /**
   * The state every screen is in until the library can supply collector
   * numbers, and after any older row that never recorded one. It has to look
   * like the app always did rather than like a fault.
   */
  it("falls back to the single master figure when only a count is known", () => {
    const tiers = setTiers({ total: 230, printedTotal: 197 }, 197);
    row(tiers, 197);

    expect(screen.getByText("197/230")).toBeInTheDocument();
    expect(screen.getByText("master")).toBeInTheDocument();
    expect(screen.queryByText("BASE")).toBeNull();
  });
});
