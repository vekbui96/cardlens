import type { CollectFinish } from "../../models/cards.ts";
import { completionPercent, type SetTiers } from "../../models/setCompletion.ts";
import { shownRatio, tierLabel } from "./completionTier.ts";
import { FinishBreakdown } from "./FinishBreakdown.tsx";
import styles from "./SetProgressRow.module.css";

/**
 * One set's completion: name, owned/total, and a bar.
 *
 * Drawn on the glasses, so it gains no colour and no second bar. A 600x600
 * additive display spends roughly two rows of list on every row of chrome, and
 * a base bar stacked over a master bar would double the cost of the only screen
 * that is nothing but this row repeated.
 *
 * What it does gain is the WORD. The bar and the head count are the base tier
 * wherever the set has one, and both say so — the same set used to read 197/230
 * here and 197/408 in a header with nothing on either to say which was which.
 * The word is also what keeps the star readable without colour vision.
 */
export function SetProgressRow({
  name,
  owned,
  printings,
  finishes,
  tiers,
}: {
  name: string;
  owned: number;
  printings: number;
  finishes: Partial<Record<CollectFinish, number>>;
  tiers: SetTiers;
}) {
  const percent = completionPercent(shownRatio(tiers));
  const label = tierLabel(tiers.tier);
  const complete = label !== null;
  const base = tiers.baseTotal !== undefined;
  const master = tiers.masterTotal !== undefined ? `${tiers.masterOwned}/${tiers.masterTotal}` : undefined;
  /*
   * One figure and one word, and they must name the same tier — a `73/73` head
   * over a `MASTER` footer is the two-denominator confusion this work exists to
   * end, reproduced inside a single row. A master-complete set shows its master
   * pair, because that is the milestone it reached; anything short of that shows
   * the base run, which is what the bar measures.
   */
  const count =
    label === "MASTER" && master !== undefined
      ? master
      : base
        ? `${tiers.baseOwned}/${tiers.baseTotal}`
        : (master ?? `${owned}`);
  const word = label ?? (base ? "base" : master !== undefined ? "master" : "");

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.name}>
          {complete ? <span className={styles.star}>★ </span> : null}
          {name}
        </span>
        <span className={styles.count}>{count}</span>
      </div>
      {/* The bar is decorative; the counts above carry the same information for
          screen readers, so it is hidden from the accessibility tree. */}
      <div className={styles.track} aria-hidden="true">
        <div
          className={`${styles.fill} ${complete ? styles.fillComplete : ""}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <div className={styles.footer}>
        <span className={styles.percent}>
          {percent === undefined ? "" : `${percent}%`}
          {/* Which set size that percentage is OF, and — uppercase — whether it
              is finished. The glasses have no colour to spare for this: the
              display is additive, tokens.css has no gold, and `--cl-price` is
              already the mint green that means "worth something". The word does
              the whole job, which is what it has to do on web too, where green
              and gold read as one hue to a deutan. */}
          {word ? <span className={label ? styles.tierDone : styles.countTier}> {word}</span> : null}
          {/* Only worth showing once it diverges from the card count — otherwise
              it is the same number twice. */}
          {printings > owned ? ` · ${printings} printings` : ""}
        </span>
        <FinishBreakdown counts={finishes} />
      </div>
    </div>
  );
}
