import { test, expect, type Page } from "@playwright/test";

/**
 * The web-only list of individual printings held.
 *
 * Sorting itself is covered by unit tests in models/ownedSort.test.ts — prices
 * come from the companion server, which the e2e mocks do not stand up, so
 * asserting an order here would assert against a column of dashes. What these
 * check is what only a browser can: the screen is reachable, a URL to it opens
 * cold, rows are printings rather than cards, and the glasses never see it.
 */

const OWNED = [
  { cardId: "sv3-223", setId: "sv3", finish: "normal", at: 1_700_000_000_000 },
  { cardId: "base1-58", setId: "base1", finish: "normal", at: 1_700_000_001_000 },
  // The same card again in a second printing: two rows, one card.
  { cardId: "base1-58", setId: "base1", finish: "reverse", at: 1_700_000_002_000 },
];

/** Seed before any script runs, or the provider reads an empty store first. */
async function seedCollection(page: Page) {
  await page.addInitScript((rows) => {
    localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
  }, OWNED);
}

test.describe("my cards", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone" && testInfo.project.name !== "desktop", "web shells only");
  });

  test("lists every printing held, not every card", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/?ui=web#/owned");
    await page.getByRole("button", { name: "List", exact: true }).click();

    const list = page.getByRole("list");
    await expect(list.getByRole("button").filter({ hasText: "Charizard ex" })).toHaveCount(1);
    // Pikachu is held twice over, so it must appear twice with different labels.
    await expect(list.getByRole("button").filter({ hasText: "Pikachu" })).toHaveCount(2);
    await expect(page.getByText("3 printings")).toBeVisible();
  });

  test("changes order without losing any rows", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/?ui=web#/owned");

    await page.getByRole("button", { name: "List", exact: true }).click();

    const rows = page.getByRole("list").getByRole("button");
    // Scoped to the control group: a row reading "unpriced" contains "price",
    // and Playwright matches accessible names by substring.
    const sorts = page.getByRole("group", { name: "Sort by" });

    await expect(rows).toHaveCount(3);
    await expect(sorts.getByRole("button", { name: "Price" })).toHaveAttribute("aria-pressed", "true");

    await sorts.getByRole("button", { name: "Name" }).click();
    await expect(sorts.getByRole("button", { name: "Name" })).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(3);
  });

  test("is reachable from the menu on any screen", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/?ui=web#/sets");

    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("menu", { name: "Go to" })
      .getByRole("menuitem", { name: /^My cards/ })
      .click();

    await expect(page).toHaveURL(/#\/owned$/);
    await expect(page.getByRole("heading", { name: "My cards" })).toBeVisible();
  });

  test("opens on the showcase, with one printing staged and the rest beneath", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/?ui=web#/owned");

    // Showcase is the default view: the stage is the point of the screen.
    await expect(page.getByRole("button", { name: "Showcase" })).toHaveAttribute("aria-pressed", "true");

    const strip = page.getByRole("listbox", { name: "Cards you own" });
    await expect(strip.getByRole("option")).toHaveCount(3);
    // Exactly one is staged, always — an empty stage would be a dead screen.
    await expect(strip.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(page.getByText("1 of 3")).toBeVisible();
  });

  test("stages whichever card is chosen from the strip", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/?ui=web#/owned");

    const strip = page.getByRole("listbox", { name: "Cards you own" });
    await strip.getByRole("option").nth(2).click();

    await expect(page.getByText("3 of 3")).toBeVisible();
    await expect(strip.getByRole("option").nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(strip.getByRole("option").first()).toHaveAttribute("aria-selected", "false");
  });

  test("walks the strip with the arrow keys and stops at the ends", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/?ui=web#/owned");

    const strip = page.getByRole("listbox", { name: "Cards you own" });
    await strip.getByRole("option").first().click();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("2 of 3")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("1 of 3")).toBeVisible();
    // Already at the start: nothing to go back to, and no wrap to the end.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("1 of 3")).toBeVisible();
    await page.keyboard.press("End");
    await expect(page.getByText("3 of 3")).toBeVisible();
  });

  test("keeps the stage and the list on the same sorted order", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/?ui=web#/owned");

    // Sorted by name, not price: prices arrive from the network, so a price
    // sort can legitimately reorder between the two reads and the test would
    // fail on a race that is not the app's.
    await page.getByRole("group", { name: "Sort by" }).getByRole("button", { name: "Name" }).click();

    const strip = page.getByRole("listbox", { name: "Cards you own" });
    const firstStaged = await strip.getByRole("option").first().innerText();

    await page.getByRole("button", { name: "List", exact: true }).click();
    const firstRow = await page.getByRole("list").getByRole("button").first().innerText();

    // Both views read the same sorted rows; a divergence here would mean two
    // answers to "which is the dearest card you own".
    expect(firstRow).toContain(firstStaged.split("\n")[0]);
  });

  test("says so plainly when nothing is marked", async ({ page }) => {
    await page.goto("/?ui=web#/owned");
    await expect(page.getByText("Nothing marked owned yet.")).toBeVisible();
  });
});

test.describe("my cards on the glasses", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "glasses shell only");
  });

  test("falls back to Collection rather than rendering a web screen", async ({ page }) => {
    await seedCollection(page);
    await page.goto("/#/owned");

    // The glasses have no URL bar, so this is only reachable by accident — but
    // it must not render a screen built for a pointer and a price column.
    await expect(page.getByRole("heading", { name: "My cards" })).toHaveCount(0);
  });
});
