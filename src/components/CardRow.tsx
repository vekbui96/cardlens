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
}: {
  card: PokemonCardSummary;
  ownedFinishes?: CollectFinish[];
  /** Collect mode: show every printing, so the gaps are as visible as the holds. */
  showFinishes?: boolean;
}) {
  const held = ownedFinishes ?? [];
  const owned = held.length > 0;
  const finishes = showFinishes ? availableFinishes(card.variants) : [];

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
        {finishes.length > 0 ? (
          <div className={styles.finishes}>
            {finishes.map((f) => (
              <span
                key={f}
                className={`${styles.finish} ${held.includes(f) ? styles.finishHeld : ""}`}
                aria-label={`${COLLECT_FINISH_SHORT[f]}${held.includes(f) ? " owned" : " missing"}`}
              >
                {COLLECT_FINISH_SHORT[f]}
              </span>
            ))}
          </div>
        ) : (
          <div className={styles.number}>
            {card.collectorNumber}
            {card.rarity ? ` · ${card.rarity}` : ""}
          </div>
        )}
      </div>
      <div className={styles.price}>
        <span className={styles.priceLabel}>Market</span>
        <span className={styles.priceValue}>{formatUsd(card.marketPrice)}</span>
      </div>
    </div>
  );
}
