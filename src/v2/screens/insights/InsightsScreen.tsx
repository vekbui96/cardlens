import { useMemo } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useOwnedCards } from "../../../hooks/useOwnedCards.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { formatPrice } from "../../../utils/format.ts";
import { Card, CardArt, Money, Panel, ScreenReaderOnly, Skeleton, Stack } from "../../primitives/index.ts";
import { EmptyStart } from "../home/EmptyStart.tsx";
import { mostValuable, TOP_COUNT } from "./insights.ts";
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
          <ol className={styles.list}>
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
    </Stack>
  );
}
