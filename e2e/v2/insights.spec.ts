import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Insights (#336, spec #334): which cards carry the value of the collection.
 * Three cards from sets the mock catalog knows, priced through the stubbed
 * `/api/printings`; runs at 390 and 1440 (`v2-phone` and `v2-desktop`).
 */

const COLLECTION_KEY = "cardlens:v1:collection";

const OWNED: Array<[string, string, string, string]> = [
  ["sv3-125", "sv3", "125", "holo"],
  ["base1-58", "base1", "58", "normal"],
  ["swsh7-215", "swsh7", "215", "holo"],
];

const PRICES: Record<string, Record<string, number>> = {
  sv3: { "125": 8.11 },
  base1: { "58": 1.5 },
  swsh7: { "215": 80 },
};

async function seedInsights(page: Page): Promise<void> {
  const rows = OWNED.map(([cardId, setId, number, finish], i) => ({
    cardId,
    setId,
    finish,
    number,
    at: 1_700_000_000_000 + i * 1000,
  }));
  await page.addInitScript(([key, owned]) => localStorage.setItem(key as string, JSON.stringify(owned)), [
    COLLECTION_KEY,
    rows,
  ] as const);
  await page.route("**/api/printings/**", (route) => {
    const setId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const byNumber: Record<string, unknown[]> = {};
    for (const [number, price] of Object.entries(PRICES[setId] ?? {})) {
      const finish = OWNED.find(([, s, n]) => s === setId && n === number)?.[3] ?? "normal";
      byNumber[number] = [{ type: finish, price }];
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tcgdexSetId: setId, byNumber }),
    });
  });
}

test.describe("insights", () => {
  test("ranks the most valuable cards and states the concentration", async ({ page }) => {
    await seedInsights(page);
    await openV2(page, "/insights");
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Insights · CardLens");
    await expect(page.getByTestId("insights-concentration")).toHaveText(
      "Top 3 cards = 100% of the total value",
    );
    const items = page.getByRole("main").getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText("$80.00");
  });

  test("a row opens the card", async ({ page }) => {
    await seedInsights(page);
    await openV2(page, "/insights");
    await page.getByRole("main").getByRole("link").first().click();
    expect(page.url()).toContain("#/card/swsh7-215");
  });

  test("is reached from Home's value card", async ({ page }) => {
    await seedInsights(page);
    await openV2(page, "/");
    await page.getByRole("link", { name: /^Insights/ }).click();
    expect(page.url()).toContain("#/insights");
  });

  test("an empty device shows the shared empty state", async ({ page }) => {
    await openV2(page, "/insights");
    await expect(page.getByText("Nothing tracked yet")).toBeVisible();
    await expect(page.getByTestId("insights-concentration")).toHaveCount(0);
  });
});

test.describe("insights @visual", () => {
  test("most valuable cards", async ({ page }) => {
    await seedInsights(page);
    await openV2(page, "/insights");
    await expect(page.getByTestId("insights-concentration")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("insights.png", { fullPage: true });
  });
});
