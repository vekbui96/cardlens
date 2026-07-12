import { describe, expect, it } from "vitest";
import { levenshtein, rankResults, scoreCard, type RankableCard } from "./rank.ts";
import { normalizeQuery } from "./normalize.ts";

function card(partial: Partial<RankableCard> & { id: string; name: string }): RankableCard {
  return {
    setName: "Test Set",
    setCode: "TST",
    collectorNumber: "1",
    ...partial,
  };
}

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("charizard", "charizard")).toBe(0);
    expect(levenshtein("pikachu", "pikchu")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("scoreCard", () => {
  it("ranks exact name above starts-with above fuzzy", () => {
    const q = normalizeQuery("charizard");
    const exact = scoreCard(q, card({ id: "1", name: "Charizard" }));
    const startsWith = scoreCard(q, card({ id: "2", name: "Charizard ex" }));
    const fuzzy = scoreCard(q, card({ id: "3", name: "Charmander" }));
    expect(exact).toBeGreaterThan(startsWith);
    expect(startsWith).toBeGreaterThan(fuzzy);
  });

  it("rewards a collector-number match", () => {
    const q = normalizeQuery("pikachu 25");
    const withNum = scoreCard(q, card({ id: "1", name: "Pikachu", collectorNumber: "25" }));
    const withoutNum = scoreCard(q, card({ id: "2", name: "Pikachu", collectorNumber: "58" }));
    expect(withNum).toBeGreaterThan(withoutNum);
  });

  it("matches collector number ignoring leading zeros", () => {
    const q = normalizeQuery("pikachu 025");
    const score = scoreCard(q, card({ id: "1", name: "Pikachu", collectorNumber: "25" }));
    expect(score).toBeGreaterThan(1000); // exact name + number
  });
});

describe("rankResults", () => {
  it("orders exact match first", () => {
    const cards: RankableCard[] = [
      card({ id: "1", name: "Charizard ex" }),
      card({ id: "2", name: "Charizard" }),
      card({ id: "3", name: "Charmeleon" }),
    ];
    const ranked = rankResults("Charizard", cards);
    expect(ranked[0].id).toBe("2");
  });

  it("uses release recency as a tie-breaker between equal names", () => {
    const cards: RankableCard[] = [
      card({ id: "old", name: "Charizard", releaseDate: "1999/01/09" }),
      card({ id: "new", name: "Charizard", releaseDate: "2023/08/11" }),
    ];
    const ranked = rankResults("Charizard", cards);
    expect(ranked[0].id).toBe("new");
  });
});
