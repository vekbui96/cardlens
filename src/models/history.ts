/**
 * Collection growth over time.
 *
 * Every owned (card, finish) row already carries `at` — when it was marked — so
 * a growth curve needs no new storage and no new sync. What it is NOT is a
 * price history: the app only ever knows today's prices, so a "value over time"
 * line would be a curve that never happened. This counts printings, and the
 * chart says so.
 */

export type HistoryRange = "30d" | "90d" | "1y" | "all";

export const HISTORY_RANGES: { key: HistoryRange; label: string; days: number | null }[] = [
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "1y", label: "1 year", days: 365 },
  { key: "all", label: "All time", days: null },
];

export interface HistoryPoint {
  /** Epoch ms at the END of the day this point covers. */
  t: number;
  /** Printings owned in total by then — cumulative, never a daily count. */
  total: number;
}

export interface CollectionHistory {
  points: HistoryPoint[];
  /** Owned when the window opened. The curve starts here, not at zero. */
  startTotal: number;
  /** Owned now. */
  endTotal: number;
  /** Marked inside the window. */
  added: number;
  /**
   * Rows with no usable timestamp, folded into the starting total instead of
   * being plotted. Collection entries saved before per-printing rows existed
   * migrate with `at: 0`; drawn literally they would put a spike in 1970 and
   * squash every real point against the right edge.
   */
  undated: number;
}

const DAY_MS = 24 * 60 * 60_000;

/** Midnight-ish bucket key, so many marks on one day become one point. */
function dayEnd(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS + DAY_MS - 1;
}

/**
 * Build the cumulative series for a range.
 *
 * `stamps` is one entry per owned printing. Order does not matter.
 */
export function buildHistory(
  stamps: number[],
  range: HistoryRange = "all",
  now: number = Date.now(),
): CollectionHistory {
  const days = HISTORY_RANGES.find((r) => r.key === range)?.days ?? null;
  // A timestamp in the future is a clock-skewed device, not a prediction —
  // clamp rather than letting it stretch the axis past today.
  const usable = stamps.filter((t) => Number.isFinite(t) && t > 0).map((t) => Math.min(t, now));
  const undated = stamps.length - usable.length;

  const from = days === null ? Number.NEGATIVE_INFINITY : now - days * DAY_MS;

  // Everything already owned when the window opened, including undated rows.
  const startTotal = usable.filter((t) => t < from).length + undated;

  const inWindow = usable.filter((t) => t >= from).sort((a, b) => a - b);

  const byDay = new Map<number, number>();
  for (const t of inWindow) {
    const key = dayEnd(t);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  let running = startTotal;
  const points: HistoryPoint[] = [];

  // Anchor the line at the window's left edge so a flat month reads as flat
  // rather than as a single floating dot.
  const firstT = days === null ? (inWindow[0] ?? now) : from;
  points.push({ t: days === null ? dayEnd(firstT) - DAY_MS : firstT, total: running });

  for (const key of [...byDay.keys()].sort((a, b) => a - b)) {
    running += byDay.get(key) ?? 0;
    // Today's bucket ends tonight, which has not happened. Clamp, or the axis
    // runs into the future and the last segment slopes off the right edge.
    points.push({ t: Math.min(key, now), total: running });
  }

  // And at today, so the curve always reaches the right edge.
  if (points[points.length - 1].t < now) points.push({ t: now, total: running });

  return { points, startTotal, endTotal: running, added: inWindow.length, undated };
}

/** Ticks for the x axis: first, middle-ish and last, never one per point. */
export function axisTicks(points: HistoryPoint[]): HistoryPoint[] {
  if (points.length <= 2) return points;
  return [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
}
