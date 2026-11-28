import { expect, test } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Trade builder, slice 1: the "I give" side. Prices under mocks come from live
 * TCGdex, so the visual cases mask every price and the total; what they pin is
 * the layout, not the numbers.
 */
test.describe("trade builder", () => {
  test("opens from Binders and starts with an explanation", async ({ page }) => {
    await openV2(page, "/binders");
    await page.getByRole("link", { name: "Trade builder" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Trade" })).toBeVisible();
    await expect(page).toHaveTitle("Trade · CardLens");
    await expect(page.getByLabel("Add a card you would give")).toBeVisible();
  });

  test("picks owned cards and totals them", async ({ page }) => {
    await openV2(page, "/tradebuilder", { seed: "collection" });
    await page.getByLabel("Add a card you would give").fill("a");
    await page.getByRole("button", { name: /^Add / }).first().click();
    await expect(page.getByTestId("give-total")).toContainText("1 card");
    await page.getByRole("button", { name: /^Remove / }).click();
    await expect(page.getByTestId("give-empty")).toBeVisible();
  });

  test("adds a card to the get side and shows a balance", async ({ page }) => {
    await openV2(page, "/tradebuilder");
    await expect(page.getByTestId("get-empty")).toBeVisible();
    const search = page.getByLabel("Add a card you would get");
    await search.fill("charizard");
    await search.press("Enter");
    await page.getByRole("button", { name: /^Get / }).first().click();
    await expect(page.getByTestId("get-total")).toContainText("1 card");
    await expect(page.getByTestId("balance")).toBeVisible();
  });
});

test.describe("trade builder @visual", () => {
  test("first run: the empty give side", async ({ page }) => {
    await openV2(page, "/tradebuilder");
    await page.waitForLoadState("networkidle");
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("tradebuilder-empty.png", { timeout: 20000 });
  });

  test("two cards chosen", async ({ page }) => {
    await openV2(page, "/tradebuilder", { seed: "collection" });
    const search = page.getByLabel("Add a card you would give");
    for (let i = 0; i < 2; i += 1) {
      await search.fill("a");
      await page.getByRole("button", { name: /^Add / }).first().click();
    }
    await search.fill("");
    await expect(page.getByTestId("give-list").locator("li")).toHaveCount(2);
    const getSearch = page.getByLabel("Add a card you would get");
    await getSearch.fill("charizard");
    await getSearch.press("Enter");
    await page.getByRole("button", { name: /^Get / }).first().click();
    await expect(page.getByTestId("get-list").locator("li")).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("tradebuilder-two-cards.png", {
      timeout: 20000,
      mask: [
        page.getByTestId("give-price"),
        page.getByTestId("give-total"),
        page.getByTestId("get-price"),
        page.getByTestId("get-total"),
        page.getByTestId("balance"),
        page.getByTestId("balance-unpriced"),
      ],
    });
  });
});
