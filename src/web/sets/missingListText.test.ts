import { describe, expect, it } from "vitest";
import { missingListText } from "./missingListText.ts";

const price = (table: Record<string, number>) => (n: string, f: string) => table[`${n}:${f}`];

const slot = (name: string, collectorNumber: string, finish = "normal", held = false, excluded = false) => ({
  collectorNumber,
  finish,
  held,
  excluded,
  card: { name },
});

describe("missingListText", () => {
  it("lists only what is missing, with the header count over wanted printings", () => {
    const slots = [slot("Pikachu", "1", "normal", true), slot("Raichu", "2"), slot("Eevee", "3")];
    const out = missingListText(slots, price({ "2:normal": 1.5 }), "Pikachu Set");
    expect(out).toEqual({
      count: 2,
      text: ["Pikachu Set: missing 2 of 3", "Raichu #2 - $1.50", "Eevee #3 - unpriced"].join("\n"),
    });
  });

  it("never lists excluded printings, and does not count them in the total", () => {
    const slots = [slot("Pikachu", "1"), slot("Promo", "P1", "normal", false, true)];
    const out = missingListText(slots, price({}), "S");
    expect(out.count).toBe(1);
    expect(out.text).not.toContain("Promo");
    expect(out.text.split("\n")[0]).toBe("S: missing 1 of 1");
  });

  it("names the finish when it is not Normal", () => {
    const out = missingListText([slot("Pikachu", "1", "reverse")], price({ "1:reverse": 0.5 }), "S");
    expect(out.text).toContain("Pikachu #1 (Reverse Holo) - $0.50");
  });

  it("calls a zero or missing price unpriced", () => {
    const out = missingListText([slot("A", "1"), slot("B", "2")], price({ "1:normal": 0 }), "S");
    expect(out.text).toContain("A #1 - unpriced");
    expect(out.text).toContain("B #2 - unpriced");
  });

  it("is empty when nothing is missing", () => {
    const out = missingListText([slot("A", "1", "normal", true)], price({}), "S");
    expect(out).toEqual({ count: 0, text: "" });
  });
});
