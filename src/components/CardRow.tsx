import type { CollectFinish, PokemonCardSummary } from "../models/cards.ts";
import { COLLECT_FINISH_SHORT, availableFinishes } from "../models/cards.ts";
import { formatUsd } from "../utils/format.ts";
import { CardImage } from "./CardImage.tsx";
import styles from "./CardRow.module.css";

/** One card per focused row: name, set, collector number, and market price. */
export function CardRow({
  card,
  ownedFinishes,
  showFinishes = false,
  highlightFinish,
}: {
  card: PokemonCardSummary;
  ownedFinishes?: CollectFinish[];
  /** Show the printing badges: filled = held, outlined = still missing. */
  showFinishes?: boolean;
  /** The printing a pinch would mark — outlined so the target is never a guess. */
  highlightFinish?: CollectFinish;
}) {
  const held = ownedFinishes ?? [];
  const owned = held.length > 0;
  // The active finish is always shown even when the data does not list it for
  // this card: hand-marked printings (Poké Ball, Master Ball) have to be
  // visible as a target, or they cannot be marked from the list at all.
  const finishes = showFinishes
    ? Array.from(
        new Set([
          ...availableFinishes(card.variants),
          ...held,
          ...(highlightFinish ? [highlightFinish] : []),
        ]),
      )
    : [];
  // A lone "N" badge on a card that only exists as one printing is noise, so
  // badges appear once there is genuinely something to compare or track.
  const showBadges = finishes.length > 1 || held.length > 0;

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
        {showBadges ? (
          <div className={styles.finishes}>
            {finishes.map((f) => (
              <span
                key={f}
                className={`${styles.finish} ${held.includes(f) ? styles.finishHeld : ""} ${
                  f === highlightFinish ? styles.finishTarget : ""
                }`}
                aria-label={`${COLLECT_FINISH_SHORT[f]}${held.includes(f) ? " owned" : " missing"}${
                  f === highlightFinish ? ", selected" : ""
                }`}
              >
                {COLLECT_FINISH_SHORT[f]}
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
