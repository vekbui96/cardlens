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
  // v2's component gallery. It round-trips like any other screen so that a
  // link to it survives a reload and a version switch.
  { name: "workshop" },
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

  it("round-trips a trade link", () => {
    const screen = { name: "trade", shareId: "abc-123_XYZ" } as const;
    const path = screenToPath(screen);
    expect(path).toBe("/trade/abc-123_XYZ");
    expect(pathToScreen(path)).toEqual(screen);
  });

  it("keeps trade and live links distinct", () => {
    // They share an id space on the server, so the PATH is the only thing that
    // says which page an id should open. Crossing them would send a visitor to
    // a screen that reports the link as dead.
    expect(pathToScreen("/trade/xyz")).toEqual({ name: "trade", shareId: "xyz" });
    expect(pathToScreen("/live/xyz")).toEqual({ name: "live", shareId: "xyz" });
  });

  it("puts the workshop under /dev/, not at the top level", () => {
    // The prefix says in the URL bar that this is not a screen of the app, and
    // leaves room for the next dev-only page without another special case.
    expect(screenToPath({ name: "workshop" })).toBe("/dev/workshop");
    expect(pathToScreen("/workshop")).toBeNull();
  });
});
