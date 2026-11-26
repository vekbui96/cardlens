import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Add many cards, slice 1: paste a list, see the preview. Nothing is written,
 * so there is no storage to seed. The mock catalog has Obsidian Flames (`sv3`,
 * code OBF) with numbers 125 and 223.
 */
test.describe("add many cards", () => {
  test("opens from Collection and previews matched and unmatched lines", async ({ page }) => {
    await openV2(page, "/collection");
    await page.getByRole("link", { name: "Add many cards" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Add many cards" })).toBeVisible();
    await expect(page).toHaveTitle("Add many cards · CardLens");

    await page.getByRole("button", { name: "sv3 125 x2" }).click();
    await expect(page.getByTestId("addmany-matched")).toContainText("Charizard ex");
    await page.getByLabel("Your card list").fill("sv3 125 x2\nzzz 1\nobf 999\nsv3");
    await expect(page.getByTestId("addmany-not-recognised")).toContainText("No set with the code ZZZ");
    await expect(page.getByTestId("addmany-not-recognised")).toContainText("has no card number 999");
    await expect(page.getByTestId("addmany-matched")).toContainText("Charizard ex");
  });

  test("Add N cards, then Undo", async ({ page }) => {
    await openV2(page, "/addmany");
    await page.getByLabel("Your card list").fill("sv3 125\nsv3 223 holo\nzzz 1");
    await page.getByRole("button", { name: "Add 2 cards" }).click();
    await expect(page.getByTestId("addmany-added")).toHaveText("Added 2 cards");
    await expect(page.getByTestId("addmany-not-recognised")).toContainText("zzz 1");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Add 2 cards" })).toBeVisible();
  });
});

test.describe("add many cards: whole set and CSV", () => {
  test("Whole set previews a range and flags numbers the set lacks", async ({ page }) => {
    await openV2(page, "/addmany");
    await page.getByRole("button", { name: "Whole set" }).click();
    await page.getByLabel("Set", { exact: true }).selectOption("sv3");
    await page.getByLabel("Card numbers").fill("124-126");
    await expect(page.getByTestId("addmany-range-count")).toContainText("3 cards from Obsidian Flames");
    await expect(page.getByTestId("addmany-matched")).toContainText("Charizard ex");
    await expect(page.getByTestId("addmany-not-recognised")).toContainText("has no card number 124");
  });

  test("CSV file feeds the preview and lists unmatched rows", async ({ page }) => {
    await openV2(page, "/addmany");
    await page.getByRole("button", { name: "CSV file" }).click();
    const csv = [
      "name,set,number,finish,price",
      "Charizard ex,Obsidian Flames,125,Holofoil,4.00",
      "Nobody,Nowhere,1,Normal,",
    ].join("\r\n");
    await page
      .getByLabel("Choose CSV file")
      .setInputFiles({ name: "owned.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByTestId("addmany-matched")).toContainText("Charizard ex");
    await expect(page.getByTestId("addmany-not-recognised")).toContainText("No set named Nowhere");
    await page.getByRole("button", { name: "Add 1 card" }).click();
    await expect(page.getByTestId("addmany-added")).toHaveText("Added 1 card");
  });
});

/** The page is taller than the viewport now: drop focus and scroll to the top so the sticky header and focus ring cannot differ between runs. */
async function settle(page: Page): Promise<void> {
  // Tall enough for the whole screen, so the capture needs no scrolling at all.
  await page.setViewportSize({ width: page.viewportSize()?.width ?? 390, height: 1600 });
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
}

/**
 * Answer the TCGdex-backed printings endpoint locally, with fixed prices.
 *
 * A line that names a printing ("sv3 223 holo") is priced from the printings
 * index or not at all, and under mocks the e2e server builds that index live
 * from TCGdex. So the price in these shots was whatever TCGdex said during the
 * run: CI drew "$82.37" while a local container run drew "Unpriced", a 175px
 * diff that no amount of regenerating could settle. 82.37 is what TCGdex
 * reported when the baselines were drawn; it is pinned here, not fetched.
 */
async function stubPrintings(page: Page): Promise<void> {
  await page.route("**/api/printings/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tcgdexSetId: "sv3",
        byNumber: { "125": [{ type: "holo" }], "223": [{ type: "holo", price: 82.37 }] },
      }),
    }),
  );
}

test.describe("add many cards @visual", () => {
  test.beforeEach(async ({ page }) => {
    await stubPrintings(page);
  });

  test("after adding: the confirmation with Undo", async ({ page }) => {
    await openV2(page, "/addmany");
    await page.getByLabel("Your card list").fill("sv3 125 x2\nsv3 223 holo\nzzz 1");
    await page.getByRole("button", { name: "Add 2 cards" }).click();
    await expect(page.getByTestId("addmany-added")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await stabiliseForSnapshot(page);
    await settle(page);
    await expect(page.getByRole("main")).toHaveScreenshot("addmany-added.png", {
      timeout: 20000,
      mask: [page.getByRole("group", { name: "How to fill the preview" })],
    });
  });

  test("first run: the format hint and examples", async ({ page }) => {
    await openV2(page, "/addmany");
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("addmany-first-run.png", { timeout: 20000 });
  });

  test("a preview with matched and not recognised lines", async ({ page }) => {
    await openV2(page, "/addmany");
    await page.getByLabel("Your card list").fill("sv3 125 x2\nsv3 223 holo\nzzz 1\nobf 999\nsv3");
    await expect(page.getByTestId("addmany-matched")).toContainText("Charizard ex");
    await expect(page.getByTestId("addmany-not-recognised")).toContainText("has no card number 999");
    await page.waitForLoadState("networkidle");
    await stabiliseForSnapshot(page);
    await settle(page);
    await expect(page.getByRole("main")).toHaveScreenshot("addmany-preview.png", {
      timeout: 20000,
      mask: [page.getByRole("group", { name: "How to fill the preview" })],
    });
  });
});
