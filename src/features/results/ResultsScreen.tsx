import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { useFocusList } from "../../hooks/useFocusList.ts";
import { useCatalogSearch } from "../../hooks/useCatalogSearch.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";

export function ResultsScreen({ query }: { query: string }) {
  const { openDetails, pop } = useNavigation();
  const enabled = useScreenInputEnabled();
  const { data, isLoading, isError, refetch } = useCatalogSearch(query);

  const cards = data ?? [];
  const phase: "loading" | "error" | "empty" | "list" = isLoading
    ? "loading"
    : isError
      ? "error"
      : cards.length === 0
        ? "empty"
        : "list";

  const count = phase === "list" ? cards.length : phase === "error" ? 1 : 0;

  const { focusIndex } = useFocusList({
    count,
    enabled,
    onBack: pop,
    onSelect: (i) => {
      if (phase === "list") openDetails(cards[i].id, cards[i]);
      else if (phase === "error") void refetch();
    },
  });

  return (
    <Screen title="Search Cards" subtitle={`“${query}”`} canGoBack>
      {phase === "loading" ? <LoadingState /> : null}
      {phase === "error" ? (
        <ErrorState message="Couldn’t load cards" onRetry={() => void refetch()} retryFocused />
      ) : null}
      {phase === "empty" ? <EmptyState /> : null}
      {phase === "list" ? (
        <FocusList
          items={cards}
          focusIndex={focusIndex}
          getKey={(c) => c.id}
          ariaLabel={`Results for ${query}`}
          onActivate={(i) => openDetails(cards[i].id, cards[i])}
          renderItem={(card) => <CardRow card={card} />}
        />
      ) : null}
    </Screen>
  );
}
