import type { SetTiers } from "../../models/setCompletion.ts";
import styles from "./SetTierStatus.module.css";

/**
 * The set header's progress, with both denominators SAID OUT LOUD.
 *
 * This is the confusion the two-tier work exists to end. Obsidian Flames used to
 * read `197/230` in the set switcher and `197/408` in the header a centimetre
 * above it, with nothing on either to say that one counted cards up to the
 * printed denominator and the other counted printings across the whole set. Two
 * numbers that disagree and neither explains itself is worse than one number.
 *
 * Deliberately colour-free, on both shells. The list surfaces carry green and
 * gold; a header is read once on arrival, and tinting a figure that is not a
 * milestone announcement would spend the palette on a status line. The glasses
 * get the same treatment for the harder reason — `tokens.css` has no gold, and
 * `--cl-price` is already the mint green that means "worth something".
 */
export function SetTierStatus({
  tiers,
  printings,
}: {
  tiers: SetTiers;
  /**
   * Printings held over printings the set contains — a THIRD axis, not a tier.
   * Web only in practice: on a 600x600 additive display a third line of header
   * costs a card row of list, and the glasses show it in collect mode instead,
   * which is the only time it is the number being worked on.
   */
  printings?: { owned: number; total: number };
}) {
  const base = tiers.baseTotal !== undefined ? `${tiers.baseOwned}/${tiers.baseTotal}` : undefined;
  const master = tiers.masterTotal !== undefined ? `${tiers.masterOwned}/${tiers.masterTotal}` : undefined;
  // Nothing known about the set's size: one bare number beats an empty block.
  if (base === undefined && master === undefined)
    return <span className={styles.tiers}>{tiers.masterOwned}</span>;

  return (
    <span className={styles.tiers}>
      {base !== undefined ? (
        <span className={styles.line}>
          <span className={styles.label}>base</span> {base}
        </span>
      ) : null}
      {master !== undefined ? (
        <span className={styles.line}>
          {/* Labelled even when it is the only line: the whole point is that a
              bare `197/230` does not say which set size it is measuring. */}
          <span className={styles.label}>master</span> {master}
        </span>
      ) : null}
      {printings ? (
        <span className={`${styles.line} ${styles.dim}`}>
          <span className={styles.label}>printings</span> {printings.owned}/{printings.total}
        </span>
      ) : null}
    </span>
  );
}
