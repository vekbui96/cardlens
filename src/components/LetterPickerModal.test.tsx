import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MockInputAdapter } from "../integrations/meta/MockInputAdapter.ts";
import { InputProvider } from "../app/contexts.tsx";
import { LetterPickerModal } from "./LetterPickerModal.tsx";

function setup(props: Partial<Parameters<typeof LetterPickerModal>[0]> = {}) {
  const mock = new MockInputAdapter();
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <InputProvider value={{ adapter: mock, mock }}>{children}</InputProvider>
  );
  render(
    <LetterPickerModal
      request={{ title: "Search cards", placeholder: "e.g. Charizard" }}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
    { wrapper },
  );
  return { mock, onSubmit, onCancel };
}

describe("LetterPickerModal", () => {
  it("types letters via select and shows them in the query bar", () => {
    const { mock } = setup();
    // Default focus is the first key, "A".
    act(() => mock.select()); // A -> "a"
    act(() => mock.swipeRight()); // B
    act(() => mock.select()); // "ab"
    expect(screen.getByText("ab")).toBeInTheDocument();
  });

  it("shows suggestions after 2+ letters and submits the picked name", () => {
    const { mock, onSubmit } = setup();
    act(() => mock.select()); // A
    act(() => mock.swipeRight()); // B
    act(() => mock.select()); // "ab" -> suggestions appear

    // Suggestions strip is now populated.
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);

    // Move focus up into the suggestions row and select the focused one.
    act(() => mock.swipeUp());
    act(() => mock.select());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(String(onSubmit.mock.calls[0][0]).toLowerCase().startsWith("ab")).toBe(true);
  });

  it("backspace removes the last character", () => {
    const { mock } = setup();
    act(() => mock.select()); // "a"
    act(() => mock.swipeRight()); // B
    act(() => mock.select()); // "ab"
    // Navigate to the specials row (row 4) -> Backspace is the 2nd cell.
    act(() => mock.swipeDown()); // row1
    act(() => mock.swipeDown()); // row2
    act(() => mock.swipeDown()); // row3
    act(() => mock.swipeDown()); // row4 (specials), col clamped
    act(() => mock.swipeLeft()); // move toward col 0 (Space)
    act(() => mock.swipeRight()); // Backspace (col 1)
    act(() => mock.select());
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("cancels on BACK (middle-finger pinch)", () => {
    const { mock, onCancel } = setup();
    act(() => mock.back());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("offers a phone hand-off key when onUsePhone is provided", () => {
    const onUsePhone = vi.fn();
    setup({ onUsePhone });
    expect(screen.getByText("☎ Phone")).toBeInTheDocument();
  });
});
