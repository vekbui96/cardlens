import { describe, expect, it } from "vitest";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { FULL_SEARCH_LIMIT } from "../../../integrations/providers.ts";
import { normalizeQuery } from "../../../services/search/normalize.ts";
import {
  failureNote,
  nothingMatched,
  recentQueries,
  resultCaption,
  resultSummary,
  searchPhase,
  searchable,
  truncationNote,
  type SearchStatus,
} from "./searchState.ts";

/**
 * The decisions, not the markup.
 *
 * Every case here is one where the screen has a plausible wrong answer that
 * looks fine on a good day: a skeleton that never resolves, a count that reads
 * as the whole answer when it is a slice, a spelling hint shown to someone whose
 * wifi is off.
 */

function status(over: Partial<SearchStatus> = {}): SearchStatus {
  return { query: "charizard", answered: false, paused: false, isError: false, total: 0, ...over };
}

describe("searchable", () => {
  it("accepts a name, and a bare collector number on its own", () => {
    expect(searchable("Charizard")).toBe(true);
    // A number with no name IS a search — it is how you find a card whose name
    // you cannot spell.
    expect(searchable("025")).toBe(true);
    expect(searchable("4/102")).toBe(true);
  });

  it("rejects an empty box, which would spend a request on nothing", () => {
    expect(searchable("")).toBe(false);
    expect(searchable("   ")).toBe(false);
  });

  /**
   * Punctuation IS searchable, and deliberately so — `normalizeQuery` keeps
   * "#!" as a name. It is not this predicate's job to guess which strings the
   * catalog will like: a query that matches nothing lands in `empty`, which
   * says so, whereas a predicate that second-guessed the user would refuse to
   * search for "Ho-Oh" or "Farfetch'd" on the same reasoning.
   */
  it("does not try to guess which words the catalog will like", () => {
    expect(searchable("#!")).toBe(true);
    expect(searchable("Farfetch'd")).toBe(true);
  });

  /**
   * The one that matters. `useCatalogSearch` enables itself on exactly this
   * expression; if the two ever disagreed, a query the hook refuses to run
   * would leave the screen in `searching` forever — a skeleton that looks like
   * the app working.
   */
  it("agrees with the predicate the query hook enables on", () => {
    for (const query of ["", "  ", "#!", "a", "Charizard", "025", "4/102", "pikachu 025", "-"]) {
      const enabled = Boolean(normalizeQuery(query).name || normalizeQuery(query).collectorNumber);
      expect(searchable(query), `disagreed on ${JSON.stringify(query)}`).toBe(enabled);
    }
  });
});

describe("searchPhase", () => {
  it("is idle before anything searchable has been submitted", () => {
    expect(searchPhase(status({ query: "" }))).toBe("idle");
    expect(searchPhase(status({ query: "   " }))).toBe("idle");
  });

  it("says searching only while there is genuinely nothing to show", () => {
    expect(searchPhase(status())).toBe("searching");
  });

  /**
   * Under React Query's default `networkMode` an offline query does not fail —
   * it pauses, reporting neither an error nor a finished load. Without this
   * branch an offline search is a skeleton that spins until the wifi returns.
   */
  it("calls a paused request offline rather than leaving it spinning", () => {
    expect(searchPhase(status({ paused: true }))).toBe("offline");
  });

  it("prefers offline to failed, because a retry cannot work offline", () => {
    expect(searchPhase(status({ paused: true, isError: true }))).toBe("offline");
  });

  it("distinguishes an empty answer from a failed one", () => {
    expect(searchPhase(status({ answered: true, total: 0 }))).toBe("empty");
    expect(searchPhase(status({ isError: true }))).toBe("failed");
  });

  it("keeps showing results when a background refetch fails", () => {
    // Throwing away a good list because a revalidation timed out is how a flaky
    // catalog turns into a flickering screen.
    expect(searchPhase(status({ answered: true, total: 12, isError: true }))).toBe("results");
    expect(searchPhase(status({ answered: true, total: 12, paused: true }))).toBe("results");
  });
});

describe("resultSummary", () => {
  it("never says “1 results”", () => {
    expect(resultSummary(1, 1, null).title).toBe("1 result");
    expect(resultSummary(2, 2, null).title).toBe("2 results");
  });

  it("shows both numbers under a filter, so the filter is visibly doing something", () => {
    // A bare "6 results" under an active filter reads as a search that found six.
    expect(resultSummary(108, 6, "Illustration Rare").title).toBe("6 of 108 results · Illustration Rare");
  });

  it("treats a filter that matched nothing as a filter problem, not a search problem", () => {
    const summary = resultSummary(108, 0, "Illustration Rare");
    expect(summary.empty).toBe(true);
    expect(summary.title).toContain("Illustration Rare");
    expect(summary.hint).toContain("clear the filter");
  });
});

describe("truncationNote", () => {
  it("says nothing for an answer that fits", () => {
    // Measured against the live catalog: charizard is 108, pikachu 177.
    expect(truncationNote(108)).toBeNull();
    expect(truncationNote(FULL_SEARCH_LIMIT - 1)).toBeNull();
  });

  it("admits a full page is a slice", () => {
    // 250 results that look like all of them is the one lie a count can tell.
    expect(truncationNote(FULL_SEARCH_LIMIT)).toContain(String(FULL_SEARCH_LIMIT));
  });
});

describe("resultCaption", () => {
  function card(over: Partial<PokemonCardSummary> = {}): PokemonCardSummary {
    return {
      id: "sv3-223",
      name: "Charizard ex",
      setName: "Obsidian Flames",
      setCode: "OBF",
      collectorNumber: "223",
      ...over,
    };
  }

  it("states the set and the number, because the name is not enough", () => {
    expect(resultCaption(card())).toBe("Obsidian Flames · 223");
  });

  it("does not leave a dangling separator when a card has no number", () => {
    expect(resultCaption(card({ collectorNumber: "" }))).toBe("Obsidian Flames");
  });
});

describe("failureNote", () => {
  it("never blames the reader for what they typed", () => {
    for (const phase of ["offline", "failed"] as const) {
      const note = failureNote(phase);
      expect(note.detail.toLowerCase()).not.toContain("spelling");
    }
  });

  it("says which kind of nothing it is", () => {
    expect(failureNote("offline").title).toContain("offline");
    expect(failureNote("failed").detail).toContain("Nothing is wrong with what you typed");
  });
});

describe("nothingMatched", () => {
  it("quotes the query back, trimmed", () => {
    expect(nothingMatched("  Charizard  ")).toBe("Nothing matched “Charizard”");
  });
});

describe("recentQueries", () => {
  it("keeps the newest first and caps the offer", () => {
    const recents = Array.from({ length: 20 }, (_, i) => ({ query: `q${i}`, at: i }));
    const queries = recentQueries(recents, 8);
    expect(queries).toHaveLength(8);
    expect(queries[0]).toBe("q0");
  });

  it("drops rows that are only whitespace rather than offering a blank chip", () => {
    expect(
      recentQueries([
        { query: "  ", at: 1 },
        { query: "Pikachu", at: 2 },
      ]),
    ).toEqual(["Pikachu"]);
  });
});
