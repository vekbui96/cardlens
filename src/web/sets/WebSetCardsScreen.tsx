import { useMemo, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { RARITY_FILTERS } from "../../features/results/rarityFilters.ts";
import type { PokemonCardSummary, CollectFinish } from "../../models/cards.ts";
import { useSetView } from "../../hooks/useSetView.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { CardSheet } from "./CardSheet.tsx";
import styles from "./WebSetCardsScreen.module.css";

/**
 * A set as a grid of card images, for a phone.
 *
 * The glasses render the same set as a focus-ring list of text rows, because
 * four gestures and a 600x600 additive display leave no room for anything else.
 * A phone has a finger, a scrollbar and a real screen, and collectors recognise
 * cards by art long before they read a collector number — so the art IS the
 * interface here, and marking happens in a sheet rather than through a mode.
 *
 * Both shells ask useSetView the same questions, so there is one answer to
 * "which printings does this card have" rather than two that can drift.
 */
export function WebSetCardsScreen({ setId, setName }: { setId: string; setName: string }) {
  const { pop } = useNavigation();
  const { ownedFinishes, toggleOwned, ownedCountsBySet, ownedFinishCountsBySet } = useLibrary();

  const [rarityKey, setRarityKey] = useState("all");
  /** Master-setting is mostly "what am I still missing", so it gets a real control. */
  const [missingOnly, setMissingOnly] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const rarity = RARITY_FILTERS.find((f) => f.key === rarityKey) ?? RARITY_FILTERS[0];
  // Printings are wanted up front here: there is no collect mode to gate them
  // behind, and the badges on every tile depend on them.
  const view = useSetView(setId, setName, { rarities: rarity.rarities, wantPrintings: true });

  const isComplete = useMemo(() => {
    return (card: PokemonCardSummary) => {
      const available = view.finishesFor(card.collectorNumber, card.variants);
      const held = ownedFinishes(card.id);
      return available.length > 0 && available.every((f) => held.includes(f));
    };
  }, [view, ownedFinishes]);

  const cards = useMemo(
    () => (missingOnly ? view.cards.filter((c) => !isComplete(c)) : view.cards),
    [view.cards, missingOnly, isComplete],
  );

  const openCard = openCardId ? (view.cards.find((c) => c.id === openCardId) ?? null) : null;

  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;
  const progress = view.masterTotal ? `${ownedPrintings}/${view.masterTotal}` : `${ownedCards}`;

  return (
    <Screen
      title={setName}
      headerLeft={<BackRow focused={false} onActivate={pop} />}
      headerRight={progress}
      canGoBack
    >
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label="Filter by rarity">
          {RARITY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`${styles.chip} ${f.key === rarityKey ? styles.chipOn : ""}`}
              aria-pressed={f.key === rarityKey}
              onClick={() => setRarityKey(f.key)}
            >
              {f.short}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.chip} ${styles.missing} ${missingOnly ? styles.chipOn : ""}`}
          aria-pressed={missingOnly}
          onClick={() => setMissingOnly((on) => !on)}
        >
          Missing only
        </button>
      </div>

      {view.isLoading ? <LoadingState label="Loading set…" /> : null}
      {/* retryFocused is a glasses affordance — there is no focus ring here. */}
      {view.isError ? (
        <ErrorState message="Couldn’t load set" onRetry={view.refetch} retryFocused={false} />
      ) : null}
      {!view.isLoading && !view.isError && cards.length === 0 ? (
        <EmptyState
          title={missingOnly ? "Nothing missing" : `No ${rarity.short} cards`}
          hint={missingOnly ? "Every card here is complete." : "Try another rarity."}
        />
      ) : null}

      {cards.length > 0 ? (
        <ul className={styles.grid}>
          {cards.map((card) => {
            const available = view.finishesFor(card.collectorNumber, card.variants);
            const held = ownedFinishes(card.id);
            const complete = available.every((f) => held.includes(f));
            return (
              <li key={card.id}>
                <button
                  type="button"
                  className={`${styles.tile} ${held.length > 0 ? styles.tileOwned : ""}`}
                  onClick={() => setOpenCardId(card.id)}
                  aria-label={`${card.name}, ${card.collectorNumber}, ${held.length} of ${available.length} printings owned`}
                >
                  <CardImage src={card.imageSmall} alt="" size="thumb" />
                  {/* Dim rather than hide what is missing: a grid of greyed art is
                      readable at a glance, a grid with holes in it is not. */}
                  <span className={styles.tileMeta}>
                    <span className={styles.tileNumber}>{card.collectorNumber}</span>
                    <span className={complete ? styles.tickDone : styles.tick} aria-hidden="true">
                      {complete ? "✓" : `${held.length}/${available.length}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {openCard ? (
        <CardSheet
          card={openCard}
          finishes={view.finishesFor(openCard.collectorNumber, openCard.variants)}
          owned={ownedFinishes(openCard.id)}
          onToggle={(finish: CollectFinish) => toggleOwned(openCard.id, finish, setId)}
          onClose={() => setOpenCardId(null)}
        />
      ) : null}
    </Screen>
  );
}
