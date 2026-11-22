import { describe, expect, it } from "vitest";
import { isMetricEvent } from "../../../models/metricsEvents.ts";
import { applyWantFilters } from "./wantFilters.ts";
import type { WantSet } from "./wantList.ts";
import { wantListText } from "./wantListText.ts";

const set = (cards: WantSet["cards"]): WantSet => {
  const priced = cards.filter((c) => c.price !== null);
  return {
    cards,
    missing: cards.length,
    priced: priced.length,
    unpriced: cards.length - priced.length,
    total: Math.round(priced.reduce((n, c) => n + (c.price ?? 0), 0) * 100) / 100,
  };
};

const paldea = set([
  { collectorNumber: "1", finish: "normal", price: 1.5, name: "Bulbasaur", rarity: "Common" },
  { collectorNumber: "2", finish: "holo", price: null, name: "Ivysaur", rarity: "Rare" },
]);
const flames = set([
  { collectorNumber: "9", finish: "normal", price: 2, name: "Charmander", rarity: "Common" },
]);

describe("wantListText", () => {
  it("groups by set with per-set and total lines, and says unpriced", () => {
    const { text, count } = wantListText([
      { setName: "Paldea", want: paldea },
      { setName: "Obsidian Flames", want: flames },
    ]);
    expect(count).toBe(3);
    expect(text).toBe(
      [
        "Paldea: 2 missing, 1 priced, about $1.50, 1 unpriced\nBulbasaur #1 - $1.50\nIvysaur #2 (Holofoil) - unpriced",
        "Obsidian Flames: 1 missing, 1 priced, about $2.00\nCharmander #9 - $2.00",
        "Total: 3 missing across 2 sets, 2 priced, about $3.50, 1 unpriced",
      ].join("\n\n"),
    );
    expect(text).not.toContain("€");
  });

  it("follows the active filters and sort", () => {
    const filtered = applyWantFilters(paldea, { setId: null, rarities: ["Rare"], sort: "set" });
    const { text } = wantListText([
      { setName: "Paldea", want: filtered },
      {
        setName: "Obsidian Flames",
        want: applyWantFilters(flames, { setId: null, rarities: ["Rare"], sort: "set" }),
      },
    ]);
    expect(text).toContain("Ivysaur #2");
    expect(text).not.toContain("Bulbasaur");
    expect(text).not.toContain("Obsidian Flames");
    expect(text).toContain("Total: 1 missing across 1 set, none priced");
  });

  it("is empty when nothing is shown, and notes sets that failed", () => {
    expect(wantListText([]).count).toBe(0);
    expect(wantListText([{ setName: "Paldea", want: paldea }], 2).text).toContain(
      "Not included: 2 sets could not be loaded",
    );
  });

  it("counts the screen as a valid metrics event", () => {
    expect(isMetricEvent("screen.wantlist")).toBe(true);
  });
});
