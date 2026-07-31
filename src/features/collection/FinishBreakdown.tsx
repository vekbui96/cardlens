import { ALL_COLLECT_FINISHES, COLLECT_FINISH_SHORT, type CollectFinish } from "../../models/cards.ts";
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
  const held = ALL_COLLECT_FINISHES.filter((f) => (counts[f] ?? 0) > 0);
  if (held.length === 0) return null;

  return (
    <div className={`${styles.row} ${className ?? ""}`}>
      {held.map((finish) => (
        <span key={finish} className={styles.item}>
          <span className={styles.badge}>{COLLECT_FINISH_SHORT[finish]}</span>
          <span className={styles.count}>{counts[finish]}</span>
        </span>
      ))}
    </div>
  );
}
