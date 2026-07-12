import type { CardPriceResult } from "../models/cards.ts";
import { FINISH_LABELS } from "../models/cards.ts";
import { formatUpdated, formatUsd, UNAVAILABLE } from "../utils/format.ts";
import styles from "./PriceBlock.module.css";

interface PriceBlockProps {
  prices?: CardPriceResult;
  stale?: boolean;
}

/**
 * Full pricing panel for the details screen. Keeps the most important number
 * (Market) largest and visible without scrolling. Absent values show
 * "Unavailable" — never "$0.00". Labels the finish and the source.
 */
export function PriceBlock({ prices, stale }: PriceBlockProps) {
  const finishLabel = prices?.headlineFinish ? FINISH_LABELS[prices.headlineFinish] : undefined;

  return (
    <div className={styles.block}>
      <div className={styles.marketRow}>
        <span className={styles.marketLabel}>Market</span>
        <span className={styles.market}>{formatUsd(prices?.marketPrice)}</span>
      </div>

      <dl className={styles.secondary}>
        <div className={styles.pair}>
          <dt>Low</dt>
          <dd>{formatUsd(prices?.lowPrice)}</dd>
        </div>
        <div className={styles.pair}>
          <dt>Mid</dt>
          <dd>{formatUsd(prices?.midPrice)}</dd>
        </div>
      </dl>

      <div className={styles.meta}>
        {finishLabel ? <span className={styles.finish}>{finishLabel}</span> : null}
        <span className={styles.source}>{prices?.source ?? UNAVAILABLE}</span>
      </div>
      <div className={styles.updated}>
        {stale ? <span className={styles.stale}>⟳ Updating — showing saved price · </span> : null}
        Updated {prices ? formatUpdated(prices.lastUpdated) : "Unknown"}
      </div>
    </div>
  );
}
