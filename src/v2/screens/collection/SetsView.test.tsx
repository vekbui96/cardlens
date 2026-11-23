import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetsView } from "./SetsView.tsx";
import type { SetGroups } from "./setGroups.ts";

const NO_GROUPS: SetGroups = {
  inProgress: [],
  complete: [],
  rest: [],
  started: [],
  hiddenByFilter: 0,
};

function renderView(props: { isError: boolean; onRetry: () => void }) {
  return render(
    <SetsView
      groups={NO_GROUPS}
      isLoading={false}
      query=""
      onQuery={() => {}}
      hasCollection
      sort="recent"
      onSort={() => {}}
      {...props}
    />,
  );
}

describe("SetsView errors use the shared ErrorNotice", () => {
  it("says the catalog did not answer inside an alert, and retries from the shared button", async () => {
    const onRetry = vi.fn();
    renderView({ isError: true, onRetry });

    expect(screen.getByRole("heading", { name: "Sets could not be loaded" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/set catalog did not answer/i);
    // The button sits outside the alert region, so it is not read out with the message.
    expect(screen.getByRole("alert")).not.toHaveTextContent("Try again");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers the same retry when the catalog answered with no sets", async () => {
    const onRetry = vi.fn();
    renderView({ isError: false, onRetry });

    expect(screen.getByRole("heading", { name: "No sets loaded" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/returned no sets/i);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
