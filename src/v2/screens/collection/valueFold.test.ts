import { describe, expect, it } from "vitest";
import type { SetValue } from "../../../models/value.ts";
import { foldValue, setLabel, TOP_SETS } from "./valueFold.ts";

const row = (setId: string, value: number): SetValue => ({ setId, value, printings: 2, priced: 2 });

/** Seven sets, descending, as `valueCollection` already sorts them. */
const BY_SET: SetValue[] = [
  row("sv3", 500),
  row("base1", 400),
  row("swsh12", 300),
  row("sv2", 200),
  row("swsh1", 100),
  row("ecard3", 40),
  row("pop3", 2),
];

const NAMES: Record<string, string> = {
  sv3: "Obsidian Flames",
  base1: "Base",
  swsh12: "Silver Tempest",
  sv2: "Paldea Evolved",
  swsh1: "Sword & Shield",
  ecard3: "Skyridge",
};

describe("foldValue", () => {
  it("shows the five most valuable sets", () => {
    const fold = foldValue(BY_SET, NAMES, false);
    expect(fold.shown).toHaveLength(TOP_SETS);
    expect(fold.shown.map((s) => s.setId)).toEqual(["sv3", "base1", "swsh12", "sv2", "swsh1"]);
  });

  it("NAMES and PRICES the remainder rather than merely hiding it", () => {
    const fold = foldValue(BY_SET, NAMES, false);

    // The expander has to be able to answer "do I need to open this?" without
    // being opened. A count alone cannot.
    expect(fold.hiddenNames).toEqual(["Skyridge", "pop3"]);
    expect(fold.hiddenValue).toBe(42);
  });

  it("still knows what it folded while expanded, so the button can offer to fold again", () => {
    const fold = foldValue(BY_SET, NAMES, true);
    expect(fold.shown).toHaveLength(BY_SET.length);
    expect(fold.hidden).toHaveLength(2);
  });

  it("folds nothing when there are five sets or fewer", () => {
    const fold = foldValue(BY_SET.slice(0, TOP_SETS), NAMES, false);
    expect(fold.hidden).toEqual([]);
    expect(fold.hiddenValue).toBe(0);
  });
});

describe("setLabel", () => {
  it("falls back to the set id, which is a real answer and not a placeholder", () => {
    // The set list can be absent — offline, or a set the catalog stopped
    // listing — while the collection still holds cards from it.
    expect(setLabel("base2", {})).toBe("base2");
    expect(setLabel("base2", { base2: "Jungle" })).toBe("Jungle");
  });
});
