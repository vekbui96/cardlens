import type { BotRuntime } from "../../../models/target.ts";

/**
 * What went wrong between this device and the restock bot, in words.
 *
 * This file exists because "the bot is not running" is a NORMAL state here and
 * a generic "failed to load" is a lie about it. The bot is a scheduled task in
 * an interactive session on the home server — it drives a headed browser, so it
 * cannot be a service — and it therefore stops every time that session signs
 * out. The screen has to say that, not shrug.
 *
 * The classification is a pure function of the error so it can be tested
 * without a network, a component, or a bot. The three answers are genuinely
 * different actions: a rejected token needs a new token, a stopped bot needs
 * someone to start it, and no answer at all is the network or the whole server.
 */

/** The distinctions worth making. Anything finer would be a status code read aloud. */
export type BotFault =
  /** The service answered, and the bot behind it did not. 502/503/504. */
  | "not-running"
  /** The token was presented and refused. 401/403. */
  | "rejected"
  /** Nothing answered at all — no status, so no server. */
  | "offline"
  /** An answer nobody planned for. Says the status rather than inventing a cause. */
  | "unexpected";

export interface BotTrouble {
  fault: BotFault;
  title: string;
  detail: string;
  /** The single button under the message, and what it does. */
  action: { label: string; kind: "retry" | "new-token" };
}

/**
 * The HTTP status, when the request got one.
 *
 * Read off the error by shape rather than with `instanceof ProviderError`: the
 * status is the interface (`providers.ts` says so explicitly), and a duck-typed
 * read also copes with the auth error the hook throws before it ever reaches
 * fetch. ABSENT is the informative case — no status means no response, which
 * separates "the server said no" from "there was no server".
 */
export function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function classifyBotError(error: unknown): BotFault {
  const status = statusOf(error);
  if (status === undefined) return "offline";
  if (status === 401 || status === 403) return "rejected";
  // 503 is the service's own word for both "the bot did not answer" and "no
  // TARGET_TOKEN is configured"; 504 is the bot taking longer than two minutes,
  // and 502 is it answering something that is not JSON. All three mean the same
  // thing to the person looking at the screen: nothing is being checked.
  if (status === 502 || status === 503 || status === 504) return "not-running";
  return "unexpected";
}

/** The wording for the state the watchlist could not be read in. */
export function botTrouble(error: unknown): BotTrouble {
  const fault = classifyBotError(error);
  const status = statusOf(error);

  switch (fault) {
    case "not-running":
      return {
        fault,
        title: "The bot is not running",
        detail:
          "Nothing is being checked right now. The watchlist bot is a scheduled task inside a " +
          "signed-in session on the home server rather than a service — it drives a real browser, " +
          "so it stops whenever that session signs out. The watchlist itself is safe and starts " +
          "being checked again as soon as the bot does.",
        action: { label: "Check again", kind: "retry" },
      };
    case "rejected":
      return {
        fault,
        title: "The bot refused this token",
        detail:
          "The watchlist token was not accepted. It is not the collection sync token — the two are " +
          "deliberately different, because these controls reach a browser that can put items in a " +
          "real Target cart.",
        action: { label: "Use a different token", kind: "new-token" },
      };
    case "offline":
      return {
        fault,
        title: "No answer from the server",
        detail:
          "The request never got a reply, so this is the network or the home server itself rather " +
          "than the bot. Nothing stored on this device is affected.",
        action: { label: "Try again", kind: "retry" },
      };
    default:
      return {
        fault,
        title: "The bot answered with something unexpected",
        detail:
          `The watchlist could not be read${status === undefined ? "" : ` (HTTP ${status})`}. ` +
          "That is not a state this screen knows how to explain, which usually means the server " +
          "and the bot disagree about something.",
        action: { label: "Try again", kind: "retry" },
      };
  }
}

/**
 * Why an add did not happen.
 *
 * Same distinctions, different sentence: a failure here has to say what became
 * of the thing you just typed, and every branch says "nothing was added" so
 * that is never in doubt.
 */
export function addProblem(error: unknown): string {
  const status = statusOf(error);
  if (status === 400) {
    return "The bot would not take that one — check the link or TCIN. Nothing was added.";
  }
  switch (classifyBotError(error)) {
    case "rejected":
      return "The bot refused this token, so nothing was added.";
    case "not-running":
      return "The bot is not running, so nothing was added. Start it and try again.";
    case "offline":
      return "No answer from the server, so nothing was added.";
    default:
      return `The bot did not add it${status === undefined ? "" : ` (HTTP ${status})`}.`;
  }
}

/** Why a check did not run. Same distinctions; a check adds nothing, so it says so. */
export function checkProblem(error: unknown): string {
  const status = statusOf(error);
  switch (classifyBotError(error)) {
    case "rejected":
      return "The bot refused this token, so it could not check.";
    case "not-running":
      return "The bot is not running, so it could not check. Start it and try again.";
    case "offline":
      return "No answer from the server, so it could not check.";
    default:
      return `The check did not run${status === undefined ? "" : ` (HTTP ${status})`}.`;
  }
}

export interface BotHealth {
  /** Two or three words, shown in a chip. */
  label: string;
  /** Chip tone. Never the only carrier of the meaning — `note` says it too. */
  tone: "default" | "accent" | "warn";
  /** The same fact in a sentence, including what it costs. */
  note: string;
}

/**
 * The bot's own health, ordered by how bad it is.
 *
 * A watchlist where nothing has restocked and a watchlist that stopped checking
 * look identical without this, which is the reason v1 put the runtime beside
 * the products and this keeps it.
 */
export function botHealth(runtime: BotRuntime): BotHealth {
  if (!runtime.browserReady) {
    return {
      label: "Browser not ready",
      tone: "warn",
      note: "The bot is up but its browser has not warmed, so every check fails until it does.",
    };
  }
  if (runtime.blocked) {
    return {
      label: "Blocked by Target",
      tone: "warn",
      note: `Target is challenging the bot, so it is backing off for ${runtime.blockBackoffSeconds}s.`,
    };
  }
  if (runtime.paused) {
    return {
      label: "Paused",
      tone: "default",
      note: "Paused from here. Nothing is being checked until it is resumed.",
    };
  }
  return {
    label: "Running",
    tone: "accent",
    note: `Sweeping the watchlist every ${runtime.checkIntervalSeconds}s.`,
  };
}

/** How a stock status should read in a chip, with a tone that never stands alone. */
export function statusTone(status: string | null): "default" | "accent" | "warn" {
  if (status === "IN_STOCK") return "accent";
  if (status === "OUT") return "default";
  // BLOCKED, ERROR and "never checked" are all "this figure is not trustworthy".
  return "warn";
}
