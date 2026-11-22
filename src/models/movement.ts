/**
 * Rolling averages for one holding, in EUR (Cardmarket).
 *
 * Kept separate from the USD price everywhere: these two currencies must never
 * meet in a sum. Movement is reported as a percentage precisely because a
 * percentage is currency-free, so the EUR series can describe a USD-valued
 * portfolio without either being converted.
 */
export interface EurAverages {
  avg1: number;
  avg7: number;
  avg30: number;
}

export interface Movement {
  /** Percent change over the window, or undefined when it cannot be computed. */
  pct7?: number;
  pct30?: number;
  /** Holdings that contributed. Below `MIN_HOLDINGS` no percentage is reported. */
  contributing: number;
}

/**
 * Below this many holdings, rounding noise dominates and no figure is reported.
 *
 * Cardmarket rounds to the cent and most of this catalogue trades at EUR
 * 0.02-0.04, so one card's week-on-week change is a single rounding step
 * reported as ±33% or ±50% — measured on real cards, not assumed. Summing many
 * holdings cancels most of that: the error grows with the square root of the
 * count while the total grows linearly, so at a few hundred rows the residual
 * is a fraction of a percent.
 *
 * 25 is a judgement, not a measurement: it is roughly where the expected
 * rounding error drops under about 2% of a small-card total.
 */
export const MIN_HOLDINGS = 25;

function pct(now: number, then: number): number | undefined {
  if (!(then > 0) || !Number.isFinite(now)) return undefined;
  return ((now - then) / then) * 100;
}

/**
 * Portfolio movement, aggregated across holdings.
 *
 * Deliberately has no per-card equivalent. A single card's percentage is
 * unusable at these prices, and offering one would put a precise-looking number
 * next to a card whose "50% drop" is one cent of rounding.
 */
export function aggregateMovement(series: (EurAverages | undefined)[]): Movement {
  let a1 = 0;
  let a7 = 0;
  let a30 = 0;
  let contributing = 0;

  for (const s of series) {
    if (!s) continue;
    a1 += s.avg1;
    a7 += s.avg7;
    a30 += s.avg30;
    contributing += 1;
  }

  if (contributing < MIN_HOLDINGS) return { contributing };
  return {
    ...(pct(a1, a7) !== undefined ? { pct7: pct(a1, a7) } : {}),
    ...(pct(a1, a30) !== undefined ? { pct30: pct(a1, a30) } : {}),
    contributing,
  };
}

/**
 * A card must average at least this many EUR, both over the last day and over
 * the last week, before its own percentage is shown.
 *
 * `MIN_HOLDINGS` above explains why a single cheap card has no honest figure:
 * one cent on EUR 0.03 reads as ±33%. At EUR 1.00 one cent is at most 1%, so
 * what is left is a real move. A judgement, not a measurement.
 */
export const MOVER_FLOOR_EUR = 1;
/** Rows shown on each side of the Biggest movers strip. */
export const MOVERS_PER_SIDE = 3;
/** A side with fewer qualifying cards than this shows nothing. */
export const MIN_MOVERS_PER_SIDE = 2;

/** Days the Biggest movers strip compares avg1 against: avg7 or avg30. */
export type MoverWindow = 7 | 30;

export interface Mover<T> {
  row: T;
  /** Week-on-week change in percent (avg1 against avg7). Never an amount. */
  pct: number;
}

export interface TopMovers<T> {
  risers: Mover<T>[];
  fallers: Mover<T>[];
}

/**
 * The owned printings that moved most this week, as percentages.
 *
 * The per-card counterpart `aggregateMovement` deliberately lacks, made safe by
 * a floor instead of an aggregate: only printings whose avg1 and avg7 are both
 * at least `MOVER_FLOOR_EUR` qualify, so a rounding step cannot rank. EUR values
 * are read here and never returned, so they cannot reach the screen or be added
 * to the USD total. Ties keep the input order.
 */
export function topMovers<T extends { eur?: EurAverages }>(rows: T[], window: MoverWindow = 7): TopMovers<T> {
  const ranked: Mover<T>[] = [];
  for (const row of rows) {
    const eur = row.eur;
    if (!eur) continue;
    const reference = window === 30 ? eur.avg30 : eur.avg7;
    if (!(eur.avg1 >= MOVER_FLOOR_EUR) || !(reference >= MOVER_FLOOR_EUR)) continue;
    const change = pct(eur.avg1, reference);
    if (change === undefined) continue;
    ranked.push({ row, pct: change });
  }
  const side = (movers: Mover<T>[]) =>
    movers.length < MIN_MOVERS_PER_SIDE ? [] : movers.slice(0, MOVERS_PER_SIDE);
  return {
    // 0.05 is where formatPct stops printing a sign: a "+0.0%" is not a mover.
    risers: side(ranked.filter((m) => m.pct >= 0.05).sort((a, b) => b.pct - a.pct)),
    fallers: side(ranked.filter((m) => m.pct <= -0.05).sort((a, b) => a.pct - b.pct)),
  };
}

/**
 * One printing's week-on-week change in percent (avg1 against avg7), or
 * undefined when it has no averages or either is under `MOVER_FLOOR_EUR`.
 * The same floor as `topMovers`, so a rounding step never reads as a move.
 */
export function weekChangePct(eur: EurAverages | undefined): number | undefined {
  if (!eur) return undefined;
  if (!(eur.avg1 >= MOVER_FLOOR_EUR) || !(eur.avg7 >= MOVER_FLOOR_EUR)) return undefined;
  return pct(eur.avg1, eur.avg7);
}

/** "+3.2%" / "−1.8%" / "0.0%". Uses a real minus sign, not a hyphen. */
export function formatPct(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}
