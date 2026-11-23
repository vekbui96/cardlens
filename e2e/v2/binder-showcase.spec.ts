import { expect, test, type Page } from "@playwright/test";
import { openV2 } from "./pages/base.ts";

/**
 * The binder showcase (#191), end to end: the page a visitor lands on from a
 * binder link, and the owner's show-off view, under the checks every UI change
 * owes — focus comes back where it left, and reduced motion means no motion.
 *
 * Every share here is a seeded scratch answer from `page.route`: no server
 * share is created and nothing touches real data.
 */

const BINDER = {
  kind: "binder",
  at: 1_800_000_000_000,
  binder: {
    id: "fx-showcase",
    name: "Eeveelution wall",
    format: "9",
    createdAt: 1,
    updatedAt: 2,
    pages: [
      {
        slots: {
          "0": { kind: "card", cardId: "base2-4", finish: "holo", name: "Jolteon", collectorNumber: "4" },
          "4": { kind: "card", cardId: "ex2-6", finish: "holo", name: "Espeon", collectorNumber: "6" },
        },
      },
    ],
  },
};

const EMPTY = {
  kind: "binder",
  at: 1_800_000_000_000,
  binder: {
    id: "fx-empty",
    name: "Fresh binder",
    format: "9",
    createdAt: 1,
    updatedAt: 2,
    pages: [{ slots: {} }],
  },
};

async function serveShare(page: Page, body: unknown, status = 200) {
  await page.route("**/api/share/**", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test.describe("a visitor on a binder link", () => {
  test("taps a card, sees it large, and goes back to the same card", async ({ page }) => {
    await serveShare(page, BINDER);
    await openV2(page, "/trade/scratch1");
    await expect(page.getByRole("heading", { name: "Eeveelution wall", level: 1 })).toBeVisible();

    const grid = page.getByRole("list", { name: "Cards in this binder" });
    const espeon = grid.getByRole("button", { name: /Espeon/ });
    await espeon.click();

    const large = page.getByRole("dialog", { name: "Espeon" });
    await expect(large).toBeVisible();
    const back = large.getByRole("button", { name: "Back to the cards" });
    await back.scrollIntoViewIfNeeded();
    expect((await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await back.click();

    await expect(large).toBeHidden();
    await expect(espeon).toBeFocused();
  });

  test("Escape closes the large card and focus stays with the card", async ({ page }) => {
    await serveShare(page, BINDER);
    await openV2(page, "/trade/scratch1");
    const jolteon = page
      .getByRole("list", { name: "Cards in this binder" })
      .getByRole("button", { name: /Jolteon/ });
    await jolteon.click();
    await expect(page.getByRole("dialog", { name: "Jolteon" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jolteon" })).toBeHidden();
    await expect(jolteon).toBeFocused();
  });

  test("an empty binder says so, rather than drawing an empty grid", async ({ page }) => {
    await serveShare(page, EMPTY);
    await openV2(page, "/trade/scratch-empty");
    await expect(page.getByRole("heading", { name: "Fresh binder", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
    await expect(page.getByText(/Ask whoever sent the link/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Cards in this binder" })).toHaveCount(0);
  });

  test("an unknown link and a revoked one read the same: the link does not work", async ({ page }) => {
    await serveShare(page, { error: "not_found" }, 404);
    await openV2(page, "/trade/revoked-scratch");
    await expect(page.getByText("This link doesn't work")).toBeVisible();
    const revoked = await page.getByRole("main").textContent();

    await page.unrouteAll();
    await serveShare(page, { error: "not_found" }, 404);
    await openV2(page, "/trade/never-existed-scratch");
    await expect(page.getByText("This link doesn't work")).toBeVisible();
    const unknown = await page.getByRole("main").textContent();

    expect(revoked).toBe(unknown);
    await expect(page.getByRole("list", { name: "Cards in this binder" })).toHaveCount(0);
  });
});

test.describe("reduced motion", () => {
  /** The animation the show-off stage is running, by CSS name. */
  async function stageAnimation(page: Page): Promise<string> {
    return page.getByTestId("showcase-stage").evaluate((el) => getComputedStyle(el).animationName);
  }

  async function showOffSecondCard(page: Page) {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await page.getByRole("button", { name: "Show off" }).click();
    const view = page.getByRole("dialog", { name: "Showcase: Jolteon" });
    await view.getByRole("button", { name: "Next card" }).click();
    await expect(view.getByText("Card 2 of 28")).toBeVisible();
  }

  test("the show-off view slides a card in when motion is fine", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await showOffSecondCard(page);
    await expect(page.getByTestId("showcase-stage")).toHaveAttribute("data-motion", "slide");
    expect(await stageAnimation(page)).not.toBe("none");
  });

  test("turns the show-off slide off when the device asks for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await showOffSecondCard(page);
    await expect(page.getByTestId("showcase-stage")).toHaveAttribute("data-motion", "still");
    expect(await stageAnimation(page)).toBe("none");
  });

  test("the visitor's large card opens without animating", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await serveShare(page, BINDER);
    await openV2(page, "/trade/scratch1");
    await page
      .getByRole("list", { name: "Cards in this binder" })
      .getByRole("button", { name: /Espeon/ })
      .click();
    const large = page.getByRole("dialog", { name: "Espeon" });
    await expect(large).toBeVisible();
    // Durations collapse to effectively zero under reduced motion (tokens.css).
    const duration = await large.evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue("--v2-dur").trim() || "0"),
    );
    expect(duration).toBeLessThan(1);
    expect(await large.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});
