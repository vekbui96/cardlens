import { formatUsd } from "../../../utils/format.ts";
import type { WantCard, WantSet } from "./wantList.ts";

export type WantSort = "set" | "cheapest" | "expensive";

export interface WantFilters {
  /** One set, or null for all of them. */
  setId: string | null;
  /** Rarities kept; empty means every rarity. */
  rarities: readonly string[];
  sort: WantSort;
}

export const DEFAULT_WANT_FILTERS: WantFilters = { setId: null, rarities: [], sort: "set" };

export const WANT_SORT_LABELS: Record<WantSort, string> = {
  cheapest: "Cheapest first",
  expensive: "Most expensive first",
  set: "Set order",
};

/** Device-local only: never synced, not a cache (no version bump). */
export const WANT_FILTERS_KEY = "cardlens:v1:want-filters";

export const isFiltering = (f: WantFilters): boolean => f.setId !== null || f.rarities.length > 0;

/** Unpriced cards go last in either price order: they are not "cheapest". */
function compareBy(sort: WantSort): ((a: WantCard, b: WantCard) => number) | null {
  if (sort === "set") return null;
  const dir = sort === "cheapest" ? 1 : -1;
  return (a, b) => {
    if (a.price === null && b.price === null) return 0;
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return (a.price - b.price) * dir;
  };
}

/**
 * One set's missing cards narrowed to the chosen rarities and sorted, with its
 * counts and total recomputed from what is left (priced ones only, to cents),
 * so a header and a section can never disagree. Pure.
 */
export function applyWantFilters(want: WantSet, filters: WantFilters): WantSet {
  const kept = filters.rarities.length
    ? want.cards.filter((c) => c.rarity !== undefined && filters.rarities.includes(c.rarity))
    : [...want.cards];
  const compare = compareBy(filters.sort);
  if (compare) kept.sort(compare); // stable: equal prices keep set order
  const priced = kept.filter((c) => c.price !== null);
  const total = Math.round(priced.reduce((n, c) => n + (c.price ?? 0), 0) * 100) / 100;
  return {
    cards: kept,
    missing: kept.length,
    priced: priced.length,
    unpriced: kept.length - priced.length,
    total,
  };
}

/** The rarities present among the missing cards, in first-seen order. */
export function wantRarities(wants: readonly (WantSet | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const want of wants) for (const card of want?.cards ?? []) if (card.rarity) seen.add(card.rarity);
  return [...seen];
}

/** The header while a filter is on: "Showing 31 cards, about $96.00". */
export function wantFilteredHeadline(totals: {
  missing: number;
  priced: number;
  unpriced: number;
  total: number;
}): string {
  if (totals.missing === 0) return "No missing cards match these filters";
  const count = `${totals.missing} ${totals.missing === 1 ? "card" : "cards"}`;
  if (totals.priced === 0) return `Showing ${count}, none priced`;
  return `Showing ${count}, about ${formatUsd(totals.total)}${totals.unpriced > 0 ? `, ${totals.unpriced} unpriced` : ""}`;
}

const SORTS: readonly string[] = ["set", "cheapest", "expensive"];

export function readWantFilters(): WantFilters {
  try {
    const raw = window.localStorage.getItem(WANT_FILTERS_KEY);
    if (!raw) return DEFAULT_WANT_FILTERS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_WANT_FILTERS;
    const p = parsed as Record<string, unknown>;
    return {
      setId: typeof p.setId === "string" && p.setId ? p.setId : null,
      rarities: Array.isArray(p.rarities) ? p.rarities.filter((r): r is string => typeof r === "string") : [],
      sort: typeof p.sort === "string" && SORTS.includes(p.sort) ? (p.sort as WantSort) : "set",
    };
  } catch {
    return DEFAULT_WANT_FILTERS;
  }
}

export function storeWantFilters(filters: WantFilters): void {
  try {
    if (!isFiltering(filters) && filters.sort === "set") window.localStorage.removeItem(WANT_FILTERS_KEY);
    else window.localStorage.setItem(WANT_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Refused storage: the choice lasts for this page only.
  }
}
