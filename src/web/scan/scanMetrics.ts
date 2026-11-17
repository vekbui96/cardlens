import type { MetricEvent } from "../../models/metricsEvents.ts";

/**
 * What the scanner counts, as pure functions so the rules can be tested
 * without a camera.
 *
 * Two moments. When a capture SETTLES, the recogniser's own verdict — the
 * input to the auto-accept rate. When a batch is COMMITTED, what the reviewer
 * did with it — manual picks and corrections per batch. Counted separately
 * because a capture can be discarded before commit, and its verdict is still
 * a fact about the recogniser.
 */

export function scanOutcomeMetric(result: { confident: boolean; candidates: unknown[] }): MetricEvent {
  if (result.confident) return "scan.accepted";
  return result.candidates.length > 0 ? "scan.ambiguous" : "scan.unknown";
}

export interface CommittedRow {
  /** Will be filed. */
  kept: boolean;
  rejected: boolean;
  /** Named by hand through "Pick by set". */
  manual: boolean;
  /** The recogniser had been confident about this row. */
  confident: boolean;
  /** The row files candidate 0. */
  choseFirst: boolean;
}

/** The counts one commit adds. Zero counts are left out. */
export function scanBatchMetrics(rows: CommittedRow[]): [MetricEvent, number][] {
  const kept = rows.filter((r) => r.kept);
  const counts: [MetricEvent, number][] = [
    ["scan.batch", 1],
    ["scan.batch.cards", kept.length],
    ["scan.batch.rejected", rows.filter((r) => r.rejected).length],
    ["scan.manual_pick", kept.filter((r) => r.manual).length],
    // Confident, yet the reviewer filed something else: the false accepts the
    // gate exists to prevent, as seen by the only person who can spot them.
    ["scan.corrected", kept.filter((r) => r.confident && (r.manual || !r.choseFirst)).length],
  ];
  return counts.filter(([, n]) => n > 0);
}
