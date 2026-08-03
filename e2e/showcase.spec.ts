import { test, expect } from "@playwright/test";

/**
 * Sharing a set as a link.
 *
 * The collection is local and syncs behind a token, so a shared page has to
 * bring its data with it. These check the round trip that matters: what one
 * device marks is what another device — with an empty collection — renders.
 */

const OWNED = [
  { cardId: "sv3-125", setId: "sv3", finish: "normal", at: 1_700_000_000_000 },
  { cardId: "sv3-125", setId: "sv3", finish: "reverse", at: 1_700_000_001_000 },
];

test.describe("set showcase", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone" && testInfo.project.name !== "desktop", "web shells only");
  });

  test("shares what this device owns, and shows it on a device that owns nothing", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript((rows) => {
      localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
    }, OWNED);

    await page.goto("/?ui=web#/set/sv3/Obsidian%20Flames");
    // Wait for the grid: the link is built from the cards on screen.
    await expect(page.getByRole("button", { name: /printings owned/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Share" }).click();

    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain("#/showcase/sv3/");

    // A visitor with an empty collection. If the showcase read local state
    // instead of the link, this would show nothing — which is the one way this
    // screen could be actively misleading.
    const visitor = await context.browser()!.newPage();
    await visitor.goto(url.replace(/^https?:\/\/[^/]+/, ""));
    await expect(visitor.getByText("2 printings shown")).toBeVisible();
    // Each printing is its own slot, the way a binder actually holds them.
    await expect(visitor.getByText("125 · Normal")).toBeVisible();
    await expect(visitor.getByText("125 · Reverse Holo")).toBeVisible();
    await visitor.close();
  });

  test("ghosts the cards that are missing rather than hiding them", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // A gap says nothing; a faded card says "still missing" and stays
    // recognisable while it does.
    await page.addInitScript((rows) => {
      localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
    }, OWNED);
    await page.goto("/?ui=web#/set/sv3/Obsidian%20Flames");
    await expect(page.getByRole("button", { name: /printings owned/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Share" }).click();
    const url = await page.evaluate(() => navigator.clipboard.readText());

    await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
    // Obsidian Flames has two mock cards. 125 is held in both its printings;
    // 223 is not held at all, so its slots are ghosted rather than absent.
    const slots = page.getByTestId("showcase-slot");
    await expect(slots.filter({ hasText: "missing" }).first()).toBeVisible();
    await expect(slots.filter({ hasText: "125 · Normal" })).toHaveCount(1);
    await expect(page.getByText("Charizard ex").first()).toBeVisible();
  });

  test("does not fall over on a link a chat client mangled", async ({ page }) => {
    await page.goto("/?ui=web#/showcase/sv3/Obsidian%20Flames/not-a-real-payload");
    // Nothing owned, but the set still renders — an error page helps nobody.
    await expect(page.getByText("0 printings shown")).toBeVisible();
  });
});
