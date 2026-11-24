import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardIndexError } from "./ScanScreen.tsx";

describe("CardIndexError uses the shared ErrorNotice", () => {
  it("announces the failure under its heading and retries from outside the alert", async () => {
    const onRetry = vi.fn();
    render(<CardIndexError error="HTTP 500" engine="device" onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "The card index could not load" })).toBeInTheDocument();
    expect(alert).toHaveTextContent("The card list did not download.");
    // The real cause is visible text, not only a tooltip touch users never see.
    expect(within(alert).getByText("Reason: HTTP 500")).toBeVisible();
    expect(alert).toHaveTextContent("Nothing on this device can identify a card.");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps saying what the server-only state means", () => {
    render(<CardIndexError error="HTTP 500" engine="server" onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The server is the only recogniser");
  });
});
