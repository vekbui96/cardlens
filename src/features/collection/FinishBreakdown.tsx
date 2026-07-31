import type { CollectFinish } from "../../models/cards.ts";
import { compareFinishes, finishShort } from "../../models/finishes.ts";
import styles from "./FinishBreakdown.module.css";

/**
 * How many of each printing are held — the master-setter's actual scoreboard.
 * "42 cards" says nothing about whether the reverse holos are done.
 *
 * Only finishes with a count are rendered: showing every possible finish at
 * zero would fill the row with noise on a 600x600 display, and Poké Ball
 * pattern is meaningless for a WotC-era set.
 */
export function FinishBreakdown({
  counts,
  className,
}: {
  counts: Partial<Record<CollectFinish, number>>;
  className?: string;
}) {
  // Driven by the data rather than a fixed list: foils are open-ended, so any
  // printing actually held must show even if this build has never heard of it.
  const held = (Object.keys(counts) as CollectFinish[])
    .filter((f) => (counts[f] ?? 0) > 0)
    .sort(compareFinishes);
  if (held.length === 0) return null;

  return (
    <div className={`${styles.row} ${className ?? ""}`}>
      {held.map((finish) => (
        <span key={finish} className={styles.item}>
          <span className={styles.badge}>{finishShort(finish)}</span>
          <span className={styles.count}>{counts[finish]}</span>
        </span>
      ))}
    </div>
  );
}
