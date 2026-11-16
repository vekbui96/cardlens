import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CardSheet } from "./CardSheet.tsx";
import type { CollectFinish, PokemonCardSummary } from "../../models/cards.ts";

const card = {
  id: "me5-007",
  name: "Test Card",
  collectorNumber: "007",
  imageSmall: "",
} as PokemonCardSummary;

function renderSheet(over: Partial<Parameters<typeof CardSheet>[0]> = {}) {
  return render(
    <CardSheet
      card={card}
      finishes={["normal", "reverse"]}
      owned={[]}
      headlinePrice={4.25}
      priceFor={(f) => (f === "normal" ? 1.5 : f === "reverse" ? 4.25 : undefined)}
      onToggle={vi.fn()}
      excluded={[]}
      onToggleExcluded={vi.fn()}
      onRemoveAll={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe("CardSheet prices", () => {
  it("prices each printing separately", () => {
    renderSheet();

    expect(screen.getByRole("button", { name: new RegExp(`^Normal`) })).toHaveTextContent("$1.50");
    expect(screen.getByRole("button", { name: new RegExp(`^Reverse Holo`) })).toHaveTextContent("$4.25");
  });

  it("shows Unavailable rather than $0.00 for an unpriced printing", () => {
    // Pattern foils have no upstream price. Zero would read as worthless.
    renderSheet({
      finishes: ["reverse:pokeball"],
      priceFor: () => undefined,
    });

    expect(screen.getByRole("button", { name: new RegExp(`^Poké Ball Reverse`) })).toHaveTextContent(
      "Unavailable",
    );
  });

  it("totals only the printings actually owned", () => {
    renderSheet({ owned: ["reverse"] });

    expect(screen.getByTestId("sheet-owned-value")).toHaveTextContent("$4.25");
  });

  it("reports nothing owned as no value rather than zero dollars", () => {
    renderSheet({ owned: [] });

    expect(screen.queryByTestId("sheet-owned-value")).not.toBeInTheDocument();
  });
});

describe("CardSheet focus", () => {
  function sheet(onClose: () => void, owned: CollectFinish[] = []) {
    return (
      <CardSheet
        card={card}
        finishes={["normal", "reverse"]}
        owned={owned}
        priceFor={() => undefined}
        onToggle={() => {}}
        excluded={[]}
        onToggleExcluded={() => {}}
        onRemoveAll={() => {}}
        onClose={onClose}
      />
    );
  }

  it("keeps focus on the printing just pressed when the parent re-renders with a new onClose", () => {
    // The set screen passes `onClose={() => setOpenCardId(null)}`, a new function
    // on every render, and a mark re-renders it. Focus must not jump to the panel.
    const { rerender } = render(sheet(() => {}));
    const reverse = screen.getByRole("button", { name: /^Reverse Holo/ });
    reverse.focus();

    rerender(sheet(() => {}, ["reverse"]));

    expect(document.activeElement).toBe(reverse);
  });

  it("calls the latest onClose on Escape", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(sheet(first));
    rerender(sheet(latest));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("gives focus back to what opened it when it closes", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(sheet(() => {}));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();

    unmount();

    expect(document.activeElement).toBe(opener);
    expect(dialog).toHaveAttribute("data-returns-focus");
    opener.remove();
  });
});

describe("CardSheet extras", () => {
  it("keeps a hand-marked finish the set data does not list visible, pressed, and removable", () => {
    const onToggle = vi.fn();
    renderSheet({
      finishes: ["normal", "reverse"],
      owned: ["reverse:masterball"],
      onToggle,
    });

    const extra = screen.getByRole("button", { name: new RegExp(`^Master Ball Reverse`) });
    expect(extra).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(extra);
    expect(onToggle).toHaveBeenCalledWith("reverse:masterball");
  });
});
