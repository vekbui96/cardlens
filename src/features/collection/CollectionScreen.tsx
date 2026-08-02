import { lazy, Suspense, useRef } from "react";
import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { EmptyState } from "../../components/States.tsx";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useCollectedSets } from "../../hooks/useCollectedSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { useIsWeb } from "../../app/contexts.tsx";
import { SetProgressRow } from "./SetProgressRow.tsx";
import { ToggleRow } from "../../components/ToggleRow.tsx";
import { useTextEntry } from "../../app/TextEntryProvider.tsx";
import { syncLine } from "./syncLine.ts";

const ValuePanel = lazy(() =>
  import("../../web/collection/ValuePanel.tsx").then((m) => ({ default: m.ValuePanel })),
);

/** Every set you own cards from, closest to complete first — the master-set view. */
export function CollectionScreen() {
  const { push, pop } = useNavigation();
  const { collection, totalFinishesOwned, syncStatus, syncNow, setSyncToken, disconnectSync } = useLibrary();
  const { provider: textProvider } = useTextEntry();
  const enabled = useScreenInputEnabled();
  const isWeb = useIsWeb();
  const itemIndexRef = useRef(0);

  // Same rows, same order as the set switcher on web — see useCollectedSets.
  const rows = useCollectedSets();

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
      {/*
        Web only, and lazy so the glasses never download it. A table of prices
        needs a scroll and a column of numbers; on a 600x600 additive display
        every row of chrome costs two rows of list, and the progress list is
        what that screen is for.
      */}
      {isWeb ? (
        <Suspense fallback={null}>
          <ValuePanel />
        </Suspense>
      ) : null}
      {/* Derived purely from local rows, so this is immediate and offline-safe.
          Set names fall back to their id until the set list arrives. */}
      {rows.length === 0 ? (
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
