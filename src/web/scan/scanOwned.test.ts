import { describe, expect, it } from "vitest";
import type { CollectFinish } from "../../models/cards.ts";
import { alreadyOwnedSummary, ownedNote, scanOwnership } from "./scanOwned.ts";

/** A collection holding sv3-1 as a Normal only. */
const held: Record<string, CollectFinish[]> = { "sv3-1": ["normal"] };
const library = {
  isOwned: (id: string) => (held[id]?.length ?? 0) > 0,
  isOwnedFinish: (id: string, finish: CollectFinish) => Boolean(held[id]?.includes(finish)),
};

describe("scanOwnership", () => {
  it("is this-printing when the scanned printing is already held", () => {
    expect(scanOwnership("sv3-1", "normal", library)).toBe("this-printing");
  });

  it("is other-printing when the card is held, but not in this printing", () => {
    // Owning the Normal does not mean owning the Reverse: a collector reads
    // "already have it" per printing, and the scan adds per printing.
    expect(scanOwnership("sv3-1", "reverse", library)).toBe("other-printing");
  });

  it("is new when the card is not held at all", () => {
    expect(scanOwnership("sv3-2", "normal", library)).toBe("new");
  });
});

describe("ownedNote", () => {
  it("says so for each state, and nothing for a new card", () => {
    expect(ownedNote("this-printing")).toBe("Already in your collection");
    expect(ownedNote("other-printing")).toBe("You have this card in another printing");
    expect(ownedNote("new")).toBeNull();
  });
});

describe("alreadyOwnedSummary", () => {
  it("counts against the cards being added", () => {
    expect(alreadyOwnedSummary(3, 24)).toBe("3 of 24 already in your collection");
    expect(alreadyOwnedSummary(1, 1)).toBe("1 of 1 already in your collection");
  });

  it("says nothing when none of them are held", () => {
    // "0 of 24" is a row of chrome that tells a collector nothing they need.
    expect(alreadyOwnedSummary(0, 24)).toBeNull();
    expect(alreadyOwnedSummary(0, 0)).toBeNull();
  });
});
