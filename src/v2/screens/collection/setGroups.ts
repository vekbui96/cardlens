import type { PokemonSet } from "../../../models/cards.ts";
import { setTiers, type SetTiers } from "../../../models/setCompletion.ts";
import { formatUsd } from "../../../utils/format.ts";
import { compareCompletion, ownedIn, shownRatio } from "../../../features/collection/completionTier.ts";

/**
 * How the set list is grouped and ordered.
 *
 * Pure, and separate from the rendering, because this is the part with a right
 * answer: which group a set belongs in, and what "closest to finished" means.
 * The row markup is not worth a test; this is.
 *
 * **The default order is never by value.** The list answers "how far through
 * it am I", and sorting it by price would put a single $400 promo above a set
 * that is two cards short. Started sets rank by completion (`compareCompletion`,
 * shared with v1 so the two versions cannot disagree), and everything else
 * keeps the catalog's own order — newest first, from `useSets`. "Most
 * valuable" is an opt-in sort chip that reads the Value panel's per-set totals.
 */

export interface SetRowModel {
  set: PokemonSet;
  tiers: SetTiers;
  /** Distinct cards held in this set. Zero for a set never started. */
  owned: number;
  /** What the set is worth; absent for a set never started or when pricing is not wired. */
  worth?: SetWorth;
}

export interface SetGroups {
  /** Started, not finished. What a tracker's landing list is actually for. */
  inProgress: SetRowModel[];
  /** Base- or master-complete. Trophies, under their own heading. */
  complete: SetRowModel[];
  /** Everything untouched, in catalog order. */
  rest: SetRowModel[];
  /** inProgress + complete, for the summary line. */
  started: SetRowModel[];
  /** How many sets the filter removed. Zero when there is no filter. */
  hiddenByFilter: number;
}

export type SetSortKey = "recent" | "complete" | "missing" | "az" | "value";

export const SET_SORTS: readonly { key: SetSortKey; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "complete", label: "Most complete" },
  { key: "missing", label: "Fewest missing" },
  { key: "az", label: "A to Z" },
  { key: "value", label: "Most valuable" },
];

/** What one owned set is worth, as far as is known. Never a number for a set with no price. */
export type SetWorth = { state: "priced"; value: number } | { state: "pricing" } | { state: "unpriced" };

/**
 * Per-set worth from the totals the Value panel already holds (`bySet`).
 *
 * A set with no priced printing is "unpriced" once pricing has settled and
 * "pricing" until then; a partly priced set is "pricing" while anything is
 * still loading, so a lower bound is never shown as the answer. Never 0.
 */
export function setWorths(
  bySet: readonly { setId: string; printings: number; priced: number; value: number }[],
  pending: number,
): Record<string, SetWorth> {
  const out: Record<string, SetWorth> = {};
  for (const s of bySet) {
    out[s.setId] =
      pending > 0 && s.priced < s.printings
        ? { state: "pricing" }
        : s.priced > 0 && s.value > 0
          ? { state: "priced", value: s.value }
          : { state: "unpriced" };
  }
  return out;
}

/** The short line under a started row; the same words in the accessible name. */
export function worthText(worth: SetWorth | undefined): string | undefined {
  if (!worth) return undefined;
  if (worth.state === "priced") return `about ${formatUsd(worth.value)}`;
  return worth.state === "pricing" ? "pricing" : "unpriced";
}

const worthOf = (row: SetRowModel): number | undefined =>
  row.worth?.state === "priced" ? row.worth.value : undefined;

/** Cards still missing on the tier the row draws; undefined when the size is unknown. */
function missingOf({ tiers }: SetRowModel): number | undefined {
  return tiers.baseTotal !== undefined
    ? tiers.baseTotal - tiers.baseOwned
    : tiers.masterTotal !== undefined
      ? tiers.masterTotal - tiers.masterOwned
      : undefined;
}

/**
 * Re-order the rows of one group. `recent` is today's order, untouched. The
 * others are stable (ties keep the incoming order) and a set whose size is
 * unknown goes last — never counted as 0% or as finished.
 */
export function sortRows(rows: SetRowModel[], sort: SetSortKey): SetRowModel[] {
  if (sort === "recent") return rows;
  const indexed = rows.map((row, i) => ({ row, i }));
  const byKnown = (va: number | undefined, vb: number | undefined, dir: 1 | -1): number =>
    va === undefined ? (vb === undefined ? 0 : 1) : vb === undefined ? -1 : dir * (va - vb);
  indexed.sort((x, y) => {
    let c = 0;
    if (sort === "complete") c = byKnown(shownRatio(x.row.tiers), shownRatio(y.row.tiers), -1);
    else if (sort === "missing") c = byKnown(missingOf(x.row), missingOf(y.row), 1);
    else if (sort === "value")
      c =
        byKnown(worthOf(x.row), worthOf(y.row), -1) ||
        x.row.set.name.localeCompare(y.row.set.name, undefined, { sensitivity: "base" });
    else c = x.row.set.name.localeCompare(y.row.set.name, undefined, { sensitivity: "base" });
    return c || x.i - y.i;
  });
  return indexed.map((e) => e.row);
}

/**
 * Does this set match what was typed?
 *
 * Name, code, id and release year — the four things a collector actually types.
 * A set is called "Obsidian Flames", filed as `sv3`, printed as OBF and
 * remembered as "the 2023 one", and a filter that only knew the name would miss
 * three of those four.
 */
export function matchesQuery(set: PokemonSet, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [set.name, set.code ?? "", set.id, set.releaseDate?.slice(0, 4) ?? ""];
  return fields.some((f) => f.toLowerCase().includes(q));
}

/**
 * Three groups, not two.
 *
 * A set whose base run is finished is not "in progress" — leaving it there
 * means scrolling past your own trophies to find the sets that still need
 * cards. Inherited from v1's `WebSetsScreen`, which learned it the hard way.
 */
export function groupSets(
  sets: readonly PokemonSet[],
  ownedCountsBySet: Record<string, number>,
  ownedNumbersBySet: Record<string, string[]>,
  query = "",
  sort: SetSortKey = "recent",
  worths: Record<string, SetWorth> = {},
): SetGroups {
  const all = sets.filter((s) => matchesQuery(s, query));
  const hiddenByFilter = sets.length - all.length;

  const tiersFor = (set: PokemonSet): SetTiers =>
    setTiers(
      {
        ...(set.total ? { total: set.total } : {}),
        ...(set.printedTotal ? { printedTotal: set.printedTotal } : {}),
      },
      ownedIn(set.id, ownedNumbersBySet, ownedCountsBySet[set.id] ?? 0),
    );

  const started = all
    .filter((s) => (ownedCountsBySet[s.id] ?? 0) > 0)
    .map((set) => {
      const worth = worths[set.id];
      return {
        set,
        tiers: tiersFor(set),
        owned: ownedCountsBySet[set.id] ?? 0,
        ...(worth ? { worth } : {}),
      };
    })
    .sort(compareCompletion);

  return {
    inProgress: sortRows(
      started.filter((s) => s.tiers.tier === "none"),
      sort,
    ),
    complete: sortRows(
      started.filter((s) => s.tiers.tier !== "none"),
      sort,
    ),
    started,
    rest: sortRows(
      all
        .filter((s) => (ownedCountsBySet[s.id] ?? 0) === 0)
        .map((set) => ({ set, tiers: tiersFor(set), owned: 0 })),
      sort,
    ),
    hiddenByFilter,
  };
}

/**
 * The full sentence a screen reader gets for one row, with both tiers spelled
 * out.
 *
 * The visible row abbreviates — `BASE 1/197` — because it has to fit beside the
 * set name in a 339px column. The label does not, so it says "base set 1 of
 * 197" and names the tier that is complete. Here rather than in the component
 * because it is wording, which is worth a test; the markup around it is not.
 */
export function rowLabel({ set, tiers, owned, worth }: SetRowModel): string {
  if (owned === 0) {
    return set.total ? `${set.name}, ${set.total} cards, none owned` : `${set.name}, none owned`;
  }
  const parts: string[] = [set.name];
  if (tiers.baseTotal !== undefined) {
    parts.push(
      `base set ${tiers.baseOwned} of ${tiers.baseTotal}${tiers.baseOwned >= tiers.baseTotal ? ", complete" : ""}`,
    );
  }
  parts.push(
    tiers.masterTotal === undefined
      ? `${tiers.masterOwned} cards tracked`
      : `master set ${tiers.masterOwned} of ${tiers.masterTotal}${
          tiers.masterOwned >= tiers.masterTotal ? ", complete" : ""
        }`,
  );
  const worthWords = worthText(worth);
  if (worthWords) parts.push(worthWords);
  return parts.join(", ");
}

/**
 * The one-line summary under the heading.
 *
 * Counted through `setTiers`, never through `owned === total`: v1 had three
 * separate expressions for "is this set complete" and they disagreed, so a set
 * at 99.7% rounded to 100% on one screen and showed no star on another.
 * `master` implies base, so a master-complete set is counted in both figures.
 */
export function summaryLine(
  cards: number,
  printings: number,
  groups: Pick<SetGroups, "started" | "complete">,
): string {
  if (cards === 0) return "Nothing tracked yet";
  const masterDone = groups.complete.filter((s) => s.tiers.tier === "master").length;
  const milestones = [
    ...(groups.complete.length ? [`${groups.complete.length} base`] : []),
    ...(masterDone ? [`${masterDone} master`] : []),
  ].join(" · ");
  const sets = `${groups.started.length} ${groups.started.length === 1 ? "set" : "sets"}`;
  return `${cards} cards · ${printings} printings · ${sets}${milestones ? ` · ${milestones}` : ""}`;
}
