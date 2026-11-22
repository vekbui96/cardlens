import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { screenToPath } from "../../../app/screenUrl.ts";
import { EmptyStart } from "./EmptyStart.tsx";

/**
 * The one empty state v2 shows wherever a fresh device has nothing tracked
 * (#165): Home, Everything owned and the set list all say the same thing and
 * offer the same two ways in.
 */
describe("EmptyStart", () => {
  afterEach(cleanup);

  it("says nothing is tracked yet, at the heading level it is given", () => {
    const { unmount } = render(<EmptyStart headingLevel={1} />);
    expect(screen.getByRole("heading", { name: "Nothing tracked yet", level: 1 })).toBeTruthy();
    unmount();
    render(<EmptyStart headingLevel={2} />);
    expect(screen.getByRole("heading", { name: "Nothing tracked yet", level: 2 })).toBeTruthy();
  });

  it("offers Browse sets and Search as real links to real routes", () => {
    render(<EmptyStart headingLevel={2} />);
    const actions = screen.getByRole("group", { name: "Ways to start tracking" });
    expect(actions).toBeTruthy();
    expect(screen.getByRole("link", { name: /Browse sets/ }).getAttribute("href")).toBe(
      `#${screenToPath({ name: "sets" })}`,
    );
    expect(screen.getByRole("link", { name: /Search for a card/ }).getAttribute("href")).toBe(
      `#${screenToPath({ name: "results", query: "" })}`,
    );
  });

  it("explains that marking is saved on the device straight away", () => {
    render(<EmptyStart headingLevel={2} />);
    expect(screen.getByText(/Everything is saved on this device straight away/)).toBeTruthy();
  });

  it("renders a status line and extra actions only when given", () => {
    const { unmount } = render(<EmptyStart headingLevel={1} />);
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    render(
      <EmptyStart
        headingLevel={1}
        status="You're offline."
        extraActions={<button type="button">Extra</button>}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("You're offline.");
    expect(screen.getByRole("button", { name: "Extra" })).toBeTruthy();
  });
});
