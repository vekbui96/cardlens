import { useMemo } from "react";
import { useLibrary } from "../app/LibraryProvider.tsx";
import { useSets } from "./useSets.ts";
import { useCollectionValue, type CollectionValueResult } from "./useCollectionValue.ts";
import type { ValuableRow } from "../models/value.ts";

export interface LibraryValue extends CollectionValueResult {
  /** Set id -> display name, for labelling rows. */
  setNames: Record<string, string>;
  /** Printings held. Zero means there is nothing to value yet, not a zero total. */
  holdings: number;
}

/**
 * What the collection is worth, wired straight to the library.
 *
 * useCollectionValue takes rows and set names so it stays testable without
 * providers. This is the one place that builds them from the live collection, so
 * the Home summary and the Collection breakdown cannot drift into two different
 * answers to "what is this worth" — the same mistake useSetView exists to
 * prevent for printings.
 */
export function useLibraryValue(): LibraryValue {
  const { collection } = useLibrary();
  const { data: sets } = useSets();

  const rows = useMemo<ValuableRow[]>(
    () =>
      collection.flatMap((card) =>
        card.finishes.map((finish) => ({
          cardId: card.id,
          // Older rows predate the explicit setId, so fall back to the prefix of
          // the card id — the same derivation the storage layer makes.
          setId: card.setId ?? card.id.slice(0, card.id.lastIndexOf("-")),
          finish,
        })),
      ),
    [collection],
  );

  const setNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const s of sets ?? []) names[s.id] = s.name;
    return names;
  }, [sets]);

  const value = useCollectionValue(rows, setNames);

  return { ...value, setNames, holdings: rows.length };
}
