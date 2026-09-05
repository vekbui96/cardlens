import type { PokemonSet } from "../../../models/cards.ts";
import { setTiers, type SetTiers } from "../../../models/setCompletion.ts";
import { compareCompletion, ownedIn } from "../../../features/collection/completionTier.ts";

/**
 * How the set list is grouped and ordered.
 *
 * Pure, and separate from the rendering, because this is the part with a right
 * answer: which group a set belongs in, and what "closest to finished" means.
 * The row markup is not worth a test; this is.
 *
 * **Nothing here orders by value.** The value panel above the list answers
 * "what is it worth"; this list answers "how far through it am I", and sorting
 * it by price would put a single $400 promo above a set that is two cards short.
 * Started sets rank by completion (`compareCompletion`, shared with v1 so the
 * two versions cannot disagree), and everything else keeps the catalog's own
 * order — newest first, from `useSets`.
 */

export interface SetRowModel {
  set: PokemonSet;
  tiers: SetTiers;
  /** Distinct cards held in this set. Zero for a set never started. */
  owned: number;
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
    .map((set) => ({ set, tiers: tiersFor(set), owned: ownedCountsBySet[set.id] ?? 0 }))
    .sort(compareCompletion);

  return {
    inProgress: started.filter((s) => s.tiers.tier === "none"),
    complete: started.filter((s) => s.tiers.tier !== "none"),
    started,
    rest: all
      .filter((s) => (ownedCountsBySet[s.id] ?? 0) === 0)
      .map((set) => ({ set, tiers: tiersFor(set), owned: 0 })),
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
export function rowLabel({ set, tiers, owned }: SetRowModel): string {
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
