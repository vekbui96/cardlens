import { useMemo } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useOwnedCards } from "../../../hooks/useOwnedCards.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { formatPrice } from "../../../utils/format.ts";
import { Card, CardArt, Money, Panel, ScreenReaderOnly, Skeleton, Stack } from "../../primitives/index.ts";
import { EmptyStart } from "../home/EmptyStart.tsx";
import { addedThisMonth, mostValuable, TOP_COUNT, valueBySet } from "./insights.ts";
import styles from "./insights.module.css";

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Insights: which cards carry the value of the collection.
 *
 * It adds no request: the rows are the ones Home's movers already list, on the
 * same query keys. The list is drawn only once names and prices have settled,
 * because a ranking taken mid-load would reshuffle in front of the reader.
 * Cards without a price are counted ("N cards unpriced"), never guessed and
 * never ranked as zero.
 */
export function InsightsScreen() {
  const { collection } = useLibrary();
  const owned = useOwnedCards({ backfill: false });
  const settled = owned.pricing === 0 && owned.pending === 0;
  const result = useMemo(() => (settled ? mostValuable(owned.rows) : null), [settled, owned.rows]);

  const sets = useMemo(() => (settled ? valueBySet(owned.rows) : null), [settled, owned.rows]);

  const added = useMemo(
    () => (settled ? addedThisMonth(owned.rows, Date.now()) : null),
    [settled, owned.rows],
  );

  if (collection.length === 0) {
    return (
      <Stack gap={5}>
        <h1 className={styles.title}>Insights</h1>
        <EmptyStart headingLevel={2} />
      </Stack>
    );
  }

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Insights</h1>
        {result && result.concentrationPct !== null ? (
          <p className={styles.headline} data-testid="insights-concentration">
            Top {Math.min(TOP_COUNT, result.priced)} cards = {result.concentrationPct}% of the total value
          </p>
        ) : null}
        {result && result.unpriced > 0 ? (
          <p className={styles.meta} data-testid="insights-unpriced">
            {plural(result.unpriced, "card", "cards")} unpriced, left out of these figures
          </p>
        ) : null}
      </header>

      <Panel title="Added this month" headingLevel={2}>
        {added === null ? (
          <Skeleton height="var(--v2-tap)" />
        ) : added.count === 0 ? (
          <Stack gap={3}>
            <p className={styles.meta} data-testid="insights-added-empty">
              Nothing marked as owned this month yet.
            </p>
            <Card href={`#${screenToPath({ name: "sets" })}`} pad={3}>
              <Stack gap={1}>
                <span className={styles.name}>Browse sets</span>
                <span className={styles.detail}>Pick a set and tick off what you have</span>
              </Stack>
            </Card>
          </Stack>
        ) : (
          <Stack gap={1}>
            <p className={styles.headline} data-testid="insights-added">
              {plural(added.count, "card", "cards")} marked as owned this month
              {added.count > added.unpriced ? (
                <>
                  , worth <Money value={added.worth} /> now
                </>
              ) : null}
            </p>
            {added.unpriced > 0 ? (
              <p className={styles.meta} data-testid="insights-added-unpriced">
                {added.unpriced} unpriced, left out of the worth
              </p>
            ) : null}
          </Stack>
        )}
      </Panel>

      <Panel title="Most valuable cards" headingLevel={2}>
        {result === null ? (
          <Stack gap={2}>
            <ScreenReaderOnly>Pricing your collection</ScreenReaderOnly>
            <div data-testid="insights-skeleton">
              <Stack gap={2}>
                {Array.from({ length: 5 }, (_, n) => (
                  <Skeleton key={n} height="var(--v2-tap)" />
                ))}
              </Stack>
            </div>
          </Stack>
        ) : result.top.length === 0 ? (
          <p className={styles.meta}>None of your cards has a price yet, so there is nothing to rank.</p>
        ) : (
          <ol className={styles.list} data-testid="insights-top-list">
            {result.top.map(({ row, sharePct }, i) => (
              <li key={`${row.cardId}|${row.finish}`}>
                <Card
                  href={`#${screenToPath({ name: "details", cardId: row.cardId })}`}
                  pad={2}
                  label={`${i + 1}. ${row.name}, ${finishLabel(row.finish)}, ${formatPrice(row.price)}, ${sharePct}% of the total`}
                >
                  <div className={styles.row}>
                    <span className={styles.rank}>{i + 1}</span>
                    <span className={styles.art}>
                      <CardArt src={row.imageSmall} name={row.name} detail="tile" decorative />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.name}>{row.name}</span>
                      <span className={styles.detail}>
                        {finishLabel(row.finish)} · {row.setName}
                      </span>
                    </span>
                    <span className={styles.figures}>
                      <Money value={row.price} />
                      <span className={styles.detail}>{sharePct}%</span>
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Value by set" headingLevel={2}>
        {sets === null ? (
          <Skeleton height="var(--v2-tap)" />
        ) : sets.sets.length === 0 || sets.topShare === null ? (
          <p className={styles.meta}>None of your cards has a price yet, so there is nothing to total.</p>
        ) : (
          <Stack gap={3}>
            <p className={styles.headline} data-testid="insights-top-sets">
              Top {sets.topShare.count} {sets.topShare.count === 1 ? "set" : "sets"} = {sets.topShare.pct}% of
              the total value
            </p>
            <ol className={styles.setList} data-testid="insights-sets">
              {sets.sets.map((s) => (
                <li
                  key={s.setId}
                  className={styles.setRow}
                  aria-label={`${s.setName}, ${formatPrice(s.worth)}, ${s.sharePct}% of the total${s.unpriced > 0 ? `, ${plural(s.unpriced, "card", "cards")} unpriced` : ""}`}
                >
                  <span className={styles.name}>{s.setName}</span>
                  <span className={styles.figures}>
                    <Money value={s.worth} />
                    <span className={styles.detail}>{s.sharePct}%</span>
                  </span>
                  <span className={styles.bar} aria-hidden="true">
                    <span className={styles.barFill} style={{ width: `${s.sharePct}%` }} />
                  </span>
                  {s.unpriced > 0 ? <span className={styles.detail}>{s.unpriced} unpriced</span> : null}
                </li>
              ))}
            </ol>
          </Stack>
        )}
      </Panel>
    </Stack>
  );
}
