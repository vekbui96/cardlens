import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CollectFinish } from "../../models/cards.ts";

/** A collection holding sv3-1 as a Normal only. */
const held: Record<string, CollectFinish[]> = { "sv3-1": ["normal"] };
vi.mock("../../app/LibraryProvider.tsx", () => ({
  useLibrary: () => ({
    isOwned: (id: string) => (held[id]?.length ?? 0) > 0,
    isOwnedFinish: (id: string, finish: CollectFinish) => Boolean(held[id]?.includes(finish)),
  }),
}));

const { ScanOwnedNote } = await import("./ScanOwnedNote.tsx");

describe("ScanOwnedNote", () => {
  it("says a scanned card is already in the collection in that printing", () => {
    render(<ScanOwnedNote cardId="sv3-1" finish="normal" />);
    expect(screen.getByText("Already in your collection")).toBeTruthy();
  });

  it("follows the finish chip: the same card as a Reverse is another printing", () => {
    const { rerender } = render(<ScanOwnedNote cardId="sv3-1" finish="normal" />);
    rerender(<ScanOwnedNote cardId="sv3-1" finish="reverse" />);
    expect(screen.queryByText("Already in your collection")).toBeNull();
    expect(screen.getByText("You have this card in another printing")).toBeTruthy();
  });

  it("renders nothing for a card that is not held", () => {
    const { container } = render(<ScanOwnedNote cardId="sv3-2" finish="normal" />);
    expect(container.textContent).toBe("");
  });
});
