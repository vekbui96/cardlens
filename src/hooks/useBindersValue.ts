import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SetPrintings } from "../integrations/tcgdex/client.ts";
import { buildPrintingIndex, printingPrice, type SetPrintingIndex } from "../models/printingIndex.ts";
import type { Binder } from "../models/binderLayout.ts";
import { cardSlotsOf, summariseBinderValue, type BinderValueSummary } from "../models/binderValue.ts";
import { setIdFromCardId } from "../utils/cardId.ts";
import { setPrintingsQuery } from "./useBinderValue.ts";
import { useSets } from "./useSets.ts";

/**
 * What several binders are worth, for the list screen.
 *
 * Not `useBinderValue` in a loop — hooks cannot be called per item, and even if
 * they could it would ask for the same set once per binder that touches it.
 * This takes the UNION of sets across every binder it is given and asks once
 * per set, so two binders that share a set share the request.
 *
 * Same query key as the binder screen and the set screens, so opening a binder
 * after seeing its total on the list costs nothing, and vice versa.
 *
 * **Only the binders passed in are priced.** The caller filters to the ones
 * that opted in via `showValue`, because the cost is per binder: pricing one
 * means a request for every set it spans, and the list screen otherwise asks
 * for nothing at all. A collector wants the total on the two or three binders
 * that represent money, not on every master set they are part-way through.
 */

export interface BindersValue {
  /** Summary per binder id. Absent means the binder was not asked about. */
  byId: Map<string, BinderValueSummary>;
  /** True while any set is still being asked about. */
  isLoading: boolean;
}

const EMPTY: BindersValue = { byId: new Map(), isLoading: false };

export function useBindersValue(binders: Binder[]): BindersValue {
  const { data: allSets } = useSets();
  const setNames = useMemo(() => new Map((allSets ?? []).map((s) => [s.id, s.name] as const)), [allSets]);

  /** Card pockets per binder, resolved once so the sum and the set list agree. */
  const slotsById = useMemo(
    () => binders.map((binder) => [binder.id, cardSlotsOf(binder)] as const),
    [binders],
  );

  const setIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [, slots] of slotsById) for (const s of slots) ids.add(setIdFromCardId(s.cardId));
    return [...ids].sort();
  }, [slotsById]);

  const results = useQueries({
    queries: setIds.map((setId) => setPrintingsQuery(setId, setNames.get(setId))),
  });

  const indexes = useMemo(() => {
    const map = new Map<string, SetPrintingIndex | null>();
    setIds.forEach((setId, i) => {
      const data = results[i]?.data as SetPrintings | null | undefined;
      map.set(setId, buildPrintingIndex(data?.byNumber));
    });
    return map;
    // Results are a new array each render; the settled data inside is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setIds, results.map((r) => r.dataUpdatedAt).join(",")]);

  const isLoading = results.some((r) => r.isLoading);

  return useMemo(() => {
    if (slotsById.length === 0) return EMPTY;
    const byId = new Map<string, BinderValueSummary>();
    for (const [id, slots] of slotsById) {
      byId.set(
        id,
        summariseBinderValue(slots, (slot) =>
          slot.kind === "card" && slot.collectorNumber
            ? printingPrice(indexes.get(setIdFromCardId(slot.cardId)), slot.collectorNumber, slot.finish)
            : undefined,
        ),
      );
    }
    return { byId, isLoading };
  }, [slotsById, indexes, isLoading]);
}
