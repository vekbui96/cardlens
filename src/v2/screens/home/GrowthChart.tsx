import { useMemo, useState } from "react";
import { Chip, Panel, Row, Stack } from "../../primitives/index.ts";
import { buildHistory, HISTORY_RANGES, type HistoryRange } from "../../../models/history.ts";
import { CHART_BOX, chartShape } from "./chart.ts";
import styles from "./Home.module.css";

/**
 * The collection's shape over time.
 *
 * Printings owned, NOT value over time. The app only ever knows today's prices,
 * so a value line would be a curve that never happened — `models/history.ts`
 * makes that argument at length and this screen is not the place to relitigate
 * it. The value panel beside it is the money; this is the growth.
 *
 * Inline SVG rather than a charting library. One series, one shape, and the
 * geometry is already written and asserted in the model layer.
 */
export function GrowthChart({ stamps }: { stamps: number[] }) {
  const [range, setRange] = useState<HistoryRange>("90d");

  const history = useMemo(() => buildHistory(stamps, range), [stamps, range]);
  const shape = useMemo(() => chartShape(history.points), [history.points]);

  const rangeLabel = HISTORY_RANGES.find((r) => r.key === range)?.label ?? "";
  const { endTotal, added, undated } = history;

  return (
    <Panel title="Printings owned" headingLevel={2}>
      <Stack gap={3}>
        <p className={styles.hero}>
          {endTotal.toLocaleString()}{" "}
          <span className={styles.delta}>
            {added > 0 ? `+${added.toLocaleString()} in ${rangeLabel}` : `no change in ${rangeLabel}`}
          </span>
        </p>

        {/*
          Real buttons with a real pressed state, inside the body rather than the
          panel header: four of them beside a heading do not fit at 390 and the
          header does not wrap.
        */}
        <div role="group" aria-label="Time range">
          <Row gap={2} wrap>
            {HISTORY_RANGES.map((r) => (
              <Chip key={r.key} onPress={() => setRange(r.key)} pressed={r.key === range}>
                {r.label}
              </Chip>
            ))}
          </Row>
        </div>

        <div className={styles.plot}>
          <svg
            viewBox={`0 0 ${CHART_BOX.width} ${CHART_BOX.height}`}
            className={styles.svg}
            role="img"
            aria-label={`${endTotal} printings owned, ${added} added in the last ${rangeLabel}`}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="v2-home-growth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" className={styles.fillTop} />
                <stop offset="100%" className={styles.fillBottom} />
              </linearGradient>
            </defs>
            {/*
              A flat window is drawn CENTRED, not along the bottom. The bottom of
              a chart is where zero lives, so a steady collection drawn there
              reads as "you have nothing" — see graphGeometry in
              models/history.ts, which is where that is decided and asserted.
            */}
            <path d={shape.area} fill="url(#v2-home-growth)" />
            <path d={shape.line} className={styles.chartLine} fill="none" />
          </svg>
        </div>

        {/* Dates move with the calendar, so they are excluded from snapshots. */}
        <div className={styles.axis} aria-hidden="true" data-snapshot="volatile">
          {shape.ticks.map((p, i) => (
            <span key={`${p.t}-${i}`}>{formatDay(p.t)}</span>
          ))}
        </div>

        {undated > 0 ? (
          <p className={styles.note}>
            {undated.toLocaleString()} older {undated === 1 ? "printing has" : "printings have"} no date and
            count from the start of the window.
          </p>
        ) : null}
      </Stack>
    </Panel>
  );
}

function formatDay(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
