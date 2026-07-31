import { describe, expect, it } from "vitest";
import { continueTarget } from "./continueSet.ts";
import type { OwnedCard } from "../../storage/repositories.ts";
import type { PokemonSet } from "../../models/cards.ts";

/**
 * The home screen deliberately differs by device, so the rule is pinned here.
 *
 * Glasses: a fixed menu. Four gestures make the list muscle memory, and a row
 * that appears, disappears and renames itself with whatever you last touched
 * destroys that.
 *
 * Web: the resume shortcut and live counts, where there is room and a pointer.
 */
function homeExtras(isWeb: boolean, collection: OwnedCard[], sets: PokemonSet[]) {
  const counts = { me5: collection.length };
  return {
    resume: isWeb ? continueTarget(collection, sets, counts, counts) : null,
    subtitle: isWeb && collection.length ? `${collection.length} cards` : "Search Pokémon cards",
  };
}

const sets: PokemonSet[] = [{ id: "me5", name: "Pitch Black", total: 120 }];
const collection: OwnedCard[] = [{ id: "me5-1", setId: "me5", finishes: ["normal"], at: 5 }];

describe("home screen by device", () => {
  it("shows no resume row and a fixed tagline on the glasses", () => {
    const home = homeExtras(false, collection, sets);
    expect(home.resume).toBeNull();
    expect(home.subtitle).toBe("Search Pokémon cards");
  });

  it("shows the resume row and live counts on web", () => {
    const home = homeExtras(true, collection, sets);
    expect(home.resume?.setName).toBe("Pitch Black");
    expect(home.subtitle).toBe("1 cards");
  });

  it("keeps the tagline on web until something is collected", () => {
    expect(homeExtras(true, [], sets).subtitle).toBe("Search Pokémon cards");
  });
});
