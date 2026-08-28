import { CardImage } from "../../components/CardImage.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useSetPrintings } from "../../hooks/useSetPrintings.ts";
import { useSets } from "../../hooks/useSets.ts";
import { availableFinishes, type CollectFinish, type PokemonCardSummary } from "../../models/cards.ts";
import { finishLabel } from "../../models/finishes.ts";
import { formatUsd } from "../../utils/format.ts";
import { setIdFromCardId } from "../../utils/cardId.ts";
import { imageSlotSrc } from "../../services/sync/binderImages.ts";
import {
  conditionLabel,
  slotQuantity,
  TRADE_CONDITIONS,
  withCondition,
  withQuantity,
  type BinderSlot,
  type CardSlot,
} from "../../models/binderLayout.ts";
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
  onUpdate,
  onCancel,
  onClear,
  priceFor,
  forTrade,
}: {
  chosen: PokemonCardSummary | null;
  slot: BinderSlot | null;
  pocketLabel: string;
  onPlace: (slot: CardSlot) => void;
  /**
   * Rewrite what is already in the pocket, WITHOUT moving on to the next one.
   *
   * Separate from `onPlace` because placing is a step in a sequence — the
   * selection advances so the binder can be filled card after card — and
   * counting copies is an edit to the pocket you are looking at. Sharing one
   * callback would make the second copy of a card jump the selection away from
   * the pocket the user was still working on.
   */
  onUpdate: (slot: CardSlot) => void;
  onCancel: () => void;
  onClear: () => void;
  /** Market price for a pocket, for the full figure the badge has no room for. */
  priceFor: (slot: BinderSlot) => number | undefined;
  /** Offer copies and condition. Only a trade binder has any use for them. */
  forTrade: boolean;
}) {
  const card = slot?.kind === "card" ? slot : null;
  const cardId = chosen?.id ?? card?.cardId ?? "";
  /**
   * Which set a placed card came from.
   *
   * A slot stores the card's id, number, name and art but NOT its set — the
   * denormalised fields exist to paint the page offline, and a set name is not
   * needed for that. It is needed the moment you tap the pocket and ask "which
   * Riolu is this", because the number alone does not say: a binder like this
   * holds four cards numbered 17, from four different sets.
   *
   * Recovered from the id rather than stored, so every binder already in the
   * wild gains it without a migration.
   */
  const { data: allSets } = useSets();
  const placedSetName = card
    ? (allSets ?? []).find((s) => s.id === setIdFromCardId(card.cardId))?.name
    : undefined;
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
            {/* The set gets its own line above the details. Run together on one
                line it was the half that fell off the end of a phone — and the
                set is the part that tells two cards with the same number and
                the same name apart. */}
            <span className={styles.sheetSet}>{chosen.setName}</span>
            <span className={styles.sheetMeta}>{chosen.collectorNumber}</span>
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
          <span className={styles.sheetSet}>{placedSetName ?? "Unknown set"}</span>
          {/* The pocket badge is abbreviated to fit ("$1.2k"); here there is
              room for the real number. */}
          <span className={styles.sheetMeta}>
            {card.collectorNumber ? `${card.collectorNumber} · ` : ""}
            {finishLabel(card.finish)} · {formatUsd(priceFor(card))}
          </span>
        </div>
        <OwnToggle cardId={card.cardId} finish={card.finish} />
        <button type="button" className={styles.chip} onClick={onClear}>
          Clear
        </button>
      </div>

      {forTrade ? <TradeControls card={card} onUpdate={onUpdate} priceFor={priceFor} /> : null}
    </div>
  );
}

/**
 * How many, and in what shape — the two things a trade is actually about.
 *
 * Only offered on a binder marked for trade. On any other binder a pocket holds
 * one card because that is what a pocket is, and asking "how many?" about a set
 * binder is a question with no meaning.
 */
function TradeControls({
  card,
  onUpdate,
  priceFor,
}: {
  card: CardSlot;
  onUpdate: (slot: CardSlot) => void;
  priceFor: (slot: BinderSlot) => number | undefined;
}) {
  const copies = slotQuantity(card);
  const unit = priceFor(card);

  return (
    <div className={styles.trade}>
      <div className={styles.tradeRow}>
        <span className={styles.tradeLabel} id="copies-label">
          Copies
        </span>
        {/* A stepper, not a number field. A phone keyboard over a sheet pinned
            to the bottom of the picker covers the thing being counted, and the
            answer is almost always within a tap or two of one. */}
        <div className={styles.stepper} role="group" aria-labelledby="copies-label">
          <button
            type="button"
            className={styles.step}
            aria-label="One fewer copy"
            disabled={copies <= 1}
            onClick={() => onUpdate(withQuantity(card, copies - 1))}
          >
            −
          </button>
          <span className={styles.count} aria-live="polite">
            {copies}
          </span>
          <button
            type="button"
            className={styles.step}
            aria-label="One more copy"
            onClick={() => onUpdate(withQuantity(card, copies + 1))}
          >
            +
          </button>
        </div>
        {/* What the stack is worth, which is the number the owner is deciding
            against — the pocket badge shows the price of one. */}
        {copies > 1 && unit !== undefined ? (
          <span className={styles.tradeTotal}>{formatUsd(unit * copies)} total</span>
        ) : null}
      </div>

      <div className={styles.tradeRow}>
        <span className={styles.tradeLabel} id="condition-label">
          Condition
        </span>
        <div className={styles.grades} role="group" aria-labelledby="condition-label">
          {TRADE_CONDITIONS.map((grade) => {
            const on = card.condition === grade;
            return (
              <button
                key={grade}
                type="button"
                className={`${styles.grade} ${on ? styles.gradeOn : ""}`}
                aria-pressed={on}
                aria-label={conditionLabel(grade)}
                // Pressing the grade a card already has clears it. Unstated is
                // a real answer and has to be reachable again — it is not the
                // same claim as "near mint".
                onClick={() => onUpdate(withCondition(card, on ? null : grade))}
              >
                {grade}
              </button>
            );
          })}
        </div>
      </div>

      <p className={styles.tradeNote}>
        Condition is shown to whoever opens the link. It never changes the price — the market price is for the
        card, and what a played copy is worth is yours to agree.
      </p>
    </div>
  );
}
