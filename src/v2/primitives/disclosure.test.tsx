import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RailHost, Sheet } from "./index.ts";

describe("RailHost", () => {
  it("hides the rail from everything when shut", () => {
    // Not just visually. A `display:none` panel that is still in the
    // accessibility tree gives a screen-reader user a set of filters they
    // cannot see and a sighted user cannot reach.
    render(
      <RailHost open={false} label="Filters" rail={<button type="button">Rarity</button>}>
        main
      </RailHost>,
    );
    expect(screen.queryByRole("complementary", { name: "Filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rarity" })).not.toBeInTheDocument();
  });

  it("exposes the rail when open", () => {
    render(
      <RailHost open label="Filters" rail={<button type="button">Rarity</button>}>
        main
      </RailHost>,
    );
    expect(screen.getByRole("complementary", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rarity" })).toBeInTheDocument();
  });

  it("gives the shut rail zero width, so the content beside it does not shrink", () => {
    // The regression this component was written for: while a shut rail still
    // held grid track, a 12-pocket binder page rendered its pockets at 92px
    // against a 9-pocket page's 125px. A pocket is a pocket.
    const { container, rerender } = render(
      <RailHost open={false} label="Filters" rail={<span>r</span>}>
        main
      </RailHost>,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue("--rail-w")).toBe("var(--v2-space-0)");
    expect(host.style.getPropertyValue("--rail-gap")).toBe("var(--v2-space-0)");

    rerender(
      <RailHost open label="Filters" rail={<span>r</span>}>
        main
      </RailHost>,
    );
    expect(host.style.getPropertyValue("--rail-w")).toBe("var(--v2-rail-w)");
  });
});

describe("Sheet", () => {
  it("renders nothing when shut", () => {
    render(
      <Sheet open={false} onClose={vi.fn()} label="Filters">
        <button type="button">Rarity</button>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a modal dialog when open", () => {
    render(
      <Sheet open onClose={vi.fn()} label="Filters">
        <button type="button">Rarity</button>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("moves focus into itself on open", () => {
    render(
      <Sheet open onClose={vi.fn()} label="Filters">
        <button type="button">Rarity</button>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Rarity" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} label="Filters">
        <button type="button">Rarity</button>
      </Sheet>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("returns focus to whatever opened it", () => {
    // Otherwise a keyboard user is dropped at the top of the document, which on
    // a screen with a nav bar means tabbing the whole bar again.
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <Sheet open onClose={vi.fn()} label="Filters">
        <button type="button">Rarity</button>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Rarity" })).toHaveFocus();

    rerender(
      <Sheet open={false} onClose={vi.fn()} label="Filters">
        <button type="button">Rarity</button>
      </Sheet>,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("keeps Tab inside itself", async () => {
    render(
      <Sheet open onClose={vi.fn()} label="Filters">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Sheet>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    expect(first).toHaveFocus();
    await userEvent.tab();
    expect(last).toHaveFocus();
    // Past the end, back to the start — not out into a page nobody can see.
    await userEvent.tab();
    expect(first).toHaveFocus();
  });
});
