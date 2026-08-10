import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SetPrintingIndex } from "../../models/printingIndex.ts";
import type { IndexedCard } from "../../scan/cardIndex.ts";

const useSetPrintings = vi.fn();
vi.mock("../../hooks/useSetPrintings.ts", () => ({
  useSetPrintings: (...args: unknown[]) => useSetPrintings(...args),
}));

const { ScanFinishes } = await import("./ScanFinishes.tsx");

const CARD: IndexedCard = {
  id: "me5-3",
  name: "Trumbeak",
  number: "3",
  setId: "me5",
  setName: "Pitch Black",
  rarity: "Common",
};

/** Only `byNumber` is read; the rest of the index is irrelevant here. */
function printings(byNumber: Record<string, string[]>) {
  return { index: { byNumber } as unknown as SetPrintingIndex };
}

beforeEach(() => {
  useSetPrintings.mockReset();
});

describe("ScanFinishes", () => {
  it("offers the printings the card actually has, not a fixed pair", () => {
    // Three 2025-26 sets introduced nine foils between them. Marking a Poké Ball
    // reverse used to mean scanning the card and then hunting it in the set list.
    useSetPrintings.mockReturnValue(printings({ "3": ["normal", "reverse", "reverse:pokeball"] }));
    render(<ScanFinishes card={CARD} value="normal" onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Normal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Poké Ball Reverse" })).toBeTruthy();
  });

  it("asks for the set the scanned card came from", () => {
    useSetPrintings.mockReturnValue(printings({ "3": ["normal"] }));
    render(<ScanFinishes card={CARD} value="normal" onChange={() => {}} />);
    expect(useSetPrintings).toHaveBeenCalledWith("me5", "Pitch Black");
  });

  it("marks the selected printing for assistive tech, not just visually", () => {
    useSetPrintings.mockReturnValue(printings({ "3": ["normal", "holo"] }));
    render(<ScanFinishes card={CARD} value="holo" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Holofoil" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reports the picked printing", async () => {
    const onChange = vi.fn();
    useSetPrintings.mockReturnValue(printings({ "3": ["normal", "reverse"] }));
    render(<ScanFinishes card={CARD} value="normal" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Reverse Holo" }));
    expect(onChange).toHaveBeenCalledWith("reverse");
  });

  it("still offers something while the oracle has not answered", () => {
    // Printings arrive over the network. A row with no finishes cannot be
    // committed, so an absent server would make scanned cards silently
    // unaddable — the failure the on-device index exists to avoid on the
    // recognition half.
    useSetPrintings.mockReturnValue({ index: null });
    render(<ScanFinishes card={CARD} value="normal" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Normal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reverse Holo" })).toBeTruthy();
  });

  it("moves off a default the card turns out not to have", async () => {
    // Defaulting to `normal` is a guess made before the printings are known. A
    // card that only exists as a holo must not be filed as a normal.
    const onChange = vi.fn();
    useSetPrintings.mockReturnValue(printings({ "3": ["holo"] }));
    render(<ScanFinishes card={CARD} value="normal" onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith("holo");
  });

  it("leaves a printing the card does have alone", async () => {
    const onChange = vi.fn();
    useSetPrintings.mockReturnValue(printings({ "3": ["normal", "reverse"] }));
    render(<ScanFinishes card={CARD} value="reverse" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back when the set is known but this number is not", () => {
    // A card the recogniser named that the printings oracle has no row for —
    // the two come from different providers with different set ids.
    useSetPrintings.mockReturnValue(printings({ "999": ["holo"] }));
    render(<ScanFinishes card={CARD} value="normal" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Normal" })).toBeTruthy();
  });
});
