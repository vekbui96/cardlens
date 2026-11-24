import { useMemo, useState } from "react";
import { screenToPath } from "../../../app/screenUrl.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { topMovers, type Mover, type MoverWindow, type TopMovers } from "../../../models/movement.ts";
import { readMoversWindow, storeMoversWindow } from "./moversWindow.ts";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { formatChangeShort, formatUsd } from "../../../utils/format.ts";
import { Card, Money, Panel, Skeleton, Stack, UNPRICED } from "../../primitives/index.ts";
import styles from "./Home.module.css";

/**
 * The owned cards that moved most this week, as percentages.
 *
 * The percent comes from the Cardmarket EUR series, so it is never turned into an
 * amount (see models/movement.ts). Beside it sits the printing's current TCGplayer
 * USD price (already loaded; none when unpriced, never 0). The caller decides when the
 * rows are final and applies the floor (`topMovers`); with nothing to show this
 * draws nothing at all, not an empty box. The sign is in the text, so colour is
 * never the only signal.
 */
export function MoversPanel({
  rows,
  loading = false,
  failed = false,
  onRetry,
}: {
  rows: OwnedPrintingRow[] | null;
  /** Names and prices are still arriving: hold the place with placeholders (only while `rows` is null). */
  loading?: boolean;
  /** A price request failed: say what is missing and offer `onRetry` instead of placeholders. */
  failed?: boolean;
  onRetry?: () => void;
}) {
  const [window, setWindow] = useState<MoverWindow>(readMoversWindow);
  const week = useMemo(() => (rows ? topMovers(rows, 7) : NONE), [rows]);
  const month = useMemo(() => (rows ? topMovers(rows, 30) : NONE), [rows]);
  const empty = (m: TopMovers<OwnedPrintingRow>) => m.risers.length === 0 && m.fallers.length === 0;
  if (rows === null && loading) {
    return (
      <Panel title="Biggest movers" headingLevel={2}>
        <div aria-busy="true" data-testid="home-movers-skeleton">
          {failed ? (
            <Stack gap={3}>
              <p className={styles.resumeMeta} role="status">
                Movers need price data that has not loaded yet.
              </p>
              <button type="button" className={styles.moverRetry} onClick={onRetry}>
                Try again
              </button>
            </Stack>
          ) : (
            // Three rows at the height of the real ones, so the rows arriving move nothing.
            <ul className={styles.list} aria-hidden="true">
              {[0, 1, 2].map((n) => (
                <li key={n}>
                  <Skeleton height="var(--v2-tap)" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    );
  }
  if (empty(week) && empty(month)) return null;
  const movers = window === 30 ? month : week;
  const choose = (value: MoverWindow) => {
    setWindow(value);
    storeMoversWindow(value);
  };
  return (
    <Panel title="Biggest movers" headingLevel={2}>
      <Stack gap={4}>
        <div className={styles.moverToggle} role="group" aria-label="Movers window">
          {([7, 30] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={styles.moverToggleButton}
              aria-pressed={window === value}
              onClick={() => choose(value)}
            >
              {value} days
            </button>
          ))}
        </div>
        {empty(movers) ? (
          <p className={styles.resumeMeta}>No big movers over {window} days.</p>
        ) : (
          <>
            <Side title="Risers" rows={movers.risers} window={window} />
            <Side title="Fallers" rows={movers.fallers} window={window} />
          </>
        )}
      </Stack>
    </Panel>
  );
}

const NONE: TopMovers<OwnedPrintingRow> = { risers: [], fallers: [] };

function Side({
  title,
  rows,
  window,
}: {
  title: string;
  rows: Mover<OwnedPrintingRow>[];
  window: MoverWindow;
}) {
  if (rows.length === 0) return null;
  return (
    <Stack gap={2}>
      <h3 className={styles.resumeLabel}>{title}</h3>
      <ul className={styles.list}>
        {rows.map(({ row, pct }) => {
          // The compact form: a row has no room for "over 30 days".
          const change = formatChangeShort(pct, window);
          // USD price of the printing; absent (or zero) shows no amount, never $0.00.
          const priced = typeof row.price === "number" && row.price > 0;
          const amount = priced ? formatUsd(row.price) : "";
          return (
            <li key={`${row.cardId}|${row.finish}`}>
              <Card
                href={`#${screenToPath({ name: "details", cardId: row.cardId })}`}
                label={`${row.name}, ${finishLabel(row.finish)}, ${priced ? amount : UNPRICED.toLowerCase()}, ${change}`}
                className={styles.tile}
              >
                <span className={styles.mover}>
                  <span className={styles.moverText}>
                    <span className={styles.moverName}>{row.name}</span>
                    <span className={styles.resumeMeta}>
                      {finishLabel(row.finish)} · {row.setName}
                    </span>
                  </span>
                  <span className={styles.moverFigures}>
                    <span className={styles.moverPct}>{change}</span>
                    {priced ? (
                      <Money value={row.price} />
                    ) : (
                      <span className={styles.resumeMeta}>{UNPRICED}</span>
                    )}
                  </span>
                </span>
              </Card>
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}
