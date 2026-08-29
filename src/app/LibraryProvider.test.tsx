import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { LibraryProvider, useLibrary } from "./LibraryProvider.tsx";
import { RepositoriesProvider } from "./contexts.tsx";
import { Repositories } from "../storage/repositories.ts";
import { VersionedStore, createMemoryStorage } from "../storage/versioned.ts";

/**
 * A provider over throwaway storage. Sync stays off because no token is set, so
 * nothing here reaches the network.
 */
function mount() {
  const repo = new Repositories(new VersionedStore(createMemoryStorage()));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoriesProvider value={repo}>
      <LibraryProvider>{children}</LibraryProvider>
    </RepositoriesProvider>
  );
  return renderHook(() => useLibrary(), { wrapper });
}

describe("ownedNumbersBySet", () => {
  it("is empty before anything is owned", () => {
    expect(mount().result.current.ownedNumbersBySet).toEqual({});
  });

  it("gives one entry per owned card, keyed by set", () => {
    const { result } = mount();
    act(() => result.current.addOwned("me5-1", "normal", "me5", "1"));
    act(() => result.current.addOwned("me5-2", "reverse", "me5", "2"));
    act(() => result.current.addOwned("sv3pt5-4", "holo", "sv3pt5", "4"));
    expect(result.current.ownedNumbersBySet).toEqual({ me5: ["1", "2"], sv3pt5: ["4"] });
  });

  it("counts a card once however many of its printings are held", () => {
    // One entry per CARD, not per printing: the base/master split is a question
    // about cards, and ownedFinishCountsBySet is the per-printing figure.
    const { result } = mount();
    act(() => result.current.addOwned("me5-1", "normal", "me5", "1"));
    act(() => result.current.addOwned("me5-1", "reverse", "me5", "1"));
    expect(result.current.ownedNumbersBySet).toEqual({ me5: ["1"] });
    expect(result.current.ownedFinishCountsBySet).toEqual({ me5: 2 });
  });

  it("omits a card whose number is unknown rather than guessing from the id", () => {
    // zsv10pt5-80 carries number "60". Deriving the number from the id would
    // collide with that set's real card 60 and report a wrong base tier;
    // omitting it makes setTiers decline one, which is the behaviour to keep.
    const { result } = mount();
    act(() => result.current.addOwned("zsv10pt5-80", "holo", "zsv10pt5"));
    expect(result.current.ownedCountsBySet).toEqual({ zsv10pt5: 1 });
    expect(result.current.ownedNumbersBySet).toEqual({});
  });

  it("drops a number when the card is un-marked", () => {
    const { result } = mount();
    act(() => result.current.addOwned("me5-1", "normal", "me5", "1"));
    act(() => result.current.toggleOwned("me5-1", "normal", "me5"));
    expect(result.current.ownedNumbersBySet).toEqual({});
  });

  it("learns numbers for rows written before the field existed", () => {
    const { result } = mount();
    act(() => result.current.addOwned("zsv10pt5-80", "holo", "zsv10pt5"));
    act(() => result.current.backfillNumbers([{ id: "zsv10pt5-80", collectorNumber: "60" }]));
    expect(result.current.ownedNumbersBySet).toEqual({ zsv10pt5: ["60"] });
  });

  it("keeps the map identity stable when a backfill has nothing to do", () => {
    // Called on every set load, so a no-op that still produced a new collection
    // array would re-render every consumer of this context forever.
    const { result } = mount();
    act(() => result.current.addOwned("me5-1", "normal", "me5", "1"));
    const before = result.current.ownedNumbersBySet;
    act(() => result.current.backfillNumbers([{ id: "me5-1", collectorNumber: "1" }]));
    expect(result.current.ownedNumbersBySet).toBe(before);
  });
});
