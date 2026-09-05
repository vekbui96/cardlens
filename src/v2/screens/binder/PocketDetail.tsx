import { CardArt, Chip, Money, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useSetPrintings } from "../../../hooks/useSetPrintings.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { availableFinishes, type CollectFinish, type PokemonCardSummary } from "../../../models/cards.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { setIdFromCardId } from "../../../utils/cardId.ts";
import {
  TRADE_CONDITIONS,
  conditionLabel,
  slotQuantity,
  withCondition,
  withQuantity,
  type BinderSlot,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import { newSlot, slotArt, slotTitle } from "./binderBuilder.ts";
import styles from "./binder.module.css";

/**
 * "I own this" for one printing, wherever a printing is on screen.
 *
 * It writes to the COLLECTION, not to the binder. A binder is an arrangement and
 * says nothing about ownership — that is why a card you do not have can sit in a
 * pocket at all, and why this toggle changes the shading rather than the slot.
 *
 * Planning a binder and recording what you hold are the same sitting: the pocket
 * you just filled is either a card in your hand or one you are chasing, and you
 * know which at the moment you place it. Before this the answer had to be given
 * again on the set screen, from memory, hours later.
 */
function OwnToggle({ cardId, finish }: { cardId: string; finish: CollectFinish }) {
  const { isOwnedFinish, toggleOwned } = useLibrary();
  const owned = isOwnedFinish(cardId, finish);
  return (
    <Chip
      onPress={() => toggleOwned(cardId, finish, setIdFromCardId(cardId))}
      pressed={owned}
      tone={owned ? "accent" : "default"}
      label={`Own ${finishLabel(finish)}`}
    >
      {owned ? "✓ Own" : "Own"}
    </Chip>
  );
}

/**
 * The bottom of the picker, describing whatever the pocket is about to hold.
 *
 * Two states in one place. A card just chosen from a name search offers its
 * printings; a pocket that already holds one offers the same controls for what
 * is in it, so marking a card owned never means finding it in the catalog a
 * second time.
 *
 * It sits BELOW the card list rather than replacing it, and stays put while that
 * list scrolls: choosing a printing used to swap out the results, so the card
 * you were comparing against vanished at the moment you had to decide between
 * its printings.
 */
export function PocketDetail({
  chosen,
  slot,
  where,
  forTrade,
  price,
  onPlace,
  onUpdate,
  onClear,
  onCancel,
}: {
  /** A search result whose printing has not been chosen yet. */
  chosen: PokemonCardSummary | null;
  /** What the chosen pocket already holds. */
  slot: BinderSlot | null;
  /** "pocket 5", "the cover" — named the way the prompt names it. */
  where: string;
  forTrade: boolean;
  price: number | undefined;
  onPlace: (slot: CardSlot) => void;
  /**
   * Rewrite what is already in the pocket WITHOUT moving on to the next one.
   *
   * Separate from `onPlace` because placing is a step in a sequence — the
   * selection advances so a binder can be filled card after card — and counting
   * copies is an edit to the pocket you are looking at. One callback for both
   * would jump the panel off the card still being counted.
   */
  onUpdate: (slot: CardSlot) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const card = slot?.kind === "card" ? slot : null;
  const cardId = chosen?.id ?? card?.cardId ?? "";
  const { data: allSets } = useSets();

  /**
   * Real printings for the chosen card's set, asked for only once a card is
   * chosen — the picker must not spend a request per result.
   */
  const { index, isLoading } = useSetPrintings(
    setIdFromCardId(cardId),
    chosen?.setName ?? "",
    Boolean(chosen),
  );

  if (chosen) {
    const known = index?.byNumber[chosen.collectorNumber];
    /*
     * Falls back to what the pricing payload implies while the oracle answers.
     * That fallback is a guess — pokemontcg.io reports no variants at all for
     * whole sets — so it may never WRITE to the collection unprompted. Here it
     * only decides which buttons to offer, and a pocket is a layout rather than
     * a claim of ownership.
     */
    const finishes = known?.length ? known : availableFinishes(chosen.variants);

    return (
      <div className={styles.detail}>
        <div className={styles.detailHead}>
          <CardArt
            src={chosen.imageSmall}
            name={chosen.name}
            detail="tile"
            decorative
            className={styles.detailArt}
          />
          <div className={styles.detailText}>
            <span className={styles.detailName}>{chosen.name}</span>
            {/* The set gets its own line. Run together with the number it was
                the half that fell off the end of a phone — and the set is what
                tells two cards with the same name and number apart. */}
            <span className={styles.detailMeta}>{chosen.setName}</span>
            <span className={styles.detailMeta}>{chosen.collectorNumber}</span>
          </div>
          <Chip onPress={onCancel}>Back</Chip>
        </div>

        <p className={styles.note}>
          {isLoading && !known?.length ? "Checking printings…" : `Which printing goes in ${where}?`}
        </p>

        {/* One row per printing rather than a strip of chips: the row names the
            printing, puts it in the pocket, and records that you hold a copy —
            three answers about the same thing, so they belong on one line. */}
        <ul className={styles.rows}>
          {finishes.map((finish) => (
            <li key={finish} className={styles.row}>
              <button
                type="button"
                className={cx(styles.button, styles.rowMain)}
                onClick={() => onPlace(newSlot(chosen, finish))}
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

  /*
   * Custom art has no catalog entry, so there is nothing to own or to price —
   * but it must still be clearable from here, or a photo would be the one thing
   * a pocket could not be emptied of.
   */
  if (!card) {
    return (
      <div className={styles.detail}>
        <div className={styles.detailHead}>
          <CardArt
            src={slotArt(slot)}
            name={slotTitle(slot)}
            detail="tile"
            decorative
            className={styles.detailArt}
          />
          <div className={styles.detailText}>
            <span className={styles.detailName}>{slotTitle(slot)}</span>
            <span className={styles.detailMeta}>In {where}</span>
          </div>
          <Chip onPress={onClear} label={`Clear ${where}`}>
            Clear
          </Chip>
        </div>
      </div>
    );
  }

  const placedSet = (allSets ?? []).find((s) => s.id === setIdFromCardId(card.cardId))?.name;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <CardArt
          src={slotArt(card)}
          name={slotTitle(card)}
          detail="tile"
          decorative
          className={styles.detailArt}
        />
        <div className={styles.detailText}>
          <span className={styles.detailName}>{slotTitle(card)}</span>
          {/*
            A slot stores the card's id, number, name and art but NOT its set —
            the denormalised fields exist to paint a page offline, and a set name
            is not needed for that. It is needed the moment you tap the pocket
            and ask "which Riolu is this", because the number alone does not say.
            Recovered from the id rather than stored, so every binder already in
            the wild gains it without a migration.
          */}
          <span className={styles.detailMeta}>{placedSet ?? "Unknown set"}</span>
          <span className={styles.detailMeta}>
            {card.collectorNumber ? `${card.collectorNumber} · ` : ""}
            {finishLabel(card.finish)} · <Money value={price} />
          </span>
        </div>
      </div>

      <Row gap={2} wrap>
        <OwnToggle cardId={card.cardId} finish={card.finish} />
        <Chip onPress={onClear} label={`Clear ${where}`}>
          Clear
        </Chip>
      </Row>

      {forTrade ? <TradeControls card={card} price={price} onUpdate={onUpdate} /> : null}
    </div>
  );
}

/**
 * How many, and in what shape — the two things a trade is actually about.
 *
 * Only offered on a binder marked for trade. On any other binder a pocket holds
 * one card because that is what a pocket is, and asking "how many?" of a set
 * binder is a question with no meaning.
 */
function TradeControls({
  card,
  price,
  onUpdate,
}: {
  card: CardSlot;
  price: number | undefined;
  onUpdate: (slot: CardSlot) => void;
}) {
  const copies = slotQuantity(card);

  return (
    <Stack gap={3}>
      <Row gap={3} wrap>
        <span className={styles.fieldLabel} id="v2-binder-copies">
          Copies
        </span>
        {/* A stepper, not a number field. A phone keyboard over a panel pinned
            to the bottom covers the thing being counted, and the answer is
            almost always within a tap or two of one.

            Plain buttons rather than `Chip`, because "one fewer" has to be
            DISABLED at a single copy: `withQuantity` clamps to one, so the
            press would be a silent no-op otherwise. */}
        <div className={styles.stepper} role="group" aria-labelledby="v2-binder-copies">
          <button
            type="button"
            className={styles.button}
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
            className={styles.button}
            aria-label="One more copy"
            onClick={() => onUpdate(withQuantity(card, copies + 1))}
          >
            +
          </button>
        </div>
        {/* What the stack is worth, which is the number the owner is deciding
            against — the pocket badge shows the price of one. */}
        {copies > 1 && price !== undefined ? (
          <span className={styles.detailMeta}>
            <Money value={price * copies} /> total
          </span>
        ) : null}
      </Row>

      <Row gap={3} wrap>
        <span className={styles.fieldLabel} id="v2-binder-condition">
          Condition
        </span>
        <div className={styles.settingControls} role="group" aria-labelledby="v2-binder-condition">
          {TRADE_CONDITIONS.map((grade) => {
            const on = card.condition === grade;
            return (
              <Chip
                key={grade}
                // Pressing the grade a card already has clears it. Unstated is a
                // real answer and has to be reachable again — it is not the same
                // claim as "near mint".
                onPress={() => onUpdate(withCondition(card, on ? null : grade))}
                pressed={on}
                tone={on ? "accent" : "default"}
                label={conditionLabel(grade)}
              >
                {grade}
              </Chip>
            );
          })}
        </div>
      </Row>

      <p className={styles.note}>
        Condition is shown to whoever opens the link. It never changes the price — the market price is for the
        card, and what a played copy is worth is yours to agree.
        <ScreenReaderOnly>
          {card.condition ? `Currently ${conditionLabel(card.condition)}.` : "No condition recorded."}
        </ScreenReaderOnly>
      </p>
    </Stack>
  );
}
