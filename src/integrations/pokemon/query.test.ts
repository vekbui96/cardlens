import { describe, expect, it } from "vitest";
import { buildLuceneQuery, escapeLuceneValue } from "./query.ts";
import { normalizeQuery } from "../../services/search/normalize.ts";

describe("buildLuceneQuery", () => {
  it("prefix-matches the name", () => {
    expect(buildLuceneQuery(normalizeQuery("Charizard"))).toBe("name:charizard*");
  });

  it("adds a collector-number constraint", () => {
    expect(buildLuceneQuery(normalizeQuery("Pikachu 25"))).toBe("name:pikachu* number:25");
  });

  it("appends a single rarity clause", () => {
    const q = buildLuceneQuery(normalizeQuery("Charizard"), ["Special Illustration Rare"]);
    expect(q).toBe('name:charizard* (rarity:"Special Illustration Rare")');
  });

  it("OR-s multiple rarities", () => {
    const q = buildLuceneQuery(normalizeQuery("Charizard"), ["Ultra Rare", "Rare Ultra"]);
    expect(q).toContain('(rarity:"Ultra Rare" OR rarity:"Rare Ultra")');
  });

  it("ignores an empty rarity list", () => {
    expect(buildLuceneQuery(normalizeQuery("Charizard"), [])).toBe("name:charizard*");
  });
});

describe("escapeLuceneValue", () => {
  it("turns punctuation into a separator rather than deleting it", () => {
    // Deleting it glued the halves together and the query matched nothing:
    // "farfetchd" and "lucariogx" are not prefixes of any card in the catalog,
    // and a prefix that matches nothing returns zero results rather than an
    // error — so the card said "No cards found" about itself.
    expect(escapeLuceneValue("farfetch'd")).toBe("farfetch d");
    expect(escapeLuceneValue("lucario-gx")).toBe("lucario gx");
    expect(escapeLuceneValue("type: null")).toBe("type null");
  });

  it("leaves an ordinary name alone", () => {
    expect(escapeLuceneValue("umbreon vmax")).toBe("umbreon vmax");
  });
});

describe("buildLuceneQuery with punctuation", () => {
  it("searches the first WORD of a hyphenated name, not the mashed-together one", () => {
    // `name:lucario*` finds Lucario-GX; `name:lucariogx*` finds nothing.
    expect(buildLuceneQuery(normalizeQuery("Lucario-GX"))).toBe("name:lucario*");
    expect(buildLuceneQuery(normalizeQuery("Farfetch'd"))).toBe("name:farfetch*");
    expect(buildLuceneQuery(normalizeQuery("Mr. Mime"))).toBe("name:mr*");
  });
});
