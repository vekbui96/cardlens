/**
 * Collection value over time (#117), as the client reads it.
 *
 * The server writes one row a day (#112, `server/valueHistory.ts`, decision in
 * `docs/decisions/value-history.md`) and hands the whole file out through
 * `GET /api/value-history`. This is the read side: a parser that trusts
 * nothing it is given, and a pure series builder for the Home chart.
 *
 * Not imported from the server module on purpose: that file is compiled by the
 * server (`tsconfig.node.json`), and a client import of it would pull server
 * code into the bundle. The shape is small and versioned; a version this code
 * does not know is "no history", never a guess.
 *
 * ## The rules the chart is built on
 *
 * - A day with no row is a GAP. So is a day where nothing was priced
 *   (`priced: 0`): its total is not zero, it is unknown. A gap is never bridged
 *   or interpolated — the line breaks there, because a line drawn across a day
 *   nobody measured is a value that never happened.
 * - One currency per line. A row in another currency than the one the chart is
 *   drawn in is dropped and leaves a gap, rather than being plotted on the same
 *   axis as a figure it cannot be compared with.
 * - Every point carries its coverage, so a day priced from half the collection
 *   can never be shown without saying so.
 */

export const VALUE_HISTORY_VERSION = 1;
/** Home's total is TCGplayer market USD, and so is every row the server writes. */
export const VALUE_CURRENCY = "USD";

export interface ValueRow {
  /** Server-local calendar day, `YYYY-MM-DD`. */
  day: string;
  total: number;
  priced: number;
  printings: number;
  currency: string;
}

export type ValueRange = "7d" | "30d" | "90d";

export const VALUE_RANGES: { key: ValueRange; label: string; days: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
];

export interface ValuePoint {
  day: string;
  /** Days since the window opened: 0 is the first day, `days - 1` is today. */
  index: number;
  total: number;
  priced: number;
  printings: number;
}

export interface ValueSeries {
  /** Days in the window, today included. */
  days: number;
  /** First day of the window, `YYYY-MM-DD`. */
  start: string;
  /** Every plottable point, oldest first. */
  points: ValuePoint[];
  /** Runs of consecutive plottable days. A gap ends one and starts the next. */
  segments: ValuePoint[][];
  /** The newest plottable point in the window, or null when there is none. */
  latest: ValuePoint | null;
  /** Lowest and highest total plotted (equal when one value, 0/0 when none). */
  min: number;
  max: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60_000;

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Days since the epoch for a `YYYY-MM-DD`, or NaN. Calendar arithmetic, no time zones. */
function dayNumber(day: string): number {
  if (!DAY_RE.test(day)) return NaN;
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // Date.UTC rolls 2026-02-31 over into March; a day that does not exist is not a day.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
  return Math.round(t / DAY_MS);
}

function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Today on this device's calendar, `YYYY-MM-DD` — the same local-day rule the server writes with. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The response body, or null when it is not a history this code can read.
 *
 * Null means "no history" to the caller, and Home stays as it is: a version
 * from the future or a malformed body is partial success, not an error panel.
 * Individual rows that are off are dropped; the rest are kept.
 */
export function parseValueHistory(raw: unknown): ValueRow[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { version, rows } = raw as Record<string, unknown>;
  if (version !== VALUE_HISTORY_VERSION || !Array.isArray(rows)) return null;

  const out: ValueRow[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const { day, total, priced, printings, currency } = r as Record<string, unknown>;
    if (typeof day !== "string" || Number.isNaN(dayNumber(day))) continue;
    if (!isCount(total) || !isCount(priced) || !isCount(printings)) continue;
    if (priced > printings) continue;
    if (typeof currency !== "string" || currency.length === 0) continue;
    out.push({ day, total, priced, printings, currency });
  }
  return out;
}

/**
 * The points to draw for a window ending today.
 *
 * `today` is passed in rather than read so the window can be asserted. Rows
 * outside the window, in another currency, or with nothing priced are left out;
 * a day with two rows keeps the later one in the list (the server writes one).
 */
export function buildValueSeries(
  rows: ValueRow[],
  range: ValueRange,
  today: string,
  currency: string = VALUE_CURRENCY,
): ValueSeries {
  const days = VALUE_RANGES.find((r) => r.key === range)?.days ?? 30;
  const end = dayNumber(today);
  const first = end - (days - 1);

  const byIndex = new Map<number, ValuePoint>();
  for (const row of rows) {
    if (row.currency !== currency) continue;
    if (row.priced <= 0) continue;
    const n = dayNumber(row.day);
    if (Number.isNaN(n) || n < first || n > end) continue;
    const index = n - first;
    byIndex.set(index, {
      day: row.day,
      index,
      total: row.total,
      priced: row.priced,
      printings: row.printings,
    });
  }

  const points = [...byIndex.values()].sort((a, b) => a.index - b.index);
  const segments: ValuePoint[][] = [];
  for (const p of points) {
    const current = segments[segments.length - 1];
    const prev = current?.[current.length - 1];
    if (prev && p.index === prev.index + 1) current.push(p);
    else segments.push([p]);
  }

  const totals = points.map((p) => p.total);
  return {
    days,
    start: Number.isNaN(first) ? today : dayString(first),
    points,
    segments,
    latest: points[points.length - 1] ?? null,
    min: totals.length ? Math.min(...totals) : 0,
    max: totals.length ? Math.max(...totals) : 0,
  };
}

/** "412 of 480 printings priced" — the coverage that goes with every value shown. */
export function coverageLine(point: Pick<ValuePoint, "priced" | "printings">): string {
  if (point.priced >= point.printings) return `All ${point.printings.toLocaleString()} printings priced`;
  return `${point.priced.toLocaleString()} of ${point.printings.toLocaleString()} printings priced`;
}
