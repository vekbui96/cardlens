/**
 * Proxy to the Target stock bot's local API.
 *
 * The bot is a separate Python process on this machine (a Discord bot driving a
 * headed Playwright browser). It listens on loopback only, so this service —
 * which already owns the shared token and the Tailscale Funnel — is how the web
 * UI reaches it. Nothing new is exposed publicly.
 *
 * Why proxy rather than read the bot's SQLite file directly: adding a watch
 * needs the bot's WARMED browser to resolve a product title and first status
 * (a cold request gets a PerimeterX challenge), and paused/blocked state only
 * exists in the bot's memory. Two writers on one SQLite file would also race.
 */

const BOT_URL = (process.env.TARGET_BOT_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const BOT_TOKEN = process.env.TARGET_BOT_TOKEN ?? "";

/**
 * A stock check drives a real browser through PerimeterX, including a possible
 * re-warm and retry — measured at up to ~30s. A cart test is longer still: the
 * product page, the add, the cart, the checkout click, then the cleanup pass.
 * The timeout is well clear of both so slow reads as slow, not as failure.
 */
const TIMEOUT_MS = 120_000;

export interface BotReply {
  status: number;
  body: unknown;
}

export function botConfigured(): boolean {
  return Boolean(BOT_TOKEN);
}

/**
 * Forward one call to the bot. Never throws: a dead bot is an ordinary state
 * this service reports (503), not an exception the route has to catch. The
 * distinction matters to the UI — "bot offline" is actionable, a 500 is not.
 */
export async function callBot(method: string, path: string, body?: unknown): Promise<BotReply> {
  if (!BOT_TOKEN) {
    return { status: 503, body: { error: "target_bot_disabled" } };
  }

  try {
    const res = await fetch(`${BOT_URL}${path}`, {
      method,
      headers: {
        "X-Bot-Token": BOT_TOKEN,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    let parsed: unknown = null;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // The bot always answers JSON; anything else means it is broken rather
      // than merely unhappy, so surface it as a gateway error with the body.
      return { status: 502, body: { error: "bot_bad_response", detail: text.slice(0, 200) } };
    }

    return { status: res.status, body: parsed };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      status: timedOut ? 504 : 503,
      body: { error: timedOut ? "target_bot_timeout" : "target_bot_unreachable" },
    };
  }
}

/** TCINs are digit strings; anything else never reaches the bot. */
export function validTcin(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,15}$/.test(value);
}
