import { useMemo, useRef, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { ToggleRow } from "../../components/ToggleRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { RarityBar } from "../results/RarityBar.tsx";
import { FinishBar } from "./FinishBar.tsx";
import { filterByRarity, rarityFilterAt } from "../results/rarityFilters.ts";
import { availableFinishes, type CollectFinish } from "../../models/cards.ts";
import { compareFinishes, finishLabel } from "../../models/finishes.ts";
import { byCollectorNumber } from "../../integrations/pokemon/sort.ts";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useSetCards, useSets } from "../../hooks/useSets.ts";
import { useSetInformation } from "../../hooks/useSetInformation.ts";
import { useSetPrintings } from "../../hooks/useSetPrintings.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { useIsWeb } from "../../app/contexts.tsx";

/**
 * Gap allowed between pinches on one card for them to count as a burst.
 *
 * Generous on purpose: a deliberate triple-pinch on a neural band is nowhere
 * near as fast as a triple-click on a mouse, and being too strict makes the
 * gesture feel broken rather than unavailable.
 */
const BURST_WINDOW_MS = 1200;
/** Pinches on one card that trigger the bulk action. */
const BURST_COUNT = 3;

/** Cards in a set, in collector-number order, with a swipe rarity filter. */
export function SetCardsScreen({ setId, setName }: { setId: string; setName: string }) {
  const { openDetails, pop } = useNavigation();
  const { ownedFinishes, toggleOwned, ownedCountsBySet, ownedFinishCountsBySet } = useLibrary();
  const modalClosed = useScreenInputEnabled();
  const isWeb = useIsWeb();
  /**
   * The focus ring is off on web. It preventDefaults arrows and Enter, which
   * fights native scrolling and form input — the glasses need it because four
   * gestures are all they have, a phone does not.
   */
  const enabled = modalClosed && !isWeb;

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

  /**
   * One request for the whole screen: every card in the set plus its printings.
   * The rarity filter then becomes a local operation on data already in hand.
   */
  const info = useSetInformation(setId, setName);
  /**
   * The path this screen used before that endpoint existed, held in reserve.
   *
   * Not optional: the server it aggregates on is a home machine that spends days
   * at a time powered off, and the catalog provider still degrades to the public
   * API on its own. Losing the set list with the server would be a worse failure
   * than the round trips this removes.
   */
  const viaCatalog = info.isUnavailable;
  const fallback = useSetCards(setId, rarity.rarities ?? undefined, { enabled: viaCatalog });
  const fallbackAll = useSetCards(setId, undefined, { enabled: viaCatalog });

  const { data: sets } = useSets();
  const setTotal = sets?.find((s) => s.id === setId)?.total;
  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;

  const allCards = info.cards ?? fallbackAll.data;
  /**
   * Real printings from TCGdex. They ride along with the aggregate response, so
   * this only fires when that could not supply them — on its own it costs one
   * request per card, hence the collect-mode gate. pokemontcg.io cannot answer
   * this at all for some sets (Pitch Black returns no variant data whatsoever).
   */
  const { index: fallbackPrintings } = useSetPrintings(setId, setName, collectMode && !info.printings);
  const printings = info.printings ?? fallbackPrintings;

  const visible = useMemo(
    () => (info.cards ? filterByRarity(info.cards, rarity.rarities) : fallback.data),
    [info.cards, fallback.data, rarity.rarities],
  );

  const isLoading = viaCatalog ? fallback.isLoading : info.isLoading;
  // Only the fallback can put the screen in an error state — an aggregate
  // failure is not an error, it is the reason the fallback is running.
  const isError = viaCatalog && fallback.isError;
  const refetch = () => {
    if (viaCatalog) void fallback.refetch();
    else info.refetch();
  };

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
  const cards = useMemo(() => [...(visible ?? [])].sort(byCollectorNumber), [visible]);

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

  /**
   * What a card looked like when the current pinch burst began.
   *
   * Needed because each pinch of a triple toggles as it lands, so by the time
   * the bulk action fires the card no longer reflects the user's intent: on a
   * complete card the first pinch has already cleared one printing, making it
   * look incomplete, and the bulk would refill it instead of clearing. Deciding
   * from the pre-burst snapshot makes triple-pinch symmetric.
   */
  const burstStart = useRef<{
    cardId: string;
    held: CollectFinish[];
    at: number;
    count: number;
  } | null>(null);

  /**
   * Record this pinch against the current burst; true means it completes one.
   *
   * Keyed on the focused CARD, not on time alone: moving to another card ends
   * the burst, so the pinch-swipe-pinch rhythm of rapid marking can never
   * trigger it, while an incidental swipe that leaves focus put is harmless.
   * That fragility is why this moved out of the input adapter, which cannot see
   * what is focused and so had to reset on every other event.
   */
  const noteBurst = (cardId: string): boolean => {
    const previous = burstStart.current;
    const now = Date.now();
    const sameBurst = previous && previous.cardId === cardId && now - previous.at <= BURST_WINDOW_MS;
    const next = sameBurst
      ? { ...previous, at: now, count: previous.count + 1 }
      : { cardId, held: ownedFinishes(cardId), at: now, count: 1 };
    burstStart.current = next;
    return next.count >= BURST_COUNT;
  };

  /**
   * Bulk: set every printing of the card at once — clear it if it was complete
   * when the burst started, fill it otherwise.
   *
   * Reached by triple-pinch (documented input) or by hold where the hardware
   * supports it. Neither is required: the picker still reaches every printing
   * one at a time.
   */
  const markWholeCard = (index: number) => {
    const card = cards[index];
    if (!card) return;
    const available = finishesFor(card.collectorNumber, card.variants);
    const before = burstStart.current?.cardId === card.id ? burstStart.current.held : ownedFinishes(card.id);
    const wasComplete = available.length > 0 && available.every((f) => before.includes(f));
    const held = ownedFinishes(card.id);
    for (const finish of available) {
      const has = held.includes(finish);
      // toggleOwned is the only mutation, so flip only what differs from target.
      if (wasComplete ? has : !has) toggleOwned(card.id, finish, setId);
    }
    burstStart.current = null;
  };

  /**
   * Advance the picker, skipping printings the focused card does not have.
   *
   * Cycling onto "Master Ball" while sitting on a card that has no Master Ball
   * printing wastes a swipe on every card in the set. Falls back to the full
   * set-level list when nothing is focused or the card has no known printings,
   * so a printing never becomes unreachable.
   */
  const stepFinish = (delta: number, focusedIndex: number) => {
    const card = cards[focusedIndex - CHROME_ROWS];
    const available = card ? finishesFor(card.collectorNumber, card.variants) : [];
    const ring = finishChoices.filter((f) => available.includes(f));
    const usable = ring.length > 1 ? ring : finishChoices;
    if (usable.length === 0) return;
    setFinishIndex((current) => {
      const currentFinish = finishChoices[current % finishChoices.length];
      const at = usable.indexOf(currentFinish ?? usable[0]);
      const nextFinish =
        usable[((((at < 0 ? 0 : at) + delta) % usable.length) + usable.length) % usable.length];
      const back = finishChoices.indexOf(nextFinish);
      return back < 0 ? current : back;
    });
  };

  const markCard = (index: number) => {
    const card = cards[index];
    if (!card) return;
    if (noteBurst(card.id)) {
      // Third pinch on this card: the bulk action replaces the single toggle.
      markWholeCard(index);
      return;
    }
    const available = finishesFor(card.collectorNumber, card.variants);
    // A card with one printing marks THAT printing, whatever the picker says.
    // Otherwise selecting an ex card while "Reverse Holo" is active would
    // invent a reverse that does not exist.
    const finish = available.length === 1 ? available[0] : activeFinish;
    toggleOwned(card.id, finish, setId);
  };

  const { backFocused, itemIndex } = useBackableFocus({
    count,
    enabled,
    onBack: pop,
    // While collecting, ← → picks the printing being marked; rarity filtering is
    // a browsing concern and the gesture is worth more here.
    onLeft: (i) => (collectMode ? stepFinish(-1, i) : setRarityIndex((n) => n - 1)),
    onRight: (i) => (collectMode ? stepFinish(1, i) : setRarityIndex((n) => n + 1)),
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
        refetch();
      }
    },
  });

  const collectFocused = itemIndex === 0;
  const finishFocused = collectMode && itemIndex === FINISH_ROW;
  const cardProgress = setTotal ? `${ownedCards}/${setTotal}` : `${ownedCards}`;
  // While collecting, printings are the number being worked on; otherwise the
  // card count is the useful one. One short string either way.
  const headerStatus = collectMode && masterTotal ? `${ownedPrintings}/${masterTotal}` : cardProgress;

  return (
    <Screen
      title={setName}
      headerLeft={<BackRow focused={backFocused} onActivate={pop} />}
      headerRight={headerStatus}
      canGoBack
    >
      {/*
        Glasses-only chrome. On web every printing badge is directly tappable,
        so a mode that says "what a pinch means" and a picker to choose it are
        both answering a question a finger does not ask.
      */}
      {isWeb ? null : (
        <>
          <ToggleRow
            label={collectMode ? `✓ Marking: ${finishLabel(activeFinish)}` : "Collect mode: off"}
            {...(collectMode ? {} : { hint: "Select opens card" })}
            on={collectMode}
            focused={collectFocused}
            onActivate={() => setCollectMode((on) => !on)}
          />
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
        </>
      )}
      {phase === "loading" ? <LoadingState label="Loading set…" /> : null}
      {phase === "error" ? (
        <ErrorState
          message="Couldn’t load set"
          onRetry={() => refetch()}
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
              {...(isWeb
                ? { onToggleFinish: (finish: CollectFinish) => toggleOwned(card.id, finish, setId) }
                : {})}
              {...(collectMode ? { highlightFinish: activeFinish } : {})}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
