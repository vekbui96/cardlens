import { useMemo } from "react";
import type { CollectFinish } from "../models/cards.ts";
import { useLibrary } from "../app/LibraryProvider.tsx";
import { useSets } from "./useSets.ts";

export interface CollectedSet {
  setId: string;
  setName: string;
  owned: number;
  /** Printings held in this set — can exceed `owned` when variants are tracked. */
  printings: number;
  finishes: Partial<Record<CollectFinish, number>>;
  total?: number;
  /** 0–1, or undefined when the set's size isn't known yet. */
  ratio?: number;
}

/**
 * Every set you own cards from, closest to complete first.
 *
 * Shared by the Collection screen and the set switcher so there is one answer
 * to "which sets am I working on, and in what order" rather than two that can
 * drift — the switcher exists to jump between the rows Collection lists, and a
 * different order in each would make it a different list wearing the same name.
 *
 * The set list is only used to put names and totals on rows. The collection
 * itself is local, so nothing here may block on that query: gating on it left
 * the glasses (empty localStorage, flaky network) loading forever, with no
 * error branch to escape through. A set missing from the list keeps its id as
 * a label rather than dropping out.
 */
export function useCollectedSets(): CollectedSet[] {
  const { ownedCountsBySet, ownedFinishCountsBySet, finishesBySet } = useLibrary();
  const { data: sets } = useSets();

  return useMemo<CollectedSet[]>(() => {
    const byId = new Map((sets ?? []).map((s) => [s.id, s]));
    return Object.entries(ownedCountsBySet)
      .map(([setId, owned]) => {
        const set = byId.get(setId);
        const total = set?.total;
        return {
          setId,
          printings: ownedFinishCountsBySet[setId] ?? owned,
          finishes: finishesBySet[setId] ?? {},
          setName: set?.name ?? setId,
          owned,
          ...(total ? { total, ratio: Math.min(1, owned / total) } : {}),
        };
      })
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.owned - a.owned);
  }, [sets, ownedCountsBySet, ownedFinishCountsBySet, finishesBySet]);
}
