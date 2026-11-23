import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareGone } from "./ShareFrame.tsx";
import { ShowcaseError } from "./SetShowcase.tsx";

describe("share pages use the shared ErrorNotice", () => {
  it("ShareGone announces its heading and message, and retries from outside the alert", async () => {
    const onRetry = vi.fn();
    render(<ShareGone onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "This link doesn't work" })).toBeInTheDocument();
    expect(alert).toHaveTextContent(/nothing here to show you/i);
    // And what to do next, since the visitor cannot fix a dead link themselves.
    expect(alert).toHaveTextContent("Ask whoever sent it for a new link.");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("the set showcase says the set could not be reached, not that the link is broken", async () => {
    const onRetry = vi.fn();
    render(<ShowcaseError onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "The card list could not be reached" }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent("Nothing is wrong with the link.");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
