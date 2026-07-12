import { useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { RarityBar } from "./RarityBar.tsx";
import { rarityFilterAt } from "./rarityFilters.ts";
import { useFocusList } from "../../hooks/useFocusList.ts";
import { useCatalogSearch } from "../../hooks/useCatalogSearch.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";

export function ResultsScreen({ query }: { query: string }) {
  const { openDetails, pop } = useNavigation();
  const enabled = useScreenInputEnabled();

  // Swipe left/right cycles the rarity filter (All / IR / SIR / Full Art / Hyper).
  const [rarityIndex, setRarityIndex] = useState(0);
  const rarity = rarityFilterAt(rarityIndex);

  const { data, isLoading, isError, refetch } = useCatalogSearch(query, rarity.rarities ?? undefined);

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
    onLeft: () => setRarityIndex((i) => i - 1),
    onRight: () => setRarityIndex((i) => i + 1),
    onSelect: (i) => {
      if (phase === "list") openDetails(cards[i].id, cards[i]);
      else if (phase === "error") void refetch();
    },
  });

  return (
    <Screen title="Search Cards" subtitle={`“${query}”`} canGoBack>
      <RarityBar activeKey={rarity.key} />
      {phase === "loading" ? <LoadingState /> : null}
      {phase === "error" ? (
        <ErrorState message="Couldn’t load cards" onRetry={() => void refetch()} retryFocused />
      ) : null}
      {phase === "empty" ? (
        <EmptyState
          title={rarity.rarities ? `No ${rarity.short} cards` : "No cards found"}
          hint={rarity.rarities ? "Swipe ← → to change rarity" : "Check the spelling or search by Pokémon"}
        />
      ) : null}
      {phase === "list" ? (
        <FocusList
          items={cards}
          focusIndex={focusIndex}
          getKey={(c) => c.id}
          ariaLabel={`Results for ${query}, ${rarity.label}`}
          onActivate={(i) => openDetails(cards[i].id, cards[i])}
          renderItem={(card) => <CardRow card={card} />}
        />
      ) : null}
    </Screen>
  );
}
