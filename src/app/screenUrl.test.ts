import { describe, expect, it } from "vitest";
import type { Screen } from "./navigation.ts";
import { pathToScreen, screenFromLocation, screenToPath } from "./screenUrl.ts";

const SCREENS: Screen[] = [
  { name: "home" },
  { name: "favorites" },
  { name: "recent" },
  { name: "popular" },
  { name: "sets" },
  { name: "collection" },
  { name: "results", query: "charizard ex" },
  { name: "details", cardId: "me5-1" },
  { name: "set", setId: "me5", setName: "Pitch Black" },
];

describe("screen <-> path", () => {
  it("round-trips every screen", () => {
    for (const screen of SCREENS) {
      expect(pathToScreen(screenToPath(screen))).toEqual(screen);
    }
  });

  it("survives names and queries that need encoding", () => {
    // Set names carry spaces and punctuation, and they matter: printings are
    // matched to TCGdex by normalised name, so a mangled name loses them.
    const screen: Screen = { name: "set", setId: "sv8pt5", setName: "Prismatic Evolutions" };
    const path = screenToPath(screen);
    expect(path).not.toContain(" ");
    expect(pathToScreen(path)).toEqual(screen);

    expect(pathToScreen(screenToPath({ name: "results", query: "pikachu & friends/vmax" }))).toEqual({
      name: "results",
      query: "pikachu & friends/vmax",
    });
  });

  it("drops a card summary rather than putting it in the link", () => {
    // It is only an instant-paint optimisation; the details screen refetches by
    // id. A whole card object in a URL would be long, stale and wrong.
    const path = screenToPath({
      name: "details",
      cardId: "me5-1",
      summary: { id: "me5-1", name: "Tropius", setName: "Pitch Black", setCode: "PBL", collectorNumber: "1" },
    });
    expect(pathToScreen(path)).toEqual({ name: "details", cardId: "me5-1" });
  });

  it("reads an empty or bare hash as home", () => {
    expect(pathToScreen("")).toEqual({ name: "home" });
    expect(pathToScreen("#/")).toEqual({ name: "home" });
    expect(pathToScreen("/")).toEqual({ name: "home" });
  });

  it("rejects a path it does not recognise", () => {
    expect(pathToScreen("/nonsense")).toBeNull();
    expect(pathToScreen("/set/me5")).toBeNull(); // set name missing
    expect(pathToScreen("/card")).toBeNull();
  });

  it("falls back to home rather than rendering nothing", () => {
    // A stale or hand-edited link must land somewhere usable, not on a blank
    // screen — especially on the glasses, where there is no URL bar to fix it.
    expect(screenFromLocation("#/nonsense")).toEqual({ name: "home" });
    expect(screenFromLocation("#/set/me5/Pitch%20Black")).toEqual({
      name: "set",
      setId: "me5",
      setName: "Pitch Black",
    });
  });
});

describe("live share links", () => {
  it("round-trips a live link", () => {
    const screen = { name: "live", shareId: "abc-123_XYZ" } as const;
    const path = screenToPath(screen);
    expect(path).toBe("/live/abc-123_XYZ");
    expect(pathToScreen(path)).toEqual(screen);
  });

  it("still round-trips a snapshot link", () => {
    // Links already pasted into chats must keep working.
    const screen = { name: "showcase", setId: "me5", setName: "Pitch Black", payload: "AbC" } as const;
    expect(pathToScreen(screenToPath(screen))).toEqual(screen);
  });
});
