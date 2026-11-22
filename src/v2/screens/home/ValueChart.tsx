import { useMemo, useState } from "react";
import { Chip, Panel, Row, Stack, cx } from "../../primitives/index.ts";
import { graphGeometry } from "../../../models/history.ts";
import {
  buildValueSeries,
  coverageLine,
  localToday,
  VALUE_RANGES,
  type ValuePoint,
  type ValueRange,
} from "../../../models/valueHistory.ts";
import { useValueHistory, type ValueHistoryState } from "../../../hooks/useValueHistory.ts";
import { formatUsd } from "../../../utils/format.ts";
import { CHART_BOX } from "./chart.ts";
import styles from "./Home.module.css";

/**
 * The value panel's past (#117): what the collection was worth on each day the
 * server wrote down, beside the growth chart.
 *
 * The request lives in `useValueHistory`, outside this directory, so Home still
 * opens nothing of its own (see `homeSummary.test.ts`).
 */
export function ValueHistoryPanel() {
  const state = useValueHistory();
  return <ValueChart state={state} />;
}

/**
 * Drawn from whatever the history hook says, so every state can be rendered in
 * a test without a server.
 *
 * Gaps are gaps: the series builder splits the line at every day with no row,
 * nothing priced, or another currency, and each run is its own path. A day on
 * its own is a dot. Every value shown carries its coverage, so a day priced from
 * half the collection is never mistaken for the whole of it.
 */
export function ValueChart({ state, today }: { state: ValueHistoryState; today?: string }) {
  const [range, setRange] = useState<ValueRange>("30d");
  const [picked, setPicked] = useState<string | null>(null);

  const day = today ?? localToday();
  const rows = state.status === "ready" ? state.rows : null;
  const series = useMemo(() => (rows ? buildValueSeries(rows, range, day) : null), [rows, range, day]);

  // A failed or unreadable history leaves Home exactly as it was.
  if (state.status === "hidden") return null;

  if (state.status === "off") {
    return (
      <Panel title="Value over time" headingLevel={2}>
        <p className={styles.note}>
          Daily values are kept on your CardLens server. Connect this device in Settings to see how the total
          has moved.
        </p>
      </Panel>
    );
  }

  const selected = series ? (series.points.find((p) => p.day === picked) ?? series.latest) : null;
  const rangeLabel = VALUE_RANGES.find((r) => r.key === range)?.label ?? "";

  return (
    <Panel title="Value over time" headingLevel={2}>
      <Stack gap={3}>
        <div role="group" aria-label="Value range">
          <Row gap={2} wrap>
            {VALUE_RANGES.map((r) => (
              <Chip key={r.key} onPress={() => setRange(r.key)} pressed={r.key === range}>
                {r.label}
              </Chip>
            ))}
          </Row>
        </div>

        {/* One box for every state, so nothing below it moves when the rows arrive. */}
        <div className={cx(styles.plot, styles.valuePlot)}>
          {state.status === "loading" ? (
            <div className={styles.plotSkeleton} aria-label="Loading value history" role="status" />
          ) : rows && rows.length === 0 ? (
            <p className={styles.plotMessage}>Value tracking starts today: first point saved</p>
          ) : series && series.points.length === 0 ? (
            <p className={styles.plotMessage}>No priced days in the last {rangeLabel}.</p>
          ) : series && selected ? (
            <Plot
              points={series.points}
              segments={series.segments}
              days={series.days}
              min={series.min}
              max={series.max}
              selected={selected}
              onPick={(p) => setPicked(p.day)}
              rangeLabel={rangeLabel}
            />
          ) : null}
        </div>

        <div className={styles.axis} aria-hidden="true">
          <span data-snapshot="volatile">{series ? formatDay(series.start) : ""}</span>
          <span />
          <span>Today</span>
        </div>

        {selected ? (
          <p className={styles.valueReadout} aria-live="polite">
            <span data-snapshot="volatile">{formatDay(selected.day)}</span>:{" "}
            <span className={styles.valueAmount}>{formatUsd(selected.total)}</span> · {coverageLine(selected)}
          </p>
        ) : (
          // Reserves the readout's line so the panel keeps its height.
          <p className={styles.valueReadout} aria-hidden="true">
            &nbsp;
          </p>
        )}
      </Stack>
    </Panel>
  );
}

function Plot({
  points,
  segments,
  days,
  min,
  max,
  selected,
  onPick,
  rangeLabel,
}: {
  points: ValuePoint[];
  segments: ValuePoint[][];
  days: number;
  min: number;
  max: number;
  selected: ValuePoint;
  onPick: (p: ValuePoint) => void;
  rangeLabel: string;
}) {
  // The window's ends on x and the lowest/highest value on y, through the same
  // mapping the growth chart uses — including its rule that a flat series sits
  // in the middle of the box, never on the floor where zero would be.
  const geom = graphGeometry(
    [
      { t: 0, total: min },
      { t: Math.max(1, days - 1), total: max },
    ],
    CHART_BOX,
  );
  const x = (p: ValuePoint) => round(geom.x(p.index));
  const y = (p: ValuePoint) => round(geom.y(p.total));
  const lines = segments
    .filter((s) => s.length > 1)
    .map((s) => s.map((p, i) => `${i === 0 ? "M" : "L"}${x(p)},${y(p)}`).join(" "));
  const alone = new Set(segments.filter((s) => s.length === 1).map((s) => s[0].day));

  return (
    <>
      <svg
        viewBox={`0 0 ${CHART_BOX.width} ${CHART_BOX.height}`}
        className={styles.svg}
        role="img"
        aria-label={`Collection value over the last ${rangeLabel}: ${points.length} ${points.length === 1 ? "day" : "days"} recorded`}
        preserveAspectRatio="none"
      >
        {lines.map((d) => (
          <path key={d} d={d} className={styles.chartLine} fill="none" />
        ))}
      </svg>
      {/*
        The points are HTML over the stretched SVG rather than SVG circles: the
        viewBox is squashed to the box with `preserveAspectRatio="none"`, which
        would turn a circle into an ellipse, and a real button is what a tap and
        a keyboard both need anyway.
      */}
      <div className={styles.valuePoints}>
        {points.map((p) => (
          <button
            key={p.day}
            type="button"
            className={cx(
              styles.valuePoint,
              (alone.has(p.day) || p.day === selected.day) && styles.valuePointShown,
            )}
            style={{
              left: `${(x(p) / CHART_BOX.width) * 100}%`,
              top: `${(y(p) / CHART_BOX.height) * 100}%`,
            }}
            aria-pressed={p.day === selected.day}
            aria-label={`${formatDay(p.day)}: ${formatUsd(p.total)}, ${coverageLine(p)}`}
            onClick={() => onPick(p)}
          >
            <span className={styles.valueDot} />
          </button>
        ))}
      </div>
    </>
  );
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** "Nov 21" for a server day. Noon local, so no time zone can move it to the 20th. */
function formatDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
