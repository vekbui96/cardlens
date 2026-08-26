import { CardImage } from "../../components/CardImage.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useSetPrintings } from "../../hooks/useSetPrintings.ts";
import { availableFinishes, type CollectFinish, type PokemonCardSummary } from "../../models/cards.ts";
import { finishLabel } from "../../models/finishes.ts";
import { setIdFromCardId } from "../../utils/cardId.ts";
import { imageSlotSrc } from "../../services/sync/binderImages.ts";
import type { BinderSlot, CardSlot } from "../../models/binderLayout.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * "I own this" for one printing, wherever a printing is on screen.
 *
 * Planning a binder and recording what you hold are the same sitting — the
 * pocket you just filled is either a card in your hand or one you are chasing,
 * and you know which at the moment you place it. Before this the answer had to
 * be given again on the set screen, from memory, hours later.
 *
 * It writes to the collection, NOT to the binder: a binder is an arrangement
 * and says nothing about ownership. That is why an unowned card can sit in a
 * pocket at all, and why this toggle changes the shading rather than the slot.
 */
function OwnToggle({ cardId, finish }: { cardId: string; finish: CollectFinish }) {
  const { isOwnedFinish, toggleOwned } = useLibrary();
  const owned = isOwnedFinish(cardId, finish);

  return (
    <button
      type="button"
      className={`${styles.ownChip} ${owned ? styles.ownChipOn : ""}`}
      aria-pressed={owned}
      aria-label={`Own ${finishLabel(finish)}`}
      onClick={() => toggleOwned(cardId, finish, setIdFromCardId(cardId))}
    >
      {owned ? "✓ Own" : "Own"}
    </button>
  );
}

/**
 * The bottom of the picker, describing whatever the pocket is about to hold.
 *
 * It sits below the card list rather than replacing it, and stays put while
 * that list scrolls: choosing a printing used to swap out the results, so the
 * card you were comparing against vanished at the moment you had to decide
 * between its printings.
 *
 * Two states, one place. A card just chosen offers its printings; a pocket that
 * already holds one offers the same controls for what is in it, so marking a
 * card owned never means finding it in the catalog a second time.
 */
export function BinderPocketSheet({
  chosen,
  slot,
  pocketLabel,
  onPlace,
  onCancel,
  onClear,
}: {
  chosen: PokemonCardSummary | null;
  slot: BinderSlot | null;
  pocketLabel: string;
  onPlace: (slot: CardSlot) => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const card = slot?.kind === "card" ? slot : null;
  const cardId = chosen?.id ?? card?.cardId ?? "";
  const setName = chosen?.setName ?? "";
  const { index, isLoading } = useSetPrintings(setIdFromCardId(cardId), setName, Boolean(chosen));
  const collectorNumber = chosen?.collectorNumber ?? card?.collectorNumber ?? "";
  const known = index?.byNumber[collectorNumber];

  /**
   * Falls back to what the pricing payload implies while the oracle answers.
   *
   * That fallback is a guess — pokemontcg.io reports no variants at all for
   * whole sets — which is why it may never be used to WRITE to the collection
   * unprompted. Here it only decides which buttons to offer; the user picks,
   * and a pocket is a layout rather than a claim of ownership.
   */
  const finishes = chosen ? (known?.length ? known : availableFinishes(chosen.variants)) : [];

  if (chosen) {
    return (
      <div className={styles.sheet}>
        <div className={styles.sheetHead}>
          <CardImage src={chosen.imageSmall} alt="" size="thumb" />
          <div className={styles.sheetTitle}>
            <span className={styles.sheetName}>{chosen.name}</span>
            <span className={styles.sheetMeta}>
              {chosen.collectorNumber} · {chosen.setName}
            </span>
          </div>
          <button type="button" className={styles.chip} onClick={onCancel}>
            Back
          </button>
        </div>

        <p className={styles.sheetPrompt}>
          {isLoading && !known?.length ? "Checking printings…" : `Which printing goes in ${pocketLabel}?`}
        </p>

        {/* One row per printing rather than a strip of chips: the row names the
            printing, puts it in the pocket, and records that you hold a copy —
            three answers about the same thing, so they belong on one line. */}
        <ul className={styles.finishRows}>
          {finishes.map((finish) => (
            <li key={finish}>
              <button
                type="button"
                className={styles.finishPlace}
                onClick={() =>
                  onPlace({
                    kind: "card",
                    cardId: chosen.id,
                    finish,
                    // Denormalised so the page renders offline and before the
                    // catalog answers.
                    name: chosen.name,
                    imageSmall: chosen.imageSmall,
                    collectorNumber: chosen.collectorNumber,
                  })
                }
              >
                {finishLabel(finish)}
              </button>
              <OwnToggle cardId={chosen.id} finish={finish} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!slot) return null;

  // Custom art has no catalog entry, so there is nothing to own — but it must
  // still be clearable from here, or a photo would be the one thing a pocket
  // could not be emptied of.
  if (!card) {
    const image = slot as Exclude<BinderSlot, CardSlot>;
    return (
      <div className={styles.sheet}>
        <div className={styles.sheetHead}>
          <img className={styles.sheetImage} src={imageSlotSrc(image)} alt="" />
          <div className={styles.sheetTitle}>
            <span className={styles.sheetName}>{image.label ?? "Custom image"}</span>
            <span className={styles.sheetMeta}>In {pocketLabel}</span>
          </div>
          <button type="button" className={styles.chip} onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sheet}>
      <div className={styles.sheetHead}>
        <CardImage src={card.imageSmall} alt="" size="thumb" />
        <div className={styles.sheetTitle}>
          <span className={styles.sheetName}>{card.name ?? card.cardId}</span>
          <span className={styles.sheetMeta}>
            {card.collectorNumber ? `${card.collectorNumber} · ` : ""}
            {finishLabel(card.finish)}
          </span>
        </div>
        <OwnToggle cardId={card.cardId} finish={card.finish} />
        <button type="button" className={styles.chip} onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
