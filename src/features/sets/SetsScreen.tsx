import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { SetRow } from "./SetRow.tsx";
import { LoadingState, ErrorState } from "../../components/States.tsx";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useSets } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";

/** Browse Pokémon sets, newest first. Select a set to see its cards by value. */
export function SetsScreen() {
  const { openSet, pop } = useNavigation();
  const enabled = useScreenInputEnabled();
  const { data, isLoading, isError, refetch } = useSets();

  const sets = data ?? [];
  const phase: "loading" | "error" | "list" = isLoading ? "loading" : isError ? "error" : "list";
  const count = phase === "list" ? sets.length : phase === "error" ? 1 : 0;

  const { backFocused, itemIndex } = useBackableFocus({
    count,
    enabled,
    onBack: pop,
    onSelect: (i) => {
      if (phase === "list") openSet(sets[i].id, sets[i].name);
      else if (phase === "error") void refetch();
    },
  });

  return (
    <Screen title="Sets" subtitle="Newest first" canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      {phase === "loading" ? <LoadingState label="Loading sets…" /> : null}
      {phase === "error" ? (
        <ErrorState message="Couldn’t load sets" onRetry={() => void refetch()} retryFocused={!backFocused} />
      ) : null}
      {phase === "list" ? (
        <FocusList
          items={sets}
          focusIndex={itemIndex}
          getKey={(s) => s.id}
          ariaLabel="Pokémon sets"
          onActivate={(i) => openSet(sets[i].id, sets[i].name)}
          renderItem={(set) => <SetRow set={set} />}
        />
      ) : null}
    </Screen>
  );
}
