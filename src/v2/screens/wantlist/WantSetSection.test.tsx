import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildPrintingIndex } from "../../../models/printingIndex.ts";
import type { SetView } from "../../../hooks/useSetView.ts";
import { WantSetSection } from "./WantSetSection.tsx";
import { DEFAULT_WANT_FILTERS } from "./wantFilters.ts";

/** Each set's view, by set id: what `useSetView` would answer. */
const views: Record<string, Partial<SetView>> = {};
const refetch = vi.fn();

vi.mock("../../../hooks/useSetView.ts", () => ({
  useSetView: (setId: string) => ({
    cards: [],
    allCards: [],
    printings: null,
    isLoading: false,
    isError: false,
    refetch,
    ...views[setId],
  }),
}));
vi.mock("../../../hooks/useSetPrintings.ts", () => ({
  useSetPrintings: () => ({ isFetching: false, isError: false, refetch: vi.fn() }),
}));

const printings = buildPrintingIndex({
  "1": [{ type: "normal", price: 1 }],
  "2": [{ type: "normal", price: 2.5 }],
  "3": [{ type: "normal" }],
});

describe("WantSetSection", () => {
  it("lists the missing cards with the set's own line, unpriced ones worded once", () => {
    views.sv1 = {
      printings,
      allCards: [
        {
          id: "sv1-2",
          name: "Bulbasaur",
          setName: "S",
          setCode: "sv1",
          collectorNumber: "2",
          rarity: "Common",
        },
      ],
    };
    const onState = vi.fn();
    render(
      <WantSetSection
        setId="sv1"
        setName="Scarlet & Violet"
        ownedNumbers={["1"]}
        filters={DEFAULT_WANT_FILTERS}
        onState={onState}
      />,
    );
    expect(screen.getByText("2 missing, about $2.50, 1 unpriced")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Bulbasaur/ }).getAttribute("href")).toBe("#/card/sv1-2");
    expect(screen.getByText("Unpriced")).toBeTruthy();
    expect(onState).toHaveBeenLastCalledWith("sv1", "ready", expect.objectContaining({ missing: 2 }));
  });

  it("says a set failed and retries it, without throwing away the others", () => {
    views.bad = { isError: true };
    views.sv1 = { printings };
    const onState = vi.fn();
    render(
      <>
        <WantSetSection
          setId="bad"
          setName="Broken Set"
          ownedNumbers={["1"]}
          filters={DEFAULT_WANT_FILTERS}
          onState={onState}
        />
        <WantSetSection
          setId="sv1"
          setName="Scarlet & Violet"
          ownedNumbers={["1"]}
          filters={DEFAULT_WANT_FILTERS}
          onState={onState}
        />
      </>,
    );
    expect(screen.getByText(/Could not load Broken Set/)).toBeTruthy();
    expect(screen.getByText("2 missing, about $2.50, 1 unpriced")).toBeTruthy();
    expect(onState).toHaveBeenCalledWith("bad", "error", null);

    // The shared ErrorNotice: the message is an alert, the retry is its plain "Try again" button.
    expect(screen.getByRole("alert")).toHaveTextContent("The other sets on your Want list are not affected.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows a skeleton while the set loads, and reports it as loading", () => {
    views.slow = { isLoading: true };
    const onState = vi.fn();
    render(
      <WantSetSection
        setId="slow"
        setName="Slow Set"
        ownedNumbers={["1"]}
        filters={DEFAULT_WANT_FILTERS}
        onState={onState}
      />,
    );
    expect(screen.getByText("Loading Slow Set")).toBeTruthy();
    expect(onState).toHaveBeenLastCalledWith("slow", "loading", null);
  });

  it("never guesses when owned numbers do not add up", () => {
    views.sv1 = { printings };
    const onState = vi.fn();
    render(
      <WantSetSection
        setId="sv1"
        setName="Scarlet & Violet"
        ownedNumbers={null}
        filters={DEFAULT_WANT_FILTERS}
        onState={onState}
      />,
    );
    expect(screen.getByText(/marked without a collector number/)).toBeTruthy();
    expect(onState).toHaveBeenLastCalledWith("sv1", "unknown", null);
  });
});
