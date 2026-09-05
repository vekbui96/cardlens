import { describe, expect, it } from "vitest";
import { ProviderError } from "../../../integrations/providers.ts";
import { extractTcin, type BotRuntime, type WatchedProduct } from "../../../models/target.ts";
import {
  addProblem,
  botFailure,
  entryProblem,
  lastSweepLabel,
  sweepHealth,
  watchStatus,
  watchSummary,
  STALL_SWEEPS,
} from "./targetState.ts";

/**
 * The decisions, not the markup.
 *
 * Every case here has a plausible wrong answer that looks fine against a
 * healthy bot on a Tuesday afternoon and lies against the one that is actually
 * out there — a scheduled task in an interactive session that stops when the
 * machine signs out.
 */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function runtime(over: Partial<BotRuntime> = {}): BotRuntime {
  return {
    startedAt: new Date(NOW - 8 * 60 * MINUTE).toISOString(),
    lastCheckStartedAt: new Date(NOW - MINUTE).toISOString(),
    lastCheckFinishedAt: new Date(NOW - MINUTE).toISOString(),
    lastCheckDurationSeconds: 22,
    checksCompleted: 480,
    blocked: false,
    blockBackoffSeconds: 0,
    checkIntervalSeconds: 60,
    storeId: "1234",
    paused: false,
    browserReady: true,
    ...over,
  };
}

function product(over: Partial<WatchedProduct> = {}): WatchedProduct {
  return {
    tcin: "89542109",
    name: "Prismatic Evolutions Elite Trainer Box",
    url: "https://www.target.com/p/x/-/A-89542109",
    enabled: true,
    healthCheck: false,
    autoCart: false,
    lastStatus: "OUT",
    lastCheckedAt: new Date(NOW - MINUTE).toISOString(),
    lastAlertedAt: null,
    createdAt: null,
    ...over,
  };
}

/** The errors `fetchJson` actually throws, not a hand-rolled stand-in. */
function httpError(status: number): ProviderError {
  return new ProviderError(`Request failed (${status})`, "network", { status });
}

describe("botFailure", () => {
  it("says nothing when nothing went wrong", () => {
    expect(botFailure(null)).toBeNull();
    expect(botFailure(undefined)).toBeNull();
  });

  it("blames the token only when the server actually refused it", () => {
    // 401 is the one case where re-typing something fixes it, and the only one
    // where the reader is offered that.
    const rejected = botFailure(httpError(401));
    expect(rejected?.kind).toBe("rejected");
    expect(rejected?.tokenAtFault).toBe(true);
    expect(rejected?.retryable).toBe(false);

    for (const status of [429, 500, 502, 503, 504]) {
      expect(botFailure(httpError(status))?.tokenAtFault).toBe(false);
    }
  });

  it("says the two tokens are different, where the mistake is actually made", () => {
    expect(botFailure(httpError(401))?.detail).toContain("collection sync token");
  });

  it("refuses to guess which of the two 503s it is", () => {
    /*
     * The server answers 503 for "this server has the bot switched off" AND for
     * "the bot did not answer", and `fetchJson` drops the body that names which.
     * Naming one would send the reader to a home server that turns out to be
     * fine, so the sentence covers both.
     */
    const down = botFailure(httpError(503));
    expect(down?.kind).toBe("off-or-down");
    expect(down?.detail).toContain("switched off");
    expect(down?.detail).toContain("not running");
    expect(down?.retryable).toBe(true);
  });

  it("calls a signed-out home server normal, because it is", () => {
    // The parity requirement in the spec: "SERVER-PC signed out" must read as an
    // expected state, not as an app error.
    const down = botFailure(httpError(503));
    expect(down?.detail).toMatch(/normal and expected/i);
    expect(down?.detail).toMatch(/scheduled task/i);
  });

  it("points at this device when there was no answer at all to read a status from", () => {
    // A timeout or a DNS failure carries no status. Pointing at the bot here
    // would be a lie: nothing got far enough to know anything about the bot.
    const none = botFailure(new ProviderError("Network error", "network"));
    expect(none?.kind).toBe("no-server");
    expect(none?.title).not.toMatch(/bot/i);
  });

  it("tells a slow bot from a dead one", () => {
    expect(botFailure(httpError(504))?.kind).toBe("slow");
    expect(botFailure(httpError(429))?.kind).toBe("busy");
    expect(botFailure(httpError(502))?.kind).toBe("garbled");
  });

  it("never blames the reader, and never says 'failed to load'", () => {
    for (const status of [401, 429, 500, 502, 503, 504]) {
      const failure = botFailure(httpError(status));
      expect(failure?.title.toLowerCase()).not.toContain("failed to load");
      expect(`${failure?.title} ${failure?.detail}`.toLowerCase()).not.toMatch(/you (did|broke|entered)/);
    }
  });
});

describe("sweepHealth", () => {
  it("calls a healthy bot running, and does not call it idle", () => {
    const health = sweepHealth(runtime(), NOW);
    expect(health.label).toBe("Running");
    expect(health.idle).toBe(false);
  });

  it("reports the worst fault first", () => {
    // A bot that is paused AND browserless is not "Paused" — pressing Resume
    // would change nothing, and the reader would be back in a minute.
    const both = sweepHealth(runtime({ paused: true, browserReady: false }), NOW);
    expect(both.label).toBe("Browser not ready");

    const blockedAndPaused = sweepHealth(runtime({ paused: true, blocked: true }), NOW);
    expect(blockedAndPaused.label).toBe("Blocked by Target");
  });

  it("quotes the backoff, so a block reads as temporary rather than terminal", () => {
    const health = sweepHealth(runtime({ blocked: true, blockBackoffSeconds: 900 }), NOW);
    expect(health.detail).toContain("900s");
  });

  it("catches the bot that answers but has stopped checking", () => {
    /*
     * The worst state, because it is the only one that looks fine: the API is up
     * and the products still render, so a watchlist where nothing has restocked
     * and a watchlist that died three hours ago are identical without this.
     */
    const stalled = sweepHealth(
      runtime({ lastCheckFinishedAt: new Date(NOW - (STALL_SWEEPS + 1) * 60_000).toISOString() }),
      NOW,
    );
    expect(stalled.label).toBe("Not sweeping");
    expect(stalled.idle).toBe(true);
  });

  it("does not call one late sweep a stall", () => {
    const late = sweepHealth(runtime({ lastCheckFinishedAt: new Date(NOW - 90_000).toISOString() }), NOW);
    expect(late.label).toBe("Running");
  });

  it("declines to judge staleness when the bot did not state its cadence", () => {
    // `parseBotState` writes 0 for a missing number. There is then no promise to
    // measure against, and inventing a default would invent a stall.
    const health = sweepHealth(
      runtime({
        checkIntervalSeconds: 0,
        lastCheckFinishedAt: new Date(NOW - 6 * 60 * MINUTE).toISOString(),
      }),
      NOW,
    );
    expect(health.label).toBe("Running");
  });

  it("calls a bot that has never finished a sweep 'starting up', not broken", () => {
    const fresh = sweepHealth(runtime({ lastCheckFinishedAt: null, checksCompleted: 0 }), NOW);
    expect(fresh.label).toBe("Starting up");
    expect(fresh.idle).toBe(true);
  });
});

describe("lastSweepLabel", () => {
  it("says there has not been one rather than inventing a time", () => {
    expect(lastSweepLabel(runtime({ lastCheckFinishedAt: null }), NOW)).toBe("No sweep has finished yet");
  });

  it("counts from the bot's own stamp", () => {
    expect(
      lastSweepLabel(runtime({ lastCheckFinishedAt: new Date(NOW - 5 * MINUTE).toISOString() }), NOW),
    ).toBe("Last sweep 5 min ago");
  });
});

describe("watchStatus", () => {
  it("always carries the age beside the status", () => {
    // "In stock" on its own is a claim about right now that a cached sweep
    // cannot support.
    const status = watchStatus(product({ lastStatus: "IN_STOCK" }), runtime(), NOW);
    expect(status.word).toBe("In stock");
    expect(status.checked).toBe("checked 1 min ago");
  });

  it("says a status is the past once it outlives the bot's own cadence", () => {
    const stale = watchStatus(
      product({ lastStatus: "IN_STOCK", lastCheckedAt: new Date(NOW - 10 * MINUTE).toISOString() }),
      runtime(),
      NOW,
    );
    expect(stale.stale).toBe(true);
  });

  it("does not call an unwatched row stale", () => {
    // It is not being checked on purpose, and the row already says so. Calling
    // that "stale" would put a warning on a state the reader chose.
    const off = watchStatus(
      product({ enabled: false, lastCheckedAt: new Date(NOW - 10 * MINUTE).toISOString() }),
      runtime(),
      NOW,
    );
    expect(off.stale).toBe(false);
  });

  it("says never checked rather than showing nothing", () => {
    const never = watchStatus(product({ lastCheckedAt: null, lastStatus: null }), runtime(), NOW);
    expect(never.word).toBe("Not checked yet");
    expect(never.checked).toBe("never checked");
    expect(never.stale).toBe(false);
  });

  it("separates a stock answer from a bot problem", () => {
    // BLOCKED is PerimeterX, not a stock state, and must not read as "out".
    expect(watchStatus(product({ lastStatus: "BLOCKED" }), runtime(), NOW).word).toBe("Blocked");
    expect(watchStatus(product({ lastStatus: "OUT" }), runtime(), NOW).tone).toBe("neutral");
    expect(watchStatus(product({ lastStatus: "IN_STOCK" }), runtime(), NOW).tone).toBe("good");
  });
});

describe("watchSummary", () => {
  it("leaves the bot's canary out of every count", () => {
    /*
     * The health-check product is kept permanently IN STOCK so a silent
     * watchlist can be told from a broken checker. Counting it would report
     * "1 in stock" on a watchlist where nothing the reader wants is in stock.
     */
    const summary = watchSummary([
      product({ tcin: "1", healthCheck: true, lastStatus: "IN_STOCK" }),
      product({ tcin: "2", lastStatus: "OUT" }),
    ]);
    expect(summary.watched).toBe(1);
    expect(summary.inStock).toBe(0);
  });

  it("pluralises, so a one-product watchlist does not say '1 products'", () => {
    expect(watchSummary([product()]).line).toContain("1 product ");
    expect(watchSummary([product({ tcin: "1" }), product({ tcin: "2" })]).line).toContain("2 products");
  });

  it("says an empty watchlist is empty rather than reporting zeroes", () => {
    expect(watchSummary([]).line).toBe("Nothing on the watchlist yet");
    expect(watchSummary([product({ healthCheck: true })]).line).toBe("Nothing on the watchlist yet");
  });

  it("counts the rows that are switched off, because they look watched otherwise", () => {
    const summary = watchSummary([product({ tcin: "1" }), product({ tcin: "2", enabled: false })]);
    expect(summary.notWatching).toBe(1);
    expect(summary.line).toContain("1 not being watched");
  });
});

describe("entryProblem", () => {
  it("accepts both forms the parity list names — a URL and a bare id", () => {
    for (const text of ["https://www.target.com/p/thing/-/A-89542109", "89542109"]) {
      expect(entryProblem(text, extractTcin(text))).toBeNull();
    }
  });

  it("asks for something rather than complaining when the box is empty", () => {
    expect(entryProblem("", null)).toContain("Paste");
  });

  it("says what a link looks like, not just that this one is wrong", () => {
    const problem = entryProblem("a pack of cards", extractTcin("a pack of cards"));
    expect(problem).toContain("A-");
  });
});

describe("addProblem", () => {
  it("says nothing when the add worked", () => {
    expect(addProblem(null)).toBeNull();
  });

  it("always says whether anything was added", () => {
    for (const status of [401, 429, 503, 504]) {
      expect(addProblem(httpError(status))).toMatch(/nothing was added/i);
    }
  });

  it("encourages a retry on the failure that is worth retrying", () => {
    // Adding drives a real browser through Target; a timeout is ordinary there.
    expect(addProblem(httpError(504))).toMatch(/trying again/i);
  });
});
