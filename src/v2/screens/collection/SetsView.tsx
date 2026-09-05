import type { ReactNode } from "react";
import { screenToPath } from "../../../app/screenUrl.ts";
import type { SetTiers } from "../../../models/setCompletion.ts";
import { Card, Meter, Panel, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { rowLabel, type SetGroups, type SetRowModel } from "./setGroups.ts";
import styles from "./collection.module.css";

interface SetsViewProps {
  groups: SetGroups;
  /** The set list is still arriving. */
  isLoading: boolean;
  /** The set list could not be loaded at all. */
  isError: boolean;
  onRetry: () => void;
  query: string;
  onQuery: (next: string) => void;
  /** True once the collection holds anything, for the empty-state line. */
  hasCollection: boolean;
}

/**
 * Every set, grouped by how far through it you are.
 *
 * One column of rows on a phone, an auto-fill grid of the same rows on a wide
 * window. The width goes into COLUMNS, not into a gap inside a row: v1 stretched
 * a single 320px-tall column of rows across 1440px and every row became a set
 * name at the far left with a progress bar at the far right and eleven hundred
 * pixels of nothing between them.
 */
export function SetsView({
  groups,
  isLoading,
  isError,
  onRetry,
  query,
  onQuery,
  hasCollection,
}: SetsViewProps) {
  const shown = groups.inProgress.length + groups.complete.length + groups.rest.length;
  const filteredToNothing = shown === 0 && query.trim().length > 0 && !isLoading && !isError;

  return (
    <Stack gap={5}>
      <Row gap={3} align="center" wrap>
        <input
          type="search"
          className={styles.filter}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter sets"
          aria-label="Filter sets"
        />
        {query.trim() ? (
          <span className={styles.muted}>
            {shown} of {shown + groups.hiddenByFilter} sets
          </span>
        ) : null}
      </Row>

      {isError ? (
        <Panel title="Sets could not be loaded" headingLevel={2} tone="raised">
          <Stack gap={3}>
            {/*
              Says what could not be reached and offers the retry, without
              blaming the reader. The catalog fails in bursts, and everything
              already marked owned is still on the device — so this is a partial
              outage worth naming, not a broken app.
            */}
            <p className={styles.muted}>
              The set catalog did not answer. Anything you have already marked owned is safe on this device.
            </p>
            <button type="button" className={styles.button} onClick={onRetry}>
              Try again
            </button>
          </Stack>
        </Panel>
      ) : null}

      {isLoading && shown === 0 ? <SetSkeletons /> : null}

      {filteredToNothing ? (
        <Panel title="No set matches that" headingLevel={2}>
          <Stack gap={3}>
            <p className={styles.muted}>
              Nothing in the catalog matches <strong>{query.trim()}</strong>. Names, set codes and release
              years all match.
            </p>
            <button type="button" className={styles.button} onClick={() => onQuery("")}>
              Clear the filter
            </button>
          </Stack>
        </Panel>
      ) : null}

      {groups.inProgress.length > 0 ? <Group title="In progress" rows={groups.inProgress} /> : null}
      {/*
        Finished sets are not something you are working on, so they sit under
        their own heading rather than at the top of the working list.
      */}
      {groups.complete.length > 0 ? <Group title="Completed" rows={groups.complete} /> : null}
      {groups.rest.length > 0 ? (
        <Group
          title={groups.started.length > 0 ? "All sets" : "Sets"}
          rows={groups.rest}
          intro={
            hasCollection ? undefined : (
              <p className={styles.muted}>
                Nothing marked owned yet. Open a set and tap the printings you have — the ones you start
                appear above this list, ordered by how close they are to finished.
              </p>
            )
          }
        />
      ) : null}

      {!isLoading && !isError && shown === 0 && !filteredToNothing ? (
        <Panel title="No sets loaded" headingLevel={2}>
          <Stack gap={3}>
            <p className={styles.muted}>The catalog returned no sets. This is usually momentary.</p>
            <button type="button" className={styles.button} onClick={onRetry}>
              Try again
            </button>
          </Stack>
        </Panel>
      ) : null}
    </Stack>
  );
}

function Group({ title, rows, intro }: { title: string; rows: SetRowModel[]; intro?: ReactNode }) {
  return (
    <Panel
      title={title}
      headingLevel={2}
      tone="quiet"
      aside={<span className={styles.muted}>{rows.length}</span>}
    >
      <Stack gap={3}>
        {intro}
        {/*
          `data-testid` because the layout itself is the requirement here — at
          1440 this must be at least three columns and no row wider than 500px,
          and a CSS-module class name is not a stable handle for measuring that.
        */}
        <ul className={styles.setGrid} data-testid="set-grid">
          {rows.map((row) => (
            <li key={row.set.id}>
              <SetRow row={row} />
            </li>
          ))}
        </ul>
      </Stack>
    </Panel>
  );
}

/**
 * One set.
 *
 * A link rather than a button: a set has a real URL, so it must be
 * middle-clickable, copyable, and read as a link. `Card` gives it the accessible
 * name, which is where the base and master figures are spelled out in full —
 * the visible row abbreviates them and a screen reader should not have to guess.
 */
export function SetRow({ row }: { row: SetRowModel }) {
  const { set, tiers, owned } = row;
  const year = set.releaseDate?.slice(0, 4);

  return (
    <Card
      href={`#${screenToPath({ name: "set", setId: set.id, setName: set.name })}`}
      label={rowLabel(row)}
      pad={2}
      className={styles.setCard}
    >
      <div className={styles.setRow}>
        {set.logoImage ? (
          <img className={styles.logo} src={set.logoImage} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={cx(styles.logo, styles.logoFallback)} aria-hidden="true">
            {set.code ?? set.id}
          </span>
        )}

        <span className={styles.setHead}>
          <span className={styles.setName}>{set.name}</span>
          <span className={styles.setMeta}>
            {/*
              Only where the logo did not already fall back to it. A set with no
              logo image draws its code in the logo's place, and printing it
              again beside the year was the same three letters twice.
            */}
            {set.code && set.logoImage ? <span className={styles.code}>{set.code}</span> : null}
            {year ? <span>{year}</span> : null}
            {/*
              The set size, but only where the row is not already showing it. A
              started row carries `168/230` on the line below, and printing "230
              cards" beside it was the same number twice — at the cost of the
              width that pushed the set NAME into an ellipsis.
            */}
            {owned === 0 && set.total ? <span>{set.total} cards</span> : null}
          </span>
        </span>

        {owned > 0 ? <Tiers name={set.name} tiers={tiers} /> : null}
      </div>
    </Card>
  );
}

/**
 * Both completion figures, each carrying its own WORD.
 *
 * Base and master are two different numbers and two different achievements, and
 * a row that showed one bar could only ever be telling you about one of them.
 * The word is not decoration: gold means complete and green means in progress,
 * which is exactly the pair deuteranopia collapses into two yellows — so BASE
 * and MASTER, and the word "complete", carry the meaning and the colour is only
 * a reward for noticing.
 */
function Tiers({ name, tiers }: { name: string; tiers: SetTiers }) {
  return (
    <span className={styles.tiers}>
      {tiers.baseTotal !== undefined ? (
        <TierLine
          set={name}
          word="BASE"
          owned={tiers.baseOwned}
          total={tiers.baseTotal}
          ratio={tiers.baseRatio}
        />
      ) : null}
      <TierLine
        set={name}
        word="MASTER"
        owned={tiers.masterOwned}
        total={tiers.masterTotal}
        ratio={tiers.masterRatio}
      />
    </span>
  );
}

function TierLine({
  set,
  word,
  owned,
  total,
  ratio,
}: {
  set: string;
  word: "BASE" | "MASTER";
  owned: number;
  total: number | undefined;
  ratio: number | undefined;
}) {
  // Read off the counts, never off the ratio: a rounded or clamped percentage
  // is what let 99.7% print as "100%" beside a set three cards short.
  const complete = total !== undefined && total > 0 && owned >= total;
  return (
    <span className={styles.tierLine}>
      <span className={cx(styles.tierWord, complete && styles.tierWordDone)}>{word}</span>
      <span className={styles.tierBar}>
        <Meter value={ratio ?? 0} label={`${set} ${word.toLowerCase()} set`} labelHidden />
      </span>
      <span className={styles.tierCount}>
        {total === undefined ? owned : `${owned}/${total}`}
        {complete ? <span className={styles.tierDone}> complete</span> : null}
      </span>
    </span>
  );
}

/**
 * A skeleton in the shape of the content, in group order — never a spinner.
 * The list that arrives has to land where the placeholder was, or the page
 * jumps under a reader who has already started at the top of it.
 */
function SetSkeletons() {
  return (
    <Panel title="Sets" headingLevel={2} tone="quiet">
      <div aria-busy="true">
        <ScreenReaderOnly>Loading sets</ScreenReaderOnly>
        <ul className={styles.setGrid}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i}>
              <div className={styles.skeletonRow} />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
