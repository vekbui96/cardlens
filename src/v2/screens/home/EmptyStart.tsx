import type { ReactNode } from "react";
import { Card, Panel, Stack } from "../../primitives/index.ts";
import { screenToPath } from "../../../app/screenUrl.ts";
import styles from "./Home.module.css";

/**
 * The one empty state v2 shows wherever a device has nothing tracked yet
 * (#165): Home, Everything owned and the set list.
 *
 * Those three used to say three different things, and two of them were a line
 * of muted text with at most one way out. A collector on a fresh phone meets
 * them in any order, so they say the same sentence and offer the same two ways
 * in. Both are real `<a href>`s to real routes, never buttons that open
 * something: if either is a dead end, the app has no first-run path at all.
 *
 * The heading level is the caller's, because the screens differ: Home's empty
 * state IS the page (h1), while under the Collection heading it is a section
 * (h2). Home adds its sync line and Connect this device through `status` and
 * `extraActions`; the collection screens have their own sync control.
 */
export function EmptyStart({
  headingLevel,
  status,
  extraActions,
}: {
  headingLevel: 1 | 2;
  /** One quiet line under the hint, announced as a status. */
  status?: ReactNode;
  /** Further tiles after the two ways in. */
  extraActions?: ReactNode;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <>
      <Panel tone="raised" pad={5}>
        <Stack gap={4}>
          <Heading className={styles.emptyTitle}>Nothing tracked yet</Heading>
          <p className={styles.emptyHint}>
            Open a set and mark the printings you own, or search for a card you have. Everything is saved on
            this device straight away — sync is optional and comes later.
          </p>
          {status ? (
            <p role="status" className={styles.emptySyncLine}>
              {status}
            </p>
          ) : null}
          <div className={styles.actions} role="group" aria-label="Ways to start tracking">
            <Card
              href={`#${screenToPath({ name: "sets" })}`}
              className={headingLevel === 1 ? `${styles.tile} ${styles.tilePrimary}` : styles.tile}
              pad={4}
            >
              <Stack gap={1}>
                <span className={styles.actionName}>Browse sets</span>
                <span className={styles.actionHint}>Pick a set and tick off what you have</span>
              </Stack>
            </Card>
            <Card href={`#${screenToPath({ name: "results", query: "" })}`} className={styles.tile} pad={4}>
              <Stack gap={1}>
                <span className={styles.actionName}>Search for a card</span>
                <span className={styles.actionHint}>By name or collector number</span>
              </Stack>
            </Card>
            {extraActions}
          </div>
        </Stack>
      </Panel>
      {headingLevel === 1 ? (
        <p className={styles.emptyLater}>Scan or import cards later from the menu</p>
      ) : null}
    </>
  );
}
