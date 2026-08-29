import { completionPercent, type SetTiers } from "../../models/setCompletion.ts";
import { shownRatio } from "./completionTier.ts";
import styles from "./SetTierFigures.module.css";

/**
 * A set row's progress: one bar, two labelled figures.
 *
 * Shared by the two web lists that answer the same question — Home's "closest
 * to complete" and the Collection/Sets list. They drew the same cluster from two
 * copies of the same CSS before, which is how the rounded `pct === 100` on one
 * came to disagree with the `ratio === 1` on the other.
 *
 * The BAR is the base run wherever a set has one. Base is the milestone with an
 * end in sight; ranking and drawing the master tier buries the set that is three
 * commons short behind one that needs a chase card nobody pulls.
 *
 * **Colour is never the signal.** Green (base) and gold (master) are a single
 * hue under the common red-green deficiencies, so a finished figure also carries
 * a ★ and its label goes UPPERCASE — `★ 197/197 BASE` against `197/230 master`.
 * The label is there either way, because the reason this component exists is
 * that `197/230` and `197/408` used to appear a centimetre apart with nothing on
 * either saying which set size it measured.
 */
export function SetTierFigures({
  tiers,
  owned,
  className = "",
}: {
  tiers: SetTiers;
  owned: number;
  /** Lets the host row place the cluster in its own grid. */
  className?: string;
}) {
  const percent = completionPercent(shownRatio(tiers));
  const base = tiers.baseTotal !== undefined;
  const baseDone = base && tiers.tier !== "none";
  const masterDone = tiers.tier === "master";

  // With no base tier the set has one achievement, so the master pair is the
  // headline and there is no second line to disambiguate it from.
  const lead = base
    ? { figure: `${tiers.baseOwned}/${tiers.baseTotal}`, word: "base", done: baseDone }
    : {
        figure: tiers.masterTotal !== undefined ? `${tiers.masterOwned}/${tiers.masterTotal}` : `${owned}`,
        word: tiers.masterTotal !== undefined ? "master" : "",
        done: masterDone,
      };

  return (
    <span className={`${styles.progress} ${className}`}>
      {/* Only when the set size is known. An empty bar reads as "0% done"
          rather than "we do not know how big this set is". */}
      {percent !== undefined ? (
        <span className={styles.bar} aria-hidden="true">
          <span
            className={`${styles.fill} ${masterDone ? styles.fillMaster : baseDone ? styles.fillBase : ""}`}
            style={{ width: `${percent}%` }}
          />
        </span>
      ) : null}
      <span className={`${styles.figure} ${lead.done ? (base ? styles.doneBase : styles.doneMaster) : ""}`}>
        {lead.done ? "★ " : ""}
        {lead.figure}
        {lead.word ? (
          <span className={lead.done ? styles.wordDone : styles.word}>
            {" "}
            {lead.done ? lead.word.toUpperCase() : lead.word}
          </span>
        ) : null}
      </span>
      {base && tiers.masterTotal !== undefined ? (
        <span className={`${styles.second} ${masterDone ? styles.doneMaster : ""}`}>
          {masterDone ? "★ " : ""}
          {tiers.masterOwned}/{tiers.masterTotal}
          <span className={masterDone ? styles.wordDone : styles.word}>
            {" "}
            {masterDone ? "MASTER" : "master"}
          </span>
        </span>
      ) : null}
    </span>
  );
}
