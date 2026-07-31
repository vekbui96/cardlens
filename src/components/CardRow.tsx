import type { PokemonCardSummary } from "../models/cards.ts";
import { availableFinishes, type CollectFinish } from "../models/cards.ts";
import { compareFinishes, finishShort } from "../models/finishes.ts";
import { formatUsd } from "../utils/format.ts";
import { CardImage } from "./CardImage.tsx";
import styles from "./CardRow.module.css";

/** One card per focused row: name, set, collector number, and market price. */
export function CardRow({
  card,
  ownedFinishes,
  availableFinishes: printingsForCard,
  showFinishes = false,
  highlightFinish,
}: {
  card: PokemonCardSummary;
  ownedFinishes?: CollectFinish[];
  /** Real printings when the caller has them; otherwise derived from pricing. */
  availableFinishes?: CollectFinish[];
  /** Show the printing badges: filled = held, outlined = still missing. */
  showFinishes?: boolean;
  /** The printing a pinch would mark — outlined so the target is never a guess. */
  highlightFinish?: CollectFinish;
}) {
  const held = ownedFinishes ?? [];
  const owned = held.length > 0;
  // Only printings this card actually has, plus any already held. The active
  // target is NOT forced in: showing a Poké Ball badge on every card of a set
  // that has none was noise, so the outline appears only where the printing is
  // genuinely applicable.
  const finishes = showFinishes
    ? Array.from(new Set([...(printingsForCard ?? availableFinishes(card.variants)), ...held])).sort(
        compareFinishes,
      )
    : [];
  /**
   * A card with a single printing — most ex and full-art cards — gets a generic
   * marker rather than a labelled one. "H" on a card that only exists as holo
   * carries no information: there is nothing to choose between, so naming the
   * printing is noise dressed up as detail.
   *
   * Labelled badges appear only where there is genuinely something to compare.
   */
  const singlePrinting = finishes.length === 1;
  const showBadges = showFinishes && finishes.length > 1;
  const showGeneric = showFinishes && singlePrinting;

  return (
    <div className={styles.row}>
      <CardImage src={card.imageSmall} alt={`${card.name} — ${card.setName}`} size="thumb" />
      <div className={styles.info}>
        <div className={styles.name}>
          {/* Additive display: black is transparent, so a bright glyph reads as
              "owned" at a glance without relying on colour alone. */}
          {owned ? (
            <span className={styles.owned} aria-label="In collection">
              ✓{" "}
            </span>
          ) : null}
          {card.name}
        </div>
        <div className={styles.set}>{card.setName}</div>
        {/* The number stays visible alongside the badges — with the list sorted
            by number, it is how you find your place in a binder. */}
        <div className={styles.number}>
          {card.collectorNumber}
          {card.rarity ? ` · ${card.rarity}` : ""}
        </div>
        {showGeneric ? (
          <div className={styles.finishes}>
            <span
              className={`${styles.finish} ${owned ? styles.finishHeld : ""} ${
                highlightFinish ? styles.finishTarget : ""
              }`}
              aria-label={owned ? "owned" : "not owned"}
            >
              {owned ? "✓" : "—"}
            </span>
          </div>
        ) : null}
        {showBadges ? (
          <div className={styles.finishes}>
            {finishes.map((f) => (
              <span
                key={f}
                className={`${styles.finish} ${held.includes(f) ? styles.finishHeld : ""} ${
                  f === highlightFinish ? styles.finishTarget : ""
                }`}
                aria-label={`${finishShort(f)}${held.includes(f) ? " owned" : " missing"}${
                  f === highlightFinish ? ", selected" : ""
                }`}
              >
                {finishShort(f)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className={styles.price}>
        <span className={styles.priceLabel}>Market</span>
        <span className={styles.priceValue}>{formatUsd(card.marketPrice)}</span>
      </div>
    </div>
  );
}
