import { formatPct } from "./movement.ts";

/**
 * "Since you last looked": what Home saw on this device's previous visit, and
 * how today compares with it (#110).
 *
 * Device-local on purpose. It is one small object in one localStorage key, not
 * synced, not part of the collection OR-Set, binders or any cache, so nothing
 * here can touch a merge rule. Losing it costs one comparison: the next visit
 * simply has no baseline and says nothing.
 *
 * The longer-term value history (#111/#112) is a separate decision and a
 * separate store; this does not wait for it.
 */
export interface LookSnapshot {
  /** Epoch ms when Home settled. */
  at: number;
  /** The headline total, in `currency`. Only priced printings contribute. */
  total: number;
  /** Cards held (distinct cards, as Home's header counts them). */
  cards: number;
  /** Of `printings`, how many had a price. */
  priced: number;
  /** Printings held. */
  printings: number;
  /** The total's currency. Two snapshots in different currencies are never compared. */
  currency: string;
}

export interface LastLookState {
  v: 1;
  /**
   * The snapshot from before the current visit: the baseline every load in
   * this visit compares against, so a reload does not erase the comparison.
   */
  previous: LookSnapshot | null;
  /** The newest snapshot, from this visit. */
  latest: LookSnapshot;
}

/**
 * Loads closer together than this are one visit. Rolling: every settled Home
 * load extends it, so navigating away and back, or reloading, keeps showing
 * the change since the visit before rather than "no change" against itself.
 * A judgement, not a measurement.
 */
export const VISIT_GAP_MS = 30 * 60_000;

/**
 * Coverage (priced / printings) may move this far between the two snapshots
 * before the percentage stops meaning anything. Past it, a rise in the total is
 * mostly "more of the collection got a price", so the line says that instead.
 */
export const COVERAGE_TOLERANCE = 0.05;

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** One snapshot, or null when anything about it is off. Unknown fields are dropped. */
export function parseSnapshot(raw: unknown): LookSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { at, total, cards, priced, printings, currency } = r;
  if (!isCount(at) || !isCount(total) || !isCount(cards) || !isCount(priced) || !isCount(printings))
    return null;
  if (typeof currency !== "string" || currency.length === 0) return null;
  if (priced > printings) return null;
  return { at, total, cards, priced, printings, currency };
}

/**
 * The stored state, read corruption-safe: anything malformed is "no baseline",
 * never a throw. A corrupt `previous` alone costs only the baseline, and the
 * latest snapshot is kept. A version this code does not know is refused rather
 * than guessed at.
 */
export function parseLastLook(raw: unknown): LastLookState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const latest = parseSnapshot(r.latest);
  if (!latest) return null;
  return { v: 1, previous: parseSnapshot(r.previous), latest };
}

/**
 * Fold a settled Home load into the stored state.
 *
 * Returns the snapshot to compare against and the state to write back. A load
 * within `VISIT_GAP_MS` of the last one belongs to the same visit and keeps its
 * baseline; anything later (or a clock that ran backwards) starts a new visit,
 * whose baseline is the last thing the previous one saw.
 */
export function recordLook(
  state: LastLookState | null,
  current: LookSnapshot,
  now: number,
): { baseline: LookSnapshot | null; next: LastLookState } {
  if (!state) return { baseline: null, next: { v: 1, previous: null, latest: current } };
  const since = now - state.latest.at;
  const sameVisit = since >= 0 && since < VISIT_GAP_MS;
  const baseline = sameVisit ? state.previous : state.latest;
  return { baseline, next: { v: 1, previous: baseline, latest: current } };
}

export interface SinceLastLooked {
  /** "+3.2% · +12 cards", "150 more priced", or "No change". */
  text: string;
  /** "2 days ago", for the label. */
  ago: string;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function coverage(s: LookSnapshot): number {
  return s.printings > 0 ? s.priced / s.printings : 0;
}

/**
 * What changed, in words. Null on a first visit: there is nothing to compare
 * with, and an invented baseline would be a lie.
 *
 * Percent only, never an amount, and only between snapshots in the same
 * currency with comparable coverage. When nothing is priced now, the price part
 * is left out entirely: that is a pricing failure the panel already reports,
 * not a collection that lost its value.
 */
export function compareLook(
  baseline: LookSnapshot | null,
  current: LookSnapshot,
  now: number,
): SinceLastLooked | null {
  if (!baseline) return null;
  const parts: string[] = [];

  if (current.priced > 0 && baseline.currency === current.currency) {
    const comparable =
      baseline.priced > 0 &&
      baseline.total > 0 &&
      Math.abs(coverage(current) - coverage(baseline)) <= COVERAGE_TOLERANCE;
    if (comparable) {
      const pct = ((current.total - baseline.total) / baseline.total) * 100;
      if (Math.abs(pct) >= 0.05) parts.push(formatPct(pct));
    } else {
      const more = current.priced - baseline.priced;
      if (more !== 0) parts.push(`${Math.abs(more)} ${more > 0 ? "more" : "fewer"} priced`);
    }
  }

  const cards = current.cards - baseline.cards;
  if (cards !== 0) parts.push(`${signed(cards)} ${Math.abs(cards) === 1 ? "card" : "cards"}`);

  return { text: parts.length > 0 ? parts.join(" · ") : "No change", ago: lookedAgo(baseline.at, now) };
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** A coarse relative time. The comparison is about days, not minutes. */
export function lookedAgo(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < HOUR) return "under an hour ago";
  if (d < DAY) {
    const h = Math.floor(d / HOUR);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(d / DAY);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}
