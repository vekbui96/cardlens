import { statusLabel, type BotRuntime, type WatchedProduct } from "../../../models/target.ts";
import { formatUpdated } from "../../../utils/format.ts";

/**
 * The decisions this screen makes, with no React around them.
 *
 * Target is a thin client over a bot that is genuinely, routinely down: it is a
 * scheduled task inside an INTERACTIVE session on a home server, driving a
 * headed browser, so it stops the moment that machine signs out. "Failed to
 * load" is the wrong sentence for that, and so is anything that implies the
 * reader broke something.
 *
 * Every function here answers one question of the form "what does this actually
 * mean, and what should we say about it" — which is exactly the class of
 * judgement that looks fine against a healthy bot and lies against a dead one.
 * Pulling them out means the lies are assertable rather than noticed by whoever
 * happens to open the screen on a Sunday.
 */

/**
 * How something reads. The word always carries the meaning; the tone is a
 * second, redundant channel — green-against-gold is the pair deuteranopia
 * collapses, so nothing here is ever communicated by colour alone.
 */
export type Tone = "good" | "neutral" | "warn" | "bad";

/* --- Reaching the bot at all ---------------------------------------------- */

/**
 * The genuinely different things that go wrong, and they are different: one is
 * fixed by re-typing a token, one by signing back into a machine, one by
 * waiting, and one is not a fault at all.
 */
export type FailureKind = "rejected" | "off-or-down" | "slow" | "busy" | "garbled" | "no-server";

export interface BotFailure {
  kind: FailureKind;
  /** A heading that names what could not be reached. Never "Failed to load". */
  title: string;
  /** What it means, and whose problem it is. */
  detail: string;
  /** Asking again could plausibly get a different answer. */
  retryable: boolean;
  /** The token is the suspect, so offer to enter a different one. */
  tokenAtFault: boolean;
}

/** The HTTP status an error carries, when it carries one. See ProviderError. */
function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * What went wrong between here and the bot.
 *
 * ## The one distinction this CANNOT make, and why
 *
 * The server answers 503 for two different situations: `target_bot_disabled`
 * (this server has no `TARGET_TOKEN`, so the routes are switched off) and
 * `target_bot_unreachable` (the bot's loopback API did not answer). They are
 * different problems with different fixes — but `fetchJson` throws a
 * `ProviderError` carrying only the STATUS, and drops the JSON body that names
 * which. So one honest sentence has to cover both, and it does: neither is
 * something the reader has done, and both mean nothing is being checked.
 *
 * Guessing one of the two would be worse than saying both. A reader told "the
 * bot is not running" who then walks to the server and finds it running has
 * been sent on an errand by a screen that did not know.
 */
export function botFailure(error: unknown): BotFailure | null {
  if (!error) return null;
  const status = statusOf(error);

  if (status === 401 || status === 403) {
    return {
      kind: "rejected",
      title: "The bot refused this device's token",
      detail:
        "The server has a watchlist token and this is not it. TARGET_TOKEN is a different token from the collection sync token — they are not interchangeable, and a collection token pasted here will always be refused.",
      retryable: false,
      tokenAtFault: true,
    };
  }

  if (status === 429) {
    return {
      kind: "busy",
      title: "Too many requests to the bot",
      detail:
        "The server allows sixty calls a minute to these routes, because each one reaches a real browser. Nothing is broken; give it a minute.",
      retryable: true,
      tokenAtFault: false,
    };
  }

  if (status === 504) {
    return {
      kind: "slow",
      title: "The bot took too long to answer",
      detail:
        "It answers through a real browser window, and a check stuck behind a Target challenge can outlast two minutes. The watchlist itself is fine.",
      retryable: true,
      tokenAtFault: false,
    };
  }

  if (status === 503) {
    return {
      kind: "off-or-down",
      title: "The restock bot is not answering",
      detail:
        "Either this server has the bot switched off, or the bot is not running. It is a scheduled task inside a signed-in session on SERVER-PC, driving a real browser window — so a signed-out machine stops it. That is normal and expected, and nothing here is broken.",
      retryable: true,
      tokenAtFault: false,
    };
  }

  if (status === 502 || status === 500) {
    return {
      kind: "garbled",
      title: "The bot answered with something unreadable",
      detail:
        "The server reached it and got back something that was not the watchlist. That means the bot is running but unhappy, which usually clears when it finishes warming its browser.",
      retryable: true,
      tokenAtFault: false,
    };
  }

  /*
   * No status at all means there was no answer to read a status from: this
   * device could not reach the CardLens server, never mind the bot. That is a
   * different sentence, and pointing at the bot here would be a lie.
   */
  return {
    kind: "no-server",
    title: "This device could not reach CardLens",
    detail:
      "The request never got an answer — this device is offline, or the server behind it is. Nothing about the watchlist has changed; it just cannot be read from here.",
    retryable: true,
    tokenAtFault: false,
  };
}

/* --- Is the bot actually doing anything ----------------------------------- */

/**
 * How many sweeps may be missed before the bot has stopped rather than jittered.
 *
 * A sweep drives a real browser and is measured in tens of seconds against an
 * interval the bot itself reports, so one late sweep is ordinary. Three in a row
 * is not: at the bot's own 60s cadence that is three minutes of a watchlist that
 * looks live and is not — which is the exact failure this screen exists to make
 * visible, because a watchlist where nothing has restocked and a watchlist that
 * stopped checking look identical.
 */
export const STALL_SWEEPS = 3;

export interface SweepHealth {
  /** The state in words. This is the carrier; the tone merely agrees with it. */
  label: string;
  tone: Tone;
  /** Why it matters. Empty when it does not. */
  detail: string;
  /** Nothing is being checked right now, whatever the reason. */
  idle: boolean;
}

/**
 * Whether the bot is checking anything, ordered by how bad it is.
 *
 * A paused bot is a choice; a blocked or browserless one is a fault; a bot that
 * answered but has not swept in three intervals has silently died with its API
 * still up — the worst of the four, because it is the only one that looks fine.
 */
export function sweepHealth(runtime: BotRuntime, now: number = Date.now()): SweepHealth {
  if (!runtime.browserReady) {
    return {
      label: "Browser not ready",
      tone: "bad",
      detail:
        "Nothing is being checked until the bot's browser has warmed up. Every check fails until it has.",
      idle: true,
    };
  }

  if (runtime.blocked) {
    return {
      label: "Blocked by Target",
      tone: "bad",
      detail: `Target's bot protection turned the bot away. It is backing off for ${runtime.blockBackoffSeconds}s and will try again on its own.`,
      idle: true,
    };
  }

  if (runtime.paused) {
    return {
      label: "Paused",
      tone: "warn",
      detail: "Paused by hand, so nothing is being checked. Resume to start sweeping again.",
      idle: true,
    };
  }

  /*
   * Never swept AND never completed one: it has only just come up. Saying
   * "not sweeping" here would call a starting bot a broken one.
   */
  if (!runtime.lastCheckFinishedAt) {
    return runtime.checksCompleted > 0
      ? { label: "Sweeping now", tone: "good", detail: "", idle: false }
      : { label: "Starting up", tone: "warn", detail: "No sweep has finished yet.", idle: true };
  }

  const stalled = sweepIsStale(runtime, now);
  if (stalled) {
    return {
      label: "Not sweeping",
      tone: "bad",
      detail: `The bot answered, but its last sweep finished more than ${STALL_SWEEPS} intervals ago. Its API is up and its checker is not, so nothing below is being refreshed.`,
      idle: true,
    };
  }

  return { label: "Running", tone: "good", detail: "", idle: false };
}

/**
 * True when the last sweep is older than the bot's own promise.
 *
 * A zero interval means the bot did not tell us its cadence — `parseBotState`
 * writes 0 for a missing number — and there is then no promise to measure
 * against. Declining to judge is the honest answer; assuming a default would
 * invent a stall on a bot that is fine.
 */
function sweepIsStale(runtime: BotRuntime, now: number): boolean {
  if (runtime.checkIntervalSeconds <= 0) return false;
  const at = Date.parse(runtime.lastCheckFinishedAt ?? "");
  if (Number.isNaN(at)) return false;
  return now - at > runtime.checkIntervalSeconds * STALL_SWEEPS * 1000;
}

/** "Last sweep 4 min ago", or that there has not been one. Counts real minutes. */
export function lastSweepLabel(runtime: BotRuntime, now: number = Date.now()): string {
  if (!runtime.lastCheckFinishedAt) return "No sweep has finished yet";
  return `Last sweep ${formatUpdated(runtime.lastCheckFinishedAt, now)}`;
}

/* --- One watched product -------------------------------------------------- */

export interface WatchStatus {
  /** "In stock", "Out of stock", "Blocked", "Error", "Not checked yet". */
  word: string;
  tone: Tone;
  /** How old the status is, always — "checked 4 min ago" or "never checked". */
  checked: string;
  /**
   * The status on screen is older than the bot's own cadence promises, so it
   * describes the past rather than now. Said in words on the row.
   */
  stale: boolean;
}

/**
 * What a row says about a product.
 *
 * `checked` is not optional and never omitted, because "In stock" with no date
 * beside it is a claim about the present that the data cannot support: this
 * page is a cache of a sweep that may have run six hours ago. The status and its
 * age are one fact, so they are produced together.
 */
export function watchStatus(
  product: WatchedProduct,
  runtime: BotRuntime | null,
  now: number = Date.now(),
): WatchStatus {
  const word = statusLabel(product.lastStatus);
  const tone: Tone =
    product.lastStatus === "IN_STOCK"
      ? "good"
      : product.lastStatus === "OUT"
        ? "neutral"
        : product.lastStatus === "ERROR"
          ? "bad"
          : "warn";

  if (!product.lastCheckedAt) {
    return { word, tone, checked: "never checked", stale: false };
  }

  const at = Date.parse(product.lastCheckedAt);
  const interval = runtime?.checkIntervalSeconds ?? 0;
  const stale =
    product.enabled && interval > 0 && !Number.isNaN(at) && now - at > interval * STALL_SWEEPS * 1000;

  return {
    word,
    tone,
    checked: `checked ${formatUpdated(product.lastCheckedAt, now)}`,
    stale,
  };
}

/* --- The watchlist as a whole --------------------------------------------- */

export interface WatchSummary {
  /** The reader's own products — the bot's canary is not one of them. */
  watched: number;
  inStock: number;
  /** Rows the reader has switched off. They stay listed; they are not checked. */
  notWatching: number;
  /** The line under the title. Never a bare count. */
  line: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The line under the heading.
 *
 * The health-check product is excluded from every count: it is the bot's own
 * canary, kept permanently in stock so a silent watchlist can be told from a
 * broken checker, and counting it would report "1 in stock" on a watchlist where
 * nothing the reader cares about is in stock at all.
 */
export function watchSummary(products: WatchedProduct[]): WatchSummary {
  const mine = products.filter((p) => !p.healthCheck);
  const inStock = mine.filter((p) => p.lastStatus === "IN_STOCK").length;
  const notWatching = mine.filter((p) => !p.enabled).length;

  if (mine.length === 0) {
    return { watched: 0, inStock: 0, notWatching: 0, line: "Nothing on the watchlist yet" };
  }

  const parts = [plural(mine.length, "product", "products"), `${inStock} in stock`];
  if (notWatching > 0) parts.push(`${notWatching} not being watched`);
  return { watched: mine.length, inStock, notWatching, line: parts.join(" · ") };
}

/* --- Adding something ----------------------------------------------------- */

/**
 * Why what was typed cannot be watched, or null if it can.
 *
 * Checked here rather than at the server because the round trip is a browser
 * driving Target — up to ninety seconds — and spending that to be told the text
 * was not a product link is a bad trade for the reader.
 */
export function entryProblem(text: string, tcin: string | null): string | null {
  if (!text.trim()) return "Paste a Target product link, or the TCIN from one.";
  if (!tcin) {
    return "That is not a Target product link or a TCIN. A link looks like target.com/p/…/-/A-89542109; a TCIN is the digits after the A-.";
  }
  return null;
}

/** Why the add did not happen, in the reader's terms rather than a status code. */
export function addProblem(error: unknown): string | null {
  const failure = botFailure(error);
  if (!failure) return null;
  if (failure.kind === "rejected") return "The bot refused this device's token, so nothing was added.";
  if (failure.kind === "slow") {
    return "Target did not answer in time, so nothing was added. Adding resolves the real product name and a first status through the bot's browser, which is slow by nature — it is worth trying again.";
  }
  if (failure.kind === "busy")
    return "The bot is rate-limited right now. Nothing was added; try again in a minute.";
  return `Nothing was added — ${failure.title.toLowerCase()}.`;
}
