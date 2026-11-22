import { Card, Meter, Panel, Stack, cx } from "../../primitives/index.ts";
import { screenToPath } from "../../../app/screenUrl.ts";
import { tierLabel } from "../../../features/collection/completionTier.ts";
import type { ContinueTarget } from "../../../features/home/continueSet.ts";
import type { SetTiers } from "../../../models/setCompletion.ts";
import { sumFinishLines, type FinishParts } from "./finishLine.ts";
import { completionFigure } from "./homeSummary.ts";
import styles from "./Home.module.css";

export interface ProgressRow {
  setId: string;
  setName: string;
  cards: number;
  total: number;
  tiers: SetTiers;
  /** What is left, e.g. "9 cards to go, about $12.40"; absent when nothing is. */
  finishLine?: string | null;
  /** The numbers behind `finishLine`, added up under the list. */
  finish?: FinishParts | null;
}

function setHref(setId: string, setName: string): string {
  return `#${screenToPath({ name: "set", setId, setName })}`;
}

/**
 * Where you got to, and how far through you are.
 *
 * This is the question the navigation cannot answer, which is the whole reason
 * Home is not a second copy of the nav bar. Every row here is a link to a real
 * set with a real state on it — a count, a bar, a milestone — so the space it
 * takes buys something the header does not already give away for free.
 */
export function ProgressPanel({
  resume,
  rows,
  loading,
}: {
  resume: ContinueTarget | null;
  rows: ProgressRow[];
  /** The set list has not arrived, so completion cannot be drawn yet. */
  loading: boolean;
}) {
  const total = sumFinishLines(rows.map((row) => row.finish));
  return (
    <Panel title="Sets in progress" headingLevel={2}>
      <Stack gap={4}>
        {resume ? <ResumeCard resume={resume} /> : null}

        {loading ? (
          <Stack gap={2} aria-busy="true">
            <span className={styles.skeletonRow} />
            <span className={styles.skeletonRow} />
            <span className={styles.skeletonRow} />
          </Stack>
        ) : rows.length > 0 ? (
          <Stack gap={2}>
            <h3 className={styles.resumeLabel}>Closest to complete</h3>
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.setId}>
                  <SetRow row={row} />
                </li>
              ))}
            </ul>
            {total ? <p className={styles.resumeMeta}>{total}</p> : null}
            <WantListRow />
          </Stack>
        ) : (
          <p className={styles.note}>
            None of the sets you hold have a known size yet, so there is nothing to measure completion
            against.
          </p>
        )}
      </Stack>
    </Panel>
  );
}

/** Every missing card across the started sets, one tap away (the Want list screen). */
function WantListRow() {
  return (
    <Card
      href={`#${screenToPath({ name: "wantlist" })}`}
      label="Want list: every card missing from the sets you have started"
      className={styles.tile}
    >
      <Stack gap={1}>
        <span className={styles.resumeName}>Want list</span>
        <span className={styles.resumeMeta}>Every card missing from the sets you have started, priced</span>
      </Stack>
    </Card>
  );
}

function ResumeCard({ resume }: { resume: ContinueTarget }) {
  const figure = completionFigure(resume.tiers, resume.cards);
  const word = tierLabel(resume.tiers.tier);

  return (
    <Card
      href={setHref(resume.setId, resume.setName)}
      label={`Pick up where you left off: ${resume.setName}, ${figure.text}`}
      className={styles.tile}
      pad={4}
    >
      <Stack gap={1}>
        <span className={styles.resumeLabel}>Pick up where you left off</span>
        <span className={styles.resumeName}>{resume.setName}</span>
        <span className={styles.resumeMeta}>
          {/*
            ★ and the uppercase word carry the milestone where colour cannot —
            green base against gold master is exactly the pair deuteranopia
            collapses, so neither may be the only signal.
          */}
          {resume.tiers.tier !== "none" ? "★ " : ""}
          {figure.text}
          {word ? (
            <span
              className={cx(
                styles.tierWord,
                resume.tiers.tier === "master" ? styles.tierMaster : styles.tierBase,
              )}
            >
              {" "}
              {word}
            </span>
          ) : null}
          {` · ${resume.printings} ${resume.printings === 1 ? "printing" : "printings"}`}
        </span>
      </Stack>
    </Card>
  );
}

function SetRow({ row }: { row: ProgressRow }) {
  const figure = completionFigure(row.tiers, row.cards);
  const word = tierLabel(row.tiers.tier);

  return (
    <Card
      href={setHref(row.setId, row.setName)}
      label={`${row.setName}, ${figure.text}${word ? `, ${word} complete` : ""}${row.finishLine ? `, ${row.finishLine}` : ""}`}
      className={styles.tile}
    >
      <Stack gap={1}>
        <Meter
          value={figure.ratio}
          label={row.setName}
          detail={
            <>
              {figure.text}
              {word ? (
                <span
                  className={cx(
                    styles.tierWord,
                    row.tiers.tier === "master" ? styles.tierMaster : styles.tierBase,
                  )}
                >
                  {" "}
                  {word}
                </span>
              ) : null}
            </>
          }
        />
        {row.finishLine ? <span className={styles.resumeMeta}>{row.finishLine}</span> : null}
      </Stack>
    </Card>
  );
}
