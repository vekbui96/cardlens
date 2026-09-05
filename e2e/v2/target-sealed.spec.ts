import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Target watchlist and sealed prices — `docs/v2/specs/08-target-sealed.md`.
 *
 * Both screens are thin clients over things that live outside the app and go
 * down independently of it: the restock bot is a scheduled task in a signed-in
 * session on the home server, and the sealed prices come from a third-party
 * daily dump. So the states ARE the screens, and `page.route` is how they get
 * driven — `?sim=` only fakes the CARD CATALOG, not `/api/target` or
 * `/api/sealed`, so it cannot reach either of these.
 *
 * ## These skip until the router is wired
 *
 * A stream owns `src/v2/screens/<its own>/` and does not touch
 * `src/v2/V2Router.tsx` — the integrator adds the lazy import (see
 * STREAM-BRIEF section 1). Until that lands, `#/target` and `#/sealed` render
 * the shared "Not built yet" placeholder, so every test below would fail for a
 * reason that is not about this code. They skip instead, with the reason
 * printed, and start running the moment the import is added. They were run
 * green against a temporary local wiring; the visual baselines committed
 * alongside were generated the same way.
 */

/** The device-local key the Target token lives under — deliberately its own. */
const TARGET_SETTINGS = "cardlens:v1:target-settings";
/** The collection sync token's key. Nothing on the Target screen may read it. */
const SYNC_SETTINGS = "cardlens:v1:sync-settings";
const COLLECTION = "cardlens:v1:collection";

const RUNTIME = {
  startedAt: "2026-09-01T10:00:00.000Z",
  lastCheckStartedAt: "2026-09-01T10:04:00.000Z",
  lastCheckFinishedAt: "2026-09-01T10:05:00.000Z",
  lastCheckDurationSeconds: 12,
  checksCompleted: 42,
  blocked: false,
  blockBackoffSeconds: 0,
  checkIntervalSeconds: 60,
  storeId: "1234",
  paused: false,
  browserReady: true,
};

const PRODUCT = {
  tcin: "94336414",
  name: "Prismatic Evolutions Elite Trainer Box",
  url: "https://www.target.com/p/x/-/A-94336414",
  enabled: true,
  healthCheck: false,
  autoCart: false,
  lastStatus: "OUT",
  lastCheckedAt: "2026-09-01T10:05:00.000Z",
  lastAlertedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
};

/** Obsidian Flames is in the mock catalog, so the set name resolves offline. */
const SEALED_SV3 = {
  setId: "sv3",
  updated: "2026-09-01T06:00:00.000Z",
  prices: [
    { kind: "pack", productName: "Obsidian Flames Booster Pack", price: 4.61 },
    // Listed upstream, unpriced. This is the one that must never read $0.00.
    { kind: "etb", productName: "Obsidian Flames Elite Trainer Box" },
    { kind: "box", productName: "Obsidian Flames Booster Box", price: 128.4 },
  ],
};

/** Put a token on the device the way the connect form would, before React runs. */
async function withTargetToken(page: Page, token = "e2e-target-token") {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify({ token: value })), [
    TARGET_SETTINGS,
    token,
  ] as const);
}

/** One owned printing from a set the mock catalog knows, so sealed has a set to price. */
async function withCollectedSet(page: Page) {
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify([{ cardId: "sv3-223", setId: "sv3", finish: "normal", at: 1_800_000_000_000 }]),
      ),
    COLLECTION,
  );
}

/** Answer the bot with one status for every route it exposes. */
async function botAnswers(page: Page, status: number, body: unknown = { error: "target_bot_unreachable" }) {
  await page.route("**/api/target/**", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

/**
 * Open a v2 screen, or skip if the router has not adopted it yet.
 *
 * It waits for one of the two things that can legitimately be there — this
 * screen's own `h1`, or the shared "Not built yet" placeholder — BEFORE
 * deciding. Checking the placeholder's count on its own is a race, and it lost
 * one: under load the phone project got as far as the shell and no further, saw
 * no placeholder, concluded the screen was wired, and failed on a screenshot of
 * a page that had not rendered. A test that can fail for "nothing was there
 * yet" is a test that can pass for it too.
 */
async function openScreen(page: Page, route: string, heading: string) {
  const shell = await openV2(page, route);
  const unbuilt = page.getByText("Not built yet");
  const built = page.getByRole("heading", { name: heading, level: 1 });
  await expect(unbuilt.or(built).first()).toBeVisible();
  test.skip(
    (await unbuilt.count()) > 0,
    `V2Router has not wired ${route} in yet - the integrator does that (STREAM-BRIEF section 1).`,
  );
  return shell;
}

/** The two h1s, so no caller has to spell one out twice. */
const openTarget = (page: Page) => openScreen(page, "/target", "Target restock");
const openSealed = (page: Page) => openScreen(page, "/sealed", "Sealed prices");

test.describe("Target: no token", () => {
  test("asks for the watchlist token and says it is not the sync token", async ({ page }) => {
    await openTarget(page);

    await expect(page.getByLabel("Watchlist token")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
    // The screen is not broken, it is unconfigured — and it says which token.
    await expect(page.getByRole("main")).toContainText("TARGET_TOKEN");
    await expect(page.getByRole("main")).toContainText("not the collection sync token");
  });

  test("a collection sync token does not connect it", async ({ page }) => {
    // The dangerous convenience: the device already holds a token, so falling
    // back to it would "just work" against routes that can fill a real cart.
    await page.addInitScript(
      (key) => localStorage.setItem(key, JSON.stringify({ token: "collection-only-token" })),
      SYNC_SETTINGS,
    );
    const calls: string[] = [];
    await page.route("**/api/target/**", (route) => {
      calls.push(route.request().url());
      return route.fulfill({ status: 200, body: JSON.stringify({ runtime: RUNTIME, products: [] }) });
    });

    await openTarget(page);
    await expect(page.getByLabel("Watchlist token")).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("connecting writes the target key and leaves the sync key alone", async ({ page }) => {
    await page.addInitScript(
      (key) => localStorage.setItem(key, JSON.stringify({ token: "collection-only-token" })),
      SYNC_SETTINGS,
    );
    await page.route("**/api/target/**", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ runtime: RUNTIME, products: [] }) }),
    );

    await openTarget(page);
    await page.getByLabel("Watchlist token").fill("typed-target-token");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByRole("heading", { name: "The bot" })).toBeVisible();
    const stored = await page.evaluate(
      ([target, sync]) => ({
        target: localStorage.getItem(target),
        sync: localStorage.getItem(sync),
      }),
      [TARGET_SETTINGS, SYNC_SETTINGS] as const,
    );
    expect(stored.target).toContain("typed-target-token");
    expect(stored.sync).toContain("collection-only-token");
    expect(stored.sync).not.toContain("typed-target-token");
  });
});

test.describe("Target: the bot is down", () => {
  test("says the bot is not running, not that loading failed", async ({ page }) => {
    // 503 is exactly what the service answers when the bot's loopback API does
    // not reply — the ordinary consequence of SERVER-PC signing out.
    await withTargetToken(page);
    await botAnswers(page, 503);
    await openTarget(page);

    await expect(page.getByRole("heading", { name: "The bot is not running" })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("scheduled task");
    await expect(main).not.toContainText(/failed to load/i);
    await expect(main).not.toContainText(/something went wrong/i);
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  });

  test("a refused token reads as a refused token", async ({ page }) => {
    await withTargetToken(page);
    await botAnswers(page, 401, { error: "unauthorized" });
    await openTarget(page);

    await expect(page.getByRole("heading", { name: "The bot refused this token" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use a different token" })).toBeVisible();
  });
});

test.describe("Target: the watchlist", () => {
  test("lists what is watched, with the bot's own health beside it", async ({ page }) => {
    await withTargetToken(page);
    await page.route("**/api/target/state", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ runtime: RUNTIME, products: [PRODUCT] }) }),
    );
    await openTarget(page);

    await expect(page.getByRole("link", { name: PRODUCT.name })).toBeVisible();
    await expect(page.getByText("Out of stock")).toBeVisible();
    // A watchlist where nothing restocked and one that stopped checking look
    // identical without this.
    await expect(page.getByText("Running")).toBeVisible();
  });

  test("an empty watchlist says so and offers the way to fill it", async ({ page }) => {
    await withTargetToken(page);
    await page.route("**/api/target/state", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ runtime: RUNTIME, products: [] }) }),
    );
    await openTarget(page);

    await expect(page.getByText(/Nothing on the watchlist yet/i)).toBeVisible();
    await expect(page.getByLabel("Target link or TCIN")).toBeVisible();
  });

  test("adding is confirmed", async ({ page }) => {
    await withTargetToken(page);
    await page.route("**/api/target/state", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ runtime: RUNTIME, products: [] }) }),
    );
    await page.route("**/api/target/watchlist", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    );
    await openTarget(page);

    await page.getByLabel("Target link or TCIN").fill(PRODUCT.url);
    await page.getByRole("button", { name: "Add to watchlist" }).click();

    await expect(page.getByText(/Added TCIN 94336414 to the watchlist/i)).toBeVisible();
  });

  test("a failed add says why, and that nothing was added", async ({ page }) => {
    await withTargetToken(page);
    await page.route("**/api/target/state", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ runtime: RUNTIME, products: [] }) }),
    );
    await page.route("**/api/target/watchlist", (route) =>
      route.fulfill({ status: 503, body: JSON.stringify({ error: "target_bot_unreachable" }) }),
    );
    await openTarget(page);

    await page.getByLabel("Target link or TCIN").fill("94336414");
    await page.getByRole("button", { name: "Add to watchlist" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/the bot is not running/i);
    await expect(alert).toContainText(/nothing was added/i);
  });
});

test.describe("Sealed", () => {
  test("with nothing collected, it says what to do", async ({ page }) => {
    await openSealed(page);

    await expect(page.getByRole("heading", { name: "Nothing collected yet" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Mark a card as owned");
    // It needs no token of its own, and says so — otherwise "connect something"
    // is the assumed fix for a screen that needs a collection instead.
    await expect(page.getByRole("main")).toContainText("no token of their own");
  });

  test("an unpriced product reads Unavailable, never $0.00", async ({ page }) => {
    await withCollectedSet(page);
    await page.route("**/api/sealed/**", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(SEALED_SV3) }),
    );
    await openSealed(page);

    await expect(page.getByRole("heading", { name: "Obsidian Flames" })).toBeVisible();
    await expect(page.getByText("$4.61")).toBeVisible();
    // The ETB is listed with no price; the bundle was never printed. Different
    // absences, different words, and neither of them a zero.
    await expect(page.getByText("Unavailable")).toBeVisible();
    await expect(page.getByText("Not sold")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("$0.00");
  });

  test("a price source that answers nothing is stated, not left spinning", async ({ page }) => {
    await withCollectedSet(page);
    await page.route("**/api/sealed/**", (route) => route.fulfill({ status: 502, body: "{}" }));
    await openSealed(page);

    await expect(page.getByRole("heading", { name: "No sealed prices right now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

/**
 * One snapshot per screen, plus the state this stream exists for.
 *
 * Everything that counts minutes against a real clock is marked
 * `data-snapshot="volatile"` in the screens, so `stabiliseForSnapshot` hides it
 * and these fail for a layout change rather than for the passage of time.
 *
 * `fullPage` rather than the `main` element: a screen taller than the viewport
 * gets scrolled into view for an element screenshot, which slides its first
 * line under the sticky header and bakes that into the baseline. The whole page
 * is both what a person sees and the same every run.
 */
test.describe("target and sealed @visual", () => {
  test("the watchlist", async ({ page }) => {
    await withTargetToken(page);
    await page.route("**/api/target/state", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ runtime: RUNTIME, products: [PRODUCT] }) }),
    );
    await openTarget(page);
    await expect(page.getByRole("link", { name: PRODUCT.name })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("target-watchlist.png", { fullPage: true });
  });

  test("the bot down", async ({ page }) => {
    await withTargetToken(page);
    await botAnswers(page, 503);
    await openTarget(page);
    await expect(page.getByRole("heading", { name: "The bot is not running" })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("target-bot-down.png", { fullPage: true });
  });

  test("sealed prices", async ({ page }) => {
    await withCollectedSet(page);
    await page.route("**/api/sealed/**", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(SEALED_SV3) }),
    );
    await openSealed(page);
    await expect(page.getByRole("heading", { name: "Obsidian Flames" })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("sealed-prices.png", { fullPage: true });
  });
});
