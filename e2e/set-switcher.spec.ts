import { test, expect, type Page } from "@playwright/test";

/**
 * Switching sets from inside a set.
 *
 * Master-setting runs across many sets at once, and moving between two of them
 * used to mean back, scroll the set list, tap. The header title is the switcher
 * on web; the glasses keep a plain label, since a pointer-driven popover has
 * nothing to offer four gestures.
 *
 * Both sets here exist in the mock fixtures (src/integrations/pokemon/
 * fixtures.ts): "Obsidian Flames" (sv3) and "Base" (base1).
 */

const OWNED = [
  { cardId: "sv3-223", setId: "sv3", finish: "normal", at: 1_700_000_000_000 },
  { cardId: "base1-58", setId: "base1", finish: "normal", at: 1_700_000_001_000 },
];

/** Seed before any script runs, or the provider reads an empty store first. */
async function seedCollection(page: Page) {
  await page.addInitScript((rows) => {
    localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
  }, OWNED);
}

/** A collection the size of a real one, for the assertions about height. */
async function seedManySets(page: Page, count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    cardId: `filler${i}-1`,
    setId: `filler${i}`,
    finish: "normal",
    at: 1_700_000_000_000 + i,
  }));
  await page.addInitScript(
    (seeded) => {
      localStorage.setItem("cardlens:v1:collection", JSON.stringify(seeded));
    },
    [...OWNED, ...rows],
  );
}

async function openObsidianFlames(page: Page) {
  await page.goto("/?ui=web#/sets");
  await page
    .getByRole("button", { name: /Obsidian Flames/ })
    .first()
    .click();
  await expect(page.getByRole("group", { name: "Filter by rarity" })).toBeVisible();
}

test.describe("set switcher", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone" && testInfo.project.name !== "desktop", "web shells only");
  });

  test("jumps to another set you are collecting", async ({ page }) => {
    await seedCollection(page);
    await openObsidianFlames(page);

    await page.getByRole("button", { name: /Switch set/ }).click();
    const menu = page.getByRole("menu", { name: "Switch set" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: /^Base/ }).click();

    // URL-backed, so the address bar has to follow or a refresh lands elsewhere.
    await expect(page).toHaveURL(/#\/set\/base1\/Base$/);
    await expect(page.getByRole("button", { name: /Switch set/ })).toContainText("Base");
    await expect(menu).toBeHidden();
  });

  test("leaves for where you came from, not the set you passed through", async ({ page }) => {
    await seedCollection(page);
    await openObsidianFlames(page);

    await page.getByRole("button", { name: /Switch set/ }).click();
    await page.getByRole("menu", { name: "Switch set" }).getByRole("menuitem", { name: /^Base/ }).click();
    await expect(page).toHaveURL(/#\/set\/base1\//);

    // Switching replaces the history entry: a lateral move must not make Back
    // walk every set visited on the way here.
    await page.goBack();
    await expect(page).toHaveURL(/#\/sets$/);
  });

  test("opens fully on screen, with tappable rows", async ({ page }) => {
    // A real collection is nineteen sets, not two, and the panel is only worth
    // measuring against a list long enough to overrun the fold. Sets outside
    // the mock catalog render under their id, which is the documented fallback.
    await seedManySets(page, 20);
    await openObsidianFlames(page);

    await page.getByRole("button", { name: /Switch set/ }).click();
    const menu = page.getByRole("menu", { name: "Switch set" });

    // The panel hangs out of a header whose title styles clip to an ellipsis,
    // and out of a screen frame with overflow:hidden. Either would swallow it
    // silently — it would simply not be there.
    const box = (await menu.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box, "menu has no box").not.toBeNull();
    expect(box.width, "menu is clipped to nothing").toBeGreaterThan(100);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    const items = menu.getByRole("menuitem");
    const count = await items.count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      const rowBox = await items.nth(i).boundingBox();
      expect(rowBox, `row ${i} has no box`).not.toBeNull();
      expect(rowBox!.height, `row ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("offers the whole set list when the one you want is not tracked yet", async ({ page }) => {
    await seedCollection(page);
    await openObsidianFlames(page);

    await page.getByRole("button", { name: /Switch set/ }).click();
    await page
      .getByRole("menu", { name: "Switch set" })
      .getByRole("menuitem", { name: /^All sets/ })
      .click();

    await expect(page).toHaveURL(/#\/sets$/);
  });

  test("closes on Escape and on a click outside", async ({ page }) => {
    await seedCollection(page);
    await openObsidianFlames(page);

    const trigger = page.getByRole("button", { name: /Switch set/ });
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Switch set" })).toBeHidden();

    await trigger.click();
    await page.mouse.click(10, (page.viewportSize()?.height ?? 600) - 20);
    await expect(page.getByRole("menu", { name: "Switch set" })).toBeHidden();
  });
});

test.describe("set switcher on the glasses", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "glasses shell only");
  });

  test("is not there at all", async ({ page }) => {
    // The glasses shell is not URL-backed, so the set has to be reached the way
    // the hardware reaches it.
    await page.goto("/");
    // "Sets" by exact text: the Collection row's hint is "Track your sets", so
    // a substring match finds two rows.
    await page.getByText("Sets", { exact: true }).click();
    await page.getByRole("option").filter({ hasText: "Obsidian Flames" }).first().click();
    await expect(page.getByRole("heading", { name: "Obsidian Flames" })).toBeVisible();

    // The header on the glasses is a label. Anything that opens a panel over a
    // 600x600 additive display costs the rows the list is there to show.
    await expect(page.getByRole("button", { name: /Switch set/ })).toHaveCount(0);
  });
});

/**
 * Two ways to finish a set, and the same answer on every surface.
 *
 * Obsidian Flames (sv3) is 230 cards with a printed denominator of 197. Holding
 * 1..197 finishes the BASE set and leaves 33 secret rares outstanding — the case
 * that used to read `197/230` in this switcher and `197/408` in the header a
 * centimetre above it, with nothing on either saying which size it measured.
 */
const BASE_COMPLETE = Array.from({ length: 197 }, (_, i) => ({
  cardId: `sv3-${i + 1}`,
  setId: "sv3",
  finish: "normal",
  number: String(i + 1),
  at: 1_700_000_000_000 + i,
}));

test.describe("set completion tiers", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone" && testInfo.project.name !== "desktop", "web shells only");
  });

  async function seedBaseComplete(page: Page) {
    await page.addInitScript((rows) => {
      localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
    }, BASE_COMPLETE);
  }

  test("moves a base-complete set out from under In progress", async ({ page }) => {
    await seedBaseComplete(page);
    await page.goto("/?ui=web#/sets");

    const completed = page.getByRole("heading", { name: "Completed" });
    await expect(completed).toBeVisible();

    // Under Completed, not under the heading that promises what you are still
    // working on. Asserted by list membership rather than by pixel order: the
    // desktop layout puts the lists in a grid.
    const row = page.getByRole("button", { name: /Obsidian Flames/ });
    await expect(row).toHaveAttribute("aria-label", /base set 197 of 197/);
    await expect(row).toHaveAttribute("aria-label", /master set 197 of 230/);
    await expect(row).toHaveAttribute("aria-label", /BASE complete/);

    // Both figures on the row, each saying which set size it is.
    await expect(row.getByText("197/197")).toBeVisible();
    await expect(row.getByText("BASE")).toBeVisible();
    await expect(row.getByText("197/230")).toBeVisible();
  });

  test("shows the base run in the switcher, not the master total alone", async ({ page }) => {
    await seedBaseComplete(page);
    await openObsidianFlames(page);

    // The header carries both, labelled — the whole point of the feature.
    await expect(page.getByText("base", { exact: true })).toBeVisible();
    await expect(page.getByText("197/197")).toBeVisible();
    await expect(page.getByText("master", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Switch set/ }).click();
    const item = page.getByRole("menuitem", { name: /Obsidian Flames/ });
    await expect(item).toContainText("197/197");
    await expect(item).toContainText("BASE");
  });
});
