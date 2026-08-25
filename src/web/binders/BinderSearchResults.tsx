import { useState } from "react";
import { CardImage } from "../../components/CardImage.tsx";
import { useCatalogSearch } from "../../hooks/useCatalogSearch.ts";
import { useSetPrintings } from "../../hooks/useSetPrintings.ts";
import { availableFinishes, type CollectFinish, type PokemonCardSummary } from "../../models/cards.ts";
import { finishLabel } from "../../models/finishes.ts";
import { setIdFromCardId } from "../../utils/cardId.ts";
import { FULL_SEARCH_LIMIT } from "../../integrations/providers.ts";
import type { CardSlot } from "../../models/binderLayout.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * Which printings the chosen card exists in, then place one.
 *
 * A search spans sets, and printings are answered per SET — so this asks only
 * about the ONE card the user picked rather than about every result. Asking for
 * all forty would be forty requests to answer a question about the one card
 * that gets placed, and the set list beside it already covers "show me
 * everything from one set" cheaply.
 *
 * Falls back to what the pricing payload implies while the oracle is loading or
 * absent. That fallback is a guess (pokemontcg.io reports no variants at all
 * for whole sets), which is why it may not be used to WRITE to the collection —
 * a binder pocket is a layout, not a claim of ownership, so a guess that can be
 * corrected by tapping another pocket is acceptable here.
 */
function FinishChoice({
  card,
  owned,
  onPlace,
  onBack,
}: {
  card: PokemonCardSummary;
  owned: CollectFinish[];
  onPlace: (slot: CardSlot) => void;
  onBack: () => void;
}) {
  const { index, isLoading } = useSetPrintings(setIdFromCardId(card.id), card.setName);
  const known = index?.byNumber[card.collectorNumber];
  const finishes = known?.length ? known : availableFinishes(card.variants);

  return (
    <div className={styles.chosen}>
      <p className={styles.hint}>
        {card.name} · {card.collectorNumber} · {card.setName} —{" "}
        {isLoading && !known?.length ? "checking printings…" : "pick a printing."}
      </p>
      <div className={styles.pickerHead}>
        {finishes.map((finish) => (
          <button
            key={finish}
            type="button"
            className={styles.chip}
            onClick={() =>
              onPlace({
                kind: "card",
                cardId: card.id,
                finish,
                // Denormalised so the page renders offline and before the
                // catalog answers.
                name: card.name,
                imageSmall: card.imageSmall,
                collectorNumber: card.collectorNumber,
              })
            }
          >
            {finishLabel(finish)}
            {owned.includes(finish) ? " · owned" : ""}
          </button>
        ))}
        <button type="button" className={styles.chip} onClick={onBack}>
          Back to results
        </button>
      </div>
    </div>
  );
}

/**
 * Find a card to put in a pocket without knowing which set it is in.
 *
 * The set list below answers "fill this binder from one set", which is how a
 * master-set binder is built. It cannot answer "where does my Umbreon VMAX go"
 * — that means remembering the set, finding it among 218 in a dropdown, and
 * then finding the card. Searching by name skips all of it.
 *
 * Two taps rather than one, because a result carries no trustworthy printing
 * list with it: pick the card, then pick the printing once the oracle has
 * answered for that card's set.
 */
export function BinderSearchResults({
  query,
  ownedFinishes,
  onPlace,
}: {
  query: string;
  ownedFinishes: (cardId: string) => CollectFinish[];
  onPlace: (slot: CardSlot) => void;
}) {
  const [chosen, setChosen] = useState<PokemonCardSummary | null>(null);
  // Every printing of that Pokémon, not the top 40. The short list is right for
  // a focus ring on the glasses and wrong here: "where does my Charizard go" is
  // a question about the 108 that exist, and the one you mean is rarely in the
  // first handful.
  const { data, isLoading, isError, refetch } = useCatalogSearch(query, undefined, { full: true });

  if (chosen) {
    return (
      <FinishChoice
        card={chosen}
        owned={ownedFinishes(chosen.id)}
        onPlace={(slot) => {
          onPlace(slot);
          setChosen(null);
        }}
        onBack={() => setChosen(null)}
      />
    );
  }

  if (isLoading) return <p className={styles.hint}>Searching…</p>;

  if (isError) {
    // pokemontcg.io fails around a quarter of the time, in bursts. A retry is
    // the whole remedy, so it is offered inline rather than as an apology.
    return (
      <p className={styles.hint} role="alert">
        Search failed.{" "}
        <button type="button" className={styles.linkButton} onClick={() => refetch()}>
          Try again
        </button>
      </p>
    );
  }

  const results = data ?? [];
  if (results.length === 0) {
    return <p className={styles.hint}>No cards match “{query}”. Check the spelling, or search by Pokémon.</p>;
  }

  return (
    <>
      <p className={styles.hint}>
        {results.length} card{results.length === 1 ? "" : "s"} match “{query}”, closest match first.
        {/* A full page back is indistinguishable from a complete answer, so say
            which one this is rather than implying the catalog stops there. */}
        {results.length >= FULL_SEARCH_LIMIT ? " That is the first page — add a word to narrow it." : ""}
      </p>
      <ul className={styles.grid}>
        {results.map((card) => {
          const owned = ownedFinishes(card.id).length > 0;
          return (
            <li key={card.id}>
              <button
                type="button"
                className={`${styles.card} ${owned ? "" : styles.cardWanted}`}
                aria-label={`${card.name}, ${card.collectorNumber}, ${card.setName}, ${
                  owned ? "owned" : "not owned"
                }`}
                onClick={() => setChosen(card)}
              >
                <CardImage src={card.imageSmall} alt="" size="thumb" />
                {/* Two lines, not one: a result's set is the thing that tells
                    two otherwise identical Charizards apart, and squeezed onto
                    the number's line it is the half that gets ellipsised. */}
                <span className={styles.cardMeta}>{card.collectorNumber}</span>
                <span className={styles.cardSet}>{card.setName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
