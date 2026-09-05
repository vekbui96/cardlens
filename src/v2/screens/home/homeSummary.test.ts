import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../../../app/LibraryProvider.tsx";
import { buildHistory } from "../../../models/history.ts";
import { setTiers } from "../../../models/setCompletion.ts";
import type { SetValue } from "../../../models/value.ts";
import { CHART_BOX, chartShape, pathYs } from "./chart.ts";
import { completionFigure, pricingSummary, syncNotice, type PricingInput } from "./homeSummary.ts";

/**
 * The decisions, not the markup.
 *
 * Every case here is one where the screen has a plausible wrong answer that
 * looks completely fine until the collection is partial, the catalog is down,
 * or nothing has changed for three months.
 */

function set(setId: string, printings: number, priced: number, value = 0): SetValue {
  return { setId, printings, priced, value };
}

function input(over: Partial<PricingInput> = {}): PricingInput {
  return {
    printings: 973,
    priced: 973,
    pending: 0,
    failed: 0,
    bySet: [set("base2", 973, 973, 4182)],
    setNames: { base2: "Base Set 2" },
    setsLoaded: true,
    ...over,
  };
}

describe("pricingSummary", () => {
  it("never reports a total without saying how much of it is priced", () => {
    const partial = pricingSummary(input({ priced: 480 }));
    expect(partial.line).toBe("480 of 973 printings priced");
    expect(partial.warn).toBe(false);
  });

  it("says so plainly when everything is priced, rather than saying nothing", () => {
    expect(pricingSummary(input()).line).toBe("All 973 printings priced");
  });

  it("shows no total at all while the first prices are still coming", () => {
    // The point of `loading` is that Money renders "Pricing…" rather than the
    // running total of nothing, which formats as $0.00 in every other library.
    const s = pricingSummary(input({ priced: 0, pending: 3 }));
    expect(s.loading).toBe(true);
    expect(s.line).toBe("Pricing 3 sets…");
  });

  it("keeps showing the partial total once some sets have landed", () => {
    // A lower bound that is climbing is more useful than a spinner, as long as
    // the line says the number is not finished yet.
    const s = pricingSummary(input({ priced: 480, pending: 2 }));
    expect(s.loading).toBe(false);
    expect(s.line).toBe("480 of 973 printings priced · 2 sets still pricing");
  });

  it("reports no prices as absence, not as zero", () => {
    const s = pricingSummary(input({ priced: 0, bySet: [set("base2", 973, 0)] }));
    expect(s.line).toBe("No prices for any of your 973 printings");
    expect(s.warn).toBe(true);
    expect(s.loading).toBe(false);
  });

  it("names the set nothing could price, and leaves the rest totalling", () => {
    const s = pricingSummary(
      input({
        printings: 200,
        priced: 150,
        bySet: [set("base2", 150, 150, 900), set("pop3", 50, 0)],
        setNames: { base2: "Base Set 2", pop3: "POP Series 3" },
      }),
    );
    expect(s.cannotPrice).toEqual(["POP Series 3"]);
    expect(s.line).toBe("150 of 200 printings priced");
    expect(s.retryable).toBe(true);
  });

  it("does not accuse a set of being unpriceable while its request is in flight", () => {
    const s = pricingSummary(
      input({
        printings: 200,
        priced: 150,
        pending: 1,
        bySet: [set("base2", 150, 150, 900), set("pop3", 50, 0)],
        setNames: { base2: "Base Set 2", pop3: "POP Series 3" },
      }),
    );
    expect(s.cannotPrice).toEqual([]);
  });

  /**
   * The bug this exists for: `useCollectionValue` counts a DISABLED query as
   * pending, and a set's pricing query is disabled while its name is unknown.
   * A failed or slow set list therefore leaves every set held permanently
   * "pricing…", waiting on a request nobody is making.
   */
  it("does not wait forever on a set the catalog has never heard of", () => {
    const s = pricingSummary(
      input({
        printings: 50,
        priced: 0,
        pending: 1,
        bySet: [set("pop3", 50, 0)],
        setNames: {},
        setsLoaded: true,
      }),
    );
    expect(s.waiting).toBe(0);
    expect(s.loading).toBe(false);
    expect(s.cannotPrice).toEqual(["pop3"]);
    expect(s.line).toBe("No prices for any of your 50 printings");
  });

  it("still waits while the set list itself has not arrived", () => {
    const s = pricingSummary(
      input({
        printings: 50,
        priced: 0,
        pending: 1,
        bySet: [set("pop3", 50, 0)],
        setNames: {},
        setsLoaded: false,
      }),
    );
    expect(s.waiting).toBe(1);
    expect(s.loading).toBe(true);
    expect(s.cannotPrice).toEqual([]);
  });

  it("offers a retry after a request failed, even where the totals look fine", () => {
    expect(pricingSummary(input({ failed: 1 })).retryable).toBe(true);
    expect(pricingSummary(input()).retryable).toBe(false);
  });
});

describe("syncNotice", () => {
  function status(state: SyncStatus["state"], pending = 0): SyncStatus {
    return { state, pending, lastSyncAt: 0 };
  }

  it.each(["off", "idle", "syncing", "offline"] as const)(
    "stays silent on %s, because the shell already says it and nothing needs doing",
    (state) => {
      expect(syncNotice(status(state))).toBeNull();
      expect(syncNotice(status(state, 4))).toBeNull();
    },
  );

  it.each(["bad-token", "disabled"] as const)(
    "speaks up on %s, which stays broken until acted on",
    (state) => {
      const notice = syncNotice(status(state));
      expect(notice).not.toBeNull();
      // The label is `syncLine`'s, so Home and the shell cannot name the same
      // state two different things.
      expect(notice?.label.startsWith("Sync: ")).toBe(true);
      // And it does not blame the reader or imply their marks were lost.
      expect(notice?.detail).toMatch(/still saved/);
    },
  );
});

describe("completionFigure", () => {
  it("measures against the base tier where a set has one", () => {
    // 197 printed + secrets to 230. A base-tier set is measured on what you can
    // realistically finish, which is what the list is ordered by.
    const tiers = setTiers({ total: 230, printedTotal: 197 }, ["1", "2", "3"]);
    expect(completionFigure(tiers, 3).text).toBe("3 / 197 base");
  });

  it("falls back to the master figure where there is no base tier", () => {
    const tiers = setTiers({ total: 102 }, 43);
    expect(completionFigure(tiers, 43).text).toBe("43 / 102");
  });

  it("draws no bar at all when the set's size is unknown", () => {
    // NaN, not 0. `Meter` renders a non-finite ratio as an empty track — "there
    // is nothing to have" — where 0 would claim "you have none of it".
    const tiers = setTiers({}, 12);
    const figure = completionFigure(tiers, 12);
    expect(Number.isNaN(figure.ratio)).toBe(true);
    expect(figure.text).toBe("12 cards");
  });

  it("counts one card as one card", () => {
    // "1 cards" is the kind of thing that reaches production because the only
    // fixture anyone looks at has five of everything.
    expect(completionFigure(setTiers({}, 1), 1).text).toBe("1 card");
  });
});

describe("chartShape", () => {
  const centre = CHART_BOX.pad.top + (CHART_BOX.height - CHART_BOX.pad.top - CHART_BOX.pad.bottom) / 2;

  /**
   * The failure this guards. A steady collection maps every point to the same
   * value, and the obvious normalisation puts them all on the floor — which is
   * where a chart draws zero. 973 printings held for ninety days then rendered
   * as a flat line along the bottom of the biggest element on Home, reading as
   * "you have nothing".
   */
  it("centres a window where nothing changed, rather than pinning it to the floor", () => {
    const now = Date.UTC(2026, 0, 31);
    // Everything marked long before the window, so the 30-day view is flat.
    const history = buildHistory(
      Array.from({ length: 973 }, () => now - 400 * 86_400_000),
      "30d",
      now,
    );
    const shape = chartShape(history.points);

    expect(shape.flat).toBe(true);
    expect(pathYs(shape.line)).toEqual([centre, centre]);
    // And well clear of the baseline, which is what "you have nothing" looks like.
    expect(centre).toBeLessThan(shape.baseline);
  });

  it("draws a growing collection as a rise, with y decreasing as the total climbs", () => {
    const now = Date.UTC(2026, 0, 31);
    const day = 86_400_000;
    const history = buildHistory([now - 20 * day, now - 10 * day, now - day], "30d", now);
    const shape = chartShape(history.points);

    expect(shape.flat).toBe(false);
    const ys = pathYs(shape.line);
    // SVG y grows downward, so a rising series ends lower-numbered than it began.
    expect(ys[ys.length - 1]).toBeLessThan(ys[0]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(CHART_BOX.pad.top);
  });

  it("closes the fill on the baseline so the area is a shape and not a stroke", () => {
    const now = Date.UTC(2026, 0, 31);
    const history = buildHistory([now - 86_400_000], "30d", now);
    const shape = chartShape(history.points);
    expect(shape.area.endsWith("Z")).toBe(true);
    expect(shape.area).toContain(`,${shape.baseline}`);
  });

  it("never labels more than three points on the axis", () => {
    const now = Date.UTC(2026, 0, 31);
    const day = 86_400_000;
    const history = buildHistory(
      Array.from({ length: 20 }, (_, i) => now - i * day),
      "30d",
      now,
    );
    expect(history.points.length).toBeGreaterThan(3);
    expect(chartShape(history.points).ticks).toHaveLength(3);
  });
});

/**
 * The request budget, checked statically.
 *
 * Home makes ONE `/api/catalog/prices` call for the whole collection. It got
 * there from nineteen per-set calls at 4.5-6.7s each, several of which failed,
 * and the screen settled on "480 of 973 printings priced" as a result. The way
 * that regresses is not a deliberate decision — it is somebody adding a hook to
 * fill in one missing figure. So this asserts that nothing in this directory
 * opens a query or a fetch of its own; every request Home causes belongs to a
 * shared hook with a shared cache key.
 */
const SOURCES = import.meta.glob("./*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

describe("home adds no requests of its own", () => {
  it("has sources to check", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(4);
  });

  it.each([
    { pattern: /\buseQuery\b/, why: "a query of its own" },
    { pattern: /\buseQueries\b/, why: "a fan-out of queries" },
    { pattern: /\bfetch\s*\(/, why: "a bare request" },
    { pattern: /useSetCards|useSetPrintings|useSetView|useCardDetails/, why: "a per-set request" },
  ])("never opens $why", ({ pattern, why }) => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.includes(".test."))
      .filter(([, source]) => pattern.test(String(source)))
      .map(([path]) => path);
    expect(offenders, `${offenders.join(", ")} would add ${why}`).toEqual([]);
  });
});
