import { useMemo, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { ToggleRow } from "../../components/ToggleRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { RarityBar } from "../results/RarityBar.tsx";
import { FinishBar } from "./FinishBar.tsx";
import { rarityFilterAt } from "../results/rarityFilters.ts";
import {
  ALL_COLLECT_FINISHES,
  COLLECT_FINISH_LABELS,
  availableFinishes,
  type CollectFinish,
} from "../../models/cards.ts";
import { byCollectorNumber, byPriceDesc } from "../../integrations/pokemon/sort.ts";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useSetCards, useSets } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";

/** Cards in a set, in collector-number order, with a swipe rarity filter. */
export function SetCardsScreen({ setId, setName }: { setId: string; setName: string }) {
  const { openDetails, pop } = useNavigation();
  const { ownedFinishes, toggleOwned, ownedCountsBySet, ownedFinishCountsBySet } = useLibrary();
  const enabled = useScreenInputEnabled();

  const [rarityIndex, setRarityIndex] = useState(0);
  /**
   * Collect mode repurposes select to mark cards owned instead of opening
   * details. Master-setting a 200-card set is otherwise
   * open → mark → back, ~600 gestures; this makes it one pinch per card.
   */
  const [collectMode, setCollectMode] = useState(false);
  /** Which printing a pinch marks. Cycled with ← → while collecting. */
  const [finishIndex, setFinishIndex] = useState(0);
  const [byValue, setByValue] = useState(false);

  const rarity = rarityFilterAt(rarityIndex);
  const { data, isLoading, isError, refetch } = useSetCards(setId, rarity.rarities ?? undefined);

  const { data: sets } = useSets();
  const setTotal = sets?.find((s) => s.id === setId)?.total;
  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;

  const { data: allCards } = useSetCards(setId);
  const masterTotal = useMemo(
    () => allCards?.reduce((sum, c) => sum + availableFinishes(c.variants).length, 0),
    [allCards],
  );

  /**
   * Finishes offered for marking, most relevant first: the ones this set's
   * pricing data implies, then the rest. The extras have to stay reachable
   * because Poké Ball and Master Ball patterns never appear in the payload, so
   * without them those printings could not be recorded at all.
   */
  const finishChoices = useMemo<CollectFinish[]>(() => {
    const inSet = new Set<CollectFinish>();
    for (const card of allCards ?? []) for (const f of availableFinishes(card.variants)) inSet.add(f);
    const primary = ALL_COLLECT_FINISHES.filter((f) => inSet.has(f));
    const rest = ALL_COLLECT_FINISHES.filter((f) => !inSet.has(f));
    return primary.length > 0 ? [...primary, ...rest] : [...ALL_COLLECT_FINISHES];
  }, [allCards]);

  const activeFinish = finishChoices[finishIndex % finishChoices.length] ?? "normal";

  // Binder order by default — a set is worked through by number, not by price.
  const cards = useMemo(() => {
    const list = [...(data ?? [])];
    list.sort(byValue ? byPriceDesc : byCollectorNumber);
    return list;
  }, [data, byValue]);

  const phase: "loading" | "error" | "empty" | "list" = isLoading
    ? "loading"
    : isError
      ? "error"
      : cards.length === 0
        ? "empty"
        : "list";
  const listCount = phase === "list" ? cards.length : phase === "error" ? 1 : 0;
  /**
   * Focusable rows above the list: collect toggle, sort toggle, and — only
   * while collecting — the printing picker. It joins the focus ring rather than
   * living purely on a swipe, because a gesture that changes what every
   * subsequent pinch does is undiscoverable on a device with nothing to hover.
   */
  const CHROME_ROWS = collectMode ? 3 : 2;
  const FINISH_ROW = 2;
  const count = listCount + CHROME_ROWS;

  const markCard = (index: number) => {
    const card = cards[index];
    if (card) toggleOwned(card.id, activeFinish, setId);
  };

  const { backFocused, itemIndex } = useBackableFocus({
    count,
    enabled,
    onBack: pop,
    // While collecting, ← → picks the printing being marked; rarity filtering is
    // a browsing concern and the gesture is worth more here.
    onLeft: () =>
      collectMode
        ? setFinishIndex((i) => (i - 1 + finishChoices.length) % finishChoices.length)
        : setRarityIndex((i) => i - 1),
    onRight: () =>
      collectMode
        ? setFinishIndex((i) => (i + 1) % finishChoices.length)
        : setRarityIndex((i) => i + 1),
    onSelect: (i) => {
      if (i === 0) {
        setCollectMode((on) => !on);
        return;
      }
      if (i === 1) {
        setByValue((v) => !v);
        return;
      }
      if (collectMode && i === FINISH_ROW) {
        setFinishIndex((n) => (n + 1) % finishChoices.length);
        return;
      }
      const index = i - CHROME_ROWS;
      const card = cards[index];
      if (phase === "list" && card) {
        if (collectMode) markCard(index);
        else openDetails(card.id, card);
      } else if (phase === "error") {
        void refetch();
      }
    },
  });

  const collectFocused = itemIndex === 0;
  const sortFocused = itemIndex === 1;
  const finishFocused = collectMode && itemIndex === FINISH_ROW;
  const cardProgress = setTotal ? `${ownedCards}/${setTotal}` : `${ownedCards}`;
  const subtitle = collectMode
    ? `${cardProgress} cards · ${masterTotal ? `${ownedPrintings}/${masterTotal}` : ownedPrintings} printings`
    : `${cardProgress} cards`;

  return (
    <Screen title={setName} subtitle={subtitle} canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      <ToggleRow
        label={collectMode ? `✓ Marking: ${COLLECT_FINISH_LABELS[activeFinish]}` : "Collect mode: off"}
        hint={collectMode ? "Pick the printing below" : "Select opens card"}
        on={collectMode}
        focused={collectFocused}
        onActivate={() => setCollectMode((on) => !on)}
      />
      <ToggleRow
        label={byValue ? "Sort: value" : "Sort: number"}
        hint={byValue ? "Highest first" : "Binder order"}
        on={byValue}
        focused={sortFocused}
        onActivate={() => setByValue((v) => !v)}
      />
      {/* Rarity filtering shares ← → with finish selection, so the bar is
          replaced while collecting rather than left showing a control that does
          nothing. */}
      {collectMode ? (
        <FinishBar
          choices={finishChoices}
          active={activeFinish}
          focused={finishFocused}
          onActivate={() => setFinishIndex((n) => (n + 1) % finishChoices.length)}
        />
      ) : (
        <RarityBar activeKey={rarity.key} />
      )}
      {phase === "loading" ? <LoadingState label="Loading set…" /> : null}
      {phase === "error" ? (
        <ErrorState
          message="Couldn’t load set"
          onRetry={() => void refetch()}
          retryFocused={!backFocused && !collectFocused && !sortFocused && !finishFocused}
        />
      ) : null}
      {phase === "empty" ? (
        <EmptyState
          title={rarity.rarities ? `No ${rarity.short} cards` : "No cards"}
          hint={collectMode ? "Swipe ← → to change printing" : "Swipe ← → to change rarity"}
        />
      ) : null}
      {phase === "list" ? (
        <FocusList
          items={cards}
          focusIndex={itemIndex - CHROME_ROWS}
          getKey={(c) => c.id}
          ariaLabel={`${setName} cards, ${rarity.label}`}
          onActivate={(i) => (collectMode ? markCard(i) : openDetails(cards[i].id, cards[i]))}
          renderItem={(card) => (
            <CardRow
              card={card}
              ownedFinishes={ownedFinishes(card.id)}
              showFinishes
              {...(collectMode ? { highlightFinish: activeFinish } : {})}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
