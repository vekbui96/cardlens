import { useMemo, useState } from "react";
import { axisTicks, buildHistory, HISTORY_RANGES, type HistoryRange } from "../models/history.ts";
import styles from "./CollectionGraph.module.css";

/**
 * Printings owned over time.
 *
 * Deliberately NOT collection value over time: the app only ever knows today's
 * prices, so a value line would be a curve that never happened. Counting
 * printings is a claim the data can actually support.
 *
 * Inline SVG rather than a charting library — one series, one shape, and a
 * dependency would cost more than the forty lines it replaces on a bundle that
 * ships to a pair of glasses.
 */

const W = 600;
const H = 160;
const PAD = { top: 16, right: 10, bottom: 20, left: 4 };

function formatDay(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CollectionGraph({
  stamps,
  title = "Printings owned",
}: {
  /** One timestamp per owned printing — see models/history.ts. */
  stamps: number[];
  title?: string;
}) {
  const [range, setRange] = useState<HistoryRange>("90d");
  const [hover, setHover] = useState<number | null>(null);

  const history = useMemo(() => buildHistory(stamps, range), [stamps, range]);
  const { points, endTotal, added, undated } = history;

  const geom = useMemo(() => {
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const max = Math.max(1, ...points.map((p) => p.total));
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const x = (t: number) => PAD.left + ((t - t0) / span) * innerW;
    // Floor at the window's starting total rather than at zero: a collection
    // that grew 1140 -> 1145 should read as a gentle rise, not a flat line
    // pinned to the top of a chart whose axis starts at nothing.
    const floor = Math.min(...points.map((p) => p.total));
    const range = Math.max(1, max - floor);
    const y = (v: number) => PAD.top + innerH - ((v - floor) / range) * innerH;

    return { x, y, t0, t1, max, floor, baseline: PAD.top + innerH };
  }, [points]);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${geom.x(p.t)},${geom.y(p.total)}`).join(" ");
  const area = `${line} L${geom.x(points[points.length - 1].t)},${geom.baseline} L${geom.x(points[0].t)},${geom.baseline} Z`;

  const active = hover === null ? null : points[Math.min(hover, points.length - 1)];

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.head}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          {/* The headline is the number; the chart is its shape. */}
          <p className={styles.hero}>
            {endTotal.toLocaleString()}
            <span className={styles.delta}>
              {added > 0 ? `+${added.toLocaleString()} this period` : "no change this period"}
            </span>
          </p>
        </div>
        <div className={styles.ranges} role="group" aria-label="Time range">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`${styles.range} ${r.key === range ? styles.rangeOn : ""}`}
              aria-pressed={r.key === range}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </figcaption>

      <div className={styles.plot}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          role="img"
          aria-label={`${endTotal} printings owned, ${added} added in the last ${
            HISTORY_RANGES.find((r) => r.key === range)?.label
          }`}
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - box.left) / box.width;
            const t = geom.t0 + ratio * (geom.t1 - geom.t0);
            // Nearest point, not the one to the left: the crosshair should snap
            // to what the reader is pointing at.
            let best = 0;
            for (let i = 1; i < points.length; i++) {
              if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
            }
            setHover(best);
          }}
        >
          <defs>
            <linearGradient id="cl-graph-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={styles.fillTop} />
              <stop offset="100%" className={styles.fillBottom} />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#cl-graph-fill)" />
          <path d={line} className={styles.line} fill="none" />
          {active ? (
            <g>
              <line
                x1={geom.x(active.t)}
                x2={geom.x(active.t)}
                y1={PAD.top}
                y2={geom.baseline}
                className={styles.crosshair}
              />
              {/* Ring in the surface colour so the dot reads against the fill. */}
              <circle cx={geom.x(active.t)} cy={geom.y(active.total)} r="5" className={styles.dot} />
            </g>
          ) : null}
        </svg>

        {active ? (
          <p className={styles.tooltip} role="status">
            <strong>{active.total.toLocaleString()}</strong> on {formatDay(active.t)}
          </p>
        ) : null}
      </div>

      <div className={styles.axis} aria-hidden="true">
        {axisTicks(points).map((p, i) => (
          <span key={`${p.t}-${i}`}>{formatDay(p.t)}</span>
        ))}
      </div>

      {undated > 0 ? (
        <p className={styles.note}>
          {undated.toLocaleString()} older {undated === 1 ? "printing has" : "printings have"} no date and
          count from the start.
        </p>
      ) : null}
    </figure>
  );
}
