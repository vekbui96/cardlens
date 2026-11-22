import { describe, expect, it } from "vitest";
import {
  VISIT_GAP_MS,
  compareLook,
  lookedAgo,
  parseLastLook,
  recordLook,
  type LookSnapshot,
} from "./lastLook.ts";

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

function snap(over: Partial<LookSnapshot> = {}): LookSnapshot {
  return { at: NOW, total: 1000, cards: 400, priced: 450, printings: 480, currency: "USD", ...over };
}

describe("compareLook", () => {
  it("says nothing on the first visit — no invented baseline", () => {
    expect(compareLook(null, snap(), NOW)).toBeNull();
  });

  it("reports the percentage and the card delta", () => {
    const r = compareLook(
      snap({ at: NOW - 2 * DAY }),
      snap({ total: 1032, cards: 412, priced: 462, printings: 492 }),
      NOW,
    );
    expect(r?.text).toBe("+3.2% · +12 cards");
    expect(r?.ago).toBe("2 days ago");
  });

  it("uses the minus sign and singular for a fall of one card", () => {
    const r = compareLook(snap({ at: NOW - DAY }), snap({ total: 950, cards: 399 }), NOW);
    expect(r?.text).toBe("−5.0% · −1 card");
  });

  it("says no change when nothing moved", () => {
    expect(compareLook(snap({ at: NOW - DAY }), snap({ total: 1000.2 }), NOW)?.text).toBe("No change");
  });

  it("skips the percentage when coverage moved too far, and says how many more are priced", () => {
    // 300 of 480 priced, now 450 of 480: the total rose because more was priced,
    // not because anything is worth more.
    const r = compareLook(snap({ at: NOW - DAY, total: 600, priced: 300 }), snap(), NOW);
    expect(r?.text).toBe("150 more priced");
  });

  it("says fewer priced when coverage fell, without a percentage", () => {
    const r = compareLook(snap({ at: NOW - DAY }), snap({ total: 700, priced: 300 }), NOW);
    expect(r?.text).toBe("150 fewer priced");
  });

  it("never compares across currencies", () => {
    const r = compareLook(snap({ at: NOW - DAY, currency: "EUR", total: 500 }), snap({ cards: 401 }), NOW);
    expect(r?.text).toBe("+1 card");
  });

  it("leaves price out when nothing is priced now (a pricing failure, not a loss)", () => {
    const r = compareLook(snap({ at: NOW - DAY }), snap({ total: 0, priced: 0, cards: 403 }), NOW);
    expect(r?.text).toBe("+3 cards");
  });

  it("compares cards alone against an unpriced baseline", () => {
    const r = compareLook(
      snap({ at: NOW - DAY, total: 0, priced: 0, cards: 2, printings: 2 }),
      snap({ total: 0, priced: 0, cards: 5, printings: 5 }),
      NOW,
    );
    expect(r?.text).toBe("+3 cards");
  });
});

describe("recordLook", () => {
  it("first visit: no baseline, stores the current snapshot", () => {
    const { baseline, next } = recordLook(null, snap(), NOW);
    expect(baseline).toBeNull();
    expect(next).toEqual({ v: 1, previous: null, latest: snap() });
  });

  it("a new visit compares with the last one and shifts it to previous", () => {
    const old = snap({ at: NOW - DAY, total: 900 });
    const { baseline, next } = recordLook({ v: 1, previous: null, latest: old }, snap(), NOW);
    expect(baseline).toEqual(old);
    expect(next).toEqual({ v: 1, previous: old, latest: snap() });
  });

  it("a reload within the same visit keeps the earlier baseline", () => {
    const before = snap({ at: NOW - DAY, total: 900 });
    const first = recordLook({ v: 1, previous: null, latest: before }, snap({ at: NOW }), NOW);
    const later = NOW + VISIT_GAP_MS - 1;
    const reload = recordLook(first.next, snap({ at: later }), later);
    expect(reload.baseline).toEqual(before);
    expect(compareLook(reload.baseline, snap({ at: later }), later)?.text).toBe("+11.1%");
  });

  it("a clock that went backwards starts a new visit rather than trusting it", () => {
    const future = snap({ at: NOW + DAY });
    expect(recordLook({ v: 1, previous: null, latest: future }, snap(), NOW).baseline).toEqual(future);
  });
});

describe("parseLastLook", () => {
  const good = { v: 1, previous: null, latest: snap() };

  it("round-trips a stored value", () => {
    expect(parseLastLook(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("drops unknown fields", () => {
    const parsed = parseLastLook({ ...good, extra: 1, latest: { ...snap(), junk: "x" } });
    expect(parsed).toEqual(good);
  });

  it.each([
    ["null", null],
    ["a string", "hello"],
    ["an array", []],
    ["a future version", { ...good, v: 2 }],
    ["a missing latest", { v: 1, previous: null }],
    ["a negative total", { ...good, latest: snap({ total: -1 }) }],
    ["NaN cards", { ...good, latest: { ...snap(), cards: "12" } }],
    ["priced above printings", { ...good, latest: snap({ priced: 500, printings: 480 }) }],
  ])("reads %s as no baseline", (_name, raw) => {
    expect(parseLastLook(raw)).toBeNull();
  });

  it("keeps the latest when only previous is corrupt", () => {
    expect(parseLastLook({ v: 1, previous: { at: "x" }, latest: snap() })).toEqual(good);
  });
});

describe("lookedAgo", () => {
  it.each([
    [10 * 60_000, "under an hour ago"],
    [3 * 60 * 60_000, "3 hours ago"],
    [DAY + 1, "yesterday"],
    [5 * DAY, "5 days ago"],
    [60 * DAY, "8 weeks ago"],
  ])("%d ms -> %s", (delta, text) => {
    expect(lookedAgo(NOW - delta, NOW)).toBe(text);
  });
});
