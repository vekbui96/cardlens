import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetCardsError } from "./SetCardsScreen.tsx";

describe("SetCardsError uses the shared ErrorNotice", () => {
  it("announces what failed, under its heading, and keeps the retry outside the alert", async () => {
    const onRetry = vi.fn();
    render(<SetCardsError setName="Obsidian Flames" onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "The card catalog could not be reached" }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent("Obsidian Flames could not be loaded.");
    expect(alert).toHaveTextContent("Anything already marked is safe");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
