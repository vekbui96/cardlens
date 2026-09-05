import { axisTicks, graphGeometry, type GraphBox, type HistoryPoint } from "../../../models/history.ts";

/**
 * The growth series, as SVG path data.
 *
 * `graphGeometry` in `models/history.ts` owns the mapping; this owns the two
 * strings drawn from it, and exists as its own module for one reason: the flat
 * case has to be assertable. A window where nothing changed used to draw along
 * the very bottom edge — which is where a chart puts zero — so 973 printings
 * held steady for ninety days rendered as "you have nothing", in the largest
 * element on Home. `graphGeometry` centres a flat series; this checks that what
 * actually reaches the `d` attribute is centred too.
 */

/**
 * The viewBox. Unitless SVG user space, stretched to the container by
 * `preserveAspectRatio="none"` — these are not lengths on the page, so they are
 * not tokens and must not become them.
 */
export const CHART_BOX: GraphBox = {
  width: 600,
  height: 180,
  pad: { top: 14, right: 6, bottom: 6, left: 6 },
};

export interface ChartShape {
  /** `d` for the line. */
  line: string;
  /** `d` for the filled area beneath it. */
  area: string;
  /** Nothing changed across the window. */
  flat: boolean;
  /** The y the series sits at when flat — the vertical centre, never the floor. */
  midline: number;
  baseline: number;
  ticks: HistoryPoint[];
}

/** Two decimals: enough for a 600-unit box, short enough to read in a diff. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

export function chartShape(points: HistoryPoint[], box: GraphBox = CHART_BOX): ChartShape {
  const geom = graphGeometry(points, box);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${n(geom.x(p.t))},${n(geom.y(p.total))}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L${n(geom.x(last.t))},${n(geom.baseline)} L${n(geom.x(first.t))},${n(geom.baseline)} Z`;

  return {
    line,
    area,
    flat: geom.flat,
    midline: n(box.pad.top + (box.height - box.pad.top - box.pad.bottom) / 2),
    baseline: n(geom.baseline),
    ticks: axisTicks(points),
  };
}

/** Every y in a path's `d`, for tests and for nothing else. */
export function pathYs(d: string): number[] {
  return [...d.matchAll(/[ML]-?[\d.]+,(-?[\d.]+)/g)].map((m) => Number(m[1]));
}
