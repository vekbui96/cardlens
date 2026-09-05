import { Card, Money, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { screenToPath } from "../../../app/screenUrl.ts";
import type { SealedRow } from "../../../hooks/useSealed.ts";
import { kindCells, priceAge, rowNote } from "./sealedRows.ts";
import styles from "./sealed.module.css";

/**
 * One set's sealed products.
 *
 * The card is INERT — no `onPress`, no `href` on the card itself. The set name
 * inside it is a real link and the rest is figures; a whole tile that looked
 * pressable, with a link inside it going somewhere else, is a surface that
 * lies about what pressing it does.
 */
export function SealedSetRow({ row }: { row: SealedRow }) {
  const cells = kindCells(row.prices);
  const age = priceAge(row.updated);
  const note = rowNote(cells);

  return (
    <li>
      <Card pad={4}>
        <Stack gap={3}>
          <Row gap={3} justify="space-between" align="baseline" wrap>
            {/*
              An h2 rather than an h3: the list is the page's own content, with
              no section between it and the `<h1>`, so an h3 here would be a
              level skipped and an outline a screen reader cannot follow.
            */}
            <h2 className={styles.setHeading}>
              <a
                className={styles.setLink}
                href={`#${screenToPath({ name: "set", setId: row.setId, setName: row.setName })}`}
              >
                {row.setName}
              </a>
            </h2>
            <p className={styles.holdings}>
              {row.holdings} {row.holdings === 1 ? "printing" : "printings"} held
            </p>
          </Row>

          <dl className={styles.prices}>
            {cells.map((cell) => (
              <div className={styles.price} key={cell.key}>
                <dt className={styles.kind}>{cell.label}</dt>
                <dd className={styles.amount}>
                  {/*
                    Three outcomes, three words. `Money` refuses to render
                    `$0.00`, and `absentLabel` is how a screen says what its own
                    absence means — "Not sold" is a fact about the set, "No
                    price" is a fact about the feed, and a shared dash would
                    merge two different answers into one.
                  */}
                  {cell.state === "not-sold" ? (
                    <Money value={undefined} absentLabel="Not sold" />
                  ) : (
                    <Money value={cell.price} absentLabel="No price" />
                  )}
                  {cell.productName ? <ScreenReaderOnly> — {cell.productName}</ScreenReaderOnly> : null}
                </dd>
              </div>
            ))}
          </dl>

          {note ? <p className={styles.note}>{note}</p> : null}

          {/*
            How old these numbers are, on every row, always. The server keeps
            serving a cached reading when the daily refresh fails — which is the
            right call for the data and a lie if the screen does not say so.
            Counts against a real clock, hence volatile.
          */}
          <p className={cx(styles.note, age.stale && styles.noteStale)} data-snapshot="volatile">
            {age.stale
              ? `Read ${age.label} — older than the daily refresh, so these are not today's numbers.`
              : `Read ${age.label}.`}
          </p>
        </Stack>
      </Card>
    </li>
  );
}
