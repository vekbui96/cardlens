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
  it("strips punctuation that would break the query", () => {
    expect(escapeLuceneValue("farfetch'd")).toBe("farfetchd");
  });
});
