import { useMemo, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { ToggleRow } from "../../components/ToggleRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { RarityBar } from "../results/RarityBar.tsx";
import { rarityFilterAt } from "../results/rarityFilters.ts";
import { availableFinishes, primaryFinish } from "../../models/cards.ts";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useSetCards, useSets } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";

/** Cards in a set, most valuable first, with a swipe left/right rarity filter. */
export function SetCardsScreen({ setId, setName }: { setId: string; setName: string }) {
  const { openDetails, pop } = useNavigation();
  const { ownedFinishes, toggleOwned, ownedCountsBySet, ownedFinishCountsBySet } = useLibrary();
  const enabled = useScreenInputEnabled();

  const [rarityIndex, setRarityIndex] = useState(0);
  /**
   * Collect mode repurposes select to mark cards owned instead of opening
   * details. Master-setting a 200-card set is otherwise
   * open → mark → back, ~600 gestures; this makes it one pinch per card.
   *
   * It marks the card's PRIMARY finish only. Marking a specific printing needs
   * a target the four-gesture input can't express, so that lives on the details
   * screen, one row per finish.
   */
  const [collectMode, setCollectMode] = useState(false);
  const rarity = rarityFilterAt(rarityIndex);
  const { data, isLoading, isError, refetch } = useSetCards(setId, rarity.rarities ?? undefined);

  // Set totals come from the (7-day cached) set list, so completion can be shown
  // even while the current rarity filter is showing a subset.
  const { data: sets } = useSets();
  const setTotal = sets?.find((s) => s.id === setId)?.total;
  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;

  // The master-set denominator needs every card's finishes, so it comes from the
  // unfiltered query — the same cache entry the unfiltered view already fills.
  const { data: allCards } = useSetCards(setId);
  const masterTotal = useMemo(
    () => allCards?.reduce((sum, c) => sum + availableFinishes(c.variants).length, 0),
    [allCards],
  );

  const cards = data ?? [];
  const phase: "loading" | "error" | "empty" | "list" = isLoading
    ? "loading"
    : isError
      ? "error"
      : cards.length === 0
        ? "empty"
        : "list";
  const listCount = phase === "list" ? cards.length : phase === "error" ? 1 : 0;
  // Slot 0 is the collect-mode toggle; cards follow.
  const count = listCount + 1;

  const markCard = (index: number) => {
    const card = cards[index];
    if (card) toggleOwned(card.id, primaryFinish(card.variants), setId);
  };

  const { backFocused, itemIndex } = useBackableFocus({
    count,
    enabled,
    onBack: pop,
    onLeft: () => setRarityIndex((i) => i - 1),
    onRight: () => setRarityIndex((i) => i + 1),
    onSelect: (i) => {
      if (i === 0) {
        setCollectMode((on) => !on);
        return;
      }
      const card = cards[i - 1];
      if (phase === "list" && card) {
        if (collectMode) markCard(i - 1);
        else openDetails(card.id, card);
      } else if (phase === "error") {
        void refetch();
      }
    },
  });

  const toggleFocused = itemIndex === 0;
  const cardProgress = setTotal ? `${ownedCards}/${setTotal}` : `${ownedCards}`;
  const subtitle = collectMode
    ? `${cardProgress} cards · ${masterTotal ? `${ownedPrintings}/${masterTotal}` : ownedPrintings} printings`
    : `${cardProgress} cards`;

  return (
    <Screen title={setName} subtitle={subtitle} canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      <ToggleRow
        label={collectMode ? "✓ Collect mode: on" : "Collect mode: off"}
        hint={collectMode ? "Select marks owned" : "Select opens card"}
        on={collectMode}
        focused={toggleFocused}
        onActivate={() => setCollectMode((on) => !on)}
      />
      <RarityBar activeKey={rarity.key} />
      {phase === "loading" ? <LoadingState label="Loading set…" /> : null}
      {phase === "error" ? (
        <ErrorState
          message="Couldn’t load set"
          onRetry={() => void refetch()}
          retryFocused={!backFocused && !toggleFocused}
        />
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
          focusIndex={itemIndex - 1}
          getKey={(c) => c.id}
          ariaLabel={`${setName} cards, ${rarity.label}`}
          onActivate={(i) => (collectMode ? markCard(i) : openDetails(cards[i].id, cards[i]))}
          renderItem={(card) => (
            <CardRow card={card} ownedFinishes={ownedFinishes(card.id)} showFinishes={collectMode} />
          )}
        />
      ) : null}
    </Screen>
  );
}
