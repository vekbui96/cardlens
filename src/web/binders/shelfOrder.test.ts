import { describe, expect, it } from "vitest";
import { formatEdited } from "./shelfOrder.ts";

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatEdited", () => {
  it("reads in the coarsest sensible unit", () => {
    expect(formatEdited(NOW - 20_000, NOW)).toBe("Edited just now");
    expect(formatEdited(NOW - 5 * MIN, NOW)).toBe("Edited 5m ago");
    expect(formatEdited(NOW - 3 * HOUR, NOW)).toBe("Edited 3h ago");
    expect(formatEdited(NOW - 3 * DAY, NOW)).toBe("Edited 3d ago");
  });

  it("falls back to a date after a month, and to nothing for a bad stamp", () => {
    expect(formatEdited(NOW - 90 * DAY, NOW)).toMatch(/^Edited [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(formatEdited(0, NOW)).toBe("");
    expect(formatEdited(Number.NaN, NOW)).toBe("");
  });
});
