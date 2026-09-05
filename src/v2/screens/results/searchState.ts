import { FULL_SEARCH_LIMIT } from "../../../integrations/providers.ts";
import { normalizeQuery } from "../../../services/search/normalize.ts";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import type { RecentSearch } from "../../../storage/repositories.ts";

/**
 * The decisions the search screen makes, with no React around them.
 *
 * Search has one property that makes its states unusually easy to get wrong: it
 * is the only screen in the app whose data source is expected to fail. The
 * catalog errors in bursts about a quarter of the time and rate-limits on top of
 * that, so "nothing came back" has at least five different meanings — nothing
 * was asked for, nothing has come back YET, nothing ever will because the device
 * is offline, the request failed, or the catalog genuinely has no Charizard
 * numbered 999. A screen that collapses those into one empty strip is a screen
 * that tells the user to check their spelling when the network is down.
 *
 * They are pulled out here so each one can be asserted rather than eyeballed.
 */

/* --- What counts as a search ---------------------------------------------- */

/**
 * Is there anything here worth spending a request on?
 *
 * **This predicate must agree with `useCatalogSearch`'s `enabled`,** which is
 * the same expression over the same normaliser. If it did not, a query that the
 * hook refuses to run would leave the screen in `searching` with nothing on the
 * wire — a skeleton that never resolves, which is the single worst state a
 * screen can be in because it looks like the app is working.
 *
 * `normalizeQuery` is what decides: "  " has neither a name nor a collector
 * number, and neither does "#!". "025" has a number and no name, which IS a
 * search — a collector number on its own is how you find a card whose name you
 * cannot spell.
 */
export function searchable(query: string): boolean {
  const normalized = normalizeQuery(query);
  return Boolean(normalized.name || normalized.collectorNumber);
}

/* --- Phase ---------------------------------------------------------------- */

export type SearchPhase = "idle" | "searching" | "offline" | "failed" | "empty" | "results";

export interface SearchStatus {
  /** The SUBMITTED query — what the URL says, never what is in the box. */
  query: string;
  /** The catalog has given an answer, even an empty one. `data !== undefined`. */
  answered: boolean;
  /**
   * React Query holds the request but the device has no network, so it never
   * left. Under the default `networkMode: "online"` a query does not FAIL
   * offline — it pauses, indefinitely, reporting neither an error nor a
   * finished load. Without this branch an offline search is a skeleton that
   * spins until the wifi comes back, and says nothing about why.
   */
  paused: boolean;
  isError: boolean;
  /** Results in hand, before any local filter. */
  total: number;
}

/**
 * Which of the six things is happening.
 *
 * Order matters twice over:
 *
 * - `answered` is checked before `isError`, so a failed REFETCH keeps showing
 *   the results already on screen. Throwing away a good list because a
 *   background revalidation timed out is how a flaky catalog turns into a
 *   flickering screen.
 * - `paused` is checked before `isError` for the reason above: offline is not a
 *   catalog failure, and "the catalog is having a moment, try again" next to a
 *   retry button that cannot possibly work is worse than saying nothing.
 */
export function searchPhase(status: SearchStatus): SearchPhase {
  if (!searchable(status.query)) return "idle";
  if (status.answered) return status.total === 0 ? "empty" : "results";
  if (status.paused) return "offline";
  if (status.isError) return "failed";
  return "searching";
}

/* --- Words ---------------------------------------------------------------- */

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export interface ResultSummary {
  /** The heading over the grid, or the title of the filtered-empty state. */
  title: string;
  /** Present only when a filter emptied the list — what to do about it. */
  hint?: string;
  /** The filter matched nothing. The caller draws an empty state, not a count. */
  empty: boolean;
}

/**
 * What a list of results calls itself.
 *
 * Always "n results", never a bare grid: a name search returns 108 Charizards
 * and a number search returns two, and the difference between "this is
 * everything" and "this is a slice" is the count.
 *
 * When a rarity filter is on, BOTH numbers appear — "6 of 108" — because the
 * denominator is the only thing that says the filter is doing something. A bare
 * "6 results" under an active filter reads as a search that found six cards.
 */
export function resultSummary(total: number, matched: number, rarityLabel: string | null): ResultSummary {
  if (rarityLabel === null) {
    return { title: `${total} ${plural(total, "result", "results")}`, empty: false };
  }
  if (matched === 0) {
    return {
      title: `No ${rarityLabel} cards among these results`,
      hint: "Try another rarity, or clear the filter to see everything that matched.",
      empty: true,
    };
  }
  return {
    title: `${matched} of ${total} ${plural(total, "result", "results")} · ${rarityLabel}`,
    empty: false,
  };
}

/**
 * The line a truncated answer has to carry.
 *
 * A `full` search is one request at the API's maximum page and is never paged —
 * measured against the live catalog the busiest names fit inside it (pikachu
 * 177, charizard 108, eevee 85), so this fires only for a query so broad that
 * paging it would spend extra requests on an endpoint that already fails ~25% of
 * the time in bursts. When it does fire, the list is a slice and must say so:
 * 250 results that look like all of them is a lie that costs nothing to avoid.
 */
export function truncationNote(total: number): string | null {
  if (total < FULL_SEARCH_LIMIT) return null;
  return `That is the first ${FULL_SEARCH_LIMIT} matches — add a word to narrow it.`;
}

/**
 * What a result says about itself beyond its name.
 *
 * The name is never enough: a search for Charizard returns 108 of them and
 * eleven share the name exactly. Set and collector number are what tell two
 * apart, so they are part of the tile rather than something you open a card to
 * find out.
 */
export function resultCaption(card: PokemonCardSummary): string {
  return card.collectorNumber ? `${card.setName} · ${card.collectorNumber}` : card.setName;
}

/** What an empty search says. Never "check your spelling" — see `failureNote`. */
export function nothingMatched(query: string): string {
  return `Nothing matched “${query.trim()}”`;
}

/**
 * Why a search came back with nothing, and what to do about it.
 *
 * Split on WHICH kind of nothing, because the two mean opposite things and only
 * one of them is the user's problem. An offline device cannot be fixed by
 * spelling; a catalog outage cannot be fixed by anything except waiting. Both
 * of them blamed the user in v1, which said "Check the spelling or search by
 * Pokémon" whatever had actually gone wrong.
 */
export function failureNote(phase: "offline" | "failed"): { title: string; detail: string } {
  if (phase === "offline") {
    return {
      title: "You’re offline",
      detail:
        "Searching needs the network. Everything you have already marked is on this device and still works — this screen is the one part that cannot.",
    };
  }
  return {
    title: "The catalog didn’t answer",
    detail:
      "Nothing is wrong with what you typed. The card catalog fails in bursts and rate-limits, so a second attempt usually lands.",
  };
}

/* --- Recent searches ------------------------------------------------------- */

/**
 * The queries to offer on an idle screen, newest first.
 *
 * Capped, because this list is an offer and not an archive: the repository keeps
 * more than fits on a phone without scrolling, and a wall of twenty old queries
 * buries the two you actually repeat.
 */
export function recentQueries(recents: RecentSearch[], limit = 8): string[] {
  return recents
    .map((r) => r.query.trim())
    .filter((q) => q.length > 0)
    .slice(0, limit);
}
