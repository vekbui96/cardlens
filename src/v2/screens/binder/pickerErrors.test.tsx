import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PickerError } from "./BinderPicker.tsx";

describe("PickerError uses the shared ErrorNotice", () => {
  it("announces the set-cards failure and retries from one Try again button", async () => {
    const onRetry = vi.fn();
    render(<PickerError onRetry={onRetry}>Could not reach the card catalog for this set.</PickerError>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not reach the card catalog for this set.");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says a search retry is in flight and cannot be pressed twice", async () => {
    const onRetry = vi.fn();
    render(
      <PickerError onRetry={onRetry} busy>
        Search failed.
      </PickerError>,
    );

    const button = screen.getByRole("button", { name: "Trying again…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
