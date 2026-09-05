import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Target restock, from `docs/v2/specs/08-target-sealed.md`.
 *
 * Runs at 390 and 1440 automatically — see the `v2-phone` and `v2-desktop`
 * projects in playwright.config.ts.
 *
 * ## What the e2e setup actually serves
 *
 * The Playwright web server starts the real API with `COLLECTION_TOKEN` set and
 * **no `TARGET_TOKEN`**, so `requireTargetToken` answers every `/api/target/*`
 * call with 503 before it ever looks at the header. That is not a gap: it is the
 * single most common state this screen is in — the bot is a scheduled task in an
 * interactive session on a home server, and a signed-out machine stops it — so
 * the unstubbed path below exercises the failure the screen exists for, against
 * the real server, with nothing faked.
 *
 * Everything that needs a live bot is stubbed at the network edge instead, and
 * says so. There is no bot in CI and there is not going to be one.
 */

/** Two minutes, so `formatUpdated` lands in one bucket and stays there. */
const FRESH_MS = 2 * 60_000;
/** Well past three sweeps at the bot's 60s cadence — the stale case. */
const OLD_MS = 3 * 60 * 60_000;

function botState(products: unknown[]) {
  const now = Date.now();
  return {
    runtime: {
      startedAt: new Date(now - 8 * 60 * 60_000).toISOString(),
      lastCheckStartedAt: new Date(now - FRESH_MS).toISOString(),
      lastCheckFinishedAt: new Date(now - FRESH_MS).toISOString(),
      lastCheckDurationSeconds: 22,
      checksCompleted: 480,
      blocked: false,
      blockBackoffSeconds: 0,
      checkIntervalSeconds: 60,
      storeId: "1234",
      paused: false,
      browserReady: true,
    },
    products,
  };
}

function product(over: Record<string, unknown>) {
  const now = Date.now();
  return {
    tcin: "89542109",
    name: "A product",
    url: "https://www.target.com/p/x/-/A-89542109",
    enabled: true,
    healthCheck: false,
    autoCart: false,
    lastStatus: "OUT",
    lastCheckedAt: new Date(now - FRESH_MS).toISOString(),
    lastAlertedAt: null,
    createdAt: null,
    ...over,
  };
}

const WATCHLIST = [
  product({ tcin: "1", name: "Bot canary", healthCheck: true, lastStatus: "IN_STOCK" }),
  product({ tcin: "89542109", name: "Prismatic Evolutions Elite Trainer Box", lastStatus: "OUT" }),
  product({
    tcin: "94300066",
    name: "Destined Rivals Booster Bundle",
    lastStatus: "IN_STOCK",
    lastCheckedAt: new Date(Date.now() - OLD_MS).toISOString(),
  }),
  product({ tcin: "88897406", name: "Surging Sparks Tin", enabled: false }),
];

interface BotStub {
  /** Replace what `GET /api/target/state` answers from now on. */
  setState: (products: unknown[]) => void;
  /** Every request the page has made, so an absence can be asserted. */
  urls: string[];
  methods: string[];
}

/**
 * Answer the bot's routes locally.
 *
 * Installed BEFORE the token is entered, because no request is made without one
 * — `useTargetBot` keeps the query disabled until then, which is itself part of
 * the budget this screen is held to.
 */
async function stubBot(
  page: Page,
  options: {
    state?: number | unknown[];
    add?: number;
  } = {},
): Promise<BotStub> {
  let products = Array.isArray(options.state) ? options.state : WATCHLIST;
  const urls: string[] = [];
  const methods: string[] = [];

  await page.route("**/api/target/**", async (route) => {
    const request = route.request();
    urls.push(request.url());
    methods.push(request.method());

    if (request.method() === "POST" && request.url().includes("/watchlist")) {
      const status = options.add ?? 200;
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(status === 200 ? { ok: true } : { error: "target_bot_unreachable" }),
      });
    }

    if (typeof options.state === "number") {
      return route.fulfill({
        status: options.state,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthorized" }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(botState(products)),
    });
  });

  return { setState: (next) => void (products = next), urls, methods };
}

/** Connect the way a person does: type the token, press the button. */
async function connect(page: Page, token = "e2e-target-token"): Promise<void> {
  await page.getByLabel("Watchlist token").fill(token);
  await page.getByRole("button", { name: "Connect" }).click();
}

test.describe("no token", () => {
  test("says what to do, and does not look broken", async ({ page }) => {
    await openV2(page, "/target");
    await expect(page.getByRole("heading", { name: "Target restock", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect this device", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();

    // Nothing on this screen is a failure yet, so nothing may read as one.
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(/failed|error/i);
  });

  test("names the token it wants, and says it is not the collection one", async ({ page }) => {
    /*
     * The parity item with teeth: these routes reach a browser that can put real
     * items in a real Target cart, and the collection token is on every device
     * that syncs cards. The warning has to be where the paste happens.
     */
    await openV2(page, "/target");
    const main = page.getByRole("main");
    await expect(main).toContainText("TARGET_TOKEN");
    await expect(main).toContainText("different token from the collection sync token");
  });

  test("asks for nothing from the bot until it has a token", async ({ page }) => {
    // The request budget starts at zero: a disconnected device must not poll a
    // home server every thirty seconds to be told 401.
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openV2(page, "/target");
    await page.waitForLoadState("networkidle");
    expect(urls.filter((u) => u.includes("/api/target/"))).toEqual([]);
  });
});

test.describe("the bot is not answering", () => {
  test("says the bot is down, not 'failed to load'", async ({ page }) => {
    /*
     * Unstubbed, against the real server: the e2e API runs without a
     * `TARGET_TOKEN`, so this is a genuine 503 travelling the genuine path.
     */
    await openV2(page, "/target");
    await connect(page);

    await expect(page.getByRole("heading", { name: /not answering/i, level: 2 })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("scheduled task");
    await expect(main).toContainText("normal and expected");
    await expect(main).not.toContainText(/failed to load/i);
    await expect(page.getByRole("button", { name: "Try the bot again" })).toBeVisible();
  });

  test("will not pretend something can be added while nothing answers", async ({ page }) => {
    await openV2(page, "/target");
    await connect(page);
    await expect(page.getByRole("heading", { name: /not answering/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to watchlist" })).toBeDisabled();
  });

  test("a refused token offers a different token rather than a pointless retry", async ({ page }) => {
    await openV2(page, "/target");
    await stubBot(page, { state: 401 });
    await connect(page);

    await expect(page.getByRole("heading", { name: /refused this device's token/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter a different token" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try the bot again" })).toHaveCount(0);

    // And it actually goes back, rather than being a button that says something.
    await page.getByRole("button", { name: "Enter a different token" }).click();
    await expect(page.getByRole("heading", { name: "Connect this device" })).toBeVisible();
  });
});

test.describe("a live watchlist", () => {
  test("shows the bot's own health in words", async ({ page }) => {
    // A watchlist where nothing has restocked and a watchlist that stopped
    // checking look identical without this.
    await openV2(page, "/target");
    await stubBot(page);
    await connect(page);

    await expect(page.getByRole("heading", { name: "Bot health", level: 2 })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("Running");
    await expect(main).toContainText("Last sweep");
    await expect(main).toContainText("Sweeps every");
    await expect(page.getByRole("button", { name: "Pause checking" })).toBeVisible();
  });

  test("says 'in stock' in words, not only in colour", async ({ page }) => {
    await openV2(page, "/target");
    await stubBot(page);
    await connect(page);

    await expect(
      page.getByRole("heading", { name: "Destined Rivals Booster Bundle", level: 3 }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText("In stock");
    await expect(page.getByRole("main")).toContainText("Out of stock");
  });

  test("says a status older than the bot's own cadence is the past", async ({ page }) => {
    /*
     * The bundle was last checked three hours ago against a 60s sweep. "In
     * stock" beside that, with nothing said, is the screen's worst possible lie.
     */
    await openV2(page, "/target");
    await stubBot(page);
    await connect(page);
    await expect(page.getByRole("main")).toContainText("older than the bot's own sweep interval");
  });

  test("says which rows are not being checked at all", async ({ page }) => {
    await openV2(page, "/target");
    await stubBot(page);
    await connect(page);
    await expect(page.getByRole("main")).toContainText("not being watched");
  });

  test("does not count the bot's own canary as something you are watching", async ({ page }) => {
    // The canary is kept permanently in stock so a silent watchlist can be told
    // from a broken checker. Counting it would report an in-stock product that
    // is not one.
    await openV2(page, "/target");
    await stubBot(page);
    await connect(page);
    await expect(page.getByRole("main")).toContainText("3 products · 1 in stock");
  });

  test("an empty watchlist points at the form that fills it", async ({ page }) => {
    await openV2(page, "/target");
    await stubBot(page, { state: [] });
    await connect(page);

    await expect(page.getByRole("heading", { name: "Watchlist", level: 2 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Nothing is being watched yet");
    await expect(page.getByRole("button", { name: "Add to watchlist" })).toBeEnabled();
  });
});

test.describe("adding something", () => {
  test("refuses a bad entry here, before the ninety-second round trip", async ({ page }) => {
    await openV2(page, "/target");
    const stub = await stubBot(page, { state: [] });
    await connect(page);
    await expect(page.getByRole("main")).toContainText("Nothing is being watched yet");

    await page.getByLabel("Target product link or TCIN").fill("a booster box please");
    await page.getByRole("button", { name: "Add to watchlist" }).click();

    await expect(page.getByRole("alert")).toContainText("A-");
    expect(stub.methods.filter((m) => m === "POST")).toEqual([]);
  });

  test("confirms an add rather than just emptying the box", async ({ page }) => {
    await openV2(page, "/target");
    const stub = await stubBot(page, { state: [] });
    await connect(page);
    await expect(page.getByRole("main")).toContainText("Nothing is being watched yet");

    await page.getByLabel("Target product link or TCIN").fill("https://www.target.com/p/x/-/A-89542109");
    stub.setState([product({ tcin: "89542109", name: "Prismatic Evolutions Elite Trainer Box" })]);
    await page.getByRole("button", { name: "Add to watchlist" }).click();

    await expect(page.getByRole("main")).toContainText("Added TCIN 89542109");
    await expect(
      page.getByRole("heading", { name: "Prismatic Evolutions Elite Trainer Box", level: 3 }),
    ).toBeVisible();
  });

  test("a failed add says why, and says nothing was added", async ({ page }) => {
    await openV2(page, "/target");
    await stubBot(page, { state: [], add: 503 });
    await connect(page);
    await expect(page.getByRole("main")).toContainText("Nothing is being watched yet");

    await page.getByLabel("Target product link or TCIN").fill("89542109");
    await page.getByRole("button", { name: "Add to watchlist" }).click();

    await expect(page.getByRole("alert")).toContainText(/nothing was added/i);
  });
});

test.describe("target @visual", () => {
  /**
   * The whole page, not `main`: the shell's header is sticky, and an element
   * screenshot of a taller-than-viewport `main` scrolls it up until the header
   * covers the screen's own `<h1>`.
   *
   * Everything counting real minutes — every sweep figure, every "checked N
   * ago" — carries `data-snapshot="volatile"` and is hidden by
   * `stabiliseForSnapshot`, which on this screen is most of the text.
   */
  test("looks like itself", async ({ page }) => {
    await openV2(page, "/target");
    await stubBot(page);
    await connect(page);
    await expect(page.getByRole("heading", { name: "Bot health", level: 2 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("target.png", { fullPage: true });
  });
});
