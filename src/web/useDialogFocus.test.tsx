import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useDialogFocus } from "./useDialogFocus.ts";

function Dialog({ onClose }: { onClose: () => void }) {
  const panel = useDialogFocus<HTMLDivElement>(onClose);
  return (
    <div ref={panel} role="dialog" aria-label="Viewer" tabIndex={-1}>
      <button type="button">Close</button>
    </div>
  );
}

describe("useDialogFocus", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves focus into the dialog on open and back to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<Dialog onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
  });

  it("does not take focus back from inside the dialog when the parent re-renders", () => {
    const { rerender } = render(<Dialog onClose={() => {}} />);
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();

    rerender(<Dialog onClose={() => {}} />);

    expect(close).toHaveFocus();
  });

  it("closes on Escape with the latest onClose", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Dialog onClose={first} />);
    rerender(<Dialog onClose={latest} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("stops listening for Escape once closed", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Dialog onClose={onClose} />);
    unmount();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves focus alone when the opener has left the document", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const focus = vi.spyOn(opener, "focus");

    const { unmount } = render(<Dialog onClose={() => {}} />);
    opener.remove();
    unmount();

    expect(focus).not.toHaveBeenCalled();
  });
});
