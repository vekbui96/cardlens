import { useMemo } from "react";
import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { EmptyState, LoadingState } from "../../components/States.tsx";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useSets } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { SetProgressRow } from "./SetProgressRow.tsx";

interface SetProgress {
  setId: string;
  setName: string;
  owned: number;
  /** Printings held in this set — can exceed `owned` when variants are tracked. */
  printings: number;
  total?: number;
  /** 0–1, or undefined when the set's size isn't known yet. */
  ratio?: number;
}

/** Every set you own cards from, closest to complete first — the master-set view. */
export function CollectionScreen() {
  const { push, pop } = useNavigation();
  const { collection, ownedCountsBySet, ownedFinishCountsBySet, totalFinishesOwned } = useLibrary();
  const enabled = useScreenInputEnabled();
  const { data: sets, isLoading } = useSets();

  const rows = useMemo<SetProgress[]>(() => {
    const byId = new Map((sets ?? []).map((s) => [s.id, s]));
    return Object.entries(ownedCountsBySet)
      .map(([setId, owned]) => {
        const set = byId.get(setId);
        const total = set?.total;
        return {
          setId,
          printings: ownedFinishCountsBySet[setId] ?? owned,
          // A set can be missing from the list (new release, or a cache miss);
          // its id is still a better label than dropping the row entirely.
          setName: set?.name ?? setId,
          owned,
          ...(total ? { total, ratio: Math.min(1, owned / total) } : {}),
        };
      })
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.owned - a.owned);
  }, [sets, ownedCountsBySet, ownedFinishCountsBySet]);

  const completed = rows.filter((r) => r.ratio === 1).length;

  const { backFocused, itemIndex } = useBackableFocus({
    count: rows.length,
    enabled,
    onBack: pop,
    onSelect: (i) => {
      const row = rows[i];
      if (row) push({ name: "set", setId: row.setId, setName: row.setName });
    },
  });

  const subtitle = collection.length
    ? `${collection.length} cards · ${totalFinishesOwned} printings · ${rows.length} sets${
        completed ? ` · ${completed} complete` : ""
      }`
    : "Nothing tracked yet";

  return (
    <Screen title="Collection" subtitle={subtitle} canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      {isLoading && rows.length === 0 ? <LoadingState label="Loading sets…" /> : null}
      {rows.length === 0 && !isLoading ? (
        <EmptyState
          title="No cards tracked"
          hint="Open a set, turn on Collect mode, then select cards you own"
        />
      ) : null}
      {rows.length > 0 ? (
        <FocusList
          items={rows}
          focusIndex={itemIndex}
          getKey={(r) => r.setId}
          ariaLabel="Sets in your collection"
          onActivate={(i) => push({ name: "set", setId: rows[i].setId, setName: rows[i].setName })}
          renderItem={(row) => (
            <SetProgressRow
              name={row.setName}
              owned={row.owned}
              printings={row.printings}
              {...(row.total ? { total: row.total } : {})}
              {...(row.ratio === undefined ? {} : { ratio: row.ratio })}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
