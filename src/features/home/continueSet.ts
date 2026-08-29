import type { OwnedCard } from "../../storage/repositories.ts";
import type { PokemonSet } from "../../models/cards.ts";
import { setTiers, type SetTiers } from "../../models/setCompletion.ts";
import { compareCompletion, ownedIn } from "../collection/completionTier.ts";

/**
 * Collector numbers of the owned cards, per set.
 *
 * Optional throughout this module: without them `setTiers` declines the base
 * tier and every caller falls back to the master figure, which is what these
 * functions returned before there were two tiers at all.
 */
export type OwnedNumbers = Record<string, string[]>;

export interface ContinueTarget {
  setId: string;
  setName: string;
  cards: number;
  total?: number;
  printings: number;
  tiers: SetTiers;
}

/**
 * The set to offer resuming: whichever was marked most recently.
 *
 * Master-setting is a grind spread over sessions, and resuming currently costs
 * Sets -> scroll -> open -> enable collect mode. The newest `at` across owned
 * rows already identifies where you were, so no new state is needed.
 */
export function continueTarget(
  collection: OwnedCard[],
  sets: PokemonSet[] | undefined,
  countsBySet: Record<string, number>,
  printingsBySet: Record<string, number>,
  numbersBySet: OwnedNumbers = {},
): ContinueTarget | null {
  let newest: OwnedCard | null = null;
  for (const card of collection) {
    if (!newest || card.at > newest.at) newest = card;
  }
  if (!newest) return null;

  const set = sets?.find((s) => s.id === newest.setId);
  const total = set?.total;
  const cards = countsBySet[newest.setId] ?? 0;
  return {
    setId: newest.setId,
    // The set list may not have loaded, or may not contain it; the id is a
    // worse label than the name but far better than hiding the row.
    setName: set?.name ?? newest.setId,
    cards,
    ...(total ? { total } : {}),
    printings: printingsBySet[newest.setId] ?? 0,
    tiers: setTiers(
      { ...(total ? { total } : {}), ...(set?.printedTotal ? { printedTotal: set.printedTotal } : {}) },
      ownedIn(newest.setId, numbersBySet, cards),
    ),
  };
}

/**
 * Sets closest to complete first — only those whose size is known.
 *
 * "Closest" is the BASE tier where a set has one, because this list answers
 * "what can I finish". Secret rares are the part of a set a collector may never
 * chase, and ranking on them buries the set that is three commons short behind
 * one that needs a chase card nobody pulls.
 */
export function topProgress(
  countsBySet: Record<string, number>,
  sets: PokemonSet[] | undefined,
  numbersBySet: OwnedNumbers = {},
  limit = 3,
): { setId: string; setName: string; cards: number; total: number; tiers: SetTiers }[] {
  const byId = new Map((sets ?? []).map((s) => [s.id, s]));
  return Object.entries(countsBySet)
    .flatMap(([setId, cards]) => {
      const set = byId.get(setId);
      if (!set?.total) return [];
      return [
        {
          setId,
          setName: set.name,
          cards,
          total: set.total,
          tiers: setTiers(
            { total: set.total, ...(set.printedTotal ? { printedTotal: set.printedTotal } : {}) },
            ownedIn(setId, numbersBySet, cards),
          ),
        },
      ];
    })
    .sort((a, b) => compareCompletion({ tiers: a.tiers, owned: a.cards }, { tiers: b.tiers, owned: b.cards }))
    .slice(0, limit);
}
