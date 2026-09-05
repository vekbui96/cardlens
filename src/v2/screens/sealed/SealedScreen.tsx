import { useQueryClient } from "@tanstack/react-query";
import { Card, Chip, Panel, Row, Stack, cx } from "../../primitives/index.ts";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useSealed } from "../../../hooks/useSealed.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { SealedSetRow } from "./SealedSetRow.tsx";
import {
  heldSetIds,
  productTally,
  sealedStanding,
  silentNote,
  tallyLine,
  unmatchedNote,
} from "./sealedRows.ts";
import styles from "./sealed.module.css";

/**
 * What sealed product costs right now, for the sets you collect.
 *
 * ## The request budget
 *
 * One `GET /api/sealed/:setId` per set held, with a twelve-hour `staleTime`
 * against a source that republishes once a day — asking more often spends
 * requests to read the same numbers back. This screen adds nothing to that:
 * `useLibrary`, `useSets` and `useSealed` are all already mounted and shared, so
 * calling them again here costs a context read and a cache hit. The only extra
 * traffic it can cause is the explicit retry, which re-runs the same keys.
 *
 * Scoped to sets held rather than all 217 for the same reason the hook is:
 * "what does a pack cost" is a question about what you are working on.
 *
 * ## Two things it must never do
 *
 * Show `$0.00` for a product nobody has priced — a free booster box and an
 * unpriced one are not the same product — and show a figure without saying how
 * old it is. The server deliberately keeps serving a cached reading when the
 * daily refresh fails, so "today's price" is a claim the data does not always
 * support; every row carries its own age, and says when that age is past the
 * refresh window.
 */
export function SealedScreen() {
  const client = useQueryClient();
  const { collection } = useLibrary();
  const { data: sets } = useSets();
  const { rows } = useSealed();

  const held = heldSetIds(collection);
  const setNames: Record<string, string> = {};
  for (const set of sets ?? []) setNames[set.id] = set.name;

  const standing = sealedStanding({
    held,
    setNames,
    setsLoaded: sets !== undefined,
    answered: rows.map((row) => row.setId),
  });

  const tally = tallyLine(productTally(rows));
  const silentText = silentNote(standing.silent);
  const unmatchedText = unmatchedNote(standing.unmatched);

  /**
   * A retry, not a new request shape: invalidating `["sealed"]` re-runs exactly
   * the per-set queries this screen already depends on. It exists because a set
   * still loading, a set with no sealed product and a set whose lookup failed
   * all arrive here identically — see `silentNote` — and asking again is the
   * only thing that can separate them.
   */
  const retry = () => void client.invalidateQueries({ queryKey: ["sealed"] });

  if (held.length === 0) {
    return (
      <Stack gap={5}>
        <header>
          <h1 className={styles.title}>Sealed prices</h1>
        </header>
        <Panel tone="raised" pad={5}>
          <Stack gap={4}>
            <p className={styles.prose}>
              Nothing collected yet, so there are no sets to price. This screen follows your collection: mark
              a printing you own and that set's pack, box and bundle prices appear here.
            </p>
            <Card href={`#${screenToPath({ name: "sets" })}`} pad={4}>
              <Stack gap={1}>
                <span className={styles.proseStrong}>Browse sets</span>
                <span className={styles.prose}>Pick a set and tick off what you have</span>
              </Stack>
            </Card>
          </Stack>
        </Panel>
      </Stack>
    );
  }

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Sealed prices</h1>
        <p className={cx(styles.summary, standing.warn && styles.summaryWarn)}>
          {standing.line}
          {tally ? ` · ${tally}` : ""}
        </p>
      </header>

      <p className={styles.prose}>
        TCGplayer market prices, through tcgcsv's daily dump — the same source and the same currency as every
        card figure in the app, so a pack price and a card price can be compared directly.
      </p>

      {standing.waiting ? <Skeleton /> : null}

      {rows.length > 0 ? (
        <ul className={styles.list}>
          {rows.map((row) => (
            <SealedSetRow key={row.setId} row={row} />
          ))}
        </ul>
      ) : null}

      {silentText || unmatchedText ? (
        <Stack gap={3}>
          {silentText ? <p className={styles.note}>{silentText}</p> : null}
          {unmatchedText ? <p className={styles.note}>{unmatchedText}</p> : null}
          {silentText ? (
            <Row gap={2} wrap>
              <Chip onPress={retry}>Look those sets up again</Chip>
            </Row>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

/**
 * The shape of the content, not a spinner: three set rows, so nothing jumps
 * when the real ones land.
 */
function Skeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <Stack gap={3}>
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </Stack>
    </div>
  );
}
