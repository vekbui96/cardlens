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
import { availableFinishes, type CollectFinish } from "../../models/cards.ts";
import { compareFinishes, finishLabel } from "../../models/finishes.ts";
import { byCollectorNumber } from "../../integrations/pokemon/sort.ts";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useSetCards, useSets } from "../../hooks/useSets.ts";
import { useSetPrintings } from "../../hooks/useSetPrintings.ts";
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

  const rarity = rarityFilterAt(rarityIndex);
  const { data, isLoading, isError, refetch } = useSetCards(setId, rarity.rarities ?? undefined);

  const { data: sets } = useSets();
  const setTotal = sets?.find((s) => s.id === setId)?.total;
  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;

  const { data: allCards } = useSetCards(setId);
  /**
   * Real printings from TCGdex — only fetched while collecting, because it
   * costs one request per card. pokemontcg.io cannot answer this at all for
   * some sets (Pitch Black returns no variant data whatsoever).
   */
  const { index: printings } = useSetPrintings(setId, setName, collectMode);

  const masterTotal = useMemo(() => {
    if (printings) return printings.packTotal;
    // Fallback: what the pricing payload implies. Undercounts badly — it knows
    // nothing about pattern reverses.
    return allCards?.reduce((sum, c) => sum + availableFinishes(c.variants).length, 0);
  }, [printings, allCards]);

  /** The printings a given card exists in, preferring real data. */
  const finishesFor = useMemo(() => {
    return (collectorNumber: string, variants: Parameters<typeof availableFinishes>[0]) =>
      printings?.byNumber[collectorNumber] ?? availableFinishes(variants);
  }, [printings]);

  /**
   * Finishes offered for marking: only the ones this set actually has, plus any
   * already held in it. Offering all seven everywhere put 1st Edition on a
   * modern set and Poké Ball on a WotC one, which is noise.
   *
   * The trade-off is real: Poké Ball and Master Ball never appear in the
   * pricing payload, so they are unreachable here until one is marked from a
   * card's details screen, which still lists every finish. Once marked, the
   * printing joins this set's choices.
   */
  const finishChoices = useMemo<CollectFinish[]>(() => {
    const inSet = new Set<CollectFinish>();
    for (const f of printings?.all ?? []) inSet.add(f);
    if (inSet.size === 0) {
      for (const card of allCards ?? []) for (const f of availableFinishes(card.variants)) inSet.add(f);
    }
    // Anything already held stays selectable even if the set data omits it.
    for (const card of allCards ?? []) for (const f of ownedFinishes(card.id)) inSet.add(f);
    const choices = [...inSet].sort(compareFinishes);
    return choices.length > 0 ? choices : ["normal"];
  }, [printings, allCards, ownedFinishes]);

  const activeFinish = finishChoices[finishIndex % finishChoices.length] ?? "normal";

  // Always binder order: a set is worked through by number. Value ordering is
  // a browsing concern and lives on the search results screen.
  const cards = useMemo(() => [...(data ?? [])].sort(byCollectorNumber), [data]);

  const phase: "loading" | "error" | "empty" | "list" = isLoading
    ? "loading"
    : isError
      ? "error"
      : cards.length === 0
        ? "empty"
        : "list";
  const listCount = phase === "list" ? cards.length : phase === "error" ? 1 : 0;
  /**
   * Focusable rows above the list: the collect toggle, plus the printing picker
   * while collecting. The picker joins the focus ring rather than living purely
   * on a swipe, because a gesture that changes what every subsequent pinch does
   * is undiscoverable on a device with nothing to hover.
   */
  const CHROME_ROWS = collectMode ? 2 : 1;
  const FINISH_ROW = 1;
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
  const finishFocused = collectMode && itemIndex === FINISH_ROW;
  const cardProgress = setTotal ? `${ownedCards}/${setTotal}` : `${ownedCards}`;
  // While collecting, printings are the number being worked on; otherwise the
  // card count is the useful one. One short string either way.
  const headerStatus =
    collectMode && masterTotal ? `${ownedPrintings}/${masterTotal}` : cardProgress;

  return (
    <Screen
      title={setName}
      headerLeft={<BackRow focused={backFocused} onActivate={pop} />}
      headerRight={headerStatus}
      canGoBack
    >
      <ToggleRow
        label={collectMode ? `✓ Marking: ${finishLabel(activeFinish)}` : "Collect mode: off"}
        hint={collectMode ? "Pick the printing below" : "Select opens card"}
        on={collectMode}
        focused={collectFocused}
        onActivate={() => setCollectMode((on) => !on)}
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
          retryFocused={!backFocused && !collectFocused && !finishFocused}
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
              availableFinishes={finishesFor(card.collectorNumber, card.variants)}
              showFinishes
              {...(collectMode ? { highlightFinish: activeFinish } : {})}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
