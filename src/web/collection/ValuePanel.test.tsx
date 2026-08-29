import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LibraryValue } from "../../hooks/useLibraryValue.ts";
import { ValuePanel } from "./ValuePanel.tsx";

/**
 * The panel, with the pricing hook stubbed.
 *
 * `useLibraryValue` pulls the whole collection, the set list and one printings
 * query per set. None of that is what this panel decides — it decides how much
 * of the answer to show — so it is stubbed rather than assembled, and the tests
 * are about the fold.
 */
vi.mock("../../hooks/useLibraryValue.ts", () => ({
  useLibraryValue: () => stubbed,
}));

let stubbed: LibraryValue;

function value(setCount: number): LibraryValue {
  // Descending, as valueCollection returns them: most valuable first.
  const bySet = Array.from({ length: setCount }, (_, i) => ({
    setId: `s${i}`,
    printings: 10,
    priced: 10,
    value: (setCount - i) * 100,
  }));
  return {
    total: bySet.reduce((n, s) => n + s.value, 0),
    bySet,
    printings: setCount * 10,
    priced: setCount * 10,
    unpriced: 0,
    holdings: setCount * 10,
    pending: 0,
    failed: 0,
    movement: {},
    setNames: Object.fromEntries(bySet.map((s) => [s.setId, `Set ${s.setId}`])),
  } as unknown as LibraryValue;
}

beforeEach(() => {
  stubbed = value(19);
});

describe("ValuePanel", () => {
  it("shows only the five most valuable sets to begin with", () => {
    // Nineteen rows pushed the set-progress list — what the screen is for —
    // most of a phone screen down.
    render(<ValuePanel />);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).getByText("Set s0")).toBeInTheDocument();
    expect(within(list).queryByText("Set s5")).not.toBeInTheDocument();
  });

  it("names and prices what it is hiding, rather than merely hiding it", () => {
    // A "show more" that does not say what is behind it makes the reader open
    // it to find out whether they needed to.
    render(<ValuePanel />);
    // 19 sets at 1900..100 descending; the 14 below the top five total 10500.
    expect(screen.getByRole("button", { name: "14 more sets · $10,500.00" })).toBeInTheDocument();
  });

  it("expands to the whole list and folds back", async () => {
    const user = userEvent.setup();
    render(<ValuePanel />);

    const toggle = screen.getByRole("button", { name: /more sets/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(19);

    const back = screen.getByRole("button", { name: "Show top 5" });
    expect(back).toHaveAttribute("aria-expanded", "true");
    await user.click(back);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(5);
  });

  it("offers no expander when everything already fits", () => {
    stubbed = value(5);
    render(<ValuePanel />);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(5);
    // A control that would do nothing is worse than no control.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing at all for an empty collection", () => {
    stubbed = { ...value(0), holdings: 0 };
    const { container } = render(<ValuePanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
