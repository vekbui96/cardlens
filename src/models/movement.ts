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

/** "+3.2%" / "−1.8%" / "0.0%". Uses a real minus sign, not a hyphen. */
export function formatPct(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}
