import { describe, expect, it } from "vitest";
import { ProviderError } from "../../../integrations/providers.ts";
import type { BotRuntime } from "../../../models/target.ts";
import { addProblem, botHealth, botTrouble, checkProblem, classifyBotError, statusOf } from "./botState.ts";

/**
 * The decisions this screen makes, tested without a component.
 *
 * The one that matters is the difference between "the bot is not running" and
 * anything that reads as the app breaking. That difference is the whole point
 * of the screen: the bot is a scheduled task in a signed-in session on the home
 * server, so it stops routinely, and a watchlist that says "failed to load"
 * sends someone to look at the wrong thing.
 */

/** What the service actually answers with when the bot is down — see server/targetBot.ts. */
const unreachable = () => new ProviderError("Request failed (503)", "network", { status: 503 });
const rejected = () => new ProviderError("Request failed (401)", "network", { status: 401 });
/** No response at all: the network, or a server that is not there. */
const noAnswer = () => new ProviderError("Network error", "network");

describe("statusOf", () => {
  it("recovers the status the request got", () => {
    expect(statusOf(rejected())).toBe(401);
  });

  it("is undefined when nothing answered, which is the informative case", () => {
    // "The server said no" and "there was no server" have different fixes.
    expect(statusOf(noAnswer())).toBeUndefined();
    expect(statusOf(new Error("boom"))).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
  });
});

describe("classifyBotError", () => {
  it("treats every gateway status as the bot not running", () => {
    // 503 the bot did not answer or was never configured, 504 it took longer
    // than two minutes, 502 it answered something that was not JSON. All three
    // mean nothing is being checked.
    for (const status of [502, 503, 504]) {
      expect(classifyBotError(new ProviderError("x", "network", { status }))).toBe("not-running");
    }
  });

  it("separates a refused token from a stopped bot", () => {
    expect(classifyBotError(rejected())).toBe("rejected");
    expect(classifyBotError(new ProviderError("x", "network", { status: 403 }))).toBe("rejected");
  });

  it("calls no answer at all offline, not a bot failure", () => {
    expect(classifyBotError(noAnswer())).toBe("offline");
  });

  it("does not invent a cause for a status it does not know", () => {
    expect(classifyBotError(new ProviderError("x", "network", { status: 500 }))).toBe("unexpected");
  });
});

describe("botTrouble", () => {
  it("says the bot is not running, and never that loading failed", () => {
    const trouble = botTrouble(unreachable());
    expect(trouble.title).toBe("The bot is not running");
    expect(trouble.title).not.toMatch(/failed|error/i);
    expect(trouble.detail).not.toMatch(/failed to load|something went wrong/i);
  });

  it("explains that a stopped bot is normal, not a fault in the app", () => {
    const { detail } = botTrouble(unreachable());
    expect(detail).toMatch(/scheduled task/i);
    expect(detail).toMatch(/signs? out/i);
    // And that nothing was lost by it stopping.
    expect(detail).toMatch(/watchlist itself is safe/i);
  });

  it("offers a retry for a stopped bot and a new token for a refused one", () => {
    expect(botTrouble(unreachable()).action.kind).toBe("retry");
    expect(botTrouble(rejected()).action.kind).toBe("new-token");
  });

  it("says a refused token is not the collection token", () => {
    // The two are different tokens with different blast radii, and the moment
    // someone is told "wrong token" is exactly when they will try the other one.
    const { title, detail } = botTrouble(rejected());
    expect(title).toMatch(/refused this token/i);
    expect(detail).toMatch(/not the collection sync token/i);
  });

  it("blames the network rather than the bot when nothing answered", () => {
    const { title, detail } = botTrouble(noAnswer());
    expect(title).toMatch(/no answer from the server/i);
    expect(detail).toMatch(/rather than the bot/i);
  });

  it("states the status it cannot explain instead of guessing", () => {
    expect(botTrouble(new ProviderError("x", "network", { status: 500 })).detail).toContain("HTTP 500");
  });
});

describe("addProblem", () => {
  it("always says what became of the thing you typed", () => {
    for (const error of [unreachable(), rejected(), noAnswer()]) {
      expect(addProblem(error)).toMatch(/nothing was added/i);
    }
  });

  it("blames the bot being down, not the input", () => {
    expect(addProblem(unreachable())).toMatch(/the bot is not running/i);
  });

  it("treats a 400 as the link being wrong, because it is", () => {
    expect(addProblem(new ProviderError("x", "network", { status: 400 }))).toMatch(/check the link or TCIN/i);
  });
});

describe("checkProblem", () => {
  it("does not claim anything was added, because a check adds nothing", () => {
    expect(checkProblem(unreachable())).toMatch(/could not check/i);
    expect(checkProblem(unreachable())).not.toMatch(/added/i);
  });
});

const runtime = (patch: Partial<BotRuntime> = {}): BotRuntime => ({
  startedAt: null,
  lastCheckStartedAt: null,
  lastCheckFinishedAt: null,
  lastCheckDurationSeconds: null,
  checksCompleted: 0,
  blocked: false,
  blockBackoffSeconds: 0,
  checkIntervalSeconds: 60,
  storeId: "1234",
  paused: false,
  browserReady: true,
  ...patch,
});

describe("botHealth", () => {
  it("reports running when it is", () => {
    expect(botHealth(runtime()).label).toBe("Running");
  });

  it("ranks a cold browser above a block above a pause", () => {
    // Ordered by how bad it is: no browser is a fault, a block is Target's
    // doing, a pause is a choice — and all three mean nothing is being checked.
    expect(botHealth(runtime({ browserReady: false, blocked: true, paused: true })).label).toBe(
      "Browser not ready",
    );
    expect(botHealth(runtime({ blocked: true, paused: true })).label).toBe("Blocked by Target");
    expect(botHealth(runtime({ paused: true })).label).toBe("Paused");
  });

  it("never leaves the colour to carry it — every state has words too", () => {
    for (const state of [
      runtime(),
      runtime({ paused: true }),
      runtime({ blocked: true, blockBackoffSeconds: 900 }),
      runtime({ browserReady: false }),
    ]) {
      const health = botHealth(state);
      expect(health.label.length).toBeGreaterThan(0);
      expect(health.note.length).toBeGreaterThan(0);
    }
    expect(botHealth(runtime({ blocked: true, blockBackoffSeconds: 900 })).note).toContain("900s");
  });
});
