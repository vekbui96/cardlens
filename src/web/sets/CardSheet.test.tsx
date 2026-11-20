import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CardSheet } from "./CardSheet.tsx";
import type { CollectFinish, PokemonCardSummary } from "../../models/cards.ts";
import type { Binder, CardSlot } from "../../models/binderLayout.ts";

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

describe("CardSheet put in a binder", () => {
  const NOW = 1_763_000_000_000;
  const placedCard = (cardId: string): CardSlot => ({ kind: "card", cardId, finish: "holo" });

  function makeBinder(id: string, name: string, slots: Record<number, CardSlot>, updatedAt: number): Binder {
    return { id, name, format: "4", pages: [{ slots }], createdAt: NOW - 1000, updatedAt };
  }

  const older = makeBinder("b-old", "Older", {}, NOW - 500);
  const pikachu = makeBinder("b-pika", "Pikachu", { 0: placedCard("x-1"), 1: placedCard("x-2") }, NOW - 100);
  const full = makeBinder(
    "b-full",
    "Full one",
    { 0: placedCard("x-1"), 1: placedCard("x-2"), 2: placedCard("x-3"), 3: placedCard("x-4") },
    NOW - 300,
  );

  it("lists binders newest edited first, with pockets used", () => {
    renderSheet({ binders: [older, full, pikachu], onSaveBinder: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Put in a binder" }));

    const names = within(screen.getByRole("region", { name: "Put in a binder" }))
      .getAllByRole("button", { name: /pockets used$/ })
      .map((b) => b.textContent);
    expect(names).toEqual([
      "Pikachu2 of 4 pockets used",
      "Full one4 of 4 pockets used",
      "Older0 of 4 pockets used",
    ]);
  });

  it("places the chosen printing in the next empty pocket and says where", () => {
    const onSaveBinder = vi.fn();
    renderSheet({ owned: ["reverse"], binders: [pikachu], onSaveBinder });

    fireEvent.click(screen.getByRole("button", { name: "Put in a binder" }));
    // Defaults to the printing held.
    expect(screen.getByRole("button", { name: "Place the Reverse Holo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Pikachu/ }));

    expect(onSaveBinder).toHaveBeenCalledTimes(1);
    const saved = onSaveBinder.mock.calls[0][0] as Binder;
    expect(saved.pages[0].slots[2]).toEqual({
      kind: "card",
      cardId: "me5-007",
      finish: "reverse",
      name: "Test Card",
      imageSmall: "",
      collectorNumber: "007",
    });
    expect(saved.pages[0].slots[0]).toEqual(pikachu.pages[0].slots[0]);
    expect(screen.getByRole("status")).toHaveTextContent("Placed in Pikachu, page 1, pocket 3");
  });

  it("places another printing once it is picked", () => {
    const onSaveBinder = vi.fn();
    renderSheet({ owned: ["reverse"], binders: [older], onSaveBinder });

    fireEvent.click(screen.getByRole("button", { name: "Put in a binder" }));
    fireEvent.click(screen.getByRole("button", { name: "Place the Normal" }));
    fireEvent.click(screen.getByRole("button", { name: /^Older/ }));

    expect((onSaveBinder.mock.calls[0][0] as Binder).pages[0].slots[0]).toMatchObject({ finish: "normal" });
  });

  it("says a full binder has no empty pocket and saves nothing", () => {
    const onSaveBinder = vi.fn();
    renderSheet({ binders: [full], onSaveBinder });

    fireEvent.click(screen.getByRole("button", { name: "Put in a binder" }));
    fireEvent.click(screen.getByRole("button", { name: /^Full one/ }));

    expect(onSaveBinder).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("No empty pocket in Full one");
  });

  it("refuses a printing already in that binder", () => {
    const onSaveBinder = vi.fn();
    const has = makeBinder(
      "b-has",
      "Has it",
      { 3: { kind: "card", cardId: "me5-007", finish: "normal" } },
      NOW,
    );
    renderSheet({ binders: [has], onSaveBinder });

    fireEvent.click(screen.getByRole("button", { name: "Put in a binder" }));
    fireEvent.click(screen.getByRole("button", { name: /^Has it/ }));

    expect(onSaveBinder).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Normal is already in Has it (page 1, pocket 4)");
  });

  it("says so when there are no binders", () => {
    renderSheet({ binders: [], onSaveBinder: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Put in a binder" }));

    expect(screen.getByText(/No binders yet/)).toBeInTheDocument();
  });

  it("is absent when the caller offers no binders", () => {
    renderSheet();

    expect(screen.queryByRole("button", { name: "Put in a binder" })).not.toBeInTheDocument();
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
