import { describe, expect, it } from "vitest";
import { scanBatchMetrics, scanOutcomeMetric, type CommittedRow } from "./scanMetrics.ts";

const row = (over: Partial<CommittedRow> = {}): CommittedRow => ({
  kept: true,
  rejected: false,
  manual: false,
  confident: true,
  choseFirst: true,
  ...over,
});

describe("scanOutcomeMetric", () => {
  it("splits accepted, ambiguous and unknown", () => {
    expect(scanOutcomeMetric({ confident: true, candidates: [1] })).toBe("scan.accepted");
    expect(scanOutcomeMetric({ confident: false, candidates: [1, 2] })).toBe("scan.ambiguous");
    expect(scanOutcomeMetric({ confident: false, candidates: [] })).toBe("scan.unknown");
  });
});

describe("scanBatchMetrics", () => {
  it("counts a batch, its size, rejections, manual picks and corrections", () => {
    const counts = Object.fromEntries(
      scanBatchMetrics([
        row(), // accepted as-is
        row({ manual: true, confident: false, choseFirst: false }), // ambiguous, picked by hand
        row({ choseFirst: false }), // confident, but another candidate filed: a correction
        row({ manual: true }), // confident, overridden by hand: a correction AND a manual pick
        row({ kept: false, rejected: true }),
        row({ kept: false, confident: false, choseFirst: false }), // left unsure, not filed
      ]),
    );
    expect(counts).toEqual({
      "scan.batch": 1,
      "scan.batch.cards": 4,
      "scan.batch.rejected": 1,
      "scan.manual_pick": 2,
      "scan.corrected": 2,
    });
  });

  it("leaves zero counts out", () => {
    expect(scanBatchMetrics([row()])).toEqual([
      ["scan.batch", 1],
      ["scan.batch.cards", 1],
    ]);
  });
});
