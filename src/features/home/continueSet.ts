import type { OwnedCard } from "../../storage/repositories.ts";
import type { PokemonSet } from "../../models/cards.ts";

export interface ContinueTarget {
  setId: string;
  setName: string;
  cards: number;
  total?: number;
  printings: number;
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
): ContinueTarget | null {
  let newest: OwnedCard | null = null;
  for (const card of collection) {
    if (!newest || card.at > newest.at) newest = card;
  }
  if (!newest) return null;

  const set = sets?.find((s) => s.id === newest.setId);
  const total = set?.total;
  return {
    setId: newest.setId,
    // The set list may not have loaded, or may not contain it; the id is a
    // worse label than the name but far better than hiding the row.
    setName: set?.name ?? newest.setId,
    cards: countsBySet[newest.setId] ?? 0,
    ...(total ? { total } : {}),
    printings: printingsBySet[newest.setId] ?? 0,
  };
}

/** Sets closest to complete first — only those whose size is known. */
export function topProgress(
  countsBySet: Record<string, number>,
  sets: PokemonSet[] | undefined,
  limit = 3,
): { setId: string; setName: string; cards: number; total: number; ratio: number }[] {
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
          ratio: Math.min(1, cards / set.total),
        },
      ];
    })
    .sort((a, b) => b.ratio - a.ratio || b.cards - a.cards)
    .slice(0, limit);
}
