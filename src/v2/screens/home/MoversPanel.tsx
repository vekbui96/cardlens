import { screenToPath } from "../../../app/screenUrl.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { formatPct, type Mover, type TopMovers } from "../../../models/movement.ts";
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
export function MoversPanel({ movers }: { movers: TopMovers<OwnedPrintingRow> }) {
  if (movers.risers.length === 0 && movers.fallers.length === 0) return null;
  return (
    <Panel title="Biggest movers" headingLevel={2}>
      <Stack gap={4}>
        <Side title="Risers" rows={movers.risers} />
        <Side title="Fallers" rows={movers.fallers} />
      </Stack>
    </Panel>
  );
}

function Side({ title, rows }: { title: string; rows: Mover<OwnedPrintingRow>[] }) {
  if (rows.length === 0) return null;
  return (
    <Stack gap={2}>
      <h3 className={styles.resumeLabel}>{title}</h3>
      <ul className={styles.list}>
        {rows.map(({ row, pct }) => {
          const change = `${formatPct(pct)} 7d`;
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
