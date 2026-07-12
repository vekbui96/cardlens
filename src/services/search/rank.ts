import type { PokemonCardSummary } from "../../models/cards.ts";
import { normalizeQuery, stripLeadingZeros, type NormalizedQuery } from "./normalize.ts";

/** Ranking needs a bit more than the summary exposes. */
export interface RankableCard extends PokemonCardSummary {
  releaseDate?: string;
  nationalPokedexNumbers?: number[];
}

/** Cheap bounded Levenshtein for short card names. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

function fuzzyScore(query: string, name: string): number {
  if (!query) return 0;
  const distance = levenshtein(query, name);
  const maxLen = Math.max(query.length, name.length);
  if (maxLen === 0) return 0;
  const similarity = 1 - distance / maxLen; // 0..1
  return Math.max(0, Math.round(similarity * 100));
}

export interface ScoredCard {
  card: RankableCard;
  score: number;
}

/**
 * Score one candidate against the spec's priority order:
 *   1 exact name  2 name starts-with  3 collector number  4 set name
 *   5 fuzzy name  6 tie-break: release recency, then Pokédex-number popularity.
 */
export function scoreCard(query: NormalizedQuery, card: RankableCard): number {
  const name = card.name.toLowerCase();
  const setName = card.setName.toLowerCase();
  const q = query.name;
  let score = 0;

  if (q) {
    if (name === q) score += 1000;
    else if (name.startsWith(q)) score += 500;
    else if (name.includes(q)) score += 220;
    else score += fuzzyScore(q, name); // 0..100
  }

  if (query.collectorNumber) {
    const cardNum = stripLeadingZeros(String(card.collectorNumber).replace(/[^\d]/g, "") || "0");
    if (cardNum === query.collectorNumber) score += 420;
  }

  if (q && setName.includes(q)) score += 160;

  // Tie-breakers (small, so they never override a stronger signal).
  if (card.releaseDate) {
    const t = Date.parse(card.releaseDate);
    if (!Number.isNaN(t)) score += Math.min(30, t / 1e12); // newer sets edge ahead
  }
  const dex = card.nationalPokedexNumbers?.[0];
  if (typeof dex === "number") score += Math.max(0, 10 - dex / 200);

  return score;
}

export function rankResults(rawQuery: string, cards: RankableCard[]): RankableCard[] {
  const query = normalizeQuery(rawQuery);
  return cards
    .map((card): ScoredCard => ({ card, score: scoreCard(query, card) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.card);
}
