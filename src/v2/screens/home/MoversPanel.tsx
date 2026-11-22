import { useMemo, useState } from "react";
import { screenToPath } from "../../../app/screenUrl.ts";
import { finishLabel } from "../../../models/finishes.ts";
import {
  formatPct,
  topMovers,
  type Mover,
  type MoverWindow,
  type TopMovers,
} from "../../../models/movement.ts";
import { readMoversWindow, storeMoversWindow } from "./moversWindow.ts";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { Card, Panel, Stack } from "../../primitives/index.ts";
import styles from "./Home.module.css";

/**
 * The owned cards that moved most this week, as percentages.
 *
 * Percent only: the series is Cardmarket EUR while Home's total is TCGplayer USD,
 * so no amount is shown (see models/movement.ts). The caller decides when the
 * rows are final and applies the floor (`topMovers`); with nothing to show this
 * draws nothing at all, not an empty box. The sign is in the text, so colour is
 * never the only signal.
 */
export function MoversPanel({ rows }: { rows: OwnedPrintingRow[] | null }) {
  const [window, setWindow] = useState<MoverWindow>(readMoversWindow);
  const week = useMemo(() => (rows ? topMovers(rows, 7) : NONE), [rows]);
  const month = useMemo(() => (rows ? topMovers(rows, 30) : NONE), [rows]);
  const empty = (m: TopMovers<OwnedPrintingRow>) => m.risers.length === 0 && m.fallers.length === 0;
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
          const change = `${formatPct(pct)} ${window}d`;
          return (
            <li key={`${row.cardId}|${row.finish}`}>
              <Card
                href={`#${screenToPath({ name: "details", cardId: row.cardId })}`}
                label={`${row.name}, ${finishLabel(row.finish)}, ${change}`}
                className={styles.tile}
              >
                <span className={styles.mover}>
                  <span className={styles.moverText}>
                    <span className={styles.moverName}>{row.name}</span>
                    <span className={styles.resumeMeta}>
                      {finishLabel(row.finish)} · {row.setName}
                    </span>
                  </span>
                  <span className={styles.moverPct}>{change}</span>
                </span>
              </Card>
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}
