import type { PokemonCardSummary } from "../models/cards.ts";
import { formatUsd } from "../utils/format.ts";
import { CardImage } from "./CardImage.tsx";
import styles from "./CardRow.module.css";

/** One card per focused row: name, set, collector number, and market price. */
export function CardRow({ card }: { card: PokemonCardSummary }) {
  return (
    <div className={styles.row}>
      <CardImage src={card.imageSmall} alt={`${card.name} — ${card.setName}`} size="thumb" />
      <div className={styles.info}>
        <div className={styles.name}>{card.name}</div>
        <div className={styles.set}>{card.setName}</div>
        <div className={styles.number}>
          {card.collectorNumber}
          {card.rarity ? ` · ${card.rarity}` : ""}
        </div>
      </div>
      <div className={styles.price}>
        <span className={styles.priceLabel}>Market</span>
        <span className={styles.priceValue}>{formatUsd(card.marketPrice)}</span>
      </div>
    </div>
  );
}
