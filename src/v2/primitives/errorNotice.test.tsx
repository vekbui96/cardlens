import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorNotice } from "./index.ts";

describe("ErrorNotice", () => {
  it("shows the title, what failed and what still works", () => {
    render(
      <ErrorNotice
        title="Nothing came back"
        stillWorks="Your collection is still available."
        onRetry={() => {}}
      >
        The catalog did not answer.
      </ErrorNotice>,
    );
    expect(screen.getByRole("heading", { name: "Nothing came back" })).toBeInTheDocument();
    expect(screen.getByText("The catalog did not answer.")).toBeInTheDocument();
    expect(screen.getByText("Your collection is still available.")).toBeInTheDocument();
  });

  it("calls onRetry from a Try again button", async () => {
    const onRetry = vi.fn();
    render(<ErrorNotice onRetry={onRetry}>It failed.</ErrorNotice>);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("reads Trying again… and is disabled while busy", () => {
    render(
      <ErrorNotice onRetry={() => {}} busy>
        It failed.
      </ErrorNotice>,
    );
    const button = screen.getByRole("button", { name: "Trying again…" });
    expect(button).toBeDisabled();
  });

  it("renders without a title or a still-works line", () => {
    render(<ErrorNotice onRetry={() => {}}>It failed.</ErrorNotice>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
