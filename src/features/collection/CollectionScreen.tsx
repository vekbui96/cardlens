import { useMemo, useRef } from "react";
import type { CollectFinish } from "../../models/cards.ts";
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
import { ToggleRow } from "../../components/ToggleRow.tsx";
import { useTextEntry } from "../../app/TextEntryProvider.tsx";
import { syncLine } from "./syncLine.ts";

interface SetProgress {
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

/** Every set you own cards from, closest to complete first — the master-set view. */
export function CollectionScreen() {
  const { push, pop } = useNavigation();
  const {
    collection,
    ownedCountsBySet,
    ownedFinishCountsBySet,
    totalFinishesOwned,
    finishesBySet,
    syncStatus,
    syncNow,
    setSyncToken,
    disconnectSync,
  } = useLibrary();
  const { provider: textProvider } = useTextEntry();
  const enabled = useScreenInputEnabled();
  const { data: sets, isLoading } = useSets();
  const itemIndexRef = useRef(0);

  const rows = useMemo<SetProgress[]>(() => {
    const byId = new Map((sets ?? []).map((s) => [s.id, s]));
    return Object.entries(ownedCountsBySet)
      .map(([setId, owned]) => {
        const set = byId.get(setId);
        const total = set?.total;
        return {
          setId,
          printings: ownedFinishCountsBySet[setId] ?? owned,
          finishes: finishesBySet[setId] ?? {},
          // A set can be missing from the list (new release, or a cache miss);
          // its id is still a better label than dropping the row entirely.
          setName: set?.name ?? setId,
          owned,
          ...(total ? { total, ratio: Math.min(1, owned / total) } : {}),
        };
      })
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.owned - a.owned);
  }, [sets, ownedCountsBySet, ownedFinishCountsBySet, finishesBySet]);

  const completed = rows.filter((r) => r.ratio === 1).length;

  /**
   * Selecting the sync row does the useful thing for the current state rather
   * than opening a settings screen: connect when off, retry when stuck,
   * disconnect when working. One row, no submenu — screen space on a 600x600
   * display is the scarcest thing here.
   */
  const onSyncSelect = async () => {
    if (syncStatus.state === "off" || syncStatus.state === "bad-token") {
      const token = await textProvider.requestInput({
        title: "Sync token",
        placeholder: "paste from the server .env",
      });
      if (token) setSyncToken(token);
      return;
    }
    if (syncStatus.state === "disabled") return; // nothing the device can fix
    syncNow();
  };

  const { backFocused, itemIndex } = useBackableFocus({
    count: rows.length + 1, // slot 0 is the sync row
    enabled,
    onBack: pop,
    // Swipe left on the sync row forgets the token. It is the only spare
    // gesture on this screen, and disconnecting is rare enough that burying it
    // behind a deliberate sideways swipe is right — an accidental pinch should
    // never wipe the device's credentials.
    onLeft: () => {
      if (itemIndexRef.current === 0) disconnectSync();
    },
    onSelect: (i) => {
      if (i === 0) {
        void onSyncSelect();
        return;
      }
      const row = rows[i - 1];
      if (row) push({ name: "set", setId: row.setId, setName: row.setName });
    },
  });
  const syncFocused = itemIndex === 0;
  const sync = syncLine(syncStatus);
  // onLeft closes over the first render's itemIndex, so read it through a ref.
  itemIndexRef.current = itemIndex;

  const subtitle = collection.length
    ? `${collection.length} cards · ${totalFinishesOwned} printings · ${rows.length} sets${
        completed ? ` · ${completed} complete` : ""
      }`
    : "Nothing tracked yet";

  return (
    <Screen title="Collection" subtitle={subtitle} canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      <ToggleRow
        label={sync.label}
        hint={sync.hint}
        on={sync.on}
        focused={syncFocused}
        onActivate={() => void onSyncSelect()}
      />
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
          focusIndex={itemIndex - 1}
          getKey={(r) => r.setId}
          ariaLabel="Sets in your collection"
          onActivate={(i) => push({ name: "set", setId: rows[i].setId, setName: rows[i].setName })}
          renderItem={(row) => (
            <SetProgressRow
              name={row.setName}
              owned={row.owned}
              printings={row.printings}
              finishes={row.finishes}
              {...(row.total ? { total: row.total } : {})}
              {...(row.ratio === undefined ? {} : { ratio: row.ratio })}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
