import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  it("reads Trying again… and cannot be pressed twice while busy", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorNotice onRetry={onRetry} busy>
        It failed.
      </ErrorNotice>,
    );
    const button = screen.getByRole("button", { name: "Trying again…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("keeps focus on the button when a retry starts", async () => {
    // `disabled` on the focused button drops focus to <body>; aria-disabled keeps it.
    const { rerender } = render(<ErrorNotice onRetry={() => {}}>It failed.</ErrorNotice>);
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    rerender(
      <ErrorNotice onRetry={() => {}} busy>
        It failed.
      </ErrorNotice>,
    );
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
  });

  it("renders without a title or a still-works line", () => {
    render(<ErrorNotice onRetry={() => {}}>It failed.</ErrorNotice>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  describe("screen readers", () => {
    it("announces the title and what failed in one alert", () => {
      render(
        <ErrorNotice
          title="Nothing came back"
          stillWorks="Your collection is still available."
          onRetry={() => {}}
        >
          The catalog did not answer.
        </ErrorNotice>,
      );
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(
        "Nothing came backThe catalog did not answer.Your collection is still available.",
      );
      expect(within(alert).getByRole("heading", { name: "Nothing came back" })).toBeInTheDocument();
    });

    it("announces an untitled notice too", () => {
      render(<ErrorNotice onRetry={() => {}}>It failed.</ErrorNotice>);
      expect(screen.getByRole("alert")).toHaveTextContent("It failed.");
    });

    it("keeps the retry button out of the announcement", () => {
      render(<ErrorNotice onRetry={() => {}}>It failed.</ErrorNotice>);
      const alert = screen.getByRole("alert");
      expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
      expect(alert).not.toHaveTextContent("Try again");
    });

    it("has exactly one live region, so nothing is announced twice", () => {
      const { container } = render(
        <ErrorNotice title="Nothing came back" onRetry={() => {}}>
          It failed.
        </ErrorNotice>,
      );
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    });

    it("re-announces when a retry fails again", () => {
      const notice = (busy: boolean) => (
        <ErrorNotice title="Nothing came back" busy={busy} onRetry={() => {}}>
          It failed.
        </ErrorNotice>
      );
      const { rerender } = render(notice(false));
      const first = screen.getByRole("alert");

      rerender(notice(true));
      // Pressing Try again is not itself a new failure: same region, no announcement.
      expect(screen.getByRole("alert")).toBe(first);

      rerender(notice(false));
      // The retry finished and the notice is still up, so it failed again. A fresh
      // region node is what makes a screen reader speak the unchanged text again.
      const second = screen.getByRole("alert");
      expect(second).not.toBe(first);
      expect(second).toHaveTextContent("Nothing came backIt failed.");
    });
  });
});
