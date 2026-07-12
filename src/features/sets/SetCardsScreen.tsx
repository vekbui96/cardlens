import { useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { RarityBar } from "../results/RarityBar.tsx";
import { rarityFilterAt } from "../results/rarityFilters.ts";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useSetCards } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";

/** Cards in a set, most valuable first, with a swipe left/right rarity filter. */
export function SetCardsScreen({ setId, setName }: { setId: string; setName: string }) {
  const { openDetails, pop } = useNavigation();
  const enabled = useScreenInputEnabled();

  const [rarityIndex, setRarityIndex] = useState(0);
  const rarity = rarityFilterAt(rarityIndex);
  const { data, isLoading, isError, refetch } = useSetCards(setId, rarity.rarities ?? undefined);

  const cards = data ?? [];
  const phase: "loading" | "error" | "empty" | "list" = isLoading
    ? "loading"
    : isError
      ? "error"
      : cards.length === 0
        ? "empty"
        : "list";
  const count = phase === "list" ? cards.length : phase === "error" ? 1 : 0;

  const { backFocused, itemIndex } = useBackableFocus({
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
    <Screen title={setName} subtitle="Most valuable first" canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      <RarityBar activeKey={rarity.key} />
      {phase === "loading" ? <LoadingState label="Loading set…" /> : null}
      {phase === "error" ? (
        <ErrorState message="Couldn’t load set" onRetry={() => void refetch()} retryFocused={!backFocused} />
      ) : null}
      {phase === "empty" ? (
        <EmptyState
          title={rarity.rarities ? `No ${rarity.short} cards` : "No cards"}
          hint="Swipe ← → to change rarity"
        />
      ) : null}
      {phase === "list" ? (
        <FocusList
          items={cards}
          focusIndex={itemIndex}
          getKey={(c) => c.id}
          ariaLabel={`${setName} cards, ${rarity.label}`}
          onActivate={(i) => openDetails(cards[i].id, cards[i])}
          renderItem={(card) => <CardRow card={card} />}
        />
      ) : null}
    </Screen>
  );
}
