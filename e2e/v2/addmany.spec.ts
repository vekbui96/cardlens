import { expect, test } from "@playwright/test";
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

test.describe("add many cards @visual", () => {
  test("after adding: the confirmation with Undo", async ({ page }) => {
    await openV2(page, "/addmany");
    await page.getByLabel("Your card list").fill("sv3 125 x2\nsv3 223 holo\nzzz 1");
    await page.getByRole("button", { name: "Add 2 cards" }).click();
    await expect(page.getByTestId("addmany-added")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("addmany-added.png", { timeout: 20000 });
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
    await expect(page.getByRole("main")).toHaveScreenshot("addmany-preview.png", { timeout: 20000 });
  });
});
